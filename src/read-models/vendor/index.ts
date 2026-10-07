/**
 * VENDOR read models. ADR-003: unrelated to the client and ops types, no shared base.
 * Nothing in this file may import from ../client or ../ops.
 *
 * Forbidden here, per docs/MASKING.md — if you are about to add one of these, stop:
 *   client identity · client rate · client budget band · the client's note on a
 *   requirement · margin or spread · interview panel names · verbatim client feedback
 *   duplicate flags · any other vendor's resources
 *
 * Every query in this file is scoped to the caller's own vendorOrgId. The vendor's
 * earnings path reads only `direction = 'payable'` invoices and is structurally unable
 * to join the receivable side.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import * as s from "../../db/schema";
import { formatPaiseExact, formatPaiseShort } from "../../lib/money/paise";
import { formatExperience, freshnessFor } from "../../lib/derived";

export interface VendorRosterResource {
  maskedId: string;
  fullName: string;        // own record, so permitted
  employeeCode: string | null;
  baseCity: string;
  experienceLabel: string;
  skills: string[];
  vendorRateLabel: string; // own cost, so permitted
  status: string;
  assessment: { status: string; overall: number | null; testedOn: string | null; track: string | null };
  freshness: { state: string; label: string; decayBarWidthPct: number; days: number };
}

/* ------------------------------------------------------------------ roster */

export async function getVendorRoster(
  vendorOrgId: string,
  filter: "all" | "listed" | "in_process" | "expiring" | "unconfirmed" = "all",
) {
  const rows = await db
    .select({
      id: s.benchResources.id,
      maskedId: s.benchResources.maskedId,
      fullName: s.benchResources.fullName,
      employeeCode: s.benchResources.employeeCode,
      baseCity: s.benchResources.baseCity,
      experienceMonths: s.benchResources.experienceMonths,
      vendorRatePaise: s.benchResources.vendorRatePaise,
      status: s.benchResources.status,
      lastConfirmedAt: s.benchResources.lastConfirmedAt,
    })
    .from(s.benchResources)
    .where(eq(s.benchResources.vendorOrgId, vendorOrgId)) // tenancy: own rows only
    .orderBy(desc(s.benchResources.listedAt));

  const ids = rows.map((r) => r.id);
  const skillRows = ids.length
    ? await db
        .select({
          resourceId: s.resourceSkills.resourceId,
          label: s.skills.label,
          isPrimary: s.resourceSkills.isPrimary,
        })
        .from(s.resourceSkills)
        .innerJoin(s.skills, eq(s.skills.id, s.resourceSkills.skillId))
        .where(inArray(s.resourceSkills.resourceId, ids))
    : [];

  const assessRows = ids.length
    ? await db
        .select({
          resourceId: s.assessments.resourceId,
          status: s.assessments.status,
          overallScore: s.assessments.overallScore,
          completedAt: s.assessments.completedAt,
          track: s.assessments.track,
          attemptNo: s.assessments.attemptNo,
        })
        .from(s.assessments)
        .where(inArray(s.assessments.resourceId, ids))
        .orderBy(desc(s.assessments.attemptNo))
    : [];

  const skillsBy = new Map<string, string[]>();
  for (const r of skillRows) {
    const list = skillsBy.get(r.resourceId) ?? [];
    if (r.isPrimary) list.unshift(r.label); else list.push(r.label);
    skillsBy.set(r.resourceId, list);
  }
  const assessBy = new Map<string, (typeof assessRows)[number]>();
  for (const a of assessRows) if (!assessBy.has(a.resourceId)) assessBy.set(a.resourceId, a);

  const all: VendorRosterResource[] = rows.map((r) => {
    const f = freshnessFor(r.lastConfirmedAt);
    const a = assessBy.get(r.id);
    return {
      maskedId: r.maskedId,
      fullName: r.fullName,
      employeeCode: r.employeeCode,
      baseCity: r.baseCity,
      experienceLabel: formatExperience(r.experienceMonths),
      skills: skillsBy.get(r.id) ?? [],
      vendorRateLabel: formatPaiseExact(r.vendorRatePaise),
      status: r.status,
      assessment: {
        status: a?.status ?? "not_started",
        overall: a?.overallScore ?? null,
        testedOn: a?.completedAt?.toISOString().slice(0, 10) ?? null,
        track: a?.track ?? null,
      },
      freshness: {
        state: f.state, label: f.label,
        decayBarWidthPct: Math.round(f.decayBarWidthPct),
        days: Number.isFinite(f.days) ? f.days : 99,
      },
    };
  });

  const filtered = all.filter((r) => {
    switch (filter) {
      case "listed": return r.status === "listed";
      case "in_process": return r.status === "in_process";
      case "expiring": return r.freshness.state === "expiring_soon";
      case "unconfirmed": return r.freshness.state === "unconfirmed";
      default: return true;
    }
  });

  // The five filter states the design shows, as derived counts.
  const counts = {
    all: all.length,
    listed: all.filter((r) => r.status === "listed").length,
    in_process: all.filter((r) => r.status === "in_process").length,
    expiring: all.filter((r) => r.freshness.state === "expiring_soon").length,
    unconfirmed: all.filter((r) => r.freshness.state === "unconfirmed").length,
  };

  return { resources: filtered, counts, total: all.length };
}

