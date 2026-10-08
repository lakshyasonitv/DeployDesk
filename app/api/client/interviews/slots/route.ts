import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";
import { getHolidaySet } from "@/src/db/holidays";
import { isWithinBusinessHours } from "@/src/lib/business-clock";

/**
 * POST   /api/client/interviews/slots — offer times for a round, or ask to move one.
 * DELETE /api/client/interviews/slots — withdraw those offers, which is the Undo.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS NOT JUST A DATE PICKER
 * ---------------------------------------------------------------------------
 *
 * A client cannot book an interview. The person is employed by a supplier who has to
 * release them for the hour, and the client is not allowed to ask. So this route records
 * what the client CAN say — "any of these times work for us" — and hands it to a broker.
 * The round goes to `awaiting_vendor` and the client is told their Talentvibes team is
 * confirming availability, never that a supplier is being asked.
 *
 * A reschedule is the same act with one difference: `scheduled_at` is LEFT ALONE. Clearing
 * it would throw away a booking that is still standing, and a panel that sees an interview
 * vanish from its calendar before a new time exists will assume the system lost it. The
 * existing time holds until a broker accepts a replacement.
 *
 * ---------------------------------------------------------------------------
 * THE WINDOW
 * ---------------------------------------------------------------------------
 *
 * Slots are validated against 09:00-19:00 IST, Monday-Saturday, minus the holiday table
 * (docs/DOMAIN.md). The WHOLE meeting must fit, not just its start — a 60-minute round
 * beginning 18:30 cannot be held. Rejecting it here is better than a broker catching it by
 * eye, and it is the first use of the holiday calendar on a client write path.
 *
 * ---------------------------------------------------------------------------
 * UNDO
 * ---------------------------------------------------------------------------
 *
 * Withdrawing sets the slots to `withdrawn` and never deletes them: a time a client
 * offered and retracted is part of why a round ended up where it did.
 *
 * The round's status is then **derived, not restored from the request**. A client-supplied
 * "put it back to confirmed" would be a trivial way to mark an unbooked interview as
 * booked. Instead: a standing booking plus an accepted slot means `confirmed`; any slot
 * still pending means `awaiting_vendor`; otherwise `proposed`.
 */

const Slot = z.object({
  startsAt: z.string().datetime(),
  durationMinutes: z.number().int().min(15).max(240),
});

const Body = z.object({
  maskedId: z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/),
  roundNo: z.number().int().min(1).max(5),
  slots: z.array(Slot).min(1).max(5),
});

const UndoBody = z.object({
  maskedId: z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/),
  roundNo: z.number().int().min(1).max(5),
  /**
   * The rows this call created. They are the caller's own proposals and carry nothing
   * cross-side, and naming them is what keeps an Undo from withdrawing an EARLIER batch
   * the client still wants answered.
   */
  slotIds: z.array(z.string().uuid()).min(1).max(5),
});

/**
 * The only path a client has to an interview:
 * interviews -> shortlist_items -> shortlists -> requirements.client_org_id.
 *
 * Another client's round is not found rather than refused — a 403 reading "this belongs to
 * someone else" is itself a disclosure (docs/MASKING.md, side channels).
 */
