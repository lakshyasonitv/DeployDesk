import { eq } from "drizzle-orm";
import { db, log, rng, schema as s } from "./ctx";
import { SCREENS } from "./fixtures";
import { daysAgo, daysAhead, hoursAgo, hoursAhead, fixtureDateToOffset, SEED_NOW } from "./helpers";
import { parseMoneyToPaise } from "../../lib/money/paise";
import { marginPct, isBelowFloor, MARGIN_FLOOR_PCT } from "../../lib/money/rate-band";
import { hashTail } from "../../lib/masked-id";
import type { OrgSeed } from "./orgs";
import type { ResourceSeed } from "./resources";
import type { DemandSeed, ShortlistSeed } from "./demand";

/* ------------------------------------------------------------- interviews */

export async function seedInterviews(
  org: OrgSeed, demand: DemandSeed, shortlist: ShortlistSeed,
) {
  const req2291 = demand.reqByCode.get("REQ-2291")!;
  const item = (masked: string) => shortlist.itemByMasked.get(masked);

  const rows: Array<typeof s.interviews.$inferInsert> = [];
  const panelFor: Array<{ key: string; names: Array<[string, string]> }> = [];

  // TV-4821 · Round 1 · 45 min video · R. Sundaram + D. Kulkarni
  if (item("TV-4821")) {
    rows.push({
      requirementId: req2291.id, shortlistItemId: item("TV-4821")!.id, roundNo: 1,
      status: "confirmed", scheduledAt: daysAhead(2), durationMinutes: 45, mode: "video",
      meetingUrl: "https://meet.talentvibes.com/tv-4821-r1", // always Talentvibes-issued
      confirmedAt: hoursAgo(20),
    });
    panelFor.push({ key: "TV-4821", names: [["R. Sundaram", "Eng Manager"], ["D. Kulkarni", "Staff FE"]] });
  }
  // TV-6620 · Round 2 · 60 min onsite Whitefield · S. Ahuja
  if (item("TV-6620")) {
    rows.push({
      requirementId: req2291.id, shortlistItemId: item("TV-6620")!.id, roundNo: 2,
      status: "confirmed", scheduledAt: daysAhead(3), durationMinutes: 60, mode: "onsite",
      locationText: "Whitefield campus",
      meetingUrl: null, confirmedAt: hoursAgo(26),
    });
    panelFor.push({ key: "TV-6620", names: [["S. Ahuja", "QA Lead"], ["D. Kulkarni", "Staff FE"]] });
  }
  // TV-5302 · awaiting_vendor — client proposed two slots, requested 4h ago.
  // The client sees "broker is confirming supplier release", never a vendor name.
  if (item("TV-5302")) {
    rows.push({
      requirementId: req2291.id, shortlistItemId: item("TV-5302")!.id, roundNo: 1,
      status: "awaiting_vendor", scheduledAt: null, durationMinutes: 45, mode: "video",
      proposedSlots: [
        { start: daysAhead(4).toISOString(), end: daysAhead(4).toISOString() },
        { start: daysAhead(4.2).toISOString(), end: daysAhead(4.2).toISOString() },
      ],
      requestedAt: hoursAgo(4),
    });
  }

  const interviews = await db.insert(s.interviews).values(rows).returning();

  const panelRows: Array<typeof s.interviewPanelists.$inferInsert> = [];
  interviews.forEach((iv) => {
    const masked = [...shortlist.itemByMasked.entries()].find(([, i]) => i.id === iv.shortlistItemId)?.[0];
    const spec = panelFor.find((p) => p.key === masked);
    if (!spec) return;
    for (const [displayName, title] of spec.names) {
      const user = org.panel.find((u) => u.fullName === displayName);
      panelRows.push({ interviewId: iv.id, userId: user?.id ?? null, displayName, title });
    }
  });
  if (panelRows.length) await db.insert(s.interviewPanelists).values(panelRows).onConflictDoNothing();

  // Feedback due on the TV-6620 round 2: four ratings, outcome still pending.
  const r2 = interviews.find((i) => i.roundNo === 2);
  if (r2) {
    await db.insert(s.interviewFeedback).values({
      interviewId: r2.id,
      submittedBy: org.panel.find((u) => u.fullName === "S. Ahuja")?.id ?? org.ananya.id,
      ratingTechnicalDepth: 4, ratingProblemSolving: 5, ratingCommunication: 4, ratingRoleFit: 4,
      notes:
        "Strong on Playwright and CI. Walked through a flaky-test triage end to end and knew " +
        "exactly where the retry logic belonged. Wants to own the suite, not just write cases.",
      outcome: null,
      submittedAt: hoursAgo(18),
      dueAt: hoursAhead(6), // due today
    });
  }

  log(`  interviews: ${interviews.length} · panelists: ${panelRows.length} · feedback: ${r2 ? 1 : 0}`);
  return { interviews };
}

