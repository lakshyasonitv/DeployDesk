/**
 * OPS read models. Ops sees everything — but "everything" still means named columns,
 * never SELECT *, so a new sensitive column cannot appear in a response by accident
 * (CLAUDE.md working agreement 7).
 *
 * ADR-003: unrelated to the client and vendor types, no shared base. Nothing in
 * ../client or ../vendor may import from this file, and nothing here imports from them.
 *
 * This is the only portal that may compute or return margin.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import * as s from "../../db/schema";
import { formatPaiseExact, formatPaiseShort } from "../../lib/money/paise";
import { marginBand, marginPct, MARGIN_FLOOR_PCT, MARGIN_TARGET_PCT } from "../../lib/money/rate-band";
import {
  SLA_WINDOW_HOURS, ageLabel, formatExperience, freshnessFor, slaFor, type SlaState,
} from "../../lib/derived";

/* ====================================================================== */
/*  Pipeline                                                               */
/* ====================================================================== */

export interface OpsPipelineRequirement {
  code: string;
  roleTitle: string;
  clientName: string;
  quantity: number;
  skills: string[];
  valuePerMonthLabel: string;
  ageLabel: string;
  ownerShort: string;
  stage: string;
  sla: { state: SlaState; label: string };
  budgetLabel: string;
  startDate: string | null;
  experienceBand: string;
  locationLabel: string;
  clientNote: string | null;
  sourcedCount: number;
}

/**
 * The pipeline label the design shows differs per stage — "SLA 4h", "Awaiting client",
 * "Feedback due", "R2 on 26 Aug", "Margin 14.2%". None of those are stored; each is
 * derived from the stage plus the row's own timestamps and amounts.
 */
