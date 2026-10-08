import { NextResponse } from "next/server";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";
import { addToRequirement, OPEN_STAGES } from "@/src/lib/matching/run";

/**
 * POST   /api/ops/pool/add-to-requirement — put people from the talent pool into a role.
 * DELETE /api/ops/pool/add-to-requirement — take them back out, which is the Undo.
 *
 * ---------------------------------------------------------------------------
 * WHY A MANUAL ADD EXISTS WHEN MATCHING IS AUTOMATIC
 * ---------------------------------------------------------------------------
 *
 * Because overriding a gate is the point. The matcher sources every ELIGIBLE person for a
 * requirement automatically, so a manual add that refused ineligible candidates could only
 * ever add somebody matching had already found. `docs/MATCHING.md` says as much: *"Record
 * the reason in `matches.eligibility` when ops explicitly asks to see blocked candidates."*
 *
 * So a stale, duplicate-flagged or already-deployed person is added **carrying the gate they
 * failed**, and the desk flags them rather than mixing them in silently. Self-dealing and
 * blocked suppliers are still refused — the desk filters those rows out via
 * `is_self_dealing` / `match_is_blocked`, so the row would be written and never shown, and a
 * client's block list is an instruction rather than a default.
 *
 * ---------------------------------------------------------------------------
 * ONLY INTO A ROLE SOMEBODY IS WORKING
 * ---------------------------------------------------------------------------
 *
 * `new`, `matching`, `shortlisted`, `interviewing`. A `draft` has not been committed to, and
 * `placed`, `closed` and `cancelled` are finished — a match row on one of those is invisible
 * work that will never be looked at.
 *
 * ---------------------------------------------------------------------------
 * UNDO
 * ---------------------------------------------------------------------------
 *
 * Removes only the rows this call created, and only while they are still internal: a
 * candidate already on a sent shortlist is refused, because the client has seen them and
 * ADR-004 froze their band. Deleting the match row would leave a `shortlist_items` row
 * pointing at a pool entry that no longer exists.
 */

const Body = z.object({
  code: z.string().regex(/^REQ-\d{3,6}$/i),
  maskedIds: z.array(z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/)).min(1).max(50),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { code, maskedIds } = parsed.data;
  const session = await getDemoSession("ops");

  const [requirement] = await db
    .select({ id: s.requirements.id, stage: s.requirements.stage, roleTitle: s.requirements.roleTitle })
    .from(s.requirements)
    .where(eq(s.requirements.code, code.toUpperCase()))
    .limit(1);

  if (!requirement) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (!OPEN_STAGES.includes(requirement.stage as never)) {
    return NextResponse.json(
      { error: "stage_closed", stage: requirement.stage },
      { status: 409 },
    );
  }

  /**
   * The audit row is written INSIDE the insert's transaction, by `addToRequirement` itself,
   * which is why the session is passed down rather than used here. Working agreement 5 says
   * no exceptions, and an audit row appended afterwards by this route is one failed request
   * away from an unrecorded change to the pool a client will be shown a shortlist from.
   */
  let result;
  try {
    result = await addToRequirement(code, maskedIds, {
      userId: session.userId,
      orgId: session.orgId,
    });
  } catch (err) {
    console.error(`addToRequirement failed for ${code}`, err);
    return NextResponse.json({ error: "add_failed" }, { status: 500 });
  }

  // Only what actually landed, taken from the insert's `returning()`. This is what the Undo
  // passes back, so an over-report here is a delete of a row this call never created.
  const written = [...result.added, ...result.flagged.map((f) => f.maskedId)];

  return NextResponse.json({ ok: true, ...result, written });
}