/* ------------------------------------------------------------ engagements */

export async function seedEngagements(
  org: OrgSeed, res: ResourceSeed, demand: DemandSeed,
) {
  /** Vendor short names in the margin table map to the full org names. */
  const VENDOR_ALIAS: Record<string, string> = {
    Nimbus: "Nimbus Softworks", Sparkbridge: "Sparkbridge Systems",
    Trueline: "Trueline Consulting", "Orbit Talent": "Orbit Talent Services",
    "Vertex Digital": "Vertex Digital", Cygnet: "Cygnet Infotech Labs",
    Helix: "Helix Systems",
  };

  const START_DATES: Record<string, string> = {
    "TV-4821": "15 Sep 2026", "TV-6620": "1 Sep 2026", "TV-3310": "3 Mar 2026",
    "TV-3877": "19 May 2026", "TV-3964": "12 Apr 2026", "TV-4488": "1 Aug 2026",
  };

  const rows: Array<typeof s.engagements.$inferInsert> = [];
  const belowFloor: string[] = [];

  for (const m of SCREENS.marginRows ?? []) {
    const maskedId = m.id as string;
    const resource = res.byMasked.get(maskedId);
    if (!resource) continue;

    const vendorName = VENDOR_ALIAS[m.vendor as string] ?? (m.vendor as string);
    const vendorOrg = org.byName.get(vendorName);
    const clientOrg = org.byName.get(m.client as string);
    if (!vendorOrg || !clientOrg) continue;

    const vendorRate = parseMoneyToPaise(m.vrate as string);
    const clientRate = parseMoneyToPaise(m.crate as string);
    const pct = marginPct(clientRate, vendorRate);
    const isBelow = isBelowFloor(pct);
    if (isBelow) belowFloor.push(`${maskedId} ${pct.toFixed(1)}%`);

    rows.push({
      requirementId: null,
      resourceId: resource.id,
      clientOrgId: clientOrg.id,
      vendorOrgId: vendorOrg.id,
      roleTitle: m.role as string,
      startDate: fixtureDateToOffset(START_DATES[maskedId] ?? "1 Jun 2026").toISOString().slice(0, 10),
      endDate: maskedId === "TV-4102" ? daysAhead(24).toISOString().slice(0, 10) : null,
      status: maskedId === "TV-4455" ? "onboarding" : maskedId === "TV-4102" ? "ending" : "active",
      vendorRatePaise: vendorRate,
      clientRatePaise: clientRate,
      // Below the floor requires an explicit approver plus a note (docs/DOMAIN.md).
      // Q5 default: ops_admin only.
      marginApprovedBy: isBelow ? org.opsByShort.get("D. Rao")!.id : null,
      marginExceptionNote: isBelow
        ? maskedId === "TV-4488"
          ? "Approved as a strategic entry into the Acme SAP estate. Review at renewal, 1 Oct."
          : "Approved to hold the Northwind account through the .NET ramp. Review at renewal."
        : null,
    });
  }

  // TV-4455: the mid-month-start pro-rata case, and TV-4102 the roll-off case.
  for (const [maskedId, role, vendorName, clientName, vRate, cRate, status] of [
    ["TV-4455", "SAP ABAP Consultant", "Nimbus Softworks", "Acme Finserv", "₹2,15,000", "₹2,60,000", "onboarding"],
    ["TV-4102", "QA Automation Engineer", "Trueline Consulting", "Acme Finserv", "₹1,04,000", "₹1,36,000", "ending"],
    ["TV-2984", ".NET Core Engineer", "Orbit Talent Services", "Vantage Insurance", "₹1,18,000", "₹1,44,000", "active"],
  ] as const) {
    const resource = res.byMasked.get(maskedId);
    if (!resource || rows.some((r) => r.resourceId === resource.id)) continue;
    rows.push({
      requirementId: null,
      resourceId: resource.id,
      clientOrgId: org.byName.get(clientName)!.id,
      vendorOrgId: org.byName.get(vendorName)!.id,
      roleTitle: role,
      startDate: fixtureDateToOffset(maskedId === "TV-4455" ? "1 Aug 2026" : "1 Jun 2026").toISOString().slice(0, 10),
      endDate: maskedId === "TV-4102" ? daysAhead(24).toISOString().slice(0, 10) : null,
      status: status as typeof s.engagements.$inferInsert.status,
      vendorRatePaise: parseMoneyToPaise(vRate),
      clientRatePaise: parseMoneyToPaise(cRate),
      marginApprovedBy: null,
      marginExceptionNote: null,
    });
  }

  /* The floor rule is an invariant, not a list: ANY engagement under 18% needs an
     approver and a note (docs/DOMAIN.md). Enforce it by computing, rather than by
     hardcoding which rows are exceptions — TV-4455's own design figures land at 17.3%,
     which a hardcoded list missed. Q5's safer default applies: ops_admin only. */
  const opsAdmin = org.opsByShort.get("D. Rao")!;
  for (const r of rows) {
    const pct = marginPct(r.clientRatePaise, r.vendorRatePaise);
    if (!isBelowFloor(pct) || r.marginApprovedBy) continue;
    r.marginApprovedBy = opsAdmin.id;
    r.marginExceptionNote =
      `Approved at ${pct.toFixed(1)}%, below the ${MARGIN_FLOOR_PCT}% floor, to hold the ` +
      `account through this engagement. Review at renewal.`;
  }

  // Generated placements so the exchange-wide totals (31 live, run-rate) read correctly.
  const namedCount = rows.length;
  const allResources = res.inserted.filter((r) => r.status === "deployed");
  const usedIds = new Set(rows.map((r) => r.resourceId));
  for (const r of allResources) {
    if (rows.length >= 31) break;
    if (usedIds.has(r.id)) continue;
    const clientName = ["Acme Finserv", "Kestrel Logistics", "Northwind Retail", "Meridian Pharma", "Vantage Insurance"][Math.floor(rng() * 5)];
    const clientRate = Math.round(r.vendorRatePaise * (1.26 + rng() * 0.12));
    rows.push({
      requirementId: null, resourceId: r.id,
      clientOrgId: org.byName.get(clientName)!.id,
      vendorOrgId: r.vendorOrgId,
      roleTitle: "Contract Engineer",
      startDate: daysAgo(30 + rng() * 240).toISOString().slice(0, 10),
      endDate: null, status: "active",
      vendorRatePaise: r.vendorRatePaise, clientRatePaise: clientRate,
      marginApprovedBy: null, marginExceptionNote: null,
    });
    usedIds.add(r.id);
  }

  const engagements = await db.insert(s.engagements).values(rows).returning();

  /**
   * Link each `placed` requirement to an engagement.
   *
   * The ops pipeline derives a placed card's label from the engagement's two rate
   * columns ("Margin 14.2%"), so an unlinked engagement leaves the card with nothing to
   * show. Prefer an engagement for the same client whose role matches; otherwise take
   * any unlinked one for that client, then any unlinked one at all.
   *
   * The resulting percentages come from the seeded rates, so they will not always equal
   * the mockup's figures — the same authored-versus-computed gap recorded in ADR-011.
   */
  const placed = demand.requirements.filter((r) => r.stage === "placed");
  const claimed = new Set<string>();
  const linked: string[] = [];

  for (const req of placed) {
    const pools = [
      engagements.filter((e) => e.clientOrgId === req.clientOrgId && sameRole(e.roleTitle, req.roleTitle)),
      engagements.filter((e) => e.clientOrgId === req.clientOrgId),
      engagements,
    ];
    const pick = pools.flat().find((e) => !claimed.has(e.id) && !e.requirementId);
    if (!pick) continue;
    claimed.add(pick.id);
    await db.update(s.engagements)
      .set({ requirementId: req.id })
      .where(eq(s.engagements.id, pick.id));
    const pct = marginPct(pick.clientRatePaise, pick.vendorRatePaise);
    linked.push(`${req.code}→${pct.toFixed(1)}%`);
  }

  log(`  engagements: ${engagements.length} (${namedCount} from fixtures) · below floor: ${belowFloor.join(", ")}`);
  log(`  placed requirements linked: ${linked.join(", ") || "none"}`);

  /* ---- invoices: one receivable and one payable per engagement-month.
          They are never joined in an API response (docs/DATA-MODEL.md). ---- */
  const periodMonth = new Date(Date.UTC(SEED_NOW.getUTCFullYear(), SEED_NOW.getUTCMonth(), 1))
    .toISOString().slice(0, 10);

  const byClient = new Map<string, number>();
  const byVendor = new Map<string, number>();
  for (const e of engagements) {
    byClient.set(e.clientOrgId, (byClient.get(e.clientOrgId) ?? 0) + e.clientRatePaise);
    byVendor.set(e.vendorOrgId, (byVendor.get(e.vendorOrgId) ?? 0) + e.vendorRatePaise);
  }

  const invoiceRows: Array<typeof s.invoices.$inferInsert> = [
    ...[...byClient].map(([orgId, total]) => ({
      counterpartyOrgId: orgId, direction: "receivable" as const, periodMonth,
      status: "issued" as const, issuedAt: daysAgo(5), dueAt: daysAhead(25), totalPaise: total,
    })),
    ...[...byVendor].map(([orgId, total]) => ({
      counterpartyOrgId: orgId, direction: "payable" as const, periodMonth,
      status: "issued" as const, issuedAt: daysAgo(5), dueAt: daysAhead(25), totalPaise: total,
    })),
  ];
  const invoices = await db.insert(s.invoices).values(invoiceRows).onConflictDoNothing().returning();

  const lineRows: Array<typeof s.invoiceLines.$inferInsert> = [];
  const invByKey = new Map(invoices.map((i) => [`${i.counterpartyOrgId}:${i.direction}`, i]));
  for (const e of engagements) {
    const prorata = e.status === "onboarding"; // mid-month start
    const recv = invByKey.get(`${e.clientOrgId}:receivable`);
    const pay = invByKey.get(`${e.vendorOrgId}:payable`);
    if (recv) lineRows.push({
      invoiceId: recv.id, engagementId: e.id, description: `${e.roleTitle} — monthly fee`,
      daysBilled: prorata ? 23 : 30, daysInMonth: 30,
      amountPaise: prorata ? Math.round(e.clientRatePaise * 23 / 30) : e.clientRatePaise,
      isProrata: prorata,
    });
    if (pay) lineRows.push({
      invoiceId: pay.id, engagementId: e.id, description: `${e.roleTitle} — supplier payable`,
      daysBilled: prorata ? 23 : 30, daysInMonth: 30,
      amountPaise: prorata ? Math.round(e.vendorRatePaise * 23 / 30) : e.vendorRatePaise,
      isProrata: prorata,
    });
  }
  await db.insert(s.invoiceLines).values(lineRows);
  log(`  invoices: ${invoices.length} · invoice_lines: ${lineRows.length}`);

  return { engagements };
}