export async function getOpsPipeline(opts: {
  search?: string;
  ownerUserId?: string;
  slaAtRisk?: boolean;
  needsSourcing?: boolean;
} = {}) {
  const rows = await db
    .select({
      id: s.requirements.id,
      code: s.requirements.code,
      roleTitle: s.requirements.roleTitle,
      quantity: s.requirements.quantity,
      experienceBand: s.requirements.experienceBand,
      budgetMinPaise: s.requirements.budgetMinPaise,
      budgetMaxPaise: s.requirements.budgetMaxPaise,
      locationCity: s.requirements.locationCity,
      workMode: s.requirements.workMode,
      startDate: s.requirements.startDate,
      clientNote: s.requirements.clientNote,
      stage: s.requirements.stage,
      slaDueAt: s.requirements.slaDueAt,
      postedAt: s.requirements.postedAt,
      clientName: s.organizations.name,
      ownerName: s.users.fullName,
      ownerUserId: s.requirements.ownerUserId,
    })
    .from(s.requirements)
    .innerJoin(s.organizations, eq(s.organizations.id, s.requirements.clientOrgId))
    .leftJoin(s.users, eq(s.users.id, s.requirements.ownerUserId))
    .orderBy(desc(s.requirements.postedAt));

  const ids = rows.map((r) => r.id);

  /**
   * These five run SEQUENTIALLY, deliberately.
   *
   * They were briefly a `Promise.all` to hide the 410ms round trip to the old
   * ap-southeast-2 database. That was a mistake twice over: each concurrent query opened
   * a cold connection (~3s), so it was no faster; and once the pool was widened to allow
   * it, this page's eight-or-so concurrent queries exhausted the pool and `/ops` hung on
   * its second request, taking the rest of the app with it.
   *
   * Against ap-south-1 a warm query is ~30ms, so five in sequence costs ~150ms. Cheap
   * enough that the contention is not worth buying back. Reduce the NUMBER of queries
   * before reaching for concurrency again.
   */
  const skillRows = ids.length
    ? await db
        .select({
          requirementId: s.requirementSkills.requirementId,
          label: s.skills.label,
          isPrimary: s.requirementSkills.isPrimary,
        })
        .from(s.requirementSkills)
        .innerJoin(s.skills, eq(s.skills.id, s.requirementSkills.skillId))
        .where(inArray(s.requirementSkills.requirementId, ids))
    : [];

  const sourcedRows = ids.length
    ? await db
        .select({ requirementId: s.matches.requirementId, n: sql<number>`count(*)::int` })
        .from(s.matches)
        .where(inArray(s.matches.requirementId, ids))
        .groupBy(s.matches.requirementId)
    : [];

  // For `placed` rows the design shows the margin; for `interviewing`, the next round.
  const engagementRows = await db
    .select({
      requirementId: s.engagements.requirementId,
      vendorRatePaise: s.engagements.vendorRatePaise,
      clientRatePaise: s.engagements.clientRatePaise,
    })
    .from(s.engagements);

  const interviewRows = ids.length
    ? await db
        .select({
          requirementId: s.interviews.requirementId,
          roundNo: s.interviews.roundNo,
          scheduledAt: s.interviews.scheduledAt,
          status: s.interviews.status,
        })
        .from(s.interviews)
        .where(inArray(s.interviews.requirementId, ids))
        .orderBy(asc(s.interviews.scheduledAt))
    : [];

  const feedbackDue = ids.length
    ? await db
        .select({ requirementId: s.interviews.requirementId, dueAt: s.interviewFeedback.dueAt, outcome: s.interviewFeedback.outcome })
        .from(s.interviewFeedback)
        .innerJoin(s.interviews, eq(s.interviews.id, s.interviewFeedback.interviewId))
        .where(inArray(s.interviews.requirementId, ids))
    : [];

  const skillsBy = new Map<string, string[]>();
  for (const r of skillRows) {
    const list = skillsBy.get(r.requirementId) ?? [];
    if (r.isPrimary) list.unshift(r.label); else list.push(r.label);
    skillsBy.set(r.requirementId, list);
  }
  const sourcedBy = new Map(sourcedRows.map((r) => [r.requirementId, r.n]));
  const engBy = new Map(engagementRows.filter((e) => e.requirementId).map((e) => [e.requirementId!, e]));
  const nextInterviewBy = new Map<string, (typeof interviewRows)[number]>();
  for (const i of interviewRows) if (!nextInterviewBy.has(i.requirementId)) nextInterviewBy.set(i.requirementId, i);
  const feedbackBy = new Map<string, (typeof feedbackDue)[number]>();
  for (const f of feedbackDue) if (!feedbackBy.has(f.requirementId)) feedbackBy.set(f.requirementId, f);

  let list: OpsPipelineRequirement[] = rows.map((r) => {
    const paused = r.stage === "shortlisted";
    const windowHours = SLA_WINDOW_HOURS[r.stage as keyof typeof SLA_WINDOW_HOURS] ?? SLA_WINDOW_HOURS.matching;
    const sla = slaFor(r.slaDueAt, windowHours, { paused });

    // Stage-specific label, all derived.
    let label = sla.label;
    let state: SlaState = sla.state;
    if (r.stage === "placed") {
      const eng = engBy.get(r.id);
      if (eng) {
        const pct = marginPct(eng.clientRatePaise, eng.vendorRatePaise);
        label = `Margin ${pct.toFixed(1)}%`;
        state = pct >= MARGIN_TARGET_PCT ? "ok" : pct >= MARGIN_FLOOR_PCT ? "warn" : "late";
      } else { label = "Placed"; state = "ok"; }
    } else if (r.stage === "interviewing") {
      const fb = feedbackBy.get(r.id);
      const nx = nextInterviewBy.get(r.id);
      if (fb && !fb.outcome && fb.dueAt) {
        label = "Feedback due"; state = fb.dueAt.getTime() < Date.now() ? "late" : "warn";
      } else if (nx?.scheduledAt) {
        label = `R${nx.roundNo} on ${nx.scheduledAt.toLocaleDateString("en-IN", { day: "2-digit", month: "short" })}`;
        state = "ok";
      }
    } else if (paused) {
      label = "Awaiting client";
    }

    return {
      code: r.code,
      roleTitle: r.roleTitle,
      clientName: r.clientName,
      quantity: r.quantity,
      skills: skillsBy.get(r.id) ?? [],
      valuePerMonthLabel: formatPaiseShort(r.budgetMaxPaise * r.quantity) + "/mo",
      ageLabel: ageLabel(r.postedAt),
      ownerShort: shortenOwner(r.ownerName ?? ""),
      stage: r.stage,
      sla: { state, label },
      budgetLabel: `${formatPaiseShort(r.budgetMinPaise)}–${formatPaiseShort(r.budgetMaxPaise).replace("₹", "")}`,
      startDate: r.startDate,
      experienceBand: `${r.experienceBand} years`,
      locationLabel: r.locationCity ? `${r.locationCity} / ${r.workMode}` : "Remote",
      clientNote: r.clientNote,
      sourcedCount: sourcedBy.get(r.id) ?? 0,
    };
  });

  if (opts.search) {
    const q = opts.search.toLowerCase();
    list = list.filter((r) =>
      r.code.toLowerCase().includes(q) || r.roleTitle.toLowerCase().includes(q) ||
      r.clientName.toLowerCase().includes(q) || r.skills.some((sk) => sk.toLowerCase().includes(q)));
  }
  if (opts.ownerUserId) {
    const owner = rows.find((r) => r.ownerUserId === opts.ownerUserId)?.ownerName;
    if (owner) list = list.filter((r) => r.ownerShort === shortenOwner(owner));
  }
  if (opts.slaAtRisk) list = list.filter((r) => r.sla.state === "warn" || r.sla.state === "late");
  if (opts.needsSourcing) list = list.filter((r) => r.sourcedCount === 0);

  // Server-side grouping and counts, so the board stays usable at hundreds of rows.
  const byStage: Record<string, OpsPipelineRequirement[]> = {
    new: [], matching: [], shortlisted: [], interviewing: [], placed: [],
  };
  for (const r of list) (byStage[r.stage] ??= []).push(r);

  return {
    requirements: list,
    byStage,
    counts: Object.fromEntries(Object.entries(byStage).map(([k, v]) => [k, v.length])),
    total: list.length,
    atRisk: list.filter((r) => r.sla.state === "warn" || r.sla.state === "late").length,
  };
}

