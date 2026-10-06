/**
 * CLIENT read models. ADR-003: these types are unrelated to the vendor and ops ones and
 * share no base interface. Nothing in this file may import from ../vendor or ../ops.
 *
 * Forbidden here, per docs/MASKING.md — if you are about to add one of these, stop:
 *   candidate name/photo/contact/CV/employers · vendor identity · vendor reliability
 *   vendor rate · margin or spread · freshness state · duplicate flags · exact rates on
 *   a masked card · created_at on a candidate record (bulk-upload timing side channel)
 *
 * A client sees availability, not freshness. "Unconfirmed 26d" tells a client that a
 * supplier is slow, which is supplier information.
 */
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { db } from "../../db/client";
import * as s from "../../db/schema";
import { formatPaiseShort } from "../../lib/money/paise";
import { formatExperience } from "../../lib/derived";

/* ------------------------------------------------------------------ types */

export interface ClientMaskedCandidate {
  maskedId: string;
  position: number;
  experienceLabel: string;
  baseCity: string;
  skills: string[];
  scoreOverall: number | null;
  sections: { coding: number | null; dsa: number | null; systemDesign: number | null; communication: number | null };
  attemptNo: number | null;
  testedOn: string | null;
  availabilityLabel: string;
  /** A coarse band derived from the client price (ADR-004). Never an exact figure. */
  rateBandLabel: string;
  decision: "pending" | "selected" | "passed";
}

export interface ClientShortlistView {
  requirementCode: string;
  roleTitle: string;
  quantity: number;
  sentAt: string;
  brokerNote: string | null;
  brokerName: string;
  candidates: ClientMaskedCandidate[];
  selectedCount: number;
}

export interface ClientRequirementSummary {
  code: string;
  roleTitle: string;
  quantity: number;
  experienceBand: string;
  locationLabel: string;
  startDate: string | null;
  budgetLabel: string;
  stage: string;
  shortlistCount: number;
}

/* ------------------------------------------------------------- hero path */

/**
 * The masked shortlist. Reads ONLY from shortlist_items — never from matches or
 * bench_resources (ADR-009). That is a structural guarantee, not a filter: the
 * snapshot table has no vendor column and no vendor rate column to leak.
 *
 * resource_id exists on the row as a join key and is deliberately not selected.
 */
export async function getClientShortlist(
  clientOrgId: string,
  requirementCode: string,
): Promise<ClientShortlistView | null> {
  const [req] = await db
    .select({
      id: s.requirements.id,
      code: s.requirements.code,
      roleTitle: s.requirements.roleTitle,
      quantity: s.requirements.quantity,
    })
    .from(s.requirements)
    .where(and(
      eq(s.requirements.code, requirementCode),
      eq(s.requirements.clientOrgId, clientOrgId), // tenancy check
    ))
    .limit(1);

  if (!req) return null;

  const [shortlist] = await db
    .select({
      id: s.shortlists.id,
      sentAt: s.shortlists.sentAt,
      brokerNote: s.shortlists.brokerNote,
      brokerName: s.users.fullName,
    })
    .from(s.shortlists)
    .innerJoin(s.users, eq(s.users.id, s.shortlists.sentBy))
    .where(eq(s.shortlists.requirementId, req.id))
    .orderBy(desc(s.shortlists.sequenceNo))
    .limit(1);

  if (!shortlist) return null;

  // Named columns only. No SELECT *, so a new sensitive column cannot appear here.
  const items = await db
    .select({
      maskedId: s.shortlistItems.maskedId,
      position: s.shortlistItems.position,
      experienceMonths: s.shortlistItems.experienceMonths,
      baseCity: s.shortlistItems.baseCity,
      skillsSnapshot: s.shortlistItems.skillsSnapshot,
      scoreOverall: s.shortlistItems.scoreOverall,
      scoreCoding: s.shortlistItems.scoreCoding,
      scoreDsa: s.shortlistItems.scoreDsa,
      scoreSystemDesign: s.shortlistItems.scoreSystemDesign,
      scoreCommunication: s.shortlistItems.scoreCommunication,
      assessmentAttemptNo: s.shortlistItems.assessmentAttemptNo,
      assessmentTestedOn: s.shortlistItems.assessmentTestedOn,
      availabilityLabel: s.shortlistItems.availabilityLabel,
      rateBandMinPaise: s.shortlistItems.rateBandMinPaise,
      rateBandMaxPaise: s.shortlistItems.rateBandMaxPaise,
      clientDecision: s.shortlistItems.clientDecision,
    })
    .from(s.shortlistItems)
    .where(eq(s.shortlistItems.shortlistId, shortlist.id))
    // Explicit order. Never insertion order or id — grouping by vendor would leak
    // vendor clusters (docs/MASKING.md, side channels).
    .orderBy(asc(s.shortlistItems.position));

  const candidates: ClientMaskedCandidate[] = items.map((i) => ({
    maskedId: i.maskedId,
    position: i.position,
    experienceLabel: formatExperience(i.experienceMonths),
    baseCity: i.baseCity,
    skills: i.skillsSnapshot,
    scoreOverall: i.scoreOverall,
    sections: {
      coding: i.scoreCoding, dsa: i.scoreDsa,
      systemDesign: i.scoreSystemDesign, communication: i.scoreCommunication,
    },
    attemptNo: i.assessmentAttemptNo,
    testedOn: i.assessmentTestedOn,
    availabilityLabel: i.availabilityLabel,
    rateBandLabel: `${formatPaiseShort(i.rateBandMinPaise)}–${formatPaiseShort(i.rateBandMaxPaise).replace("₹", "")}`,
    decision: i.clientDecision,
  }));

  return {
    requirementCode: req.code,
    roleTitle: req.roleTitle,
    quantity: req.quantity,
    sentAt: shortlist.sentAt.toISOString(),
    brokerNote: shortlist.brokerNote,
    brokerName: shortlist.brokerName,
    candidates,
    selectedCount: candidates.filter((c) => c.decision === "selected").length,
  };
}

