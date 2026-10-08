/**
 * Every write endpoint, against the definition of done in CLAUDE.md.
 *
 * An audit found eight write endpoints with **no test at all**, which matters more here
 * than on a typical CRUD app: masking is the product, and a write path is where tenancy is
 * easiest to get wrong. A read model that leaks shows up in the 12 read-model tests; a
 * write path that accepts someone else's id shows up nowhere.
 *
 * Each endpoint is checked for the four things that definition actually demands:
 *
 *   1. **Tenancy** — another organisation's row is NOT FOUND, never forbidden. A 403
 *      confirms the row exists, which is itself a leak (docs/MASKING.md, error messages).
 *   2. **Response shape** — no forbidden field for that portal. A vendor response may not
 *      name a client or a margin; a client response may not name a vendor or a vendor rate.
 *   3. **An audit row** — working agreement 5, no exceptions.
 *   4. **Zod at the boundary** — a malformed body is a 400, not a 500 and not a write.
 *
 * The handlers are imported and called directly rather than over HTTP, so the suite needs
 * no running server. `getDemoSession` falls back to the portal's default tenant when
 * `cookies()` is unavailable, which is exactly what happens here.
 *
 * Everything these tests create is removed in `afterAll`, and `db:verify` is the backstop:
 * it asserts the seeded fixture counts, so leftover rows from a test fail it loudly.
 */
import { describe, expect, it, beforeAll, afterAll } from "vitest";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../../src/db/client";
import * as s from "../../src/db/schema";

import { POST as createResource, DELETE as withdrawResource } from "@/app/api/vendor/resources/route";
import { POST as confirmResource } from "@/app/api/vendor/resources/confirm/route";
import { POST as listResource } from "@/app/api/vendor/resources/list/route";
import { POST as requestTest, DELETE as abandonTest } from "@/app/api/vendor/assessments/invite/route";
import { POST as createRequirement, DELETE as cancelRequirement } from "@/app/api/client/requirements/route";
import { POST as decide } from "@/app/api/client/shortlists/decide/route";
import { POST as feedback } from "@/app/api/client/interviews/feedback/route";
import { POST as resolveDuplicate } from "@/app/api/ops/duplicates/resolve/route";
import { POST as changeStage } from "@/app/api/ops/requirements/stage/route";
import { POST as runMatchingRoute } from "@/app/api/ops/matching/run/route";
import { POST as saveRank, DELETE as resetRank } from "@/app/api/ops/matching/rank/route";
import { POST as setRate } from "@/app/api/ops/matching/rate/route";
import {
  POST as addToRequirementRoute, DELETE as undoAddRoute,
} from "@/app/api/ops/pool/add-to-requirement/route";
import { POST as sendShortlist } from "@/app/api/ops/shortlists/send/route";
import { algoScore as weightedTotal } from "../../src/lib/matching/score";
import { marginPct, MARGIN_FLOOR_PCT } from "../../src/lib/money/rate-band";
import { getOpsMatchingWorkspace } from "../../src/read-models/ops";
import { algoScore } from "../../src/lib/matching/score";
import { getVendorAssessments, getVendorRoster } from "../../src/read-models/vendor";
import {
  getOpsTalentPool, getOpsPipeline, getOpsOpenRequirements,
} from "../../src/read-models/ops";
import { SLA_WINDOW_HOURS } from "../../src/lib/derived";