/* ====================================================================== */
/*  Matching workspace                                                     */
/* ====================================================================== */

export interface OpsMatchCandidate {
  maskedId: string;
  fullName: string;
  vendorName: string;
  vendorReliability: string;
  experienceLabel: string;
  city: string;
  noticeLabel: string;
  vendorRateLabel: string;
  proposedClientRateLabel: string;
  /** Ops only. Derived, never stored. */
  marginPctLabel: string;
  marginBand: "green" | "amber" | "red";
  algoScore: number;
  rank: number;
  components: Array<{ label: string; weightPct: number; value: number }>;
  reasonLine: string | null;
  eligibility: string;
  freshnessLabel: string;
  assessment: { status: string; overall: number | null; testedOn: string | null };
  lastProjectNote: string | null;
  included: boolean;
  isManuallyRanked: boolean;
}

const COMPONENTS = [
  { key: "scoreSkill", label: "Skill match", weightPct: 30 },
  { key: "scoreTest", label: "Proctored score", weightPct: 22 },
  { key: "scoreExpFit", label: "Experience fit", weightPct: 16 },
  { key: "scoreRate", label: "Rate vs budget", weightPct: 14 },
  { key: "scoreFreshness", label: "Availability freshness", weightPct: 10 },
  { key: "scoreVendor", label: "Vendor reliability", weightPct: 8 },
] as const;

