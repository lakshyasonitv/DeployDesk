-- 0004_self_dealing_and_blocks.sql
--
-- Enforces the self-dealing rule and the block list IN THE DATABASE.
--
-- Depends on 0002 (groups, org_capabilities, org_blocks, orgs_are_blocked).
--
-- WHY THIS EXISTS even though the matching query already filters:
--
-- The brief is explicit — "implement it in the matching query/function AND as a database
-- policy or constraint so an app bug cannot bypass it". The application predicate lives
-- in src/services/matching-eligibility.ts and is applied by the seed and the ops read
-- model. This file is the backstop for the case where someone writes a new code path and
-- forgets it. There are tests that try to insert a forbidden row directly and assert
-- that the database refuses.
--
-- WHY A TRIGGER AND NOT A CHECK CONSTRAINT:
--
-- The rule spans four tables — matches -> requirements -> organizations (client side) and
-- matches -> bench_resources -> organizations (supplier side). A CHECK constraint can only
-- see columns of its own row, so it cannot express this. A trigger can, and it RAISES
-- rather than silently dropping the row, so a violation is loud.
--
-- WHAT THIS DELIBERATELY DOES NOT DO:
--
-- It does not touch `shortlist_items`. By the time a row exists there, the candidate has
-- already passed through `matches`, which is gated here. Adding a second trigger on the
-- snapshot would duplicate the rule without adding a guarantee.

BEGIN;

/* ----------------------------------------------- the rule, as one function */

/**
 * TRUE when offering this resource to this requirement would be self-dealing: the same
 * organisation, or two organisations in the same DECLARED group.
 *
 * A NULL group means "not in a declared group" and therefore unrelated — two orgs with no
 * group are not the same group. Written out because `null = null` is NULL in SQL, not
 * true, and relying on that silently would be a trap for the next reader.
 */
CREATE OR REPLACE FUNCTION "is_self_dealing"(p_resource_id uuid, p_requirement_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM "bench_resources" b
      JOIN "organizations"   vo ON vo."id" = b."vendor_org_id"
      JOIN "requirements"    r  ON r."id"  = p_requirement_id
      JOIN "organizations"   co ON co."id" = r."client_org_id"
     WHERE b."id" = p_resource_id
       AND (
            vo."id" = co."id"
         OR (vo."parent_group_id" IS NOT NULL
             AND co."parent_group_id" IS NOT NULL
             AND vo."parent_group_id" = co."parent_group_id")
       )
  );
$$ LANGUAGE sql STABLE;

COMMENT ON FUNCTION "is_self_dealing"(uuid, uuid) IS
  'TRUE when a resource and a requirement belong to the same organisation or the same declared group.';

/** TRUE when the supplier and the client of this requirement have blocked each other. */
CREATE OR REPLACE FUNCTION "match_is_blocked"(p_resource_id uuid, p_requirement_id uuid)
RETURNS boolean AS $$
  SELECT EXISTS (
    SELECT 1
      FROM "bench_resources" b
      JOIN "requirements" r ON r."id" = p_requirement_id
     WHERE b."id" = p_resource_id
       AND "orgs_are_blocked"(b."vendor_org_id", r."client_org_id")
  );
$$ LANGUAGE sql STABLE;

/* --------------------------------------------- the backstop on matches ---- */

CREATE OR REPLACE FUNCTION "enforce_match_eligibility"() RETURNS trigger AS $$
BEGIN
  IF "is_self_dealing"(NEW."resource_id", NEW."requirement_id") THEN
    RAISE EXCEPTION
      'self-dealing refused: resource % and requirement % belong to the same organisation or declared group',
      NEW."resource_id", NEW."requirement_id"
      USING ERRCODE = 'check_violation',
            HINT = 'Filter candidates with mayBeOfferedTo() before inserting a match.';
  END IF;

  IF "match_is_blocked"(NEW."resource_id", NEW."requirement_id") THEN
    RAISE EXCEPTION
      'blocked pairing refused: the supplier of resource % and the client of requirement % have blocked each other',
      NEW."resource_id", NEW."requirement_id"
      USING ERRCODE = 'check_violation',
            HINT = 'Blocks apply in both directions; use orgs_are_blocked(a, b).';
  END IF;

  RETURN NEW;