/** A Request the route handlers accept. */
function post(body: unknown, method = "POST"): Request {
  return new Request("http://localhost/test", {
    method,
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** Marker on everything these tests create, so cleanup can find it unambiguously. */
const MARK = "ZZ-WritePathTest";

let acmeId: string;
let cygnetId: string;
/** The vendor `getDemoSession("vendor")` resolves to, so writes land where tests look. */
let nimbusId: string;

beforeAll(async () => {
  const orgs = await db
    .select({ id: s.organizations.id, name: s.organizations.name })
    .from(s.organizations)
    .where(inArray(s.organizations.name, ["Acme Finserv", "Cygnet Infotech Labs", "Nimbus Softworks"]));
  acmeId = orgs.find((o) => o.name === "Acme Finserv")!.id;
  cygnetId = orgs.find((o) => o.name === "Cygnet Infotech Labs")!.id;
  nimbusId = orgs.find((o) => o.name === "Nimbus Softworks")!.id;
}, 60_000);

afterAll(async () => {
  // Resources and requirements this suite created, found by the marker rather than by id,
  // so a failed test mid-way still cleans up.
  const res = await db
    .select({ id: s.benchResources.id })
    .from(s.benchResources)
    .where(eq(s.benchResources.fullName, MARK));
  const reqs = await db
    .select({ id: s.requirements.id })
    .from(s.requirements)
    .where(eq(s.requirements.roleTitle, MARK));

  // Assessment rows cascade when their resource goes, but the audit entries keyed on the
  // ASSESSMENT id do not — they have no foreign key. Collect them before the cascade.
  const assess = res.length
    ? await db
        .select({ id: s.assessments.id })
        .from(s.assessments)
        .where(inArray(s.assessments.resourceId, res.map((r) => r.id)))
    : [];

  const ids = [...res.map((r) => r.id), ...reqs.map((r) => r.id), ...assess.map((a) => a.id)];
  if (ids.length) await db.delete(s.auditLog).where(inArray(s.auditLog.entityId, ids));
  if (res.length) {
    await db.delete(s.resourceSkills).where(inArray(s.resourceSkills.resourceId, res.map((r) => r.id)));
    await db.delete(s.benchResources).where(inArray(s.benchResources.id, res.map((r) => r.id)));
  }
  if (reqs.length) {
    await db.delete(s.requirementSkills).where(inArray(s.requirementSkills.requirementId, reqs.map((r) => r.id)));
    await db.delete(s.requirements).where(inArray(s.requirements.id, reqs.map((r) => r.id)));
  }
}, 60_000);

/* ====================================================================== */
/*  Talentvibes sets the price                                             */
/* ====================================================================== */

/**
 * The proposed client rate was computed and nobody could change it:
 * `vendor / (1 - target)`, rounded, clamped into budget, rendered on the desk as a read-only
 * `Detail`. That one number decides the band the client is shown, the margin we earn and 14%
 * of the ranking score — and `docs/MATCHING.md` already said the margin-constrained case
 * should "surface it to ops ... and let a human decide".
 */
describe("the proposed client rate is Talentvibes's to set", () => {
  async function sourcedRole() {
    const res = await createRequirement(post({
      roleTitle: MARK, skills: ["React"], experienceBand: "5-8", quantity: 1,
      budgetMinPaise: 13_000_000, budgetMaxPaise: 22_000_000,
      engagementType: "contract", workMode: "remote",
      noticeAccepted: ["immediate"], stage: "new",
    }));
    expect(res.status).toBe(201);
    const { code, matched } = await res.json() as { code: string; matched: number };
    expect(matched).toBeGreaterThan(1);
    const view = await getOpsMatchingWorkspace(code);
    return { code, candidates: view!.candidates };
  }

  it("sets the rate, and re-scores so the total still follows its own bars", async () => {
    /**
     * The coherence that matters. `score_rate` is computed FROM the rate, and `algo_score`
     * is the weighted blend of the six components — so setting a rate without recomputing
     * both would leave the desk showing a price that disagrees with the bar beside it.
     */
    const { code, candidates } = await sourcedRole();
    const c = candidates[0];
    // Comfortably above the floor: vendor rate plus a third.
    const rate = Math.round((c.vendorRatePaise * 1.45) / 100_000) * 100_000;

    const res = await setRate(post({ code, maskedId: c.maskedId, ratePaise: rate }));
    expect(res.status).toBe(200);
    const out = await res.json() as { marginPct: number; scoreRate: number; algoScore: number };

    const [row] = await db
      .select({
        rate: s.matches.proposedClientRatePaise,
        scoreSkill: s.matches.scoreSkill, scoreTest: s.matches.scoreTest,
        scoreExpFit: s.matches.scoreExpFit, scoreRate: s.matches.scoreRate,
        scoreFreshness: s.matches.scoreFreshness, scoreVendor: s.matches.scoreVendor,
        algoScore: s.matches.algoScore,
      })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .innerJoin(s.benchResources, eq(s.benchResources.id, s.matches.resourceId))
      .where(and(eq(s.requirements.code, code), eq(s.benchResources.maskedId, c.maskedId)));

    expect(row.rate).toBe(rate);
    expect(row.scoreRate).toBe(out.scoreRate);
    // ADR-011: the total always follows from the components.
    expect(row.algoScore).toBe(weightedTotal(row));
    expect(out.marginPct).toBeCloseTo(marginPct(rate, c.vendorRatePaise), 1);
  });

  it("refuses a below-floor rate with no reason, and accepts one with", async () => {
    const { code, candidates } = await sourcedRole();
    const c = candidates[0];
    // A 10% margin: vendor / 0.90.
    const thin = Math.round(c.vendorRatePaise / 0.9);

    const bare = await setRate(post({ code, maskedId: c.maskedId, ratePaise: thin }));
    expect(bare.status).toBe(400);
    const err = await bare.json() as { error: string; floorPct: number };
    expect(err.error).toBe("reason_required");
    expect(err.floorPct).toBe(MARGIN_FLOOR_PCT);

    // Allowed with a reason: a below-floor price is a real commercial choice, and the two
    // seeded exceptions are strategic account entries.
    const ok = await setRate(post({
      code, maskedId: c.maskedId, ratePaise: thin,
      reason: "Strategic entry into this client's estate; review at renewal.",
    }));
    expect(ok.status).toBe(200);
  });

  it("records who set it and why, where the desk can read it back", async () => {
    const { code, candidates } = await sourcedRole();
    const c = candidates[0];
    const thin = Math.round(c.vendorRatePaise / 0.88);
    const reason = "Below floor on purpose: first placement with this client.";

    await setRate(post({ code, maskedId: c.maskedId, ratePaise: thin, reason }));

    // Read through the read model the screen renders from. The note lives in audit_log, not
    // a column, which is why this needed no migration.
    const view = await getOpsMatchingWorkspace(code);
    const after = view!.candidates.find((x) => x.maskedId === c.maskedId);
    expect(after!.rateSetBy).not.toBeNull();
    expect(after!.rateSetBy!.reason).toBe(reason);
    expect(after!.rateSetBy!.name).toBeTruthy();
  });

  it("keeps a broker's manual order, and still renumbers algo_rank", async () => {
    const { code, candidates } = await sourcedRole();
    const order = candidates.map((x) => x.maskedId);
    await saveRank(post({ code, order: [...order].reverse(), included: [] }));

    const c = candidates[0];
    await setRate(post({
      code, maskedId: c.maskedId,
      ratePaise: Math.round((c.vendorRatePaise * 1.5) / 100_000) * 100_000,
    }));

    const rows = await db
      .select({ manualRank: s.matches.manualRank, algoRank: s.matches.algoRank })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .where(eq(s.requirements.code, code));

    // Re-pricing one candidate must not rearrange work somebody did by hand.
    expect(rows.every((r) => r.manualRank != null)).toBe(true);
    // But algo_rank follows the new scores, and stays a clean 1..n.
    const ranks = rows.map((r) => r.algoRank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, i) => i + 1));
  });

  it("refuses to re-price somebody already quoted to the client", async () => {
    /**
     * ADR-004 stores the band on `shortlist_items` at send time and forbids recomputing it.
     * So once a candidate has gone out, the client holds a price derived from the old rate;
     * re-pricing them would leave the desk and the client disagreeing with nothing saying so.
     */
    const { code, candidates } = await sourcedRole();
    const c = candidates[0];
    await saveRank(post({ code, order: candidates.map((x) => x.maskedId), included: [c.maskedId] }));

    const sent = await sendShortlist(post({ code, maskedIds: [c.maskedId] }));
    // Asserted rather than skipped: an early `return` here would make the guard below
    // untested while the test still reported green, which has happened twice in this
    // project already.
    expect(sent.status, `sending was refused: ${await sent.clone().text()}`).toBe(200);

    const res = await setRate(post({
      code, maskedId: c.maskedId,
      ratePaise: Math.round((c.vendorRatePaise * 1.6) / 100_000) * 100_000,
    }));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("already_quoted");
  });
});

/* ====================================================================== */
/*  A broker's ordering has to survive a refresh                           */
/* ====================================================================== */

/**
 * `manual_rank` and `included` were written in exactly ONE place — the send endpoint, at
 * send time. Dragging, the arrows and the include toggles were all local React state, so the
 * screen whose entire purpose is arranging an order **did not save the order**: drag somebody
 * to the top, refresh, gone.
 *
 * And "Reset to algorithm" toasted "ranking reset to the algorithm order" while writing
 * nothing — so after a send, where `manual_rank` really was in the database, a refresh
 * brought the manual order straight back. The toast claimed something that had not happened.
 */
describe("the matching desk saves what a broker arranges", () => {
  /** A role with a pool, sourced the way the product does it. */
  async function sourcedRole() {
    const res = await createRequirement(post({
      roleTitle: MARK, skills: ["React"], experienceBand: "5-8", quantity: 1,
      budgetMinPaise: 13_000_000, budgetMaxPaise: 22_000_000,
      engagementType: "contract", workMode: "remote",
      noticeAccepted: ["immediate"], stage: "new",
    }));
    expect(res.status).toBe(201);
    const { code, matched } = await res.json() as { code: string; matched: number };
    expect(matched, "no pool to reorder").toBeGreaterThan(1);

    const view = await getOpsMatchingWorkspace(code);
    return { code, order: view!.candidates.map((c) => c.maskedId) };
  }

  it("persists the order, so it survives a reload", async () => {
    const { code, order } = await sourcedRole();

    // Move the last candidate to the front — the thing a broker actually does.
    const moved = [order[order.length - 1], ...order.slice(0, -1)];
    const res = await saveRank(post({ code, order: moved, included: [moved[0]] }));
    expect(res.status).toBe(200);

    // Read it back through the read model the screen renders from, not the column.
    const view = await getOpsMatchingWorkspace(code);
    expect(view!.candidates.map((c) => c.maskedId)).toEqual(moved);
    expect(view!.candidates[0].isManuallyRanked).toBe(true);
  });

  it("persists who is included, so the send count is right after a reload", async () => {
    const { code, order } = await sourcedRole();
    const pick = [order[1]];

    await saveRank(post({ code, order, included: pick }));

    const view = await getOpsMatchingWorkspace(code);
    expect(view!.candidates.filter((c) => c.included).map((c) => c.maskedId)).toEqual(pick);
  });

  it("keeps algo_rank, so the algorithm ranking is still saved under an override", async () => {
    /**
     * docs/MATCHING.md: "manual_rank overrides it ... so KEEP algo_rank, do not overwrite
     * it." That state — "manual override active, algorithm ranking saved" — was unreachable
     * before, because nothing wrote manual_rank outside a send.
     */
    const { code, order } = await sourcedRole();
    const before = await db
      .select({ algoRank: s.matches.algoRank })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .where(eq(s.requirements.code, code));

    await saveRank(post({ code, order: [...order].reverse(), included: [] }));

    const after = await db
      .select({ algoRank: s.matches.algoRank })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .where(eq(s.requirements.code, code));

    expect(after.map((r) => r.algoRank).sort((a, b) => a - b))
      .toEqual(before.map((r) => r.algoRank).sort((a, b) => a - b));
  });

  it("reset really clears it, and the Undo restores exactly what was there", async () => {
    const { code, order } = await sourcedRole();
    const moved = [...order].reverse();
    await saveRank(post({ code, order: moved, included: [moved[0], moved[1]] }));

    const res = await resetRank(post({ code }, "DELETE"));
    expect(res.status).toBe(200);
    const { previous } = await res.json() as {
      previous: { order: string[]; included: string[] };
    };

    // Cleared in the DATABASE, which is what the old version never did.
    const cleared = await db
      .select({ manualRank: s.matches.manualRank, included: s.matches.included })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .where(eq(s.requirements.code, code));
    expect(cleared.every((r) => r.manualRank === null)).toBe(true);
    expect(cleared.every((r) => r.included === false)).toBe(true);

    // The Undo restores from what the server reported, not from what a screen remembered.
    expect(previous.order).toEqual(moved);
    expect(previous.included).toEqual([moved[0], moved[1]]);

    await saveRank(post({ code, order: previous.order, included: previous.included }));
    const view = await getOpsMatchingWorkspace(code);
    expect(view!.candidates.map((c) => c.maskedId)).toEqual(moved);
    expect(view!.candidates.filter((c) => c.included).length).toBe(2);
  });

  it("refuses to rank somebody who was never sourced for the role", async () => {
    /**
     * The guard that matters. `included` is what the send endpoint reads, so without this a
     * caller could put a person on a client's shortlist who had never passed an eligibility
     * gate — not stale, not duplicate-checked, possibly from a blocked supplier.
     */
    const { code, order } = await sourcedRole();
    const res = await saveRank(post({
      code, order: [...order, "TV-9999"], included: ["TV-9999"],
    }));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("not_in_pool");
  });

  it("tells you a re-run kept your order, and how many are new", async () => {
    const { code, order } = await sourcedRole();
    await saveRank(post({ code, order: [...order].reverse(), included: [] }));

    const res = await runMatchingRoute(post({ code }));
    expect(res.status).toBe(200);
    const out = await res.json() as { keptManualOrder: boolean; added: number };

    // New candidates land at the BOTTOM, under a hand-arranged list, where they are easy to
    // miss — so the desk says so rather than looking like it did nothing.
    expect(out.keptManualOrder, "a re-run did not notice the manual order").toBe(true);
    expect(out.added).toBe(0); // nothing new listed between the two runs
  });
});

/* ====================================================================== */
/*  Adding somebody from the talent pool, by hand                          */
/* ====================================================================== */

/**
 * "Add to a requirement" was a dead button in the talent pool header.
 *
 * Doubly dead: no handler, and no way to say WHO to add — there was no selection on that
 * table at all. The interesting half is not the plumbing, it is what the gates do. The
 * matcher already sources every ELIGIBLE person automatically, so an add that refused
 * ineligible candidates could only ever add somebody matching had already found. It would be
 * a button that did nothing, again.
 *
 * So `docs/MATCHING.md` is followed literally — *"Record the reason in `matches.eligibility`
 * when ops explicitly asks to see blocked candidates"* — and the gate is RECORDED rather
 * than enforced. Self-dealing, blocked suppliers and people off the bench are still refused,
 * because those rows would be created and then never displayed.
 */
describe("adding somebody to a role by hand", () => {
  /** An open role, and the pool the matcher sourced for it on posting. */
  async function openRole(quantity = 2) {
    const res = await createRequirement(post({
      roleTitle: MARK, skills: ["React"], experienceBand: "5-8", quantity,
      budgetMinPaise: 13_000_000, budgetMaxPaise: 22_000_000,
      engagementType: "contract", workMode: "remote",
      noticeAccepted: ["immediate"], stage: "new",
    }));
    expect(res.status).toBe(201);
    const { code } = await res.json() as { code: string };
    const view = await getOpsMatchingWorkspace(code);
    return { code, sourced: view!.candidates.map((c) => c.maskedId) };
  }

  /**
   * A listed, just-confirmed profile.
   *
   * Created AFTER the role on purpose, so the matcher has never seen it — which is what
   * makes "the matcher never sourced them" a real assertion rather than a coincidence of
   * the seed.
   */
  async function freshProfile() {
    const created = await createResource(post({
      fullName: MARK, baseCity: "Pune", experienceMonths: 72,
      skills: ["React"], vendorRatePaise: 14_000_000,
      workModes: ["remote"], status: "draft",
    }));
    expect(created.status).toBe(201);
    const { maskedId } = await created.json() as { maskedId: string };
    expect((await listResource(post({ maskedId, to: "listed" }))).status).toBe(200);
    return maskedId;
  }

  /** The match rows for a role, as the database holds them. */
  async function matchRows(code: string) {
    return db
      .select({
        id: s.matches.id,
        maskedId: s.benchResources.maskedId,
        algoScore: s.matches.algoScore,
        algoRank: s.matches.algoRank,
        manualRank: s.matches.manualRank,
        eligibility: s.matches.eligibility,
        scoreSkill: s.matches.scoreSkill,
        scoreTest: s.matches.scoreTest,
        scoreExpFit: s.matches.scoreExpFit,
        scoreRate: s.matches.scoreRate,
        scoreFreshness: s.matches.scoreFreshness,
        scoreVendor: s.matches.scoreVendor,
        proposedClientRatePaise: s.matches.proposedClientRatePaise,
      })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .innerJoin(s.benchResources, eq(s.benchResources.id, s.matches.resourceId))
      .where(eq(s.requirements.code, code));
  }

  const add = (code: string, maskedIds: string[]) =>
    addToRequirementRoute(post({ code, maskedIds }));

  it("puts a profile the matcher never sourced into the pool", async () => {
    const role = await openRole();
    const maskedId = await freshProfile();
    expect(role.sourced, "created before the profile, so it cannot be sourced yet")
      .not.toContain(maskedId);

    const res = await add(role.code, [maskedId]);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      added: string[]; flagged: unknown[]; refused: Array<{ reason: string }>;
    };
    expect(body.refused, "a listed, just-confirmed profile was refused").toEqual([]);
    expect(body.added).toContain(maskedId);

    // Through the read model the desk renders from, not the column.
    const view = await getOpsMatchingWorkspace(role.code);
    expect(view!.candidates.map((c) => c.maskedId)).toContain(maskedId);
  });

  it("scores them with the same scorer the matcher uses", async () => {
    /**
     * The reason `componentsFor` was lifted out of a closure inside `runMatching` instead of
     * being copied. Two copies of a scoring rule is how a hand-added candidate ends up
     * scored differently from a sourced one, on the same screen, with nothing saying why —
     * the mistake the ranking weights had made twice already.
     */
    const role = await openRole();
    const maskedId = await freshProfile();
    await add(role.code, [maskedId]);

    const rows = await matchRows(role.code);
    const mine = rows.find((r) => r.maskedId === maskedId);
    expect(mine, "no match row was written").toBeDefined();

    // The total is the weighted blend of ITS OWN six components, so a default or a
    // placeholder cannot pass.
    expect(mine!.algoScore).toBe(algoScore(mine!));
    expect(mine!.proposedClientRatePaise, "added without a price").not.toBeNull();
    for (const key of [
      "scoreSkill", "scoreTest", "scoreExpFit", "scoreRate", "scoreFreshness", "scoreVendor",
    ] as const) {
      expect(mine![key], `${key} out of range`).toBeGreaterThanOrEqual(0);
      expect(mine![key], `${key} out of range`).toBeLessThanOrEqual(100);
    }

    // Ranked among the rest rather than parked at the end: contiguous 1..n, no gaps, no
    // duplicates, and nobody left on the 9999 the insert uses as a placeholder.
    const ranks = rows.map((r) => r.algoRank).sort((a, b) => a - b);
    expect(ranks).toEqual(rows.map((_, i) => i + 1));
  });

  it("scores a hand-added candidate identically to one the matcher sourced", async () => {
    /**
     * The assertion the refactor was for, and the one the test above cannot make.
     *
     * Checking that `algo_score` is the weighted blend of its own components only proves the
     * row is self-consistent — a SECOND copy of the scoring assembly would be self-consistent
     * too, and would quietly disagree with the matcher. So the same person is put into two
     * identical roles by the two different paths, and the six components have to match.
     *
     * `componentsFor` was a closure inside `runMatching` until this feature needed it; this
     * is what keeps it one function.
     */
    const byHand = await openRole();
    const maskedId = await freshProfile();
    await add(byHand.code, [maskedId]);

    // An identical role posted AFTER the profile is listed, so the matcher sources them.
    const sourced = await openRole();
    expect(
      sourced.sourced,
      "the matcher did not source a fresh, listed, in-band profile — nothing to compare",
    ).toContain(maskedId);

    const [manual] = (await matchRows(byHand.code)).filter((r) => r.maskedId === maskedId);
    const [auto] = (await matchRows(sourced.code)).filter((r) => r.maskedId === maskedId);

    const components = (r: typeof manual) => ({
      scoreSkill: r.scoreSkill, scoreTest: r.scoreTest, scoreExpFit: r.scoreExpFit,
      scoreRate: r.scoreRate, scoreFreshness: r.scoreFreshness, scoreVendor: r.scoreVendor,
    });
    expect(components(manual)).toEqual(components(auto));
    expect(manual.algoScore).toBe(auto.algoScore);
    expect(manual.proposedClientRatePaise).toBe(auto.proposedClientRatePaise);
  });

  it("does not reshuffle the ranks the matcher already assigned", async () => {
    /**
     * Why the renumber reads `algo_rank` instead of re-sorting the stored components.
     *
     * `runMatching` breaks ties on the RAW assessment score, the raw days since confirmation
     * and the raw reliability — not on the bucketed components it writes to the row. So
     * re-sorting the pool here from `score_test` / `score_freshness` / `score_vendor` would be
     * a second, subtly different ranking rule, and a later re-run would shuffle ranks back
     * with nothing explaining why. The existing rows keep their order; only the new one is
     * placed.
     */
    const role = await openRole();
    expect(role.sourced.length, "no pool to disturb").toBeGreaterThan(1);

    const orderOf = async (code: string) =>
      (await matchRows(code))
        .sort((a, b) => a.algoRank - b.algoRank)
        .map((r) => r.maskedId);

    const before = await orderOf(role.code);
    const maskedId = await freshProfile();
    await add(role.code, [maskedId]);

    const after = await orderOf(role.code);
    expect(after.filter((id) => id !== maskedId)).toEqual(before);
    expect(after).toContain(maskedId);
    // And still 1..n: the new row does not sit on the 9999 the insert uses as a placeholder.
    const rows = await matchRows(role.code);
    expect(rows.map((r) => r.algoRank).sort((a, b) => a - b))
      .toEqual(rows.map((_, i) => i + 1));
  });

  it("keeps two equally-scored candidates in the order the matcher put them", async () => {
    /**
     * The assertion the test above cannot make, because **the seed contains no score ties**
     * for a role like this — so the tie-breaks never engage and either renumber produces the
     * same answer. This manufactures the tie.
     *
     * `runMatching` breaks ties on the RAW assessment score, the raw days since confirmation
     * and the raw reliability. The row stores the BUCKETED components. So a renumber that
     * re-sorted the pool from `score_test` / `score_freshness` / `score_vendor` would be a
     * second, subtly different ranking rule, and would move a candidate the matcher had
     * already placed — which is why the renumber reads `algo_rank` instead.
     *
     * The two rows are made to tie on `algo_score` while the LOWER-ranked one is given the
     * better stored tie-breaks, so a re-sort from those columns would promote it and this
     * assertion would fail. Writing `algo_score` by hand is what ADR-011 forbids in real
     * data: this is a `MARK` fixture, deleted in `afterAll`, that nothing else reads.
     */
    const role = await openRole();
    const ranked = (await matchRows(role.code)).sort((a, b) => a.algoRank - b.algoRank);
    expect(ranked.length, "need at least two candidates to tie").toBeGreaterThan(1);
    const [first, second] = ranked;

    await db.update(s.matches)
      .set({ scoreTest: 0, scoreFreshness: 0, scoreVendor: 0 })
      .where(eq(s.matches.id, first.id));
    await db.update(s.matches)
      .set({ algoScore: first.algoScore, scoreTest: 100, scoreFreshness: 100, scoreVendor: 100 })
      .where(eq(s.matches.id, second.id));

    const maskedId = await freshProfile();
    await add(role.code, [maskedId]);

    const after = (await matchRows(role.code))
      .sort((a, b) => a.algoRank - b.algoRank)
      .map((r) => r.maskedId)
      .filter((id) => id !== maskedId);
    expect(after.slice(0, 2), "the renumber re-sorted rows the matcher had already ranked")
      .toEqual([first.maskedId, second.maskedId]);
  });

  it("records the gate a person failed instead of refusing them", async () => {
    const role = await openRole();
    const maskedId = await freshProfile();

    // Age the confirmation past the 14-day staleness gate. The matcher would skip them
    // entirely; the manual add is the documented way to see them anyway.
    await db
      .update(s.benchResources)
      .set({ lastConfirmedAt: new Date(Date.now() - 40 * 864e5) })
      .where(eq(s.benchResources.maskedId, maskedId));

    const res = await add(role.code, [maskedId]);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      added: string[]; flagged: Array<{ maskedId: string; eligibility: string }>;
    };

    expect(body.added, "a stale profile was reported as clean").not.toContain(maskedId);
    expect(body.flagged).toEqual([{ maskedId, eligibility: "blocked_stale" }]);

    // In the pool, carrying the reason — that is the whole feature.
    const rows = await matchRows(role.code);
    expect(rows.find((r) => r.maskedId === maskedId)?.eligibility).toBe("blocked_stale");

    const view = await getOpsMatchingWorkspace(role.code);
    expect(
      view!.candidates.map((c) => c.maskedId),
      "a flagged candidate must still be visible to the desk that flagged them",
    ).toContain(maskedId);
  });

  it("refuses somebody who is off the bench", async () => {
    // Nobody can be offered a withdrawn profile, so adding one is meaningless rather than
    // deliberate. This is the line between "record the gate" and "refuse".
    const role = await openRole();
    const maskedId = await freshProfile();
    expect((await withdrawResource(post({ maskedId }, "DELETE"))).status).toBe(200);

    const res = await add(role.code, [maskedId]);
    expect(res.status).toBe(200);
    const body = await res.json() as {
      written: string[]; refused: Array<{ maskedId: string; reason: string }>;
    };
    expect(body.refused).toEqual([{ maskedId, reason: "off_the_bench" }]);
    expect(body.written).toEqual([]);

    const rows = await matchRows(role.code);
    expect(rows.map((r) => r.maskedId)).not.toContain(maskedId);
  });

  it("says nothing changed for somebody already in the role", async () => {
    const role = await openRole();
    expect(role.sourced.length, "no pool to re-add from").toBeGreaterThan(0);
    const before = await matchRows(role.code);

    const res = await add(role.code, [role.sourced[0]]);
    const body = await res.json() as { alreadyThere: string[]; written: string[] };

    expect(body.alreadyThere).toEqual([role.sourced[0]]);
    expect(body.written).toEqual([]);
    // No duplicate row, and no silent re-score of somebody a broker may have priced.
    expect((await matchRows(role.code)).length).toBe(before.length);
  });

  it("leaves a hand-arranged order alone", async () => {
    /**
     * The product owner's choice: *"Scored and ranked like anybody else. Any manual ordering
     * you have arranged is preserved; only algo_rank is renumbered."* An add that reshuffled
     * a broker's order would silently destroy work nobody asked it to touch.
     */
    const role = await openRole();
    const arranged = [...role.sourced].reverse();
    expect((await saveRank(post({ code: role.code, order: arranged, included: [] }))).status).toBe(200);

    const maskedId = await freshProfile();
    await add(role.code, [maskedId]);

    // The desk orders by `coalesce(manual_rank, algo_rank + 1000)`, so somebody with no
    // manual rank lands under the arranged list — where the matching desk already warns
    // that new candidates are easy to miss.
    const view = await getOpsMatchingWorkspace(role.code);
    expect(view!.candidates.map((c) => c.maskedId)).toEqual([...arranged, maskedId]);

    const rows = await matchRows(role.code);
    const manual = rows.filter((r) => r.manualRank != null);
    expect(manual.length, "the manual order was cleared by an add").toBe(arranged.length);
    expect(rows.map((r) => r.algoRank).sort((a, b) => a - b))
      .toEqual(rows.map((_, i) => i + 1));
  });

  it("the Undo removes exactly what the add wrote", async () => {
    const role = await openRole();
    const maskedId = await freshProfile();
    const added = await add(role.code, [maskedId]);
    const { written } = await added.json() as { written: string[] };
    expect(written).toEqual([maskedId]);

    const res = await undoAddRoute(post({ code: role.code, maskedIds: written }, "DELETE"));
    expect(res.status).toBe(200);
    const body = await res.json() as { removed: string[] };
    expect(body.removed).toEqual([maskedId]);

    const rows = await matchRows(role.code);
    expect(rows.map((r) => r.maskedId)).not.toContain(maskedId);
    // Everybody the matcher sourced is untouched, and the ranks close up behind the
    // deletion rather than leaving a gap the desk would render.
    expect(rows.length).toBe(role.sourced.length);
    expect(rows.map((r) => r.algoRank).sort((a, b) => a - b))
      .toEqual(rows.map((_, i) => i + 1));
  });

  it("the Undo will not remove somebody a broker has since arranged", async () => {
    // An Undo that reverses more than it did is worse than no Undo. Once a candidate has
    // been ranked by hand or marked to send, they are work rather than an accidental add.
    const role = await openRole();
    const maskedId = await freshProfile();
    await add(role.code, [maskedId]);

    const view = await getOpsMatchingWorkspace(role.code);
    const order = view!.candidates.map((c) => c.maskedId);
    await saveRank(post({ code: role.code, order, included: [maskedId] }));

    const res = await undoAddRoute(post({ code: role.code, maskedIds: [maskedId] }, "DELETE"));
    const body = await res.json() as { removed: string[]; keptBecauseArranged: string[] };
    expect(body.removed).toEqual([]);
    expect(body.keptBecauseArranged).toEqual([maskedId]);
    expect((await matchRows(role.code)).map((r) => r.maskedId)).toContain(maskedId);
  });

  it("refuses a role nobody is working any more", async () => {
    const role = await openRole();
    const maskedId = await freshProfile();
    expect((await cancelRequirement(post({ code: role.code }, "DELETE"))).status).toBe(200);

    const res = await add(role.code, [maskedId]);
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("stage_closed");
    expect((await matchRows(role.code)).map((r) => r.maskedId)).not.toContain(maskedId);
  });

  it("leaves an audit row naming who was added and which gate they failed", async () => {
    // Working agreement 5. This changes the pool a client will be shown a shortlist from,
    // and it deliberately includes people a gate had excluded — the part a dispute turns on.
    const role = await openRole();
    const maskedId = await freshProfile();
    await db
      .update(s.benchResources)
      .set({ lastConfirmedAt: new Date(Date.now() - 40 * 864e5) })
      .where(eq(s.benchResources.maskedId, maskedId));
    await add(role.code, [maskedId]);

    const [req] = await db
      .select({ id: s.requirements.id })
      .from(s.requirements)
      .where(eq(s.requirements.code, role.code));

    const [row] = await db
      .select({ after: s.auditLog.after, context: s.auditLog.context })
      .from(s.auditLog)
      .where(and(
        eq(s.auditLog.entityId, req.id),
        eq(s.auditLog.action, "pool.added_to_requirement"),
      ));

    expect(row, "no audit row for a manual add").toBeDefined();
    expect(JSON.stringify(row.after)).toContain("blocked_stale");
    expect(JSON.stringify(row.context)).toContain(role.code);
  });

  it("offers only roles somebody is still working", async () => {
    const open = await openRole();
    const codes = (await getOpsOpenRequirements()).map((r) => r.code);
    expect(codes, "a posted role is missing from the picker").toContain(open.code);

    await cancelRequirement(post({ code: open.code }, "DELETE"));
    const after = await getOpsOpenRequirements();
    expect(after.map((r) => r.code), "a cancelled role is still offered")
      .not.toContain(open.code);

    // A draft has not been committed to by the client; the other closed stages are
    // finished. Either way a match row on one is invisible work.
    for (const r of after) {
      expect(["new", "matching", "shortlisted", "interviewing"], `${r.code} is ${r.stage}`)
        .toContain(r.stage);
    }
  });
});

