/**
 * The Indian business clock.
 *
 * CLAUDE.md working agreement 3: timestamps are `timestamptz` in UTC, but business days,
 * SLA clocks and the nightly freshness sweep run in **Asia/Kolkata**, converted at the
 * edges. An audit found that nothing in the codebase did any of that — `IST_TZ` was
 * declared and referenced nowhere, so every SLA deadline and every freshness threshold was
 * measured in plain UTC elapsed time. This module is that conversion.
 *
 * docs/DOMAIN.md defines the window precisely:
 *
 *   Business hours are **09:00–19:00 IST, Monday–Saturday**, excluding a configured Indian
 *   holiday calendar.
 *
 * So a 10-hour day and a 6-day week, which is why "4 business hours" on a role posted at
 * 17:00 IST on a Saturday is due at 11:00 IST on Monday — not at 21:00 the same evening,
 * which is what elapsed-hours arithmetic produced.
 *
 * ---------------------------------------------------------------------------
 * WHY A FIXED OFFSET AND NOT Intl / A TZ LIBRARY
 * ---------------------------------------------------------------------------
 *
 * India has observed no daylight saving since 1945 and IST is a fixed UTC+05:30. A fixed
 * offset is therefore not an approximation here, it is exact — and it avoids both a
 * dependency and the `Intl.DateTimeFormat` round-tripping that makes this kind of code
 * hard to read. If the product ever serves a second country, this is the file to replace,
 * not to extend.
 *
 * ---------------------------------------------------------------------------
 * HOLIDAYS ARE NOT IMPLEMENTED, DELIBERATELY
 * ---------------------------------------------------------------------------
 *
 * docs/DOMAIN.md says to "put the calendar in a table, not in code", and that table does
 * not exist yet. Every function here takes an optional set of IST dates so the table can
 * be wired in without touching the arithmetic, and defaults to empty. Hardcoding a list of
 * Indian holidays would be exactly the invented business rule working agreement 8 forbids,
 * and it would be wrong the first year a date moved.
 */

/** IST is UTC+05:30, fixed. No DST since 1945. */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

/** docs/DOMAIN.md: 09:00–19:00 IST. */
const DAY_START_HOUR = 9;
const DAY_END_HOUR = 19;
const HOURS_PER_BUSINESS_DAY = DAY_END_HOUR - DAY_START_HOUR; // 10

/** Monday–Saturday. Sunday (0) is the only non-working weekday. */
function isWorkingWeekday(istDate: Date): boolean {
  return istDate.getUTCDay() !== 0;
}

/**
 * IST dates to treat as non-working, as `YYYY-MM-DD`.
 *
 * Empty until the holiday table exists. Passing a populated set changes nothing else.
 */
export type HolidaySet = ReadonlySet<string>;
const NO_HOLIDAYS: HolidaySet = new Set();

/**
 * A UTC instant shifted into IST wall-clock, represented as a Date whose UTC fields read
 * as the IST values.
 *
 * This is the usual trick for offset-only timezones: `istOf(x).getUTCHours()` is the IST
 * hour. Nothing outside this module should see one of these — they are not real instants.
 */
function istOf(utc: Date): Date {
  return new Date(utc.getTime() + IST_OFFSET_MS);
}

/** The inverse of `istOf`. */
function utcOf(ist: Date): Date {
  return new Date(ist.getTime() - IST_OFFSET_MS);
}

/** `YYYY-MM-DD` for an IST-shifted date. */
function istDateKey(ist: Date): string {
  return ist.toISOString().slice(0, 10);
}

/** The IST calendar day of a UTC instant, as `YYYY-MM-DD`. */
export function istDay(utc: Date): string {
  return istDateKey(istOf(utc));
}

function isWorkingDay(ist: Date, holidays: HolidaySet): boolean {
  return isWorkingWeekday(ist) && !holidays.has(istDateKey(ist));
}

/**
 * Whole IST calendar days between two instants.
 *
 * This is what freshness wants, and it is NOT the same as elapsed time divided by 86.4
 * million. "Confirmed 10 days ago" has to flip at IST midnight, so a profile confirmed at
 * 23:00 IST and read at 01:00 IST two nights later is 2 days old, not 1 — elapsed-hours
 * arithmetic said 1, and that is a ~5.5 hour error in when a profile drops out of matching.
 *
 * Weekends and holidays are NOT excluded here: freshness is about how stale a human's
 * availability claim is, and a claim goes stale over a weekend just as fast.
 */