export async function getOpsMatchingWorkspace(requirementCode: string) {
  const [req] = await db
    .select({
      id: s.requirements.id,
      code: s.requirements.code,
      roleTitle: s.requirements.roleTitle,
      quantity: s.requirements.quantity,
      clientName: s.organizations.name,
      budgetMinPaise: s.requirements.budgetMinPaise,
      budgetMaxPaise: s.requirements.budgetMaxPaise,
      experienceBand: s.requirements.experienceBand,
      locationCity: s.requirements.locationCity,
      workMode: s.requirements.workMode,
      startDate: s.requirements.startDate,
      clientNote: s.requirements.clientNote,
      stage: s.requirements.stage,
      ownerName: s.users.fullName,
    })
    .from(s.requirements)
    .innerJoin(s.organizations, eq(s.organizations.id, s.requirements.clientOrgId))
    .leftJoin(s.users, eq(s.users.id, s.requirements.ownerUserId))
    .where(eq(s.requirements.code, requirementCode))
    .limit(1);

  if (!req) return null;

  const rows = await db
    .select({
      algoScore: s.matches.algoScore,
      scoreSkill: s.matches.scoreSkill,
      scoreTest: s.matches.scoreTest,
      scoreExpFit: s.matches.scoreExpFit,
      scoreRate: s.matches.scoreRate,
      scoreFreshness: s.matches.scoreFreshness,
      scoreVendor: s.matches.scoreVendor,
      reasonLine: s.matches.reasonLine,
      algoRank: s.matches.algoRank,
      manualRank: s.matches.manualRank,
      included: s.matches.included,
      eligibility: s.matches.eligibility,
      proposedClientRatePaise: s.matches.proposedClientRatePaise,
      maskedId: s.benchResources.maskedId,
      fullName: s.benchResources.fullName,
      baseCity: s.benchResources.baseCity,
      experienceMonths: s.benchResources.experienceMonths,
      noticePeriodDays: s.benchResources.noticePeriodDays,
      availableFrom: s.benchResources.availableFrom,
      vendorRatePaise: s.benchResources.vendorRatePaise,
      lastConfirmedAt: s.benchResources.lastConfirmedAt,
      lastProjectNote: s.benchResources.lastProjectNote,
      resourceId: s.benchResources.id,
      vendorName: s.organizations.name,
      vendorReliability: s.vendorProfiles.reliabilityScore,
    })
    .from(s.matches)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.matches.resourceId))
    .innerJoin(s.organizations, eq(s.organizations.id, s.benchResources.vendorOrgId))
    .leftJoin(s.vendorProfiles, eq(s.vendorProfiles.orgId, s.benchResources.vendorOrgId))
    .where(eq(s.matches.requirementId, req.id))
    .orderBy(asc(sql`coalesce(${s.matches.manualRank}, ${s.matches.algoRank} + 1000)`));

  const assessRows = rows.length
    ? await db
        .select({
          resourceId: s.assessments.resourceId,
          status: s.assessments.status,
          overallScore: s.assessments.overallScore,
          completedAt: s.assessments.completedAt,
        })
        .from(s.assessments)
        .where(inArray(s.assessments.resourceId, rows.map((r) => r.resourceId)))
        .orderBy(desc(s.assessments.attemptNo))
    : [];
  const assessBy = new Map<string, (typeof assessRows)[number]>();
  for (const a of assessRows) if (!assessBy.has(a.resourceId)) assessBy.set(a.resourceId, a);

  const candidates: OpsMatchCandidate[] = rows.map((r, idx) => {
    const proposed = r.proposedClientRatePaise ?? 0;
    const pct = proposed ? marginPct(proposed, r.vendorRatePaise) : 0;
    const f = freshnessFor(r.lastConfirmedAt);
    const a = assessBy.get(r.resourceId);
    return {
      maskedId: r.maskedId,
      fullName: r.fullName,
      vendorName: r.vendorName,
      vendorReliability: r.vendorReliability ?? "0.0",
      experienceLabel: formatExperience(r.experienceMonths),
      city: r.baseCity,
      noticeLabel: r.availableFrom
        ? `From ${new Date(r.availableFrom).toLocaleDateString("en-IN", { day: "numeric", month: "short" })}`
        : r.noticePeriodDays === 0 ? "Immediate"
        : r.noticePeriodDays ? `${r.noticePeriodDays} days` : "Unknown",
      vendorRateLabel: formatPaiseExact(r.vendorRatePaise),
      proposedClientRateLabel: proposed ? formatPaiseExact(proposed) : "—",
      marginPctLabel: proposed ? `${pct.toFixed(1)}%` : "—",
      marginBand: marginBand(pct),
      algoScore: r.algoScore,
      rank: idx + 1,
      components: COMPONENTS.map((c) => ({
        label: c.label, weightPct: c.weightPct, value: r[c.key],
      })),
      reasonLine: r.reasonLine,
      eligibility: r.eligibility,
      freshnessLabel: f.label,
      assessment: {
        status: a?.status ?? "not_started",
        overall: a?.overallScore ?? null,
        testedOn: a?.completedAt?.toISOString().slice(0, 10) ?? null,
      },
      lastProjectNote: r.lastProjectNote,
      included: r.included,
      isManuallyRanked: r.manualRank != null,
    };
  });

  return {
    requirement: {
      code: req.code,
      roleTitle: req.roleTitle,
      quantity: req.quantity,
      clientName: req.clientName,
      stage: req.stage,
      ownerShort: shortenOwner(req.ownerName ?? ""),
      budgetLabel: `${formatPaiseShort(req.budgetMinPaise)}–${formatPaiseShort(req.budgetMaxPaise).replace("₹", "")}`,
      experienceBand: `${req.experienceBand} years`,
      locationLabel: req.locationCity ? `${req.locationCity} / ${req.workMode}` : "Remote",
      startDate: req.startDate,
      clientNote: req.clientNote,
    },
    weights: COMPONENTS.map((c) => ({ label: c.label, pct: `${c.weightPct}%` })),
    candidates,
    includedCount: candidates.filter((c) => c.included).length,
    hasManualOrder: candidates.some((c) => c.isManuallyRanked),
  };
}