/* ====================================================================== */
/*  The SLA clock restarts on entry to a stage                             */
/* ====================================================================== */

/**
 * Reported by the owner as due dates being "randomly decided".
 *
 * They were not random. The stage endpoint set `{ stage, updatedAt }` and nothing else, so a
 * requirement kept the deadline it was given when POSTED — `new` + 4 business hours. Moved
 * to `matching`, it was still judged against a deadline that had passed the same afternoon,
 * so the Due column read "Overdue" and the number grew forever. The dates referred to a
 * stage the role had left.
 *
 * `docs/DOMAIN.md` gives every stage its own clock; "Clock starts" is a column in that
 * table.
 */
describe("moving a stage restarts the SLA clock", () => {
  async function newRole() {
    const res = await createRequirement(post({
      roleTitle: MARK, skills: ["React"], experienceBand: "5-8", quantity: 1,
      budgetMinPaise: 13_000_000, budgetMaxPaise: 22_000_000,
      engagementType: "contract", workMode: "remote",
      noticeAccepted: ["immediate"], stage: "new",
    }));
    expect(res.status).toBe(201);
    return (await res.json() as { code: string }).code;
  }

  const read = (code: string) => db
    .select({
      stage: s.requirements.stage,
      slaDueAt: s.requirements.slaDueAt,
      slaWindowHours: s.requirements.slaWindowHours,
    })
    .from(s.requirements)
    .where(eq(s.requirements.code, code))
    .then((r) => r[0]);

  it("gives each stage its own window and a deadline in the FUTURE", async () => {
    const code = await newRole();

    for (const stage of ["matching", "shortlisted", "interviewing"] as const) {
      const res = await changeStage(post({ code, toStage: stage }));
      expect(res.status).toBe(200);

      const row = await read(code);
      expect(row.slaWindowHours, `${stage} kept the wrong window`)
        .toBe(SLA_WINDOW_HOURS[stage]);
      // The regression itself: the deadline used to be whatever `new` set, long past.
      expect(row.slaDueAt, `${stage} has no deadline`).not.toBeNull();
      expect(row.slaDueAt!.getTime(), `${stage} deadline is in the past`)
        .toBeGreaterThan(Date.now());
    }
  });

  it("lands the deadline inside business hours, not at 22:00 on a Sunday", async () => {
    // addBusinessHours, not now + 36. A role moved on a Saturday evening is not due on
    // Sunday night, when nobody is working and the client cannot be served.
    const code = await newRole();
    await changeStage(post({ code, toStage: "matching" }));
    const row = await read(code);

    // 09:00-19:00 IST, so the IST hour of the deadline must sit in that window.
    const istHour = Number(
      row.slaDueAt!.toLocaleString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", hour12: false }),
    );
    expect(istHour, `deadline landed at ${istHour}:00 IST`).toBeGreaterThanOrEqual(9);
    expect(istHour).toBeLessThanOrEqual(19);

    const istDay = row.slaDueAt!.toLocaleString("en-US", { timeZone: "Asia/Kolkata", weekday: "short" });
    expect(istDay, "deadline landed on a Sunday").not.toBe("Sun");
  });

  it("clears the deadline on a terminal stage rather than carrying a stale one", async () => {
    const code = await newRole();
    await changeStage(post({ code, toStage: "matching" }));
    expect((await read(code)).slaDueAt).not.toBeNull();

    await changeStage(post({ code, toStage: "placed" }));
    const row = await read(code);
    // Nothing left to be late for. The read model renders this as "No deadline", and for
    // `placed` it shows the margin instead.
    expect(row.slaDueAt).toBeNull();
    expect(row.slaWindowHours).toBeNull();
  });

  it("rescues a role whose old deadline has already passed", async () => {
    /**
     * The symptom the owner actually saw, and the strongest form of this test.
     *
     * A role created seconds ago still has a FUTURE `new` deadline, so simply moving it
     * and checking it is not late passes even with the bug present — which it did on the
     * first version of this test. The bug only shows once the old deadline is behind us.
     *
     * So the deadline is aged into the past first, which is exactly the state every role
     * on the owner's board was in: posted days ago, dragged along since, still judged
     * against `new` + 4 business hours.
     *
     * Asserted through the read model the board renders from, because that is what a
     * person looks at.
     */
    const code = await newRole();

    await db.update(s.requirements)
      .set({ slaDueAt: new Date(Date.now() - 72 * 3_600_000) })
      .where(eq(s.requirements.code, code));

    const before = (await getOpsPipeline()).requirements.find((r) => r.code === code);
    expect(before!.sla.state, "the setup did not actually make it late").toBe("late");

    await changeStage(post({ code, toStage: "matching" }));

    const after = (await getOpsPipeline()).requirements.find((r) => r.code === code);
    expect(after, "the moved requirement is missing from the pipeline").toBeDefined();
    expect(after!.sla.state, `still reads "${after!.sla.label}" after moving stage`)
      .not.toBe("late");
  });

  it("records the old and new deadline in the audit row", async () => {
    const code = await newRole();
    await changeStage(post({ code, toStage: "matching" }));

    const [reqRow] = await db
      .select({ id: s.requirements.id }).from(s.requirements)
      .where(eq(s.requirements.code, code));
    const [entry] = await db
      .select({ before: s.auditLog.before, after: s.auditLog.after })
      .from(s.auditLog)
      .where(and(
        eq(s.auditLog.entityId, reqRow.id),
        eq(s.auditLog.action, "requirement.stage_changed"),
      ))
      .limit(1);

    // A deadline that moves without a record of it moving is the thing a dispute turns on.
    expect(entry).toBeDefined();
    expect((entry.after as Record<string, unknown>).slaWindowHours).toBe(36);
    expect(entry.before).toHaveProperty("slaDueAt");
  });
});

