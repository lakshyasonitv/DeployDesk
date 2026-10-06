import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";
import { freshnessFor } from "@/src/lib/derived";

/**
 * POST /api/vendor/resources/confirm — "still available".
 *
 * Demonstrates the full definition of done from CLAUDE.md on a write path:
 *   - Zod-validated input, schema colocated with the route
 *   - tenancy check: the caller's org must own every resource named
 *   - vendor-shaped response, no client or margin field in the shape
 *   - audit row per confirmation
 *   - appends to availability_confirmations; last_confirmed_at is the denormalised copy
 *
 * Note what the client CANNOT send: a vendor_id. The org comes from the session, never
 * the request body (CLAUDE.md working agreement 6).
 */

const Body = z.object({
  maskedIds: z.array(z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/)).min(1).max(200),
  method: z.enum(["single", "bulk"]).default("single"),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { maskedIds, method } = parsed.data;
  const session = await getDemoSession("vendor");

  // Tenancy: scope the lookup to the caller's org. A resource belonging to another
  // vendor is simply not found — the response never says it exists elsewhere, which
  // would itself be a leak (docs/MASKING.md, error messages).
  const owned = await db
    .select({
      id: s.benchResources.id,
      maskedId: s.benchResources.maskedId,
      lastConfirmedAt: s.benchResources.lastConfirmedAt,
    })
    .from(s.benchResources)
    .where(and(
      eq(s.benchResources.vendorOrgId, session.orgId),
      inArray(s.benchResources.maskedId, maskedIds),
    ));

  if (owned.length === 0) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  const now = new Date();
  const ids = owned.map((r) => r.id);

  await db.insert(s.availabilityConfirmations).values(
    owned.map((r) => ({
      resourceId: r.id, confirmedBy: session.userId, confirmedAt: now, method,
    })),
  );

  await db.update(s.benchResources)
    .set({ lastConfirmedAt: now, updatedAt: now })
    .where(inArray(s.benchResources.id, ids));

  // Every state-changing action writes an audit row. No exceptions.
  await db.insert(s.auditLog).values(
    owned.map((r) => ({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: "resource.availability_confirmed",
      entityType: "bench_resource",
      entityId: r.id,
      before: { last_confirmed_at: r.lastConfirmedAt?.toISOString() ?? null },
      after: { last_confirmed_at: now.toISOString() },
      context: { method, source: "vendor_portal" },
      occurredAt: now,
    })),
  );

  const f = freshnessFor(now, now);
  return NextResponse.json({
    confirmed: owned.map((r) => r.maskedId),
    freshness: { state: f.state, label: "Confirmed just now", decayBarWidthPct: 100 },
  });
}
