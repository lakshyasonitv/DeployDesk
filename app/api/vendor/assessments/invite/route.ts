import { NextResponse } from "next/server";
import { and, desc, eq, inArray, notInArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";

/**
 * POST   /api/vendor/assessments/invite — ask for a proctored test for people on the bench.
 * DELETE /api/vendor/assessments/invite — abandon those requests, which is the Undo.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS DOES AND DOES NOT CLAIM
 * ---------------------------------------------------------------------------
 *
 * ADR-006 puts the proctoring provider behind an `AssessmentProvider` adapter
 * (`invite`, `getStatus`, `getReport`, `verifyWebhook`) and that adapter does not exist yet.
 * So this route records the REQUEST and nothing more: an `assessments` row at status
 * `invited`, with `provider_ref` left null because no provider has issued one.
 *
 * That is a true internal state — "this person is queued for a test" — and the owner chose
 * it over two alternatives: leaving the button inert, and faking a score. **Faking a score
 * was the one to refuse.** An independently proctored result neither side can influence is
 * the product's entire credibility; a number invented by our own endpoint would be
 * indistinguishable in the database from a real one later.
 *
 * The UI says "test requested", never "invitation sent", because nothing has been sent.
 * When the adapter lands it will claim these rows, call the provider, and fill in
 * `provider_ref` — no migration and no change here.
 *
 * ---------------------------------------------------------------------------
 * IDEMPOTENT BY DESIGN
 * ---------------------------------------------------------------------------
 *
 * The screen's button is "Invite N to test", where N is everyone untested. Pressing it
 * twice must not queue anybody twice, so people with a test already open (`invited` or
 * `in_progress`) are SKIPPED rather than rejected — the result reports who was queued and
 * who was already waiting.
 */

const Body = z.object({
  maskedIds: z.array(z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/)).min(1).max(50),
});

/** The statuses that mean a test is already under way. */
const OPEN = ["invited", "in_progress"] as const;

/** Resources the caller owns and that are still on the bench. */
async function ownedResources(vendorOrgId: string, maskedIds: string[]) {
  return db
    .select({
      id: s.benchResources.id,
      maskedId: s.benchResources.maskedId,
      fullName: s.benchResources.fullName,
    })
    .from(s.benchResources)
    .where(and(
      eq(s.benchResources.vendorOrgId, vendorOrgId), // tenancy
      inArray(s.benchResources.maskedId, maskedIds),
      // Testing someone nobody can hire would be spending money for nothing.
      notInArray(s.benchResources.status, ["withdrawn", "archived"]),
    ));
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const session = await getDemoSession("vendor");

  const owned = await ownedResources(session.orgId, parsed.data.maskedIds);
  if (!owned.length) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const ids = owned.map((r) => r.id);

  const existing = await db
    .select({
      resourceId: s.assessments.resourceId,
      status: s.assessments.status,
      attemptNo: s.assessments.attemptNo,
    })
    .from(s.assessments)
    .where(inArray(s.assessments.resourceId, ids))
    .orderBy(desc(s.assessments.attemptNo));

  const openFor = new Set(existing.filter((a) => OPEN.includes(a.status as never)).map((a) => a.resourceId));
  // Highest attempt seen per person, so a retake is numbered rather than colliding.
  const highest = new Map<string, number>();
  for (const a of existing) {
    if (!highest.has(a.resourceId)) highest.set(a.resourceId, a.attemptNo);
  }

  const toQueue = owned.filter((r) => !openFor.has(r.id));
  const alreadyWaiting = owned.filter((r) => openFor.has(r.id)).map((r) => r.maskedId);

  if (!toQueue.length) {
    return NextResponse.json({ ok: true, queued: [], alreadyWaiting });
  }

  const now = new Date();
  const created = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(s.assessments)
      .values(toQueue.map((r) => ({
        resourceId: r.id,
        // Recorded now so the adapter knows which provider a row was meant for; the ref
        // stays null until that provider actually issues one.
        provider: "invigil",
        providerRef: null,
        attemptNo: (highest.get(r.id) ?? 0) + 1,
        status: "invited" as const,
        invitedAt: now,
      })))
      .returning({ id: s.assessments.id, resourceId: s.assessments.resourceId });

    await tx.insert(s.auditLog).values(rows.map((row) => ({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: "assessment.requested",
      entityType: "assessment",
      entityId: row.id,
      after: { status: "invited", provider: "invigil" },
      context: {
        maskedId: toQueue.find((r) => r.id === row.resourceId)?.maskedId ?? null,
      },
    })));

    return rows;
  });

  return NextResponse.json({
    ok: true,
    queued: toQueue.map((r) => r.maskedId),
    alreadyWaiting,
    count: created.length,
  });
}

export async function DELETE(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const session = await getDemoSession("vendor");

  const owned = await ownedResources(session.orgId, parsed.data.maskedIds);
  if (!owned.length) return NextResponse.json({ error: "not_found" }, { status: 404 });

  /**
   * `abandoned` rather than a delete.
   *
   * The row is the only record that a test was ever asked for, and "we queued them and
   * changed our mind" is a different fact from "we never queued them" — which matters the
   * first time a supplier argues about an assessment bill. Only `invited` rows are
   * touched: a test already in progress is out of our hands.
   */
  const now = new Date();
  await db.transaction(async (tx) => {
    const undone = await tx
      .update(s.assessments)
      .set({ status: "abandoned", updatedAt: now })
      .where(and(
        inArray(s.assessments.resourceId, owned.map((r) => r.id)),
        eq(s.assessments.status, "invited"),
      ))
      .returning({ id: s.assessments.id });

    if (undone.length) {
      await tx.insert(s.auditLog).values(undone.map((row) => ({
        actorId: session.userId,
        actorOrgId: session.orgId,
        action: "assessment.abandoned",
        entityType: "assessment",
        entityId: row.id,
        before: { status: "invited" },
        after: { status: "abandoned" },
      })));
    }
  });

  return NextResponse.json({ ok: true });
}
