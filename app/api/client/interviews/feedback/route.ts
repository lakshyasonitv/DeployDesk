import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";

/**
 * POST /api/client/interviews/feedback — a panel member records how a round went.
 *
 * ---------------------------------------------------------------------------
 * THE RELAY, WHICH IS WHY THIS IS NOT JUST A FORM
 * ---------------------------------------------------------------------------
 *
 * `notes` is the panel's verbatim write-up and is CLIENT + OPS ONLY. The supplier gets
 * `relayed_summary` — a version a broker writes by hand — and this route never sets it.
 * That separation is the point: a panel note routinely contains the client's own name, its
 * project, its team's opinions and sometimes its budget, and passing it through unedited
 * would hand a supplier everything masking exists to withhold.
 *
 * So this route writes the client's half and stops. `relayed_at`, `relayed_summary` and
 * `relayed_by` stay null until ops relays it, which is an ops action on an ops screen.
 *
 * ---------------------------------------------------------------------------
 * UNDO
 * ---------------------------------------------------------------------------
 *
 * Re-submitting replaces the previous answer, so Undo restores whatever was there before
 * rather than deleting the row — the row also carries `due_at`, which the client never set
 * and must not lose. A first submission is undone by clearing the ratings, outcome and
 * notes back to null.
 */

const Ratings = z.object({
  technicalDepth: z.number().int().min(1).max(5).nullable(),
  problemSolving: z.number().int().min(1).max(5).nullable(),
  communication: z.number().int().min(1).max(5).nullable(),
  roleFit: z.number().int().min(1).max(5).nullable(),
});

const Body = z.object({
  /** The masked candidate and the round identify the interview without exposing ids. */
  maskedId: z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/),
  roundNo: z.number().int().min(1).max(5),
  ratings: Ratings,
  outcome: z.enum(["advance", "hold", "pass"]).nullable(),
  notes: z.string().trim().max(4000).nullable(),
});

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

  /**
   * Tenancy, through the only path a client has to an interview:
   * interviews -> shortlist_items -> shortlists -> requirements -> client_org_id.
   *
   * A round on another client's requirement is simply not found.
   */
  const [round] = await db
    .select({
      interviewId: s.interviews.id,
      status: s.interviews.status,
    })
    .from(s.interviews)
    .innerJoin(s.shortlistItems, eq(s.shortlistItems.id, s.interviews.shortlistItemId))
    .innerJoin(s.shortlists, eq(s.shortlists.id, s.shortlistItems.shortlistId))
    .innerJoin(s.requirements, eq(s.requirements.id, s.shortlists.requirementId))
    .where(and(
      eq(s.requirements.clientOrgId, session.orgId),
      eq(s.shortlistItems.maskedId, b.maskedId),
      eq(s.interviews.roundNo, b.roundNo),
    ))
    .limit(1);

  if (!round) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [existing] = await db
    .select({
      id: s.interviewFeedback.id,
      technicalDepth: s.interviewFeedback.ratingTechnicalDepth,
      problemSolving: s.interviewFeedback.ratingProblemSolving,
      communication: s.interviewFeedback.ratingCommunication,
      roleFit: s.interviewFeedback.ratingRoleFit,
      notes: s.interviewFeedback.notes,
      outcome: s.interviewFeedback.outcome,
      relayedAt: s.interviewFeedback.relayedAt,
    })
    .from(s.interviewFeedback)
    .where(eq(s.interviewFeedback.interviewId, round.interviewId))
    .limit(1);

  /**
   * Once a broker has relayed a summary to the supplier, the client's write-up is part of
   * a conversation that has already happened. Changing it silently would leave the relayed
   * version and the original disagreeing, so this is refused rather than merged.
   */
  if (existing?.relayedAt) {
    return NextResponse.json({ error: "already_relayed" }, { status: 409 });
  }

  const before = existing
    ? {
        technicalDepth: existing.technicalDepth, problemSolving: existing.problemSolving,
        communication: existing.communication, roleFit: existing.roleFit,
        notes: existing.notes, outcome: existing.outcome,
      }
    : null;

  await db.transaction(async (tx) => {
    const values = {
      ratingTechnicalDepth: b.ratings.technicalDepth,
      ratingProblemSolving: b.ratings.problemSolving,
      ratingCommunication: b.ratings.communication,
      ratingRoleFit: b.ratings.roleFit,
      notes: b.notes,
      outcome: b.outcome,
      submittedBy: session.userId,
      // Null outcome means the panel saved progress without concluding, so it is not
      // submitted yet and the "feedback due" count should still include it.
      submittedAt: b.outcome ? now : null,
    };

    if (existing) {
      await tx.update(s.interviewFeedback)
        .set(values)
        .where(eq(s.interviewFeedback.id, existing.id));
    } else {
      await tx.insert(s.interviewFeedback).values({
        interviewId: round.interviewId,
        ...values,
      });
    }

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: b.outcome ? "interview_feedback.submitted" : "interview_feedback.saved",
      entityType: "interview",
      entityId: round.interviewId,
      before,
      after: {
        technicalDepth: b.ratings.technicalDepth, problemSolving: b.ratings.problemSolving,
        communication: b.ratings.communication, roleFit: b.ratings.roleFit,
        outcome: b.outcome,
        // The verbatim note is NOT copied into the audit row. It is client+ops only and
        // the audit log is read on ops screens that do not need it; recording its length
        // is enough to show something was written.
        notes_length: b.notes?.length ?? 0,
      },
      context: { source: "client_portal", masked_id: b.maskedId, round_no: b.roundNo },
      occurredAt: now,
    });
  });

  return NextResponse.json({
    maskedId: b.maskedId,
    roundNo: b.roundNo,
    submitted: Boolean(b.outcome),
    /** Returned so the client can restore it with a second call — this is the Undo. */
    previous: before,
  });
}
