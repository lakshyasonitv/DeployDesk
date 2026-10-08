import { NextResponse } from "next/server";
import { and, asc, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";

/**
 * POST   /api/ops/matching/rank — save the order a broker arranged, and who is included.
 * DELETE /api/ops/matching/rank — clear both, which is "Reset to algorithm".
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * `manual_rank` and `included` were written in exactly ONE place —
 * `/api/ops/shortlists/send`, at send time. Dragging, the ▲▼ buttons and the include
 * toggles were all local React state, so the screen whose entire purpose is arranging an
 * order **did not save the order**: drag somebody to the top, refresh, and it was gone.
 *
 * Worse, "Reset to algorithm" toasted *"ranking reset to the algorithm order"* while only
 * resetting local state. After a shortlist had been sent — the one case where `manual_rank`
 * really was in the database — a refresh brought the manual order straight back. The toast
 * claimed something that had not happened.
 *
 * ---------------------------------------------------------------------------
 * `algo_rank` IS NEVER TOUCHED
 * ---------------------------------------------------------------------------
 *
 * `docs/MATCHING.md`: "`manual_rank` overrides it. When any manual rank exists for a
 * requirement, the workspace shows 'manual override active, algorithm ranking saved' — so
 * **keep `algo_rank`**, do not overwrite it." That state was unreachable before, because
 * nothing wrote `manual_rank` outside a send.
 *
 * ---------------------------------------------------------------------------
 * UNDO
 * ---------------------------------------------------------------------------
 *
 * Both verbs return the PREVIOUS order and inclusion set, so the client can restore exactly
 * what was there rather than guessing. A reset discards work a broker did by hand, which is
 * the strongest case in the product for a real Undo rather than a confirmation dialog: a
 * prompt protects against the click, an Undo protects against the decision.
 */

const MASKED = /^TV-\d{4,5}(-[A-Z])?$/;

const Body = z.object({
  code: z.string().regex(/^REQ-\d{3,6}$/i),
  /** Every candidate in the pool, in the order the broker wants them. */
  order: z.array(z.string().regex(MASKED)).min(1).max(200),
  /** The subset to send. A subset of `order`, enforced below. */
  included: z.array(z.string().regex(MASKED)).max(200),
});

const ResetBody = z.object({ code: z.string().regex(/^REQ-\d{3,6}$/i) });

/**
 * The requirement, and its current pool.
 *
 * No tenancy predicate on the requirement: resolving the ops session IS the check.
 * `getDemoSession("ops")` throws unless the caller is the broker, and the broker sees every
 * requirement by definition — it is the only party that sees both sides.
 */
async function loadPool(code: string) {
  const [req] = await db
    .select({ id: s.requirements.id, roleTitle: s.requirements.roleTitle })
    .from(s.requirements)
    .where(eq(s.requirements.code, code.toUpperCase()))
    .limit(1);
  if (!req) return null;

  const rows = await db
    .select({
      maskedId: s.benchResources.maskedId,
      manualRank: s.matches.manualRank,
      included: s.matches.included,
    })
    .from(s.matches)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.matches.resourceId))
    .where(eq(s.matches.requirementId, req.id))
    // The order the screen is currently showing: manual first, then algorithm.
    .orderBy(asc(sql`coalesce(${s.matches.manualRank}, ${s.matches.algoRank} + 1000)`));

  return { req, rows };
}

/** What was there before, so Undo restores rather than guesses. */
const snapshot = (rows: Array<{ maskedId: string; manualRank: number | null; included: boolean }>) => ({
  order: rows.map((r) => r.maskedId),
  included: rows.filter((r) => r.included).map((r) => r.maskedId),
  hadManualOrder: rows.some((r) => r.manualRank != null),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { code, order, included } = parsed.data;
  const session = await getDemoSession("ops");

  const pool = await loadPool(code);
  if (!pool) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const known = new Set(pool.rows.map((r) => r.maskedId));

  /**
   * Every id must already be in this requirement's pool.
   *
   * Without this, a caller could rank somebody who was never sourced for this role — and
   * `included` is what the send endpoint reads, so that person would end up on a client's
   * shortlist without ever having passed an eligibility gate.
   */
  const unknown = [...new Set([...order, ...included])].filter((id) => !known.has(id));
  if (unknown.length) {
    return NextResponse.json({ error: "not_in_pool", unknown }, { status: 409 });
  }
  const notInOrder = included.filter((id) => !order.includes(id));
  if (notInOrder.length) {
    return NextResponse.json({ error: "included_not_ordered", notInOrder }, { status: 400 });
  }

  const before = snapshot(pool.rows);
  const includedSet = new Set(included);
  const now = new Date();

  await db.transaction(async (tx) => {
    // One statement per row. The pool is tens of rows, not thousands, and a CASE-expression
    // bulk update would be unreadable for no measurable gain at this size.
    for (const [i, maskedId] of order.entries()) {
      await tx
        .update(s.matches)
        .set({ manualRank: i + 1, included: includedSet.has(maskedId), updatedAt: now })
        .where(and(
          eq(s.matches.requirementId, pool.req.id),
          inArray(
            s.matches.resourceId,
            db.select({ id: s.benchResources.id }).from(s.benchResources)
              .where(eq(s.benchResources.maskedId, maskedId)),
          ),
        ));
    }

    /**
     * Audit row. Working agreement 5 names shortlists, and this is the ordering a client
     * will be shown — `docs/MASKING.md` adds that the client sees the final order and only
     * the final order, so who arranged it is exactly what a dispute would turn on.
     */
    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: "matching.ranked",
      entityType: "requirement",
      entityId: pool.req.id,
      before: { order: before.order, included: before.included },
      after: { order, included },
      context: { code: code.toUpperCase(), roleTitle: pool.req.roleTitle },
      occurredAt: now,
    });
  });

  return NextResponse.json({ ok: true, previous: before });
}

export async function DELETE(req: Request) {
  const parsed = ResetBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const session = await getDemoSession("ops");

  const pool = await loadPool(parsed.data.code);
  if (!pool) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const before = snapshot(pool.rows);
  const now = new Date();

  await db.transaction(async (tx) => {
    /**
     * Clears `manual_rank` and `included` **for this requirement only**, which is what
     * `docs/MATCHING.md` defines reset as. `algo_rank` stays — it was never overwritten, so
     * clearing the override is all it takes to fall back to the algorithm order.
     */
    await tx
      .update(s.matches)
      .set({ manualRank: null, included: false, updatedAt: now })
      .where(eq(s.matches.requirementId, pool.req.id));

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: "matching.rank_reset",
      entityType: "requirement",
      entityId: pool.req.id,
      before: { order: before.order, included: before.included },
      after: { order: null, included: [] },
      context: { code: parsed.data.code.toUpperCase(), roleTitle: pool.req.roleTitle },
      occurredAt: now,
    });
  });

  return NextResponse.json({ ok: true, previous: before });
}
