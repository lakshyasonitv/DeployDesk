/**
 * Dual-role workspace rules.
 *
 * Covers the UI-facing acceptance tests from the dual-role brief:
 *
 *   1. A supply-only organisation sees ONE workspace and no hint that a hiring side
 *      exists — not a locked tab, not a greyed switcher, nothing.
 *   2. A dual-role user can switch workspaces, and each side shows ONLY its own rate.
 *   6. Flipping `can_hire` makes the hiring workspace appear or disappear, with no
 *      migration and no second account.
 *
 * Tests 3 and 4 (own bench never offered to itself, blocked orgs invisible) live in
 * ./self-dealing.test.ts.
 *
 * NOTE ON TEST 5: the brief's exact wording for test 5 is not recorded in the project
 * brain, so this file covers both plausible readings rather than guessing one — that the
 * two rate views never appear together for one organisation, and that the broker itself
 * holds neither capability. Both are asserted below and labelled as such.
 *
 * Why these are leak tests and not UI tests: every rule here is enforced in the data
 * layer, so that is where it is asserted. A test that scraped rendered HTML would pass
 * just as happily against a component that received forbidden data and chose not to print
 * it — which is exactly the "filter it in the UI" shape docs/MASKING.md forbids.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../../src/db/client";
import * as s from "../../src/db/schema";
import {
  availableSides, getOrgCapabilities, getMembershipRoles, workspaceTabs, isDualRole,
  requiredCapability,
} from "../../src/lib/auth/workspace";
import { getClientShortlist, getClientBrokerThread } from "../../src/read-models/client";
import { getVendorRoster, getVendorOverview, getVendorBrokerThread } from "../../src/read-models/vendor";
import { getOpsOrgDirectory } from "../../src/read-models/ops";
import { landingFor } from "../../src/lib/auth/session";

interface Org { id: string; name: string }
interface User { id: string; fullName: string }

let cygnet: Org;   // DUAL ROLE
let nimbus: Org;   // supplies only
let acme: Org;     // hires only
let helix: Org;    // supplies only, group-linked
let broker: Org;   // Talentvibes

let cygnetAdmin: User;
let nimbusAdmin: User;

async function org(name: string): Promise<Org> {
  const [row] = await db
    .select({ id: s.organizations.id, name: s.organizations.name })
    .from(s.organizations).where(eq(s.organizations.name, name)).limit(1);
  if (!row) throw new Error(`test setup: no organisation named ${name}. Run npm run db:seed.`);
  return row;
}

/** A user at this org who holds the given membership role. */
async function userWithRole(orgId: string, role: string): Promise<User> {
  const rows = await db
    .select({ id: s.users.id, fullName: s.users.fullName, roles: s.memberships.roles })
    .from(s.users)
    .leftJoin(s.memberships, eq(s.memberships.userId, s.users.id))
    .where(eq(s.users.orgId, orgId));
  const hit = rows.find((r) => ((r.roles ?? []) as string[]).includes(role));
  if (!hit) throw new Error(`test setup: no user at ${orgId} holding ${role}`);
  return { id: hit.id, fullName: hit.fullName };
}

beforeAll(async () => {
  [cygnet, nimbus, acme, helix, broker] = await Promise.all([
    org("Cygnet Infotech Labs"), org("Nimbus Softworks"), org("Acme Finserv"),
    org("Helix Systems"), org("Talentvibes"),
  ]);
  [cygnetAdmin, nimbusAdmin] = await Promise.all([
    userWithRole(cygnet.id, "admin"),
    userWithRole(nimbus.id, "admin"),
  ]);
}, 60_000);

/* ====================================================================== */
/*  Acceptance test 1 — a supply-only org sees no hint of a hiring side    */
/* ====================================================================== */