/* --------------------------------------------------------------- dashboard */

export async function getVendorOverview(vendorOrgId: string, viewerName: string) {
  /**
   * Five independent reads, issued together rather than one after another.
   *
   * Each round trip to the Mumbai database costs roughly 60-70ms, so six sequential
   * queries spent ~440ms almost entirely on waiting. Nothing here depends on anything
   * else here, so the latency is the slowest query rather than the sum.
   *
   * Concurrency is safe now in a way it was not earlier in the project: the pool ran at
   * `max: 1` at the time, where a fan-out deadlocked against Supavisor's transaction mode
   * and took /ops down. The pool is `max: 10` (see src/db/client.ts) and a two-way
   * Promise.all is already in use on ten pages. Five is still well inside the pool.
   *
   * `pipeline` -> `pipelineSkills` stays sequential below, because the second needs the
   * resource ids the first returns.
   */
  const [[org], [profile], counts, pipeline, [payable]] = await Promise.all([
    db
      .select({ name: s.organizations.name, publicCode: s.organizations.publicCode })
      .from(s.organizations)
      .where(eq(s.organizations.id, vendorOrgId))
      .limit(1),

    db
      .select({
        reliabilityScore: s.vendorProfiles.reliabilityScore,
        placementsCount: s.vendorProfiles.placementsCount,
      })
      .from(s.vendorProfiles)
      .where(eq(s.vendorProfiles.orgId, vendorOrgId))
      .limit(1),

    // Counts only — the dashboard renders integers, not rows. See getVendorRosterCounts.
    getVendorRosterCounts(vendorOrgId),

    // The vendor's own pipeline: its resources that are on a shortlist or in interview.
    // Joined via shortlist_items, so no requirement or client column is reachable here.
    db
      .select({
        resourceId: s.benchResources.id,
        maskedId: s.benchResources.maskedId,
        fullName: s.benchResources.fullName,
        vendorRatePaise: s.benchResources.vendorRatePaise,
        decision: s.shortlistItems.clientDecision,
        updatedAt: s.shortlistItems.updatedAt,
        interviewStatus: s.interviews.status,
        roundNo: s.interviews.roundNo,
      })
      .from(s.shortlistItems)
      .innerJoin(s.benchResources, eq(s.benchResources.id, s.shortlistItems.resourceId))
      .leftJoin(s.interviews, eq(s.interviews.shortlistItemId, s.shortlistItems.id))
      .where(eq(s.benchResources.vendorOrgId, vendorOrgId))
      .orderBy(desc(s.shortlistItems.updatedAt))
      .limit(10),

    // Earnings: PAYABLE invoices only. There is no path from here to a receivable row.
    db
      .select({ total: sql<number>`coalesce(sum(${s.invoices.totalPaise}), 0)::bigint` })
      .from(s.invoices)
      .where(and(
        eq(s.invoices.counterpartyOrgId, vendorOrgId),
        eq(s.invoices.direction, "payable"),
      )),
  ]);

  const utilisation = counts.total
    ? Math.round(((counts.listed + counts.inProcess) / counts.total) * 100)
    : 0;

  // Skills for the pipeline rows. The dashboard previously rendered a literal dash here.
  const pipelineIds = [...new Set(pipeline.map((p) => p.resourceId))];
  const pipelineSkills = pipelineIds.length
    ? await db
        .select({
          resourceId: s.resourceSkills.resourceId,
          label: s.skills.label,
          isPrimary: s.resourceSkills.isPrimary,
        })
        .from(s.resourceSkills)
        .innerJoin(s.skills, eq(s.skills.id, s.resourceSkills.skillId))
        .where(inArray(s.resourceSkills.resourceId, pipelineIds))
    : [];
  const pipelineSkillsBy = new Map<string, string[]>();
  for (const r of pipelineSkills) {
    const list = pipelineSkillsBy.get(r.resourceId) ?? [];
    if (r.isPrimary) list.unshift(r.label); else list.push(r.label);
    pipelineSkillsBy.set(r.resourceId, list);
  }

  return {
    viewerName: viewerName.split(" ")[0],
    orgName: org?.name ?? "",
    vendorCode: org?.publicCode ?? "",
    reliability: profile?.reliabilityScore ?? "0.0",
    placements: profile?.placementsCount ?? 0,
    stats: {
      listed: counts.listed,
      onBench: counts.total,
      inProcess: counts.inProcess,
      utilisationPct: utilisation,
      billedThisMonthLabel: formatPaiseShort(Number(payable?.total ?? 0)),
    },
    freshness: [
      { label: "Confirmed", n: counts.total - counts.expiring - counts.unconfirmed },
      { label: "Expiring", n: counts.expiring },
      { label: "Unconfirmed", n: counts.unconfirmed },
    ],
    pipeline: pipeline.map((p) => ({
      maskedId: p.maskedId,
      displayName: shortenName(p.fullName),
      skills: pipelineSkillsBy.get(p.resourceId) ?? [],
      rateLabel: formatPaiseExact(p.vendorRatePaise),
      stageLabel: p.interviewStatus
        ? `INTERVIEW R${p.roundNo}`
        : p.decision === "selected" ? "CLIENT SELECTED"
        : p.decision === "passed" ? "PASSED" : "SHORTLISTED",
      updatedAgo: p.updatedAt ? relativeAgo(p.updatedAt) : "—",
    })),
    alerts: [
      { label: `${counts.expiring} profiles expire within 4 days`, severity: "warn" as const },
      { label: `${counts.unconfirmed} unconfirmed over 14 days`, severity: "high" as const },
      { label: `${counts.pendingTests} assessments pending`, severity: "info" as const },
    ],
  };
}

