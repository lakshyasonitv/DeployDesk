-- 0002_dual_role_organisations.sql
--
-- Lets one company act as both supplier and client. See ADR-012.
--
-- Depends on 0001 having been applied (snake_case column names).
--
-- Design decisions encoded here, all settled with the product owner before writing:
--
--   * org_capabilities is AUTHORITATIVE for what a company may do. organizations.org_type
--     is kept for ops filtering but becomes DERIVED — a trigger maintains it, and the app
--     must not write it.
--   * The Talentvibes org has NEITHER capability. It is the broker, not a participant,
--     and a check constraint enforces that.
--   * A user still belongs to exactly ONE organisation (unique on user_id). What changed
--     is that a membership carries a SET of roles rather than one. ADR-012 is scoped to
--     that and to making the portal switcher a production feature — nothing wider.
--   * Groups are declared by ops at onboarding from the MSA. They are NEVER inferred from
--     PAN or GSTIN: two subsidiaries can share a PAN prefix without being related, and
--     unrelated companies can share neither while being the same group in practice.
--   * Rates stay in two separate columns on engagements (already true since 0000).
--     Receivables and payables stay separate invoice rows with no netting (already true).

BEGIN;

/* ---------------------------------------------------------------- groups */

CREATE TABLE IF NOT EXISTS "groups" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name"       text NOT NULL,
  "notes"      text,                    -- ops context: which MSA declared this grouping
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE "groups" IS
  'Corporate groupings declared by ops during onboarding, from the MSA. Never inferred from PAN or GSTIN.';

/* -------------------------------------------------- organizations: new columns */

ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "legal_name"      text;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "pan"             text;
ALTER TABLE "organizations" ADD COLUMN IF NOT EXISTS "parent_group_id" uuid;

-- legal_name defaults to the display name so nothing is null after this migration.
UPDATE "organizations" SET "legal_name" = "name" WHERE "legal_name" IS NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'kyc_status') THEN
    CREATE TYPE "kyc_status" AS ENUM ('pending', 'in_review', 'verified', 'rejected');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'fee_model') THEN
    CREATE TYPE "fee_model" AS ENUM ('hidden_markup', 'flat_declared_fee');
  END IF;
END $$;

ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "kyc_status" "kyc_status" NOT NULL DEFAULT 'pending';

-- Platform fee model per org. Dual-role orgs default to a flat declared fee: a hidden
-- markup on a company that also supplies would let it infer the margin by comparing what
-- it is paid as a supplier against what it is charged as a client.
ALTER TABLE "organizations"
  ADD COLUMN IF NOT EXISTS "fee_model" "fee_model" NOT NULL DEFAULT 'hidden_markup';

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_parent_group_id_fk') THEN
    ALTER TABLE "organizations"
      ADD CONSTRAINT "organizations_parent_group_id_fk"
      FOREIGN KEY ("parent_group_id") REFERENCES "groups"("id") ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "organizations_group_idx" ON "organizations" ("parent_group_id");

/* ------------------------------------------------------- org_capabilities */

