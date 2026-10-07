/**
 * Seed-time helpers.
 *
 * docs/SEED-DATA.md pins the prototype's relative values ("2h ago", "confirmed 2d",
 * "Overdue 2h", "tested 09 Aug") to a reference date of 22-24 August 2026, and requires
 * seeding as offsets from a configurable SEED_NOW rather than absolute timestamps — so
 * freshness and SLA states stay correct whenever the seed is run.
 *
 * SEED_NOW defaults to the moment the seed runs. Setting it to an absolute date is only
 * useful for reproducing a specific screenshot.
 */

/** The prototype's "today". Every absolute date in the fixtures is read relative to this. */
export const FIXTURE_REFERENCE = new Date("2026-08-22T09:00:00+05:30");

export const SEED_NOW: Date = process.env.SEED_NOW
  ? new Date(process.env.SEED_NOW)
  : new Date();

if (Number.isNaN(SEED_NOW.getTime())) {
  throw new Error(`SEED_NOW is not a valid date: ${process.env.SEED_NOW}`);
}

const DAY = 86_400_000;
const HOUR = 3_600_000;

export const daysAgo = (n: number, from: Date = SEED_NOW) => new Date(from.getTime() - n * DAY);
export const hoursAgo = (n: number, from: Date = SEED_NOW) => new Date(from.getTime() - n * HOUR);
export const daysAhead = (n: number, from: Date = SEED_NOW) => new Date(from.getTime() + n * DAY);
export const hoursAhead = (n: number, from: Date = SEED_NOW) => new Date(from.getTime() + n * HOUR);

/** "4d" | "2h" | "1h" | "12h" -> a timestamp that far before SEED_NOW. */
export function parseAgeToDate(age: string): Date {
  const m = /^(\d+)\s*([dhm])$/i.exec(age.trim());
  if (!m) throw new Error(`parseAgeToDate: cannot parse ${JSON.stringify(age)}`);
  const n = Number(m[1]);
  switch (m[2].toLowerCase()) {
    case "d": return daysAgo(n);
    case "h": return hoursAgo(n);
    default:  return new Date(SEED_NOW.getTime() - n * 60_000);
  }
}

const MONTHS = ["jan","feb","mar","apr","may","jun","jul","aug","sep","oct","nov","dec"];

/**
 * "09 Aug" / "12 Jul" / "1 Aug 2026" -> the same distance from SEED_NOW that the date sits
 * from the fixture reference date. Keeps every relative relationship in the fixture set
 * intact while moving the whole picture to today.
 */
export function fixtureDateToOffset(label: string): Date {
  const m = /^(\d{1,2})\s+([A-Za-z]{3})[a-z]*(?:\s+(\d{4}))?$/.exec(label.trim());
  if (!m) throw new Error(`fixtureDateToOffset: cannot parse ${JSON.stringify(label)}`);
  const day = Number(m[1]);
  const month = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase());
  if (month < 0) throw new Error(`fixtureDateToOffset: bad month in ${label}`);
  const year = m[3] ? Number(m[3]) : 2026;
  const absolute = new Date(Date.UTC(year, month, day, 3, 30)); // 09:00 IST
  const deltaDays = Math.round((absolute.getTime() - FIXTURE_REFERENCE.getTime()) / DAY);
  return daysAhead(deltaDays);
}

/** "Confirmed 2d" | "Expiring 11d" | "Unconfirmed 26d" -> last_confirmed_at. */
export function freshnessLabelToLastConfirmed(label: string): Date | null {
  const m = /(\d+)\s*d/i.exec(label);
  if (!m) return null;
  const stated = Number(m[1]);
  // "Expiring Nd" in the fixtures means N days of validity LEFT, and the expiring window
  // opens at day 10 of 14 — so convert the remaining days back into elapsed days.
  if (/expiring/i.test(label)) return daysAgo(Math.max(10, 14 - stated));
  return daysAgo(stated);
}

/** "6.2y" -> 74 months. experience_months is the stored integer; "6.2y" is presentation. */
export function parseExperienceToMonths(exp: string): number {
  const m = /^([\d.]+)\s*y/i.exec(exp.trim());
  if (!m) throw new Error(`parseExperienceToMonths: cannot parse ${JSON.stringify(exp)}`);
  return Math.round(Number(m[1]) * 12);
}