describe("acceptance test 1: a single-capability org gets no workspace switcher", () => {
  it("REFUSES a hiring side to a supply-only organisation, even for its ADMIN", async () => {
    const caps = await getOrgCapabilities(nimbus.id);
    const roles = await getMembershipRoles(nimbusAdmin.id);

    // The admin genuinely holds the admin role — so if a hiring tab appeared it would be
    // the ORG capability leaking, not a role mistake. That is the distinction being pinned.
    expect(roles).toContain("admin");
    expect(caps.canHire).toBe(false);
    expect(availableSides(caps, roles)).toEqual(["bench"]);
  });

  it("returns an EMPTY tab list, not one tab — a lone tab is itself a hint", async () => {
    // This is the whole point of the empty-array contract. Returning one tab would have
    // the shell render a switcher with nothing to switch to, which tells a supply-only
    // company that the concept of sides exists.
    expect(await workspaceTabs(nimbus.id, nimbusAdmin.id, "vendor")).toEqual([]);
    expect(await workspaceTabs(nimbus.id, nimbusAdmin.id, "client")).toEqual([]);
  });

  it("does the same for a hire-only org and for a group-linked supplier", async () => {
    for (const o of [acme, helix]) {
      const caps = await getOrgCapabilities(o.id);
      expect(isDualRole(caps)).toBe(false);
      const u = await userWithRole(o.id, caps.canHire ? "demand" : "supply");
      expect(await workspaceTabs(o.id, u.id, caps.canHire ? "client" : "vendor")).toEqual([]);
    }
  });

  it("gives the BROKER no sides at all — it is not a party to the exchange", async () => {
    const caps = await getOrgCapabilities(broker.id);
    expect(caps).toEqual({ canSupply: false, canHire: false });
    const u = await userWithRole(broker.id, "admin");
    expect(availableSides(caps, await getMembershipRoles(u.id))).toEqual([]);
    expect(await workspaceTabs(broker.id, u.id, "ops")).toEqual([]);
  });
});

/* ====================================================================== */
/*  Acceptance test 2 — switch workspaces; each side shows only its rate   */
/* ====================================================================== */

describe("acceptance test 2: a dual-role user switches sides, each showing only its own rate", () => {
  it("ALLOWS both sides, so the control is not simply always hidden", async () => {
    // The control for test 1. Without this, a bug that returned [] unconditionally would
    // pass every assertion above.
    const caps = await getOrgCapabilities(cygnet.id);
    const roles = await getMembershipRoles(cygnetAdmin.id);
    expect(isDualRole(caps)).toBe(true);
    expect(availableSides(caps, roles).sort()).toEqual(["bench", "hiring"]);

    for (const portal of ["client", "vendor"] as const) {
      const tabs = await workspaceTabs(cygnet.id, cygnetAdmin.id, portal);
      expect(tabs.map((t) => t.side).sort()).toEqual(["bench", "hiring"]);
      // Exactly one tab is active, and it is the side you are on.
      expect(tabs.filter((t) => t.active)).toHaveLength(1);
      expect(tabs.find((t) => t.active)?.side).toBe(portal === "client" ? "hiring" : "bench");
    }
  });

  it("shows the dual-role org BANDS on its hiring side and no vendor rate", async () => {
    const sl = await getClientShortlist(cygnet.id, "REQ-2320");
    expect(sl).not.toBeNull();

    // There must be something to look at, or "no vendor rate present" passes vacuously —
    // the same trap as an empty candidate pool.
    expect(sl!.candidates.length).toBeGreaterThan(0);

    for (const c of sl!.candidates) {
      expect(c.rateBandLabel).toMatch(/₹/);
      expect(JSON.stringify(c)).not.toMatch(/vendor/i);
    }
  });

  it("shows the SAME org exact vendor rates on its bench side and no band", async () => {
    const roster = await getVendorRoster(cygnet.id);
    expect(roster.resources.length).toBeGreaterThan(0);

    for (const r of roster.resources) {
      expect(r.vendorRateLabel).toMatch(/₹/);
      /**
       * A band is a range; a vendor rate is a single exact figure. If a roster row ever
       * carried a band, the bench side would be showing the client-facing view too.
       *
       * Checked against FIELD NAMES, not against the row's text. This was
       * `JSON.stringify(r)).not.toMatch(/rateBand|band/i)`, which also matched any VALUE
       * containing those four letters — and the assessment status `abandoned` does
       * (a-BAND-oned). It failed the first time a real roster row carried one. A candidate
       * from Bandra, or named Bandyopadhyay, would have broken it the same way.
       */
      const keys: string[] = [];
      (function walkKeys(v: unknown) {
        if (Array.isArray(v)) v.forEach(walkKeys);
        else if (v && typeof v === "object") {
          for (const [k, inner] of Object.entries(v as Record<string, unknown>)) {
            keys.push(k);
            walkKeys(inner);
          }
        }
      })(r);
      expect(keys.filter((k) => /band/i.test(k)), "a band field on a bench row").toEqual([]);
    }
  });

  it("TEST 5 (reading A): the two rate views never appear in one payload", async () => {
    // Neither side's read model carries the other's rate, so no screen built from one of
    // them can show both. This is the structural form of the rule — a per-screen check
    // would only cover the screens that exist today.
    const [sl, roster] = await Promise.all([
      getClientShortlist(cygnet.id, "REQ-2320"),
      getVendorRoster(cygnet.id),
    ]);

    const hiring = JSON.stringify(sl);
    const bench = JSON.stringify(roster);

    expect(hiring).toMatch(/rateBand/);        // hiring has bands
    expect(hiring).not.toMatch(/vendorRate/);  // and no vendor rate
    expect(bench).toMatch(/vendorRate/);       // bench has the vendor rate
    expect(bench).not.toMatch(/rateBand/);     // and no band
    // And neither mentions a margin on any side.
    expect(hiring + bench).not.toMatch(/marginPct|marginPaise|spread/i);
  });

  it("TEST 5 (reading B): the broker holds neither capability, enforced in the DB", async () => {
    // Migration 0002's trigger refuses to give the broker a side. Attempting it must fail
    // rather than silently succeed, or the broker could appear as a counterparty.
    await expect(
      db.update(s.orgCapabilities)
        .set({ canSupply: true })
        .where(eq(s.orgCapabilities.orgId, broker.id)),
    ).rejects.toThrow();

    const caps = await getOrgCapabilities(broker.id);
    expect(caps).toEqual({ canSupply: false, canHire: false });
  });
});

