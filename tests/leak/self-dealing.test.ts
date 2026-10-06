/**
 * Self-dealing and block-list enforcement.
 *
 * These are not "does the feature work" tests. Each one ATTEMPTS A BYPASS and asserts the
 * attempt fails, because the rule is the product: a company that gets handed its own
 * people has been charged a brokerage fee to quote itself, and an organisation that
 * blocked a supplier and then sees their profiles has been told its block does nothing.
 *
 * Covers acceptance tests 3 and 4 from the dual-role brief:
 *   3. An org's own bench and its group's bench never appear in its own shortlist.
 *   4. A blocked org cannot see the blocker's bench or requirements.
 */
import { describe, expect, it, beforeAll } from "vitest";
import { and, eq, sql } from "drizzle-orm";
import { db } from "../../src/db/client";
import * as s from "../../src/db/schema";
import { isSelfDealing, refusalReason } from "../../src/services/matching-eligibility";
import { getOpsMatchingWorkspace } from "../../src/read-models/ops";
import { getClientShortlist } from "../../src/read-models/client";

interface Org { id: string; name: string; parentGroupId: string | null }

let cygnet: Org;      // DUAL ROLE: supplies and hires
let helix: Org;       // supplies, in Helix Group
let vantage: Org;     // hires, in Helix Group — a different legal entity, same group
let orbit: Org;       // blocked with Northwind
let northwind: Org;   // blocked with Orbit
let acme: Org;

async function org(name: string): Promise<Org> {
  const [row] = await db
    .select({ id: s.organizations.id, name: s.organizations.name, parentGroupId: s.organizations.parentGroupId })
    .from(s.organizations).where(eq(s.organizations.name, name)).limit(1);
  if (!row) throw new Error(`test setup: no organisation named ${name}. Run npm run db:seed.`);
  return row;
}

beforeAll(async () => {
  [cygnet, helix, vantage, orbit, northwind, acme] = await Promise.all([
    org("Cygnet Infotech Labs"), org("Helix Systems"), org("Vantage Insurance"),
    org("Orbit Talent Services"), org("Northwind Retail"), org("Acme Finserv"),
  ]);
}, 60_000);

/* ====================================================================== */
/*  The seeded world is actually set up to make these tests meaningful     */
/* ====================================================================== */

describe("the fixtures make self-dealing possible, so refusing it means something", () => {
  it("Cygnet is dual-role: it both supplies and hires", async () => {
    const [cap] = await db
      .select({ canSupply: s.orgCapabilities.canSupply, canHire: s.orgCapabilities.canHire })
      .from(s.orgCapabilities).where(eq(s.orgCapabilities.orgId, cygnet.id)).limit(1);
    expect(cap, "org_capabilities is empty — run npm run db:seed").toBeDefined();
    expect(cap.canSupply).toBe(true);
    expect(cap.canHire).toBe(true);
  });

  it("Helix and Vantage are different orgs in the SAME declared group", () => {
    expect(helix.id).not.toBe(vantage.id);
    expect(helix.parentGroupId).not.toBeNull();
    expect(helix.parentGroupId).toBe(vantage.parentGroupId);
  });

  it("Cygnet has people on its own bench and a requirement of its own", async () => {
    const [bench] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.benchResources).where(eq(s.benchResources.vendorOrgId, cygnet.id));
    const [reqs] = await db
      .select({ n: sql<number>`count(*)::int` })
      .from(s.requirements).where(eq(s.requirements.clientOrgId, cygnet.id));
    expect(bench.n, "Cygnet should have its own bench").toBeGreaterThan(0);
    expect(reqs.n, "Cygnet should be hiring, or the rule has nothing to refuse").toBeGreaterThan(0);
  });

  it("Orbit and Northwind have blocked each other", async () => {
    const [blocked] = await db.execute<{ b: boolean }>(
      sql`select orgs_are_blocked(${orbit.id}, ${northwind.id}) as b`,
    ) as unknown as Array<{ b: boolean }>;
    expect(blocked.b).toBe(true);
  });
});

/* ====================================================================== */
/*  The rule itself                                                        */
/* ====================================================================== */

describe("the self-dealing predicate", () => {
  it("refuses the same organisation", () => {
    expect(isSelfDealing({
      vendorOrgId: cygnet.id, vendorGroupId: null,
      clientOrgId: cygnet.id, clientGroupId: null,
    })).toBe(true);
  });

  it("refuses two organisations in the same declared group", () => {
    expect(isSelfDealing({
      vendorOrgId: helix.id, vendorGroupId: helix.parentGroupId,
      clientOrgId: vantage.id, clientGroupId: vantage.parentGroupId,
    })).toBe(true);
  });

  it("does NOT treat two ungrouped organisations as related", () => {
    // The trap: `null = null` is NULL in SQL and false-y in JS, but a naive
    // implementation that compared groups without a null guard would call every
    // ungrouped pair self-dealing and empty the exchange.
    expect(isSelfDealing({
      vendorOrgId: orbit.id, vendorGroupId: null,
      clientOrgId: acme.id, clientGroupId: null,
    })).toBe(false);
  });

  it("reports WHY, so ops can be told", () => {
    expect(refusalReason({
      vendorOrgId: cygnet.id, vendorGroupId: null, clientOrgId: cygnet.id, clientGroupId: null,
    }, false)).toBe("self_dealing_same_org");

    expect(refusalReason({
      vendorOrgId: helix.id, vendorGroupId: helix.parentGroupId,
      clientOrgId: vantage.id, clientGroupId: vantage.parentGroupId,
    }, false)).toBe("self_dealing_same_group");

    expect(refusalReason({
      vendorOrgId: orbit.id, vendorGroupId: null, clientOrgId: northwind.id, clientGroupId: null,
    }, true)).toBe("blocked");
  });
});

