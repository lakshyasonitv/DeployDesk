/**
 * Leak tests over the READ MODELS.
 *
 * These point at the read-model functions rather than the route handlers, because the
 * pages are server components that call the read models directly. The read model is the
 * chokepoint both paths share, so testing it covers what the browser actually receives.
 *
 * The assertions walk each response to ANY depth and fail on:
 *   - a forbidden key name
 *   - a known vendor or client organisation name, where that side must not see it
 *   - any exact vendor rate from the fixture set appearing in a client response
 *
 * docs/TESTING.md calls this the golden-fixture suite. It must fail loudly when someone
 * adds a column to an existing response.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import * as s from "../../src/db/schema";
import { getClientShortlist, getClientOverview, getClientRequirements, getClientInterviews, getClientBrokerThread, getClientEngagements } from "../../src/read-models/client";
import { getVendorRoster, getVendorOverview, getVendorEarnings, getVendorAssessments, getVendorImports } from "../../src/read-models/vendor";

const VENDOR_NAMES = [
  "Nimbus Softworks", "Sparkbridge Systems", "Cygnet Infotech Labs", "Helix Systems",
  "Vertex Digital", "Trueline Consulting", "Orbit Talent Services",
];
const CLIENT_NAMES = [
  "Acme Finserv", "Kestrel Logistics", "Northwind Retail", "Meridian Pharma",
  "Vantage Insurance",
];

/** Keys a client response may never contain, at any depth. */
const CLIENT_FORBIDDEN_KEYS = [
  "vendorName", "vendor_name", "vendorOrgId", "vendor_org_id", "vendorId", "vendor_id",
  "vendorRate", "vendor_rate", "vendorRatePaise", "vendor_rate_paise", "vendorRateLabel",
  "vendorReliability", "vendor_reliability",
  "margin", "marginPct", "margin_pct", "marginPctLabel", "spread", "spreadLabel",
  "fullName", "full_name", "contactEmail", "contact_email", "contactPhone", "contact_phone",
  "panHash", "pan_hash", "phoneHash", "phone_hash", "emailHash", "email_hash",
  "cvObjectKey", "cv_object_key", "resourceId", "resource_id",
  "freshness", "freshnessLabel", "freshnessState", "lastConfirmedAt", "last_confirmed_at",
  "algoScore", "algo_score", "duplicateFlags", "signals", "redactionNote", "redaction_note",
  "createdAt", "created_at",
];

/** Keys a vendor response may never contain, at any depth. */
const VENDOR_FORBIDDEN_KEYS = [
  "clientName", "client_name", "clientOrgId", "client_org_id",
  "clientRate", "client_rate", "clientRatePaise", "client_rate_paise", "clientRateLabel",
  "budgetMin", "budgetMinPaise", "budget_min_paise", "budgetMax", "budgetMaxPaise",
  "budgetLabel", "clientNote", "client_note",
  "margin", "marginPct", "margin_pct", "spread", "spreadLabel",
  "panelists", "panelNames", "interviewFeedback", "notes",
  "duplicateFlags", "signals", "duplicateOf", "duplicate_of",
  "proposedClientRate", "proposed_client_rate_paise",
];

function walk(value: unknown, visit: (key: string, v: unknown, path: string) => void, path = "$") {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((v, i) => walk(v, visit, `${path}[${i}]`));
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      visit(k, v, `${path}.${k}`);
      walk(v, visit, `${path}.${k}`);
    }
  }
}

/** Every string in the payload, paired with the key it sits under. */
function collectStrings(
  value: unknown,
  key = "$",
  out: Array<[string, string]> = [],
): Array<[string, string]> {
  if (typeof value === "string") out.push([key, value]);
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, key, out));
  else if (value && typeof value === "object") {
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) collectStrings(v, k, out);
  }
  return out;
}

/**
 * Money fields that belong to the CALLER and may legitimately hold any figure.
 *
 * A client's own budget band and the client rate on its own engagements are visible to
 * that client (docs/MASKING.md: "Client budget band 🔸", "Client rate 🔸"). Those figures
 * can coincidentally equal some supplier's rate — Acme's band starts at ₹95,000 and a
 * resource on the exchange costs exactly ₹95,000 — which is a collision, not a leak: the
 * client supplied its own budget.
 *
 * The real invariant for candidate-facing money is ADR-004, asserted structurally at the
 * bottom of this file against band minimum versus vendor rate for the SAME resource.
 */
const OWN_MONEY_KEYS = [
  "budgetLabel", "monthlySpendLabel", "rateLabel", "clientRateLabel",
  "valuePerMonthLabel", "runRateLabel", "billedThisMonthLabel", "promiseLabel",
];

function expectNoForbiddenKeys(payload: unknown, forbidden: string[], label: string) {
  const hits: string[] = [];
  walk(payload, (key, _v, path) => {
    if (forbidden.includes(key)) hits.push(path);
  });
  expect(hits, `${label}: forbidden key(s) present`).toEqual([]);
}

