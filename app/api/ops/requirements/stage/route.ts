import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";

/**
 * POST /api/ops/requirements/stage — move a requirement between stages.
 *
 * Undo is a FORWARD transition back to the previous stage, never a deletion of the
 * event: docs/DOMAIN.md requires the stage trail to stay intact for cycle-time
 * analytics and dispute evidence.
 */
const Body = z.object({
  code: z.string().regex(/^REQ-\d{4}$/),
  toStage: z.enum(["draft","new","matching","shortlisted","interviewing","placed","closed","cancelled"]),
  reason: z.string().max(200).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { code, toStage, reason } = parsed.data;
  const session = await getDemoSession("ops");

  const [req0] = await db
    .select({ id: s.requirements.id, stage: s.requirements.stage, roleTitle: s.requirements.roleTitle })
    .from(s.requirements).where(eq(s.requirements.code, code)).limit(1);
  if (!req0) return NextResponse.json({ error: "not_found" }, { status: 404 });
  if (req0.stage === toStage) return NextResponse.json({ code, stage: toStage, unchanged: true });

  const now = new Date();
  await db.update(s.requirements).set({ stage: toStage, updatedAt: now }).where(eq(s.requirements.id, req0.id));

  await db.insert(s.requirementStageEvents).values({
    requirementId: req0.id, fromStage: req0.stage, toStage,
    actorId: session.userId, reason: reason ?? null, occurredAt: now,
  });

  await db.insert(s.auditLog).values({
    actorId: session.userId, actorOrgId: session.orgId,
    action: "requirement.stage_changed", entityType: "requirement", entityId: req0.id,
    before: { stage: req0.stage }, after: { stage: toStage },
    context: { reason: reason ?? null, source: "ops_pipeline" }, occurredAt: now,
  });

  return NextResponse.json({ code, from: req0.stage, stage: toStage });
}