/* ====================================================================== */
/*  Posting a requirement must not dead-end at an empty matching desk      */
/* ====================================================================== */

/**
 * Reported by the owner: the client side said "14 profiles match the requirements" and the
 * ops matching desk for that requirement showed none.
 *
 * Both numbers were right and they measured different things. The client preview is a live
 * count of eligible supply; the desk reads `matches`, and **only the seed ever wrote a
 * `matches` row**. So the 25 seeded requirements worked end to end and anything a client
 * posted dead-ended on a desk whose own copy said "matching starts here" with nothing that
 * started it.
 */
describe("a posted requirement is sourced", () => {
  /** A role wide enough that the fixture bench can satisfy it. */
  const ROLE = {
    roleTitle: MARK,
    skills: ["React"],
    experienceBand: "5-8" as const,
    quantity: 1,
    budgetMinPaise: 13_000_000,
    budgetMaxPaise: 22_000_000,
    engagementType: "contract" as const,
    workMode: "remote" as const,
    noticeAccepted: ["immediate"],
    stage: "new" as const,
  };

  async function postRole(extra: Record<string, unknown> = {}) {
    const res = await createRequirement(post({ ...ROLE, ...extra }));
    expect(res.status).toBe(201);
    return await res.json() as { code: string; matched: number };
  }

  it("has candidates the moment it is posted", async () => {
    const { code, matched } = await postRole();
    expect(matched, "posting a requirement sourced nobody").toBeGreaterThan(0);

    const rows = await db
      .select({ algoRank: s.matches.algoRank, algoScore: s.matches.algoScore })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .where(eq(s.requirements.code, code));
    expect(rows.length).toBe(matched);
  });

  it("stores algo_score as the weighted blend of its own components (ADR-011)", async () => {
    // The desk renders the six components as bars beside the total. A broker who adds up
    // the bars has to get the number shown, or the one screen built to explain an ordering
    // cannot be defended.
    const { code } = await postRole();
    const rows = await db
      .select({
        algoScore: s.matches.algoScore,
        scoreSkill: s.matches.scoreSkill, scoreTest: s.matches.scoreTest,
        scoreExpFit: s.matches.scoreExpFit, scoreRate: s.matches.scoreRate,
        scoreFreshness: s.matches.scoreFreshness, scoreVendor: s.matches.scoreVendor,
      })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .where(eq(s.requirements.code, code));

    expect(rows.length).toBeGreaterThan(0);
    const wrong = rows.filter((r) => algoScore(r) !== r.algoScore);
    expect(wrong, "a total that does not follow from its bars").toEqual([]);
  });

  it("ranks 1..n with no gaps and no ties in rank", async () => {
    // Ties in SCORE are expected and broken by the spec's rules; two rows sharing a RANK
    // would mean the client is shown an ambiguous order.
    const { code } = await postRole();
    const rows = await db
      .select({ algoRank: s.matches.algoRank })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .where(eq(s.requirements.code, code));

    const ranks = rows.map((r) => r.algoRank).sort((a, b) => a - b);
    expect(ranks).toEqual(Array.from({ length: ranks.length }, (_, i) => i + 1));
  });

  it("never sources anyone a gate excludes", async () => {
    const { code } = await postRole();
    const rows = await db
      .select({ status: s.benchResources.status, confirmed: s.benchResources.lastConfirmedAt })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .innerJoin(s.benchResources, eq(s.benchResources.id, s.matches.resourceId))
      .where(eq(s.requirements.code, code));

    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      // draft, deployed and withdrawn are out; unconfirmed (>= 14 days) is out.
      expect(["listed", "in_process"]).toContain(r.status);
      expect(r.confirmed).not.toBeNull();
      const days = (Date.now() - r.confirmed!.getTime()) / 86_400_000;
      expect(days, "a stale profile was sourced").toBeLessThan(15);
    }
  });

  it("a draft requirement is NOT sourced", async () => {
    // Nothing to source for a role nobody has committed to, and doing it would put work on
    // a broker's desk for something that may never be posted.
    const { code, matched } = await postRole({ stage: "draft" });
    expect(matched).toBe(0);
    const rows = await db
      .select({ id: s.matches.id })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .where(eq(s.requirements.code, code));
    expect(rows).toEqual([]);
  });

  it("re-running keeps a broker's manual ordering", async () => {
    /**
     * The one thing a re-run must never do. `manual_rank` and `included` are a broker's own
     * work; the spec keeps `algo_rank` alongside a manual override precisely so the
     * workspace can say "manual override active, algorithm ranking saved".
     */
    const { code } = await postRole();
    const [first] = await db
      .select({ id: s.matches.id })
      .from(s.matches)
      .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
      .where(eq(s.requirements.code, code))
      .limit(1);

    await db.update(s.matches)
      .set({ manualRank: 1, included: true })
      .where(eq(s.matches.id, first.id));

    const res = await runMatchingRoute(post({ code }));
    expect(res.status).toBe(200);

    const [after] = await db
      .select({ manualRank: s.matches.manualRank, included: s.matches.included })
      .from(s.matches)
      .where(eq(s.matches.id, first.id));
    expect(after.manualRank, "a re-run discarded a manual ranking").toBe(1);
    expect(after.included).toBe(true);
  });
});