/* ------------------------------------------------------------- assessments */

export async function getVendorAssessments(vendorOrgId: string) {
  const rows = await db
    .select({
      maskedId: s.benchResources.maskedId,
      fullName: s.benchResources.fullName,
      status: s.assessments.status,
      overallScore: s.assessments.overallScore,
      scoreCoding: s.assessments.scoreCoding,
      scoreDsa: s.assessments.scoreDsa,
      scoreSystemDesign: s.assessments.scoreSystemDesign,
      scoreCommunication: s.assessments.scoreCommunication,
      completedAt: s.assessments.completedAt,
      validUntil: s.assessments.validUntil,
      track: s.assessments.track,
      attemptNo: s.assessments.attemptNo,
      invitedAt: s.assessments.invitedAt,
    })
    .from(s.assessments)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.assessments.resourceId))
    .where(eq(s.benchResources.vendorOrgId, vendorOrgId))
    .orderBy(desc(s.assessments.completedAt));

  const summary = {
    scored: rows.filter((r) => r.status === "scored").length,
    inProgress: rows.filter((r) => r.status === "in_progress" || r.status === "invited").length,
    notStarted: rows.filter((r) => r.status === "not_started").length,
    expired: rows.filter((r) => r.status === "expired").length,
  };

  return {
    summary,
    // There is no write path to a score column from any vendor endpoint (ADR-006).
    scoresAreReadOnly: true,
    cards: rows.slice(0, 24).map((r) => ({
      maskedId: r.maskedId,
      fullName: r.fullName,
      track: r.track,
      status: r.status,
      overall: r.overallScore,
      sections: {
        coding: r.scoreCoding, dsa: r.scoreDsa,
        systemDesign: r.scoreSystemDesign, communication: r.scoreCommunication,
      },
      testedOn: r.completedAt?.toISOString().slice(0, 10) ?? null,
      validUntil: r.validUntil?.toISOString().slice(0, 10) ?? null,
      attemptNo: r.attemptNo,
    })),
  };
}