/* ====================================================================== */
/*  Talent pool — fully unmasked                                           */
/* ====================================================================== */

export async function getOpsTalentPool(opts: { search?: string; limit?: number } = {}) {
  const started = Date.now();
  const limit = opts.limit ?? 60;

  const rows = await db
    .select({
      id: s.benchResources.id,
      maskedId: s.benchResources.maskedId,
      fullName: s.benchResources.fullName,
      baseCity: s.benchResources.baseCity,
      experienceMonths: s.benchResources.experienceMonths,
      vendorRatePaise: s.benchResources.vendorRatePaise,
      status: s.benchResources.status,
      lastConfirmedAt: s.benchResources.lastConfirmedAt,
      vendorName: s.organizations.name,
      vendorReliability: s.vendorProfiles.reliabilityScore,
    })
    .from(s.benchResources)
    .innerJoin(s.organizations, eq(s.organizations.id, s.benchResources.vendorOrgId))
    .leftJoin(s.vendorProfiles, eq(s.vendorProfiles.orgId, s.benchResources.vendorOrgId))
    .where(inArray(s.benchResources.status, ["listed", "in_process", "deployed"]))
    .orderBy(desc(s.benchResources.lastConfirmedAt))
    .limit(limit);

  const ids = rows.map((r) => r.id);
  const skillRows = ids.length
    ? await db
        .select({ resourceId: s.resourceSkills.resourceId, label: s.skills.label, isPrimary: s.resourceSkills.isPrimary })
        .from(s.resourceSkills)
        .innerJoin(s.skills, eq(s.skills.id, s.resourceSkills.skillId))
        .where(inArray(s.resourceSkills.resourceId, ids))
    : [];
  const assessRows = ids.length
    ? await db
        .select({ resourceId: s.assessments.resourceId, overallScore: s.assessments.overallScore, status: s.assessments.status, attemptNo: s.assessments.attemptNo })
        .from(s.assessments).where(inArray(s.assessments.resourceId, ids)).orderBy(desc(s.assessments.attemptNo))
    : [];

  /**
   * The client-facing rate, taken from the most recent match that actually priced this
   * resource. This column previously showed a figure invented in the page by dividing the
   * vendor rate by a hardcoded 24% target — a number no broker had agreed and no row
   * contained. A resource that has never been priced now shows "not priced", which is the
   * truth, rather than a plausible-looking guess.
   */
  const pricedRows = ids.length
    ? await db
        .select({
          resourceId: s.matches.resourceId,
          proposedClientRatePaise: s.matches.proposedClientRatePaise,
          computedAt: s.matches.computedAt,
        })
        .from(s.matches)
        .where(inArray(s.matches.resourceId, ids))
        .orderBy(desc(s.matches.computedAt))
    : [];
  const pricedBy = new Map<string, number>();
  for (const r of pricedRows) {
    if (!pricedBy.has(r.resourceId) && r.proposedClientRatePaise) {
      pricedBy.set(r.resourceId, r.proposedClientRatePaise);
    }
  }

  const skillsBy = new Map<string, string[]>();
  for (const r of skillRows) {
    const list = skillsBy.get(r.resourceId) ?? [];
    if (r.isPrimary) list.unshift(r.label); else list.push(r.label);
    skillsBy.set(r.resourceId, list);
  }
  const assessBy = new Map<string, (typeof assessRows)[number]>();
  for (const a of assessRows) if (!assessBy.has(a.resourceId)) assessBy.set(a.resourceId, a);

  let results = rows.map((r) => {
    const f = freshnessFor(r.lastConfirmedAt);
    const a = assessBy.get(r.id);
    return {
      maskedId: r.maskedId,
      fullName: r.fullName,
      vendorName: r.vendorName,
      vendorReliability: r.vendorReliability ?? "0.0",
      skills: skillsBy.get(r.id) ?? [],
      experienceLabel: formatExperience(r.experienceMonths),
      city: r.baseCity,
      vendorRateLabel: formatPaiseExact(r.vendorRatePaise),
      // Ops sees both sides; this is the real proposed figure or nothing at all.
      clientRateLabel: pricedBy.has(r.id) ? formatPaiseExact(pricedBy.get(r.id)!) : null,
      status: r.status,
      score: a?.overallScore ?? null,
      assessmentStatus: a?.status ?? "not_started",
      freshnessLabel: f.label,
      freshnessState: f.state,
    };
  });

  if (opts.search) {
    const q = opts.search.toLowerCase();
    results = results.filter((r) =>
      r.fullName.toLowerCase().includes(q) || r.maskedId.toLowerCase().includes(q) ||
      r.vendorName.toLowerCase().includes(q) || r.skills.some((sk) => sk.toLowerCase().includes(q)));
  }

  const [{ n: poolTotal }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.benchResources)
    .where(inArray(s.benchResources.status, ["listed", "in_process", "deployed"]));

  return {
    results,
    // The UI advertises "62 results · 0.18s"; both are measured, not hardcoded.
    resultCount: results.length,
    poolTotal,
    elapsedSeconds: ((Date.now() - started) / 1000).toFixed(2),
  };
}