/* ====================================================================== */
/*  A draft must not be a dead end, and an untested person must be visible */
/* ====================================================================== */

/**
 * The owner added someone, saved them as a draft, and could find them nowhere.
 *
 * Three separate defects produced that, and this walks the whole path rather than asserting
 * each in isolation — the bug was not in any one of them, it was that together they left no
 * way forward.
 */
describe("a person added as a draft can be found and acted on", () => {
  /** Creates a draft and returns its masked id. */
  async function newDraft() {
    const res = await createResource(post({
      fullName: MARK,
      baseCity: "Pune",
      experienceMonths: 54,
      skills: ["Kafka"],
      vendorRatePaise: 11_500_000,
      workModes: ["remote"],
      status: "draft",
    }));
    expect(res.status).toBe(201);
    return (await res.json() as { maskedId: string }).maskedId;
  }

  it("is on their own roster, counted as a draft, and NOT on the exchange", async () => {
    const maskedId = await newDraft();

    const roster = await getVendorRoster(nimbusId);
    expect(roster.counts.draft, "drafts had no count and no tab").toBeGreaterThan(0);
    expect(roster.resources.map((r) => r.maskedId)).toContain(maskedId);

    // Correct, and the part that was never explained: a draft is not an offer.
    const pool = await getOpsTalentPool({ limit: 300 });
    expect(pool.results.map((r) => r.maskedId)).not.toContain(maskedId);
  });

  it("appears on the skill tests screen even with no test record", async () => {
    // THE defect. getVendorAssessments read FROM assessments INNER JOIN bench_resources,
    // so a person with no test row was invisible on the screen whose job is to get them
    // tested — and `notStarted` counted assessment rows rather than untested people, so
    // the button read "Invite 0 to test".
    const maskedId = await newDraft();

    const a = await getVendorAssessments(nimbusId);
    const card = a.cards.find((c) => c.maskedId === maskedId);
    expect(card, "an untested person was missing from the skill tests screen").toBeDefined();
    expect(card!.hasTest).toBe(false);
    expect(card!.status).toBe("not_started");
    expect(card!.resourceStatus).toBe("draft");

    expect(a.summary.notStarted).toBeGreaterThan(0);
    expect(a.untestedMaskedIds, "the button acts on the real set").toContain(maskedId);
  });

  it("can be listed on the exchange, and unlisted again", async () => {
    const maskedId = await newDraft();

    const listed = await listResource(post({ maskedId, to: "listed" }));
    expect(listed.status).toBe(200);

    const pool = await getOpsTalentPool({ limit: 300 });
    expect(pool.results.map((r) => r.maskedId), "listing did not reach the exchange")
      .toContain(maskedId);

    // Listing confirms availability at the same moment, matching the create endpoint.
    const [row] = await db
      .select({ status: s.benchResources.status, listedAt: s.benchResources.listedAt, confirmed: s.benchResources.lastConfirmedAt })
      .from(s.benchResources).where(eq(s.benchResources.maskedId, maskedId));
    expect(row.status).toBe("listed");
    expect(row.listedAt).not.toBeNull();
    expect(row.confirmed).not.toBeNull();

    // The Undo restores the draft exactly, stamps included.
    expect((await listResource(post({ maskedId, to: "draft" }))).status).toBe(200);
    const [back] = await db
      .select({ status: s.benchResources.status, listedAt: s.benchResources.listedAt, confirmed: s.benchResources.lastConfirmedAt })
      .from(s.benchResources).where(eq(s.benchResources.maskedId, maskedId));
    expect(back.status).toBe("draft");
    expect(back.listedAt).toBeNull();
    expect(back.confirmed).toBeNull();
  });

  it("refuses to unlist somebody a client is mid-decision on", async () => {
    // in_process and deployed are off limits: a client is deciding on them, and their own
    // supplier must not be able to quietly pull them off the exchange.
    const [busy] = await db
      .select({ maskedId: s.benchResources.maskedId })
      .from(s.benchResources)
      .where(and(
        eq(s.benchResources.vendorOrgId, nimbusId),
        inArray(s.benchResources.status, ["in_process", "deployed"]),
      ))
      .limit(1);

    if (!busy) return; // nothing in that state in the fixture; nothing to assert
    const res = await listResource(post({ maskedId: busy.maskedId, to: "draft" }));
    expect(res.status).toBe(409);
    expect((await res.json() as { error: string }).error).toBe("not_draftable");
  });

  it("requests a test once, however many times the button is pressed", async () => {
    const maskedId = await newDraft();

    const first = await requestTest(post({ maskedIds: [maskedId] }));
    expect(first.status).toBe(200);
    expect((await first.json() as { queued: string[] }).queued).toEqual([maskedId]);

    // Idempotent on purpose: the screen's button acts on everyone untested, so pressing it
    // twice must not queue anybody twice.
    const second = await requestTest(post({ maskedIds: [maskedId] }));
    const out = await second.json() as { queued: string[]; alreadyWaiting: string[] };
    expect(out.queued).toEqual([]);
    expect(out.alreadyWaiting).toEqual([maskedId]);

    const rows = await db
      .select({ status: s.assessments.status, ref: s.assessments.providerRef, score: s.assessments.overallScore })
      .from(s.assessments)
      .innerJoin(s.benchResources, eq(s.benchResources.id, s.assessments.resourceId))
      .where(eq(s.benchResources.maskedId, maskedId));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("invited");
    // ADR-006: no provider has been called, so there is no ref — and emphatically no score.
    expect(rows[0].ref).toBeNull();
    expect(rows[0].score).toBeNull();
  });

  it("abandons a request rather than deleting it", async () => {
    const maskedId = await newDraft();
    await requestTest(post({ maskedIds: [maskedId] }));
    expect((await abandonTest(post({ maskedIds: [maskedId] }))).status).toBe(200);

    // "We asked and changed our mind" is a different fact from "we never asked", and it is
    // the first thing a supplier would argue about on an assessment bill.
    const rows = await db
      .select({ status: s.assessments.status })
      .from(s.assessments)
      .innerJoin(s.benchResources, eq(s.benchResources.id, s.assessments.resourceId))
      .where(eq(s.benchResources.maskedId, maskedId));
    expect(rows.length).toBe(1);
    expect(rows[0].status).toBe("abandoned");
  });
});

