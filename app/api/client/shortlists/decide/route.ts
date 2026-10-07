import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";

/**
 * POST /api/client/shortlists/decide — select or pass a masked candidate, and request
 * interviews for the selected ones.
 *
 * Until now the shortlist board held every decision in React state, so a refresh threw
 * away whatever the client had chosen and the broker never saw any of it. These are the
 * decisions the whole brokered flow turns on, so they belong in the database.
 *
 * ---------------------------------------------------------------------------
 * WHAT THIS ROUTE MUST NOT TOUCH
 * ---------------------------------------------------------------------------
 *
 * A client may set `client_decision` on a shortlist item it owns, and nothing else. It may
 * not reach the resource, the vendor, the match row or the proposed client rate. The
 * tenancy predicate below joins through `shortlists -> requirements -> client_org_id`,
 * which is the only path from a client to a shortlist item, and every write is keyed on
 * ids that survived that join.
 *
 * ---------------------------------------------------------------------------
 * UNDO
 * ---------------------------------------------------------------------------
 *
 * `decision: "pending"` is the reversal, and it is a normal call rather than a special
 * path: putting a candidate back to undecided is a thing a client may legitimately do.
 * Requesting interviews is undone by `action: "withdraw_interviews"`, which cancels the
 * rounds this call created — not every round on the item, because a round the broker has
 * already confirmed is not the client's to erase.
 */

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("decide"),
    requirementCode: z.string().regex(/^REQ-\d{3,6}$/),
    maskedId: z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/),
    decision: z.enum(["pending", "selected", "passed"]),
  }),
  z.object({
    action: z.literal("request_interviews"),
    requirementCode: z.string().regex(/^REQ-\d{3,6}$/),
    maskedIds: z.array(z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/)).min(1).max(20),
  }),
  z.object({
    action: z.literal("withdraw_interviews"),
    requirementCode: z.string().regex(/^REQ-\d{3,6}$/),
    maskedIds: z.array(z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/)).min(1).max(20),
  }),
]);