describe("the database agrees with the application", () => {
  it("is_self_dealing() flags Helix supplying Vantage", async () => {
    const [helixResource] = await db
      .select({ id: s.benchResources.id })
      .from(s.benchResources).where(eq(s.benchResources.vendorOrgId, helix.id)).limit(1);
    const [vantageReq] = await db
      .select({ id: s.requirements.id })
      .from(s.requirements).where(eq(s.requirements.clientOrgId, vantage.id)).limit(1);
    if (!helixResource || !vantageReq) return; // nothing to assert on this seed

    const [row] = await db.execute<{ v: boolean }>(
      sql`select is_self_dealing(${helixResource.id}, ${vantageReq.id}) as v`,
    ) as unknown as Array<{ v: boolean }>;
    expect(row.v, "same declared group must count as self-dealing").toBe(true);
  });

  it("is_self_dealing() does NOT flag an unrelated pair", async () => {
    const [nimbusResource] = await db
      .select({ id: s.benchResources.id, vendorOrgId: s.benchResources.vendorOrgId })
      .from(s.benchResources)
      .innerJoin(s.organizations, eq(s.organizations.id, s.benchResources.vendorOrgId))
      .where(eq(s.organizations.name, "Nimbus Softworks")).limit(1);
    const [acmeReq] = await db
      .select({ id: s.requirements.id })
      .from(s.requirements).where(eq(s.requirements.clientOrgId, acme.id)).limit(1);

    const [row] = await db.execute<{ v: boolean }>(
      sql`select is_self_dealing(${nimbusResource.id}, ${acmeReq.id}) as v`,
    ) as unknown as Array<{ v: boolean }>;
    expect(row.v).toBe(false);
  });
});

/* ====================================================================== */
/*  BYPASS ATTEMPTS — these must all fail                                  */
/* ====================================================================== */

describe("bypassing the rule in the database", () => {
  /**
   * Insert a match directly, as a buggy new code path would.
   *
   * Two things this has to get right, both learned the hard way:
   *
   *   - Drizzle wraps the driver error, so `err.message` is a generic "Failed query: …".
   *     The trigger's own text is on `err.cause`. Asserting against the wrapper made a
   *     working refusal look like a failure.
   *   - `matches` has UNIQUE (requirement_id, resource_id), and the seed has already
   *     matched the legitimate pairs. Inserting one again violates that constraint, which
   *     made the control case — "a legitimate pairing still succeeds" — look refused. So
   *     the existing row is removed inside the transaction first.
   *
   * Everything happens in a transaction that always rolls back, so the test leaves no
   * trace either way.
   */
  function causeChain(e: unknown): string {
    const parts: string[] = [];
    let cur: unknown = e;
    for (let i = 0; i < 5 && cur; i++) {
      const err = cur as { message?: string; cause?: unknown };
      if (err.message) parts.push(err.message);
      cur = err.cause;
    }
    return parts.join(" | ");
  }

  async function attemptMatch(vendorOrgName: string, clientOrgName: string) {
    const [resource] = await db
      .select({ id: s.benchResources.id })
      .from(s.benchResources)
      .innerJoin(s.organizations, eq(s.organizations.id, s.benchResources.vendorOrgId))
      .where(eq(s.organizations.name, vendorOrgName)).limit(1);
    const [req] = await db
      .select({ id: s.requirements.id })
      .from(s.requirements)
      .innerJoin(s.organizations, eq(s.organizations.id, s.requirements.clientOrgId))
      .where(eq(s.organizations.name, clientOrgName)).limit(1);
    if (!resource || !req) return { skipped: true as const };

    try {
      await db.transaction(async (tx) => {
        // Clear any seeded row for this pair so the UNIQUE constraint is not what we hit.
        await tx.delete(s.matches).where(and(
          eq(s.matches.requirementId, req.id),
          eq(s.matches.resourceId, resource.id),
        ));
        await tx.insert(s.matches).values({
          requirementId: req.id, resourceId: resource.id,
          algoScore: 90, scoreSkill: 90, scoreTest: 90, scoreExpFit: 90,
          scoreRate: 90, scoreFreshness: 90, scoreVendor: 90,
          algoRank: 999, computedAt: new Date(),
        });
        throw new Error("__rollback__");
      });
      return { refused: false as const, message: "" };
    } catch (e) {
      const msg = causeChain(e);
      if (msg.includes("__rollback__")) {
        return { refused: false as const, message: "INSERT SUCCEEDED" };
      }
      return { refused: true as const, message: msg };
    }
  }

  it("REFUSES a dual-role org being offered its own bench", async () => {
    const r = await attemptMatch("Cygnet Infotech Labs", "Cygnet Infotech Labs");
    if ("skipped" in r) return;
    expect(r.refused, `the database accepted a self-dealing match: ${r.message}`).toBe(true);
    expect(r.message.toLowerCase()).toContain("self-dealing");
  });

  it("REFUSES a group sibling's bench (Helix -> Vantage)", async () => {
    const r = await attemptMatch("Helix Systems", "Vantage Insurance");
    if ("skipped" in r) return;
    expect(r.refused, `the database accepted a same-group match: ${r.message}`).toBe(true);
    expect(r.message.toLowerCase()).toContain("self-dealing");
  });

  it("REFUSES a blocked pairing (Orbit -> Northwind)", async () => {
    const r = await attemptMatch("Orbit Talent Services", "Northwind Retail");
    if ("skipped" in r) return;
    expect(r.refused, `the database accepted a blocked match: ${r.message}`).toBe(true);
    expect(r.message.toLowerCase()).toContain("blocked");
  });

  it("STILL ALLOWS a legitimate pairing, so the rule is not simply refusing everything", async () => {
    const r = await attemptMatch("Nimbus Softworks", "Acme Finserv");
    if ("skipped" in r) return;
    expect(r.refused, `a legitimate match was refused: ${r.message}`).toBe(false);
    expect(r.message).toBe("INSERT SUCCEEDED");
  });
});