/** "Immediate" | "15 days" | "30 days" | "30 Sep" | "Unknown" | "15 Sep" */
export function parseNotice(notice: string): {
  noticePeriodDays: number | null;
  availableFrom: Date | null;
  label: string;
  kind: "immediate" | "dated" | "notice";
} {
  const n = notice.trim();
  if (/^immediate$/i.test(n)) {
    return { noticePeriodDays: 0, availableFrom: null, label: "Available now", kind: "immediate" };
  }
  const days = /^(\d+)\s*days?$/i.exec(n);
  if (days) {
    const d = Number(days[1]);
    return { noticePeriodDays: d, availableFrom: null, label: `${d}-day notice`, kind: "notice" };
  }
  if (/^unknown$/i.test(n)) {
    return { noticePeriodDays: null, availableFrom: null, label: "Notice unknown", kind: "notice" };
  }
  // A bare date, e.g. "30 Sep" / "15 Sep"
  const when = fixtureDateToOffset(n.length <= 7 ? `${n}` : n);
  return {
    noticePeriodDays: null,
    availableFrom: when,
    label: `From ${n}`,
    kind: "dated",
  };
}

/**
 * "88 · 09 Aug" | "Not started" | "Expired" | "84 · 18 Aug"
 * Returns the assessment shape. Validity is 90 days from completion (docs/DOMAIN.md),
 * so "Expired" is seeded as a completion comfortably outside that window.
 */
export function parseAssessment(score: string): {
  status: "not_started" | "in_progress" | "scored" | "expired";
  overall: number | null;
  completedAt: Date | null;
  validUntil: Date | null;
} {
  const s = score.trim();
  if (/^not started$/i.test(s)) {
    return { status: "not_started", overall: null, completedAt: null, validUntil: null };
  }
  if (/^in progress$/i.test(s)) {
    return { status: "in_progress", overall: null, completedAt: null, validUntil: null };
  }
  if (/^expired$/i.test(s)) {
    const completedAt = daysAgo(100);
    return { status: "expired", overall: 71, completedAt, validUntil: daysAhead(-10, completedAt) };
  }
  const m = /^(\d+)\s*(?:·\s*(.+))?$/.exec(s);
  if (!m) throw new Error(`parseAssessment: cannot parse ${JSON.stringify(score)}`);
  const overall = Number(m[1]);
  const completedAt = m[2] ? fixtureDateToOffset(m[2]) : daysAgo(14);
  return {
    status: "scored",
    overall,
    completedAt,
    validUntil: new Date(completedAt.getTime() + 90 * DAY),
  };
}

/** "Bangalore / hybrid" -> { city, workMode } */
export function parseLocation(loc: string): {
  city: string | null;
  workMode: "onsite" | "hybrid" | "remote";
  hybridDays: number | null;
} {
  if (/^remote$/i.test(loc.trim())) return { city: null, workMode: "remote", hybridDays: null };
  const [cityPart, modePart] = loc.split("/").map((p) => p.trim());
  const mode = /onsite/i.test(modePart ?? "") ? "onsite" : /hybrid/i.test(modePart ?? "") ? "hybrid" : "onsite";
  return { city: cityPart || null, workMode: mode, hybridDays: mode === "hybrid" ? 3 : null };
}

/** "5–8 years" | "8+ years" | "3–5 years" | "4–7 years" -> the enum band. */
export function parseExperienceBand(band: string): "0-3" | "3-5" | "5-8" | "8+" {
  const b = band.replace(/\s/g, "");
  if (/8\+/.test(b)) return "8+";
  if (/^3[–—-]5/.test(b)) return "3-5";
  if (/^5[–—-]8/.test(b)) return "5-8";
  if (/^4[–—-]7/.test(b)) return "5-8"; // nearest band the schema allows
  if (/^0[–—-]3/.test(b)) return "0-3";
  return "5-8";
}

export function slugify(input: string): string {
  return input.toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Deterministic pseudo-random so repeated seeds generate the same filler rows. */
export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 0x1_0000_0000;
  };
}
