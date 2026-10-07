-- 0005_missing_models.sql
--
-- Four tables that controls on screen are currently blocked on. Every one of these
-- buttons exists in the UI today and does nothing, because there was nowhere to put the
-- data.
--
--   holiday_calendar     the SLA clock. docs/DOMAIN.md: "Business hours are 09:00-19:00
--                        IST, Monday-Saturday, excluding a configured Indian holiday
--                        calendar. Put the calendar in a table, not in code." The IST
--                        clock already takes an optional holiday set and defaults to
--                        empty; this is the table it reads.
--   interview_slots      "Propose new slots", "Reschedule", "Panel availability"
--   extension_requests   "Request an extension"
--   saved_views          "Save this view"
--
-- NOT included, deliberately:
--   - feedback drafts. `interview_feedback` already stores a row with a null `outcome`,
--     which IS a draft; the endpoint supports it and only the button needs wiring. A
--     `draft` column would be a second way to say the same thing.
--   - duplicate detection rules. That is a settings screen with no agreed rules behind
--     it; inventing thresholds here is what working agreement 8 forbids.
--
-- Conventions, per CLAUDE.md: snake_case plural tables, timestamptz in UTC, bigint paise
-- for money, append-only. Guarded with IF NOT EXISTS so a partial apply is re-runnable.
-- The `down` is at the bottom.

BEGIN;

/* ====================================================================== */
/*  holiday_calendar — the table docs/DOMAIN.md asks for                   */
/* ====================================================================== */

/**
 * A non-working date in IST.
 *
 * `holiday_date` is a plain `date`, not a timestamp: a holiday is a calendar day in India,
 * not an instant, and storing it as timestamptz would invite a timezone conversion that
 * shifts it by a day.
 *
 * `region` exists because several Indian holidays are state-specific and a Bangalore team
 * does not stop for a Maharashtra holiday. NULL means nationwide.
 */
CREATE TABLE IF NOT EXISTS "holiday_calendar" (
  "holiday_date" date        NOT NULL,
  "name"         text        NOT NULL,
  "region"       text,                  -- NULL = nationwide; else a state, e.g. 'KA'
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("holiday_date", "name")
);

COMMENT ON TABLE "holiday_calendar" IS
  'Non-working dates in IST for the SLA clock. docs/DOMAIN.md requires this to be a table, not code.';
COMMENT ON COLUMN "holiday_calendar"."region" IS
  'NULL means nationwide. Otherwise a state code — several Indian holidays are state-specific.';

/* ====================================================================== */
/*  interview_slots — proposing and rescheduling                           */
/* ====================================================================== */

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'slot_status') THEN
    CREATE TYPE "slot_status" AS ENUM ('proposed', 'accepted', 'declined', 'withdrawn');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'slot_proposed_by') THEN
    CREATE TYPE "slot_proposed_by" AS ENUM ('client', 'ops', 'vendor');
  END IF;
END $$;

/**
 * One candidate time for an interview round.
 *
 * `interviews.proposed_slots` is already a jsonb column holding the same idea, and this
 * table supersedes it for anything that needs to be QUERIED — "which slots is this panel
 * free for", "who proposed this one", "what was declined and why". A jsonb blob cannot
 * answer those without scanning, and cannot carry a foreign key to the person who
 * proposed it.
 *
 * The jsonb column is left in place rather than dropped: migrations are append-only, and
 * the seeded demo data still uses it. A later migration can drop it once nothing reads it.
 *
 * `proposed_by` matters for masking. A VENDOR may propose a slot for its own candidate's
 * availability, and ops relays it — but the client must never be shown that a vendor
 * touched it, so this column is ops-readable and is not part of any client read model.
 */
CREATE TABLE IF NOT EXISTS "interview_slots" (
  "id"           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "interview_id" uuid NOT NULL REFERENCES "interviews"("id") ON DELETE CASCADE,
  "starts_at"    timestamptz NOT NULL,
  "duration_minutes" integer NOT NULL DEFAULT 60,
  "proposed_by"  "slot_proposed_by" NOT NULL,
  "proposed_by_user_id" uuid REFERENCES "users"("id"),
  "status"       "slot_status" NOT NULL DEFAULT 'proposed',
  "decline_reason" text,
  "created_at"   timestamptz NOT NULL DEFAULT now(),
  "updated_at"   timestamptz NOT NULL DEFAULT now(),
  -- A zero or negative duration is not a slot.
  CONSTRAINT "interview_slots_duration_positive" CHECK ("duration_minutes" > 0)
);

CREATE INDEX IF NOT EXISTS "interview_slots_interview_idx"
  ON "interview_slots" ("interview_id", "starts_at");

