/**
 * The ranking scorer — `docs/MATCHING.md` turned into code.
 *
 * Pure arithmetic, no database. Every function takes plain numbers and returns a 0-100
 * component score, so the interesting cases (a candidate below the band, a rate over the
 * ceiling, a profile fresh but three months from availability) are stated directly in tests
 * rather than seeded.
 *
 * Why this file exists at all: the six weights were specified, the six component columns
 * existed on `matches`, and **nothing computed them**. Only the seed ever wrote a match row,
 * so the 25 seeded requirements had candidates and a requirement a client actually posted
 * dead-ended at the matching desk — the client's "14 profiles match" preview was a real
 * live count of eligible supply, and the ops desk showed 0 because nothing had sourced
 * anybody.
 *
 * The guiding rule from the spec: every component must be "independently defensible to a
 * broker who has to justify an ordering to a client". Nothing here is a black box, and
 * nothing is inferred from embeddings.
 */

import { MARGIN_FLOOR_PCT, MARGIN_TARGET_PCT } from "../money/rate-band";

/**
 * THE weights. One definition.
 *
 * They lived in two places before this (the ops read model's `COMPONENTS`, and the seed's
 * `WEIGHTS`), and a scorer would have made three. Both now import from here, so a change
 * cannot apply to the display and not the arithmetic.
 *
 * `docs/MATCHING.md` asks for these to live in a versioned `matching_weights` table so that
 * changing one does not silently rewrite the meaning of historical scores. That table does
 * not exist yet; until it does, a change here reinterprets every past score.
 */
export const MATCHING_COMPONENTS = [
  { key: "scoreSkill", label: "Skill match", weightPct: 30 },
  { key: "scoreTest", label: "Proctored score", weightPct: 22 },
  { key: "scoreExpFit", label: "Experience fit", weightPct: 16 },
  { key: "scoreRate", label: "Rate vs budget", weightPct: 14 },
  { key: "scoreFreshness", label: "Availability freshness", weightPct: 10 },
  { key: "scoreVendor", label: "Vendor reliability", weightPct: 8 },
] as const;

/** In the order the component arrays use. Sums to 1.00 — asserted by a test. */
export const WEIGHTS = MATCHING_COMPONENTS.map((c) => c.weightPct / 100);

export interface Components {
  scoreSkill: number;
  scoreTest: number;
  scoreExpFit: number;
  scoreRate: number;
  scoreFreshness: number;
  scoreVendor: number;
}

/**
 * The total, always derived from the components (ADR-011).
 *
 * Never stored from a fixture: the matching workspace renders the six components as bars
 * beside the total, and a broker who adds up the bars has to get the number shown.
 */
export function algoScore(c: Components): number {
  /**
   * Read from MATCHING_COMPONENTS, not written out again.
   *
   * This used to spell the six weights inline as `0.30 + 0.22 + 0.16 ...`, which made it a
   * THIRD copy of them alongside the declaration above and the seed's. Tuning a weight would
   * have changed the bars on screen and left the total computed on the old numbers -- the
   * exact incoherence ADR-011 exists to prevent, since a broker adding up the bars has to
   * get the number shown.
   */
  return Math.round(
    MATCHING_COMPONENTS.reduce(
      (acc, comp) => acc + c[comp.key as keyof Components] * (comp.weightPct / 100),
      0,
    ),
  );
}

const clamp = (n: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, n));

/* ===================================================================== */
/*  1. Skill match — 30%                                                  */
/* ===================================================================== */

/**
 * Required skills, weighted: a primary skill counts double.
 *
 * **No adjacency credit.** The spec gives 0.4 of a skill's weight to "a skill in the same
 * `category` with no exact match" (React ↔ React Native), from an explicit adjacency table.
 * That table does not exist, and the owner chose to ship exact matching first rather than
 * invent one. The consequence is honest and worth knowing: a React Native developer scores
 * **0** on a React requirement today, so near-miss candidates rank lower than the spec
 * intends. `skills.category` already exists, which is what the spec itself points at, so
 * adding it later is cheap.
 *
 * Extra skills earn nothing — a candidate with fifteen unrelated skills is not a better
 * match, and rewarding breadth pushes generalists over specialists.
 */
