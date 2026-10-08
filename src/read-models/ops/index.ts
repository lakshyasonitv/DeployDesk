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
import { and, asc, desc, eq, gte, inArray, lt, lte, sql } from "drizzle-orm";
import { db } from "../../db/client";
import * as s from "../../db/schema";
import { formatPaiseExact, formatPaiseShort } from "../../lib/money/paise";
import { marginBand, marginPct, isBelowFloor, MARGIN_FLOOR_PCT, MARGIN_TARGET_PCT } from "../../lib/money/rate-band";
import { MATCHING_COMPONENTS } from "../../lib/matching/score";
import { OPEN_STAGES } from "../../lib/matching/run";
import {
  SLA_WINDOW_HOURS, ageLabel, formatExperience, freshnessFor, slaFor, type SlaState, istFormat } from "../../lib/derived";

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
      slaWindowHours: s.requirements.slaWindowHours,
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
    // The per-requirement window wins over the per-stage default, so a requirement keeps
    // the SLA state it was given instead of ageing out of it (migration 0002).
    const windowHours =
      r.slaWindowHours ??
      SLA_WINDOW_HOURS[r.stage as keyof typeof SLA_WINDOW_HOURS] ??
      SLA_WINDOW_HOURS.matching;
    const sla = slaFor(r.slaDueAt, windowHours, { paused });

    // Stage-specific label, all derived.
    let label = sla.label;
    let state: SlaState = sla.state;
    if (r.stage === "placed") {
      const eng = engBy.get(r.id);
      if (eng) {
        const pct = marginPct(eng.clientRatePaise, eng.vendorRatePaise);
        label = `Margin ${pct.toFixed(1)}%`;
        // Derived from marginBand() rather than re-testing the thresholds here. The
        // vocabulary differs (SLA states, not margin colours) but the cut points must
        // not: two copies of 25/18 drift the first time one is tuned.
        state = ({ green: "ok", amber: "warn", red: "late" } as const)[marginBand(pct)];
      } else { label = "Placed"; state = "ok"; }
    } else if (r.stage === "interviewing") {
      const fb = feedbackBy.get(r.id);
      const nx = nextInterviewBy.get(r.id);
      if (fb && !fb.outcome && fb.dueAt) {
        label = "Feedback due"; state = fb.dueAt.getTime() < Date.now() ? "late" : "warn";
      } else if (nx?.scheduledAt) {
        label = `R${nx.roundNo} on ${istFormat(nx.scheduledAt, { day: "2-digit", month: "short" })}`;
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
  /**
   * The raw paise as well as the labels, so the desk can show the margin changing as a
   * broker types a new rate — without parsing a formatted string back into a number, which
   * is the bug the Margin page's footer totals had.
   */
  vendorRatePaise: number;
  proposedClientRatePaise: number | null;
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
  /**
   * Set when a broker has priced this candidate by hand.
   *
   * Read from `audit_log` rather than a column on `matches`: the audit row is the durable
   * record a dispute is argued from, and keeping it there meant the rate control needed no
   * migration. `reason` is only ever filled in for a below-floor price, where it is
   * required.
   */
  rateSetBy: { name: string | null; reason: string | null } | null;
  /** True once the candidate has gone out on a shortlist, so the band is frozen (ADR-004). */
  rateLocked: boolean;
}

/**
 * The weighting panel's labels and percentages.
 *
 * Imported rather than declared: these lived here AND in the seed, and the scorer would
 * have made a third copy. One definition means a change cannot reach the bars on screen
 * without also reaching the arithmetic behind the total.
 */
const COMPONENTS = MATCHING_COMPONENTS;

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

  /**
   * OPS ONLY: how many people on this client's OWN organisation or declared group could
   * fill this requirement. Never shown to the client — it is the broker's cue that a
   * dual-role client is hiring into a gap its own group could fill, which is a commercial
   * conversation, not a shortlist.
   *
   * Issued here rather than at the point of use: it needs only `req.id`, so there is no
   * reason for it to queue behind the candidate and assessment queries. It is awaited at
   * the bottom of the function. Each Mumbai round trip costs ~60-70ms and this one now
   * overlaps the next two.
   */
  const ownBenchQuery = db.execute<{ own_bench_matches: number }>(sql`
    select own_bench_matches from ops_v_own_bench_matches where requirement_id = ${req.id}
  `);

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

  /**
   * Defence in depth. `matches` is gated by the trigger in migration 0004, so a
   * self-dealing or blocked row should not exist — but a row written BEFORE that
   * migration, or by a path that bypassed it, would still be sitting here. Refusing it on
   * read as well means a broker is never shown a candidate they must not send.
   *
   * Anything refused here is a defect, not a normal outcome, so it is counted and
   * surfaced rather than silently dropped.
   */
  const refusedIds = new Set<string>();
  if (rows.length) {
    // Parameterised, not string-built. Building SQL from values is a habit worth not
    // having even when the values are internal UUIDs.
    const refused = await db
      .select({ resourceId: s.benchResources.id })
      .from(s.benchResources)
      .where(and(
        inArray(s.benchResources.id, rows.map((r) => r.resourceId)),
        sql`(is_self_dealing(${s.benchResources.id}, ${req.id})
             or match_is_blocked(${s.benchResources.id}, ${req.id}))`,
      ));
    for (const r of refused) refusedIds.add(r.resourceId);
  }

  /**
   * Who has been priced by hand, and who can no longer be re-priced.
   *
   * Both read rather than stored. The note comes from `audit_log`, which is the durable
   * record a dispute is argued from — keeping it there meant the rate control needed no
   * migration. The lock comes from `shortlist_items`: once a candidate has gone out, ADR-004
   * freezes the band on that row, so the client holds a price derived from the old rate and
   * re-pricing them would leave the two screens disagreeing with nothing saying so.
   */
  const [rateAudit, quotedRows] = await Promise.all([
    db
      .select({ context: s.auditLog.context, occurredAt: s.auditLog.occurredAt })
      .from(s.auditLog)
      .where(and(
        eq(s.auditLog.entityId, req.id),
        eq(s.auditLog.action, "matching.rate_set"),
      ))
      .orderBy(desc(s.auditLog.occurredAt)),
    db
      .select({ maskedId: s.shortlistItems.maskedId })
      .from(s.shortlistItems)
      .innerJoin(s.shortlists, eq(s.shortlists.id, s.shortlistItems.shortlistId))
      .where(eq(s.shortlists.requirementId, req.id)),
  ]);

  // Newest first above, so the first entry per candidate is the one that stands.
  const rateNotes = new Map<string, { name: string | null; reason: string | null }>();
  for (const a of rateAudit) {
    const ctx = (a.context ?? {}) as Record<string, unknown>;
    const mid = typeof ctx.maskedId === "string" ? ctx.maskedId : null;
    if (!mid || rateNotes.has(mid)) continue;
    rateNotes.set(mid, {
      name: typeof ctx.setByName === "string" ? ctx.setByName : null,
      reason: typeof ctx.reason === "string" ? ctx.reason : null,
    });
  }
  const quotedIds = new Set(quotedRows.map((q) => q.maskedId));

  const candidates: OpsMatchCandidate[] = rows
    .filter((r) => !refusedIds.has(r.resourceId))
    .map((r, idx) => {
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
        ? `From ${istFormat(r.availableFrom, { day: "numeric", month: "short" })}`
        : r.noticePeriodDays === 0 ? "Immediate"
        : r.noticePeriodDays ? `${r.noticePeriodDays} days` : "Unknown",
      vendorRateLabel: formatPaiseExact(r.vendorRatePaise),
      proposedClientRateLabel: proposed ? formatPaiseExact(proposed) : "—",
      vendorRatePaise: r.vendorRatePaise,
      proposedClientRatePaise: proposed ?? null,
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
      rateSetBy: rateNotes.get(r.maskedId) ?? null,
      rateLocked: quotedIds.has(r.maskedId),
    };
  });

  // Started before the candidate queries (see the note where it is issued), awaited here.
  const [ownBench] = (await ownBenchQuery) as unknown as Array<{ own_bench_matches: number }>;

  return {
    ownBenchMatches: Number(ownBench?.own_bench_matches) || 0,
    refusedByRules: refusedIds.size,
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

/**
 * What the talent pool can be narrowed by.
 *
 * Every one of these is pushed into SQL. The previous version filtered `search` in memory
 * AFTER `.limit(60)`, so a search only ever looked at the first 60 rows of 1,284 and the
 * count beside it described the page rather than the result. A filter that narrows the rows
 * but leaves the count describing something else is worse than no filter.
 */
export interface PoolFilters {
  /**
   * ALL of these must be present. Picking "Java Spring Boot" and "Kafka" means someone who
   * has both — one EXISTS per skill — which is what a recruiter means by naming two.
   */
  skills?: string[];
  experienceBand?: "0-3" | "3-5" | "5-8" | "8+";
  /** Against the LATEST attempt, which is the score the table shows. */
  minScore?: number;
  city?: string;
  /** The employer's organisation name, as the EMPLOYER column shows it. */
  supplier?: string;
  maxRatePaise?: number;
  freshness?: "confirmed" | "expiring" | "unconfirmed";
  search?: string;
}

/** docs/DOMAIN.md's bands, in months. The upper bound is exclusive. */
const EXPERIENCE_BANDS: Record<string, [number, number | null]> = {
  "0-3": [0, 36], "3-5": [36, 60], "5-8": [60, 96], "8+": [96, null],
};

/**
 * Whole IST calendar days since a profile was last confirmed, as SQL.
 *
 * Deliberately the same arithmetic as `istCalendarDaysBetween`, which drives the pill in
 * the LAST CONFIRMED column: a date subtraction in IST, not elapsed hours. If this used
 * `now() - interval '10 days'` instead, a profile could sit under "Expiring" in the filter
 * while its own pill read "Confirmed" — the filter and the thing it filters disagreeing is
 * the one bug a filter must not have.
 */
const IST_DAYS_SINCE_CONFIRMED = sql`(
  (now() at time zone 'Asia/Kolkata')::date
  - (${sql.raw("bench_resources.last_confirmed_at")} at time zone 'Asia/Kolkata')::date
)`;

function poolConditions(f: PoolFilters) {
  const conds: Array<ReturnType<typeof eq> | ReturnType<typeof sql>> = [
    inArray(s.benchResources.status, ["listed", "in_process", "deployed"]),
  ];

  if (f.city) conds.push(eq(s.benchResources.baseCity, f.city));
  if (f.supplier) conds.push(eq(s.organizations.name, f.supplier));
  if (f.maxRatePaise) conds.push(lte(s.benchResources.vendorRatePaise, f.maxRatePaise));

  if (f.experienceBand && EXPERIENCE_BANDS[f.experienceBand]) {
    const [lo, hi] = EXPERIENCE_BANDS[f.experienceBand];
    conds.push(gte(s.benchResources.experienceMonths, lo));
    if (hi != null) conds.push(lt(s.benchResources.experienceMonths, hi));
  }

  // One EXISTS per skill, so the conditions AND together.
  for (const label of f.skills ?? []) {
    conds.push(sql`exists (
      select 1 from resource_skills rs
      join skills sk on sk.id = rs.skill_id
      where rs.resource_id = ${s.benchResources.id} and sk.label = ${label}
    )`);
  }

  if (f.minScore) {
    // Pinned to the highest attempt, which is the row the SCORE column displays. Without
    // that, someone whose first attempt scored 90 and whose retake scored 60 would pass a
    // "80+" filter and then show 60 in the table.
    conds.push(sql`exists (
      select 1 from assessments a
      where a.resource_id = ${s.benchResources.id}
        and a.overall_score >= ${f.minScore}
        and a.attempt_no = (
          select max(a2.attempt_no) from assessments a2 where a2.resource_id = ${s.benchResources.id}
        )
    )`);
  }

  if (f.freshness === "confirmed") {
    conds.push(sql`${s.benchResources.lastConfirmedAt} is not null and ${IST_DAYS_SINCE_CONFIRMED} < 10`);
  } else if (f.freshness === "expiring") {
    conds.push(sql`${s.benchResources.lastConfirmedAt} is not null
      and ${IST_DAYS_SINCE_CONFIRMED} >= 10 and ${IST_DAYS_SINCE_CONFIRMED} < 14`);
  } else if (f.freshness === "unconfirmed") {
    // PARENTHESISED on purpose. Without them, `and(...conds)` yields
    //   status in (...) and last_confirmed_at is null or days >= 14
    // and SQL precedence reads that as
    //   (status in (...) and last_confirmed_at is null) or (days >= 14)
    // so the second branch escapes the status filter and pulls in withdrawn and archived
    // profiles. It showed up as the three freshness buckets summing to one MORE than the
    // unfiltered count.
    conds.push(sql`(${s.benchResources.lastConfirmedAt} is null or ${IST_DAYS_SINCE_CONFIRMED} >= 14)`);
  }

  if (f.search) {
    const q = `%${f.search}%`;
    conds.push(sql`(
      ${s.benchResources.fullName} ilike ${q}
      or ${s.benchResources.maskedId} ilike ${q}
      or ${s.organizations.name} ilike ${q}
      or exists (
        select 1 from resource_skills rs
        join skills sk on sk.id = rs.skill_id
        where rs.resource_id = ${s.benchResources.id} and sk.label ilike ${q}
      )
    )`);
  }

  return conds;
}

/**
 * The values the filter chips offer.
 *
 * Read from the data rather than hardcoded, so a chip can never offer a city nobody is in
 * — the same mistake as the "Microservices" skill chip that the create endpoint silently
 * dropped because it was not in the catalogue.
 */
export async function getOpsPoolFacets() {
  const [cities, suppliers, skills] = await Promise.all([
    db.selectDistinct({ v: s.benchResources.baseCity })
      .from(s.benchResources)
      .where(inArray(s.benchResources.status, ["listed", "in_process", "deployed"]))
      .orderBy(asc(s.benchResources.baseCity)),
    db.selectDistinct({ v: s.organizations.name })
      .from(s.benchResources)
      .innerJoin(s.organizations, eq(s.organizations.id, s.benchResources.vendorOrgId))
      .orderBy(asc(s.organizations.name)),
    db.select({ v: s.skills.label, n: sql<number>`count(*)::int` })
      .from(s.resourceSkills)
      .innerJoin(s.skills, eq(s.skills.id, s.resourceSkills.skillId))
      .groupBy(s.skills.label)
      .orderBy(desc(sql`count(*)`))
      .limit(24),
  ]);
  return {
    cities: cities.map((r) => r.v),
    suppliers: suppliers.map((r) => r.v),
    skills: skills.map((r) => r.v),
  };
}

/**
 * This broker's saved pool filters.
 *
 * Scoped to the user, not the organisation: a saved view is a personal shortcut, and the
 * unique constraint is (user_id, screen, name). The org is on the row too, because a pool
 * filter can name a supplier — see the endpoint.
 */
export async function getOpsSavedViews(userId: string) {
  const rows = await db
    .select({ name: s.savedViews.name, filters: s.savedViews.filters })
    .from(s.savedViews)
    .where(and(eq(s.savedViews.userId, userId), eq(s.savedViews.screen, "ops.pool")))
    .orderBy(asc(s.savedViews.name));
  return rows.map((r) => ({ name: r.name, filters: (r.filters ?? {}) as PoolFilters }));
}

/* ====================================================================== */
/*  The roles somebody from the pool can be added to                       */
/* ====================================================================== */

export interface OpsOpenRequirement {
  code: string;
  roleTitle: string;
  clientName: string;
  /** How many people the client wants, which is what makes a role worth adding to. */
  positions: number;
  stage: string;
  experienceBand: string;
  budgetLabel: string;
  /** Already sourced for this role, so the picker can say "12 in the pool". */
  poolCount: number;
}

/**
 * The open roles, for "Add to a requirement" on the talent pool.
 *
 * `draft`, `placed`, `closed` and `cancelled` are deliberately absent. A draft has not been
 * committed to by the client yet, and the other three are finished -- a match row on any of
 * them is invisible work nobody will ever look at again. The endpoint enforces the same list
 * from `OPEN_STAGES`, because a stage can change between rendering this picker and using it.
 *
 * Ops-only: `clientName` appears here because the broker is the one party that sees both
 * sides. This must never be imported by a client or vendor read model (ADR-003).
 */
export async function getOpsOpenRequirements(): Promise<OpsOpenRequirement[]> {
  const rows = await db
    .select({
      code: s.requirements.code,
      roleTitle: s.requirements.roleTitle,
      clientName: s.organizations.name,
      positions: s.requirements.quantity,
      stage: s.requirements.stage,
      experienceBand: s.requirements.experienceBand,
      budgetMinPaise: s.requirements.budgetMinPaise,
      budgetMaxPaise: s.requirements.budgetMaxPaise,
      poolCount: sql<number>`(
        select count(*)::int from matches m where m.requirement_id = ${s.requirements.id}
      )`,
    })
    .from(s.requirements)
    .innerJoin(s.organizations, eq(s.organizations.id, s.requirements.clientOrgId))
    .where(inArray(s.requirements.stage, [...OPEN_STAGES]))
    // Newest first: a broker reaching for the pool is usually working a role that just came in.
    .orderBy(desc(sql`coalesce(${s.requirements.postedAt}, ${s.requirements.createdAt})`));

  return rows.map((r) => ({
    code: r.code,
    roleTitle: r.roleTitle,
    clientName: r.clientName,
    positions: r.positions,
    stage: r.stage,
    experienceBand: r.experienceBand,
    // Same shape as the pipeline: one rupee sign, an en dash, the short form.
    budgetLabel: `${formatPaiseShort(r.budgetMinPaise)}–${formatPaiseShort(r.budgetMaxPaise).replace("₹", "")}`,
    poolCount: r.poolCount,
  }));
}

export async function getOpsTalentPool(opts: PoolFilters & { limit?: number } = {}) {
  const started = Date.now();
  const limit = opts.limit ?? 60;
  const conds = poolConditions(opts);

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
    .where(and(...conds))
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

  const results = rows.map((r) => {
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

  /**
   * Two counts, and they mean different things.
   *
   * `matchCount` is how many rows the filters match across the whole exchange — counted in
   * the database with the same conditions and NO limit. `resultCount` is how many are on
   * screen. They were the same number before filters existed; conflating them now would
   * mean a filter that matched 300 people reported 60.
   */
  const [[{ n: matchCount }], [{ n: poolTotal }]] = await Promise.all([
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.benchResources)
      .innerJoin(s.organizations, eq(s.organizations.id, s.benchResources.vendorOrgId))
      .where(and(...conds)),
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.benchResources)
      .where(inArray(s.benchResources.status, ["listed", "in_process", "deployed"])),
  ]);

  return {
    results,
    // The UI advertises "62 results · 0.18s"; both are measured, not hardcoded.
    resultCount: results.length,
    matchCount,
    poolTotal,
    elapsedSeconds: ((Date.now() - started) / 1000).toFixed(2),
  };
}

/* ====================================================================== */
/*  Margin                                                                 */
/* ====================================================================== */

/**
 * The margin desk.
 *
 * **Live placements only** — `onboarding`, `active`, `ending`. It had no status filter at
 * all, so `ended` and `terminated` engagements still contributed to gross spread and
 * run-rate while `livePlacements` counted correctly: the headline money included work that
 * had finished. Latent while the fixtures had no ended rows, and wrong the first time one
 * ended.
 *
 * Filtering the WHOLE page rather than just the stats, so the footer totals are the sum of
 * the rows a reader can see. Totals that disagree with the visible rows are worse than
 * either number alone.
 *
 * There is no period scoping and the page no longer implies one. A margin desk answers
 * "what are we earning right now", which is what these monthly rates are.
 */
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
    .where(inArray(s.engagements.status, ["onboarding", "active", "ending"]))
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
      /**
       * The raw paise as well as the labels, so the page can sort and total on NUMBERS.
       *
       * It used to do neither: the footer parsed the labels back out with
       * `Number(label.replace(/[^\d]/g, "")) * 100`, which is right for "₹1,38,000" and
       * silently reads 138 rupees the day the formatter abbreviates to "₹1.38L". A
       * presentation string is not an input.
       */
      vendorRatePaise: r.vendorRatePaise,
      clientRatePaise: r.clientRatePaise,
      spreadPaise: spread,
      pctLabel: `${pct.toFixed(1)}%`,
      pct,
      band: marginBand(pct),
      status: r.status,
      startDate: r.startDate,
      exception: isBelowFloor(pct)
        ? { approverName: r.approverName, note: r.marginExceptionNote }
        : null,
    };
  });

  const suppliersTotal = rows.reduce((a, r) => a + r.vendorRatePaise, 0);
  const runRate = rows.reduce((a, r) => a + r.clientRatePaise, 0);
  const totalSpread = runRate - suppliersTotal;
  const avgMargin = enriched.length
    ? enriched.reduce((a, r) => a + r.pct, 0) / enriched.length
    : 0;

  return {
    stats: {
      grossSpreadLabel: formatPaiseShort(totalSpread),
      runRateLabel: formatPaiseShort(runRate),
      averageMarginLabel: `${avgMargin.toFixed(1)}%`,
      livePlacements: rows.length,
      belowFloorCount: enriched.filter((r) => isBelowFloor(r.pct)).length,
      /**
       * The three footer totals v2 asks for (SCREENS.md O4), so the page can be reconciled
       * against the CSV handed to finance. `weKeep` is the difference of the other two by
       * construction, never a separately summed figure that could disagree with them.
       */
      suppliersTotalLabel: formatPaiseExact(suppliersTotal),
      clientsTotalLabel: formatPaiseExact(runRate),
      weKeepLabel: formatPaiseExact(totalSpread),
    },
    rows: enriched,
    guardrail: {
      floorPct: MARGIN_FLOOR_PCT,
      targetPct: MARGIN_TARGET_PCT,
      breaches: enriched.filter((r) => isBelowFloor(r.pct)),
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
            ? `${a.overallScore} · ${a.completedAt ? istFormat(a.completedAt, { day: "2-digit", month: "short" }) : ""}`
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
      { label: `${dupes} duplicate flag${dupes === 1 ? "" : "s"} to clear`, dot: "var(--danger)" },
      { label: `${Number(c?.shortlisted) || 0} shortlists awaiting a client`, dot: "var(--brand)" },
      { label: `${Number(c?.matching) || 0} requirements in matching`, dot: "var(--t4)" },
    ],
    badges: {
      pipeline: Number(c?.total) || undefined,
      matching: Number(c?.matching) || undefined,
      duplicates: dupes || undefined,
    } as Record<string, string | number | undefined>,
  };
}


