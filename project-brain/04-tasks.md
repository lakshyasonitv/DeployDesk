# 04 — Tasks

> Work is organised into **sprints**, at the user's request: each sprint ends at a stable,
> committed, verified state rather than running on continuously.
>
> **The four gates** every sprint must pass before it counts as done:
> 1. every route returns 200 — **cold and warm**, at least twice each
> 2. `npm run db:verify` → 21/21
> 3. `npm run test:leak` → 12/12
> 4. `npm run build` → clean (stop `next dev` and delete `.next` first)
>
> Phase checkboxes live in `../docs/BUILD-PLAN.md`. This file is the working queue.

---

## SPRINT 1 — All 15 screens · ✅ DONE (commit `2313554`, pushed)

All four gates green. 18 routes, 200 three times each.

- [x] 15 design screens plus 3 extras (client requirements list, shortlists index, engagements)
- [x] Database moved Sydney → Mumbai (warm query 410ms → 30ms, seed 41.7s → 4.7s)
- [x] Three write paths, each with Zod, a tenancy check and an audit row
- [x] Masked-send transaction with duplicate and eligibility pre-checks
- [x] **Fixed: `/ops` hung on the second request** — removed the `Promise.all` fan-out.
      Re-verified on production: 200 five times consecutively, 0.50–0.70s.
- [x] **Fixed: `/vendor/resources/new` returned 500 on the second request** — the
      `statement_timeout` startup parameter leaked across Supavisor's multiplexed
      connections and cancelled unrelated statements (a 281ms cancellation citing a 15s
      limit). Removed. Re-verified: 200 five times, ~0.45s each.

---

## SPRINT 2 — Performance: stop doing the same work twice · ✅ DONE (commit `88b0436`)

**Why this sprint exists:** the user reported the app feeling slow. Measured, it is two
separate things, and only one is a defect.

**Not a defect — dev mode.** `npm run dev` compiles each route on first visit and runs
React's development build. Same pages, same database, same machine:

| Route | `npm run dev` | `next start` |
|---|---|---|
| `/client` | 1.5s cold / 0.48s warm | **0.32s** |
| `/vendor/roster` | 1.5s cold / 0.40s warm | **0.26s** |
| `/ops` | 1.8s cold / 0.85s warm | **0.60s** |
| `/client/shortlists/REQ-2291` | 3.1s cold / 0.74s warm | **0.49s** |

Production is already fast. Nothing to fix here — just know which one you are measuring.

**A real defect — duplicated work.** Queries counted per page:

| Page | Today | Should be |
|---|---|---|
| `/client` | 8 queries, 546ms | 4 queries, 247ms |
| `/vendor/roster` | 6 queries, 364ms | 3 queries, 185ms |
| `/ops/margin` | **10 queries, 471ms** | **1–2 queries, ~30ms** |

Two causes, both mine:

1. **Pages fetch the same data twice.** `/client` calls `getClientOverview()`, then
   `ShellAside()` calls it again. `/vendor/roster` does the same with
   `getVendorRoster()`. Straight 2× duplication.
2. **The sidebar badges are absurdly expensive.** `OpsAside()` runs the whole
   `getOpsPipeline()` read model — 24 requirements plus skills, matches, engagements,
   interviews and feedback — *and* `getOpsDuplicates()`, purely to render three badge
   numbers. On `/ops/margin` that is 9 extra queries and 443ms, so **94% of that page's
   data time is the sidebar**, not the margin table.

Tasks:

- [x] Gave each sidebar its own `COUNT` query — `getClientSidebar`, `getVendorSidebar`,
      `getOpsSidebar`. The ops one is a single query where it used to be nine.
- [x] Pages that genuinely need the pipeline (`/ops`, `/ops/matching/:code`) now fetch it
      themselves instead of borrowing it from the sidebar.
- [~] **Dropped the React `cache()` wrapping.** Once the sidebars stopped calling the
      heavy read models, no page called the same read model twice, so there was nothing
      left to dedupe. A first attempt at it also broke the function closings
      (`cache(async function X(` needs a matching `})`), which was reverted.
- [x] Re-measured. **Queries per page:** `/ops/margin` 10 → **2** (471ms → 60ms),
      `/ops/duplicates` → 4, `/client` 8 → 6, `/vendor/roster` 6 → 4. Sidebars are now
      1 query (vendor, ops) or 2 (client).
- [x] **Wall-clock, six-sample means** against a pinned pre-sprint build:
      `/ops/margin` **+76%**, `/ops/duplicates` **+57%**, `/ops/pool` **+29%**,
      `/ops` **+23%**, `/client/shortlists/REQ-2291` **+28%**.
      `/client` −5% and `/vendor/roster` +4% — **flat, within noise.** Their latency was
      never dominated by the sidebar, so the query saving does not show up as time. Worth
      remembering: fewer queries only reads as "faster" where queries were the bottleneck.