/* ====================================================================== */
/*  Acceptance test 6 — flipping a capability moves the workspace          */
/* ====================================================================== */

describe("acceptance test 6: revoking can_hire removes the hiring workspace", () => {
  // Mutates a real row, so it is restored in afterAll even if an assertion throws.
  let restored = false;

  afterAll(async () => {
    if (!restored) {
      await db.update(s.orgCapabilities)
        .set({ canHire: true })
        .where(eq(s.orgCapabilities.orgId, cygnet.id));
    }
  }, 30_000);

  it("removes the switcher entirely when the capability is revoked, and restores it", async () => {
    // before: two sides
    expect(await workspaceTabs(cygnet.id, cygnetAdmin.id, "vendor")).toHaveLength(2);

    await db.update(s.orgCapabilities)
      .set({ canHire: false })
      .where(eq(s.orgCapabilities.orgId, cygnet.id));

    // after: no switcher at all — not a disabled hiring tab
    const caps = await getOrgCapabilities(cygnet.id);
    expect(caps.canHire).toBe(false);
    expect(availableSides(caps, await getMembershipRoles(cygnetAdmin.id))).toEqual(["bench"]);
    expect(await workspaceTabs(cygnet.id, cygnetAdmin.id, "vendor")).toEqual([]);

    // The user's membership still says `demand`. The ORG capability is what closed the
    // door, which is the point of test 6: no second account, no migration.
    expect(await getMembershipRoles(cygnetAdmin.id)).toContain("demand");

    // and the hiring portal now requires a capability the org does not hold
    const need = requiredCapability("client");
    expect(need).toBe("canHire");
    expect(caps[need!]).toBe(false);

    await db.update(s.orgCapabilities)
      .set({ canHire: true })
      .where(eq(s.orgCapabilities.orgId, cygnet.id));
    restored = true;

    expect(await workspaceTabs(cygnet.id, cygnetAdmin.id, "vendor")).toHaveLength(2);
  }, 60_000);
});

/* ====================================================================== */
/*  Role gating is separate from capability gating                         */
/* ====================================================================== */