/* ====================================================================== */
/*  Organisation directory — OPS ONLY                                      */
/* ====================================================================== */

export interface OpsOrgRow {
  orgId: string;
  name: string;
  publicCode: string | null;
  /** "Both sides" | "Supplies" | "Hires" | "Broker" — derived from capabilities. */
  roleLabel: string;
  isDualRole: boolean;
  canSupply: boolean;
  canHire: boolean;
  groupName: string | null;
  /** Other members of the same declared group. Empty when ungrouped. */
  groupSiblings: string[];
  feeModel: string;
  feeModelLabel: string;
  /** Organisations hidden from this one, in either direction. */
  blockedWith: string[];
  /** Per-org money. A dual-role org is the only one where both sides are non-zero. */
  billedAsClientLabel: string;
  paidAsSupplierLabel: string;
  netPositionLabel: string;
  netPositionPaise: number;
  benchCount: number;
  openRequirements: number;
  placementsEver: number;
  probingSuspectRequirements: number;
  isProbingSuspect: boolean;
}

/**
 * Every organisation, with the facts ops needs to broker safely.
 *
 * OPS ONLY, and the reason is specific rather than cautious. Three fields here would each
 * be a masking breach on their own in another portal:
 *
 *   - `isDualRole` / capabilities. Telling a CLIENT that its supplier also hires, or a
 *     VENDOR that its buyer also supplies, narrows the counterparty to a handful of
 *     companies on an exchange this size.
 *   - `billedAsClient` beside `paidAsSupplier`. For a dual-role organisation these two
 *     numbers ARE the spread. This is the one screen in the product where they may sit
 *     together, because the audience is the broker — which is also why dual-role orgs are
 *     put on `flat_declared_fee`, so the spread is declared rather than inferable.
 *   - `blockedWith` and `probingSuspect`. A block is a commercial judgement about a
 *     counterparty, and a probing flag is an accusation. Neither party may see either.
 *
 * `v_org_probing_signals` is read rather than reimplemented: migration 0002 defines the
 * signal, and a second definition in TypeScript would drift from it.
 */
