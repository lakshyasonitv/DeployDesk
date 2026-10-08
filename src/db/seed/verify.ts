/**
 * Post-seed verification.
 *
 *   npm run db:verify
 *
 * Checks the seeded data against the facts the design and docs pin down, including the
 * one that matters most: no client-facing rate band may overlap the corresponding
 * vendor rate (docs/MASKING.md, ADR-004). That assertion is the reason this file exists —
 * the prototype's own bands fail it.
 */
import { and, eq, inArray, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as s from "../schema";
import { formatPaiseExact, formatPaiseShort } from "../../lib/money/paise";
import { marginPct, isBelowFloor, MARGIN_FLOOR_PCT } from "../../lib/money/rate-band";
import { freshnessFor, slaFor, SLA_WINDOW_HOURS } from "../../lib/derived";
import { REQS } from "./fixtures";

const url = process.env.DIRECT_URL || process.env.DATABASE_URL;
if (!url) throw new Error("DIRECT_URL must be set");
const client = postgres(url, { max: 1, prepare: false });
const db = drizzle(client, { schema: s, casing: "snake_case" });

let pass = 0;
let fail = 0;
function check(label: string, ok: boolean, detail = "") {
  if (ok) { pass++; console.log(`  PASS  ${label}${detail ? "  " + detail : ""}`); }
  else { fail++; console.log(`  FAIL  ${label}${detail ? "  " + detail : ""}`); }
}

async function main() {
  console.log("\nVerifying seeded data\n");

  /* ---------------- counts ---------------- */
  const [{ n: orgCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.organizations);
  check("organizations = 20 (1 TV + 14 vendors + 5 clients)", orgCount === 20, `got ${orgCount}`);

  /**
   * Every fixture requirement is PRESENT — asserted by code, not by counting rows.
   *
   * This was `count(*) === 25` and it failed the first time a real requirement was posted
   * through the product ("got 26"), which is not a defect: the owner used the app. A check
   * that breaks the moment somebody uses the thing it is checking gets ignored, and an
   * ignored check in a verifier is worse than no check.
   *
   * Naming the codes is also STRICTER than the count was. `count === 25` passed if a
   * fixture went missing and something else took its place; this cannot. The 24 come from
   * the design fixtures, plus REQ-2320 — the dual-role requirement posted BY Cygnet
   * Infotech Labs, which exists so the self-dealing rule has something real to refuse.
   */
  const expectedReqCodes = [...REQS.map((r) => r.id as string), "REQ-2320"];
  const presentReqCodes = new Set(
    (await db.select({ code: s.requirements.code }).from(s.requirements)).map((r) => r.code),
  );
  const missingReqs = expectedReqCodes.filter((c) => !presentReqCodes.has(c));
  check(
    `all ${expectedReqCodes.length} fixture requirements present (24 fixtures + 1 dual-role scenario)`,
    missingReqs.length === 0,
    missingReqs.length ? `missing ${missingReqs.join(",")}` : `${presentReqCodes.size} total in table`,
  );

  const [{ n: dualReq }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.requirements)
    .where(eq(s.requirements.code, "REQ-2320"));
  check("REQ-2320 exists: the dual-role org hiring", dualReq === 1);

  // The scenario is only meaningful if it has a pool AND excludes its own people.
  const [dualPool] = await db.execute<{ total: number; own: number }>(sql`
    select count(*)::int as total,
           count(*) filter (where b.vendor_org_id = r.client_org_id)::int as own
      from matches m
      join requirements r on r.id = m.requirement_id
      join bench_resources b on b.id = m.resource_id
     where r.code = 'REQ-2320'
  `) as unknown as Array<{ total: number; own: number }>;
  check("REQ-2320 has a sourced pool", Number(dualPool?.total) > 0, `${dualPool?.total} candidates`);
  check("REQ-2320's pool excludes the org's OWN bench",
    Number(dualPool?.own) === 0, `${dualPool?.own} own-bench candidates`);

  const [noViolations] = await db.execute<{ n: number }>(sql`
    select count(*)::int as n from matches m
     where is_self_dealing(m.resource_id, m.requirement_id)
        or match_is_blocked(m.resource_id, m.requirement_id)
  `) as unknown as Array<{ n: number }>;
  check("no self-dealing or blocked pairing anywhere in matches",
    Number(noViolations?.n) === 0, `${noViolations?.n} violations`);

  const nimbus = await db.select({ id: s.organizations.id })
    .from(s.organizations).where(eq(s.organizations.name, "Nimbus Softworks")).limit(1);
  const [{ n: nimbusBench }] = await db.select({ n: sql<number>`count(*)::int` })
    .from(s.benchResources).where(eq(s.benchResources.vendorOrgId, nimbus[0].id));
  check("Nimbus bench = 42", nimbusBench === 42, `got ${nimbusBench}`);

  /* ---------------- THE leak assertion ----------------
     For every item on a client shortlist, the band must sit entirely ABOVE the
     vendor's rate for that resource. An overlap hands the client the supplier's cost. */
  const bandRows = await db
    .select({
      maskedId: s.shortlistItems.maskedId,
      bandMin: s.shortlistItems.rateBandMinPaise,
      bandMax: s.shortlistItems.rateBandMaxPaise,
      vendorRate: s.benchResources.vendorRatePaise,
      proposed: s.matches.proposedClientRatePaise,
    })
    .from(s.shortlistItems)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.shortlistItems.resourceId))
    .leftJoin(s.matches, eq(s.matches.resourceId, s.shortlistItems.resourceId));

  const seen = new Map<string, typeof bandRows[number]>();
  for (const r of bandRows) if (!seen.has(r.maskedId)) seen.set(r.maskedId, r);

  console.log("\n  Client band vs vendor rate (ADR-004):");
  let overlaps = 0;
  for (const r of seen.values()) {
    const overlap = r.bandMin <= r.vendorRate;
    if (overlap) overlaps++;
    console.log(
      `    ${r.maskedId}  band ${formatPaiseShort(r.bandMin)}–${formatPaiseShort(r.bandMax)}` +
      `  vendor ${formatPaiseExact(r.vendorRate)}` +
      `  proposed ${r.proposed ? formatPaiseExact(r.proposed) : "—"}` +
      `  ${overlap ? "<<< OVERLAP" : "clear"}`,
    );
  }
  check("no client band overlaps a vendor rate", overlaps === 0, `${overlaps} overlap(s)`);

  /* ---------------- shortlist shape ---------------- */
  /**
   * Scoped to REQ-2291's shortlist, which is what these three checks are named for.
   *
   * They used to select every row in `shortlist_items` with no join, so they only held
   * while exactly one shortlist existed in the whole database. Seeding the dual-role
   * requirement's shortlist broke all three at once — the assertions were under-specified,
   * not the new data. A check named for one requirement must filter by it, or it is really
   * asserting "nothing else in the product has a shortlist", which is not a property
   * anyone intended to guarantee.
   */
  const items = await db
    .select({
      maskedId: s.shortlistItems.maskedId,
      position: s.shortlistItems.position,
      decision: s.shortlistItems.clientDecision,
    })
    .from(s.shortlistItems)
    .innerJoin(s.shortlists, eq(s.shortlists.id, s.shortlistItems.shortlistId))
    .innerJoin(s.requirements, eq(s.requirements.id, s.shortlists.requirementId))
    .where(eq(s.requirements.code, "REQ-2291"))
    .orderBy(s.shortlistItems.position);
  check("REQ-2291 shortlist has 6 items", items.length === 6, `got ${items.length}`);
  check(
    "shortlist order matches the design",
    items.map((i) => i.maskedId).join(",") === "TV-6620,TV-4821,TV-5302,TV-5107,TV-4488,TV-3964",
    items.map((i) => i.maskedId).join(","),
  );
  check("two selected, so the button reads 'Request interviews · 2'",
    items.filter((i) => i.decision === "selected").length === 2);

  /* ---------------- the dual-role shortlist (acceptance test 2) ---------------- */
  /**
   * Cygnet's own hiring side must actually SHOW something, or "each side shows only its
   * own rate" passes by showing nothing at all — the same vacuous-pass trap as an empty
   * candidate pool.
   */
  const dualItems = await db
    .select({
      maskedId: s.shortlistItems.maskedId,
      bandMin: s.shortlistItems.rateBandMinPaise,
      bandMax: s.shortlistItems.rateBandMaxPaise,
    })
    .from(s.shortlistItems)
    .innerJoin(s.shortlists, eq(s.shortlists.id, s.shortlistItems.shortlistId))
    .innerJoin(s.requirements, eq(s.requirements.id, s.shortlists.requirementId))
    .where(eq(s.requirements.code, "REQ-2320"));
  check("the dual-role requirement has a shortlist to show", dualItems.length > 0,
    `${dualItems.length} items`);

  /**
   * The commercial half of the masking rule: a company on both sides must be on a flat
   * declared fee, because it can otherwise compare what it is paid as a supplier against
   * what it is charged as a client and read the spread off the difference.
   */
  const feeRows = await db
    .select({ name: s.organizations.name, feeModel: s.organizations.feeModel })
    .from(s.organizations)
    .innerJoin(s.orgCapabilities, eq(s.orgCapabilities.orgId, s.organizations.id))
    .where(and(eq(s.orgCapabilities.canSupply, true), eq(s.orgCapabilities.canHire, true)));
  check("every dual-role org is on a flat declared fee, not a hidden markup",
    feeRows.length > 0 && feeRows.every((r) => r.feeModel === "flat_declared_fee"),
    feeRows.map((r) => `${r.name}=${r.feeModel}`).join(", ") || "no dual-role org found");
  check("every dual-role band is a real range, not a point",
    dualItems.every((i) => Number(i.bandMax) > Number(i.bandMin)),
    dualItems.map((i) => `${i.maskedId} ${formatPaiseShort(Number(i.bandMin))}-${formatPaiseShort(Number(i.bandMax))}`).join(" "));

  /* ---------------- SLA: exactly one breach, two idle ---------------- */
  const reqs = await db
    .select({
      code: s.requirements.code, stage: s.requirements.stage,
      slaDueAt: s.requirements.slaDueAt, slaWindowHours: s.requirements.slaWindowHours,
      createdAt: s.requirements.createdAt,
    })
    .from(s.requirements);

  /**
   * The SLA checks are judged AS OF SEED TIME, not as of now.
   *
   * `sla_due_at` is an absolute timestamp written when the seed ran, so every seeded
   * deadline marches toward `late` as the day goes on. These two assertions used to fail a
   * few days after any reseed — 28/2, four separate times — and the fix on offer was always
   * "run `npm run db:seed` again". That works, and then it drifts again.
   *
   * The frame of reference was the bug, not the assertion. **A fixture describes a moment**,
   * and this file's job is to check that the fixture still describes the moment it was
   * written for. So the clock is anchored to the oldest requirement's `created_at`, which is
   * when the seed ran, and the assertion stays exactly as strict: one breach, and it is
   * REQ-2295.
   *
   * `min(created_at)` rather than a stored marker: the seed is the oldest thing in this
   * table, so a requirement posted afterwards by a person or a test cannot move the anchor.
   * No new column and no migration.
   *
   * What this deliberately does NOT do is tell you whether the LIVE board looks healthy
   * right now — a seeded role really is overdue today, and the ops pipeline is right to show
   * it. That is a property of ageing demo data, not a defect, and `tests/leak/write-paths`
   * covers the live behaviour: moving a stage now re-dates the role.
   */
  const seededAt = reqs.reduce<Date | null>(
    (oldest, r) => (r.createdAt && (!oldest || r.createdAt < oldest) ? r.createdAt : oldest),
    null,
  ) ?? new Date();

  const states = reqs.map((r) => {
    const paused = r.stage === "shortlisted";
    const windowHours =
      r.slaWindowHours ?? SLA_WINDOW_HOURS[r.stage as keyof typeof SLA_WINDOW_HOURS] ?? 36;
    return {
      code: r.code,
      state: slaFor(r.slaDueAt, windowHours, { paused, now: seededAt }).state,
    };
  });
  const late = states.filter((x) => x.state === "late");
  const idle = states.filter((x) => x.state === "idle");

  /**
   * These no longer decay — they are judged as of `seededAt` above.
   *
   * If one of them fails now it is a REAL regression in the SLA derivation or in the
   * fixtures, not the clock moving, so the hint no longer suggests reseeding. It was
   * mistaken for a code regression twice while it was decaying; the opposite mistake —
   * dismissing a genuine failure as "just the seed ageing" — is the one to avoid now.
   */
  const staleHint = (got: string) =>
    `${got} — judged as of seed time (${seededAt.toISOString()}), so this is a real `
    + `regression rather than the seed ageing`;

  check("exactly one SLA breach", late.length === 1,
    staleHint(late.map((l) => l.code).join(",") || "none"));
  check("the breach is REQ-2295", late[0]?.code === "REQ-2295",
    staleHint(late[0]?.code ?? "none"));
  check("idle requirements are paused, not breached", idle.length >= 2, `${idle.length} idle`);

  /* ---------------- freshness spread, re-anchored to SEED_NOW ---------------- */
  const bench = await db
    .select({ lastConfirmedAt: s.benchResources.lastConfirmedAt, status: s.benchResources.status })
    .from(s.benchResources);
  const fresh = bench.map((b) => freshnessFor(b.lastConfirmedAt).state);
  const counts = {
    confirmed: fresh.filter((f) => f === "confirmed").length,
    expiring: fresh.filter((f) => f === "expiring_soon").length,
    unconfirmed: fresh.filter((f) => f === "unconfirmed").length,
  };
  console.log(`\n  freshness: ${counts.confirmed} confirmed · ${counts.expiring} expiring · ${counts.unconfirmed} unconfirmed`);
  check("most profiles are confirmed (fixtures re-anchored to SEED_NOW)",
    counts.confirmed > bench.length * 0.5, `${counts.confirmed}/${bench.length}`);
  check("some profiles are expiring", counts.expiring > 0, `${counts.expiring}`);
  check("some profiles are unconfirmed", counts.unconfirmed > 0, `${counts.unconfirmed}`);

  /* ---------------- margin floor cases ---------------- */
  const engs = await db
    .select({
      maskedId: s.benchResources.maskedId,
      vendorRate: s.engagements.vendorRatePaise,
      clientRate: s.engagements.clientRatePaise,
      approvedBy: s.engagements.marginApprovedBy,
      note: s.engagements.marginExceptionNote,
    })
    .from(s.engagements)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.engagements.resourceId));

  const below = engs
    .map((e) => ({ ...e, pct: marginPct(e.clientRate, e.vendorRate) }))
    .filter((e) => isBelowFloor(e.pct));
  console.log(`\n  below the ${MARGIN_FLOOR_PCT}% floor:`);
  for (const b of below) {
    console.log(`    ${b.maskedId}  ${b.pct.toFixed(1)}%  approver ${b.approvedBy ? "set" : "MISSING"}  note ${b.note ? "set" : "MISSING"}`);
  }
  // The invariant is the approval, not the count: the design's own figures put three
  // engagements under the floor, including TV-4455 at 17.3%, which docs/SEED-DATA.md
  // does not list. The named cases from the margin screen must be present.
  check("the two named below-floor cases are present",
    ["TV-3964", "TV-4488"].every((id) => below.some((b) => b.maskedId === id)),
    below.map((b) => b.maskedId).join(","));
  check("EVERY below-floor engagement has an approver and a note",
    below.every((b) => b.approvedBy && b.note),
    below.filter((b) => !b.approvedBy || !b.note).map((b) => b.maskedId).join(",") || "all covered");

  /* ---------------- margin is nowhere stored ---------------- */
  const [{ cols }] = await db.execute<{ cols: string }>(sql`
    select coalesce(string_agg(table_name || '.' || column_name, ', '), '') as cols
    from information_schema.columns
    where table_schema = 'public'
      and (column_name like '%margin%' or column_name like '%spread%')
      and column_name not in ('margin_approved_by', 'margin_exception_note')
  `) as unknown as Array<{ cols: string }>;
  check("no stored margin or spread column", !cols, cols || "none");

  /* ---------------- duplicates: the pair really shares hashes ---------------- */
  const [dup] = await db
    .select({ code: s.duplicateFlags.code, confidence: s.duplicateFlags.confidence, a: s.duplicateFlags.resourceAId, b: s.duplicateFlags.resourceBId })
    .from(s.duplicateFlags).where(eq(s.duplicateFlags.code, "DUP-0148")).limit(1);
  if (dup) {
    const pair = await db
      .select({ maskedId: s.benchResources.maskedId, panHash: s.benchResources.panHash })
      .from(s.benchResources).where(inArray(s.benchResources.id, [dup.a, dup.b]));
    check("DUP-0148 is 96% confidence", dup.confidence === 96, `${dup.confidence}`);
    check("DUP-0148 pair shares a PAN hash",
      pair.length === 2 && pair[0].panHash === pair[1].panHash,
      pair.map((p) => p.maskedId).join(" / "));
  } else check("DUP-0148 exists", false);

  /* ---------------- brokering: the relay pair, and the dual-role pair ---------------- */
  /**
   * Two different rules live here and the earlier version conflated them.
   *
   * It asserted "two broker threads" over the whole table and "linked both ways" over
   * every row. Both held only while the relay pair was the only thing in the table; adding
   * the dual-role organisation's own two threads broke them. The assertions were
   * under-specified, not the new data — the same shape as the REQ-2291 shortlist checks.
   *
   * 1. A RELAY PAIR (ADR-008) is one client question and the redacted vendor question it
   *    became. Those two are linked to each other, and `linked_thread_id` is ops-only.
   * 2. A DUAL-ROLE ORG has one thread per side that are NOT linked — they are two
   *    unrelated conversations that merely share a counterparty. Linking them would tell
   *    ops they were one exchange, and mixing them would put messages about the roles the
   *    org is filling into its bench workspace.
   */
  const threads = await db
    .select({
      id: s.brokerThreads.id,
      side: s.brokerThreads.side,
      linked: s.brokerThreads.linkedThreadId,
      orgName: s.organizations.name,
    })
    .from(s.brokerThreads)
    .innerJoin(s.organizations, eq(s.organizations.id, s.brokerThreads.counterpartyOrgId));

  const linkedPair = threads.filter((x) => x.linked !== null);
  check("exactly one relay pair, linked both ways", linkedPair.length === 2,
    linkedPair.map((x) => `${x.orgName}/${x.side}`).join(" <-> ") || "none");
  check("the relay pair spans both sides",
    new Set(linkedPair.map((x) => x.side)).size === 2,
    linkedPair.map((x) => x.side).join(","));

  const dualThreads = threads.filter((x) => x.orgName === "Cygnet Infotech Labs");
  check("the dual-role org has one thread per side", dualThreads.length === 2,
    dualThreads.map((x) => x.side).sort().join(",") || "none");
  check("the dual-role org's two sides are NOT linked to each other",
    dualThreads.every((x) => x.linked === null),
    dualThreads.filter((x) => x.linked).map((x) => x.side).join(",") || "neither linked");
  const [{ n: relayed }] = await db
    .select({ n: sql<number>`count(*)::int` })
    .from(s.brokerMessages)
    .where(sql`${s.brokerMessages.relayedFromId} is not null`);
  check("one relayed message exists", relayed === 1, `${relayed}`);

  console.log(`\n${pass} passed, ${fail} failed\n`);
  if (fail > 0) process.exitCode = 1;
}

main()
  .then(() => client.end({ timeout: 5 }))
  .catch(async (e) => {
    console.error(e);
    await client.end({ timeout: 5 }).catch(() => {});
    process.exit(1);
  });