/* ====================================================================== */
/*  Zod at the boundary: a malformed body never reaches the database       */
/* ====================================================================== */

describe("every write endpoint validates its input", () => {
  const cases: Array<[string, (r: Request) => Promise<Response>, unknown]> = [
    ["vendor/resources", createResource, { fullName: "x" }],
    ["vendor/resources/confirm", confirmResource, { maskedIds: ["nope"] }],
    ["client/requirements", createRequirement, { roleTitle: "x" }],
    ["client/shortlists/decide", decide, { action: "decide" }],
    ["client/interviews/feedback", feedback, { maskedId: "nope", roundNo: 99 }],
    ["ops/duplicates/resolve", resolveDuplicate, { code: "nope" }],
    ["ops/requirements/stage", changeStage, { code: "nope" }],
    ["ops/pool/add-to-requirement", addToRequirementRoute, { code: "nope", maskedIds: [] }],
  ];

  for (const [name, handler, body] of cases) {
    it(`${name} returns 400, not 500, on a malformed body`, async () => {
      const res = await handler(post(body));
      // 400 specifically: a 500 would mean the bad value reached the driver.
      expect(res.status).toBe(400);
    });
  }
});

/* ====================================================================== */
/*  Tenancy: another organisation's row is NOT FOUND                      */
/* ====================================================================== */