export async function getOpsOrgDirectory(): Promise<OpsOrgRow[]> {
  const rows = (await db.execute<{
    org_id: string; name: string; public_code: string | null; org_type: string;
    can_supply: boolean; can_hire: boolean; fee_model: string;
    group_name: string | null; bench_count: number;
    billed_as_client: string; paid_as_supplier: string;
    open_requirements: number; placements_ever: number; probing_suspect_requirements: number;
  }>(sql`
    select o.id                      as org_id,
           o.name,
           o.public_code,
           o.org_type::text           as org_type,
           c.can_supply,
           c.can_hire,
           o.fee_model::text          as fee_model,
           g.name                     as group_name,
           (select count(*) from bench_resources b
             where b.vendor_org_id = o.id)::int                         as bench_count,
           coalesce((select sum(e.client_rate_paise) from engagements e
             where e.client_org_id = o.id), 0)                          as billed_as_client,
           coalesce((select sum(e.vendor_rate_paise) from engagements e
             join bench_resources br on br.id = e.resource_id
            where br.vendor_org_id = o.id), 0)                          as paid_as_supplier,
           ps.open_requirements::int,
           ps.placements_ever::int,
           ps.probing_suspect_requirements::int
      from organizations o
      join org_capabilities c on c.org_id = o.id
      left join groups g on g.id = o.parent_group_id
      left join v_org_probing_signals ps on ps.org_id = o.id
     order by (c.can_supply and c.can_hire) desc, o.name
  `)) as unknown as Array<Record<string, unknown>>;

  const orgIds = rows.map((r) => String(r.org_id));

  // Group siblings and block pairs, two small queries rather than correlated subqueries
  // per row. Both are bidirectional lookups, so they are resolved in memory.
  const [groupRows, blockRows] = await Promise.all([
    db
      .select({
        orgId: s.organizations.id,
        groupId: s.organizations.parentGroupId,
        name: s.organizations.name,
      })
      .from(s.organizations)
      .where(sql`${s.organizations.parentGroupId} is not null`),
    db
      .select({
        orgId: s.orgBlocks.orgId,
        blockedOrgId: s.orgBlocks.blockedOrgId,
      })
      .from(s.orgBlocks),
  ]);

  const nameById = new Map<string, string>();
  const byGroup = new Map<string, string[]>();
  for (const g of groupRows) {
    nameById.set(g.orgId, g.name);
    if (g.groupId) byGroup.set(g.groupId, [...(byGroup.get(g.groupId) ?? []), g.orgId]);
  }
  const groupOf = new Map(groupRows.map((g) => [g.orgId, g.groupId]));

  // Names for everything a block can point at, including orgs outside the group set.
  const allNames = await db
    .select({ id: s.organizations.id, name: s.organizations.name })
    .from(s.organizations)
    .where(inArray(s.organizations.id, orgIds));
  for (const n of allNames) nameById.set(n.id, n.name);

  const blockedWith = new Map<string, string[]>();
  for (const b of blockRows) {
    // Both directions: one row hides each organisation from the other.
    blockedWith.set(b.orgId, [...(blockedWith.get(b.orgId) ?? []), nameById.get(b.blockedOrgId) ?? "—"]);
    blockedWith.set(b.blockedOrgId, [...(blockedWith.get(b.blockedOrgId) ?? []), nameById.get(b.orgId) ?? "—"]);
  }

  return rows.map((r) => {
    const orgId = String(r.org_id);
    const canSupply = Boolean(r.can_supply);
    const canHire = Boolean(r.can_hire);
    const isBroker = String(r.org_type) === "talentvibes";
    const billed = Number(r.billed_as_client) || 0;
    const paid = Number(r.paid_as_supplier) || 0;

    const gid = groupOf.get(orgId) ?? null;
    const siblings = gid
      ? (byGroup.get(gid) ?? []).filter((id) => id !== orgId).map((id) => nameById.get(id) ?? "—")
      : [];

    const open = Number(r.open_requirements) || 0;
    const placements = Number(r.placements_ever) || 0;
    const suspect = Number(r.probing_suspect_requirements) || 0;

    return {
      orgId,
      name: String(r.name),
      publicCode: (r.public_code as string | null) ?? null,
      roleLabel: isBroker ? "Broker"
        : canSupply && canHire ? "Both sides"
        : canSupply ? "Supplies" : canHire ? "Hires" : "—",
      isDualRole: canSupply && canHire,
      canSupply,
      canHire,
      groupName: (r.group_name as string | null) ?? null,
      groupSiblings: siblings,
      feeModel: String(r.fee_model),
      // The broker is not a party to the exchange, so it has no fee model to show. The
      // column carries the table default for it; that is storage, not meaning.
      feeModelLabel: isBroker ? "—"
        : String(r.fee_model) === "flat_declared_fee" ? "Flat declared fee" : "Hidden markup",
      blockedWith: blockedWith.get(orgId) ?? [],
      billedAsClientLabel: billed ? formatPaiseShort(billed) : "—",
      paidAsSupplierLabel: paid ? formatPaiseShort(paid) : "—",
      netPositionLabel: billed || paid ? formatPaiseShort(billed - paid) : "—",
      netPositionPaise: billed - paid,
      benchCount: Number(r.bench_count) || 0,
      openRequirements: open,
      placementsEver: placements,
      probingSuspectRequirements: suspect,
      /**
       * Only the view's own signal. `v_requirement_probing` defines a suspect as a
       * requirement that received a shortlist and never an interview request after five
       * days; `v_org_probing_signals` counts those per organisation.
       *
       * An earlier draft also flagged `open >= 3 && placements === 0`. That threshold
       * appears nowhere in the spec — it was invented here, which CLAUDE.md working
       * agreement 8 forbids doing silently. `openRequirements` and `placementsEver` are
       * returned alongside so ops can apply its own judgement, which is exactly what the
       * view's comment advises, rather than having a number guess for them.
       */
      isProbingSuspect: suspect > 0,
    };
  });
}
