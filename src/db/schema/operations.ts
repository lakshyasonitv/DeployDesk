import {
  pgTable, pgEnum, uuid, text, integer, smallint, time, date, timestamp, jsonb, index,
  primaryKey, check, unique,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { organizations, users } from "./tenancy";
import { engagements, interviews } from "./ops";

/**
 * The four tables from migration 0005, declared so Drizzle can query them.
 *
 * Each one exists because a control on screen was blocked on it — every button named below
 * was visible and inert before this.
 */

const ts = () => timestamp({ withTimezone: true }).notNull().defaultNow();

/* ====================================================================== */
/*  holiday_calendar                                                       */
/* ====================================================================== */

/**
 * Non-working dates in IST, for the SLA clock.
 *
 * `docs/DOMAIN.md` is explicit that this must be a table and not code: "Business hours are
 * 09:00–19:00 IST, Monday–Saturday, excluding a configured Indian holiday calendar. Put
 * the calendar in a table, not in code." `src/lib/business-clock.ts` already takes an
 * optional holiday set, so reading this table changes nothing about the arithmetic.
 *
 * `holidayDate` is a `date`, not a timestamp: a holiday is a calendar day in India, and
 * storing it as `timestamptz` invites a conversion that shifts it by a day.
 */
export const holidayCalendar = pgTable("holiday_calendar", {
  holidayDate: date("holiday_date").notNull(),
  name: text().notNull(),
  /** NULL = nationwide. Otherwise a state code — many Indian holidays are state-specific. */
  region: text(),
  createdAt: ts(),
}, (t) => [primaryKey({ columns: [t.holidayDate, t.name] })]);

/* ====================================================================== */
/*  interview_slots                                                        */
/* ====================================================================== */

export const slotStatus = pgEnum("slot_status", ["proposed", "accepted", "declined", "withdrawn"]);
export const slotProposedBy = pgEnum("slot_proposed_by", ["client", "ops", "vendor"]);

/**
 * One candidate time for an interview round. Unblocks "Propose new slots", "Reschedule"
 * and "Panel availability".
 *
 * Supersedes `interviews.proposed_slots`, a jsonb blob holding the same idea, for anything
 * that needs to be QUERIED — which slots a panel is free for, who proposed one, what was
 * declined and why. The jsonb column stays because migrations are append-only and the
 * seeded demo data still uses it.
 *
 * `proposedBy` is OPS-READABLE and must not appear in a client read model. A vendor may
 * propose a time around its own candidate's availability and ops relays it; a client
 * learning that a vendor touched the slot would learn a vendor exists on that requirement.
 */
export const interviewSlots = pgTable("interview_slots", {
  id: uuid().primaryKey().defaultRandom(),
  interviewId: uuid("interview_id").notNull().references(() => interviews.id, { onDelete: "cascade" }),
  startsAt: timestamp("starts_at", { withTimezone: true }).notNull(),
  durationMinutes: integer("duration_minutes").notNull().default(60),
  proposedBy: slotProposedBy("proposed_by").notNull(),
  proposedByUserId: uuid("proposed_by_user_id").references(() => users.id),
  status: slotStatus().notNull().default("proposed"),
  declineReason: text("decline_reason"),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [
  index("interview_slots_interview_idx").on(t.interviewId, t.startsAt),
  check("interview_slots_duration_positive", sql`${t.durationMinutes} > 0`),
]);

/* ====================================================================== */
/*  extension_requests                                                     */
/* ====================================================================== */

export const extensionStatus = pgEnum("extension_status", [
  "requested", "with_supplier", "approved", "declined", "withdrawn",
]);

/**
 * A client asking to keep someone for longer. Unblocks "Request an extension".
 *
 * `with_supplier` is a real state, not a nicety: Talentvibes has to confirm the person is
 * still released by their employer before promising the client anything, and during that
 * window the client is shown "your Talentvibes team is confirming" and never the supplier's name.
 *
 * There is deliberately NO rate column. An extension at a new rate is a renegotiation, and
 * the client rate and vendor rate are set independently by ops — a single `rate` field here
 * would invite one side's figure into a row the other side can read.
 */
export const extensionRequests = pgTable("extension_requests", {
  id: uuid().primaryKey().defaultRandom(),
  engagementId: uuid("engagement_id").notNull().references(() => engagements.id, { onDelete: "cascade" }),
  requestedBy: uuid("requested_by").notNull().references(() => users.id),
  requestedUntil: date("requested_until").notNull(),
  /** CLIENT + OPS ONLY. Never relayed to a vendor verbatim. */
  clientNote: text("client_note"),
  status: extensionStatus().notNull().default("requested"),
  decidedBy: uuid("decided_by").references(() => users.id),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  /** OPS ONLY. */
  opsNote: text("ops_note"),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [index("extension_requests_engagement_idx").on(t.engagementId, t.status)]);

/* ====================================================================== */
/*  panel_availability                                                     */
/* ====================================================================== */

/**
 * A client's weekly interview windows, in IST. Migration 0006.
 *
 * Unblocks "Set panel availability" (v2 `SCREENS.md:83`), which never worked and was
 * removed from the interviews header rather than left inert: every row in
 * `interview_slots` hangs off one round (`interview_id` is `not null`), so there was
 * nowhere to record "Tuesdays suit us" independent of a specific interview.
 *
 * **Advisory, not a gate.** A slot proposed outside these windows is flagged to the client
 * and still sent — people legitimately make exceptions, and a hard block on your own stated
 * preference is infuriating. The 09:00-19:00 IST business-hours check in
 * `/api/client/interviews/slots` stays a gate, because that one is about whether an
 * interview can be held at all.
 *
 * Per ORG rather than per panellist on purpose. `interview_panelists` already names who is
 * on a round; a per-person calendar is something somebody has to maintain, and it would read
 * as "never available" rather than "unknown" for anyone who never filled it in.
 */
export const panelAvailability = pgTable("panel_availability", {
  id: uuid().primaryKey().defaultRandom(),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** 0 = Sunday .. 6 = Saturday, matching Postgres `dow` and JS `getUTCDay()`. */
  weekday: smallint().notNull(),
  /** IST wall-clock. A fixed +05:30 product has no use for a per-row offset. */
  fromTime: time("from_time").notNull(),
  toTime: time("to_time").notNull(),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [
  index("panel_availability_org_idx").on(t.orgId, t.weekday, t.fromTime),
  // Two different windows on one weekday are allowed: "Tue 10:00-12:00 and 15:00-17:00"
  // is a real pattern. The same window twice is not.
  unique("panel_availability_unique_window").on(t.orgId, t.weekday, t.fromTime, t.toTime),
  check("panel_availability_weekday_range", sql`${t.weekday} between 0 and 6`),
  check("panel_availability_times_ordered", sql`${t.toTime} > ${t.fromTime}`),
]);

/* ====================================================================== */
/*  saved_views                                                            */
/* ====================================================================== */

/**
 * A named filter set for one screen. Unblocks "Save this view".
 *
 * Scoped to `userId` AND `orgId`. The org is not redundant: a saved view holds filter
 * VALUES, and on the talent pool those can include a supplier name — so a view must not
 * follow a user into another organisation, and `orgId` is what an eventual RLS policy keys
 * on.
 *
 * `filters` is jsonb on purpose, which is unusual in this schema. Each screen has a
 * different filter set, the sets change as screens change, and nothing queries inside
 * them: the whole value is read back and applied. That is the case jsonb is for.
 */
export const savedViews = pgTable("saved_views", {
  id: uuid().primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  orgId: uuid("org_id").notNull().references(() => organizations.id, { onDelete: "cascade" }),
  /** 'ops.pool', 'vendor.roster', … */
  screen: text().notNull(),
  name: text().notNull(),
  filters: jsonb().notNull().default({}),
  createdAt: ts(),
  updatedAt: ts(),
}, (t) => [
  index("saved_views_user_screen_idx").on(t.userId, t.screen),
  // One name per screen per user, so saving twice renames rather than duplicates.
  unique("saved_views_unique_name").on(t.userId, t.screen, t.name),
]);