/* ====================================================================== */
/*  Margin                                                                 */
/* ====================================================================== */

export async function getOpsMargin() {
  const rows = await db
    .select({
      maskedId: s.benchResources.maskedId,
      fullName: s.benchResources.fullName,
      roleTitle: s.engagements.roleTitle,
      vendorRatePaise: s.engagements.vendorRatePaise,
      clientRatePaise: s.engagements.clientRatePaise,
      status: s.engagements.status,
      startDate: s.engagements.startDate,
      marginApprovedBy: s.engagements.marginApprovedBy,
      marginExceptionNote: s.engagements.marginExceptionNote,
      vendorName: sql<string>`vendor_org.name`,
      clientName: sql<string>`client_org.name`,
      approverName: s.users.fullName,
    })
    .from(s.engagements)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.engagements.resourceId))
    .innerJoin(sql`organizations as vendor_org`, sql`vendor_org.id = ${s.engagements.vendorOrgId}`)
    .innerJoin(sql`organizations as client_org`, sql`client_org.id = ${s.engagements.clientOrgId}`)
    .leftJoin(s.users, eq(s.users.id, s.engagements.marginApprovedBy))
    .orderBy(desc(s.engagements.startDate));

  const enriched = rows.map((r) => {
    const spread = r.clientRatePaise - r.vendorRatePaise;
    const pct = marginPct(r.clientRatePaise, r.vendorRatePaise);
    return {
      maskedId: r.maskedId,
      fullName: r.fullName,
      vendorName: r.vendorName,
      clientName: r.clientName,
      roleTitle: r.roleTitle,
      vendorRateLabel: formatPaiseExact(r.vendorRatePaise),
      clientRateLabel: formatPaiseExact(r.clientRatePaise),
      spreadLabel: formatPaiseExact(spread),
      pctLabel: `${pct.toFixed(1)}%`,
      pct,
      band: marginBand(pct),
      status: r.status,
      startDate: r.startDate,
      exception: pct < MARGIN_FLOOR_PCT
        ? { approverName: r.approverName, note: r.marginExceptionNote }
        : null,
    };
  });

  const totalSpread = rows.reduce((a, r) => a + (r.clientRatePaise - r.vendorRatePaise), 0);
  const runRate = rows.reduce((a, r) => a + r.clientRatePaise, 0);
  const avgMargin = enriched.length
    ? enriched.reduce((a, r) => a + r.pct, 0) / enriched.length
    : 0;

  return {
    stats: {
      grossSpreadLabel: formatPaiseShort(totalSpread),
      runRateLabel: formatPaiseShort(runRate),
      averageMarginLabel: `${avgMargin.toFixed(1)}%`,
      livePlacements: rows.filter((r) => r.status === "active" || r.status === "onboarding").length,
      belowFloorCount: enriched.filter((r) => r.pct < MARGIN_FLOOR_PCT).length,
    },
    rows: enriched,
    guardrail: {
      floorPct: MARGIN_FLOOR_PCT,
      targetPct: MARGIN_TARGET_PCT,
      breaches: enriched.filter((r) => r.pct < MARGIN_FLOOR_PCT),
    },
  };
}

