import { NextResponse } from "next/server";
import { and, asc, desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";
import { marginPct, isBelowFloor, MARGIN_FLOOR_PCT } from "@/src/lib/money/rate-band";
import { algoScore, scoreRate } from "@/src/lib/matching/score";

/**
 * POST /api/ops/matching/rate — set what we will charge a client for one candidate.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS EXISTS
 * ---------------------------------------------------------------------------
 *
 * The proposed client rate was computed and **nobody could change it**:
 * `vendor / (1 - target)`, rounded up to ₹1,000, clamped into the client's budget. The
 * matching desk rendered it as a read-only `Detail`. That one number decides three things —
 * the band the client is shown, the margin Talentvibes earns, and 14% of the ranking score —
 * so it is the central commercial lever of the business, and it was set by a constant.
 *
 * `docs/MATCHING.md` already said it should not be: *"If clamping to the client's ceiling
 * would push margin below the floor, do not clamp — surface it to ops as 'above budget,
 * margin-constrained' and **let a human decide**."* There was no way to decide.
 *
 * ---------------------------------------------------------------------------
 * CHANGING THE RATE CHANGES THE SCORE
 * ---------------------------------------------------------------------------
 *
 * `score_rate` is computed FROM this rate against the client's budget, and `algo_score` is
 * the weighted blend of the six components. So setting a rate without recomputing both would
 * leave the desk showing a rate that disagrees with the bar beside it and the total beneath
 * it — the exact incoherence ADR-011 exists to prevent.
 *
 * `algo_rank` is recomputed across the whole pool too, because a changed score changes the
 * order. `manual_rank` is untouched: a broker's hand-arranged order outranks the algorithm
 * by design, and re-pricing one candidate must not silently rearrange their work.
 *
 * ---------------------------------------------------------------------------
 * A SENT CANDIDATE CANNOT BE RE-PRICED
 * ---------------------------------------------------------------------------
 *
 * ADR-004 stores the client-facing band on `shortlist_items` at send time and forbids
 * recomputing it on read. So once a candidate has gone out on a shortlist, the client has
 * been quoted a band derived from the old rate. Re-pricing them afterwards would leave the
 * desk showing one price and the client holding another, with nothing on either screen
 * saying so. Refused with `already_quoted`; re-pricing means sending a new shortlist.
 *
 * ---------------------------------------------------------------------------
 * BELOW THE FLOOR NEEDS A REASON
 * ---------------------------------------------------------------------------
 *
 * Mirrors how placements already work — `engagements` carries `margin_approved_by` and
 * `margin_exception_note`, and the Margin page shows both. A below-floor price is a real
 * commercial choice (the two seeded exceptions are strategic account entries), so it is
 * allowed, and it is recorded with a reason and a name. The reason lives in the audit row
 * rather than a new column: `audit_log` is the durable record a dispute is argued from, and
 * this needed no migration.
 */

const Body = z.object({
  code: z.string().regex(/^REQ-\d{3,6}$/i),
  maskedId: z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/),
  /** Paise. Must be positive; a zero or negative price is not a commercial decision. */
  ratePaise: z.number().int().positive().max(100_000_000_00),
  reason: z.string().trim().max(500).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "invalid_request", issues: parsed.error.flatten().fieldErrors },
      { status: 400 },
    );
  }
  const { code, maskedId, ratePaise, reason } = parsed.data;
  const session = await getDemoSession("ops");

  /** The match, its requirement's budget, and the vendor's cost. */
  const [row] = await db
    .select({
      matchId: s.matches.id,
      requirementId: s.requirements.id,
      requirementCode: s.requirements.code,
      roleTitle: s.requirements.roleTitle,
      budgetMinPaise: s.requirements.budgetMinPaise,
      budgetMaxPaise: s.requirements.budgetMaxPaise,
      resourceId: s.matches.resourceId,
      vendorRatePaise: s.benchResources.vendorRatePaise,
      currentRatePaise: s.matches.proposedClientRatePaise,
      scoreSkill: s.matches.scoreSkill,
      scoreTest: s.matches.scoreTest,
      scoreExpFit: s.matches.scoreExpFit,
      scoreFreshness: s.matches.scoreFreshness,
      scoreVendor: s.matches.scoreVendor,
    })
    .from(s.matches)
    .innerJoin(s.requirements, eq(s.requirements.id, s.matches.requirementId))
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.matches.resourceId))
    .where(and(
      eq(s.requirements.code, code.toUpperCase()),
      eq(s.benchResources.maskedId, maskedId),
    ))
    .limit(1);

  if (!row) return NextResponse.json({ error: "not_found" }, { status: 404 });

  /* ---- already quoted to the client? then the band is frozen (ADR-004) ---- */

  const [quoted] = await db
    .select({ maskedId: s.shortlistItems.maskedId })
    .from(s.shortlistItems)
    .innerJoin(s.shortlists, eq(s.shortlists.id, s.shortlistItems.shortlistId))
    .where(and(
      eq(s.shortlists.requirementId, row.requirementId),
      eq(s.shortlistItems.resourceId, row.resourceId),
    ))
    .limit(1);

  if (quoted) {
    return NextResponse.json(
      { error: "already_quoted", maskedId },
      { status: 409 },
    );
  }

  /* -------------------------- the floor needs a reason -------------------------- */

  const pct = marginPct(ratePaise, row.vendorRatePaise);
  const belowFloor = isBelowFloor(pct);

  if (belowFloor && !(reason && reason.length >= 10)) {
    return NextResponse.json(
      {
        error: "reason_required",
        marginPct: Number(pct.toFixed(1)),
        floorPct: MARGIN_FLOOR_PCT,
      },
      { status: 400 },
    );
  }

  /* ------------------- recompute the component, total and ranks ------------------- */

  const newScoreRate = scoreRate(ratePaise, row.budgetMinPaise, row.budgetMaxPaise);
  const newTotal = algoScore({
    scoreSkill: row.scoreSkill,
    scoreTest: row.scoreTest,
    scoreExpFit: row.scoreExpFit,
    scoreRate: newScoreRate,
    scoreFreshness: row.scoreFreshness,
    scoreVendor: row.scoreVendor,
  });

  const now = new Date();

  await db.transaction(async (tx) => {
    await tx
      .update(s.matches)
      .set({
        proposedClientRatePaise: ratePaise,
        scoreRate: newScoreRate,
        algoScore: newTotal,
        updatedAt: now,
      })
      .where(eq(s.matches.id, row.matchId));

    /**
     * Re-rank the pool on the new scores.
     *
     * Ties are broken the way `docs/MATCHING.md` specifies everywhere else — never by id or
     * insertion order, which clusters by vendor and is a side channel.
     */
    const pool = await tx
      .select({
        id: s.matches.id,
        algoScore: s.matches.algoScore,
        scoreTest: s.matches.scoreTest,
        scoreFreshness: s.matches.scoreFreshness,
        scoreVendor: s.matches.scoreVendor,
      })
      .from(s.matches)
      .where(eq(s.matches.requirementId, row.requirementId))
      .orderBy(
        desc(s.matches.algoScore), desc(s.matches.scoreTest),
        desc(s.matches.scoreFreshness), desc(s.matches.scoreVendor),
        asc(s.matches.computedAt),
      );

    for (const [i, m] of pool.entries()) {
      // `manual_rank` is deliberately NOT touched: a hand-arranged order outranks the
      // algorithm, and re-pricing one candidate must not rearrange a broker's work.
      await tx.update(s.matches)
        .set({ algoRank: i + 1, updatedAt: now })
        .where(eq(s.matches.id, m.id));
    }

    await tx.insert(s.auditLog).values({
      actorId: session.userId,
      actorOrgId: session.orgId,
      action: "matching.rate_set",
      entityType: "requirement",
      entityId: row.requirementId,
      before: {
        ratePaise: row.currentRatePaise,
        marginPct: row.currentRatePaise
          ? Number(marginPct(row.currentRatePaise, row.vendorRatePaise).toFixed(1))
          : null,
      },
      after: {
        ratePaise,
        marginPct: Number(pct.toFixed(1)),
        scoreRate: newScoreRate,
        algoScore: newTotal,
        belowFloor,
      },
      /**
       * The reason and the masked id live here. `audit_log` is what a dispute is argued
       * from, and keeping them here rather than on `matches` meant no migration — the rate
       * control works today instead of waiting on one.
       */
      context: {
        maskedId,
        code: row.requirementCode,
        roleTitle: row.roleTitle,
        reason: reason ?? null,
        setByName: session.userName,
      },
      occurredAt: now,
    });
  });

  return NextResponse.json({
    ok: true,
    maskedId,
    ratePaise,
    marginPct: Number(pct.toFixed(1)),
    belowFloor,
    floorPct: MARGIN_FLOOR_PCT,
    scoreRate: newScoreRate,
    algoScore: newTotal,
    /** So the client can restore the figure it replaced. */
    previousRatePaise: row.currentRatePaise,
  });
}
