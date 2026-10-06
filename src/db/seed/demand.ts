import { and, eq } from "drizzle-orm";
import { db, log, rng, schema as s } from "./ctx";
import { POOLS, REQS, SHORTLIST_CANDS, type Requirement } from "./fixtures";
import {
  SEED_NOW, daysAgo, daysAhead, hoursAgo, hoursAhead, fixtureDateToOffset,
  parseAgeToDate, parseExperienceBand, parseLocation, parseNotice,
} from "./helpers";
import { parseBandToPaise, parseMoneyToPaise } from "../../lib/money/paise";
import { deriveRateBand } from "../../lib/money/rate-band";
import { SLA_WINDOW_HOURS, slaFor } from "../../lib/derived";
import type { OrgSeed, SkillMap } from "./orgs";
import type { ResourceSeed } from "./resources";

/** Weights from docs/MATCHING.md. Order matches the `r[]` arrays in the pools. */
const WEIGHTS = [0.30, 0.22, 0.16, 0.14, 0.10, 0.08] as const;

/** ADR-011: algo_score is COMPUTED from the components, never copied from the fixture. */
function computeAlgoScore(components: number[]): number {
  return Math.round(components.reduce((acc, v, i) => acc + v * WEIGHTS[i], 0));
}

/**
 * Seed `sla_due_at` so the DERIVED state matches the fixture's intended colour.
 * The label itself is never stored — docs/DOMAIN.md lists sla_state as derived.
 *
 * Where the fixture label carries an explicit number ("SLA 4h", "Overdue 2h") we use it,
 * then verify the derivation agrees; if it lands on the wrong side of the 25% boundary we
 * fall back to a value that is unambiguously inside the intended band. The colour being
 * right matters more than the hour being identical.
 */
function slaDueAtFor(req: Requirement): { dueAt: Date | null; paused: boolean } {
  const windowHours =
    SLA_WINDOW_HOURS[req.stage0 as keyof typeof SLA_WINDOW_HOURS] ?? SLA_WINDOW_HOURS.matching;

  if (req.slaKind === "idle") {
    // Clock paused on entry to `shortlisted`. Not a breach.
    return { dueAt: hoursAhead(windowHours * 0.5), paused: true };
  }
  if (req.slaKind === "late") {
    const m = /(\d+)\s*h/i.exec(req.sla);
    return { dueAt: hoursAgo(m ? Number(m[1]) : 2), paused: false };
  }

  const stated = /(?:SLA|by)\s*(\d+)\s*h/i.exec(req.sla);
  if (stated) {
    const hours = Number(stated[1]);
    const candidate = hoursAhead(hours);
    if (slaFor(candidate, windowHours, { now: SEED_NOW }).state === req.slaKind) {
      return { dueAt: candidate, paused: false };
    }
  }
  const fraction = req.slaKind === "warn" ? 0.15 : 0.6;
  return { dueAt: hoursAhead(windowHours * fraction), paused: false };
}