/** "SAP ABAP Consultant" vs "SAP ABAP Consultant" — match on the significant words. */
function sameRole(a: string, b: string): boolean {
  const key = (x: string) =>
    x.toLowerCase().replace(/(senior|lead|engineers?|developers?|consultants?)/g, "")
      .replace(/[^a-z0-9]+/g, " ").trim();
  const ka = key(a), kb = key(b);
  return ka === kb || ka.includes(kb) || kb.includes(ka);
}

/* ------------------------------------------------------------- duplicates */

export async function seedDuplicates(org: OrgSeed, res: ResourceSeed, demand: DemandSeed) {
  const a = res.byMasked.get("TV-4821");
  const b = res.byMasked.get("TV-7188-B");
  const req2291 = demand.reqByCode.get("REQ-2291");

  const rows: Array<typeof s.duplicateFlags.$inferInsert> = [];

  if (a && b) {
    // DUP-0148 — 96%, blocks the REQ-2291 shortlist.
    rows.push({
      code: "DUP-0148",
      resourceAId: a.id, // the earlier submission
      resourceBId: b.id,
      confidence: 96,
      signals: [
        { key: "pan_hash",   label: "PAN hash identical",     verdict: "exact match",      severity: "high",   detail: hashTail(a.panHash ?? "") },
        { key: "phone_hash", label: "Phone hash identical",   verdict: "exact match",      severity: "high",   detail: hashTail(a.phoneHash ?? "") },
        { key: "employers",  label: "Employer history",       verdict: "3 of 3 overlap",   severity: "high",   detail: "Zeta Commerce, Pallava Digital, Inflexion Labs" },
        { key: "github",     label: "GitHub handle",          verdict: "same",             severity: "medium", detail: a.githubHandle ?? "" },
        { key: "experience", label: "Experience stated",      verdict: "6.2y vs 6.5y",     severity: "medium", detail: "0.3y apart" },
        { key: "rate",       label: "Rate differs",           verdict: "₹14,000 apart",    severity: "low",    detail: "₹1,38,000 vs ₹1,52,000" },
      ],
      status: "open",
      assignedTo: org.priya.id,
      blocksRequirements: req2291 ? [req2291.id] : [],
      detectedAt: daysAgo(3),
    });
  }

  // DUP-0147 — 71%, the band that flags without blocking. Different PAN: needs a human.
  const kavya = res.byMasked.get("TV-5302");
  const other = res.inserted.find(
    (r) => r.vendorOrgId === org.byName.get("Vertex Digital")!.id && r.id !== kavya?.id,
  );
  if (kavya && other) {
    rows.push({
      code: "DUP-0147",
      resourceAId: kavya.id,
      resourceBId: other.id,
      confidence: 71,
      signals: [
        { key: "phone_hash", label: "Phone hash identical", verdict: "exact match",            severity: "high",   detail: "matching phone hash" },
        { key: "employers",  label: "Employer history",     verdict: "overlapping Salesforce",  severity: "medium", detail: "shared project history" },
        { key: "pan_hash",   label: "PAN hash",             verdict: "DIFFERENT",               severity: "low",    detail: "does not match" },
      ],
      status: "open",
      assignedTo: org.opsByShort.get("R. Verma")!.id,
      blocksRequirements: [],
      detectedAt: daysAgo(5),
    });
  }

  const flags = await db.insert(s.duplicateFlags).values(rows).returning();
  log(`  duplicate_flags: ${flags.length} (${flags.map((f) => `${f.code} ${f.confidence}%`).join(", ")})`);
  return { flags };
}

