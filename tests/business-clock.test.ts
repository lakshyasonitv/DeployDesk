/**
 * The Indian business clock.
 *
 * CLAUDE.md working agreement 3 puts business days, SLA clocks and the nightly freshness
 * sweep in Asia/Kolkata. An audit found nothing did any of that — `IST_TZ` was declared
 * and used nowhere, so every deadline and every freshness threshold was plain UTC elapsed
 * time. These tests pin the arithmetic that replaced it.
 *
 * docs/DOMAIN.md defines the window: **09:00–19:00 IST, Monday–Saturday**. A 10-hour day
 * and a 6-day week, so Sunday is the only non-working weekday.
 *
 * Why this file has no database: the clock is pure arithmetic over instants, and the
 * interesting cases are the boundaries — an evening, a Sunday, an IST midnight. Those are
 * awkward to seed and trivial to state directly.
 *
 * Dates are written in IST with an explicit `+05:30`, so a reader can see the intent
 * without converting in their head. 2026-10-09 is a Friday.
 */
import { describe, expect, it } from "vitest";
import {
  addBusinessHours, businessHoursBetween, istCalendarDaysBetween, istDay, isWithinBusinessHours } from "../src/lib/business-clock";
import { freshnessFor, slaFor, istFormat } from "../src/lib/derived";

/** An IST wall-clock time as a real instant. */
const ist = (s: string) => new Date(`${s}+05:30`);

/** Render an instant back as IST, for readable failure messages. */
const asIst = (d: Date) =>
  new Date(d.getTime() + 5.5 * 3_600_000).toISOString().slice(0, 16).replace("T", " ");

describe("addBusinessHours respects 09:00-19:00 IST, Mon-Sat", () => {
  it("stays inside the same day when there is room", () => {
    expect(asIst(addBusinessHours(ist("2026-10-09T10:00"), 4))).toBe("2026-10-09 14:00");
  });

  it("carries into the next working morning when the day runs out", () => {
    // Fri 17:00 + 4h: two hours to 19:00, then two from Saturday 09:00.
    expect(asIst(addBusinessHours(ist("2026-10-09T17:00"), 4))).toBe("2026-10-10 11:00");
  });

  it("SKIPS SUNDAY, which is the only non-working weekday", () => {
    // Sat 17:00 + 4h: two hours to 19:00, Sunday is skipped, two from Monday 09:00.
    expect(asIst(addBusinessHours(ist("2026-10-10T17:00"), 4))).toBe("2026-10-12 11:00");
  });

  it("starts the clock at the next working morning when posted out of hours", () => {
    // Friday 20:00 is after close, so the clock starts Saturday 09:00.
    expect(asIst(addBusinessHours(ist("2026-10-09T20:00"), 1))).toBe("2026-10-10 10:00");
    // Sunday is not a working day at all.
    expect(asIst(addBusinessHours(ist("2026-10-11T10:00"), 4))).toBe("2026-10-12 13:00");
    // Before opening on a working day.
    expect(asIst(addBusinessHours(ist("2026-10-12T06:00"), 2))).toBe("2026-10-12 11:00");
  });

  it("spans several days for a long window", () => {
    // Fri 10:00 + 36h = 9 (Fri) + 10 (Sat) + 10 (Mon) + 7 (Tue) -> Tue 16:00.
    expect(asIst(addBusinessHours(ist("2026-10-09T10:00"), 36))).toBe("2026-10-13 16:00");
  });
});

describe("businessHoursBetween counts only working time", () => {
  it("excludes Sunday entirely", () => {
    // Sat 18:00 -> Mon 10:00 is 40 ELAPSED hours but only 2 working ones.
    const from = ist("2026-10-10T18:00");
    const to = ist("2026-10-12T10:00");
    expect(businessHoursBetween(from, to)).toBeCloseTo(2, 1);

    const elapsed = (to.getTime() - from.getTime()) / 3_600_000;
    expect(elapsed).toBeCloseTo(40, 1);
    // The gap between the two numbers is the whole reason this module exists: the old
    // code would have called this role 40 hours from due.
  });

  it("counts a full Saturday when the span crosses it", () => {
    // Fri 17:00 -> Mon 11:00: 2 + 10 (all Saturday) + 2.
    expect(businessHoursBetween(ist("2026-10-09T17:00"), ist("2026-10-12T11:00")))
      .toBeCloseTo(14, 1);
  });

  it("reads negative once the deadline is past", () => {
    expect(businessHoursBetween(ist("2026-10-12T15:00"), ist("2026-10-12T11:00")))
      .toBeCloseTo(-4, 1);
  });

  it("round-trips against addBusinessHours", () => {
    // The two have to agree, or a deadline set by one is misread by the other.
    const starts = [
      "2026-10-09T10:00", "2026-10-09T17:00", "2026-10-10T17:00",
      "2026-10-11T10:00", "2026-10-09T20:00", "2026-10-12T08:00",
    ];
    for (const start of starts) {
      for (const hours of [1, 4, 10, 36, 72]) {
        const due = addBusinessHours(ist(start), hours);
        expect(businessHoursBetween(ist(start), due)).toBeCloseTo(hours, 1);
      }
    }
  });
});

