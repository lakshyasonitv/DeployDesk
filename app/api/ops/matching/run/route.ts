import { NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";
import { runMatching } from "@/src/lib/matching/run";

/**
 * POST /api/ops/matching/run — source candidates for a requirement, or re-source them.
 *
 * Posting a requirement sources candidates automatically, so this is the second half: a
 * role posted on Monday never sees anybody listed on Tuesday unless something re-runs it.
 * The desk's own copy has always said "matching starts here"; now something starts it.
 *
 * ---------------------------------------------------------------------------
 * RE-RUNNING NEVER DISCARDS A BROKER'S WORK
 * ---------------------------------------------------------------------------
 *
 * `runMatching` updates existing rows rather than deleting and reinserting, and
 * `manual_rank` and `included` are not in its update set. A broker who has dragged a pool
 * into the order they want can re-run to pick up new arrivals without losing that order —
 * `docs/MATCHING.md` keeps `algo_rank` alongside a manual override for exactly this reason,
 * so the workspace can say "manual override active, algorithm ranking saved".
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO TENANCY CHECK ON THE REQUIREMENT
 * ---------------------------------------------------------------------------
 *
 * Resolving the ops session IS the check. `getDemoSession("ops")` throws unless the
 * caller's organisation is the broker, and the broker sees every requirement by definition
 * — it is the only party that sees both sides. A client or vendor session cannot reach this
 * route at all.
 */

const Body = z.object({
  code: z.string().regex(/^REQ-\d{3,6}$/i),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const code = parsed.data.code.toUpperCase();
  const session = await getDemoSession("ops");

  const [requirement] = await db
    .select({ id: s.requirements.id, stage: s.requirements.stage, roleTitle: s.requirements.roleTitle })
    .from(s.requirements)
    .where(eq(s.requirements.code, code))
    .limit(1);

  if (!requirement) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // A closed, cancelled or placed role is finished. Re-sourcing it would put candidates on
  // a desk nobody is working and reopen a decision somebody has already made.
  if (["placed", "closed", "cancelled"].includes(requirement.stage)) {
    return NextResponse.json({ error: "stage_closed", stage: requirement.stage }, { status: 409 });
  }

  let result;
  try {
    result = await runMatching(code);
  } catch (err) {
    console.error(`matching failed for ${code}`, err);
    return NextResponse.json({ error: "matching_failed" }, { status: 500 });
  }

  /**
   * Audit row. Working agreement 5 lists stages, rates, shortlists and duplicate
   * resolutions, and this is none of those — but a re-run CHANGES THE ORDER a client is
   * shown, which is the thing a dispute about a shortlist would turn on. The exclusion
   * counts go in so the record says why a pool was the size it was.
   */
  await db.insert(s.auditLog).values({
    actorId: session.userId,
    actorOrgId: session.orgId,
    action: "matching.run",
    entityType: "requirement",
    entityId: requirement.id,
    after: { matched: result.matched, excluded: result.excluded },
    context: { code, roleTitle: requirement.roleTitle },
  });

  return NextResponse.json({ ok: true, ...result });
}