/* ====================================================================== */
/*  Duplicates                                                             */
/* ====================================================================== */

export async function getOpsDuplicates() {
  const flags = await db
    .select({
      code: s.duplicateFlags.code,
      confidence: s.duplicateFlags.confidence,
      signals: s.duplicateFlags.signals,
      status: s.duplicateFlags.status,
      detectedAt: s.duplicateFlags.detectedAt,
      resourceAId: s.duplicateFlags.resourceAId,
      resourceBId: s.duplicateFlags.resourceBId,
      blocksRequirements: s.duplicateFlags.blocksRequirements,
      assignedName: s.users.fullName,
    })
    .from(s.duplicateFlags)
    .leftJoin(s.users, eq(s.users.id, s.duplicateFlags.assignedTo))
    .orderBy(desc(s.duplicateFlags.confidence));

  const resourceIds = flags.flatMap((f) => [f.resourceAId, f.resourceBId]);
  const resources = resourceIds.length
    ? await db
        .select({
          id: s.benchResources.id,
          maskedId: s.benchResources.maskedId,
          fullName: s.benchResources.fullName,
          experienceMonths: s.benchResources.experienceMonths,
          vendorRatePaise: s.benchResources.vendorRatePaise,
          lastConfirmedAt: s.benchResources.lastConfirmedAt,
          panHash: s.benchResources.panHash,
          phoneHash: s.benchResources.phoneHash,
          createdAt: s.benchResources.createdAt,
          vendorName: s.organizations.name,
          vendorReliability: s.vendorProfiles.reliabilityScore,
          placements: s.vendorProfiles.placementsCount,
        })
        .from(s.benchResources)
        .innerJoin(s.organizations, eq(s.organizations.id, s.benchResources.vendorOrgId))
        .leftJoin(s.vendorProfiles, eq(s.vendorProfiles.orgId, s.benchResources.vendorOrgId))
        .where(inArray(s.benchResources.id, resourceIds))
    : [];

  const assessRows = resourceIds.length
    ? await db
        .select({ resourceId: s.assessments.resourceId, status: s.assessments.status, overallScore: s.assessments.overallScore, completedAt: s.assessments.completedAt })
        .from(s.assessments).where(inArray(s.assessments.resourceId, resourceIds))
    : [];
  const assessBy = new Map(assessRows.map((a) => [a.resourceId, a]));
  const byId = new Map(resources.map((r) => [r.id, r]));

  const side = (id: string, isFirst: boolean) => {
    const r = byId.get(id);
    if (!r) return null;
    const a = assessBy.get(id);
    const f = freshnessFor(r.lastConfirmedAt);
    return {
      isFirst,
      maskedId: r.maskedId,
      fullName: r.fullName,
      vendorName: r.vendorName,
      submittedAt: r.createdAt.toISOString(),
      facts: [
        { k: "PAN hash", v: r.panHash ? `…${r.panHash.slice(-6)}` : "—", severity: "high" },
        { k: "Phone hash", v: r.phoneHash ? `…${r.phoneHash.slice(-4)}` : "—", severity: "high" },
        { k: "Experience", v: `${(r.experienceMonths / 12).toFixed(1)} years`, severity: "none" },
        { k: "Proctored score", v: a?.status === "scored" && a.overallScore != null
            ? `${a.overallScore} · ${a.completedAt?.toLocaleDateString("en-IN", { day: "2-digit", month: "short" }) ?? ""}`
            : a?.status === "not_started" ? "Not started" : (a?.status ?? "—"), severity: "none" },
        { k: "Vendor rate", v: formatPaiseExact(r.vendorRatePaise), severity: "none" },
        { k: "Freshness", v: f.label, severity: f.state === "confirmed" ? "none" : "medium" },
        { k: "Vendor reliability", v: `${r.vendorReliability ?? "0.0"} / 5 · ${r.placements ?? 0} placements`,
          severity: Number(r.vendorReliability ?? 0) < 4 ? "medium" : "none" },
      ],
    };
  };

  return flags.map((f) => {
    const a = side(f.resourceAId, true);
    const b = side(f.resourceBId, false);
    // Recommendation: keep the earlier submission with the better freshness and higher
    // vendor reliability (docs/DOMAIN.md).
    const recommendation = a && b
      ? (Number(byId.get(f.resourceAId)?.vendorReliability ?? 0) >= Number(byId.get(f.resourceBId)?.vendorReliability ?? 0)
          ? a.maskedId : b.maskedId)
      : null;
    return {
      code: f.code,
      confidence: f.confidence,
      status: f.status,
      detectedAt: f.detectedAt.toISOString(),
      assignedName: f.assignedName,
      // >= 85 blocks both resources; 60-84 flags without blocking.
      blocks: f.confidence >= 85,
      blockedRequirementCount: (f.blocksRequirements ?? []).length,
      signals: f.signals as Array<{ key: string; label: string; verdict: string; severity: string; detail?: string }>,
      sides: [a, b].filter(Boolean),
      recommendation,
    };
  });
}