COMMENT ON TABLE "interview_slots" IS
  'Candidate times for an interview round. Supersedes interviews.proposed_slots for anything queryable.';
COMMENT ON COLUMN "interview_slots"."proposed_by" IS
  'OPS-READABLE. A client must never learn that a vendor proposed a slot.';

/* ====================================================================== */
/*  extension_requests — "Request an extension"                            */
/* ====================================================================== */

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'extension_status') THEN
    CREATE TYPE "extension_status" AS ENUM ('requested', 'with_supplier', 'approved', 'declined', 'withdrawn');
  END IF;
END $$;

/**
 * A client asking to keep someone for longer.
 *
 * `with_supplier` is a real state and not a nicety: Talentvibes has to confirm the person
 * is still released by their employer before promising the client anything, and during
 * that window the client is told "your broker is confirming" and never "waiting on Nimbus
 * Softworks".
 *
 * There is no rate column. An extension at a NEW rate is a renegotiation, and the client
 * rate and vendor rate are set independently by ops — putting a single rate here would
 * invite one side's figure into a row the other side can see.
 */
CREATE TABLE IF NOT EXISTS "extension_requests" (
  "id"            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "engagement_id" uuid NOT NULL REFERENCES "engagements"("id") ON DELETE CASCADE,
  "requested_by"  uuid NOT NULL REFERENCES "users"("id"),
  "requested_until" date NOT NULL,
  "client_note"   text,                 -- CLIENT + OPS ONLY, never relayed verbatim
  "status"        "extension_status" NOT NULL DEFAULT 'requested',
  "decided_by"    uuid REFERENCES "users"("id"),
  "decided_at"    timestamptz,
  "ops_note"      text,                 -- OPS ONLY
  "created_at"    timestamptz NOT NULL DEFAULT now(),
  "updated_at"    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "extension_requests_engagement_idx"
  ON "extension_requests" ("engagement_id", "status");

COMMENT ON TABLE "extension_requests" IS
  'A client asking to keep someone longer. `with_supplier` is the window while ops confirms release.';
COMMENT ON COLUMN "extension_requests"."client_note" IS
  'CLIENT + OPS ONLY. Never relayed to a vendor verbatim — see interview_feedback.relayed_summary.';
COMMENT ON COLUMN "extension_requests"."ops_note" IS 'OPS ONLY.';

/* ====================================================================== */
/*  saved_views — "Save this view"                                         */
/* ====================================================================== */

/**
 * A named set of filters on a screen.
 *
 * Scoped to `user_id` AND `org_id`. The org is not redundant: a saved view holds filter
 * values, and on the talent pool those can include a supplier name — so a view must not
 * follow a user into a different organisation, and the org column is what the eventual
 * RLS policy keys on.
 *
 * `filters` is jsonb on purpose. Each screen has a different filter set, they change as
 * screens change, and nothing needs to query inside them — the whole value is read back
 * and applied. That is the case jsonb is actually for.
 */
CREATE TABLE IF NOT EXISTS "saved_views" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id"    uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "org_id"     uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "screen"     text NOT NULL,           -- 'ops.pool', 'vendor.roster', ...
  "name"       text NOT NULL,
  "filters"    jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  -- One name per screen per user, so saving twice renames rather than duplicates.
  CONSTRAINT "saved_views_unique_name" UNIQUE ("user_id", "screen", "name")
);

CREATE INDEX IF NOT EXISTS "saved_views_user_screen_idx"
  ON "saved_views" ("user_id", "screen");

COMMENT ON TABLE "saved_views" IS
  'A named filter set for one screen. Scoped to user AND org: pool filters can name a supplier.';

COMMIT;

-- =====================================================================
-- down
-- =====================================================================
--
-- BEGIN;
--   DROP TABLE IF EXISTS "saved_views";
--   DROP TABLE IF EXISTS "extension_requests";
--   DROP TABLE IF EXISTS "interview_slots";
--   DROP TABLE IF EXISTS "holiday_calendar";
--   DROP TYPE IF EXISTS "extension_status";
--   DROP TYPE IF EXISTS "slot_status";
--   DROP TYPE IF EXISTS "slot_proposed_by";
-- COMMIT;
--
-- =====================================================================
-- Verification (run after applying)
-- =====================================================================
--
--   select count(*) from holiday_calendar;      -- 0 until the seed runs
--   select count(*) from interview_slots;       -- 0
--   select count(*) from extension_requests;    -- 0
--   select count(*) from saved_views;           -- 0
--
--   -- the duration guard bites
--   insert into interview_slots (interview_id, starts_at, duration_minutes, proposed_by)
--   select id, now(), 0, 'client' from interviews limit 1;
--   -- expected: ERROR  violates check constraint "interview_slots_duration_positive"