describe("a role at a dual-role org only opens the side it holds", () => {
  it("gives a supply-only membership one side even though the ORG holds both", async () => {
    const caps = await getOrgCapabilities(cygnet.id);
    expect(isDualRole(caps)).toBe(true);

    // Synthetic roles rather than a seeded user: the point is the function's contract, and
    // the seed has no non-admin at this org to borrow.
    expect(availableSides(caps, ["supply"])).toEqual(["bench"]);
    expect(availableSides(caps, ["demand"])).toEqual(["hiring"]);
    expect(availableSides(caps, ["supply", "demand"]).sort()).toEqual(["bench", "hiring"]);
    expect(availableSides(caps, ["admin"]).sort()).toEqual(["bench", "hiring"]);
  });

  it("gives an empty list when the membership holds no usable role", async () => {
    const caps = await getOrgCapabilities(cygnet.id);
    expect(availableSides(caps, [])).toEqual([]);
  });
});

/* ====================================================================== */
/*  The ops organisation directory is the most sensitive screen built      */
/* ====================================================================== */

describe("the ops org directory carries what only the broker may see", () => {
  it("reports capabilities, group, fee model and blocks — so the screen is worth guarding", async () => {
    const dir = await getOpsOrgDirectory();
    expect(dir.length).toBeGreaterThan(0);

    const cyg = dir.find((o) => o.name === "Cygnet Infotech Labs")!;
    expect(cyg.isDualRole).toBe(true);
    // The commercial half of the masking rule: a company on both sides must be on a
    // declared fee, or it reads the spread off its own two statements.
    expect(cyg.feeModel).toBe("flat_declared_fee");

    const helix = dir.find((o) => o.name === "Helix Systems")!;
    const vantage = dir.find((o) => o.name === "Vantage Insurance")!;
    expect(helix.groupName).toBe("Helix Group");
    expect(helix.groupSiblings).toContain("Vantage Insurance");
    expect(vantage.groupSiblings).toContain("Helix Systems");

    // A block hides each side from the other, so it must appear on BOTH rows. A
    // one-directional reading here would mean one of the two still sees the other.
    const north = dir.find((o) => o.name === "Northwind Retail")!;
    const orbit = dir.find((o) => o.name === "Orbit Talent Services")!;
    expect(north.blockedWith).toContain("Orbit Talent Services");
    expect(orbit.blockedWith).toContain("Northwind Retail");

    // The broker is not a party and has no side, no fee and no bench.
    const broker = dir.find((o) => o.name === "Talentvibes")!;
    expect(broker.canSupply).toBe(false);
    expect(broker.canHire).toBe(false);
    expect(broker.feeModelLabel).toBe("—");
  });

  it("is the ONLY place both sides of one org's money appear together", async () => {
    const dir = await getOpsOrgDirectory();
    const cyg = dir.find((o) => o.name === "Cygnet Infotech Labs")!;

    // Ops sees both figures. For a dual-role org these two ARE the spread, which is why
    // this screen is ops-only and why such orgs are on a declared fee.
    expect(cyg).toHaveProperty("billedAsClientLabel");
    expect(cyg).toHaveProperty("paidAsSupplierLabel");

    // Neither portal read model carries anything of the sort for the same organisation.
    const [overview, roster] = await Promise.all([
      getVendorOverview(cyg.orgId, "Test Viewer"),
      getVendorRoster(cyg.orgId),
    ]);
    const payload = JSON.stringify({ overview, roster });
    for (const forbidden of [
      "billedAsClient", "paidAsSupplier", "netPosition",
      "canSupply", "canHire", "isDualRole",
      "feeModel", "blockedWith", "groupSiblings",
      "probingSuspect",
    ]) {
      expect(payload).not.toMatch(new RegExp(forbidden, "i"));
    }
  });

  it("does not invent a probing threshold the spec never defined", async () => {
    const dir = await getOpsOrgDirectory();
    // `isProbingSuspect` must track the view's own count and nothing else. An earlier
    // draft also flagged "3+ open roles and never placed", a rule that appears nowhere in
    // the brief; CLAUDE.md working agreement 8 forbids inventing one silently.
    for (const o of dir) {
      expect(o.isProbingSuspect).toBe(o.probingSuspectRequirements > 0);
    }
  });
});

/* ====================================================================== */
/*  One broker thread per workspace, never mixed                           */
/* ====================================================================== */

