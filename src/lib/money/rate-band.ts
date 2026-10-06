import { RUPEE } from "./paise";

/**
 * ADR-004 — the client-facing rate band.
 *
 * The band is derived from the PROPOSED CLIENT RATE and nothing else. The vendor rate
 * is deliberately not a parameter of this function: if it cannot be referenced here, it
 * cannot leak into the band. Do not add it, and do not "improve" the band by tightening
 * it around the vendor cost — that is exactly the bug the design prototype shipped.
 *
 *   band_min = floor_to(rate * 0.95, ₹10,000)
 *   band_max = ceil_to (rate * 1.10, ₹10,000)
 *
 * Fixed multipliers and coarse ₹10,000 quantisation, so band width never varies with
 * margin (a narrow band on a thin-margin candidate would itself be a side channel) and
 * the exact rate cannot be recovered by comparing bands across candidates.
 *
 * Computed once, at shortlist send time, and stored on shortlist_items. Never recomputed
 * on read — see docs/MASKING.md.
 */

export const BAND_MIN_MULTIPLIER = 0.95;
export const BAND_MAX_MULTIPLIER = 1.10;
export const BAND_QUANTUM_PAISE = 10_000 * RUPEE; // ₹10,000

export function deriveRateBand(proposedClientRatePaise: number): {
  minPaise: number;
  maxPaise: number;
} {
  if (!Number.isFinite(proposedClientRatePaise) || proposedClientRatePaise <= 0) {
    throw new Error("deriveRateBand: proposed client rate must be a positive number of paise");
  }
  const q = BAND_QUANTUM_PAISE;
  const minPaise = Math.floor((proposedClientRatePaise * BAND_MIN_MULTIPLIER) / q) * q;
  const maxPaise = Math.ceil((proposedClientRatePaise * BAND_MAX_MULTIPLIER) / q) * q;
  return { minPaise, maxPaise };
}

/* ---------- margin: derived, never stored (docs/DOMAIN.md) ---------- */

export const MARGIN_TARGET_PCT = 22;
export const MARGIN_FLOOR_PCT = 18;

/** (client - vendor) / client * 100. Ops-only — never serialise this to a portal. */
export function marginPct(clientRatePaise: number, vendorRatePaise: number): number {
  if (clientRatePaise <= 0) return 0;
  return ((clientRatePaise - vendorRatePaise) / clientRatePaise) * 100;
}

export type MarginBandKind = "green" | "amber" | "red";

/** Shared thresholds so the API and the UI cannot disagree. */
export function marginBand(pct: number): MarginBandKind {
  if (pct >= MARGIN_TARGET_PCT) return "green";
  if (pct >= MARGIN_FLOOR_PCT) return "amber";
  return "red";
}

export function isBelowFloor(pct: number): boolean {
  return pct < MARGIN_FLOOR_PCT;
}