describe("the IST day boundary, which freshness depends on", () => {
  it("rolls at IST midnight, not UTC midnight", () => {
    // 18:30 UTC is 00:00 IST, so an instant just after it is already the next IST day.
    expect(istDay(new Date("2026-10-03T18:29:00Z"))).toBe("2026-10-03");
    expect(istDay(new Date("2026-10-03T18:31:00Z"))).toBe("2026-10-04");
  });

  it("counts CALENDAR days, so two nights apart is two days", () => {
    // 26 elapsed hours, but two IST midnights have passed.
    const from = ist("2026-10-01T23:00");
    const to = ist("2026-10-03T01:00");
    expect(istCalendarDaysBetween(from, to)).toBe(2);
    expect((to.getTime() - from.getTime()) / 86_400_000).toBeCloseTo(1.08, 1);
    // Elapsed arithmetic said 1. On the 10-day freshness threshold that is the difference
    // between a profile being matchable and not.
  });
});

describe("freshnessFor uses the IST calendar", () => {
  it("flips to expiring at the 10th IST day, not 240 elapsed hours", () => {
    const now = ist("2026-10-11T01:00");
    // Confirmed late on the 1st: nine IST midnights have passed by 01:00 on the 11th... so
    // ten calendar days. Elapsed time is only ~9.1 days.
    const confirmed = ist("2026-10-01T23:00");
    expect(istCalendarDaysBetween(confirmed, now)).toBe(10);
    expect(freshnessFor(confirmed, now).state).toBe("expiring_soon");

    const elapsedDays = (now.getTime() - confirmed.getTime()) / 86_400_000;
    expect(elapsedDays).toBeLessThan(10);
    // So the old code called this one `confirmed` and kept offering it.
  });

  it("drops out of matching at 14 IST days", () => {
    const now = ist("2026-10-15T10:00");
    const f = freshnessFor(ist("2026-10-01T10:00"), now);
    expect(f.state).toBe("unconfirmed");
    expect(f.eligibleForMatching).toBe(false);
  });

  it("still treats a never-confirmed profile as unmatchable", () => {
    const f = freshnessFor(null);
    expect(f.state).toBe("unconfirmed");
    expect(f.eligibleForMatching).toBe(false);
  });
});

describe("slaFor measures business hours remaining", () => {
  it("does not panic on a Saturday evening when a working day remains", () => {
    // Deadline Monday 11:00, read Saturday 18:00: 40 elapsed hours, 2 working ones.
    const now = ist("2026-10-10T18:00");
    const due = ist("2026-10-12T10:00");
    const sla = slaFor(due, 4, { now });
    expect(sla.hoursRemaining).toBeCloseTo(2, 1);
    expect(sla.label).toBe("Due in 2h");
    // A 4-hour window with 2 business hours left is 50% remaining, so `ok` rather than
    // `warn` — the old elapsed figure of 40h would have made the fraction nonsense.
    expect(sla.state).toBe("ok");
  });

  it("warns at a quarter of the window remaining", () => {
    const now = ist("2026-10-12T10:00");
    const due = ist("2026-10-12T11:00");   // 1 business hour left of a 36-hour window
    expect(slaFor(due, 36, { now }).state).toBe("warn");
  });

  it("is late once the deadline has passed, and says by how much", () => {
    const sla = slaFor(ist("2026-10-12T11:00"), 4, { now: ist("2026-10-12T15:00") });
    expect(sla.state).toBe("late");
    expect(sla.label).toMatch(/^Overdue/);
  });

  it("is idle, never late, while the clock is paused on the client", () => {
    // An unresponsive client must not make a broker look late (docs/DOMAIN.md).
    const sla = slaFor(ist("2026-10-01T11:00"), 72, { now: ist("2026-10-12T15:00"), paused: true });
    expect(sla.state).toBe("idle");
    expect(sla.label).toBe("Awaiting client");
  });
});

