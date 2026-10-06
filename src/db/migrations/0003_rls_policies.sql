-- 0003_rls_policies.sql
--
-- Row Level Security: the SECOND net. Depends on 0001 and 0002.
--
-- ===========================================================================
-- READ THIS BEFORE BELIEVING THESE POLICIES PROTECT ANYTHING TODAY
-- ===========================================================================
--
-- These policies are INERT until two other things are true:
--
--   1. The application connects as a RESTRICTED role, not as `postgres`. The table owner
--      and superusers BYPASS RLS entirely. Right now DATABASE_URL connects as `postgres`,
--      so every policy below is skipped. docs/BUILD-PLAN.md Phase 0 lists the restricted
--      role; it is not built yet.
--   2. Real Supabase Auth is wired, so `auth.uid()` returns the caller. Today
--      src/lib/auth/session.ts resolves a demo session in application code, and the
--      database has no idea who is asking.
--
-- Applying this migration therefore changes NOTHING about the running app — it will not
-- break it and will not secure it. It is written now, with the dual-role schema, because
-- the policies and the schema have to agree, and because writing them later invites
-- writing them to match whatever the app happens to do by then.
--
-- The FIRST net is the portal-specific read models (ADR-003), which are real today and
-- covered by 12 passing leak tests. RLS exists to catch a service that forgets a
-- WHERE org_id clause — not to be the only thing standing between a client and a
-- supplier's name.
--
-- ===========================================================================

BEGIN;

/* ------------------------------------------------- who is asking? --------- */

-- Resolves the caller's organisation from their membership. SECURITY DEFINER so the
-- lookup itself is not subject to the policies it feeds.
CREATE OR REPLACE FUNCTION "current_org_id"() RETURNS uuid AS $$
  SELECT m."org_id" FROM "memberships" m WHERE m."user_id" = auth.uid();
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth;

CREATE OR REPLACE FUNCTION "current_org_is_broker"() RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "memberships" m
      JOIN "organizations" o ON o."id" = m."org_id"
     WHERE m."user_id" = auth.uid() AND o."org_type" = 'talentvibes'
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth;

CREATE OR REPLACE FUNCTION "current_user_has_role"(r "membership_role") RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1 FROM "memberships" m
     WHERE m."user_id" = auth.uid() AND r = ANY (m."roles")
  );
$$ LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, auth;

/* ----------------------------------------------- bench_resources ---------- */
-- The most sensitive table in the system. A supplier sees its own rows. A client sees
-- NONE of them — a client's only view of a candidate is shortlist_items, which has no
-- name and no vendor column at all (ADR-009). Ops sees everything.

ALTER TABLE "bench_resources" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "bench_resources_broker_all" ON "bench_resources";
CREATE POLICY "bench_resources_broker_all" ON "bench_resources"
  FOR ALL USING ("current_org_is_broker"());

DROP POLICY IF EXISTS "bench_resources_own_vendor" ON "bench_resources";
CREATE POLICY "bench_resources_own_vendor" ON "bench_resources"
  FOR ALL USING (
    "vendor_org_id" = "current_org_id"()
    AND "current_user_has_role"('supply')
  );

-- Note what is absent: there is no client policy on this table. That is the point.

/* ----------------------------------------------- shortlist_items ---------- */
-- The client-facing snapshot. A client sees items on its OWN requirements. A supplier
-- sees items for its own resources, so it can tell a profile is in a process — but the
-- requirement and client columns are not on this table to begin with.

ALTER TABLE "shortlist_items" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "shortlist_items_broker_all" ON "shortlist_items";
CREATE POLICY "shortlist_items_broker_all" ON "shortlist_items"
  FOR ALL USING ("current_org_is_broker"());

DROP POLICY IF EXISTS "shortlist_items_own_client" ON "shortlist_items";
CREATE POLICY "shortlist_items_own_client" ON "shortlist_items"
  FOR SELECT USING (
    "current_user_has_role"('demand')
    AND EXISTS (
      SELECT 1 FROM "shortlists" sl
        JOIN "requirements" r ON r."id" = sl."requirement_id"
       WHERE sl."id" = "shortlist_items"."shortlist_id"
         AND r."client_org_id" = "current_org_id"()
    )
  );