/* ---------------------------------------------- brokering: two threads, never one */

export async function seedBrokerThreads(org: OrgSeed, res: ResourceSeed, demand: DemandSeed) {
  const req = demand.reqByCode.get("REQ-2291")!;

  // Client-side thread.
  const [clientThread] = await db.insert(s.brokerThreads).values({
    side: "client",
    counterpartyOrgId: org.acme.id,
    brokerUserId: org.priya.id,
    scopeType: "requirement",
    scopeRequirementId: req.id,
    scopeLabel: "REQ-2291 · Senior React Engineers",
    status: "open",
    lastMessageAt: hoursAgo(1),
  }).returning();

  // Vendor-side thread, scoped to the candidate the client queried the rate on.
  const tv4488 = res.byMasked.get("TV-4488");
  const [vendorThread] = await db.insert(s.brokerThreads).values({
    side: "vendor",
    counterpartyOrgId: org.byName.get("Vertex Digital")!.id,
    brokerUserId: org.priya.id,
    scopeType: "candidate",
    scopeResourceId: tv4488?.id ?? null,
    scopeLabel: "TV-4488 · rate query",
    linkedThreadId: clientThread.id,
    status: "open",
    lastMessageAt: hoursAgo(1),
  }).returning();

  await db.update(s.brokerThreads)
    .set({ linkedThreadId: vendorThread.id })
    .where(eq(s.brokerThreads.id, clientThread.id));

  const clientMsgs = await db.insert(s.brokerMessages).values([
    {
      threadId: clientThread.id, senderUserId: org.priya.id, senderSide: "ops",
      body: "Shortlist for REQ-2291 is live — six masked profiles, all proctored in the last three weeks. Two of them clear your band and can start on the 15th.",
      sentAt: hoursAgo(3),
    },
    {
      threadId: clientThread.id, senderUserId: org.ananya.id, senderSide: "client",
      body: "Thanks Priya. TV-4488 looks strong on paper but the rate is well above what we approved.",
      sentAt: hoursAgo(2.5),
    },
    {
      threadId: clientThread.id, senderUserId: org.priya.id, senderSide: "ops",
      body: "Agreed — that one is ₹2.10L+. I can go back to the supplier for a 6-month rate if the SAP overlap genuinely matters to you, otherwise I'd park it and add one more React profile tomorrow.",
      sentAt: hoursAgo(2.2),
    },
  ]).returning();

  // The relay: a NEW message in the counterpart thread, with the client's identity and
  // commercials removed, pointing back at the original via relayed_from_id (ADR-008).
  await db.insert(s.brokerMessages).values({
    threadId: vendorThread.id,
    senderUserId: org.priya.id,
    senderSide: "ops",
    body: "We have a live requirement where TV-4488 is a strong technical fit, but the rate is above the ceiling for this engagement. Is there any movement on a six-month commitment?",
    relayedFromId: clientMsgs[1].id,
    redactionNote: "Removed: client org name (Acme Finserv), approved budget band, and the requirement code.",
    sentAt: hoursAgo(2),
  });

  log(`  broker_threads: 2 (linked) · broker_messages: ${clientMsgs.length + 1} (1 relayed)`);
  return { clientThread, vendorThread };
}