describe("holidays are pluggable and empty, deliberately", () => {
  it("skips a date passed in as a holiday", () => {
    // docs/DOMAIN.md says to put the calendar in a table, not in code, and that table does
    // not exist yet. Hardcoding Indian holidays would be an invented business rule
    // (working agreement 8) and wrong the first year a date moved. This proves the hook
    // works so the table can be wired in without touching the arithmetic.
    const holidays = new Set(["2026-10-10"]);   // treat that Saturday as a holiday
    expect(asIst(addBusinessHours(ist("2026-10-09T17:00"), 4, holidays)))
      .toBe("2026-10-12 11:00");   // Saturday skipped, lands on Monday
  });

  it("defaults to no holidays, so behaviour is predictable until the table exists", () => {
    expect(asIst(addBusinessHours(ist("2026-10-09T17:00"), 4)))
      .toBe("2026-10-10 11:00");   // Saturday is a working day
  });
});

/**
 * Display, which was the one edge nobody converted.
 *
 * `IST_TZ` was declared in src/lib/derived.ts and used for documentation only. Sixteen
 * formatters passed `"en-IN"` with no `timeZone`, so they rendered in the PROCESS's zone —
 * UTC on Vercel. The locale was right and the clock was wrong: an interview scheduled for
 * 11:00 IST appeared as "05:30" on the deployed site.
 *
 * These assertions are absolute, not relative to the machine running them. That is the
 * point — the whole bug was output that changed with the server's timezone.
 */
describe("istFormat renders in IST whatever zone the process is in", () => {
  it("shows an 11:00 IST round as 11:00, not as its UTC instant", () => {
    // 05:30Z IS 11:00 IST. Before the fix this rendered "05:30" under TZ=UTC.
    expect(istFormat("2026-10-12T05:30:00Z", {
      hour: "2-digit", minute: "2-digit", hour12: false,
    })).toBe("11:00");
  });

  it("does not roll a late-evening IST time back a day", () => {
    // 20:00 IST on the 12th is 14:30Z on the 12th; but 00:30 IST on the 13th is 19:00Z on
    // the 12th, and a UTC formatter would call that the 12th.
    expect(istFormat("2026-10-12T19:00:00Z", {
      day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hour12: false,
    })).toBe("13 Oct, 00:30");
  });

  it("keeps a date-only column on its own date", () => {
    // `date` columns parse as UTC midnight. 05:30 IST on the 31st is still the 31st — and
    // pinning IST means a server zone behind UTC cannot show the 30th.
    expect(istFormat("2026-10-31", { day: "numeric", month: "short" })).toBe("31 Oct");
  });
});

/**
 * The window a proposed interview slot has to fit inside.
 *
 * This backs /api/client/interviews/slots. The interesting cases are all boundaries, which
 * is exactly why they are stated directly rather than seeded.
 */
describe("isWithinBusinessHours", () => {
  it("accepts a mid-morning weekday round", () => {
    expect(isWithinBusinessHours(ist("2026-10-12T11:00"), 60)).toBe(true);  // Monday
  });

  it("requires the WHOLE meeting to fit, not just its start", () => {
    // 18:30 starts inside the window and ends at 19:30, which cannot be held.
    expect(isWithinBusinessHours(ist("2026-10-12T18:30"), 60)).toBe(false);
    // 18:00 + 60 ends exactly at close, which can.
    expect(isWithinBusinessHours(ist("2026-10-12T18:00"), 60)).toBe(true);
    // And the same instant is fine for a shorter round.
    expect(isWithinBusinessHours(ist("2026-10-12T18:30"), 30)).toBe(true);
  });

  it("rejects before opening", () => {
    expect(isWithinBusinessHours(ist("2026-10-12T08:30"), 60)).toBe(false);
    expect(isWithinBusinessHours(ist("2026-10-12T09:00"), 60)).toBe(true);
  });

  it("works Saturday and not Sunday", () => {
    expect(isWithinBusinessHours(ist("2026-10-10T11:00"), 60)).toBe(true);   // Saturday
    expect(isWithinBusinessHours(ist("2026-10-11T11:00"), 60)).toBe(false);  // Sunday
  });

  it("excludes a holiday from the table", () => {
    const holidays = new Set(["2026-10-12"]);
    expect(isWithinBusinessHours(ist("2026-10-12T11:00"), 60, holidays)).toBe(false);
    // The next working day is unaffected.
    expect(isWithinBusinessHours(ist("2026-10-13T11:00"), 60, holidays)).toBe(true);
  });
});