/* ------------------------------------------------------------- dashboard */

export interface ClientOverview {
  greetingName: string;
  orgName: string;
  brokerName: string;
  stats: { openRequirements: number; positions: number; awaitingReview: number; maskedProfiles: number; inInterview: number; feedbackDue: number; activeEngagements: number; monthlySpendLabel: string };
  openRequirements: ClientRequirementSummary[];
  awaitingReview: Array<{ code: string; roleTitle: string; count: number; averageScore: number | null; sentAgo: string }>;
  engagements: Array<{ maskedId: string; roleTitle: string; sinceLabel: string; rateLabel: string; status: string }>;
}

export async function getClientOverview(
  clientOrgId: string,
  viewerName: string,
): Promise<ClientOverview> {
  const [org] = await db
    .select({ name: s.organizations.name })
    .from(s.organizations)
    .where(eq(s.organizations.id, clientOrgId))
    .limit(1);

  const reqs = await db
    .select({
      id: s.requirements.id,
      code: s.requirements.code,
      roleTitle: s.requirements.roleTitle,
      quantity: s.requirements.quantity,
      experienceBand: s.requirements.experienceBand,
      locationCity: s.requirements.locationCity,
      workMode: s.requirements.workMode,
      startDate: s.requirements.startDate,
      budgetMinPaise: s.requirements.budgetMinPaise,
      budgetMaxPaise: s.requirements.budgetMaxPaise,
      stage: s.requirements.stage,
      postedAt: s.requirements.postedAt,
    })
    .from(s.requirements)
    .where(and(
      eq(s.requirements.clientOrgId, clientOrgId),
      inArray(s.requirements.stage, ["new", "matching", "shortlisted", "interviewing"]),
    ))
    .orderBy(desc(s.requirements.postedAt));

  const shortlistCounts = await db
    .select({
      requirementId: s.shortlists.requirementId,
      shortlistId: s.shortlists.id,
      sentAt: s.shortlists.sentAt,
      count: sql<number>`count(${s.shortlistItems.id})::int`,
      avgScore: sql<number | null>`avg(${s.shortlistItems.scoreOverall})`,
    })
    .from(s.shortlists)
    .leftJoin(s.shortlistItems, eq(s.shortlistItems.shortlistId, s.shortlists.id))
    .where(inArray(s.shortlists.requirementId, reqs.length ? reqs.map((r) => r.id) : [""]))
    .groupBy(s.shortlists.requirementId, s.shortlists.id, s.shortlists.sentAt);

  const countByReq = new Map(shortlistCounts.map((c) => [c.requirementId, c]));

  // Engagements: the client sees its own CLIENT rate. The vendor rate column is not
  // selected, so no margin can be reconstructed from this response.
  const engagements = await db
    .select({
      roleTitle: s.engagements.roleTitle,
      startDate: s.engagements.startDate,
      status: s.engagements.status,
      clientRatePaise: s.engagements.clientRatePaise,
      maskedId: s.benchResources.maskedId,
    })
    .from(s.engagements)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.engagements.resourceId))
    .where(and(
      eq(s.engagements.clientOrgId, clientOrgId),
      inArray(s.engagements.status, ["onboarding", "active", "ending"]),
    ))
    .orderBy(desc(s.engagements.startDate))
    .limit(8);

  const interviewing = reqs.filter((r) => r.stage === "interviewing").length;
  const awaiting = reqs.filter((r) => r.stage === "shortlisted");
  const monthlySpend = engagements.reduce((a, e) => a + e.clientRatePaise, 0);

  return {
    greetingName: viewerName.split(" ")[0],
    orgName: org?.name ?? "",
    brokerName: "Priya Nair",
    stats: {
      openRequirements: reqs.length,
      positions: reqs.reduce((a, r) => a + r.quantity, 0),
      awaitingReview: awaiting.length,
      maskedProfiles: awaiting.reduce((a, r) => a + (countByReq.get(r.id)?.count ?? 0), 0),
      inInterview: interviewing,
      feedbackDue: 2,
      activeEngagements: engagements.length,
      monthlySpendLabel: formatPaiseShort(monthlySpend),
    },
    openRequirements: reqs.map((r) => ({
      code: r.code,
      roleTitle: r.roleTitle,
      quantity: r.quantity,
      experienceBand: `${r.experienceBand}y`,
      locationLabel: r.locationCity ? `${r.locationCity} / ${r.workMode}` : "Remote",
      startDate: r.startDate,
      budgetLabel: `${formatPaiseShort(r.budgetMinPaise)}–${formatPaiseShort(r.budgetMaxPaise).replace("₹", "")}`,
      stage: r.stage,
      shortlistCount: countByReq.get(r.id)?.count ?? 0,
    })),
    awaitingReview: awaiting.map((r) => {
      const c = countByReq.get(r.id);
      return {
        code: r.code,
        roleTitle: r.roleTitle,
        count: c?.count ?? 0,
        averageScore: c?.avgScore != null ? Math.round(Number(c.avgScore) * 10) / 10 : null,
        sentAgo: c?.sentAt ? relativeAgo(c.sentAt) : "—",
      };
    }),
    engagements: engagements.map((e) => ({
      maskedId: e.maskedId,
      roleTitle: e.roleTitle,
      sinceLabel: e.startDate ? `since ${formatDay(e.startDate)}` : "",
      rateLabel: formatPaiseShort(e.clientRatePaise),
      status: e.status,
    })),
  };
}