/** Shortlist items on this requirement that this client actually owns. */
async function ownedItems(clientOrgId: string, requirementCode: string, maskedIds: string[]) {
  return db
    .select({
      itemId: s.shortlistItems.id,
      maskedId: s.shortlistItems.maskedId,
      decision: s.shortlistItems.clientDecision,
      requirementId: s.requirements.id,
      stage: s.requirements.stage,
    })
    .from(s.shortlistItems)
    .innerJoin(s.shortlists, eq(s.shortlists.id, s.shortlistItems.shortlistId))
    .innerJoin(s.requirements, eq(s.requirements.id, s.shortlists.requirementId))
    .where(and(
      eq(s.requirements.clientOrgId, clientOrgId),   // the tenancy check
      eq(s.requirements.code, requirementCode),
      inArray(s.shortlistItems.maskedId, maskedIds),
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
  const b = parsed.data;
  const session = await getDemoSession("client");
  const now = new Date();

  /* ============================================================ decide ==== */

  if (b.action === "decide") {
    const [item] = await ownedItems(session.orgId, b.requirementCode, [b.maskedId]);
    // Not found rather than forbidden: saying "that exists but is not yours" would
    // confirm another client's shortlist contains this person (docs/MASKING.md).
    if (!item) return NextResponse.json({ error: "not_found" }, { status: 404 });

    await db.transaction(async (tx) => {
      await tx.update(s.shortlistItems)
        .set({
          clientDecision: b.decision,
          decidedAt: b.decision === "pending" ? null : now,
        })
        .where(eq(s.shortlistItems.id, item.itemId));

      await tx.insert(s.auditLog).values({
        actorId: session.userId,
        actorOrgId: session.orgId,
        action: `shortlist_item.${b.decision === "pending" ? "undecided" : b.decision}`,
        entityType: "shortlist_item",
        entityId: item.itemId,
        before: { client_decision: item.decision },
        after: { client_decision: b.decision },
        context: { source: "client_portal", requirement: b.requirementCode, masked_id: b.maskedId },
        occurredAt: now,
      });
    });

    return NextResponse.json({ maskedId: b.maskedId, decision: b.decision });
  }

  /* ================================================ request interviews ==== */

  if (b.action === "request_interviews") {
    const items = await ownedItems(session.orgId, b.requirementCode, b.maskedIds);
    if (!items.length) return NextResponse.json({ error: "not_found" }, { status: 404 });

    // Already-requested rounds are skipped rather than duplicated. Asking twice is a
    // normal double-click, not an error worth refusing the whole call for.
    const existing = await db
      .select({ shortlistItemId: s.interviews.shortlistItemId })
      .from(s.interviews)
      .where(inArray(s.interviews.shortlistItemId, items.map((i) => i.itemId)));
    const already = new Set(existing.map((e) => e.shortlistItemId));
    const toCreate = items.filter((i) => !already.has(i.itemId));

    if (!toCreate.length) {
      return NextResponse.json({ requested: [], alreadyRequested: b.maskedIds });
    }

    await db.transaction(async (tx) => {
      await tx.insert(s.interviews).values(
        toCreate.map((i) => ({
          requirementId: i.requirementId,
          shortlistItemId: i.itemId,
          roundNo: 1,
          // `proposed`, not `scheduled`: Talentvibes schedules every round and issues the
          // meeting link, so the client is asking, not booking. `meeting_url` stays null
          // until ops issues it — it must never be a vendor domain.
          status: "proposed" as const,
          requestedAt: now,
        })),
      );

      // Selecting someone and asking to meet them are the same intent, so a requested
      // candidate is marked selected rather than left pending and contradicting itself.
      await tx.update(s.shortlistItems)
        .set({ clientDecision: "selected", decidedAt: now })
        .where(inArray(s.shortlistItems.id, toCreate.map((i) => i.itemId)));

      await tx.insert(s.auditLog).values(
        toCreate.map((i) => ({
          actorId: session.userId,
          actorOrgId: session.orgId,
          action: "interview.requested",
          entityType: "shortlist_item",
          entityId: i.itemId,
          before: { client_decision: i.decision, interview: null },
          after: { client_decision: "selected", interview: { round_no: 1, status: "proposed" } },
          context: { source: "client_portal", requirement: b.requirementCode, masked_id: i.maskedId },
          occurredAt: now,
        })),
      );
    });

    return NextResponse.json({
      requested: toCreate.map((i) => i.maskedId),
      alreadyRequested: b.maskedIds.filter((m) => !toCreate.some((i) => i.maskedId === m)),
    });
  }

  /* =============================================== withdraw interviews ==== */

  const items = await ownedItems(session.orgId, b.requirementCode, b.maskedIds);
  if (!items.length) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const itemIds = items.map((i) => i.itemId);

  /**
   * Only rounds still at `proposed` are withdrawn.
   *
   * Once ops has confirmed a round there is a slot in somebody's calendar and a supplier
   * has been told; unpicking that is a conversation, not a button. So a confirmed round is
   * left alone and reported back, rather than silently cancelled.
   */
  const rounds = await db
    .select({ id: s.interviews.id, shortlistItemId: s.interviews.shortlistItemId, status: s.interviews.status })
    .from(s.interviews)
    .where(inArray(s.interviews.shortlistItemId, itemIds));

  const withdrawable = rounds.filter((r) => r.status === "proposed");
  const kept = rounds.filter((r) => r.status !== "proposed");

  if (withdrawable.length) {
    await db.transaction(async (tx) => {
      await tx.delete(s.interviews)
        .where(inArray(s.interviews.id, withdrawable.map((r) => r.id)));

      // Back to undecided, which is where the candidate was before the request.
      await tx.update(s.shortlistItems)
        .set({ clientDecision: "pending", decidedAt: null })
        .where(inArray(s.shortlistItems.id, withdrawable.map((r) => r.shortlistItemId)));

      await tx.insert(s.auditLog).values(
        withdrawable.map((r) => ({
          actorId: session.userId,
          actorOrgId: session.orgId,
          action: "interview.withdrawn",
          entityType: "shortlist_item",
          entityId: r.shortlistItemId,
          before: { interview: { status: "proposed" }, client_decision: "selected" },
          after: { interview: null, client_decision: "pending" },
          context: { source: "client_portal", requirement: b.requirementCode, reason: "undo" },
          occurredAt: now,
        })),
      );
    });
  }

  return NextResponse.json({
    withdrawn: withdrawable.length,
    keptBecauseConfirmed: kept.length,
  });
}
