/**
 * Derived values. docs/DOMAIN.md lists these as things that must NEVER be stored:
 * freshness state, decay bar width, SLA state, margin, column counts, nav badges.
 *
 * Everything here is computed on read from timestamps and amounts.
 * Business clocks run in Asia/Kolkata; the database stores timestamptz in UTC.
 */

export const IST_TZ = "Asia/Kolkata";

/* ---------- freshness (vendor + ops only — NEVER client, see docs/MASKING.md) ---------- */

export type FreshnessState = "confirmed" | "expiring_soon" | "unconfirmed";

export interface Freshness {
  state: FreshnessState;
  days: number;
  /** Width of the decay bar, as a percentage. Floor of 6 so it never vanishes. */
  decayBarWidthPct: number;
  label: string;
  /** An unconfirmed resource drops out of matching. */
  eligibleForMatching: boolean;
}

export function freshnessFor(lastConfirmedAt: Date | null, now: Date = new Date()): Freshness {
  if (!lastConfirmedAt) {
    return {
      state: "unconfirmed", days: Infinity, decayBarWidthPct: 6,
      label: "Never confirmed", eligibleForMatching: false,
    };
  }
  const days = Math.floor((now.getTime() - lastConfirmedAt.getTime()) / 86_400_000);
  const state: FreshnessState = days < 10 ? "confirmed" : days < 14 ? "expiring_soon" : "unconfirmed";
  const decayBarWidthPct = Math.max(6, (1 - Math.min(days, 28) / 28) * 100);
  const label =
    state === "confirmed" ? `Confirmed ${days}d`
    : state === "expiring_soon" ? `Expiring ${14 - days}d`
    : `Unconfirmed ${days}d`;
  return { state, days, decayBarWidthPct, label, eligibleForMatching: state !== "unconfirmed" };
}

/* ---------- SLA ---------- */

export type SlaState = "ok" | "warn" | "late" | "idle";

export interface Sla {
  state: SlaState;
  label: string;
  hoursRemaining: number | null;
}

/**
 * `idle` is not a breach: an unresponsive client must not make a broker look late.
 * The clock pauses on entry to `shortlisted` and on `awaiting_vendor` interviews, so
 * callers pass `paused` rather than having this function guess from the stage.
 */
export function slaFor(
  dueAt: Date | null,
  windowHours: number,
  opts: { paused?: boolean; now?: Date } = {},
): Sla {
  const now = opts.now ?? new Date();
  if (opts.paused) return { state: "idle", label: "Awaiting client", hoursRemaining: null };
  if (!dueAt) return { state: "ok", label: "No deadline", hoursRemaining: null };

  const msRemaining = dueAt.getTime() - now.getTime();
  const hoursRemaining = msRemaining / 3_600_000;

  if (msRemaining < 0) {
    const over = Math.max(1, Math.round(-hoursRemaining));
    return { state: "late", label: `Overdue ${over}h`, hoursRemaining };
  }
  const fractionLeft = hoursRemaining / windowHours;
  const state: SlaState = fractionLeft <= 0.25 ? "warn" : "ok";
  // "SLA 22h" read as jargon to the senior, non-technical audience this is built for.
  // "Due in 22h" says the same thing without an abbreviation to decode.
  return { state, label: `Due in ${Math.max(1, Math.round(hoursRemaining))}h`, hoursRemaining };
}

/** Targets from docs/DOMAIN.md, in hours. */
export const SLA_WINDOW_HOURS = {
  new: 4,            // business hours, to sourcing begun
  matching: 36,      // the promise in the client UI
  shortlisted: 72,   // 3 business days, then idle
  interviewing: 48,  // 2 business days to feedback
} as const;

/* ---------- small formatting shared by several screens ---------- */

/** 74 -> "6.2y". experience_months is the stored integer; this is presentation. */
export function formatExperience(months: number): string {
  return `${(months / 12).toFixed(1)}y`;
}

/** "4d", "2h", "1h" — the age column on the ops pipeline. */
export function ageLabel(from: Date | null, now: Date = new Date()): string {
  if (!from) return "—";
  const hours = Math.floor((now.getTime() - from.getTime()) / 3_600_000);
  if (hours < 1) return "just now";
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}