export async function seedDemand(org: OrgSeed, skills: SkillMap, res: ResourceSeed) {
  /* ---------------------------------------------------- requirements */
  const reqRows: Array<typeof s.requirements.$inferInsert> = REQS.map((r) => {
    const loc = parseLocation(r.loc);
    const [budgetMin, budgetMax] = parseBandToPaise(r.budget);
    const { dueAt } = slaDueAtFor(r);
    const postedAt = parseAgeToDate(r.age);
    const clientOrg = org.byName.get(r.client)!;
    const owner = org.opsByShort.get(r.owner)!;
    const creator = org.clientUsers.find((u) => u.orgId === clientOrg.id) ?? org.ananya;

    return {
      code: r.id,
      clientOrgId: clientOrg.id,
      createdBy: creator.id,
      ownerUserId: owner.id,
      roleTitle: r.role,
      quantity: r.qty,
      experienceBand: parseExperienceBand(r.expBand),
      budgetMinPaise: budgetMin,
      budgetMaxPaise: budgetMax,
      engagementType: "contract" as const,
      durationText: "6 months, extendable",
      locationCity: loc.city,
      workMode: loc.workMode,
      hybridDays: loc.hybridDays,
      startDate: fixtureDateToOffset(r.start).toISOString().slice(0, 10),
      noticeAccepted: ["immediate", "le_30"],
      clientNote: r.note, // CLIENT + OPS ONLY — leak-test bait
      stage: r.stage0 as typeof s.requirements.$inferInsert.stage,
      slaDueAt: dueAt,
      postedAt,
      closedAt: null,
    };
  });

  const requirements = await db.insert(s.requirements).values(reqRows).returning();
  const reqByCode = new Map(requirements.map((r) => [r.code, r]));
  log(`  requirements: ${requirements.length}`);

  /* ---------------------------------------------------- requirement_skills */
  const reqSkillRows: Array<typeof s.requirementSkills.$inferInsert> = [];
  for (const r of REQS) {
    const row = reqByCode.get(r.id)!;
    r.skills.forEach((label, i) => {
      const sk = skills.get(label);
      if (sk) reqSkillRows.push({ requirementId: row.id, skillId: sk.id, isPrimary: i === 0 });
    });
  }
  await db.insert(s.requirementSkills).values(reqSkillRows).onConflictDoNothing();
  log(`  requirement_skills: ${reqSkillRows.length}`);

  /* ---------------------------------------------------- stage events */
  const STAGE_PATH = ["new", "matching", "shortlisted", "interviewing", "placed"];
  const stageRows: Array<typeof s.requirementStageEvents.$inferInsert> = [];
  for (const r of REQS) {
    const row = reqByCode.get(r.id)!;
    const target = STAGE_PATH.indexOf(r.stage0);
    let from: string | null = null;
    for (let i = 0; i <= target; i++) {
      stageRows.push({
        requirementId: row.id,
        fromStage: from,
        toStage: STAGE_PATH[i],
        actorId: i === 0 ? row.createdBy : row.ownerUserId,
        reason: i === 0 ? "Requirement posted" : null,
        occurredAt: new Date(row.postedAt!.getTime() + i * 6 * 3_600_000),
      });
      from = STAGE_PATH[i];
    }
  }
  await db.insert(s.requirementStageEvents).values(stageRows);
  log(`  requirement_stage_events: ${stageRows.length}`);

  /* ---------------------------------------------------- matches */
  const matchRows: Array<typeof s.matches.$inferInsert> = [];
  for (const r of REQS) {
    if (r.stage0 === "new") continue; // nothing sourced yet — sourced_count is 0 in the fixture
    const row = reqByCode.get(r.id)!;
    const pool = POOLS[r.pool] ?? [];

    const scored = pool.map((c) => {
      const resource = res.byMasked.get(c.id)!;
      const algoScore = computeAlgoScore(c.r);
      return { c, resource, algoScore };
    }).sort((a, b) => b.algoScore - a.algoScore);

    scored.forEach((entry, idx) => {
      const { c, resource, algoScore } = entry;
      const freshDays = /unconfirmed\s*(\d+)/i.exec(c.fresh);
      const stale = freshDays ? Number(freshDays[1]) >= 14 : false;
      const scoreExpired = /expired/i.test(c.score);

      matchRows.push({
        requirementId: row.id,
        resourceId: resource.id,
        algoScore,
        scoreSkill: c.r[0], scoreTest: c.r[1], scoreExpFit: c.r[2],
        scoreRate: c.r[3], scoreFreshness: c.r[4], scoreVendor: c.r[5],
        reasonLine: c.note,
        algoRank: idx + 1,
        manualRank: null,
        included: false,
        hidden: false,
        proposedClientRatePaise: parseMoneyToPaise(c.crate),
        eligibility: stale ? "blocked_stale" : scoreExpired ? "blocked_score_expired" : "eligible",
        computedAt: hoursAgo(2),
      });
    });
  }
  await db.insert(s.matches).values(matchRows).onConflictDoNothing();
  log(`  matches: ${matchRows.length}`);

  return { requirements, reqByCode };
}

export type DemandSeed = Awaited<ReturnType<typeof seedDemand>>;

/* ====================================================================== */
/*  The hero path: shortlist REQ-2291                                      */
/* ====================================================================== */

