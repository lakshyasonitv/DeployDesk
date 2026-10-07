import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";

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
 * Undo re-opens the flag and relists whatever was withdrawn, which is why `before` records
 * the previous status of both resources rather than only the flag.
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

  // Both sides' current status, so Undo can put them back exactly as they were rather
  // than guessing at "listed".
  const sides = await db
    .select({ id: s.benchResources.id, maskedId: s.benchResources.maskedId, status: s.benchResources.status })
    .from(s.benchResources)
    .where(eq(s.benchResources.id, flag.resourceAId));
  const [sideB] = await db
    .select({ id: s.benchResources.id, maskedId: s.benchResources.maskedId, status: s.benchResources.status })
    .from(s.benchResources)
    .where(eq(s.benchResources.id, flag.resourceBId));
  const sideA = sides[0];

  // The submission that loses, if any. `not_duplicate` and `open` withdraw nobody.
  const loser = resolution === "kept_a" ? sideB : resolution === "kept_b" ? sideA : null;

  await db.transaction(async (tx) => {
    await tx.update(s.duplicateFlags)
      .set({
        status: resolution,
        resolvedBy: resolution === "open" ? null : session.userId,
        resolvedAt: resolution === "open" ? null : now,
        resolutionNote: note ?? null,
        updatedAt: now,
      })
      .where(eq(s.duplicateFlags.id, flag.id));

    if (loser) {
      await tx.update(s.benchResources)
        .set({ status: "withdrawn", updatedAt: now })
        .where(eq(s.benchResources.id, loser.id));
    }

    /**
     * Re-opening relists both sides.
     *
     * `listed` rather than their exact previous status, deliberately: a resource that was
     * `withdrawn` only because this flag resolved against it belongs back on the bench,
     * and one that was already `in_process` is not reachable here because resolving never
     * touched it. The audit row carries the real previous values either way.
     */
    if (resolution === "open") {
      for (const side of [sideA, sideB]) {
        if (side?.status === "withdrawn") {
          await tx.update(s.benchResources)
            .set({ status: "listed", updatedAt: now })
            .where(eq(s.benchResources.id, side.id));
        }
      }
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
  });

  return NextResponse.json({
    code,
    status: resolution,
    withdrew: loser?.maskedId ?? null,
    previousStatus: flag.status,
  });
}