DROP POLICY IF EXISTS "shortlist_items_own_vendor" ON "shortlist_items";
CREATE POLICY "shortlist_items_own_vendor" ON "shortlist_items"
  FOR SELECT USING (
    "current_user_has_role"('supply')
    AND EXISTS (
      SELECT 1 FROM "bench_resources" b
       WHERE b."id" = "shortlist_items"."resource_id"
         AND b."vendor_org_id" = "current_org_id"()
    )
  );

/* ------------------------------------------------------ requirements ------ */
-- A client sees its own. A SUPPLIER SEES NONE: a requirement carries the client's budget
-- band and their internal note, both of which are client-only (docs/MASKING.md).

ALTER TABLE "requirements" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "requirements_broker_all" ON "requirements";
CREATE POLICY "requirements_broker_all" ON "requirements"
  FOR ALL USING ("current_org_is_broker"());

DROP POLICY IF EXISTS "requirements_own_client" ON "requirements";
CREATE POLICY "requirements_own_client" ON "requirements"
  FOR ALL USING (
    "client_org_id" = "current_org_id"()
    AND "current_user_has_role"('demand')
  );

/* ----------------------------------------------------------- matches ------ */
-- Ops only, absolutely. matches carries algo_score and proposed_client_rate_paise; the
-- latter with a vendor rate is the margin.

ALTER TABLE "matches" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "matches_broker_only" ON "matches";
CREATE POLICY "matches_broker_only" ON "matches"
  FOR ALL USING ("current_org_is_broker"());

/* ------------------------------------------------------- engagements ------ */
-- One row holds BOTH rates, so neither side may read the row directly. Column-level
-- masking is not expressible in RLS; the portal read models select the permitted column
-- and these policies stop either side reaching the row at all. A dual-role org can match
-- on both sides, which is exactly why the role check is on the clause that grants it.

ALTER TABLE "engagements" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "engagements_broker_only" ON "engagements";
CREATE POLICY "engagements_broker_only" ON "engagements"
  FOR ALL USING ("current_org_is_broker"());

-- Participants read engagements through the portal views below, never the table.

CREATE OR REPLACE VIEW "vendor_v_engagements" WITH (security_invoker = true) AS
SELECT e."id", e."resource_id", e."role_title", e."start_date", e."end_date", e."status",
       e."vendor_rate_paise",              -- own cost: permitted
       e."vendor_org_id"
  FROM "engagements" e
 WHERE e."vendor_org_id" = "current_org_id"();

COMMENT ON VIEW "vendor_v_engagements" IS
  'Supplier-facing. client_rate_paise and client_org_id are not selected, so no spread is reconstructible.';

CREATE OR REPLACE VIEW "client_v_engagements" WITH (security_invoker = true) AS
SELECT e."id", e."resource_id", e."role_title", e."start_date", e."end_date", e."status",
       e."client_rate_paise",              -- own price: permitted
       e."client_org_id"
  FROM "engagements" e
 WHERE e."client_org_id" = "current_org_id"();

COMMENT ON VIEW "client_v_engagements" IS
  'Client-facing. vendor_rate_paise and vendor_org_id are not selected.';

/* ---------------------------------------------------------- invoices ------ */
-- Receivable and payable are separate rows and are never netted. An org sees its own
-- rows; crucially, a DUAL-ROLE org sees both its receivables and its payables, which is
-- correct — they are its own invoices — but they must never be joined into a net figure
-- in a response. That is a read-model rule, enforced by the leak suite.

ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "invoices_broker_all" ON "invoices";
CREATE POLICY "invoices_broker_all" ON "invoices"
  FOR ALL USING ("current_org_is_broker"());

DROP POLICY IF EXISTS "invoices_own_org" ON "invoices";
CREATE POLICY "invoices_own_org" ON "invoices"
  FOR SELECT USING ("counterparty_org_id" = "current_org_id"());