/* ---------------------------------------------------------------- earnings */

/**
 * Own rate only. This function selects from `invoices` filtered to
 * `direction = 'payable'` and from `engagements.vendor_rate_paise`. It never selects
 * `client_rate_paise`, so no spread is reconstructible from its output.
 */
export async function getVendorEarnings(vendorOrgId: string) {
  const rows = await db
    .select({
      maskedId: s.benchResources.maskedId,
      fullName: s.benchResources.fullName,
      roleTitle: s.engagements.roleTitle,
      startDate: s.engagements.startDate,
      status: s.engagements.status,
      vendorRatePaise: s.engagements.vendorRatePaise, // own cost
      engagementId: s.engagements.id,
    })
    .from(s.engagements)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.engagements.resourceId))
    .where(eq(s.engagements.vendorOrgId, vendorOrgId))
    .orderBy(desc(s.engagements.startDate));

  const lines = rows.length
    ? await db
        .select({
          engagementId: s.invoiceLines.engagementId,
          amountPaise: s.invoiceLines.amountPaise,
          isProrata: s.invoiceLines.isProrata,
        })
        .from(s.invoiceLines)
        .innerJoin(s.invoices, eq(s.invoices.id, s.invoiceLines.invoiceId))
        .where(and(
          eq(s.invoices.counterpartyOrgId, vendorOrgId),
          eq(s.invoices.direction, "payable"), // the structural guard
        ))
    : [];

  const lineBy = new Map(lines.map((l) => [l.engagementId, l]));
  const billed = lines.reduce((a, l) => a + l.amountPaise, 0);

  return {
    stats: {
      billedThisMonthLabel: formatPaiseShort(billed),
      activePlacements: rows.filter((r) => r.status === "active" || r.status === "onboarding").length,
      runRateLabel: formatPaiseShort(rows.reduce((a, r) => a + r.vendorRatePaise, 0)),
    },
    rows: rows.map((r) => {
      const l = lineBy.get(r.engagementId);
      return {
        maskedId: r.maskedId,
        fullName: r.fullName,
        roleTitle: r.roleTitle,
        since: r.startDate,
        rateLabel: formatPaiseExact(r.vendorRatePaise),
        monthLabel: l ? formatPaiseExact(l.amountPaise) : formatPaiseExact(r.vendorRatePaise),
        status: l?.isProrata ? "PRO-RATA" : "BILLED",
      };
    }),
    // The copy the design shows. Client identity is never shared (open question Q1,
    // safer default: never).
    disclosure: "Client identity is not shared. Talentvibes contracts with the client directly.",
  };
}

/* ----------------------------------------------------------- bulk imports */

