import { NextResponse } from "next/server";
import { and, eq, inArray, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";
import { SLA_WINDOW_HOURS } from "@/src/lib/derived";

/**
 * POST   /api/client/requirements — post a new role.
 * DELETE /api/client/requirements — cancel one, which is the Undo for the above.
 *
 * Full definition of done from CLAUDE.md: Zod at the boundary, `client_org_id` from the
 * SESSION never the body, a client-shaped response, and an audit row on both paths.
 *
 * ---------------------------------------------------------------------------
 * WHY THE CODE IS SEQUENTIAL HERE AND RANDOM FOR A MASKED ID
 * ---------------------------------------------------------------------------
 *
 * `TV-####` is random because guessing one would let someone enumerate other suppliers'
 * people (ADR-010). `REQ-####` carries no such risk: it is the client's own reference for
 * its own role, it is quoted in emails and on calls, and a client expects its second role
 * to be numbered after its first. So this allocates max + 1.
 *
 * ---------------------------------------------------------------------------
 * WHY THE SLA CLOCK STARTS HERE
 * ---------------------------------------------------------------------------
 *
 * A role posted at stage `new` promises sourcing inside the `new` window from
 * docs/DOMAIN.md (4 business hours). `sla_window_hours` is written explicitly rather than
 * left null so the figure is a property of this role and does not shift if the stage
 * default is ever retuned — that is the lesson migration 0002 exists for.
 */

/**
 * ---------------------------------------------------------------------------
 * WHY THE CREATE IS ONE TRANSACTION
 * ---------------------------------------------------------------------------
 *
 * Found the hard way during testing. The row insert, the skill links and the audit row
 * were three separate statements, and a request that failed in the middle — a bad array
 * predicate, in the case that exposed it — left a committed row with **no skills and no
 * audit row**. That is a silent violation of CLAUDE.md working agreement 5: every
 * state-changing action writes an audit row, and a half-created record has none.
 *
 * Two orphans had to be deleted by hand before `db:verify` passed again. Wrapping the
 * three writes in `db.transaction` makes the audit row a condition of the record existing
 * at all. Transactions are safe on the Supavisor transaction-mode pooler — a transaction
 * is the unit it pools; it is session-level state that is not available there.
 */

const LAKH = 10_000_000; // paise. 1 lakh rupees = 100,000 rupees = 10,000,000 paise.

const Body = z.object({
  roleTitle: z.string().trim().min(3).max(120),
  skills: z.array(z.string().trim().min(1).max(60)).min(1).max(20),
  experienceBand: z.enum(["0-3", "3-5", "5-8", "8+"]),
  quantity: z.number().int().min(1).max(50),
  /** Paise, so no float crosses the boundary (ADR-007). */
  budgetMinPaise: z.number().int().min(LAKH / 10).max(100 * LAKH),
  budgetMaxPaise: z.number().int().min(LAKH / 10).max(100 * LAKH),
  engagementType: z.enum(["contract", "c2h", "full_time"]),
  durationText: z.string().trim().max(120).optional(),
  locationCity: z.string().trim().max(80).optional(),
  workMode: z.enum(["onsite", "hybrid", "remote"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  noticeAccepted: z.array(z.enum(["immediate", "le_30", "le_60"])).min(1),
  /** CLIENT + OPS ONLY. docs/MASKING.md: never reaches a vendor response. */
  clientNote: z.string().trim().max(2000).optional(),
  stage: z.enum(["draft", "new"]).default("new"),
}).refine((b) => b.budgetMaxPaise >= b.budgetMinPaise, {
  message: "budgetMaxPaise must be at least budgetMinPaise",
  path: ["budgetMaxPaise"],
});

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
  const now = new Date();

  /* ----------------------------------------------------------- the code ---- */

  // max + 1 across all codes, so numbers never collide between clients. A client sees
  // only its own roles, so a gap in the sequence tells it nothing.
  const [{ next }] = (await db.execute<{ next: number }>(sql`
    select coalesce(max(nullif(regexp_replace(code, '\\D', '', 'g'), '')::int), 2175) + 1 as next
      from requirements
  `)) as unknown as Array<{ next: number }>;
  const code = `REQ-${next}`;

  /* ----------------------------------------------------- the owning broker ---- */

  // Every role gets an ops owner, because an unowned role is how an SLA quietly lapses.
  // The account owner on the client profile is the right default; ops can reassign.
  const [profile] = await db
    .select({ accountOwnerId: s.clientProfiles.accountOwnerId })
    .from(s.clientProfiles)
    .where(eq(s.clientProfiles.orgId, session.orgId))
    .limit(1);

  const windowHours = SLA_WINDOW_HOURS.new;

  const result = await db.transaction(async (tx) => {
    const [created] = await tx.insert(s.requirements).values({
      code,
      clientOrgId: session.orgId,          // from the session, never the request body
      createdBy: session.userId,
      ownerUserId: profile?.accountOwnerId ?? null,
      roleTitle: b.roleTitle,
      quantity: b.quantity,
      experienceBand: b.experienceBand,
      budgetMinPaise: b.budgetMinPaise,
      budgetMaxPaise: b.budgetMaxPaise,
      engagementType: b.engagementType,
      durationText: b.durationText ?? null,
      locationCity: b.locationCity ?? null,
      workMode: b.workMode,
      hybridDays: b.workMode === "hybrid" ? 3 : null,
      startDate: b.startDate ?? null,
      noticeAccepted: b.noticeAccepted,
      clientNote: b.clientNote ?? null,
      stage: b.stage,
      // The clock only runs on a posted role; a draft has not asked for anything yet.
      slaDueAt: b.stage === "new" ? new Date(now.getTime() + windowHours * 3_600_000) : null,
      slaWindowHours: b.stage === "new" ? windowHours : null,
      postedAt: b.stage === "new" ? now : null,
    }).returning({ id: s.requirements.id, code: s.requirements.code });

    // Linked only where the skill is already in the catalogue, same reasoning as the bench
    // form: a free-typed near-duplicate is how a taxonomy rots.
    //
    // `inArray`, not sql`= any(${array})` — Drizzle's sql template spreads a JS array into
    // a parameter LIST, so that produced `= any(($1, $2))` and Postgres rejected it with
    // "op ANY/ALL (array) requires array on right side".
    const known = await tx
      .select({ id: s.skills.id, label: s.skills.label })
      .from(s.skills)
      .where(inArray(s.skills.label, b.skills));

    if (known.length) {
      const rank = new Map(b.skills.map((label, i) => [label, i]));
      const ordered = [...known].sort((x, y) => (rank.get(x.label) ?? 99) - (rank.get(y.label) ?? 99));
      await tx.insert(s.requirementSkills).values(
        ordered.map((sk, i) => ({
          requirementId: created.id,
          skillId: sk.id,
          isPrimary: i < 2,   // the first two the client typed are the headline skills
        })),
      );
    }
    const ignored = b.skills.filter((l) => !known.some((k) => k.label === l));

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: b.stage === "new" ? "requirement.posted" : "requirement.drafted",
      entityType: "requirement",
      entityId: created.id,
      before: null,
      after: {
        code: created.code,
        stage: b.stage,
        role_title: b.roleTitle,
        quantity: b.quantity,
        budget_min_paise: b.budgetMinPaise,
        budget_max_paise: b.budgetMaxPaise,
        skills: b.skills.filter((l) => known.some((k) => k.label === l)),
      },
      context: { source: "client_portal", skills_not_in_catalogue: ignored },
      occurredAt: now,
    });

    return { created, ignored };
  });

  const { created, ignored } = result;

  return NextResponse.json({
    code: created.code,
    stage: b.stage,
    slaHours: b.stage === "new" ? windowHours : null,
    skillsIgnored: ignored,
  }, { status: 201 });
}

