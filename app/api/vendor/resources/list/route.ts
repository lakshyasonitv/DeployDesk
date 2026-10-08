import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";

/**
 * POST /api/vendor/resources/list — put a draft on the exchange, or pull it back.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * The add form has always offered "Save as draft", and nothing could ever undraft one. A
 * draft is excluded from the ops talent pool — correctly; a draft is not an offer — and the
 * roster showed no draft state and had no drafts filter, so a person saved that way was
 * parked permanently: on their own vendor's roster, invisible to Talentvibes, with no
 * control anywhere that would list them.
 *
 * Reported by the owner after adding someone and not being able to find them.
 *
 * ---------------------------------------------------------------------------
 * ONLY BETWEEN DRAFT AND LISTED
 * ---------------------------------------------------------------------------
 *
 * `in_process` and `deployed` are refused. Someone on a live shortlist or already working
 * cannot be quietly taken off the exchange by their supplier — a client is mid-decision on
 * them, and the withdrawal path for that is `DELETE /api/vendor/resources`, which refuses
 * those states too and for the same reason.
 *
 * Listing sets `last_confirmed_at`, matching the create endpoint: a profile is confirmed
 * fresh at the moment it becomes available, because that is the moment the vendor asserted
 * it. Unlisting clears both stamps, so Undo restores the draft exactly as it was.
 */

const Body = z.object({
  maskedId: z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/),
  to: z.enum(["listed", "draft"]),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { maskedId, to } = parsed.data;
  const session = await getDemoSession("vendor");
  const now = new Date();

  const [owned] = await db
    .select({
      id: s.benchResources.id,
      status: s.benchResources.status,
      fullName: s.benchResources.fullName,
    })
    .from(s.benchResources)
    .where(and(
      eq(s.benchResources.maskedId, maskedId),
      // Tenancy: another supplier's person is not found rather than refused.
      eq(s.benchResources.vendorOrgId, session.orgId),
    ))
    .limit(1);

  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (owned.status !== "draft" && owned.status !== "listed") {
    return NextResponse.json(
      { error: "not_draftable", status: owned.status },
      { status: 409 },
    );
  }
  // Already where the caller wants it: the end state is what they asked for.
  if (owned.status === to) {
    return NextResponse.json({ ok: true, maskedId, status: to, changed: false });
  }

  /**
   * One transaction for the row and its audit entry. Working agreement 5 covers this —
   * listing someone changes whether a client can be offered them.
   */
  await db.transaction(async (tx) => {
    await tx
      .update(s.benchResources)
      .set(to === "listed"
        ? { status: "listed", listedAt: now, lastConfirmedAt: now, updatedAt: now }
        : { status: "draft", listedAt: null, lastConfirmedAt: null, updatedAt: now })
      .where(eq(s.benchResources.id, owned.id));

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: to === "listed" ? "resource.listed" : "resource.unlisted",
      entityType: "bench_resource",
      entityId: owned.id,
      before: { status: owned.status },
      after: { status: to },
      context: { maskedId },
    });
  });

  return NextResponse.json({ ok: true, maskedId, status: to, changed: true });
}