/* ------------------------------------------- broker threads and messages -- */
-- Two threads, never one (ADR-008). A participant sees only the thread addressed to it;
-- linked_thread_id is the counterpart and is ops-visible only.

ALTER TABLE "broker_threads"  ENABLE ROW LEVEL SECURITY;
ALTER TABLE "broker_messages" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "broker_threads_broker_all" ON "broker_threads";
CREATE POLICY "broker_threads_broker_all" ON "broker_threads"
  FOR ALL USING ("current_org_is_broker"());

DROP POLICY IF EXISTS "broker_threads_own_side" ON "broker_threads";
CREATE POLICY "broker_threads_own_side" ON "broker_threads"
  FOR SELECT USING ("counterparty_org_id" = "current_org_id"());

DROP POLICY IF EXISTS "broker_messages_broker_all" ON "broker_messages";
CREATE POLICY "broker_messages_broker_all" ON "broker_messages"
  FOR ALL USING ("current_org_is_broker"());

DROP POLICY IF EXISTS "broker_messages_own_thread" ON "broker_messages";
CREATE POLICY "broker_messages_own_thread" ON "broker_messages"
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM "broker_threads" t
       WHERE t."id" = "broker_messages"."thread_id"
         AND t."counterparty_org_id" = "current_org_id"()
    )
  );

/* -------------------------------------------- duplicate flags: ops only --- */
-- Neither the client nor the candidate is ever told a flag exists, and the losing
-- supplier is told only that the profile is already represented.

ALTER TABLE "duplicate_flags" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "duplicate_flags_broker_only" ON "duplicate_flags";
CREATE POLICY "duplicate_flags_broker_only" ON "duplicate_flags"
  FOR ALL USING ("current_org_is_broker"());

/* ------------------------------- capabilities and blocks: ops writes ------ */
-- Only ops may change what an org can do, or who it is blocked from. An org may READ its
-- own capabilities so the UI can decide which workspaces to show.

ALTER TABLE "org_capabilities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "org_blocks"       ENABLE ROW LEVEL SECURITY;
ALTER TABLE "groups"           ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "org_capabilities_broker_write" ON "org_capabilities";
CREATE POLICY "org_capabilities_broker_write" ON "org_capabilities"
  FOR ALL USING ("current_org_is_broker"());

DROP POLICY IF EXISTS "org_capabilities_read_own" ON "org_capabilities";
CREATE POLICY "org_capabilities_read_own" ON "org_capabilities"
  FOR SELECT USING ("org_id" = "current_org_id"());

DROP POLICY IF EXISTS "org_blocks_broker_only" ON "org_blocks";
CREATE POLICY "org_blocks_broker_only" ON "org_blocks"
  FOR ALL USING ("current_org_is_broker"());
-- An org is deliberately NOT allowed to read the block list: knowing you are blocked by
-- a specific company is itself information about that company.

DROP POLICY IF EXISTS "groups_broker_only" ON "groups";
CREATE POLICY "groups_broker_only" ON "groups"
  FOR ALL USING ("current_org_is_broker"());

/* ------------------------------------------------- audit log: append only - */

ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "audit_log_broker_read" ON "audit_log";
CREATE POLICY "audit_log_broker_read" ON "audit_log"
  FOR SELECT USING ("current_org_is_broker"());

DROP POLICY IF EXISTS "audit_log_insert_any" ON "audit_log";
CREATE POLICY "audit_log_insert_any" ON "audit_log"
  FOR INSERT WITH CHECK (true);
-- No UPDATE or DELETE policy exists, so neither is permitted for any non-owner role.
-- That is what "append-only" means here.

COMMIT;

-- Verification (run after applying, as a NON-owner role — as `postgres` everything
-- passes trivially because the owner bypasses RLS):
--
--   select tablename, rowsecurity from pg_tables
--    where schemaname = 'public' and rowsecurity
--    order by tablename;
--   -- expected: audit_log, bench_resources, broker_messages, broker_threads,
--   --           duplicate_flags, engagements, groups, invoices, matches,
--   --           org_blocks, org_capabilities, requirements, shortlist_items
--
--   select count(*) from pg_policies where schemaname = 'public';
--   -- expected: 22
