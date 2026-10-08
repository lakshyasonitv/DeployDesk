import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { db } from "../../db/client";
import * as s from "../../db/schema";
import { istCalendarDaysBetween } from "../business-clock";
import {
  algoScore, proposedClientRate, scoreExpFit, scoreFreshness, scoreRate,
  scoreSkill, scoreTest, scoreVendor,
} from "./score";

/**
 * Sourcing candidates for one requirement: apply the gates, score what survives, rank it,
 * and write `matches`.
 *
 * Before this, **only the seed ever wrote a match row**. So the 25 seeded requirements had
 * candidates and anything a client actually posted dead-ended: the client's "N profiles
 * match" was a real live count of eligible supply, and the ops matching desk showed 0
 * because nobody had been sourced. The desk's own copy said "matching starts here" and
 * offered no control that started it.
 *
 * Called from two places: the post-a-requirement endpoint, so a new role never dead-ends,
 * and an ops "Re-run matching" action, so a role picks up people listed since.
 */

/** Why a resource was excluded. Mirrors the `match_eligibility` enum. */
export type Ineligible = "blocked_stale" | "blocked_duplicate" | "blocked_deployed";

export interface MatchRunResult {
  requirementCode: string;
  /** Rows written. */
  matched: number;
  /** Eligible supply that existed but scored into the pool — same thing, named for callers. */
  considered: number;
  /** Counts by gate, so ops can be told *why* a pool is small rather than just that it is. */
  excluded: Record<Ineligible | "no_skill_overlap", number>;
}

/** 14 days. `docs/MATCHING.md`: unconfirmed is out of matching entirely. */
const STALE_DAYS = 14;

/**
 * Re-source a requirement.
 *
 * Existing rows are UPDATED rather than deleted and reinserted, because `manual_rank` and
 * `included` are a broker's own work: a re-run must not throw away an ordering somebody
 * arranged by hand. New candidates are appended, and `algo_rank` is recomputed across the
 * whole pool — the spec is explicit that `algo_rank` is kept even when a manual override is
 * active, so the workspace can show "manual override active, algorithm ranking saved".
 */