async function findRound(clientOrgId: string, maskedId: string, roundNo: number) {
  const [row] = await db
    .select({
      id: s.interviews.id,
      status: s.interviews.status,
      scheduledAt: s.interviews.scheduledAt,
      roleTitle: s.requirements.roleTitle,
    })
    .from(s.interviews)
    .innerJoin(s.shortlistItems, eq(s.shortlistItems.id, s.interviews.shortlistItemId))
    .innerJoin(s.shortlists, eq(s.shortlists.id, s.shortlistItems.shortlistId))
    .innerJoin(s.requirements, eq(s.requirements.id, s.shortlists.requirementId))
    .where(and(
      eq(s.requirements.clientOrgId, clientOrgId),
      eq(s.shortlistItems.maskedId, maskedId),
      eq(s.interviews.roundNo, roundNo),
    ))
    .limit(1);
  return row ?? null;
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

  const round = await findRound(session.orgId, b.maskedId, b.roundNo);
  if (!round) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A finished or abandoned round is not reschedulable, and offering times for one would
  // put it back into a queue a broker has already cleared.
  if (["completed", "cancelled", "no_show"].includes(round.status)) {
    return NextResponse.json({ error: "round_closed", status: round.status }, { status: 409 });
  }

  const holidays = await getHolidaySet();
  const now = Date.now();
  const seen = new Set<string>();

  for (const slot of b.slots) {
    const starts = new Date(slot.startsAt);
    if (Number.isNaN(starts.getTime())) {
      return NextResponse.json({ error: "invalid_date" }, { status: 400 });
    }
    if (starts.getTime() <= now) {
      return NextResponse.json({ error: "slot_in_past", startsAt: slot.startsAt }, { status: 400 });
    }
    if (!isWithinBusinessHours(starts, slot.durationMinutes, holidays)) {
      return NextResponse.json(
        { error: "outside_business_hours", startsAt: slot.startsAt },
        { status: 400 },
      );
    }
    if (seen.has(slot.startsAt)) {
      return NextResponse.json({ error: "duplicate_slot", startsAt: slot.startsAt }, { status: 400 });
    }
    seen.add(slot.startsAt);
  }

  /**
   * One transaction for the slots, the round's new state and the audit entry. Working
   * agreement 5 requires the audit row, and an earlier bug in this codebase committed rows
   * with no audit entry because the writes were not wrapped.
   */
  const created = await db.transaction(async (tx) => {
    const rows = await tx
      .insert(s.interviewSlots)
      .values(b.slots.map((slot) => ({
        interviewId: round.id,
        startsAt: new Date(slot.startsAt),
        durationMinutes: slot.durationMinutes,
        proposedBy: "client" as const,
        proposedByUserId: session.userId,
        status: "proposed" as const,
      })))
      .returning({ id: s.interviewSlots.id });

    await tx
      .update(s.interviews)
      // `scheduled_at` is untouched on purpose — see the header.
      .set({ status: "awaiting_vendor", requestedAt: new Date(), updatedAt: new Date() })
      .where(eq(s.interviews.id, round.id));

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: "interview.slots_proposed",
      entityType: "interview",
      entityId: round.id,
      before: { status: round.status },
      after: { status: "awaiting_vendor", slots: b.slots.length },
      context: {
        maskedId: b.maskedId,
        roundNo: b.roundNo,
        roleTitle: round.roleTitle,
        wasScheduled: Boolean(round.scheduledAt),
      },
    });

    return rows.map((r) => r.id);
  });

  return NextResponse.json({ ok: true, slotIds: created });
}

export async function DELETE(req: Request) {
  const parsed = UndoBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const b = parsed.data;
  const session = await getDemoSession("client");

  const round = await findRound(session.orgId, b.maskedId, b.roundNo);
  if (!round) return NextResponse.json({ error: "not_found" }, { status: 404 });

  await db.transaction(async (tx) => {
    // Scoped to this round AND to slots the client proposed, so the ids in the body cannot
    // reach another round's rows or withdraw something a broker offered.
    await tx
      .update(s.interviewSlots)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(and(
        inArray(s.interviewSlots.id, b.slotIds),
        eq(s.interviewSlots.interviewId, round.id),
        eq(s.interviewSlots.proposedBy, "client"),
      ));

    /* ---- derive the round's state rather than trust the caller for it ---- */

    const remaining = await tx
      .select({ id: s.interviewSlots.id, status: s.interviewSlots.status })
      .from(s.interviewSlots)
      .where(eq(s.interviewSlots.interviewId, round.id))
      .orderBy(desc(s.interviewSlots.createdAt));

    const hasAccepted = remaining.some((r) => r.status === "accepted");
    const hasPending = remaining.some((r) => r.status === "proposed");

    const status = round.scheduledAt && hasAccepted
      ? "confirmed" as const
      : hasPending ? "awaiting_vendor" as const : "proposed" as const;

    await tx
      .update(s.interviews)
      .set({
        status,
        requestedAt: hasPending ? undefined : null,
        updatedAt: new Date(),
      })
      .where(eq(s.interviews.id, round.id));

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: "interview.slots_withdrawn",
      entityType: "interview",
      entityId: round.id,
      before: { status: round.status },
      after: { status, withdrew: b.slotIds.length },
      context: { maskedId: b.maskedId, roundNo: b.roundNo },
    });
  });

  return NextResponse.json({ ok: true });
}