export function scoreSkill(
  required: Array<{ label: string; isPrimary: boolean }>,
  resourceSkills: string[],
): number {
  if (!required.length) return 100; // nothing asked for, nothing to miss
  const have = new Set(resourceSkills);

  let matched = 0;
  let total = 0;
  for (const r of required) {
    const weight = r.isPrimary ? 2 : 1;
    total += weight;
    if (have.has(r.label)) matched += weight;
  }
  return clamp(Math.round((100 * matched) / total));
}

/* ===================================================================== */
/*  2. Proctored score — 22%                                              */
/* ===================================================================== */

/**
 * The constants are deliberately non-zero.
 *
 * An unscored profile should rank below a good scored one but above a genuinely weak one,
 * so a broker still sees it and chases the test. `expired` sits below `not_started` because
 * a lapsed score signals inattention, not absence.
 *
 * Note that assessment is NOT an eligibility gate — the spec is explicit that ops needs to
 * see a strong unscored profile in order to chase it.
 */
export function scoreTest(
  status: string | null,
  overallScore: number | null,
  expired = false,
): number {
  if (status === "scored" && !expired && overallScore != null) return clamp(overallScore);
  if (expired || status === "expired") return 30;
  // invited, in_progress, not_started, abandoned, or no assessment row at all.
  return 40;
}

/* ===================================================================== */
/*  3. Experience fit — 16%                                               */
/* ===================================================================== */

/** Band -> [min months, max months (exclusive), midpoint months]. */
const BANDS: Record<string, [number, number, number]> = {
  "0-3": [0, 36, 18],
  "3-5": [36, 60, 48],
  "5-8": [60, 96, 78],
  "8+": [96, Number.POSITIVE_INFINITY, 120],
};

/**
 * Inside the band scores 100. Outside it, 12 points per year of distance from the midpoint
 * — and **undershooting is punished half again as hard as overshooting**, because a 9-year
 * engineer for a 5-8y role is expensive but capable, while a 3-year engineer is not.
 */
export function scoreExpFit(experienceMonths: number, band: string): number {
  const b = BANDS[band];
  if (!b) return 50; // unknown band: neither reward nor punish
  const [lo, hi, mid] = b;

  if (experienceMonths >= lo && experienceMonths < hi) return 100;

  const deltaYears = Math.abs(experienceMonths - mid) / 12;
  const penalty = deltaYears * 12 * (experienceMonths < lo ? 1.5 : 1);
  return clamp(Math.round(100 - penalty));
}

/* ===================================================================== */
/*  4. Rate vs budget — 14%                                               */
/* ===================================================================== */

/**
 * Against the **proposed client rate**, never the vendor rate — using the vendor's cost
 * here would make the component a function of our own margin.
 *
 * Well under budget scores full marks but never above 100: a suspiciously cheap profile is
 * usually a mismatch, not a bargain. Above the ceiling it falls away fast.
 */
export function scoreRate(
  proposedClientRatePaise: number,
  budgetMinPaise: number,
  budgetMaxPaise: number,
): number {
  const rate = proposedClientRatePaise;
  const mid = (budgetMinPaise + budgetMaxPaise) / 2;

  if (rate <= budgetMinPaise) return 100;
  if (rate <= mid) {
    const span = mid - budgetMinPaise;
    return clamp(Math.round(100 - 10 * (span ? (rate - budgetMinPaise) / span : 0)));
  }
  if (rate <= budgetMaxPaise) {
    const span = budgetMaxPaise - mid;
    return clamp(Math.round(90 - 30 * (span ? (rate - mid) / span : 0)));
  }
  return clamp(Math.round(60 - 100 * ((rate - budgetMaxPaise) / budgetMaxPaise)));
}

/* ===================================================================== */
/*  5. Availability freshness — 10%                                       */
/* ===================================================================== */

/** `immediate` 1.0 · `<= 15 days` 0.95 · `<= 30 days` 0.85 · longer or unknown 0.7. */
function noticeMultiplier(noticePeriodDays: number | null): number {
  if (noticePeriodDays == null) return 0.7;
  if (noticePeriodDays <= 0) return 1;
  if (noticePeriodDays <= 15) return 0.95;
  if (noticePeriodDays <= 30) return 0.85;
  return 0.7;
}