/**
 * Six masked profiles in the order the design shows. That order is a BROKER'S
 * ordering, so it is seeded as `manual_rank` on the matches and as `position` on the
 * snapshot — not as algorithm order (see ADR-011).
 *
 * Rate bands are derived from the proposed CLIENT rate via deriveRateBand (ADR-004).
 * The prototype's own bands bracket the vendor cost and are deliberately NOT used.
 */
const SHORTLIST_ORDER = ["TV-6620", "TV-4821", "TV-5302", "TV-5107", "TV-4488", "TV-3964"];

export async function seedShortlists(org: OrgSeed, res: ResourceSeed, demand: DemandSeed) {
  const req = demand.reqByCode.get("REQ-2291")!;

  const [shortlist] = await db.insert(s.shortlists).values({
    requirementId: req.id,
    sequenceNo: 1,
    sentBy: org.priya.id,
    sentAt: hoursAgo(2),
    brokerNote:
      "Top two clear your band and can start on the 15th. TV-4488 is above band — say the " +
      "word and I will go back to the supplier for a six-month rate. Nothing goes to them " +
      "with your company name or budget attached.",
    openedAt: hoursAgo(1.5),
  }).returning();

  const itemRows: Array<typeof s.shortlistItems.$inferInsert> = [];
  const attemptTwo = new Set(["TV-5302", "TV-3964"]);

  for (const [idx, maskedId] of SHORTLIST_ORDER.entries()) {
    const resource = res.byMasked.get(maskedId)!;
    const cand = SHORTLIST_CANDS.find((c) => c.id === maskedId);
    const poolCand = Object.values(POOLS).flat().find((c) => c.id === maskedId);

    // The proposed client rate is the ONLY input to the band.
    const clientRateLabel = cand?.clientRate ?? poolCand?.crate;
    if (!clientRateLabel) throw new Error(`seedShortlists: no client rate for ${maskedId}`);
    const band = deriveRateBand(parseMoneyToPaise(clientRateLabel));

    const meta = res.meta.get(maskedId)!;
    const scoreMatch = /^(\d+)/.exec(meta.score);
    const testedLabel = cand?.testedOn?.replace(/^tested\s*/, "") ?? null;
    const notice = parseNotice(poolCand?.notice ?? "Immediate");

    itemRows.push({
      shortlistId: shortlist.id,
      resourceId: resource.id, // join key only — NEVER serialised to a client
      maskedId,
      position: idx + 1,
      experienceMonths: resource.experienceMonths,
      baseCity: resource.baseCity,
      skillsSnapshot: meta.skills,
      scoreOverall: cand?.score ?? (scoreMatch ? Number(scoreMatch[1]) : null),
      scoreCoding: cand?.bars?.[0]?.v ?? null,
      scoreDsa: cand?.bars?.[1]?.v ?? null,
      scoreSystemDesign: cand?.bars?.[2]?.v ?? null,
      scoreCommunication: cand?.bars?.[3]?.v ?? null,
      assessmentAttemptNo: attemptTwo.has(maskedId) ? 2 : 1,
      assessmentTestedOn: testedLabel
        ? fixtureDateToOffset(testedLabel).toISOString().slice(0, 10)
        : null,
      availabilityLabel: cand?.avail ?? notice.label,
      availabilityKind: notice.kind,
      rateBandMinPaise: band.minPaise,
      rateBandMaxPaise: band.maxPaise,
      // The design opens with the top two already selected, so the primary button
      // reads "Request interviews · 2".
      clientDecision: idx < 2 ? "selected" : "pending",
      decidedAt: idx < 2 ? hoursAgo(1) : null,
    });
  }

  const items = await db.insert(s.shortlistItems).values(itemRows).returning();
  log(`  shortlists: 1 · shortlist_items: ${items.length}`);

  // Mirror the broker's ordering onto the matches, and mark them included.
  for (const [idx, maskedId] of SHORTLIST_ORDER.entries()) {
    const resource = res.byMasked.get(maskedId);
    if (!resource) continue;
    await db.update(s.matches)
      .set({ manualRank: idx + 1, included: true })
      .where(and(
        eq(s.matches.requirementId, req.id),
        eq(s.matches.resourceId, resource.id),
      ));
  }

  return { shortlist, items, itemByMasked: new Map(items.map((i) => [i.maskedId, i])) };
}

export type ShortlistSeed = Awaited<ReturnType<typeof seedShortlists>>;
