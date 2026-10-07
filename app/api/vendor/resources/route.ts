import { NextResponse } from "next/server";
import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";
import { allocateMaskedId, identityHash } from "@/src/lib/masked-id";

/**
 * POST   /api/vendor/resources — list a person on the bench.
 * DELETE /api/vendor/resources — withdraw one, which is the Undo for the above.
 *
 * Full definition of done from CLAUDE.md:
 *   - Zod-validated input, schema colocated
 *   - tenancy: `vendor_org_id` comes from the SESSION, never the body (agreement 6)
 *   - vendor-shaped response: no client field, no margin, nothing about demand
 *   - an audit row on both the create and the withdraw
 *
 * ---------------------------------------------------------------------------
 * WHY UNDO WITHDRAWS RATHER THAN DELETES
 * ---------------------------------------------------------------------------
 *
 * `status = 'withdrawn'` keeps the row, its masked id and both audit entries, so the
 * history reads "listed, then withdrawn" instead of the listing vanishing. That matters
 * here specifically: a masked id is **immutable and never reused** (ADR-010), so deleting
 * the row would either orphan the id or invite it to be handed to a different person
 * later. It also means a resource that was briefly visible to the matching desk can be
 * accounted for.
 *
 * ---------------------------------------------------------------------------
 * IDENTITY HASHES
 * ---------------------------------------------------------------------------
 *
 * PAN and phone are hashed with the server-side pepper for duplicate detection, and the
 * hashes are OPS ONLY (docs/MASKING.md). They are written here because duplicate
 * detection is the reason they exist; nothing in this response returns them.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CREATE IS ONE TRANSACTION
 * ---------------------------------------------------------------------------
 *
 * The row insert, the skill links and the audit row are one unit. The sibling route for
 * posting a role proved why: with three separate statements, a request that failed in the
 * middle left a committed row with no skills and no audit row — a silent violation of
 * working agreement 5, since a half-created record has no audit trail at all. Two orphans
 * had to be deleted by hand before `db:verify` passed again.
 *
 * Transactions are safe on the Supavisor transaction-mode pooler: a transaction is the
 * unit it pools. It is session-level state that is unavailable there.
 */

const Body = z.object({
  fullName: z.string().trim().min(2).max(120),
  employeeCode: z.string().trim().max(40).optional(),
  baseCity: z.string().trim().min(2).max(60),
  /** Whole months. The form collects "6 years 4 months" and converts before sending. */
  experienceMonths: z.number().int().min(0).max(600),
  skills: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  /** Paise, so the boundary never sees a float (ADR-007). */
  vendorRatePaise: z.number().int().min(100_000).max(100_000_000),
  workModes: z.array(z.enum(["onsite", "hybrid", "remote"])).min(1),
  availability: z.enum(["immediate", "30", "60"]).default("immediate"),
  contactEmail: z.string().trim().email().max(160).optional(),
  contactPhone: z.string().trim().max(24).optional(),
  pan: z.string().trim().max(16).optional(),
  /** `draft` keeps it off the exchange; `listed` makes it matchable. */
  status: z.enum(["draft", "listed"]).default("listed"),
});

