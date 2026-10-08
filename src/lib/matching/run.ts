import { and, asc, eq, inArray, isNull, sql } from "drizzle-orm";
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
  /**
   * Candidates that were NOT in the pool before this run.
   *
   * A re-run keeps a broker's manual order, so new people land at the bottom — below a
   * hand-arranged list, where they are easy to miss. The desk says how many there are
   * rather than leaving a re-run looking like it did nothing.
   */
  added: number;
  /** True if a broker had arranged this pool by hand, so the message can say it was kept. */
  keptManualOrder: boolean;
  /** Eligible supply that existed but scored into the pool — same thing, named for callers. */
  considered: number;
  /** Counts by gate, so ops can be told *why* a pool is small rather than just that it is. */
  excluded: Record<Ineligible | "no_skill_overlap", number>;
}

/** 14 days. `docs/MATCHING.md`: unconfirmed is out of matching entirely. */
export const STALE_DAYS = 14;

/** Everything one candidate's six components need, with nothing from a query shape. */
export interface ScoringInputs {
  requirement: {
    experienceBand: string;
    budgetMinPaise: number;
    budgetMaxPaise: number;
  };
  requiredSkills: Array<{ label: string; isPrimary: boolean }>;
  resource: {
    experienceMonths: number;
    vendorRatePaise: number;
    noticePeriodDays: number | null;
    skills: string[];
  };
  /** The highest attempt, or null where there is no test at all. */
  assessment: { status: string | null; overallScore: number | null; validUntil: Date | null } | null;
  vendor: { reliability: number | null; placements: number };
  /** IST calendar days since the profile was last confirmed. */
  daysSinceConfirmed: number;
  now: Date;
}

/**
 * The six components for one candidate against one requirement, plus the rate they imply.
 *
 * Exported and taking plain values on purpose. This was a closure inside `runMatching`,
 * which was fine while matching was the only caller — and adding a second caller ("Add to a
 * requirement" from the talent pool) would have meant a second copy of the assembly. Two
 * copies of a scoring rule is how a manually added candidate ends up scored differently from
 * a sourced one, on the same screen, with nothing saying why. The same mistake the ranking
 * weights had twice already today.
 */
export function componentsFor(i: ScoringInputs) {
  const a = i.assessment;
  const expired = a?.validUntil ? a.validUntil.getTime() < i.now.getTime() : false;
  const rate = proposedClientRate(
    i.resource.vendorRatePaise, i.requirement.budgetMinPaise, i.requirement.budgetMaxPaise,
  );
  return {
    scoreSkill: scoreSkill(i.requiredSkills, i.resource.skills),
    scoreTest: scoreTest(a?.status ?? null, a?.overallScore ?? null, expired),
    scoreExpFit: scoreExpFit(i.resource.experienceMonths, i.requirement.experienceBand),
    scoreRate: scoreRate(rate.ratePaise, i.requirement.budgetMinPaise, i.requirement.budgetMaxPaise),
    scoreFreshness: scoreFreshness(i.daysSinceConfirmed, i.resource.noticePeriodDays),
    scoreVendor: scoreVendor(i.vendor.reliability, i.vendor.placements),
    rate,
  };
}

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
    return {
      requirementCode: req.code, matched: 0, added: 0, keptManualOrder: false,
      considered: 0, excluded,
    };
  }

  const ids = candidates.map((c) => c.id);

  /**
   * Who is already in this pool, and whether anybody arranged it by hand.
   *
   * Read BEFORE the upsert, because afterwards every row looks like it was always there.
   */
  const existingRows = await db
    .select({ resourceId: s.matches.resourceId, manualRank: s.matches.manualRank })
    .from(s.matches)
    .where(eq(s.matches.requirementId, req.id));
  const alreadyInPool = new Set(existingRows.map((r) => r.resourceId));
  const keptManualOrder = existingRows.some((r) => r.manualRank != null);

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

  /** Binds this requirement's rows to the shared assembly above. */
  const scoreCandidate = (c: (typeof candidates)[number], days: number) => componentsFor({
    requirement: req,
    requiredSkills: required,
    resource: {
      experienceMonths: c.experienceMonths,
      vendorRatePaise: c.vendorRatePaise,
      noticePeriodDays: c.noticePeriodDays,
      skills: skillsBy.get(c.id) ?? [],
    },
    assessment: assessBy.get(c.id) ?? null,
    vendor: {
      reliability: c.reliability == null ? null : Number(c.reliability),
      placements: c.placements ?? 0,
    },
    daysSinceConfirmed: days,
    now,
  });

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

    const components = scoreCandidate(c, days);

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
      proposedRatePaise: components.rate.ratePaise,
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
    return {
      requirementCode: req.code, matched: 0, added: 0, keptManualOrder,
      considered: 0, excluded,
    };
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
    added: ranked.filter((r) => !alreadyInPool.has(r.resourceId)).length,
    keptManualOrder,
    considered: ranked.length,
    excluded,
  };
}