export async function runMatching(requirementCode: string): Promise<MatchRunResult> {
  const [req] = await db
    .select({
      id: s.requirements.id,
      code: s.requirements.code,
      clientOrgId: s.requirements.clientOrgId,
      experienceBand: s.requirements.experienceBand,
      budgetMinPaise: s.requirements.budgetMinPaise,
      budgetMaxPaise: s.requirements.budgetMaxPaise,
      locationCity: s.requirements.locationCity,
      workMode: s.requirements.workMode,
    })
    .from(s.requirements)
    .where(eq(s.requirements.code, requirementCode))
    .limit(1);

  if (!req) throw new Error(`runMatching: no requirement ${requirementCode}`);

  const excluded: MatchRunResult["excluded"] = {
    blocked_stale: 0, blocked_duplicate: 0, blocked_deployed: 0, no_skill_overlap: 0,
  };

  /* ---------------------------------------------------------- what we need ---- */

  const required = await db
    .select({ label: s.skills.label, isPrimary: s.requirementSkills.isPrimary })
    .from(s.requirementSkills)
    .innerJoin(s.skills, eq(s.skills.id, s.requirementSkills.skillId))
    .where(eq(s.requirementSkills.requirementId, req.id));

  /* ------------------------------------------------------------- the gates ---- */

  /**
   * Status and vendor status are SQL gates; freshness, duplicates and location are applied
   * below where the reason can be counted.
   *
   * `deployed`, `draft` and `withdrawn` are out: a draft is not an offer, and someone
   * already deployed is not available. The vendor org must be active — a suspended
   * supplier's people must not be offered to anyone.
   */
  const candidates = await db
    .select({
      id: s.benchResources.id,
      vendorOrgId: s.benchResources.vendorOrgId,
      baseCity: s.benchResources.baseCity,
      experienceMonths: s.benchResources.experienceMonths,
      vendorRatePaise: s.benchResources.vendorRatePaise,
      noticePeriodDays: s.benchResources.noticePeriodDays,
      lastConfirmedAt: s.benchResources.lastConfirmedAt,
      status: s.benchResources.status,
      workModes: s.benchResources.workModes,
      reliability: s.vendorProfiles.reliabilityScore,
      placements: s.vendorProfiles.placementsCount,
    })
    .from(s.benchResources)
    .innerJoin(s.organizations, eq(s.organizations.id, s.benchResources.vendorOrgId))
    .leftJoin(s.vendorProfiles, eq(s.vendorProfiles.orgId, s.benchResources.vendorOrgId))
    .where(and(
      inArray(s.benchResources.status, ["listed", "in_process"]),
      eq(s.organizations.status, "active"),
    ));

  if (!candidates.length) {
    return { requirementCode: req.code, matched: 0, considered: 0, excluded };
  }

  const ids = candidates.map((c) => c.id);

  /** Skills and the latest assessment, fanned out — both are per-resource lookups. */
  const [skillRows, assessRows, dupRows] = await Promise.all([
    db
      .select({ resourceId: s.resourceSkills.resourceId, label: s.skills.label })
      .from(s.resourceSkills)
      .innerJoin(s.skills, eq(s.skills.id, s.resourceSkills.skillId))
      .where(inArray(s.resourceSkills.resourceId, ids)),

    db
      .select({
        resourceId: s.assessments.resourceId,
        status: s.assessments.status,
        overallScore: s.assessments.overallScore,
        validUntil: s.assessments.validUntil,
        attemptNo: s.assessments.attemptNo,
      })
      .from(s.assessments)
      .where(inArray(s.assessments.resourceId, ids))
      .orderBy(sql`${s.assessments.attemptNo} desc`),

    /**
     * An open duplicate flag at confidence >= 85 blocks BOTH resources — the point of the
     * flag is that we cannot tell which of the two is the real person, so offering either
     * risks offering the same engineer twice through different suppliers.
     */
    db
      .select({ a: s.duplicateFlags.resourceAId, b: s.duplicateFlags.resourceBId })
      .from(s.duplicateFlags)
      .where(and(
        eq(s.duplicateFlags.status, "open"),
        sql`${s.duplicateFlags.confidence} >= 85`,
      )),
  ]);

  const skillsBy = new Map<string, string[]>();
  for (const r of skillRows) {
    const list = skillsBy.get(r.resourceId) ?? [];
    list.push(r.label);
    skillsBy.set(r.resourceId, list);
  }
  const assessBy = new Map<string, (typeof assessRows)[number]>();
  for (const a of assessRows) if (!assessBy.has(a.resourceId)) assessBy.set(a.resourceId, a);

  const blocked = new Set<string>();
  for (const d of dupRows) { blocked.add(d.a); blocked.add(d.b); }

  /* ------------------------------------------------------------- scoring ---- */

  const now = new Date();
  const scored: Array<{
    resourceId: string;
    components: ReturnType<typeof componentsFor>;
    proposedRatePaise: number;
    tieTest: number;
    tieFresh: number;
    tieVendor: number;
  }> = [];

  function componentsFor(c: (typeof candidates)[number], days: number) {
    const a = assessBy.get(c.id);
    const expired = a?.validUntil ? a.validUntil.getTime() < now.getTime() : false;
    const rate = proposedClientRate(c.vendorRatePaise, req.budgetMinPaise, req.budgetMaxPaise);
    return {
      scoreSkill: scoreSkill(required, skillsBy.get(c.id) ?? []),
      scoreTest: scoreTest(a?.status ?? null, a?.overallScore ?? null, expired),
      scoreExpFit: scoreExpFit(c.experienceMonths, req.experienceBand),
      scoreRate: scoreRate(rate.ratePaise, req.budgetMinPaise, req.budgetMaxPaise),
      scoreFreshness: scoreFreshness(days, c.noticePeriodDays),
      scoreVendor: scoreVendor(c.reliability == null ? null : Number(c.reliability), c.placements ?? 0),
      _rate: rate,
    };
  }

  for (const c of candidates) {
    if (blocked.has(c.id)) { excluded.blocked_duplicate++; continue; }

    // Freshness. Measured in IST calendar days, the same arithmetic the pill on every other
    // screen uses, so a candidate excluded here is one a broker would also call unconfirmed.
    const days = c.lastConfirmedAt == null
      ? Number.POSITIVE_INFINITY
      : istCalendarDaysBetween(c.lastConfirmedAt, now);
    if (!Number.isFinite(days) || days >= STALE_DAYS) { excluded.blocked_stale++; continue; }

    /**
     * Location gates ONLY for onsite work. Hybrid and remote do not — which is the whole
     * reason a bench exchange works, and getting this wrong would quietly shrink every
     * remote pool to one city.
     */
    if (req.workMode === "onsite" && req.locationCity) {
      const sameCity = c.baseCity.toLowerCase() === req.locationCity.toLowerCase();
      const willRelocate = (c.workModes ?? []).includes("onsite");
      if (!sameCity && !willRelocate) { excluded.blocked_deployed++; continue; }
    }

    const components = componentsFor(c, days);

    /**
     * No skill overlap at all means not a candidate, rather than a candidate scoring zero
     * on 30% of the weighting. Without this, every engineer on the exchange would appear in
     * every pool and the desk would be useless.
     *
     * This is the gate most affected by the missing adjacency table: a React Native
     * developer has no exact overlap with a React requirement and is dropped here.
     */
    if (required.length && components.scoreSkill === 0) { excluded.no_skill_overlap++; continue; }

    const a = assessBy.get(c.id);
    scored.push({
      resourceId: c.id,
      components,
      proposedRatePaise: components._rate.ratePaise,
      tieTest: a?.overallScore ?? 0,
      tieFresh: -days,
      tieVendor: c.reliability == null ? 0 : Number(c.reliability),
    });
  }

  /**
   * Ranked by score, then by the spec's tie-breaks: higher test score, better freshness,
   * higher vendor reliability. **Never by id or insertion order** — that clusters by vendor
   * and is a side channel (docs/MASKING.md).
   */
  const ranked = scored
    .map((x) => ({ ...x, total: algoScore(x.components) }))
    .sort((a, b) =>
      b.total - a.total
      || b.tieTest - a.tieTest
      || b.tieFresh - a.tieFresh
      || b.tieVendor - a.tieVendor);

  if (!ranked.length) {
    return { requirementCode: req.code, matched: 0, considered: 0, excluded };
  }

  /* --------------------------------------------------------------- write ---- */

  await db.transaction(async (tx) => {
    for (const [i, r] of ranked.entries()) {
      const c = r.components;
      await tx
        .insert(s.matches)
        .values({
          requirementId: req.id,
          resourceId: r.resourceId,
          algoScore: r.total,
          scoreSkill: c.scoreSkill,
          scoreTest: c.scoreTest,
          scoreExpFit: c.scoreExpFit,
          scoreRate: c.scoreRate,
          scoreFreshness: c.scoreFreshness,
          scoreVendor: c.scoreVendor,
          algoRank: i + 1,
          proposedClientRatePaise: r.proposedRatePaise,
          eligibility: "eligible",
          computedAt: now,
        })
        /**
         * `manual_rank` and `included` are deliberately NOT in the update set. They are a
         * broker's own work and a re-run must not discard an ordering somebody arranged by
         * hand — the spec keeps `algo_rank` alongside a manual override for exactly this.
         */
        .onConflictDoUpdate({
          target: [s.matches.requirementId, s.matches.resourceId],
          set: {
            algoScore: r.total,
            scoreSkill: c.scoreSkill,
            scoreTest: c.scoreTest,
            scoreExpFit: c.scoreExpFit,
            scoreRate: c.scoreRate,
            scoreFreshness: c.scoreFreshness,
            scoreVendor: c.scoreVendor,
            algoRank: i + 1,
            proposedClientRatePaise: r.proposedRatePaise,
            computedAt: now,
            updatedAt: now,
          },
        });
    }

    /**
     * Default inclusion: the top few, so "Send masked shortlist" is not 0 on a fresh pool.
     * Only applied where no broker has decided anything yet — `included` is never
     * overwritten above.
     */
    const defaultIncluded = ranked.slice(0, Math.min(4, ranked.length)).map((r) => r.resourceId);
    if (defaultIncluded.length) {
      await tx
        .update(s.matches)
        .set({ included: true, updatedAt: now })
        .where(and(
          eq(s.matches.requirementId, req.id),
          inArray(s.matches.resourceId, defaultIncluded),
          // Only if nobody has touched the ordering for this requirement yet.
          isNull(s.matches.manualRank),
        ));
    }
  });

  return {
    requirementCode: req.code,
    matched: ranked.length,
    considered: ranked.length,
    excluded,
  };
}
