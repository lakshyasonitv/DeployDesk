import { NextResponse } from "next/server";
import { and, desc, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";

/**
 * POST   /api/client/engagements/extension — ask to keep someone for longer.
 * DELETE /api/client/engagements/extension — withdraw that ask, which is the Undo.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS ROUTE EXISTS
 * ---------------------------------------------------------------------------
 *
 * "Request an extension" has been a visible button with no handler since the screen was
 * built, and migration 0005 created `extension_requests` for it. The table was seeded and
 * the button still did nothing.
 *
 * ---------------------------------------------------------------------------
 * WHAT THE CLIENT IS AND IS NOT TOLD
 * ---------------------------------------------------------------------------
 *
 * An extension is not the client's to grant. The person is employed by a supplier who may
 * have already committed them elsewhere, so the request goes to a broker, who checks the
 * release and comes back. That is why the status enum has `with_supplier` — and why the
 * CLIENT is never shown that phrase. `src/read-models/client/index.ts` maps it to "Your
 * Talentvibes team is confirming". The client learns that someone is working on it, never
 * that a supplier is being asked, because "we are waiting on the supplier" plus a date is
 * the beginning of a guess about who the supplier is.
 *
 * `client_note` is CLIENT + OPS ONLY (see the column comment). It routinely contains the
 * client's own project names and timelines, so it is never relayed to a vendor verbatim —
 * the same rule as a panel's interview note.
 *
 * ---------------------------------------------------------------------------
 * UNDO
 * ---------------------------------------------------------------------------
 *
 * Withdrawing sets the status to `withdrawn`; it does not delete the row. A deleted row
 * would take its audit trail with it, and this is a commercial request in a brokered
 * marketplace — exactly the thing a dispute is later argued over. The client read model
 * maps `withdrawn` to null, so an undone request leaves no trace on screen while the
 * history survives.
 */

/** The statuses that mean "someone is still working on this". */
const OPEN = ["requested", "with_supplier"] as const;

const Body = z.object({
  /** The masked person identifies the engagement without exposing an internal id. */
  maskedId: z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/),
  /** A plain date, YYYY-MM-DD. Validated against the engagement's own end date below. */
  requestedUntil: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  note: z.string().trim().max(2000).nullable().optional(),
});

const UndoBody = Body.pick({ maskedId: true });

/**
 * The one path a client has to an engagement. Scoped to the caller's organisation, so
 * another client's placement is simply not found rather than refused — a 403 that says
 * "this belongs to someone else" is itself a disclosure (docs/MASKING.md, side channels).
 */
async function findEngagement(clientOrgId: string, maskedId: string) {
  const [row] = await db
    .select({
      id: s.engagements.id,
      endDate: s.engagements.endDate,
      status: s.engagements.status,
      roleTitle: s.engagements.roleTitle,
    })
    .from(s.engagements)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.engagements.resourceId))
    .where(and(
      eq(s.engagements.clientOrgId, clientOrgId),
      eq(s.benchResources.maskedId, maskedId),
      inArray(s.engagements.status, ["onboarding", "active", "ending"]),
    ))
    // A person could in principle have been placed with this client more than once; the
    // live one is the one being extended.
    .orderBy(desc(s.engagements.startDate))
    .limit(1);
  return row ?? null;
}

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

  const engagement = await findEngagement(session.orgId, b.maskedId);
  if (!engagement) return NextResponse.json({ error: "not_found" }, { status: 404 });

  /**
   * The date has to be worth asking for. Both checks are here rather than in Zod because
   * both depend on data the request does not carry.
   */
  const until = new Date(`${b.requestedUntil}T00:00:00Z`);
  if (Number.isNaN(until.getTime())) {
    return NextResponse.json({ error: "invalid_date" }, { status: 400 });
  }
  if (until.getTime() <= Date.now()) {
    return NextResponse.json({ error: "date_in_past" }, { status: 400 });
  }
  if (engagement.endDate && until <= new Date(`${engagement.endDate}T00:00:00Z`)) {
    // Asking to extend to a date at or before the agreed end is not an extension.
    return NextResponse.json(
      { error: "not_an_extension", currentEnd: engagement.endDate },
      { status: 409 },
    );
  }

  const [open] = await db
    .select({ id: s.extensionRequests.id })
    .from(s.extensionRequests)
    .where(and(
      eq(s.extensionRequests.engagementId, engagement.id),
      inArray(s.extensionRequests.status, [...OPEN]),
    ))
    .limit(1);
  if (open) return NextResponse.json({ error: "already_open" }, { status: 409 });

  /**
   * One transaction for the row and its audit entry. Working agreement 5 requires the
   * audit row, and an earlier bug in this codebase committed two rows with no audit entry
   * because the writes were not wrapped — `db.transaction` is safe on Supavisor's
   * transaction-mode pooling, since a transaction is the unit it pools.
   */
  const created = await db.transaction(async (tx) => {
    const [row] = await tx
      .insert(s.extensionRequests)
      .values({
        engagementId: engagement.id,
        requestedBy: session.userId,
        requestedUntil: b.requestedUntil,
        clientNote: b.note?.trim() ? b.note.trim() : null,
        status: "requested",
      })
      .returning({ id: s.extensionRequests.id });

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: "extension.requested",
      entityType: "extension_request",
      entityId: row.id,
      after: { requestedUntil: b.requestedUntil, status: "requested" },
      context: { maskedId: b.maskedId, roleTitle: engagement.roleTitle },
    });

    return row;
  });

  return NextResponse.json({
    ok: true,
    id: created.id,
    // The same wording the read model uses, so the toast and the panel agree.
    statusLabel: "Sent to your Talentvibes team",
  });
}

export async function DELETE(req: Request) {
  const parsed = UndoBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const session = await getDemoSession("client");

  const engagement = await findEngagement(session.orgId, parsed.data.maskedId);
  if (!engagement) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const [open] = await db
    .select({
      id: s.extensionRequests.id,
      status: s.extensionRequests.status,
      requestedUntil: s.extensionRequests.requestedUntil,
    })
    .from(s.extensionRequests)
    .where(and(
      eq(s.extensionRequests.engagementId, engagement.id),
      inArray(s.extensionRequests.status, [...OPEN]),
    ))
    .orderBy(desc(s.extensionRequests.createdAt))
    .limit(1);

  // Nothing open is a no-op rather than an error: the Undo may simply have been pressed
  // twice, and the end state is the one the caller wanted either way.
  if (!open) return NextResponse.json({ ok: true, withdrew: null });

  await db.transaction(async (tx) => {
    await tx
      .update(s.extensionRequests)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(eq(s.extensionRequests.id, open.id));

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: "extension.withdrawn",
      entityType: "extension_request",
      entityId: open.id,
      before: { status: open.status, requestedUntil: open.requestedUntil },
      after: { status: "withdrawn" },
      context: { maskedId: parsed.data.maskedId },
    });
  });

  return NextResponse.json({ ok: true, withdrew: open.id });
}