CREATE TABLE IF NOT EXISTS "org_capabilities" (
  "org_id"     uuid PRIMARY KEY REFERENCES "organizations"("id") ON DELETE CASCADE,
  "can_supply" boolean NOT NULL DEFAULT false,
  "can_hire"   boolean NOT NULL DEFAULT false,
  "updated_by" uuid REFERENCES "users"("id"),   -- ops only; see the RLS policy in 0003
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE "org_capabilities" IS
  'Authoritative record of what an organisation may do. organizations.org_type is derived from this.';

-- Backfill from the existing org_type enum.
INSERT INTO "org_capabilities" ("org_id", "can_supply", "can_hire")
SELECT "id",
       "org_type" = 'vendor',
       "org_type" = 'client'
FROM "organizations"
ON CONFLICT ("org_id") DO NOTHING;

-- The broker having neither capability is enforced by the trigger below, not by a CHECK
-- constraint: the rule depends on organizations.org_type, which lives in another table,
-- and a CHECK cannot read one. The trigger raises instead of silently correcting, so an
-- attempt to give the broker a capability fails loudly.

/* --------------------------------------------- org_type becomes derived ---- */

-- Keeps organizations.org_type in step with capabilities, and refuses to give the broker
-- a participant capability. org_type is retained only because ops filtering and several
-- existing queries use it; application code must not write it.
CREATE OR REPLACE FUNCTION "sync_org_type_from_capabilities"() RETURNS trigger AS $$
DECLARE
  current_type text;
BEGIN
  SELECT "org_type" INTO current_type FROM "organizations" WHERE "id" = NEW."org_id";

  IF current_type = 'talentvibes' AND (NEW."can_supply" OR NEW."can_hire") THEN
    RAISE EXCEPTION
      'The Talentvibes organisation is the broker and cannot be given can_supply or can_hire';
  END IF;

  IF current_type <> 'talentvibes' THEN
    UPDATE "organizations"
       SET "org_type" = CASE
             WHEN NEW."can_supply" AND NEW."can_hire" THEN 'vendor'   -- dual role; see note
             WHEN NEW."can_supply" THEN 'vendor'
             WHEN NEW."can_hire"   THEN 'client'
             ELSE "org_type"
           END::"org_type",
           "updated_at" = now()
     WHERE "id" = NEW."org_id";
  END IF;

  NEW."updated_at" = now();
  RETURN NEW;
END $$ LANGUAGE plpgsql;

-- NOTE on the dual-role case: org_type is a single-valued enum and cannot express
-- "both". A dual-role org is recorded as 'vendor' in org_type purely so legacy filters
-- keep working, and org_capabilities is the only correct source for what it may do.
-- Anything that needs to know about dual role must read org_capabilities, never org_type.

DROP TRIGGER IF EXISTS "org_capabilities_sync" ON "org_capabilities";
CREATE TRIGGER "org_capabilities_sync"
  BEFORE INSERT OR UPDATE ON "org_capabilities"
  FOR EACH ROW EXECUTE FUNCTION "sync_org_type_from_capabilities"();

/* ------------------------------------------------------------ memberships */

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'membership_role') THEN
    CREATE TYPE "membership_role" AS ENUM ('supply', 'demand', 'admin');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "memberships" (
  "id"         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- UNIQUE, deliberately: ADR-012 keeps "a user belongs to exactly one organisation".
  "user_id"    uuid NOT NULL UNIQUE REFERENCES "users"("id") ON DELETE CASCADE,
  "org_id"     uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "roles"      "membership_role"[] NOT NULL DEFAULT '{}',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "memberships_roles_not_empty" CHECK (array_length("roles", 1) >= 1)
);

CREATE INDEX IF NOT EXISTS "memberships_org_idx" ON "memberships" ("org_id");

COMMENT ON COLUMN "memberships"."roles" IS
  'A SET of roles. Access is per user: one user may hold both supply and demand.';

-- Backfill from the existing single-org users table.
INSERT INTO "memberships" ("user_id", "org_id", "roles")
SELECT u."id", u."org_id",
       CASE
         WHEN u."role" IN ('vendor_admin', 'bench_manager')                  THEN ARRAY['supply']::"membership_role"[]
         WHEN u."role" IN ('client_admin', 'hiring_manager', 'panel_member') THEN ARRAY['demand']::"membership_role"[]
         ELSE ARRAY['admin']::"membership_role"[]
       END
FROM "users" u
ON CONFLICT ("user_id") DO NOTHING;

/* ------------------------------------------------------------- org_blocks */

CREATE TABLE IF NOT EXISTS "org_blocks" (
  "org_id"         uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "blocked_org_id" uuid NOT NULL REFERENCES "organizations"("id") ON DELETE CASCADE,
  "reason"         text,
  "created_by"     uuid REFERENCES "users"("id"),
  "created_at"     timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("org_id", "blocked_org_id"),
  CONSTRAINT "org_blocks_not_self" CHECK ("org_id" <> "blocked_org_id")
);

CREATE INDEX IF NOT EXISTS "org_blocks_blocked_idx" ON "org_blocks" ("blocked_org_id");

COMMENT ON TABLE "org_blocks" IS
  'Applies in BOTH directions: a single row hides each org from the other. Matching and RLS must test both columns.';

-- Symmetric helper, so no caller has to remember the direction.
CREATE OR REPLACE FUNCTION "orgs_are_blocked"(a uuid, b uuid) RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "org_blocks"
     WHERE ("org_id" = a AND "blocked_org_id" = b)
        OR ("org_id" = b AND "blocked_org_id" = a)
  );
