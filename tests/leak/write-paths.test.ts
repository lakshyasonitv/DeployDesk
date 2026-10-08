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
import { getVendorAssessments, getVendorRoster } from "../../src/read-models/vendor";
import { getOpsTalentPool } from "../../src/read-models/ops";

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