describe("a dual-role org's two broker threads never mix", () => {
  /**
   * This is the case the rule exists for, and it is the only case where it bites.
   *
   * For every other organisation `counterparty_org_id` alone identifies the conversation:
   * Acme is a client, Vertex is a vendor. A dual-role organisation has TWO threads carrying
   * the SAME counterparty id, so `side` is the discriminator — and a read path that filters
   * only on the organisation would return both and mix them, putting messages about the
   * roles Cygnet is trying to fill into its bench workspace.
   */
  it("gives each side its own thread, and they are different threads", async () => {
    const [hiring, bench] = await Promise.all([
      getClientBrokerThread(cygnet.id),
      getVendorBrokerThread(cygnet.id),
    ]);

    expect(hiring).not.toBeNull();
    expect(bench).not.toBeNull();

    // Both must have content, or "no leakage" passes by both being empty.
    expect(hiring!.messages.length).toBeGreaterThan(0);
    expect(bench!.messages.length).toBeGreaterThan(0);

    // Different conversations, not the same thread read twice.
    expect(hiring!.scopeLabel).not.toBe(bench!.scopeLabel);
  });

  it("keeps each side's messages out of the other", async () => {
    const [hiring, bench] = await Promise.all([
      getClientBrokerThread(cygnet.id),
      getVendorBrokerThread(cygnet.id),
    ]);

    const hiringBodies = hiring!.messages.map((m) => m.body);
    const benchBodies = bench!.messages.map((m) => m.body);

    for (const b of benchBodies) expect(hiringBodies).not.toContain(b);
    for (const b of hiringBodies) expect(benchBodies).not.toContain(b);

    // A vendor-side thread may only ever carry vendor and ops messages. A client's words
    // reaching the bench workspace is the breach this guards.
    for (const m of bench!.messages) {
      expect(["vendor", "ops"]).toContain(m.senderSide);
    }
  });

  it("never exposes the redaction note, which records what was removed", async () => {
    const [hiring, bench] = await Promise.all([
      getClientBrokerThread(cygnet.id),
      getVendorBrokerThread(cygnet.id),
    ]);
    const payload = JSON.stringify({ hiring, bench });
    expect(payload).not.toMatch(/redaction/i);
    // Nor the linkage that tells ops two threads are halves of one relayed exchange.
    expect(payload).not.toMatch(/linkedThread|linked_thread/i);
  });

  it("STILL WORKS for a single-sided org, so the filter is not refusing everything", async () => {
    // The control. Acme hires only: it has a client thread and must have no vendor one.
    const [acmeHiring, acmeBench] = await Promise.all([
      getClientBrokerThread(acme.id),
      getVendorBrokerThread(acme.id),
    ]);
    expect(acmeHiring).not.toBeNull();
    expect(acmeHiring!.messages.length).toBeGreaterThan(0);
    expect(acmeBench).toBeNull();

    // And Nimbus supplies only: a bench thread is absent rather than borrowed from
    // another organisation.
    expect(await getVendorBrokerThread(nimbus.id)).toBeNull();
  });
});

/**
 * Which portal an organisation lands on.
 *
 * Pure, and it now has two consumers: the organisation switcher's hrefs, and `/`, which is
 * a router rather than a page since the smoke screen was removed. Pinned here because the
 * switcher's hrefs were never asserted, so a change to this rule would have moved where
 * the root URL sends people with nothing failing.
 */
describe("landingFor", () => {
  const org = (canSupply: boolean, canHire: boolean, isOps = false) =>
    ({ canSupply, canHire, isOps });

  it("sends a hire-only organisation to the client portal", () => {
    expect(landingFor(org(false, true))).toBe("/client");
  });

  it("sends a supply-only organisation to the vendor portal", () => {
    expect(landingFor(org(true, false))).toBe("/vendor");
  });

  it("sends a DUAL-ROLE organisation to the vendor portal, where the tabs offer the other", () => {
    // Arbitrary but consistent: a dual-role org has to start somewhere, and the workspace
    // tabs make the other side one click away and visible.
    expect(landingFor(org(true, true))).toBe("/vendor");
  });

  it("sends the broker to the ops console regardless of capabilities", () => {
    expect(landingFor(org(false, false, true))).toBe("/ops");
    expect(landingFor(org(true, true, true))).toBe("/ops");
  });
});