/* ====================================================================== */
/*  Undo: cancel a role this client owns                                   */
/* ====================================================================== */

const Cancel = z.object({ code: z.string().regex(/^REQ-\d{3,6}$/) });

export async function DELETE(req: Request) {
  const parsed = Cancel.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "invalid_request" }, { status: 400 });

  const session = await getDemoSession("client");

  // Tenancy: scoped to the caller's org, so another client's role is simply not found.
  const [own] = await db
    .select({ id: s.requirements.id, stage: s.requirements.stage })
    .from(s.requirements)
    .where(and(
      eq(s.requirements.clientOrgId, session.orgId),
      eq(s.requirements.code, parsed.data.code),
    ))
    .limit(1);

  if (!own) return NextResponse.json({ error: "not_found" }, { status: 404 });

  /**
   * Past `new`, a broker has already done work — sourced candidates, maybe sent a
   * shortlist. Undo stops being a tidy reversal at that point and becomes a withdrawal
   * that someone needs to be told about, so it is refused here rather than performed
   * silently.
   */
  if (own.stage !== "new" && own.stage !== "draft") {
    return NextResponse.json({ error: "in_progress", stage: own.stage }, { status: 409 });
  }

  const now = new Date();
  await db.update(s.requirements)
    .set({ stage: "cancelled", closedAt: now, updatedAt: now })
    .where(eq(s.requirements.id, own.id));

  await db.insert(s.auditLog).values({
    actorId: session.userId,
    actorOrgId: session.orgId,
    action: "requirement.cancelled",
    entityType: "requirement",
    entityId: own.id,
    before: { stage: own.stage },
    after: { stage: "cancelled" },
    context: { source: "client_portal", reason: "undo" },
    occurredAt: now,
  });

  return NextResponse.json({ code: parsed.data.code, stage: "cancelled" });
}
