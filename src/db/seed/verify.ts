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
import { marginPct, MARGIN_FLOOR_PCT } from "../../lib/money/rate-band";
import { freshnessFor, slaFor, SLA_WINDOW_HOURS } from "../../lib/derived";

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

  // 24 transcribed from the design fixtures, plus REQ-2320 — the dual-role requirement
  // posted BY Cygnet Infotech Labs, which exists so the self-dealing rule has something
  // real to refuse. Both counts are asserted separately so a change to either is visible.
  const [{ n: reqCount }] = await db.select({ n: sql<number>`count(*)::int` }).from(s.requirements);
  check("requirements = 25 (24 fixtures + 1 dual-role scenario)", reqCount === 25, `got ${reqCount}`);

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
  check("every dual-role band is a real range, not a point",
    dualItems.every((i) => Number(i.bandMax) > Number(i.bandMin)),
    dualItems.map((i) => `${i.maskedId} ${formatPaiseShort(Number(i.bandMin))}-${formatPaiseShort(Number(i.bandMax))}`).join(" "));

  /* ---------------- SLA: exactly one breach, two idle ---------------- */
  const reqs = await db
    .select({
      code: s.requirements.code, stage: s.requirements.stage,
      slaDueAt: s.requirements.slaDueAt, slaWindowHours: s.requirements.slaWindowHours,
    })
    .from(s.requirements);
  const states = reqs.map((r) => {
    const paused = r.stage === "shortlisted";
    const windowHours =
      r.slaWindowHours ?? SLA_WINDOW_HOURS[r.stage as keyof typeof SLA_WINDOW_HOURS] ?? 36;
    return { code: r.code, state: slaFor(r.slaDueAt, windowHours, { paused }).state };
  });
  const late = states.filter((x) => x.state === "late");
  const idle = states.filter((x) => x.state === "idle");
  check("exactly one SLA breach", late.length === 1, late.map((l) => l.code).join(",") || "none");
  check("the breach is REQ-2295", late[0]?.code === "REQ-2295", late[0]?.code ?? "none");
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
    .filter((e) => e.pct < MARGIN_FLOOR_PCT);
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

  /* ---------------- brokering: two threads, linked, one relayed ---------------- */
  const threads = await db
    .select({ id: s.brokerThreads.id, side: s.brokerThreads.side, linked: s.brokerThreads.linkedThreadId })
    .from(s.brokerThreads);
  check("two broker threads, one per side", threads.length === 2);
  check("the threads are linked both ways", threads.every((t) => t.linked !== null));
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