const NOTICE_DAYS: Record<string, number | null> = { immediate: null, "30": 30, "60": 60 };

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const b = parsed.data;
  const session = await getDemoSession("vendor");
  const now = new Date();

  /* ---------------------------------------------------- the masked id ---- */

  // Allocated against the ids already taken, which is why the whole column is read.
  // At launch scale (~2,000 resources against a 90,000-wide space) this is a small read
  // and the alternative — a sequence — would make the id guessable, which ADR-010 rejects.
  const taken = await db.select({ maskedId: s.benchResources.maskedId }).from(s.benchResources);
  const maskedId = allocateMaskedId(new Set(taken.map((t) => t.maskedId)));

  /* ----------------------------------------------------------- the row ---- */

  const { created, unknown } = await db.transaction(async (tx) => {
    const [row] = await tx.insert(s.benchResources).values({
      vendorOrgId: session.orgId,          // from the session, never the request
      maskedId,
      fullName: b.fullName,
      employeeCode: b.employeeCode ?? null,
      baseCity: b.baseCity,
      experienceMonths: b.experienceMonths,
      availableFrom: null,                  // null means immediate; a date is a later feature
      noticePeriodDays: NOTICE_DAYS[b.availability] ?? null,
      workModes: b.workModes,
      vendorRatePaise: b.vendorRatePaise,
      status: b.status,
      // A profile is confirmed fresh the moment it is listed, which is what the freshness
      // decay measures from.
      lastConfirmedAt: b.status === "listed" ? now : null,
      listedAt: b.status === "listed" ? now : null,
      contactEmail: b.contactEmail ?? null,
      contactPhone: b.contactPhone ?? null,
      panHash: b.pan ? identityHash(b.pan) : null,
      phoneHash: b.contactPhone ? identityHash(b.contactPhone) : null,
      emailHash: b.contactEmail ? identityHash(b.contactEmail.toLowerCase()) : null,
    }).returning({ id: s.benchResources.id, maskedId: s.benchResources.maskedId });

    // Only skills already on the platform are linked. A free-typed skill that is not in
    // the catalogue is ignored rather than silently creating a near-duplicate row
    // ("React.js" beside "React"), which is how a skills taxonomy rots.
    const known = await tx
      .select({ id: s.skills.id, label: s.skills.label })
      .from(s.skills)
      .where(inArray(s.skills.label, b.skills));

    if (known.length) {
      /**
       * Ordered by the vendor's own input, not by whatever order Postgres returned.
       *
       * `isPrimary` marks the headline skill shown on a roster row and a shortlist card,
       * so it has to be the first skill the VENDOR typed. Using the query's order made it
       * whichever row the index happened to return first — the first test wrote
       * "Kafka (primary)" for a profile whose vendor had led with Java Spring Boot.
       */
      const rank = new Map(b.skills.map((label, i) => [label, i]));
      const ordered = [...known].sort(
        (x, y) => (rank.get(x.label) ?? 99) - (rank.get(y.label) ?? 99),
      );
      await tx.insert(s.resourceSkills).values(
        ordered.map((sk, i) => ({
          resourceId: row.id,
          skillId: sk.id,
          isPrimary: i === 0,
        })),
      );
    }
    const notInCatalogue = b.skills.filter((label) => !known.some((k) => k.label === label));

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: b.status === "listed" ? "resource.listed" : "resource.drafted",
      entityType: "bench_resource",
      entityId: row.id,
      before: null,
      after: {
        masked_id: row.maskedId,
        status: b.status,
        vendor_rate_paise: b.vendorRatePaise,
        experience_months: b.experienceMonths,
        base_city: b.baseCity,
        skills: b.skills.filter((l) => known.some((k) => k.label === l)),
      },
      context: { source: "vendor_portal", skills_not_in_catalogue: notInCatalogue },
      occurredAt: now,
    });

    return { created: row, unknown: notInCatalogue, linked: known.map((k) => k.label) };
  });

  return NextResponse.json({
    maskedId: created.maskedId,
    status: b.status,
    skillsLinked: b.skills.filter((l) => !unknown.includes(l)),
    skillsIgnored: unknown,
  }, { status: 201 });
}

/* ====================================================================== */
/*  Undo: withdraw a resource this vendor owns                             */
/* ====================================================================== */

const Withdraw = z.object({
  maskedId: z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/),
});

export async function DELETE(req: Request) {
  const parsed = Withdraw.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const session = await getDemoSession("vendor");

  // Tenancy: scoped to the caller's org, so another vendor's resource is simply not
  // found. The response never reveals that it exists elsewhere.
  const [owned] = await db
    .select({ id: s.benchResources.id, status: s.benchResources.status })
    .from(s.benchResources)
    .where(and(
      eq(s.benchResources.vendorOrgId, session.orgId),
      eq(s.benchResources.maskedId, parsed.data.maskedId),
    ))
    .limit(1);

  if (!owned) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // Already in play: a person who has reached a client's shortlist cannot be quietly
  // pulled, because a broker has already acted on them.
  if (owned.status === "in_process" || owned.status === "deployed") {
    return NextResponse.json({ error: "in_use", status: owned.status }, { status: 409 });
  }

  const now = new Date();
  await db.update(s.benchResources)
    .set({ status: "withdrawn", updatedAt: now })
    .where(eq(s.benchResources.id, owned.id));

  // The second audit row. This is what makes "done, then undone" legible later.
  await db.insert(s.auditLog).values({
    actorId: session.userId,
    actorOrgId: session.orgId,
    action: "resource.withdrawn",
    entityType: "bench_resource",
    entityId: owned.id,
    before: { status: owned.status },
    after: { status: "withdrawn" },
    context: { source: "vendor_portal", reason: "undo" },
    occurredAt: now,
  });

  return NextResponse.json({ maskedId: parsed.data.maskedId, status: "withdrawn" });
}
