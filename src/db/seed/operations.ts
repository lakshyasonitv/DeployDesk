import { eq } from "drizzle-orm";
import { db, log, schema as s } from "./ctx";
import type { OrgSeed } from "./orgs";

/**
 * Seed for the four tables added by migration 0005.
 *
 * Each one backs a control that was visible and inert before this: "Propose new slots",
 * "Reschedule", "Panel availability", "Request an extension" and "Save this view".
 */

/* ====================================================================== */
/*  Holidays — only dates that are fixed and nationwide                    */
/* ====================================================================== */

/**
 * Three holidays, and no more.
 *
 * These are the only Indian public holidays that fall on the SAME DATE every year and
 * apply nationwide. Everything else — Diwali, Holi, Eid, Good Friday — moves with a lunar
 * or liturgical calendar, or varies by state.
 *
 * Seeding a fuller list would mean stating dates from memory, and a wrong date here does
 * not fail loudly: it silently shifts a real SLA deadline by a working day. That is the
 * invented business rule `CLAUDE.md` working agreement 8 forbids. The product owner agreed
 * to the three fixed ones; HR supplies the rest.
 */
const FIXED_NATIONAL_HOLIDAYS = [
  { month: 1, day: 26, name: "Republic Day" },
  { month: 8, day: 15, name: "Independence Day" },
  { month: 10, day: 2, name: "Gandhi Jayanti" },
];

/** Seeded for the current year and the next, so a demo near year-end still has entries. */
function fixedHolidaysFor(years: number[]) {
  return years.flatMap((year) =>
    FIXED_NATIONAL_HOLIDAYS.map((h) => ({
      holidayDate: `${year}-${String(h.month).padStart(2, "0")}-${String(h.day).padStart(2, "0")}`,
      name: h.name,
      region: null as string | null,   // nationwide
    })),
  );
}

export async function seedOperations(org: OrgSeed) {
  const now = new Date();
  const thisYear = now.getUTCFullYear();

  /* ---------------------------------------------------------- holidays */

  const holidays = fixedHolidaysFor([thisYear, thisYear + 1]);
  await db.insert(s.holidayCalendar).values(holidays);
  log(`  holiday_calendar: ${holidays.length} (fixed national dates only, ${thisYear}-${thisYear + 1})`);
  log(`    moving festivals are NOT seeded — a guessed date silently shifts an SLA deadline`);

  /* ----------------------------------------------------- interview slots */

  /**
   * Slots on the interviews the seed already created, so "Reschedule" and "Panel
   * availability" have something to show.
   *
   * One interview gets a declined slot with a reason, because the interesting case for the
   * UI is not a clean list of options — it is a round where the first proposal did not
   * work and you can see why.
   */
  const rounds = await db
    .select({
      id: s.interviews.id,
      status: s.interviews.status,
      scheduledAt: s.interviews.scheduledAt,
      maskedId: s.shortlistItems.maskedId,
    })
    .from(s.interviews)
    .innerJoin(s.shortlistItems, eq(s.shortlistItems.id, s.interviews.shortlistItemId));

  const slotRows: Array<typeof s.interviewSlots.$inferInsert> = [];
  const opsUser = org.opsByShort.get("R. Verma")!.id;

  for (const [i, r] of rounds.entries()) {
    const base = r.scheduledAt ?? new Date(now.getTime() + (i + 2) * 86_400_000);

    // 11:00 and 15:00 IST on the day, which is 05:30 and 09:30 UTC.
    for (const [n, hourUtc] of [[0, 5.5], [1, 9.5]] as const) {
      const d = new Date(base);
      d.setUTCHours(Math.floor(hourUtc), (hourUtc % 1) * 60, 0, 0);
      slotRows.push({
        interviewId: r.id,
        startsAt: d,
        durationMinutes: 60,
        proposedBy: "client",
        // The accepted one is the slot the round is actually scheduled for.
        status: r.status === "confirmed" && n === 0 ? "accepted" : "proposed",
      });
    }

    // One declined proposal, with the reason, on the first round only.
    if (i === 0) {
      const d = new Date(base);
      d.setUTCDate(d.getUTCDate() - 1);
      d.setUTCHours(11, 30, 0, 0);   // 17:00 IST
      slotRows.push({
        interviewId: r.id,
        startsAt: d,
        durationMinutes: 45,
        proposedBy: "ops",
        proposedByUserId: opsUser,
        status: "declined",
        declineReason: "Panel member travelling; asked for a morning slot instead.",
      });
    }
  }

  if (slotRows.length) {
    await db.insert(s.interviewSlots).values(slotRows);
    const accepted = slotRows.filter((r) => r.status === "accepted").length;
    const declined = slotRows.filter((r) => r.status === "declined").length;
    log(`  interview_slots: ${slotRows.length} (${accepted} accepted, ${declined} declined with a reason)`);
  }

  /* ------------------------------------------------- extension requests */

  /**
   * One request, left at `with_supplier`.
   *
   * That state is the one worth demonstrating: the client sees "your broker is confirming"
   * while ops checks the person is still released by their employer, and it is the window
   * in which the client must NOT be shown the supplier's name.
   */
  const [engagement] = await db
    .select({ id: s.engagements.id, clientOrgId: s.engagements.clientOrgId })
    .from(s.engagements)
    .where(eq(s.engagements.status, "active"))
    .limit(1);

  if (engagement) {
    const requester = await db
      .select({ id: s.users.id })
      .from(s.users)
      .where(eq(s.users.orgId, engagement.clientOrgId))
      .limit(1);

    if (requester.length) {
      const until = new Date(now.getTime() + 120 * 86_400_000);
      await db.insert(s.extensionRequests).values({
        engagementId: engagement.id,
        requestedBy: requester[0].id,
        requestedUntil: until.toISOString().slice(0, 10),
        clientNote: "The platform programme slipped a quarter. We would like to keep them "
          + "through to the end of the migration.",
        status: "with_supplier",
        opsNote: "Checking release with the supplier before confirming to the client.",
      });
      log(`  extension_requests: 1 (with_supplier — the state where the client must not see the supplier)`);
    }
  }

  /* ------------------------------------------------------- saved views */

  const opsAdmin = org.opsByShort.get("D. Rao")!;
  const nimbus = org.byName.get("Nimbus Softworks")!;
  const nimbusUser = await db
    .select({ id: s.users.id })
    .from(s.users)
    .where(eq(s.users.orgId, nimbus.id))
    .limit(1);

  const viewRows: Array<typeof s.savedViews.$inferInsert> = [
    {
      userId: opsAdmin.id,
      orgId: org.tv.id,
      screen: "ops.pool",
      name: "Java, 5-8 years, scored 80+",
      filters: { skills: ["Java Spring Boot"], experienceBand: "5-8", minScore: 80 },
    },
  ];
  if (nimbusUser.length) {
    viewRows.push({
      userId: nimbusUser[0].id,
      orgId: nimbus.id,
      screen: "vendor.roster",
      name: "Needs confirming this week",
      filters: { freshness: "expiring" },
    });
  }

  await db.insert(s.savedViews).values(viewRows);
  log(`  saved_views: ${viewRows.length} (scoped to user AND org — pool filters can name a supplier)`);

  return { holidays: holidays.length, slots: slotRows.length };
}


/**
 * Re-exported from the production adapter so the seed and tests share one definition.
 * The real implementation is `src/db/holidays.ts` — the clock must not import the DB.
 */
export { getHolidaySet as holidaySetFromDb } from "../holidays";
