import { NextResponse } from "next/server";
import { and, desc, eq, gte, inArray, or, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";
import { deriveRateBand } from "@/src/lib/money/rate-band";
import { istFormat } from "@/src/lib/derived";

/**
 * POST /api/ops/shortlists/send — the critical transaction.
 *
 * Everything the product hangs on happens here, atomically (ADR-002 names this as the
 * reason not to split into services: a partially-sent shortlist is a business-visible
 * failure):
 *
 *   1. duplicate pre-check — an open flag at >= 85 confidence BLOCKS the send
 *   2. eligibility pre-check — stale or score-expired candidates cannot be included
 *   3. create the shortlists row with the next sequence_no
 *   4. snapshot shortlist_items, with the rate band derived from the PROPOSED CLIENT
 *      RATE only (ADR-004). The vendor rate is never read in this function.
 *   5. move the requirement to `shortlisted` and record the stage event
 *   6. write the audit row
 *
 * A second shortlist for the same requirement is a NEW row with an incremented
 * sequence_no, never a mutation of the first (ADR-009).
 */

const Body = z.object({
  code: z.string().regex(/^REQ-\d{4}$/),
  maskedIds: z.array(z.string().regex(/^TV-\d{4,5}(-[A-Z])?$/)).min(1).max(20),
  brokerNote: z.string().max(1000).optional(),
});

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  const { code, maskedIds, brokerNote } = parsed.data;
  const session = await getDemoSession("ops");

  const [requirement] = await db
    .select({ id: s.requirements.id, stage: s.requirements.stage, clientOrgId: s.requirements.clientOrgId })
    .from(s.requirements).where(eq(s.requirements.code, code)).limit(1);
  if (!requirement) return NextResponse.json({ error: "not_found" }, { status: 404 });

  // The candidate rows, with everything the snapshot needs. Note which columns are read:
  // the proposed CLIENT rate, never the vendor rate.
  const candidates = await db
    .select({
      resourceId: s.benchResources.id,
      maskedId: s.benchResources.maskedId,
      experienceMonths: s.benchResources.experienceMonths,
      baseCity: s.benchResources.baseCity,
      availableFrom: s.benchResources.availableFrom,
      noticePeriodDays: s.benchResources.noticePeriodDays,
      proposedClientRatePaise: s.matches.proposedClientRatePaise,
      eligibility: s.matches.eligibility,
    })
    .from(s.matches)
    .innerJoin(s.benchResources, eq(s.benchResources.id, s.matches.resourceId))
    .where(and(
      eq(s.matches.requirementId, requirement.id),
      inArray(s.benchResources.maskedId, maskedIds),
    ));

  if (candidates.length !== maskedIds.length) {
    return NextResponse.json({ error: "candidate_not_in_pool" }, { status: 409 });
  }

  /* ---- 1. duplicate pre-check: >= 85 confidence blocks both resources ---- */
  const resourceIds = candidates.map((c) => c.resourceId);
  const blocking = await db
    .select({ code: s.duplicateFlags.code, confidence: s.duplicateFlags.confidence })
    .from(s.duplicateFlags)
    .where(and(
      eq(s.duplicateFlags.status, "open"),
      gte(s.duplicateFlags.confidence, 85),
      or(
        inArray(s.duplicateFlags.resourceAId, resourceIds),
        inArray(s.duplicateFlags.resourceBId, resourceIds),
      ),
    ));

  if (blocking.length) {
    return NextResponse.json(
      { error: "blocked_duplicate", flags: blocking.map((b) => `${b.code} (${b.confidence}%)`) },
      { status: 409 },
    );
  }

  /* ---- 2. eligibility pre-check ---- */
  const ineligible = candidates.filter((c) => c.eligibility !== "eligible");
  if (ineligible.length) {
    return NextResponse.json(
      { error: "ineligible_candidate", candidates: ineligible.map((c) => `${c.maskedId}: ${c.eligibility}`) },
      { status: 409 },
    );
  }

  const missingRate = candidates.filter((c) => !c.proposedClientRatePaise);
  if (missingRate.length) {
    return NextResponse.json(
      { error: "no_proposed_client_rate", candidates: missingRate.map((c) => c.maskedId) },
      { status: 409 },
    );
  }

  const now = new Date();
  const order = new Map(maskedIds.map((id, i) => [id, i + 1]));

  const result = await db.transaction(async (tx) => {
    const [{ maxSeq }] = await tx
      .select({ maxSeq: sql<number>`coalesce(max(${s.shortlists.sequenceNo}), 0)::int` })
      .from(s.shortlists)
      .where(eq(s.shortlists.requirementId, requirement.id));

    const [shortlist] = await tx.insert(s.shortlists).values({
      requirementId: requirement.id,
      sequenceNo: maxSeq + 1,
      sentBy: session.userId,
      sentAt: now,
      brokerNote: brokerNote ?? null,
    }).returning();

    // Latest assessment and current skills, frozen into the snapshot.
    const assessments = await tx
      .select({
        resourceId: s.assessments.resourceId,
        overallScore: s.assessments.overallScore,
        scoreCoding: s.assessments.scoreCoding,
        scoreDsa: s.assessments.scoreDsa,
        scoreSystemDesign: s.assessments.scoreSystemDesign,
        scoreCommunication: s.assessments.scoreCommunication,
        attemptNo: s.assessments.attemptNo,
        completedAt: s.assessments.completedAt,
      })
      .from(s.assessments)
      .where(inArray(s.assessments.resourceId, resourceIds))
      .orderBy(desc(s.assessments.attemptNo));
    const assessBy = new Map<string, (typeof assessments)[number]>();
    for (const a of assessments) if (!assessBy.has(a.resourceId)) assessBy.set(a.resourceId, a);

    const skillRows = await tx
      .select({ resourceId: s.resourceSkills.resourceId, label: s.skills.label, isPrimary: s.resourceSkills.isPrimary })
      .from(s.resourceSkills)
      .innerJoin(s.skills, eq(s.skills.id, s.resourceSkills.skillId))
      .where(inArray(s.resourceSkills.resourceId, resourceIds));
    const skillsBy = new Map<string, string[]>();
    for (const r of skillRows) {
      const list = skillsBy.get(r.resourceId) ?? [];
      if (r.isPrimary) list.unshift(r.label); else list.push(r.label);
      skillsBy.set(r.resourceId, list);
    }

    const items = await tx.insert(s.shortlistItems).values(
      candidates.map((c) => {
        // The band's only input. The vendor rate is not in scope in this file.
        const band = deriveRateBand(c.proposedClientRatePaise!);
        const a = assessBy.get(c.resourceId);
        const availability = c.availableFrom
          ? { label: `From ${istFormat(c.availableFrom, { day: "numeric", month: "short" })}`, kind: "dated" as const }
          : c.noticePeriodDays === 0
            ? { label: "Available now", kind: "immediate" as const }
            : { label: `${c.noticePeriodDays ?? 30}-day notice`, kind: "notice" as const };

        return {
          shortlistId: shortlist.id,
          resourceId: c.resourceId,
          maskedId: c.maskedId,
          position: order.get(c.maskedId)!,
          experienceMonths: c.experienceMonths,
          baseCity: c.baseCity,
          skillsSnapshot: skillsBy.get(c.resourceId) ?? [],
          scoreOverall: a?.overallScore ?? null,
          scoreCoding: a?.scoreCoding ?? null,
          scoreDsa: a?.scoreDsa ?? null,
          scoreSystemDesign: a?.scoreSystemDesign ?? null,
          scoreCommunication: a?.scoreCommunication ?? null,
          assessmentAttemptNo: a?.attemptNo ?? null,
          assessmentTestedOn: a?.completedAt?.toISOString().slice(0, 10) ?? null,
          availabilityLabel: availability.label,
          availabilityKind: availability.kind,
          rateBandMinPaise: band.minPaise,
          rateBandMaxPaise: band.maxPaise,
          clientDecision: "pending" as const,
        };
      }),
    ).returning();

    // Mirror the broker's ordering onto the matches.
    for (const c of candidates) {
      await tx.update(s.matches)
        .set({ manualRank: order.get(c.maskedId)!, included: true })
        .where(and(eq(s.matches.requirementId, requirement.id), eq(s.matches.resourceId, c.resourceId)));
    }

    if (requirement.stage !== "shortlisted") {
      await tx.update(s.requirements)
        .set({ stage: "shortlisted", updatedAt: now })
        .where(eq(s.requirements.id, requirement.id));
      await tx.insert(s.requirementStageEvents).values({
        requirementId: requirement.id, fromStage: requirement.stage, toStage: "shortlisted",
        actorId: session.userId, reason: "shortlist sent", occurredAt: now,
      });
    }

    await tx.insert(s.auditLog).values({
      actorId: session.userId, actorOrgId: session.orgId,
      action: "shortlist.sent", entityType: "shortlist", entityId: shortlist.id,
      after: {
        requirement: code, sequence_no: shortlist.sequenceNo,
        masked_ids: maskedIds, items: items.length,
      },
      context: { source: "ops_matching_workspace" }, occurredAt: now,
    });

    return { shortlistId: shortlist.id, sequenceNo: shortlist.sequenceNo, items: items.length };
  });

  return NextResponse.json({ code, ...result, stage: "shortlisted" });
}
