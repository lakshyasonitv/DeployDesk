import { NextResponse } from "next/server";
import { and, eq, inArray, ne } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";
import { withdrawBlockers } from "@/src/services/withdrawal";

/**
 * POST /api/ops/duplicates/resolve — settle a duplicate flag.
 *
 * OPS ONLY. A duplicate flag names two suppliers who have submitted the same person, and
 * the PAN and phone hashes it is derived from are ops-only (docs/MASKING.md). Neither
 * supplier may learn that the other exists, let alone that they were compared — so there
 * is no client or vendor equivalent of this route, and the ops portal check is the guard.
 *
 * ---------------------------------------------------------------------------
 * WHAT RESOLVING MEANS
 * ---------------------------------------------------------------------------
 *
 *   kept_a / kept_b    the same person, submitted twice — keep one submission, and the
 *                      other is withdrawn so the matching desk cannot offer them twice.
 *   not_duplicate      two different people who happened to collide on a signal. Nothing
 *                      is withdrawn; the flag simply stops blocking.
 *
 * Withdrawing the losing side matters more than it looks: offering the same person to one
 * client through two suppliers is how a brokered marketplace loses a client's trust, and
 * it is also how two suppliers discover each other.
 *
 * Undo re-opens the flag and relists the person that decision withdrew. `before` records the
 * previous status of both resources rather than only the flag, so the audit row is complete.
 *
 * Nobody with live work — a placement, or a shortlist a client holds — is withdrawn from
 * here: that is a 409 naming the reason, and the screen disables the button to match.
 */

const Body = z.object({
  code: z.string().regex(/^DUP-\d{3,6}$/),
  resolution: z.enum(["kept_a", "kept_b", "not_duplicate", "open"]),
  note: z.string().trim().max(1000).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { code, resolution, note } = parsed.data;
  const session = await getDemoSession("ops");   // ops portal check
  const now = new Date();

  const [flag] = await db
    .select({
      id: s.duplicateFlags.id,
      status: s.duplicateFlags.status,
      resourceAId: s.duplicateFlags.resourceAId,
      resourceBId: s.duplicateFlags.resourceBId,
    })
    .from(s.duplicateFlags)
    .where(eq(s.duplicateFlags.code, code))
    .limit(1);

  if (!flag) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Both sides' current status, for the audit row and for Undo.
  const sides = await db
    .select({ id: s.benchResources.id, maskedId: s.benchResources.maskedId, status: s.benchResources.status })
    .from(s.benchResources)
    .where(inArray(s.benchResources.id, [flag.resourceAId, flag.resourceBId]));
  const sideA = sides.find((x) => x.id === flag.resourceAId);
  const sideB = sides.find((x) => x.id === flag.resourceBId);

  // The submission that loses, if any. `not_duplicate` and `open` withdraw nobody.
  const loser = resolution === "kept_a" ? sideB : resolution === "kept_b" ? sideA : null;

  // Nobody a client is relying on is withdrawn from here (src/services/withdrawal.ts).
  if (loser) {
    const why = (await withdrawBlockers([loser.id])).get(loser.id);
    if (why) {
      return NextResponse.json(
        { error: "cannot_withdraw", maskedId: loser.maskedId, reason: `${loser.maskedId} ${why}` },
        { status: 409 },
      );
    }
  }

  /**
   * Undo relists exactly the person the previous decision withdrew — B after `kept_a`, A
   * after `kept_b`, nobody after `not_duplicate` — and only if they are still withdrawn.
   * It used to relist ANY withdrawn side, including one withdrawn for an unrelated reason.
   * `listed` is right by construction: only a listed person can be withdrawn here.
   */
  const relist = resolution !== "open" ? null
    : flag.status === "kept_a" ? sideB
    : flag.status === "kept_b" ? sideA
    : null;

  /**
   * A flag is settled ONCE, and only a settled flag can be re-opened.
   *
   * There was no such check, and a settled flag still showed its buttons: "Keep A" then
   * "Keep B" withdrew BOTH submissions, taking the person off the exchange entirely.
   * Re-opening an already-open flag was the mirror defect — it relists any side that is
   * withdrawn, including one withdrawn for a reason that has nothing to do with this flag.
   *
   * The condition is on the UPDATE rather than a read beforehand, so two brokers clicking at
   * once cannot both pass it: the second update matches no row and the whole call refuses.
   */
  const settled = await db.transaction(async (tx) => {
    const [updated] = await tx.update(s.duplicateFlags)
      .set({
        status: resolution,
        resolvedBy: resolution === "open" ? null : session.userId,
        resolvedAt: resolution === "open" ? null : now,
        resolutionNote: note ?? null,
        updatedAt: now,
      })
      .where(and(
        eq(s.duplicateFlags.id, flag.id),
        resolution === "open"
          ? ne(s.duplicateFlags.status, "open")
          : eq(s.duplicateFlags.status, "open"),
      ))
      .returning({ id: s.duplicateFlags.id });
    if (!updated) return false;

    if (loser) {
      await tx.update(s.benchResources)
        .set({ status: "withdrawn", updatedAt: now })
        .where(eq(s.benchResources.id, loser.id));
    }

    if (relist?.status === "withdrawn") {
      await tx.update(s.benchResources)
        .set({ status: "listed", updatedAt: now })
        .where(eq(s.benchResources.id, relist.id));
    }

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: resolution === "open" ? "duplicate.reopened" : "duplicate.resolved",
      entityType: "duplicate_flag",
      entityId: flag.id,
      before: {
        status: flag.status,
        resource_a: { masked_id: sideA?.maskedId, status: sideA?.status },
        resource_b: { masked_id: sideB?.maskedId, status: sideB?.status },
      },
      after: {
        status: resolution,
        withdrew: loser?.maskedId ?? null,
      },
      context: { source: "ops_console", code, reason: resolution === "open" ? "undo" : undefined },
      occurredAt: now,
    });
    return true;
  });

  if (!settled) {
    return NextResponse.json(
      { error: resolution === "open" ? "already_open" : "already_settled", status: flag.status },
      { status: 409 },
    );
  }

  return NextResponse.json({
    code,
    status: resolution,
    withdrew: loser?.maskedId ?? null,
    previousStatus: flag.status,
  });
}