/* ----------------------------------------------------------------- utils */

function shortenOwner(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length < 2) return full;
  return `${parts[0][0]}. ${parts[parts.length - 1]}`;
}

/* ====================================================================== */
/*  Sidebar — deliberately cheap                                           */
/* ====================================================================== */

/**
 * Badge counts and today's queue for the ops sidebar.
 *
 * This is the biggest single win in the performance sprint. The sidebar used to call
 * getOpsPipeline() — all 24 requirements plus their skills, sourced counts, engagements,
 * interviews and feedback — AND getOpsDuplicates(), purely to render three numbers. On
 * /ops/margin that was 9 of the page's 10 queries and 443ms of its 471ms: 94% of the
 * data time spent on the sidebar rather than the margin table.
 *
 * One round trip. Pages that genuinely need the pipeline fetch it themselves.
 */
export async function getOpsSidebar() {
  const rows = (await db.execute(sql`
    select
      (select count(*) from requirements
        where stage in ('new','matching','shortlisted','interviewing','placed'))::int as total,
      (select count(*) from requirements where stage = 'matching')::int    as matching,
      (select count(*) from requirements where stage = 'shortlisted')::int as shortlisted,
      (select count(*) from duplicate_flags where status = 'open')::int    as open_dupes,
      (select count(*) from interview_feedback
        where outcome is null and due_at is not null)::int                 as feedback_due
  `)) as unknown as Array<{
    total: number; matching: number; shortlisted: number;
    open_dupes: number; feedback_due: number;
  }>;
  const c = rows[0];
  const dupes = Number(c?.open_dupes) || 0;

  return {
    items: [
      { label: `${dupes} duplicate flag${dupes === 1 ? "" : "s"} to clear`, dot: "#ef4444" },
      { label: `${Number(c?.shortlisted) || 0} shortlists awaiting a client`, dot: "#fbbf24" },
      { label: `${Number(c?.matching) || 0} requirements in matching`, dot: "#3f3f4a" },
    ],
    badges: {
      pipeline: Number(c?.total) || undefined,
      matching: Number(c?.matching) || undefined,
      duplicates: dupes || undefined,
    } as Record<string, string | number | undefined>,
  };
}
