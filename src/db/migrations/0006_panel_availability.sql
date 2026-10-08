-- 0006_panel_availability.sql
--
-- One table, for the last control on screen with nowhere to put its data.
--
-- "Set panel availability" is in the v2 handoff (SCREENS.md:83) and has never worked. It
-- was removed from the interviews header rather than left inert, because every slot in
-- `interview_slots` hangs off a specific round -- `interview_id` is `not null` -- so there
-- was nowhere to record "Tuesdays suit us" independent of any one interview.
--
-- WHAT IT IS
--
--   A weekly routine per CLIENT ORGANISATION: "we interview Tue-Thu, 14:00-18:00".
--   That is how a hiring team actually talks about it, and it is one short list to keep
--   current rather than one per interviewer.
--
-- WHAT IT IS NOT
--
--   Not per panel member. `interview_panelists` already names the people on a round, and
--   a per-person calendar is a thing somebody has to maintain -- it would be empty for
--   anyone who never filled it in, which is worse than no data because it reads as "never
--   available" rather than "unknown".
--
--   Not a blackout list. Considered: record only the exceptions (festival week, audit
--   season) and assume business hours otherwise. Less to fill in, but it cannot express a
--   routine, and a routine is the common case.
--
--   Not a gate. Proposing a time outside these windows is ALLOWED and flagged -- "that is
--   outside the hours you gave us, send it anyway?" People legitimately make exceptions,
--   and a hard block on your own stated preference is infuriating. The existing
--   09:00-19:00 IST business-hours check in /api/client/interviews/slots stays a gate,
--   because that one is about whether an interview can be held at all.
--
-- TIMES ARE IST
--
--   `time` without a zone, read as Asia/Kolkata, like every other clock in this product
--   (CLAUDE.md working agreement 3). A `timetz` would invite a per-row offset that nothing
--   else here has, and the business clock is a fixed +05:30.
--
-- WEEKDAY NUMBERING
--
--   0 = Sunday through 6 = Saturday, matching Postgres `extract(dow from ...)` and
--   JavaScript `getUTCDay()`, so neither side has to translate. Sunday is storable even
--   though docs/DOMAIN.md makes it a non-working day: the business-hours gate already
--   refuses a Sunday slot, and silently dropping a row somebody entered is worse than
--   letting the gate explain itself.
--
-- The `down` is at the bottom.

create table if not exists panel_availability (
  id          uuid primary key default gen_random_uuid(),

  -- The hiring organisation whose panel this is. Cascades: if the org goes, so does its
  -- routine. There is nothing to keep.
  org_id      uuid not null references organizations(id) on delete cascade,

  -- 0 = Sunday .. 6 = Saturday.
  weekday     smallint not null,

  -- IST wall-clock. 14:00-18:00 means "two in the afternoon until six", in India.
  from_time   time not null,
  to_time     time not null,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint panel_availability_weekday_range
    check (weekday between 0 and 6),

  -- A window that ends before it starts is not a window. This also rules out the
  -- zero-length row an empty form would otherwise submit.
  constraint panel_availability_times_ordered
    check (to_time > from_time),

  -- One row per org per weekday per window, so saving the same thing twice is a no-op
  -- rather than a duplicate. Two DIFFERENT windows on one weekday are allowed on purpose:
  -- "Tuesday 10:00-12:00 and 15:00-17:00" is a real pattern.
  constraint panel_availability_unique_window
    unique (org_id, weekday, from_time, to_time)
);

-- The only read pattern: every window for one org, in week order.
create index if not exists panel_availability_org_idx
  on panel_availability (org_id, weekday, from_time);

comment on table panel_availability is
  'Weekly interview windows per client org, in IST. Advisory, not a gate: a slot proposed '
  'outside these hours is flagged to the client and still sent.';

-- ---------------------------------------------------------------------------
-- down
-- ---------------------------------------------------------------------------
--
-- drop index if exists panel_availability_org_idx;
-- drop table if exists panel_availability;