/**
 * How recently the supplier confirmed availability, then discounted by notice period: a
 * profile that is fresh but three months from starting is not actually available.
 *
 * 14 days or more is an eligibility gate, not a score of zero — a caller should not be
 * scoring that resource at all.
 */
export function scoreFreshness(daysSinceConfirmed: number | null, noticePeriodDays: number | null): number {
  if (daysSinceConfirmed == null) return 0; // never confirmed; the gate should have caught it
  let base: number;
  if (daysSinceConfirmed <= 3) base = 100;
  else if (daysSinceConfirmed <= 9) base = 100 - (daysSinceConfirmed - 3) * 4;
  else if (daysSinceConfirmed <= 13) base = 60 - (daysSinceConfirmed - 10) * 8;
  else base = 0;

  return clamp(Math.round(base * noticeMultiplier(noticePeriodDays)));
}

/* ===================================================================== */
/*  6. Vendor reliability — 8%                                            */
/* ===================================================================== */

/**
 * A provisional supplier is capped so an unproven one cannot outrank a proven one on this
 * component alone.
 *
 * The spec defines provisional as "first 10 submissions". There is no submissions counter
 * on `vendor_profiles` — it has `placements_count` — so that is the proxy, and it is a
 * stricter one: a supplier can submit many people before placing ten. Noted rather than
 * silently substituted.
 */
export function scoreVendor(reliabilityScore: number | null, placementsCount = 0): number {
  const base = reliabilityScore == null ? 50 : clamp((reliabilityScore / 5) * 100);
  return placementsCount < 10 ? Math.min(base, 75) : Math.round(base);
}

/* ===================================================================== */
/*  The proposed client rate                                              */
/* ===================================================================== */

/**
 * The target and floor, as FRACTIONS, derived from the single percent definition in
 * `../money/rate-band.ts`.
 *
 * These were declared here as `0.22` and `0.18` while `rate-band.ts` separately declared
 * `MARGIN_TARGET_PCT = 22` and `MARGIN_FLOOR_PCT = 18` — two definitions of the same
 * business rule, in two units, which is exactly the mistake the ranking weights had before
 * they were unified. Tuning one would silently leave the other alone: the scorer would price
 * at the old target while the Margin page coloured rows against the new one.
 *
 * Derived rather than re-declared, so there is one number to change.
 */
export const TARGET_MARGIN = MARGIN_TARGET_PCT / 100;
export const MARGIN_FLOOR = MARGIN_FLOOR_PCT / 100;

/**
 * A starting client rate, so margin and the rate component have something to work from.
 *
 * Marked up from the vendor rate to the target margin, rounded up to the nearest ₹1,000,
 * then clamped into the client's budget — **but only if clamping keeps margin at or above
 * the floor**. If fitting the ceiling would push margin below 18%, it is left above budget
 * and flagged for a human.
 *
 * That last clause is the whole point: `docs/MATCHING.md` records that silently accepting a
 * sub-floor margin to fit a budget is how the two below-floor placements in the design
 * fixtures happened.
 */
export function proposedClientRate(
  vendorRatePaise: number,
  budgetMinPaise: number,
  budgetMaxPaise: number,
): { ratePaise: number; aboveBudget: boolean; marginConstrained: boolean } {
  const target = vendorRatePaise / (1 - TARGET_MARGIN);
  // ₹1,000 is 100_000 paise.
  const rounded = Math.ceil(target / 100_000) * 100_000;

  if (rounded <= budgetMaxPaise) {
    // Inside the ceiling. Never priced below the client's own floor — that would give away
    // margin the client was willing to pay for.
    return { ratePaise: Math.max(rounded, Math.min(budgetMinPaise, budgetMaxPaise)), aboveBudget: false, marginConstrained: false };
  }

  const marginAtCeiling = (budgetMaxPaise - vendorRatePaise) / budgetMaxPaise;
  if (marginAtCeiling >= MARGIN_FLOOR) {
    return { ratePaise: budgetMaxPaise, aboveBudget: false, marginConstrained: false };
  }
  // Clamping would break the floor, so it stays above budget for a human to decide.
  return { ratePaise: rounded, aboveBudget: true, marginConstrained: true };
}