export async function getVendorImports(vendorOrgId: string) {
  const [imp] = await db
    .select({
      id: s.bulkImports.id,
      filename: s.bulkImports.filename,
      rowsTotal: s.bulkImports.rowsTotal,
      rowsListed: s.bulkImports.rowsListed,
      rowsNeedsReview: s.bulkImports.rowsNeedsReview,
      status: s.bulkImports.status,
      createdAt: s.bulkImports.createdAt,
    })
    .from(s.bulkImports)
    .where(eq(s.bulkImports.vendorOrgId, vendorOrgId))
    .orderBy(desc(s.bulkImports.createdAt))
    .limit(1);

  if (!imp) return null;

  const rows = await db
    .select({
      rowNumber: s.bulkImportRows.rowNumber,
      raw: s.bulkImportRows.raw,
      errors: s.bulkImportRows.errors,
      resolution: s.bulkImportRows.resolution,
    })
    .from(s.bulkImportRows)
    .where(eq(s.bulkImportRows.importId, imp.id))
    .orderBy(asc(s.bulkImportRows.rowNumber));

  return {
    filename: imp.filename,
    status: imp.status,
    uploadedAgo: relativeAgo(imp.createdAt),
    summary: [
      { label: "Rows imported", n: imp.rowsTotal },
      { label: "Listed automatically", n: imp.rowsListed },
      { label: "Need review", n: imp.rowsNeedsReview },
    ],
    // The duplicate_of pointer is deliberately NOT exposed: telling a vendor which
    // resource it duplicates would name another vendor's submission.
    reviewRows: rows.map((r) => ({
      rowNumber: r.rowNumber,
      name: (r.raw as Record<string, string>).name ?? "",
      employeeCode: (r.raw as Record<string, string>).emp_id ?? "",
      skills: (r.raw as Record<string, string>).skills ?? "",
      issue: (r.errors ?? []).includes("missing_rate")
        ? "Rate missing"
        : "Already represented on the exchange",
      resolution: r.resolution,
    })),
  };
}

/* ----------------------------------------------------------------- utils */

function shortenName(full: string): string {
  const parts = full.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
}