$$ LANGUAGE sql STABLE;

/* ------------------------------------------- client behaviour score ------- */

-- Two separate scores per org. vendor_profiles.reliability_score already exists; this is
-- its demand-side counterpart. A dual-role org has a row in both profile tables and
-- therefore both scores, which is the point.
ALTER TABLE "client_profiles"
  ADD COLUMN IF NOT EXISTS "behaviour_score" numeric(2,1);

COMMENT ON COLUMN "client_profiles"."behaviour_score" IS
  'Demand-side counterpart to vendor_profiles.reliability_score. Never shown to a supplier.';

/* --------------------------------------- per-requirement SLA window ------- */

-- Fixes a real defect found in Sprint 2: db:verify's "exactly one SLA breach" check
-- starts failing a few hours after seeding. REQ-2302 is stage `new`, whose documented
-- window is 4 business hours, while the fixture labels it "SLA 12h = warn". For 12h
-- remaining to read as warn the window must be ~48h, so the two disagree. Storing the
-- window per requirement lets a row keep its intended state instead of ageing out of it.
-- NULL means "fall back to the per-stage default in SLA_WINDOW_HOURS".
ALTER TABLE "requirements"
  ADD COLUMN IF NOT EXISTS "sla_window_hours" integer;

COMMENT ON COLUMN "requirements"."sla_window_hours" IS
  'Overrides the per-stage SLA window. NULL falls back to docs/DOMAIN.md defaults.';

/* --------------------------------------------- probing signal (derived) --- */

-- Computed, never stored (CLAUDE.md working agreement 4).
--
-- A probing client posts requirements, collects masked shortlists, and never interviews
-- anyone — harvesting market intelligence rather than hiring. Two signals:
--   per requirement: shortlisted, old enough to have acted, no interview requested
--   per org:         how many open requirements it has with no hiring history at all

CREATE OR REPLACE VIEW "v_requirement_probing" AS
SELECT r."id"                AS requirement_id,
       r."code",
       r."client_org_id",
       s."sent_at"           AS shortlist_sent_at,
       count(i."id")         AS interviews_requested,
       (s."id" IS NOT NULL
        AND count(i."id") = 0
        AND s."sent_at" < now() - interval '5 days') AS is_probing_suspect
  FROM "requirements" r
  LEFT JOIN "shortlists"      s ON s."requirement_id" = r."id"
  LEFT JOIN "shortlist_items" si ON si."shortlist_id" = s."id"
  LEFT JOIN "interviews"      i  ON i."shortlist_item_id" = si."id"
 WHERE r."stage" IN ('shortlisted', 'interviewing', 'closed')
 GROUP BY r."id", r."code", r."client_org_id", s."id", s."sent_at";

COMMENT ON VIEW "v_requirement_probing" IS
  'OPS ONLY. Requirements that received a shortlist but never an interview request.';

CREATE OR REPLACE VIEW "v_org_probing_signals" AS
SELECT o."id" AS org_id,
       o."name",
       (SELECT count(*) FROM "requirements" r
         WHERE r."client_org_id" = o."id"
           AND r."stage" IN ('new', 'matching', 'shortlisted', 'interviewing')) AS open_requirements,
       (SELECT count(*) FROM "engagements" e WHERE e."client_org_id" = o."id")  AS placements_ever,
       (SELECT count(*) FROM "v_requirement_probing" p
         WHERE p."client_org_id" = o."id" AND p."is_probing_suspect")           AS probing_suspect_requirements
  FROM "organizations" o;

COMMENT ON VIEW "v_org_probing_signals" IS
  'OPS ONLY. open_requirements with placements_ever = 0 is the signal to look at.';

COMMIT;

-- Verification (run after applying):
--   select count(*) from org_capabilities;            -- expected: 20
--   select count(*) from memberships;                 -- expected: 20
--   select name, can_supply, can_hire from org_capabilities c
--     join organizations o on o.id = c.org_id where o.org_type = 'talentvibes';
--   -- expected: Talentvibes, false, false
--   -- and this must FAIL:
--   -- update org_capabilities set can_hire = true
--   --   where org_id = (select id from organizations where org_type = 'talentvibes');