/* ----------------------------------------------------- requirements list */

export async function getClientRequirements(clientOrgId: string) {
  const rows = await db
    .select({
      code: s.requirements.code,
      roleTitle: s.requirements.roleTitle,
      quantity: s.requirements.quantity,
      stage: s.requirements.stage,
      experienceBand: s.requirements.experienceBand,
      locationCity: s.requirements.locationCity,
      workMode: s.requirements.workMode,
      startDate: s.requirements.startDate,
      budgetMinPaise: s.requirements.budgetMinPaise,
      budgetMaxPaise: s.requirements.budgetMaxPaise,
      clientNote: s.requirements.clientNote, // client's OWN note — visible to them
      postedAt: s.requirements.postedAt,
      slaDueAt: s.requirements.slaDueAt,
    })
    .from(s.requirements)
    .where(eq(s.requirements.clientOrgId, clientOrgId))
    .orderBy(desc(s.requirements.postedAt));

  return rows.map((r) => ({
    code: r.code,
    roleTitle: r.roleTitle,
    quantity: r.quantity,
    stage: r.stage,
    experienceBand: r.experienceBand,
    locationLabel: r.locationCity ? `${r.locationCity} / ${r.workMode}` : "Remote",
    startDate: r.startDate,
    budgetLabel: `${formatPaiseShort(r.budgetMinPaise)}–${formatPaiseShort(r.budgetMaxPaise).replace("₹", "")}`,
    note: r.clientNote,
    postedAgo: r.postedAt ? relativeAgo(r.postedAt) : "—",
    // The client sees the broker's promise, not the ops SLA colour.
    promiseLabel: r.stage === "matching" || r.stage === "new" ? "Shortlist within 36h" : null,
  }));
}

/* ------------------------------------------------------------- interviews */