function relativeAgo(d: Date): string {
  const hours = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ====================================================================== */
/*  Roster counts — one aggregate, shared                                  */
/* ====================================================================== */

/**
 * The roster's five filter counts plus the pending-test figure, as a single query.
 *
 * Two screens need these numbers and neither needs the rows behind them: the sidebar
 * badges and the dashboard KPI/freshness blocks. Both used to call getVendorRoster(),
 * which loads every resource plus its skills and assessments (173 rows for a 42-person
 * bench) and shapes 42 view objects, to display a handful of integers.
 *
 * It lives in one function rather than two because the two call sites had drifted: the
 * sidebar counted assessment ROWS that were not scored, the dashboard counted RESOURCES
 * with no scored assessment. They happened to agree on the current data (13 and 13) but
 * would diverge the moment someone retakes a test — a second pending attempt against an
 * already-scored first one. The resource-based definition is the one the label means
 * ("13 assessments pending" = 13 people still waiting on a result), so that is the one
 * kept here, and there is now no second definition to drift from.
 *
 * Freshness is derived in SQL from last_confirmed_at using the same 10-and-14-day
 * thresholds as freshnessFor(). Still derived on read — docs/DOMAIN.md forbids STORING
 * it, not computing it in a query. The two implementations agree exactly, including on a
 * null last_confirmed_at and on both boundaries, because floor(x) >= 10 iff x >= 10. If
 * those thresholds ever change they must change in both places; that duplication is the
 * price of one round trip instead of 173 rows, and it is called out so it is not a trap.
 */
export async function getVendorRosterCounts(vendorOrgId: string) {
  const rows = (await db.execute(sql`
    select
      count(*)::int as total,
      count(*) filter (where status = 'listed')::int     as listed,
      count(*) filter (where status = 'in_process')::int as in_process,
      count(*) filter (where last_confirmed_at is not null
                         and now() - last_confirmed_at >= interval '10 days'
                         and now() - last_confirmed_at <  interval '14 days')::int as expiring,
      count(*) filter (where last_confirmed_at is null
                          or now() - last_confirmed_at >= interval '14 days')::int as unconfirmed,
      count(*) filter (where not exists (
        select 1 from assessments a
         where a.resource_id = bench_resources.id and a.status = 'scored'
      ))::int as pending_tests
    from bench_resources
    where vendor_org_id = ${vendorOrgId}
  `)) as unknown as Array<{
    total: number; listed: number; in_process: number;
    expiring: number; unconfirmed: number; pending_tests: number;
  }>;
  const c = rows[0];

  return {
    total: Number(c?.total) || 0,
    listed: Number(c?.listed) || 0,
    inProcess: Number(c?.in_process) || 0,
    expiring: Number(c?.expiring) || 0,
    unconfirmed: Number(c?.unconfirmed) || 0,
    pendingTests: Number(c?.pending_tests) || 0,
  };
}

/* ====================================================================== */
/*  Sidebar — deliberately cheap                                           */
/* ====================================================================== */

/**
 * Badge counts and freshness alerts for the vendor sidebar.
 *
 * Replaces a call to getVendorRoster(), which loaded all 132 resources plus their skills
 * and assessments to produce three numbers — and which the roster page then loaded again.
 *
 * Freshness is derived in the SQL expression from last_confirmed_at, using the same
 * 10-and-14-day thresholds as freshnessFor(). It is still derived on read; docs/DOMAIN.md
 * forbids STORING it, not computing it in a query. If those thresholds change, change
 * them in both places — that duplication is the price of one round trip instead of 130
 * rows, and it is called out here so it is not a silent trap.
 */
export async function getVendorSidebar(vendorOrgId: string) {
  const c = await getVendorRosterCounts(vendorOrgId);

  return {
    items: [
      { label: `${c.expiring} profiles expire within 4 days`, dot: "var(--warn)" },
      { label: `${c.unconfirmed} unconfirmed over 14 days`, dot: "var(--danger)" },
      { label: `${c.pendingTests} assessments pending`, dot: "var(--t4)" },
    ],
    badges: {
      roster: c.total || undefined,
      assessments: c.pendingTests || undefined,
    } as Record<string, string | number | undefined>,
  };
}


/* ====================================================================== */
/*  Broker thread — the vendor's own side, and only its own side           */
/* ====================================================================== */

export interface VendorBrokerMessage {
  body: string;
  senderSide: "vendor" | "ops";
  sentAt: string;
  senderName: string;
}

export interface VendorBrokerThread {
  scopeLabel: string;
  brokerName: string;
  messages: VendorBrokerMessage[];
}

/**
 * The vendor's conversation with its broker.
 *
 * `side = 'vendor'` is not a tidy-up, it is the discriminator that keeps a DUAL-ROLE
 * organisation's two conversations apart. For every other organisation
 * `counterparty_org_id` alone identifies the thread — but a company that both supplies and
 * hires has two threads carrying the SAME counterparty id. Filtering on the organisation
 * only would return both and mix them, putting messages about the roles it is trying to
 * fill into its bench workspace.
 *
 * What this cannot return, structurally: there is no client column on `broker_threads`
 * reachable from here, and `redaction_note` — the record of what ops stripped out of a
 * relayed message — is never selected. A vendor reading the note would read the thing that
 * was removed.
 */
export async function getVendorBrokerThread(
  vendorOrgId: string,
): Promise<VendorBrokerThread | null> {
  const [thread] = await db
    .select({
      id: s.brokerThreads.id,
      scopeLabel: s.brokerThreads.scopeLabel,
      brokerName: s.users.fullName,
    })
    .from(s.brokerThreads)
    .innerJoin(s.users, eq(s.users.id, s.brokerThreads.brokerUserId))
    .where(and(
      eq(s.brokerThreads.counterpartyOrgId, vendorOrgId),
      // A vendor can only ever read its own side. See the note above.
      eq(s.brokerThreads.side, "vendor"),
    ))
    .orderBy(desc(s.brokerThreads.lastMessageAt))
    .limit(1);

  if (!thread) return null;

  const messages = await db
    .select({
      body: s.brokerMessages.body,
      senderSide: s.brokerMessages.senderSide,
      sentAt: s.brokerMessages.sentAt,
      senderName: s.users.fullName,
    })
    .from(s.brokerMessages)
    .innerJoin(s.users, eq(s.users.id, s.brokerMessages.senderUserId))
    .where(eq(s.brokerMessages.threadId, thread.id))
    .orderBy(asc(s.brokerMessages.sentAt));

  return {
    scopeLabel: thread.scopeLabel,
    brokerName: thread.brokerName,
    messages: messages
      // A vendor-side thread should only ever carry vendor and ops messages. Filtering
      // rather than trusting the data keeps a mis-seeded or mis-written row from leaking a
      // client's words into the vendor's view.
      .filter((m) => m.senderSide === "vendor" || m.senderSide === "ops")
      .map((m) => ({
        body: m.body,
        senderSide: m.senderSide as "vendor" | "ops",
        sentAt: m.sentAt.toISOString(),
        senderName: m.senderName,
      })),
  };
}