/* ---------------------------------------------------------------- audit log */

export async function seedAudit(
  org: OrgSeed, demand: DemandSeed, shortlist: ShortlistSeed,
) {
  const req = demand.reqByCode.get("REQ-2291")!;
  const rows: Array<typeof s.auditLog.$inferInsert> = [
    {
      actorId: org.priya.id, actorOrgId: org.tv.id,
      action: "shortlist.sent", entityType: "shortlist", entityId: shortlist.shortlist.id,
      after: { requirement: "REQ-2291", items: shortlist.items.length, sequence_no: 1 },
      context: { source: "seed", request_id: "seed-0001" },
      occurredAt: hoursAgo(2),
    },
    {
      actorId: org.priya.id, actorOrgId: org.tv.id,
      action: "requirement.stage_changed", entityType: "requirement", entityId: req.id,
      before: { stage: "matching" }, after: { stage: "shortlisted" },
      context: { source: "seed" }, occurredAt: hoursAgo(2),
    },
    {
      actorId: org.ananya.id, actorOrgId: org.acme.id,
      action: "shortlist.opened", entityType: "shortlist", entityId: shortlist.shortlist.id,
      context: { source: "seed" }, occurredAt: hoursAgo(1.5),
    },
  ];

  for (const item of shortlist.items.filter((i) => i.clientDecision === "selected")) {
    rows.push({
      actorId: org.ananya.id, actorOrgId: org.acme.id,
      action: "shortlist_item.selected", entityType: "shortlist_item", entityId: item.id,
      after: { masked_id: item.maskedId, decision: "selected" },
      context: { source: "seed" }, occurredAt: hoursAgo(1),
    });
  }

  await db.insert(s.auditLog).values(rows);
  log(`  audit_log: ${rows.length}`);
}