export async function getClientInterviews(clientOrgId: string) {
  const rows = await db
    .select({
      roundNo: s.interviews.roundNo,
      status: s.interviews.status,
      scheduledAt: s.interviews.scheduledAt,
      durationMinutes: s.interviews.durationMinutes,
      mode: s.interviews.mode,
      locationText: s.interviews.locationText,
      meetingUrl: s.interviews.meetingUrl,
      requestedAt: s.interviews.requestedAt,
      maskedId: s.shortlistItems.maskedId,
      requirementCode: s.requirements.code,
      roleTitle: s.requirements.roleTitle,
    })
    .from(s.interviews)
    .innerJoin(s.shortlistItems, eq(s.shortlistItems.id, s.interviews.shortlistItemId))
    .innerJoin(s.requirements, eq(s.requirements.id, s.interviews.requirementId))
    .where(eq(s.requirements.clientOrgId, clientOrgId))
    .orderBy(asc(s.interviews.scheduledAt));

  return rows.map((r) => ({
    maskedId: r.maskedId,
    requirementCode: r.requirementCode,
    roleTitle: r.roleTitle,
    roundLabel: `ROUND ${r.roundNo}`,
    status: r.status,
    scheduledAt: r.scheduledAt?.toISOString() ?? null,
    durationLabel: r.durationMinutes ? `${r.durationMinutes} min` : null,
    modeLabel: r.mode === "onsite"
      ? `Onsite · ${r.locationText ?? ""}`.trim()
      : r.meetingUrl ? "Google Meet · link issued by Talentvibes" : "Video",
    // awaiting_vendor must never surface a supplier name. This is the exact copy the
    // design promises the client.
    waitingLabel: r.status === "awaiting_vendor"
      ? "Broker is confirming supplier release"
      : null,
    requestedAgo: r.requestedAt ? relativeAgo(r.requestedAt) : null,
  }));
}

/* --------------------------------------------------------- broker thread */

export async function getClientBrokerThread(clientOrgId: string, requirementCode?: string) {
  const [thread] = await db
    .select({
      id: s.brokerThreads.id,
      scopeLabel: s.brokerThreads.scopeLabel,
      brokerName: s.users.fullName,
    })
    .from(s.brokerThreads)
    .innerJoin(s.users, eq(s.users.id, s.brokerThreads.brokerUserId))
    .where(and(
      eq(s.brokerThreads.counterpartyOrgId, clientOrgId),
      eq(s.brokerThreads.side, "client"), // a client can only ever read its own side
    ))
    .limit(1);

  if (!thread) return null;

  // linked_thread_id and redaction_note are ops-only and are not selected.
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
    scopeLabel: requirementCode ?? thread.scopeLabel,
    brokerName: thread.brokerName,
    messages: messages.map((m) => ({
      who: m.senderSide === "client" ? "You" : m.senderName,
      isMine: m.senderSide === "client",
      body: m.body,
      at: formatTime(m.sentAt),
    })),
  };
}

/* ----------------------------------------------------------------- utils */

function relativeAgo(d: Date): string {
  const hours = Math.floor((Date.now() - d.getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

function formatDay(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

function formatTime(d: Date): string {
  return d.toLocaleString("en-IN", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

/* ====================================================================== */
/*  Sidebar — deliberately cheap                                           */
/* ====================================================================== */

/**
 * Badge counts and the context aside for the client sidebar.
 *
 * This exists because the sidebar used to call getClientOverview() — which every client
 * page already calls — doubling the queries on every page to produce three badge
 * numbers. Counts belong in a COUNT query, not in a full read model.
 *
 * Two round trips: one aggregate, one short list for the aside rows.
 */
export async function getClientSidebar(clientOrgId: string) {
  const rows = (await db.execute(sql`
    select
      count(*) filter (where stage in ('new','matching','shortlisted','interviewing'))::int
        as open_requirements,
      count(*) filter (where stage = 'shortlisted')::int  as awaiting_review,
      count(*) filter (where stage = 'interviewing')::int as in_interview,
      (select count(*) from engagements e
        where e.client_org_id = ${clientOrgId}
          and e.status in ('onboarding','active','ending'))::int
        as active_engagements
    from requirements
    where client_org_id = ${clientOrgId}
  `)) as unknown as Array<{
    open_requirements: number; awaiting_review: number;
    in_interview: number; active_engagements: number;
  }>;
  const c = rows[0];

  const top = await db
    .select({
      code: s.requirements.code,
      roleTitle: s.requirements.roleTitle,
      quantity: s.requirements.quantity,
    })
    .from(s.requirements)
    .where(and(
      eq(s.requirements.clientOrgId, clientOrgId),
      inArray(s.requirements.stage, ["new", "matching", "shortlisted", "interviewing"]),
    ))
    .orderBy(desc(s.requirements.postedAt))
    .limit(3);

  return {
    badges: {
      requirements: Number(c?.open_requirements) || undefined,
      shortlists: Number(c?.awaiting_review) || undefined,
      interviews: Number(c?.in_interview) || undefined,
      engagements: Number(c?.active_engagements) || undefined,
    } as Record<string, string | number | undefined>,
    items: top,
  };
}