END $$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS "matches_eligibility" ON "matches";
CREATE TRIGGER "matches_eligibility"
  BEFORE INSERT OR UPDATE OF "resource_id", "requirement_id" ON "matches"
  FOR EACH ROW EXECUTE FUNCTION "enforce_match_eligibility"();

/* ------------------------------------- blocks in RLS on the read paths ---- */

-- A client reads candidates only through shortlist_items. Narrow that policy so a
-- blocked supplier's profiles are invisible even if one reached a snapshot before the
-- block was created. Replaces the policy from 0003 rather than adding a second one:
-- RLS policies are OR-ed, so an extra permissive policy would widen access, not narrow it.
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
    -- neither self-dealing nor blocked, re-checked at read time
    AND NOT EXISTS (
      SELECT 1 FROM "shortlists" sl2
       WHERE sl2."id" = "shortlist_items"."shortlist_id"
         AND ("is_self_dealing"("shortlist_items"."resource_id", sl2."requirement_id")
              OR "match_is_blocked"("shortlist_items"."resource_id", sl2."requirement_id"))
    )
  );

-- A supplier sees requirements through no policy at all (0003 grants none), so there is
-- nothing to narrow on that side: a blocked client's requirements were already invisible.

/* ------------------------------- ops-only view: the client's own bench ---- */

-- The brief asks the matching workspace to show "N matching people on this client's own
-- bench", to OPS ONLY. This is the count behind that note. It exists as a view so the
-- rule stays in one place, and it is ops-only because telling a client its own group
-- could have filled the role is a commercial conversation for a broker to have, while
-- telling a SUPPLIER anything about a client is a masking breach.
CREATE OR REPLACE VIEW "ops_v_own_bench_matches" AS
SELECT r."id"   AS requirement_id,
       r."code" AS requirement_code,
       count(b."id") AS own_bench_matches
  FROM "requirements" r
  JOIN "organizations" co ON co."id" = r."client_org_id"
  LEFT JOIN "bench_resources" b
    ON b."status" IN ('listed', 'in_process')
   AND (
        b."vendor_org_id" = co."id"
     OR EXISTS (
          SELECT 1 FROM "organizations" vo
           WHERE vo."id" = b."vendor_org_id"
             AND vo."parent_group_id" IS NOT NULL
             AND co."parent_group_id" IS NOT NULL
             AND vo."parent_group_id" = co."parent_group_id"
        )
   )
 GROUP BY r."id", r."code";

COMMENT ON VIEW "ops_v_own_bench_matches" IS
  'OPS ONLY. How many listed people on the client''s own organisation or group could fill its requirement.';

COMMIT;

-- Verification (run after applying):
--
--   -- the function agrees with the seeded group
--   select is_self_dealing(
--     (select id from bench_resources b join organizations o on o.id=b.vendor_org_id
--       where o.name='Helix Systems' limit 1),
--     (select id from requirements r join organizations o on o.id=r.client_org_id
--       where o.name='Vantage Insurance' limit 1));
--   -- expected: true  (same declared group)
--
--   -- and the trigger refuses it
--   insert into matches (requirement_id, resource_id, algo_score, score_skill, score_test,
--     score_exp_fit, score_rate, score_freshness, score_vendor, algo_rank, computed_at)
--   select r.id, b.id, 90, 90, 90, 90, 90, 90, 90, 1, now()
--     from requirements r join organizations co on co.id=r.client_org_id,
--          bench_resources b join organizations vo on vo.id=b.vendor_org_id
--    where co.name='Vantage Insurance' and vo.name='Helix Systems' limit 1;
--   -- expected: ERROR  self-dealing refused