/* ------------------------------------------- sensitive column registry (tripwire) */

export async function seedSensitiveColumns() {
  const rows: Array<typeof s.sensitiveColumns.$inferInsert> = [
    { tableName: "bench_resources", columnName: "full_name",        visibleTo: ["ops", "vendor_own"], reason: "Candidate identity" },
    { tableName: "bench_resources", columnName: "contact_email",    visibleTo: ["ops", "vendor_own"], reason: "Candidate PII" },
    { tableName: "bench_resources", columnName: "contact_phone",    visibleTo: ["ops", "vendor_own"], reason: "Candidate PII" },
    { tableName: "bench_resources", columnName: "cv_object_key",    visibleTo: ["ops"],               reason: "CV carries name, employers, contacts" },
    { tableName: "bench_resources", columnName: "pan_hash",         visibleTo: ["ops"],               reason: "Identity hash" },
    { tableName: "bench_resources", columnName: "phone_hash",       visibleTo: ["ops"],               reason: "Identity hash" },
    { tableName: "bench_resources", columnName: "email_hash",       visibleTo: ["ops"],               reason: "Identity hash" },
    { tableName: "bench_resources", columnName: "vendor_org_id",    visibleTo: ["ops", "vendor_own"], reason: "Supplier identity" },
    { tableName: "bench_resources", columnName: "vendor_rate_paise",visibleTo: ["ops", "vendor_own"], reason: "Supplier cost" },
    { tableName: "bench_resources", columnName: "last_confirmed_at",visibleTo: ["ops", "vendor_own"], reason: "Freshness is supplier hygiene" },
    { tableName: "matches",         columnName: "proposed_client_rate_paise", visibleTo: ["ops"],     reason: "Client price; margin input" },
    { tableName: "matches",         columnName: "algo_score",       visibleTo: ["ops"],               reason: "Internal ranking" },
    { tableName: "requirements",    columnName: "client_note",      visibleTo: ["ops", "client_own"], reason: "Client internal note" },
    { tableName: "requirements",    columnName: "budget_min_paise", visibleTo: ["ops", "client_own"], reason: "Client budget" },
    { tableName: "requirements",    columnName: "budget_max_paise", visibleTo: ["ops", "client_own"], reason: "Client budget" },
    { tableName: "engagements",     columnName: "vendor_rate_paise",visibleTo: ["ops", "vendor_own"], reason: "Supplier cost" },
    { tableName: "engagements",     columnName: "client_rate_paise",visibleTo: ["ops", "client_own"], reason: "Client price" },
    { tableName: "duplicate_flags", columnName: "signals",          visibleTo: ["ops"],               reason: "Neither side is told a flag exists" },
    { tableName: "interview_feedback", columnName: "notes",         visibleTo: ["ops", "client_own"], reason: "Verbatim client feedback" },
    { tableName: "broker_messages", columnName: "redaction_note",   visibleTo: ["ops"],               reason: "States what was removed" },
  ];
  await db.insert(s.sensitiveColumns).values(rows).onConflictDoNothing();
  log(`  sensitive_columns: ${rows.length}`);
}