/* ===================================================================== */
/*  Adding somebody from the talent pool, by hand                         */
/* ===================================================================== */

/** The stages a candidate can still usefully be added to. */
export const OPEN_STAGES = ["new", "matching", "shortlisted", "interviewing"] as const;

export interface AddToRequirementResult {
  requirementCode: string;
  /** Added and fully eligible. */
  added: string[];
  /** Added, but failing a gate — `eligibility` records which, so the desk can flag them. */
  flagged: Array<{ maskedId: string; eligibility: Ineligible }>;
  /** Already in this requirement's pool; nothing was written for them. */
  alreadyThere: string[];
  /** Not added, with the reason. */
  refused: Array<{ maskedId: string; reason: string }>;
}

/**
 * Put specific people into a requirement's pool, regardless of the gates.
 *
 * This is "Add to a requirement" on the talent pool, and **overriding a gate is the whole
 * point of it** — the matcher already sources every eligible person automatically, so a
 * manual add that refused ineligible candidates could only ever add somebody matching had
 * already found. `docs/MATCHING.md` says exactly this: *"Record the reason in
 * `matches.eligibility` when ops explicitly asks to see blocked candidates."*
 *
 * So a stale or duplicate-flagged or already-deployed person IS added, carrying the gate
 * they failed, and the desk shows them flagged rather than silently mixed in.
 *
 * **Two things are still refused**, because adding them would be meaningless rather than
 * deliberate:
 *
 *   - **Self-dealing and blocked suppliers.** `getOpsMatchingWorkspace` filters those rows
 *     out of the desk via `is_self_dealing` / `match_is_blocked`, so the row would be
 *     created and then never displayed. A block list is a client's explicit instruction, not
 *     a default to override.
 *   - **Withdrawn and archived people.** They are off the bench; nobody can be offered them.
 *
 * Scored through the same `componentsFor` the matcher uses, so a hand-added candidate and a
 * sourced one are never scored differently on the same screen.
 */