/* ====================================================================== */
/*  Acceptance 3 and 4, through the read models                            */
/* ====================================================================== */

describe("acceptance 3: an org never sees its own or its group's bench", () => {
  it("no candidate in any matching pool is self-dealing", async () => {
    const reqs = await db
      .select({ code: s.requirements.code })
      .from(s.requirements)
      .where(sql`${s.requirements.stage} in ('matching','shortlisted','interviewing','placed')`);

    const offenders: string[] = [];
    for (const r of reqs) {
      const ws = await getOpsMatchingWorkspace(r.code);
      if (!ws) continue;
      for (const c of ws.candidates) {
        const [row] = await db.execute<{ v: boolean }>(sql`
          select is_self_dealing(
            (select id from bench_resources where masked_id = ${c.maskedId}),
            (select id from requirements where code = ${r.code})
          ) as v
        `) as unknown as Array<{ v: boolean }>;
        if (row.v) offenders.push(`${r.code} offers ${c.maskedId} (${c.vendorName})`);
      }
    }
    expect(offenders, "a self-dealing candidate reached a matching pool").toEqual([]);
  }, 120_000);

  it("no masked shortlist item is self-dealing either", async () => {
    const rows = await db.execute<{ code: string; masked_id: string }>(sql`
      select r.code, si.masked_id
        from shortlist_items si
        join shortlists sl on sl.id = si.shortlist_id
        join requirements r on r.id = sl.requirement_id
       where is_self_dealing(si.resource_id, sl.requirement_id)
          or match_is_blocked(si.resource_id, sl.requirement_id)
    `) as unknown as Array<{ code: string; masked_id: string }>;
    expect(
      rows.map((r) => `${r.code}/${r.masked_id}`),
      "a self-dealing or blocked profile is sitting on a client shortlist",
    ).toEqual([]);
  });
});

describe("acceptance 4: a blocked org sees nothing of the blocker", () => {
  it("Northwind's shortlists contain no Orbit profile", async () => {
    const codes = await db
      .select({ code: s.requirements.code })
      .from(s.requirements).where(eq(s.requirements.clientOrgId, northwind.id));

    for (const { code } of codes) {
      const view = await getClientShortlist(northwind.id, code);
      if (!view) continue;
      for (const c of view.candidates) {
        const [row] = await db.execute<{ blocked: boolean }>(sql`
          select orgs_are_blocked(
            (select vendor_org_id from bench_resources where masked_id = ${c.maskedId}),
            ${northwind.id}
          ) as blocked
        `) as unknown as Array<{ blocked: boolean }>;
        expect(row.blocked, `${code} shows ${c.maskedId} from a blocked supplier`).toBe(false);
      }
    }
  }, 120_000);

  it("the block is symmetric — it holds whichever way round it is asked", async () => {
    const [ab] = await db.execute<{ b: boolean }>(
      sql`select orgs_are_blocked(${orbit.id}, ${northwind.id}) as b`,
    ) as unknown as Array<{ b: boolean }>;
    const [ba] = await db.execute<{ b: boolean }>(
      sql`select orgs_are_blocked(${northwind.id}, ${orbit.id}) as b`,
    ) as unknown as Array<{ b: boolean }>;
    expect(ab.b).toBe(true);
    expect(ba.b).toBe(true);
  });
});