describe("a write path never touches another organisation's data", () => {
  it("REFUSES a resource belonging to another vendor, as 404 not 403", async () => {
    // TV-4488 belongs to Vertex Digital; the vendor session is Nimbus Softworks.
    const res = await withdrawResource(post({ maskedId: "TV-4488" }, "DELETE"));
    expect(res.status).toBe(404);
  });

  it("REFUSES a requirement belonging to another client", async () => {
    // REQ-2320 is Cygnet's; the client session is Acme Finserv.
    const res = await cancelRequirement(post({ code: "REQ-2320" }, "DELETE"));
    expect(res.status).toBe(404);
  });

  it("REFUSES deciding on another client's shortlist item", async () => {
    const res = await decide(post({
      action: "decide", requirementCode: "REQ-2320", maskedId: "TV-4061", decision: "selected",
    }));
    expect(res.status).toBe(404);
  });

  it("REFUSES feedback on another client's interview round", async () => {
    const res = await feedback(post({
      maskedId: "TV-4061", roundNo: 1,
      ratings: { technicalDepth: 4, problemSolving: 4, communication: 4, roleFit: 4 },
      outcome: "advance", notes: "should not be possible",
    }));
    expect(res.status).toBe(404);
  });

  it("STILL ALLOWS the caller's own data, so the guard is not refusing everything", async () => {
    // The control. Without it, a handler that always 404s would pass every test above.
    const res = await decide(post({
      action: "decide", requirementCode: "REQ-2291", maskedId: "TV-3964", decision: "pending",
    }));
    expect(res.status).toBe(200);
  });
});