function expectNoSubstring(
  payload: unknown,
  needles: string[],
  label: string,
  opts: { ignoreKeys?: string[] } = {},
) {
  const ignore = new Set(opts.ignoreKeys ?? []);
  const strings = collectStrings(payload).filter(([k]) => !ignore.has(k));
  const hits: string[] = [];
  for (const n of needles) {
    for (const [k, str] of strings) {
      if (str.includes(n)) hits.push(`${n} at key "${k}": "${str.slice(0, 60)}"`);
    }
  }
  expect(hits, `${label}: forbidden value(s) present`).toEqual([]);
}

let acmeId = "";
let nimbusId = "";
/** A second client, so tenancy can be asserted rather than assumed. */
let vantageId = "";
let vendorRateStrings: string[] = [];

beforeAll(async () => {
  const [acme] = await db.select({ id: s.organizations.id }).from(s.organizations)
    .where(eq(s.organizations.name, "Acme Finserv")).limit(1);
  const [nimbus] = await db.select({ id: s.organizations.id }).from(s.organizations)
    .where(eq(s.organizations.name, "Nimbus Softworks")).limit(1);
  const [vantage] = await db.select({ id: s.organizations.id }).from(s.organizations)
    .where(eq(s.organizations.name, "Vantage Insurance")).limit(1);
  acmeId = acme.id;
  nimbusId = nimbus.id;
  vantageId = vantage.id;

  // Every exact vendor rate in the fixture set, in the formats the UI renders.
  const rates = await db.select({ v: s.benchResources.vendorRatePaise }).from(s.benchResources);
  vendorRateStrings = [...new Set(rates.map((r) =>
    `₹${Math.round(r.v / 100).toLocaleString("en-IN")}`))];
}, 60_000);

describe("client portal never leaks supplier or margin data", () => {
  it("masked shortlist", async () => {
    const view = await getClientShortlist(acmeId, "REQ-2291");
    expect(view).not.toBeNull();
    expect(view!.candidates.length).toBe(6);
    expectNoForbiddenKeys(view, CLIENT_FORBIDDEN_KEYS, "client shortlist");
    expectNoSubstring(view, VENDOR_NAMES, "client shortlist");
    expectNoSubstring(view, vendorRateStrings, "client shortlist (exact vendor rate)");
  });

  it("overview", async () => {
    const view = await getClientOverview(acmeId, "Ananya Krishnan");
    expectNoForbiddenKeys(view, CLIENT_FORBIDDEN_KEYS, "client overview");
    expectNoSubstring(view, VENDOR_NAMES, "client overview");
    expectNoSubstring(view, vendorRateStrings, "client overview (exact vendor rate)",
      { ignoreKeys: OWN_MONEY_KEYS });
  });

  /**
   * The placement panel is the richest client-facing payload in the product: it reaches
   * `bench_resources` directly rather than through the shortlist snapshot, and that table
   * carries full_name, vendor_org_id, vendor_rate_paise, the contact details, the
   * PAN/phone/email hashes and last_confirmed_at. Naming columns is what keeps those out,
   * so this asserts the result of that rather than trusting it.
   */
  it("people working, and the panel behind each row", async () => {
    const view = await getClientEngagements(acmeId);
    expect(view.length).toBeGreaterThan(0);
    expectNoForbiddenKeys(view, CLIENT_FORBIDDEN_KEYS, "client engagements");
    expectNoSubstring(view, VENDOR_NAMES, "client engagements");
    expectNoSubstring(view, vendorRateStrings, "client engagements (exact vendor rate)",
      { ignoreKeys: OWN_MONEY_KEYS });
  });

  it("never lets the raw extension status reach the client", async () => {
    // `with_supplier` is a real value in the extension_status enum and the seed creates a
    // row holding it. The client is told their Talentvibes team is confirming; the enum
    // value itself would tell them a supplier is being asked, and "we are waiting on the
    // supplier" plus a date is the beginning of a guess about which one.
    const clients = await db.select({ id: s.organizations.id })
      .from(s.organizations).where(eq(s.organizations.orgType, "client"));
    const all = (await Promise.all(
      clients.map((c) => getClientEngagements(c.id)),
    )).flat();

    const labels = all.map((e) => e.extension?.statusLabel).filter(Boolean) as string[];
    // The seed creates exactly one extension request, attached to whichever active
    // engagement the database returns first -- which client that is, is not fixed. So the
    // sweep is over every client, and this guards the test against passing vacuously if
    // the row ever stops being seeded.
    expect(labels.length, "no extension request in the fixture set -- test is vacuous")
      .toBeGreaterThan(0);

    for (const l of labels) {
      expect(l.toLowerCase(), "extension status shown to a client").not.toContain("supplier");
      expect(l).not.toMatch(/with_supplier|requested$/);
    }
  });

  it("scopes people working to the calling client", async () => {
    // Both clients have placements in the fixture set, and they are different people. A
    // missing tenancy predicate on the engagement -> shortlist_items -> shortlists ->
    // requirements path would pull the other client's rows in.
    const [mine, theirs] = await Promise.all([
      getClientEngagements(acmeId), getClientEngagements(vantageId),
    ]);
    expect(mine.length).toBeGreaterThan(0);
    expect(theirs.length).toBeGreaterThan(0);
    const overlap = mine.filter((m) => theirs.some((t) => t.maskedId === m.maskedId));
    expect(overlap.map((o) => o.maskedId), "same person on two clients' lists").toEqual([]);
  });

  it("requirements list", async () => {
    const view = await getClientRequirements(acmeId);
    expectNoForbiddenKeys(view, CLIENT_FORBIDDEN_KEYS, "client requirements");
    expectNoSubstring(view, VENDOR_NAMES, "client requirements");
  });

  it("interviews never name the supplier while awaiting release", async () => {
    const view = await getClientInterviews(acmeId);
    expectNoForbiddenKeys(view, CLIENT_FORBIDDEN_KEYS, "client interviews");
    expectNoSubstring(view, VENDOR_NAMES, "client interviews");
    const waiting = view.find((i) => i.waitingLabel);
    if (waiting) expect(waiting.waitingLabel).toBe("Your Talentvibes team is confirming availability");
  });

  it("broker thread exposes no relay internals", async () => {
    const view = await getClientBrokerThread(acmeId);
    expectNoForbiddenKeys(view, CLIENT_FORBIDDEN_KEYS, "client broker thread");
    expectNoSubstring(view, VENDOR_NAMES, "client broker thread");
  });
});

