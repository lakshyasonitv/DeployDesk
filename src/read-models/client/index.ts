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
  /**
   * Five independent reads, issued together.
   *
   * Each round trip to the Mumbai database costs roughly 60-70ms, so running these one
   * after another spent ~420ms almost entirely waiting. Only `shortlistCounts` genuinely
   * depends on another read — it needs the requirement ids — so it stays in a second
   * wave. Six serial round trips become two waves.
   *
   * Concurrency is safe inside the pool width (`src/db/client.ts` is `max: 10`). This
   * mirrors `getVendorOverview`, which went 481ms -> 144ms the same way. An older gotcha
   * in project-brain/01-architecture.md said parallelising was counterproductive; that
   * predates the Mumbai move and the wider pool, and has been corrected there.
   */
  const [[org], reqs, engagements, [feedback], [accountOwner]] = await Promise.all([
    db
      .select({ name: s.organizations.name })
      .from(s.organizations)
      .where(eq(s.organizations.id, clientOrgId))
      .limit(1),

    db
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
      .orderBy(desc(s.requirements.postedAt)),

    // Engagements: the client sees its own CLIENT rate. The vendor rate column is not
    // selected, so no margin can be reconstructed from this response.
    db
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
      .limit(8),

    // Feedback actually outstanding: submitted ratings with no outcome recorded yet, on
    // this client's own interviews. Was previously a hardcoded 2.
    db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.interviewFeedback)
      .innerJoin(s.interviews, eq(s.interviews.id, s.interviewFeedback.interviewId))
      .innerJoin(s.requirements, eq(s.requirements.id, s.interviews.requirementId))
      .where(and(
        eq(s.requirements.clientOrgId, clientOrgId),
        sql`${s.interviewFeedback.outcome} is null`,
      )),

    // The broker is whoever Talentvibes assigned to this account, not a name in the source.
    db
      .select({ fullName: s.users.fullName })
      .from(s.clientProfiles)
      .innerJoin(s.users, eq(s.users.id, s.clientProfiles.accountOwnerId))
      .where(eq(s.clientProfiles.orgId, clientOrgId))
      .limit(1),
  ]);

  // Second wave: this one needs the requirement ids from above.
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

  const interviewing = reqs.filter((r) => r.stage === "interviewing").length;
  const awaiting = reqs.filter((r) => r.stage === "shortlisted");
  const monthlySpend = engagements.reduce((a, e) => a + e.clientRatePaise, 0);

  return {
    greetingName: viewerName.split(" ")[0],
    orgName: org?.name ?? "",
    brokerName: accountOwner?.fullName ?? "Your Talentvibes team",
    stats: {
      openRequirements: reqs.length,
      positions: reqs.reduce((a, r) => a + r.quantity, 0),
      awaitingReview: awaiting.length,
      maskedProfiles: awaiting.reduce((a, r) => a + (countByReq.get(r.id)?.count ?? 0), 0),
      inInterview: interviewing,
      feedbackDue: Number(feedback?.n) || 0,
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

/* ------------------------------------------------------- interview feedback */

/**
 * Feedback the client has submitted but not yet concluded. The four ratings and the
 * verbatim note are client + ops only (docs/MASKING.md); a redacted summary is what
 * reaches the supplier, and that relay is a broker action.
 */
export async function getClientFeedbackDue(clientOrgId: string) {
  const rows = await db
    .select({
      maskedId: s.shortlistItems.maskedId,
      roundNo: s.interviews.roundNo,
      roleTitle: s.requirements.roleTitle,
      requirementCode: s.requirements.code,
      technicalDepth: s.interviewFeedback.ratingTechnicalDepth,
      problemSolving: s.interviewFeedback.ratingProblemSolving,
      communication: s.interviewFeedback.ratingCommunication,
      roleFit: s.interviewFeedback.ratingRoleFit,
      notes: s.interviewFeedback.notes,
      dueAt: s.interviewFeedback.dueAt,
    })
    .from(s.interviewFeedback)
    .innerJoin(s.interviews, eq(s.interviews.id, s.interviewFeedback.interviewId))
    .innerJoin(s.shortlistItems, eq(s.shortlistItems.id, s.interviews.shortlistItemId))
    .innerJoin(s.requirements, eq(s.requirements.id, s.interviews.requirementId))
    .where(and(
      eq(s.requirements.clientOrgId, clientOrgId),
      sql`${s.interviewFeedback.outcome} is null`,
    ))
    .orderBy(asc(s.interviewFeedback.dueAt));

  return rows.map((r) => ({
    maskedId: r.maskedId,
    // The NUMBER as well as the label: the feedback endpoint identifies a round by
    // (maskedId, roundNo), and the label is display text that must not be parsed back.
    roundNo: r.roundNo,
    roundLabel: `Round ${r.roundNo}`,
    roleTitle: r.roleTitle,
    requirementCode: r.requirementCode,
    ratings: [
      { label: "Technical depth", value: r.technicalDepth },
      { label: "Problem solving", value: r.problemSolving },
      { label: "Communication", value: r.communication },
      { label: "Role fit", value: r.roleFit },
      // NOT filtered to the ones already answered. The card is a form now, and a rating
      // nobody has given yet still needs a row to click on. `null` means unanswered.
    ] as Array<{ label: string; value: number | null }>,
    notes: r.notes,
    dueAt: r.dueAt?.toISOString() ?? null,
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
      ? "Your Talentvibes team is confirming availability"
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

/* ------------------------------------------- people working: the full view */

/**
 * One person working for this client, with everything the client is allowed to know.
 *
 * This backs the click-through on "People working". The owner asked for "full information
 * about the resource like name date of joining etc." The date of joining is here. The NAME
 * can never be, and the reason is worth stating, because it is not "names are sensitive":
 *
 *   A name is a SIDE CHANNEL TO THE SUPPLIER. Name -> public profile -> current employer ->
 *   the supplier, whom the client could then contract with directly, cutting Talentvibes
 *   out. Supplier identity is the one thing this product exists to protect.
 *   docs/MASKING.md's side-channel table is the authority, and the v2 handoff says the same
 *   for this exact screen: "Rows are anonymous (TV id and role only)" (SCREENS.md:99).
 *
 * Every field below is `OK` or `own-records-only` for the client in the visibility matrix.
 *
 * Columns are named explicitly, per working agreement 7, because `bench_resources` carries
 * `full_name`, `vendor_org_id`, `vendor_rate_paise`, the contact details, the PAN/phone/
 * email hashes and `last_confirmed_at` — freshness, which is ops/vendor-only because
 * "unconfirmed 26d" tells a client that a supplier is slow.
 *
 * Two further columns are available and deliberately NOT selected: `github_handle`, because
 * a repository handle identifies a person as surely as a name does, and
 * `last_project_note`, because a note about someone's last project can name the supplier's
 * other client.
 */
export interface ClientEngagement {
  maskedId: string;
  roleTitle: string;
  status: string;
  /** The date of joining — what the owner asked to surface. */
  startedOn: string;
  tenureLabel: string;
  endsOn: string | null;
  /** The raw date, so the extension form can set a sensible minimum and default. */
  endDateIso: string | null;
  /** Drives v2's amber, bold end date (SCREENS.md:100). */
  endingSoon: boolean;
  /**
   * The rate the CLIENT pays. Exact, not a band: this is the client's own record and it is
   * the figure they are invoiced. `tests/leak/read-models.test.ts` asserts this is allowed.
   * The band rule in docs/MASKING.md applies to masked SHORTLIST cards, pre-placement,
   * where an exact figure is recoverable back to the vendor's cost.
   */
  rateLabel: string;
  ratePaise: number;
  experienceLabel: string;
  baseCity: string;
  workModes: string[];
  noticePeriodLabel: string | null;
  skills: string[];
  /**
   * The proctored result, present ONLY where this placement came through a shortlist sent
   * to THIS client. Most placements have no such lineage — the seed creates engagements
   * with `requirement_id = null` — so the panel must read well without it.
   */
  assessment: null | {
    scoreOverall: number | null;
    sections: Array<{ label: string; value: number | null }>;
    attemptNo: number | null;
    testedOn: string | null;
  };
  /** An extension already in flight, so the UI does not offer a duplicate. */
  extension: null | { statusLabel: string; requestedUntil: string; settled: boolean };
}

/**
 * What a client may be told about an extension's progress.
 *
 * `with_supplier` is the interesting one: the client is told their Talentvibes team is
 * confirming, never that a supplier is being asked. `src/db/schema/operations.ts` records
 * the same wording, and "withdrawn" maps to null so an undone request leaves no trace in
 * the UI while the row survives for the audit trail.
 */
const EXTENSION_LABEL: Record<string, { label: string; settled: boolean }> = {
  requested: { label: "Sent to your Talentvibes team", settled: false },
  with_supplier: { label: "Your Talentvibes team is confirming", settled: false },
  approved: { label: "Approved", settled: true },
  declined: { label: "Not possible", settled: true },
};

export async function getClientEngagements(clientOrgId: string): Promise<ClientEngagement[]> {
  const rows = await db
    .select({
      // Join key only, NEVER serialised: it identifies the bench_resources row.
      resourceId: s.engagements.resourceId,
      engagementId: s.engagements.id,
      maskedId: s.benchResources.maskedId,
      roleTitle: s.engagements.roleTitle,
      startDate: s.engagements.startDate,
      endDate: s.engagements.endDate,
      status: s.engagements.status,
      clientRatePaise: s.engagements.clientRatePaise,
      baseCity: s.benchResources.baseCity,
      experienceMonths: s.benchResources.experienceMonths,
      workModes: s.benchResources.workModes,
      noticePeriodDays: s.benchResources.noticePeriodDays,
    })
    .from(s.engagements)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.engagements.resourceId))
    .where(and(
      eq(s.engagements.clientOrgId, clientOrgId),
      inArray(s.engagements.status, ["onboarding", "active", "ending"]),
    ))
    .orderBy(desc(s.engagements.startDate));

  if (!rows.length) return [];

  const resourceIds = rows.map((r) => r.resourceId);
  const engagementIds = rows.map((r) => r.engagementId);

  /**
   * Three reads fanned out rather than run in sequence. An earlier comment in this
   * codebase claimed parallelising was counterproductive and cost 0.5s on /ops/matching
   * once its reason had been fixed — latency here is round-trip count, not row count.
   */
  const [skillRows, snapshots, extensions] = await Promise.all([
    db
      .select({ resourceId: s.resourceSkills.resourceId, label: s.skills.label, isPrimary: s.resourceSkills.isPrimary })
      .from(s.resourceSkills)
      .innerJoin(s.skills, eq(s.skills.id, s.resourceSkills.skillId))
      .where(inArray(s.resourceSkills.resourceId, resourceIds)),

    /**
     * The assessment snapshot reaches a client ONLY through a shortlist sent to THAT
     * client, so BOTH ends are pinned: the engagement's `client_org_id` above, and the
     * requirement's here. Without the second, a resource placed at two clients would match
     * the other client's shortlist row and we would serve its snapshot.
     *
     * `shortlists` has no client column of its own — the path is
     * shortlist_items -> shortlists -> requirements.client_org_id.
     */
    db
      .select({
        resourceId: s.shortlistItems.resourceId,
        scoreOverall: s.shortlistItems.scoreOverall,
        scoreCoding: s.shortlistItems.scoreCoding,
        scoreDsa: s.shortlistItems.scoreDsa,
        scoreSystemDesign: s.shortlistItems.scoreSystemDesign,
        scoreCommunication: s.shortlistItems.scoreCommunication,
        attemptNo: s.shortlistItems.assessmentAttemptNo,
        testedOn: s.shortlistItems.assessmentTestedOn,
      })
      .from(s.shortlistItems)
      .innerJoin(s.shortlists, eq(s.shortlists.id, s.shortlistItems.shortlistId))
      .innerJoin(s.requirements, eq(s.requirements.id, s.shortlists.requirementId))
      .where(and(
        inArray(s.shortlistItems.resourceId, resourceIds),
        eq(s.requirements.clientOrgId, clientOrgId),
      ))
      // Most recent shortlist wins when a person was sent more than once.
      .orderBy(desc(s.shortlists.sentAt)),

    // `ops_note` and `decided_by` are ops-only and are not selected.
    db
      .select({
        engagementId: s.extensionRequests.engagementId,
        status: s.extensionRequests.status,
        requestedUntil: s.extensionRequests.requestedUntil,
        createdAt: s.extensionRequests.createdAt,
      })
      .from(s.extensionRequests)
      .where(inArray(s.extensionRequests.engagementId, engagementIds))
      .orderBy(desc(s.extensionRequests.createdAt)),
  ]);

  const skillsBy = new Map<string, string[]>();
  for (const r of skillRows) {
    const list = skillsBy.get(r.resourceId) ?? [];
    // Primary skill first; the rest keep the order the database returned.
    if (r.isPrimary) list.unshift(r.label); else list.push(r.label);
    skillsBy.set(r.resourceId, list);
  }

  const snapBy = new Map<string, typeof snapshots[number]>();
  for (const sn of snapshots) if (!snapBy.has(sn.resourceId)) snapBy.set(sn.resourceId, sn);

  const extBy = new Map<string, typeof extensions[number]>();
  for (const e of extensions) if (!extBy.has(e.engagementId)) extBy.set(e.engagementId, e);

  const now = new Date();

  return rows.map((r) => {
    const snap = snapBy.get(r.resourceId);
    const ext = extBy.get(r.engagementId);
    const extLabel = ext ? EXTENSION_LABEL[ext.status] : undefined;
    const daysLeft = r.endDate
      ? Math.round((new Date(r.endDate).getTime() - now.getTime()) / 86_400_000)
      : null;

    return {
      maskedId: r.maskedId,
      roleTitle: r.roleTitle,
      status: r.status,
      startedOn: formatFullDay(r.startDate),
      tenureLabel: tenureSince(r.startDate, now),
      endsOn: r.endDate ? formatFullDay(r.endDate) : null,
      endDateIso: r.endDate,
      // 45 days is a notice period plus a fortnight to decide — long enough that a
      // client can still act on it, which is the point of flagging it at all.
      endingSoon: daysLeft != null && daysLeft <= 45,
      rateLabel: formatPaiseShort(r.clientRatePaise),
      ratePaise: Number(r.clientRatePaise),
      experienceLabel: formatExperience(r.experienceMonths),
      baseCity: r.baseCity,
      workModes: r.workModes,
      noticePeriodLabel: r.noticePeriodDays ? `${r.noticePeriodDays}-day notice` : null,
      skills: skillsBy.get(r.resourceId) ?? [],
      assessment: snap
        ? {
            scoreOverall: snap.scoreOverall,
            sections: [
              { label: "Coding", value: snap.scoreCoding },
              { label: "Data structures", value: snap.scoreDsa },
              { label: "System design", value: snap.scoreSystemDesign },
              { label: "Communication", value: snap.scoreCommunication },
            ],
            attemptNo: snap.attemptNo,
            testedOn: snap.testedOn ? formatFullDay(snap.testedOn) : null,
          }
        : null,
      extension: ext && extLabel
        ? {
            statusLabel: extLabel.label,
            requestedUntil: formatFullDay(ext.requestedUntil),
            settled: extLabel.settled,
          }
        : null,
    };
  });
}

/* ----------------------------------------------------------------- utils */

/** "3 Mar 2026" — the year matters on a placement that has run for a while. */
function formatFullDay(iso: string): string {
  return new Date(iso).toLocaleDateString("en-IN", {
    day: "numeric", month: "short", year: "numeric",
  });
}

/** "7 months so far" / "1 year 2 months so far" / "11 days so far". */
function tenureSince(iso: string, now: Date): string {
  const start = new Date(iso);
  if (start.getTime() > now.getTime()) return "starts shortly";
  const days = Math.floor((now.getTime() - start.getTime()) / 86_400_000);
  if (days < 31) return `${days === 0 ? 1 : days} day${days === 1 ? "" : "s"} so far`;
  const months = Math.max(1, Math.round(days / 30.44));
  if (months < 12) return `${months} month${months === 1 ? "" : "s"} so far`;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  const y = `${years} year${years === 1 ? "" : "s"}`;
  return rest ? `${y} ${rest} month${rest === 1 ? "" : "s"} so far` : `${y} so far`;
}

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