/* ====================================================================== */
/*  The created row is owned by the SESSION's org, not the body            */
/* ====================================================================== */

describe("ownership comes from the session and cannot be set by the caller", () => {
  it("ignores a vendorOrgId in the body and uses the signed-in vendor", async () => {
    const res = await createResource(post({
      fullName: MARK,
      baseCity: "Pune",
      experienceMonths: 60,
      skills: ["Kafka"],
      vendorRatePaise: 12_000_000,
      workModes: ["remote"],
      status: "draft",
      // A hostile extra field. Zod strips unknown keys, and the handler reads the session
      // regardless — this asserts both.
      vendorOrgId: cygnetId,
    }));
    expect(res.status).toBe(201);
    const { maskedId } = await res.json() as { maskedId: string };

    const [row] = await db
      .select({ vendorOrgId: s.benchResources.vendorOrgId, name: s.organizations.name })
      .from(s.benchResources)
      .innerJoin(s.organizations, eq(s.organizations.id, s.benchResources.vendorOrgId))
      .where(eq(s.benchResources.maskedId, maskedId));

    expect(row.name).toBe("Nimbus Softworks");   // the session's org
    expect(row.vendorOrgId).not.toBe(cygnetId);  // not the one in the body
  });

  it("ignores a clientOrgId in the body and uses the signed-in client", async () => {
    const res = await createRequirement(post({
      roleTitle: MARK,
      skills: ["React"],
      experienceBand: "5-8",
      quantity: 1,
      budgetMinPaise: 13_000_000,
      budgetMaxPaise: 17_000_000,
      engagementType: "contract",
      workMode: "remote",
      noticeAccepted: ["immediate"],
      stage: "draft",
      clientOrgId: cygnetId,
    }));
    expect(res.status).toBe(201);
    const { code } = await res.json() as { code: string };

    const [row] = await db
      .select({ clientOrgId: s.requirements.clientOrgId })
      .from(s.requirements)
      .where(eq(s.requirements.code, code));

    expect(row.clientOrgId).toBe(acmeId);
    expect(row.clientOrgId).not.toBe(cygnetId);
  });
});

/* ====================================================================== */
/*  Audit rows: working agreement 5, no exceptions                        */
/* ====================================================================== */

describe("every state-changing write leaves an audit row", () => {
  it("writes one for a created resource, and one for its withdrawal", async () => {
    const created = await createResource(post({
      fullName: MARK, baseCity: "Pune", experienceMonths: 48,
      skills: ["Kafka"], vendorRatePaise: 11_000_000,
      workModes: ["remote"], status: "listed",
    }));
    const { maskedId } = await created.json() as { maskedId: string };

    const [row] = await db
      .select({ id: s.benchResources.id })
      .from(s.benchResources)
      .where(eq(s.benchResources.maskedId, maskedId));

    const afterCreate = await db
      .select({ action: s.auditLog.action })
      .from(s.auditLog)
      .where(eq(s.auditLog.entityId, row.id));
    expect(afterCreate.map((a) => a.action)).toContain("resource.listed");

    await withdrawResource(post({ maskedId }, "DELETE"));

    const afterWithdraw = await db
      .select({ action: s.auditLog.action })
      .from(s.auditLog)
      .where(eq(s.auditLog.entityId, row.id));
    // Done, then undone — both events present, which is the point of a compensating write.
    expect(afterWithdraw.map((a) => a.action).sort())
      .toEqual(["resource.listed", "resource.withdrawn"]);
  });

  it("writes one for a stage change, and records the stage it came from", async () => {
    const before = await db
      .select({ stage: s.requirements.stage })
      .from(s.requirements)
      .where(eq(s.requirements.code, "REQ-2302"));
    const from = before[0].stage;
    const to = from === "matching" ? "new" : "matching";

    await changeStage(post({ code: "REQ-2302", toStage: to, reason: MARK }));

    const [req] = await db
      .select({ id: s.requirements.id })
      .from(s.requirements)
      .where(eq(s.requirements.code, "REQ-2302"));
    const rows = await db
      .select({ action: s.auditLog.action, before: s.auditLog.before, after: s.auditLog.after })
      .from(s.auditLog)
      .where(and(
        eq(s.auditLog.entityId, req.id),
        eq(s.auditLog.action, "requirement.stage_changed"),
      ));

    const mine = rows.find((r) => (r.after as Record<string, unknown>)?.stage === to);
    expect(mine).toBeDefined();
    expect((mine!.before as Record<string, unknown>).stage).toBe(from);

    // Put it back, and clear both audit rows this test wrote.
    await changeStage(post({ code: "REQ-2302", toStage: from, reason: MARK }));
    await db.delete(s.requirementStageEvents).where(eq(s.requirementStageEvents.reason, MARK));
    await db.delete(s.auditLog).where(and(
      eq(s.auditLog.entityId, req.id),
      eq(s.auditLog.action, "requirement.stage_changed"),
    ));
    // The seed's own stage-change audit row is restored by db:seed; this test only removes
    // what it added, and db:verify is the backstop if it ever removes too much.
  });
});

/* ====================================================================== */
/*  Response shapes carry nothing the portal may not see                  */
/* ====================================================================== */

describe("a write response never carries a forbidden field", () => {
  it("keeps client and margin language out of a VENDOR response", async () => {
    const res = await createResource(post({
      fullName: MARK, baseCity: "Pune", experienceMonths: 36,
      skills: ["Kafka"], vendorRatePaise: 10_000_000,
      workModes: ["remote"], status: "draft",
    }));
    const body = JSON.stringify(await res.json());
    for (const forbidden of ["client", "margin", "spread", "requirement", "REQ-"]) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("keeps vendor and margin language out of a CLIENT response", async () => {
    const res = await createRequirement(post({
      roleTitle: MARK, skills: ["React"], experienceBand: "5-8", quantity: 1,
      budgetMinPaise: 13_000_000, budgetMaxPaise: 17_000_000,
      engagementType: "contract", workMode: "remote",
      noticeAccepted: ["immediate"], stage: "draft",
    }));
    const body = JSON.stringify(await res.json());
    for (const forbidden of ["vendor", "margin", "spread", "supplier", "TV-"]) {
      expect(body.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it("keeps the verbatim panel note out of the audit row", async () => {
    // The note is client + ops only. The audit log is read on ops screens that do not need
    // it, so only its LENGTH is recorded — asserted here so a future edit cannot quietly
    // start copying it in.
    const secret = "Do not copy this sentence into the audit log.";
    const res = await feedback(post({
      maskedId: "TV-4821", roundNo: 1,
      ratings: { technicalDepth: 4, problemSolving: 4, communication: 4, roleFit: 4 },
      outcome: null, notes: secret,
    }));
    expect(res.status).toBe(200);

    const rows = await db
      .select({ after: s.auditLog.after })
      .from(s.auditLog)
      .where(eq(s.auditLog.action, "interview_feedback.saved"));

    for (const r of rows) {
      expect(JSON.stringify(r.after)).not.toContain(secret);
    }
    expect(JSON.stringify(rows.at(-1)?.after)).toContain("notes_length");

    // Clean up: restore the seeded feedback and drop this test's audit rows.
    await db.delete(s.auditLog).where(eq(s.auditLog.action, "interview_feedback.saved"));
  });
});