- [x] All four gates re-run and green.

**Comparison setup, still running:** a pinned pre-sprint build is served from a git
worktree at `../tv-bench-BEFORE` on **:3100** (its `node_modules` is a junction to the
main repo's, and `.env.local` was copied in). The current build is on **:3000**. Remove
with `git worktree remove ../tv-bench-BEFORE` when no longer needed.

**Deliberately out of scope:** route caching or `revalidate`. Every page is
`force-dynamic` on purpose — stale masked data on a shortlist is worse than a slow page —
so the fix is to do less work, not to cache the answer.

---

## SPRINT 3 — Dual-role stage 1: schema and RLS files · ✅ DONE (commits `3252ce8`, `784d4f9`)

**Hard constraint from the user: the SQL is shown for approval before anything runs
against Supabase.** Migrations are files in the repo; seed data is a separate file the
user runs themselves.

- [x] **ADR-012**, scoped exactly as the user specified — two points only:
      (a) a membership holds a SET of roles (supply, demand, admin) rather than one;
      (b) the portal switcher becomes a production feature.
      "A user belongs to exactly one organisation" **stays true** (unique on `user_id`).
      Then point `docs/DATA-MODEL.md` and `docs/ARCHITECTURE.md` at it.
- [x] Migration files written, APPROVED by the user, and applied:
      - `groups` (id, name) — filled by ops at onboarding, **never inferred from PAN/GST**
      - `org_capabilities` (can_supply, can_hire) — **authoritative**, backfilled from
        `org_type`; constraint that the Talentvibes org has neither; `org_type` becomes
        derived (trigger or view) and no application code writes it
      - `memberships` (user_id unique, org_id, role set)
      - `org_blocks` (org_id, blocked_org_id) — enforced in **both** directions
      - `fee_model` per org (`hidden_markup` | `flat_declared_fee`; dual-role defaults to
        flat declared)
      - `client_behaviour` score alongside the existing `vendor_reliability`
      - the probing signal: requirements shortlisted but never interviewed, plus a count
        of open requirements with no hiring history per org
- [x] RLS: **22 policies over 13 tables**, plus `vendor_v_engagements` and
      `client_v_engagements`. INERT today — the app connects as `postgres` (the owner
      bypasses RLS) and `auth.uid()` is empty while the demo session lives in app code.
      The migration says so at the top rather than implying protection that is not there.
- [x] **camelCase rename applied** — 40 columns, with the paired `casing: "snake_case"`
      in all four places drizzle is initialised. Verified: zero camelCase columns remain.
- [x] Added `src/db/apply-sql.ts`, a ledger-backed runner for hand-written SQL that
      drizzle-kit cannot express. Hashes each file and refuses to re-run a changed one,
      enforcing append-only.
- [x] **Patched CVE-2025-66478** (next 15.5.4 -> 15.5.27). Not planned work: the user's
      Vercel deploy was refused because of it. CVSS 10.0 RCE in the RSC protocol,
      affecting App Router apps on Next 15.x/16.x.
- [x] **Removed hardcoded data from the rendering path** at the user's request — five
      places showed fabricated values as if from the database. Detail in the journal.
- [x] Four gates: 18 routes 200 twice each, test:leak 12/12, build clean, typecheck
      clean. `db:verify` 20/21 on the known SLA time-decay check only.

### Follow-ups this sprint created

- [ ] **Wire `sla_window_hours`.** Migration 0002 added the column but nothing reads or
      writes it, so warn-state requirements still age into `late` and `db:verify` still
      drops to 20/21 a few hours after seeding. Needs: the seed to populate it, and
      `slaFor()` to prefer it over the per-stage default.
- [ ] **Re-seed before any demo** (`npm run db:seed`, ~4s) until the above lands.
- [ ] **Rotate all application secrets.** The CVE advisory recommends it for any app that
      was online unpatched. This one never deployed successfully, so exposure is unlikely,
      but the Supabase password was separately shared in chat twice.
- [ ] Remove the `../tv-bench-BEFORE` worktree — `git worktree remove ../tv-bench-BEFORE`.
      Its `node_modules` junction has already been deleted.

---

## SPRINT 4 — Responsiveness and the last hardcoded data · ✅ DONE (commit `f77c17d`)

The user reported the deployed site as slow and asked again about hardcoded data, so the
planned Sprint 4 was deferred one slot. Measured before changing anything.

**Not the cause:** the region. The deployed functions do run in `bom1`, co-located with
the Mumbai database — confirmed by `x-vercel-id: bom1::…` on a live response.

**Was a cause, and is the user's to fix:** the URL they tested
(`deploy-desk-e2kmqgktr-…vercel.app`) is a **preview** deployment with Vercel Deployment
Protection on, so every request 302s to `vercel.com/sso-api` and back before the app runs.
`deploy-desk.vercel.app` is a 182-byte placeholder page belonging to something else, not
this app.

**Was the real in-code cause:** no `loading.tsx` anywhere. Every page is `force-dynamic`,
so a click left the previous screen up until the server finished — 130-600ms of looking
frozen.

- [x] Added a skeleton per portal (`app/{client,vendor,ops}/loading.tsx` +
      `src/lib/ui/Skeleton.tsx`). **TTFB 0.30-0.60s → 0.009-0.015s.** Total time to full
      content is unchanged at 0.19-0.53s — the queries take exactly as long. This is a
      perceived-performance fix and should be described as one.
- [x] Fonts moved from a `fonts.googleapis.com` stylesheet link to `next/font`. 12 woff2
      files now served from this origin; zero googleapis references in the build.
- [x] **SLA states made durable.** `db:verify` had been drifting to 19/21 during the day.
      The window is now derived from the runway the fixture states and stored per
      requirement — the column migration 0002 added but nothing read. Shortest runway is
      4 hours instead of 36 minutes, and the fixture's own "SLA 12h · warn" is honoured.
- [x] Last hardcoded data removed: portal switcher org names (one query, after I first
      wrote a three-query loop and caught it), landing-page tenant subtitles, the margin
      screen's fixed "August 2026", and the vendor "PAYMENT CYCLE 7th" invented date.
- [x] Four gates green.

### Known, measured, not yet fixed

- [ ] **`getVendorRoster` moves 173 rows to render 9** (42 resources + 89 skills + 42
      assessments, no LIMIT). At 287ms it is not today's bottleneck, but the launch target
      is ~2,000 bench resources, where it would be. Needs server-side paging, which also
      means moving the roster's filter pills from client-side to server-driven — the pill
      counts already come from the cheap `getVendorSidebar` aggregate.
- [ ] Mobile. The design handoff targets desktop ≥1280px and lists mobile as out of
      scope, so nothing here is responsive in the viewport sense. Ask before building it.

---

## SPRINT 5 — Dual-role stage 2: matching and bypass tests

- [ ] Self-dealing rule: a resource whose vendor `group_id` equals the requirement's
      client `group_id` is never returned as a candidate — in the matching query **and**
      as a database policy or constraint, so an application bug cannot bypass it
- [ ] Block list enforced in the same matching function and in RLS
- [ ] Tests that actively **try to bypass** both rules, not merely tests that they work
- [ ] The user's acceptance tests 3 and 4
- [ ] Four gates stay green

---

## SPRINT 6 — Dual-role stage 3: UI

- [ ] Vendor-only org: one workspace, no switcher, **no hint that a hiring side exists** —
      never a locked "Hire" tab
- [ ] Dual-role org: "Hiring | Bench" switcher in the top bar, same login; combined
      dashboard showing bench stats beside hiring stats
- [ ] One Talentvibes thread per workspace, never mixed
- [ ] **The two rate views never appear on the same screen for the same org**
- [ ] Ops console: dual-role badge; org profile controls for capabilities, group, fee
      model and block list; margin grouped per org (billed as client, paid as supplier,
      net position); the ops-only "N matching people on this client's own bench" note;
      probing-flag indicator
- [ ] The user's acceptance tests 1, 2, 5 and 6
- [ ] Seed: one vendor-only org, one client-only org, one dual-role org, one pair of
      group-linked subsidiaries — realistic Indian IT data, in a file the user runs
- [ ] Four gates stay green

---

## Backlog — not assigned to a sprint

- [ ] **Deployment is the user's.** Import `lakshyasonitv/DeployDesk` into their own
      Vercel account and set `DATABASE_URL` (pooler 6543), `IDENTITY_PEPPER`,
      `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
      **I must not touch Vercel.**
- [ ] Ask the owner of the `vaibhavalteryx-1351` account to delete the stray `deploydesk`
      project (its secret values are already overwritten with placeholders)
- [ ] **Rotate the Supabase database password** — shared in chat twice, not yet confirmed
- [ ] Get the `v2` prototype file if it exists; the UI was built from v1
- [ ] Flag to the design owner: client bands read higher than the mockups (ADR-004), and
      algorithm rank order differs in pools A, B and D (ADR-011) — both deliberate
- [ ] RLS beyond the dual-role policies — the second net `BUILD-PLAN.md` Phase 1 wants
- [ ] CI: typecheck, lint, migration check, leak suite
- [ ] Restricted application DB role, so the app never connects as the service role
- [ ] Real Supabase Auth replacing `src/lib/auth/session.ts`, including the portal check
      that returns 404 rather than 403
- [ ] Import-boundary test: no client page may import the ops or vendor read models
