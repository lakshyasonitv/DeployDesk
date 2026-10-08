import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";
import { getHolidaySet } from "@/src/db/holidays";
import { addBusinessHours } from "@/src/lib/business-clock";
import { SLA_WINDOW_HOURS } from "@/src/lib/derived";

/**
 * POST /api/ops/requirements/stage — move a requirement between stages.
 *
 * Undo is a FORWARD transition back to the previous stage, never a deletion of the
 * event: docs/DOMAIN.md requires the stage trail to stay intact for cycle-time
 * analytics and dispute evidence.
 *
 * ---------------------------------------------------------------------------
 * THE SLA CLOCK RESTARTS HERE
 * ---------------------------------------------------------------------------
 *
 * `docs/DOMAIN.md` gives each stage its own clock and its own target — "Clock starts" is a
 * column in that table. This endpoint used to set `{ stage, updatedAt }` and nothing else,
 * so a requirement kept the deadline it was given when it was POSTED: `new` + 4 business
 * hours. Drag it to `matching` and it was still being judged against a deadline that passed
 * the same afternoon, so the Due column read "Overdue 71h" and the number only grew.
 *
 * Reported by the owner as due dates being "randomly decided". They were not random — they
 * referred to a stage the role had left. Only `shortlisted` looked right, and by accident:
 * the read model derives `paused` from that stage, so it shows "Awaiting client" instead of
 * a deadline.
 *
 * So entering a stage now sets `sla_due_at` and `sla_window_hours` from that stage's window,
 * in BUSINESS hours and minus holidays — a role moved at 18:00 on a Saturday is not due at
 * 22:00 on a Sunday. Terminal stages clear the deadline rather than carrying a stale one.
 *
 * There is deliberately **no manual override**. The deadline is a promise the business made,
 * not a per-role negotiation, and the main reason to want one is to quietly extend a
 * deadline you are about to miss.
 */

/**
 * Stages with no clock.
 *
 * `draft` has not been committed to, and `placed`, `closed` and `cancelled` are finished —
 * there is nothing left to be late for. The read model renders a null deadline as
 * "No deadline", and for `placed` it shows the margin instead.
 */
const NO_CLOCK = new Set(["draft", "placed", "closed", "cancelled"]);
const Body = z.object({
  code: z.string().regex(/^REQ-\d{4}$/),
  toStage: z.enum(["draft","new","matching","shortlisted","interviewing","placed","closed","cancelled"]),
  reason: z.string().max(200).optional(),
});

/**
 * The three writes are ONE TRANSACTION.
 *
 * This endpoint predates the lesson and was found by an audit still running them as
 * separate statements. The sibling create endpoints showed what that costs: a request that
 * fails between the row write and the audit write leaves a committed change with **no
 * audit row**, which CLAUDE.md working agreement 5 forbids and nothing would have noticed.
 * Two orphaned requirements had to be deleted by hand before `db:verify` passed again.
 *
 * Transactions are safe on the Supavisor transaction-mode pooler — a transaction is the
 * unit it pools; it is session-level state that is unavailable there.
 */
export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { code, toStage, reason } = parsed.data;
  const session = await getDemoSession("ops");

  const [req0] = await db
    .select({
      id: s.requirements.id, stage: s.requirements.stage, roleTitle: s.requirements.roleTitle,
      slaDueAt: s.requirements.slaDueAt,
    })
    .from(s.requirements).where(eq(s.requirements.code, code)).limit(1);
  if (!req0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (req0.stage === toStage) return NextResponse.json({ code, stage: toStage, unchanged: true });

  const now = new Date();

  /**
   * The new deadline, computed before the transaction opens.
   *
   * `getHolidaySet()` is a cached read and `addBusinessHours` is pure, but neither belongs
   * inside a transaction that is only holding three writes together.
   */
  const windowHours = NO_CLOCK.has(toStage)
    ? null
    : SLA_WINDOW_HOURS[toStage as keyof typeof SLA_WINDOW_HOURS] ?? null;

  const holidays = windowHours == null ? null : await getHolidaySet();
  const slaDueAt = windowHours == null || holidays == null
    ? null
    : addBusinessHours(now, windowHours, holidays);

  await db.transaction(async (tx) => {
    await tx.update(s.requirements)
      .set({
        stage: toStage,
        // Both, together. The read model prefers the per-requirement window over the
        // per-stage default (migration 0002), so writing the deadline without the window
        // would leave the state being judged against the old stage's band.
        slaDueAt,
        slaWindowHours: windowHours,
        updatedAt: now,
      })
      .where(eq(s.requirements.id, req0.id));

    await tx.insert(s.requirementStageEvents).values({
      requirementId: req0.id, fromStage: req0.stage, toStage,
      actorId: session.userId, reason: reason ?? null, occurredAt: now,
    });

    await tx.insert(s.auditLog).values({
      actorId: session.userId, actorOrgId: session.orgId,
      action: "requirement.stage_changed", entityType: "requirement", entityId: req0.id,
      before: { stage: req0.stage, slaDueAt: req0.slaDueAt?.toISOString() ?? null },
      after: {
        stage: toStage,
        slaDueAt: slaDueAt?.toISOString() ?? null,
        slaWindowHours: windowHours,
      },
      context: { reason: reason ?? null, source: "ops_pipeline" }, occurredAt: now,
    });
  });

  return NextResponse.json({
    code,
    from: req0.stage,
    stage: toStage,
    /** So a caller can say "due in 36 business hours" rather than guessing. */
    slaDueAt: slaDueAt?.toISOString() ?? null,
    slaWindowHours: windowHours,
  });
}