export async function addToRequirement(
  requirementCode: string,
  maskedIds: string[],
  /**
   * Who is doing it. Taken as an argument so the audit row can be written **inside the same
   * transaction as the insert** — working agreement 5 says no exceptions, and an audit row
   * appended afterwards by the route is one failed request away from an unrecorded change to
   * the pool a client will be shown a shortlist from.
   */
  actor: { userId: string; orgId: string },
): Promise<AddToRequirementResult> {
  const [req] = await db
    .select({
      id: s.requirements.id,
      code: s.requirements.code,
      stage: s.requirements.stage,
      experienceBand: s.requirements.experienceBand,
      budgetMinPaise: s.requirements.budgetMinPaise,
      budgetMaxPaise: s.requirements.budgetMaxPaise,
    })
    .from(s.requirements)
    .where(eq(s.requirements.code, requirementCode.toUpperCase()))
    .limit(1);

  if (!req) throw new Error(`addToRequirement: no requirement ${requirementCode}`);

  const out: AddToRequirementResult = {
    requirementCode: req.code, added: [], flagged: [], alreadyThere: [], refused: [],
  };

  const required = await db
    .select({ label: s.skills.label, isPrimary: s.requirementSkills.isPrimary })
    .from(s.requirementSkills)
    .innerJoin(s.skills, eq(s.skills.id, s.requirementSkills.skillId))
    .where(eq(s.requirementSkills.requirementId, req.id));

  const people = await db
    .select({
      id: s.benchResources.id,
      maskedId: s.benchResources.maskedId,
      status: s.benchResources.status,
      experienceMonths: s.benchResources.experienceMonths,
      vendorRatePaise: s.benchResources.vendorRatePaise,
      noticePeriodDays: s.benchResources.noticePeriodDays,
      lastConfirmedAt: s.benchResources.lastConfirmedAt,
      reliability: s.vendorProfiles.reliabilityScore,
      placements: s.vendorProfiles.placementsCount,
    })
    .from(s.benchResources)
    .leftJoin(s.vendorProfiles, eq(s.vendorProfiles.orgId, s.benchResources.vendorOrgId))
    .where(inArray(s.benchResources.maskedId, maskedIds));

  const found = new Set(people.map((x) => x.maskedId));
  for (const id of maskedIds) {
    if (!found.has(id)) out.refused.push({ maskedId: id, reason: "not_found" });
  }
  if (!people.length) return out;

  const ids = people.map((x) => x.id);

  const [skillRows, assessRows, dupRows, existing, refusedRows] = await Promise.all([
    db.select({ resourceId: s.resourceSkills.resourceId, label: s.skills.label })
      .from(s.resourceSkills)
      .innerJoin(s.skills, eq(s.skills.id, s.resourceSkills.skillId))
      .where(inArray(s.resourceSkills.resourceId, ids)),

    db.select({
        resourceId: s.assessments.resourceId,
        status: s.assessments.status,
        overallScore: s.assessments.overallScore,
        validUntil: s.assessments.validUntil,
        attemptNo: s.assessments.attemptNo,
      })
      .from(s.assessments)
      .where(inArray(s.assessments.resourceId, ids))
      .orderBy(sql`${s.assessments.attemptNo} desc`),

    db.select({ a: s.duplicateFlags.resourceAId, b: s.duplicateFlags.resourceBId })
      .from(s.duplicateFlags)
      .where(and(eq(s.duplicateFlags.status, "open"), sql`${s.duplicateFlags.confidence} >= 85`)),

    db.select({ resourceId: s.matches.resourceId })
      .from(s.matches)
      .where(and(eq(s.matches.requirementId, req.id), inArray(s.matches.resourceId, ids))),

    // A block list is a client's explicit instruction, and the desk hides these rows anyway.
    db.select({ resourceId: s.benchResources.id })
      .from(s.benchResources)
      .where(and(
        inArray(s.benchResources.id, ids),
        sql`(is_self_dealing(${s.benchResources.id}, ${req.id})
             or match_is_blocked(${s.benchResources.id}, ${req.id}))`,
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

  const dupBlocked = new Set<string>();
  for (const d of dupRows) { dupBlocked.add(d.a); dupBlocked.add(d.b); }
  const alreadyIn = new Set(existing.map((e) => e.resourceId));
  const refusedIds = new Set(refusedRows.map((r) => r.resourceId));

  const now = new Date();
  const toWrite: Array<{
    resourceId: string;
    maskedId: string;
    components: ReturnType<typeof componentsFor>;
    eligibility: "eligible" | Ineligible;
  }> = [];

  for (const person of people) {
    if (refusedIds.has(person.id)) {
      out.refused.push({ maskedId: person.maskedId, reason: "self_dealing_or_blocked" });
      continue;
    }
    if (person.status === "withdrawn" || person.status === "archived") {
      out.refused.push({ maskedId: person.maskedId, reason: "off_the_bench" });
      continue;
    }
    if (alreadyIn.has(person.id)) {
      out.alreadyThere.push(person.maskedId);
      continue;
    }

    const days = person.lastConfirmedAt == null
      ? Number.POSITIVE_INFINITY
      : istCalendarDaysBetween(person.lastConfirmedAt, now);

    /**
     * The gate they failed, recorded rather than enforced.
     *
     * Order matters: a duplicate flag is the most serious, because it means we cannot tell
     * which of two records is the real person — offering either risks offering the same
     * engineer twice through different suppliers.
     */
    const eligibility: "eligible" | Ineligible =
      dupBlocked.has(person.id) ? "blocked_duplicate"
      : person.status === "deployed" ? "blocked_deployed"
      : !Number.isFinite(days) || days >= STALE_DAYS ? "blocked_stale"
      : "eligible";

    const components = componentsFor({
      requirement: req,
      requiredSkills: required,
      resource: {
        experienceMonths: person.experienceMonths,
        vendorRatePaise: person.vendorRatePaise,
        noticePeriodDays: person.noticePeriodDays,
        skills: skillsBy.get(person.id) ?? [],
      },
      assessment: assessBy.get(person.id) ?? null,
      vendor: {
        reliability: person.reliability == null ? null : Number(person.reliability),
        placements: person.placements ?? 0,
      },
      // A stale profile still gets a freshness score rather than an infinity: the component
      // bottoms out at 0 and the gate is recorded separately.
      daysSinceConfirmed: Number.isFinite(days) ? days : 999,
      now,
    });

    toWrite.push({ resourceId: person.id, maskedId: person.maskedId, components, eligibility });
  }

  /**
   * `added` and `flagged` are filled in from what the INSERT returns, not from this list.
   *
   * The insert is `onConflictDoNothing`, so a row can fail to land between the `existing`
   * read above and the write below. Reporting it as added would be the defect the Undo had in
   * the other direction: `written` is what Undo passes back, so an over-reported id means a
   * delete of a row this call never created.
   */

  if (!toWrite.length) return out;

  await db.transaction(async (tx) => {
    const landed = new Set<string>();

    for (const w of toWrite) {
      const c = w.components;
      const rows = await tx.insert(s.matches).values({
        requirementId: req.id,
        resourceId: w.resourceId,
        algoScore: algoScore(c),
        scoreSkill: c.scoreSkill,
        scoreTest: c.scoreTest,
        scoreExpFit: c.scoreExpFit,
        scoreRate: c.scoreRate,
        scoreFreshness: c.scoreFreshness,
        scoreVendor: c.scoreVendor,
        // Renumbered below; this only has to be non-null and sort last.
        algoRank: 9999,
        proposedClientRatePaise: c.rate.ratePaise,
        eligibility: w.eligibility,
        computedAt: now,
      }).onConflictDoNothing().returning({ resourceId: s.matches.resourceId });

      if (rows.length) {
        landed.add(w.resourceId);
        if (w.eligibility === "eligible") out.added.push(w.maskedId);
        else out.flagged.push({ maskedId: w.maskedId, eligibility: w.eligibility });
      } else {
        // The unique constraint fired: somebody else put them in this pool first.
        out.alreadyThere.push(w.maskedId);
      }
    }

    if (!landed.size) return;

    /**
     * Renumber `algo_rank` so an added candidate slots in by merit rather than sitting at
     * 9999.
     *
     * **The existing rows keep their relative order, taken from their current `algo_rank`.**
     * That is deliberate, and it is why this does not re-sort the pool from the stored
     * component columns: `runMatching` breaks ties on the RAW assessment score, the raw days
     * since confirmation and the raw reliability — not on the bucketed components it stores.
     * Re-sorting here would therefore be a second, subtly different ranking rule, and a
     * re-run would reshuffle ranks for no reason. The same duplication `componentsFor` was
     * extracted to avoid.
     *
     * So: existing rows are already in the matcher's order, new rows are merged in by score,
     * and an existing row wins a tie because it was ranked by the fuller rule.
     *
     * `manual_rank` is untouched — adding somebody must not rearrange an order a broker
     * arranged by hand.
     */
    const pool = await tx
      .select({ id: s.matches.id, resourceId: s.matches.resourceId, algoScore: s.matches.algoScore, algoRank: s.matches.algoRank })
      .from(s.matches)
      .where(eq(s.matches.requirementId, req.id))
      .orderBy(asc(s.matches.algoRank));

    const merged = pool
      .map((m, i) => ({ ...m, isNew: landed.has(m.resourceId), seq: i }))
      .sort((a, b) =>
        b.algoScore - a.algoScore
        || Number(a.isNew) - Number(b.isNew)
        || a.seq - b.seq);

    for (const [i, m] of merged.entries()) {
      if (m.algoRank === i + 1) continue; // nothing to say
      await tx.update(s.matches).set({ algoRank: i + 1, updatedAt: now })
        .where(eq(s.matches.id, m.id));
    }

    /**
     * The audit row, in the same transaction as the insert. Working agreement 5: this changes
     * the pool a client will be shown a shortlist from, and it deliberately includes people a
     * gate had excluded — which gate goes in, because that is the part a dispute turns on.
     */
    await tx.insert(s.auditLog).values({
      actorId: actor.userId,
      actorOrgId: actor.orgId,
      action: "pool.added_to_requirement",
      entityType: "requirement",
      entityId: req.id,
      after: { added: out.added, flagged: out.flagged },
      context: {
        code: req.code,
        refused: out.refused,
        alreadyThere: out.alreadyThere,
      },
      occurredAt: now,
    });
  });

  return out;
}
