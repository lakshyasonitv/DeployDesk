import { db } from "./client";
import * as s from "./schema";

/**
 * The holiday calendar, read for the business clock.
 *
 * `src/lib/business-clock.ts` stays pure — no database import — because its arithmetic is
 * unit-tested over plain instants and a DB dependency would make those tests need a
 * connection. This is the adapter: it reads the table `docs/DOMAIN.md` asks for and hands
 * the clock the `Set<YYYY-MM-DD>` it already accepts.
 *
 * Cached for the lifetime of the server process. A holiday calendar changes once a year,
 * and the alternative is a query on every SLA calculation on every page.
 */

let cache: { at: number; set: ReadonlySet<string> } | null = null;
const TTL_MS = 60 * 60 * 1000; // an hour is far more often than this table changes

export async function getHolidaySet(region?: string): Promise<ReadonlySet<string>> {
  if (cache && Date.now() - cache.at < TTL_MS) return cache.set;

  const rows = await db
    .select({ holidayDate: s.holidayCalendar.holidayDate, region: s.holidayCalendar.region })
    .from(s.holidayCalendar);

  // A NULL region is nationwide and always applies. A named region applies only when the
  // caller asks for it — a Bangalore team does not stop for a Maharashtra holiday.
  const set = new Set(
    rows
      .filter((r) => r.region === null || (region !== undefined && r.region === region))
      .map((r) => r.holidayDate),
  );

  cache = { at: Date.now(), set };
  return set;
}

/** For tests and the seed, which must not read a stale cache. */
export function clearHolidayCache() {
  cache = null;
}