export async function DELETE(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const { code, maskedIds } = parsed.data;
  const session = await getDemoSession("ops");

  const [requirement] = await db
    .select({ id: s.requirements.id })
    .from(s.requirements)
    .where(eq(s.requirements.code, code.toUpperCase()))
    .limit(1);

  if (!requirement) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const targets = await db
    .select({ resourceId: s.benchResources.id, maskedId: s.benchResources.maskedId })
    .from(s.benchResources)
    .where(inArray(s.benchResources.maskedId, maskedIds));

  if (!targets.length) return NextResponse.json({ ok: true, removed: [] });

  /**
   * Anybody already quoted stays. ADR-004 froze their band on `shortlist_items`, and
   * deleting the match row would leave that row pointing at a pool entry that no longer
   * exists — with the client still holding the profile.
   */
  const quoted = await db
    .select({ resourceId: s.shortlistItems.resourceId })
    .from(s.shortlistItems)
    .innerJoin(s.shortlists, eq(s.shortlists.id, s.shortlistItems.shortlistId))
    .where(and(
      eq(s.shortlists.requirementId, requirement.id),
      inArray(s.shortlistItems.resourceId, targets.map((t) => t.resourceId)),
    ));

  const quotedIds = new Set(quoted.map((q) => q.resourceId));
  const removable = targets.filter((t) => !quotedIds.has(t.resourceId));

  if (!removable.length) {
    return NextResponse.json({
      ok: true, removed: [],
      keptBecauseQuoted: targets.map((t) => t.maskedId),
    });
  }

  const byResourceId = new Map(targets.map((t) => [t.resourceId, t.maskedId]));
  const now = new Date();

  /**
   * `returning()` rather than counting the rows we asked for.
   *
   * The two guards below narrow further than `removable` does, so reporting the candidate
   * list as "removed" would claim deletions that never happened — and this response drives
   * the toast. The same defect as "Reset to algorithm", which toasted a reset while only
   * clearing local state.
   */
  const deleted = await db.transaction(async (tx) => {
    const gone = await tx.delete(s.matches).where(and(
      eq(s.matches.requirementId, requirement.id),
      inArray(s.matches.resourceId, removable.map((r) => r.resourceId)),
      // Never remove a row a broker has arranged by hand or marked to send; that is work,
      // not an accidental add.
      isNull(s.matches.manualRank),
      eq(s.matches.included, false),
    )).returning({ resourceId: s.matches.resourceId });

    const maskedIdsGone = gone.map((g) => byResourceId.get(g.resourceId) ?? g.resourceId);

    if (maskedIdsGone.length) {
      await tx.insert(s.auditLog).values({
        actorId: session.userId,
        actorOrgId: session.orgId,
        action: "pool.add_undone",
        entityType: "requirement",
        entityId: requirement.id,
        before: { inPool: maskedIdsGone },
        after: { inPool: [] },
        context: { code: code.toUpperCase(), asked: maskedIds },
        occurredAt: now,
      });
    }

    /**
     * Renumber what is left. Deleting rows leaves gaps in `algo_rank`, and the desk shows
     * that number — a pool reading 1, 2, 4, 5 is a defect somebody will report.
     * `manual_rank` is left alone for the same reason the add leaves it alone.
     */
    if (maskedIdsGone.length) {
      const pool = await tx
        .select({ id: s.matches.id })
        .from(s.matches)
        .where(eq(s.matches.requirementId, requirement.id))
        .orderBy(asc(s.matches.algoRank));
      for (const [i, m] of pool.entries()) {
        await tx.update(s.matches).set({ algoRank: i + 1, updatedAt: now })
          .where(eq(s.matches.id, m.id));
      }
    }

    return maskedIdsGone;
  });

  return NextResponse.json({
    ok: true,
    removed: deleted,
    keptBecauseQuoted: targets.filter((t) => quotedIds.has(t.resourceId)).map((t) => t.maskedId),
    /** Asked for, still there: a broker had arranged or included them by hand. */
    keptBecauseArranged: removable
      .map((r) => r.maskedId)
      .filter((id) => !deleted.includes(id)),
  });
}
