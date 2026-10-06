import { NextResponse } from "next/server";
import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/src/db/client";
import * as s from "@/src/db/schema";
import { getDemoSession } from "@/src/lib/auth/session";

/**
 * POST /api/client/match-preview — the live match preview shown while posting.
 *
 * AGGREGATE ONLY. This endpoint returns counts and nothing else: no profiles, no masked
 * ids, no rates, no per-supplier breakdown. docs/MASKING.md lists two specific hazards
 * it has to avoid:
 *
 *   - Counts: "42 profiles on live benches match" is safe; "14 from one supplier" is not.
 *     Aggregates must never be broken down by vendor for a client. So this handler never
 *     groups by vendor_org_id.
 *   - Isolation: a count of 1 or 2, narrowed by repeated probing, identifies a person.
 *     Any bucket below MIN_BUCKET is suppressed rather than returned.
 */

const MIN_BUCKET = 5;

const Body = z.object({
  skills: z.array(z.string().max(60)).max(10).default([]),
  experienceBand: z.enum(["0-3", "3-5", "5-8", "8+"]).optional(),
  budgetMinPaise: z.number().int().min(0).max(100_000_000).optional(),
  budgetMaxPaise: z.number().int().min(0).max(100_000_000).optional(),
  city: z.string().max(60).optional(),
});

/** Below the threshold, say "fewer than N" instead of handing over a precise count. */
function bucket(n: number): { value: number | null; label: string } {
  if (n >= MIN_BUCKET) return { value: n, label: String(n) };
  return { value: null, label: `fewer than ${MIN_BUCKET}` };
}

export async function POST(req: Request) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json({ error: "invalid_request", issues: parsed.error.flatten().fieldErrors }, { status: 400 });
  }
  await getDemoSession("client"); // portal check; the preview is client-facing
  const { skills, budgetMinPaise, budgetMaxPaise } = parsed.data;

  // Only listed, matchable supply counts. Freshness is applied as a 14-day cutoff here
  // rather than returned — the freshness STATE is supplier information (docs/MASKING.md).
  const staleCutoff = new Date(Date.now() - 14 * 86_400_000);

  const skillFilter = skills.length
    ? await db
        .select({ resourceId: s.resourceSkills.resourceId })
        .from(s.resourceSkills)
        .innerJoin(s.skills, sql`${s.skills.id} = ${s.resourceSkills.skillId}`)
        .where(inArray(s.skills.label, skills))
    : [];
  const skillMatched = new Set(skillFilter.map((r) => r.resourceId));

  const rows = await db
    .select({
      id: s.benchResources.id,
      vendorRatePaise: s.benchResources.vendorRatePaise,
      lastConfirmedAt: s.benchResources.lastConfirmedAt,
      availableFrom: s.benchResources.availableFrom,
    })
    .from(s.benchResources)
    .where(and(
      inArray(s.benchResources.status, ["listed", "in_process"]),
      gte(s.benchResources.lastConfirmedAt, staleCutoff),
    ));

  const scored = await db
    .select({ resourceId: s.assessments.resourceId, overall: s.assessments.overallScore })
    .from(s.assessments)
    .where(and(sql`${s.assessments.status} = 'scored'`, gte(s.assessments.overallScore, 80)));
  const scoredSet = new Set(scored.map((r) => r.resourceId));

  const onBench = rows.length;
  const skillMatch = skills.length ? rows.filter((r) => skillMatched.has(r.id)).length : onBench;
  const withinBudget = budgetMaxPaise
    ? rows.filter((r) => r.vendorRatePaise <= budgetMaxPaise && (!budgetMinPaise || r.vendorRatePaise >= budgetMinPaise * 0.6)).length
    : onBench;
  const scoredAbove80 = rows.filter((r) => scoredSet.has(r.id)).length;
  const startSoon = rows.filter((r) => !r.availableFrom).length;

  return NextResponse.json({
    // The headline figure the design shows, as a bucket.
    matching: bucket(skillMatch),
    bars: [
      bar("Skill match", skillMatch, onBench),
      bar("Within budget", withinBudget, onBench),
      bar("Score ≥ 80", scoredAbove80, onBench),
      bar("Available now", startSoon, onBench),
    ],
    poolSize: onBench,
    note: "Counts only. Identities, suppliers and rates stay hidden until your broker sends a shortlist.",
  });
}

function pct(n: number, total: number): number {
  return total ? Math.round((n / total) * 100) : 0;
}

/** One preview bar. `count` is suppressed below the threshold; `label` names the bar. */
function bar(label: string, n: number, total: number) {
  const b = bucket(n);
  return { label, value: b.value, countLabel: b.label, pct: pct(n, total) };
}
