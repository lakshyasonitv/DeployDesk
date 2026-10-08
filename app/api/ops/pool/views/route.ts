import { NextResponse } from "next/server";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";

/**
 * POST   /api/ops/pool/views — save the filters currently on screen under a name.
 * DELETE /api/ops/pool/views — forget one.
 *
 * "Save this view" was a button with no handler. Migration 0005 created `saved_views` for
 * it and the table sat seeded and unused.
 *
 * ---------------------------------------------------------------------------
 * WHY THERE IS NO AUDIT ROW
 * ---------------------------------------------------------------------------
 *
 * Working agreement 5 requires one for anything that changes a stage, a rate, a shortlist
 * or a duplicate resolution. A saved view is none of those: it changes no commercial state
 * and nobody's dispute turns on which filters a broker had bookmarked. Writing an audit row
 * anyway would dilute a log whose value is that every line in it matters.
 *
 * ---------------------------------------------------------------------------
 * SCOPED TO THE USER *AND* THE ORG
 * ---------------------------------------------------------------------------
 *
 * `saved_views` carries both, and the unique constraint is
 * (user_id, screen, name) — so saving under a name you already used RENAMES rather than
 * duplicating. The org is on the row as well because a pool filter can name a supplier,
 * and a view is therefore not something to hand to a different organisation even if the
 * same person worked at both.
 */

const SCREEN = "ops.pool";

/**
 * The filter shape, validated rather than trusted.
 *
 * `filters` is `jsonb`, so without a schema this endpoint would happily store any object a
 * caller posted and the pool would later read it back as filters. Mirrors `PoolFilters`.
 */
const Filters = z.object({
  skills: z.array(z.string().min(1).max(80)).max(8).optional(),
  experienceBand: z.enum(["0-3", "3-5", "5-8", "8+"]).optional(),
  minScore: z.number().int().min(1).max(100).optional(),
  city: z.string().min(1).max(80).optional(),
  supplier: z.string().min(1).max(160).optional(),
  maxRatePaise: z.number().int().positive().optional(),
  freshness: z.enum(["confirmed", "expiring", "unconfirmed"]).optional(),
  search: z.string().max(120).optional(),
}).strict();

const Body = z.object({
  name: z.string().trim().min(1).max(80),
  filters: Filters,
});

const DeleteBody = z.object({ name: z.string().trim().min(1).max(80) });

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { name, filters } = parsed.data;
  const session = await getDemoSession("ops");

  // A view with no filters would restore to "everything", which is what clearing does.
  if (!Object.keys(filters).length) {
    return NextResponse.json({ error: "no_filters" }, { status: 400 });
  }

  const [row] = await db
    .insert(s.savedViews)
    .values({
      userId: session.userId,
      orgId: session.orgId,
      screen: SCREEN,
      name,
      filters,
    })
    // Saving over a name you already used replaces it, which is what the unique
    // constraint is for — two "Java 5-8" views that differ would be worse than one.
    .onConflictDoUpdate({
      target: [s.savedViews.userId, s.savedViews.screen, s.savedViews.name],
      set: { filters, updatedAt: new Date() },
    })
    .returning({ id: s.savedViews.id, name: s.savedViews.name });

  return NextResponse.json({ ok: true, name: row.name });
}

export async function DELETE(req: Request) {
  const parsed = DeleteBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const session = await getDemoSession("ops");

  // Scoped to the caller, so a name cannot delete someone else's view of the same name.
  await db
    .delete(s.savedViews)
    .where(and(
      eq(s.savedViews.userId, session.userId),
      eq(s.savedViews.screen, SCREEN),
      eq(s.savedViews.name, parsed.data.name),
    ));

  // Deleting something already gone is the end state the caller wanted either way.
  return NextResponse.json({ ok: true });
}