export function istCalendarDaysBetween(from: Date, to: Date): number {
  const a = Date.UTC(
    istOf(from).getUTCFullYear(), istOf(from).getUTCMonth(), istOf(from).getUTCDate(),
  );
  const b = Date.UTC(
    istOf(to).getUTCFullYear(), istOf(to).getUTCMonth(), istOf(to).getUTCDate(),
  );
  return Math.round((b - a) / 86_400_000);
}

/** Minutes of business time already elapsed on this IST day at this instant. */
function minutesIntoBusinessDay(ist: Date): number {
  const h = ist.getUTCHours();
  const m = ist.getUTCMinutes();
  if (h < DAY_START_HOUR) return 0;
  if (h >= DAY_END_HOUR) return HOURS_PER_BUSINESS_DAY * 60;
  return (h - DAY_START_HOUR) * 60 + m;
}

/** Advance an IST-shifted date to 09:00 on the next working day. */
function nextWorkingMorning(ist: Date, holidays: HolidaySet): Date {
  const next = new Date(ist.getTime());
  next.setUTCDate(next.getUTCDate() + 1);
  next.setUTCHours(DAY_START_HOUR, 0, 0, 0);
  while (!isWorkingDay(next, holidays)) {
    next.setUTCDate(next.getUTCDate() + 1);
  }
  return next;
}

/**
 * The instant `hours` of BUSINESS time after `from`.
 *
 * Used to set an SLA deadline. A role posted outside business hours starts its clock at
 * the next working morning, which is the behaviour the "4 business hours" promise in
 * docs/DOMAIN.md actually describes.
 */
export function addBusinessHours(
  from: Date,
  hours: number,
  holidays: HolidaySet = NO_HOLIDAYS,
): Date {
  let ist = istOf(from);
  let remaining = Math.max(0, hours) * 60;

  // Start of the clock: if we are before, after, or outside a working day, jump forward.
  if (!isWorkingDay(ist, holidays) || ist.getUTCHours() >= DAY_END_HOUR) {
    ist = nextWorkingMorning(ist, holidays);
    // nextWorkingMorning already lands on 09:00 of a working day.
    if (ist.getUTCHours() < DAY_START_HOUR) ist.setUTCHours(DAY_START_HOUR, 0, 0, 0);
  } else if (ist.getUTCHours() < DAY_START_HOUR) {
    ist.setUTCHours(DAY_START_HOUR, 0, 0, 0);
  }

  while (remaining > 0) {
    const usedToday = minutesIntoBusinessDay(ist);
    const leftToday = HOURS_PER_BUSINESS_DAY * 60 - usedToday;

    if (remaining <= leftToday) {
      ist = new Date(ist.getTime() + remaining * 60_000);
      remaining = 0;
    } else {
      remaining -= leftToday;
      ist = nextWorkingMorning(ist, holidays);
    }
  }

  return utcOf(ist);
}

/**
 * Business hours between two instants. Negative when `to` is already past.
 *
 * This is what "how long is left" means on an SLA: a deadline 14 hours away across a
 * Sunday is not 14 hours of anyone's attention. Counting elapsed hours made a role look
 * nearly due on a Saturday evening when the broker had a full working day to act.
 */
export function businessHoursBetween(
  from: Date,
  to: Date,
  holidays: HolidaySet = NO_HOLIDAYS,
): number {
  if (to.getTime() === from.getTime()) return 0;

  const sign = to > from ? 1 : -1;
  const start = sign > 0 ? from : to;
  const end = sign > 0 ? to : from;

  let ist = istOf(start);
  const endIst = istOf(end);
  let minutes = 0;

  // Clamp the start into a working window.
  if (!isWorkingDay(ist, holidays) || ist.getUTCHours() >= DAY_END_HOUR) {
    ist = nextWorkingMorning(ist, holidays);
  } else if (ist.getUTCHours() < DAY_START_HOUR) {
    ist.setUTCHours(DAY_START_HOUR, 0, 0, 0);
  }

  // Guard against a pathological range; 400 working days is far beyond any SLA here.
  let guard = 0;
  while (ist < endIst && guard++ < 400) {
    const dayEnd = new Date(ist.getTime());
    dayEnd.setUTCHours(DAY_END_HOUR, 0, 0, 0);

    const sliceEnd = endIst < dayEnd ? endIst : dayEnd;
    if (sliceEnd > ist) minutes += (sliceEnd.getTime() - ist.getTime()) / 60_000;

    if (endIst <= dayEnd) break;
    ist = nextWorkingMorning(ist, holidays);
  }

  return (sign * minutes) / 60;
}