describe("vendor portal never leaks client or margin data", () => {
  it("roster", async () => {
    const view = await getVendorRoster(nimbusId);
    expect(view.total).toBe(42);
    expectNoForbiddenKeys(view, VENDOR_FORBIDDEN_KEYS, "vendor roster");
    expectNoSubstring(view, CLIENT_NAMES, "vendor roster");
  });

  it("overview", async () => {
    const view = await getVendorOverview(nimbusId, "Vikram Shetty");
    expectNoForbiddenKeys(view, VENDOR_FORBIDDEN_KEYS, "vendor overview");
    expectNoSubstring(view, CLIENT_NAMES, "vendor overview");
  });

  it("earnings are payable-only and name no client", async () => {
    const view = await getVendorEarnings(nimbusId);
    expectNoForbiddenKeys(view, VENDOR_FORBIDDEN_KEYS, "vendor earnings");
    expectNoSubstring(view, CLIENT_NAMES, "vendor earnings");
  });

  it("assessments", async () => {
    const view = await getVendorAssessments(nimbusId);
    expectNoForbiddenKeys(view, VENDOR_FORBIDDEN_KEYS, "vendor assessments");
    expectNoSubstring(view, CLIENT_NAMES, "vendor assessments");
  });

  it("import review never names the duplicate counterpart", async () => {
    const view = await getVendorImports(nimbusId);
    expectNoForbiddenKeys(view, VENDOR_FORBIDDEN_KEYS, "vendor imports");
    expectNoSubstring(view, CLIENT_NAMES, "vendor imports");
    expectNoSubstring(view, VENDOR_NAMES.filter((n) => n !== "Nimbus Softworks"), "vendor imports");
  });

  it("a vendor reads only its own resources", async () => {
    const [orbit] = await db.select({ id: s.organizations.id }).from(s.organizations)
      .where(eq(s.organizations.name, "Orbit Talent Services")).limit(1);
    const mine = await getVendorRoster(nimbusId);
    const theirs = await getVendorRoster(orbit.id);
    const overlap = mine.resources
      .map((r) => r.maskedId)
      .filter((id) => theirs.resources.some((t) => t.maskedId === id));
    expect(overlap).toEqual([]);
  });
});

describe("the ADR-004 invariant", () => {
  it("no client-facing band overlaps the corresponding vendor rate", async () => {
    const rows = await db
      .select({
        maskedId: s.shortlistItems.maskedId,
        bandMin: s.shortlistItems.rateBandMinPaise,
        vendorRate: s.benchResources.vendorRatePaise,
      })
      .from(s.shortlistItems)
      .innerJoin(s.benchResources, eq(s.benchResources.id, s.shortlistItems.resourceId));

    const overlaps = rows.filter((r) => r.bandMin <= r.vendorRate)
      .map((r) => `${r.maskedId}: band from ${r.bandMin} <= vendor ${r.vendorRate}`);
    expect(overlaps, "a client band brackets the vendor cost — this is the leak ADR-004 exists to prevent").toEqual([]);
  });
});
