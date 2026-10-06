/**
 * Money is bigint paise everywhere (ADR-007). Rupee formatting is presentation and
 * belongs in the UI layer; these helpers exist for parsing fixtures and for the one
 * place a band has to be derived.
 */

export const RUPEE = 100; // paise per rupee
export const LAKH = 100_000 * RUPEE;
export const CRORE = 100 * LAKH;

/**
 * Parse the display strings the design fixtures use into paise.
 * Handles "₹1,38,000", "₹1.38L", "₹92K", "₹3.4Cr", "1.30" (bare lakh in a band).
 */
export function parseMoneyToPaise(input: string): number {
  const raw = input.replace(/[₹,\s]/g, "");
  const m = /^(-?[\d.]+)(Cr|L|K)?$/i.exec(raw);
  if (!m) throw new Error(`parseMoneyToPaise: cannot parse ${JSON.stringify(input)}`);
  const n = Number(m[1]);
  if (!Number.isFinite(n)) throw new Error(`parseMoneyToPaise: not a number in ${input}`);
  const unit = (m[2] ?? "").toLowerCase();
  if (unit === "cr") return Math.round(n * CRORE);
  if (unit === "l") return Math.round(n * LAKH);
  if (unit === "k") return Math.round(n * 1_000 * RUPEE);
  return Math.round(n * RUPEE); // a plain rupee figure
}

/** "₹1.30–1.70L" -> [min, max] in paise. */
export function parseBandToPaise(input: string): [number, number] {
  const m = /^₹?\s*([\d.]+)\s*[–—-]\s*([\d.]+)\s*(Cr|L|K)?$/i.exec(input.replace(/,/g, ""));
  if (!m) throw new Error(`parseBandToPaise: cannot parse ${JSON.stringify(input)}`);
  const unit = m[3] ?? "L"; // bands in the fixtures are quoted in lakh
  return [parseMoneyToPaise(m[1] + unit), parseMoneyToPaise(m[2] + unit)];
}

/* ---------- presentation helpers (used by the UI layer only) ---------- */

/** 13800000 -> "₹1.38L". The design's own convention. */
export function formatPaiseShort(paise: number | null | undefined): string {
  if (paise == null) return "—";
  if (Math.abs(paise) >= CRORE) return `₹${trim(paise / CRORE)}Cr`;
  if (Math.abs(paise) >= LAKH) return `₹${trim(paise / LAKH, 2)}L`;
  return `₹${Math.round(paise / RUPEE).toLocaleString("en-IN")}`;
}

/** 13800000 -> "₹1,38,000". Used where the design shows exact figures (ops, vendor own). */
export function formatPaiseExact(paise: number | null | undefined): string {
  if (paise == null) return "—";
  return `₹${Math.round(paise / RUPEE).toLocaleString("en-IN")}`;
}

function trim(n: number, dp = 1): string {
  return n.toFixed(dp).replace(/\.0+$/, "").replace(/(\.\d)0$/, "$1");
}
