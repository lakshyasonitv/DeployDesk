-- 0007_margin_policy.sql
--
-- The target and floor margin, as data rather than two constants in TypeScript.
--
-- WHY
--
--   The owner asked for Talentvibes to be able to change the margin: "there should be a
--   setting to change the margin but [only] the people of talentvibes". Today the target
--   (22%) and floor (18%) live in src/lib/money/rate-band.ts, so changing either means a
--   code change and a deploy.
--
--   Note that until an hour before this migration was written there were TWO definitions of
--   them -- 22/18 as percentages in rate-band.ts and 0.22/0.18 as fractions in
--   matching/score.ts -- which is why this table is being added only now. A configurable
--   setting is impossible while the thing it configures has two sources; score.ts now
--   derives its fractions from the percent definition, and this table replaces that one
--   definition.
--
-- ONE ROW, ENFORCED BY THE SCHEMA
--
--   `id boolean primary key default true check (id)` permits exactly one row: the primary
--   key allows one `true`, and the check forbids `false`. A settings table that can hold two
--   rows will eventually hold two rows, and then the product has two margins again.
--
-- WHAT CHANGING THESE DOES, AND DOES NOT DO
--
--   The TARGET only affects FUTURE pricing. `matches.proposed_client_rate_paise` is stored,
--   so raising the target does not re-price anything already proposed, and
--   `shortlist_items` bands are frozen at send time (ADR-004) so nothing a client has been
--   quoted can move.
--
--   The FLOOR is different and the difference matters: "below floor" is DERIVED on read
--   (docs/DOMAIN.md lists margin as never stored), so lowering the floor would make past
--   exceptions silently become compliant, and the Margin page's amber card would empty out
--   without anything having been fixed. Every change therefore writes an audit row, and the
--   floor is constrained to be no greater than the target.
--
-- NOT A PER-CLIENT SETTING
--
--   One policy for the exchange. A per-client margin is a different product decision -- it
--   would mean the same supplier's engineer earning us different margins at different
--   clients by policy rather than by negotiation -- and it is not what was asked for.
--
-- The `down` is at the bottom.

create table if not exists margin_policy (
  -- Exactly one row. See the header.
  id          boolean primary key default true,

  -- Percentages, matching MARGIN_TARGET_PCT / MARGIN_FLOOR_PCT rather than the fractions.
  -- One decimal place is enough: nobody sets a target of 22.25%.
  target_pct  numeric(4,1) not null default 22.0,
  floor_pct   numeric(4,1) not null default 18.0,

  -- Who last changed it. Null for the seeded default, which nobody set.
  updated_by  uuid references users(id),
  updated_at  timestamptz not null default now(),
  created_at  timestamptz not null default now(),

  constraint margin_policy_single_row check (id),

  -- A floor above the target would mean every on-target placement is a breach.
  constraint margin_policy_floor_not_above_target check (floor_pct <= target_pct),
  constraint margin_policy_target_sane check (target_pct > 0 and target_pct < 100),
  constraint margin_policy_floor_sane  check (floor_pct  > 0 and floor_pct  < 100)
);

-- The current values, so the table is never empty and a reader never has to wonder whether
-- "no row" means 0% or means the defaults.
insert into margin_policy (id, target_pct, floor_pct)
values (true, 22.0, 18.0)
on conflict (id) do nothing;

comment on table margin_policy is
  'Exchange-wide target and floor margin, in percent. Exactly one row. Changing the target '
  'affects future pricing only; changing the floor re-derives which past placements count as '
  'exceptions, so every change writes an audit row.';

-- ---------------------------------------------------------------------------
-- down
-- ---------------------------------------------------------------------------
--
-- drop table if exists margin_policy;
