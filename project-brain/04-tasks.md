# 04 — Tasks

> Work is organised into **sprints**, at the user's request: each sprint ends at a stable,
> committed, verified state rather than running on continuously.
>
> **The four gates** every sprint must pass before it counts as done:
> 1. every route returns 200 — **cold and warm**, at least twice each
> 2. `npm run db:verify` → **30/30** (21 originally; +9 across the dual-role stages)
> 3. `npm test` → **88/88** — the WHOLE suite, not just `tests/leak`. `test:leak` runs only
>    `tests/leak`, so it misses `tests/business-clock.test.ts`; use `npm test` as the gate.
>
> These two numbers grow as suites are added. **If a gate number here disagrees with what
> the command prints, this line is the stale one** — check the newest journal entry, then
> fix it here. A stale gate number has already caused one wrong conclusion in this project.
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

- [x] **Wire `sla_window_hours`** — DONE in Sprint 4 (`f77c17d`). The schema declares it,
      the seed writes the window it chose, and both the ops read model and the verifier
      prefer it over the per-stage default. `db:verify` is back to 21/21.
- [~] **Re-seed before a demo.** The underlying defect is fixed, so this is now ordinary
      hygiene rather than a workaround. Measured: seeded SLA data stays correct for about
      **4 hours** (the shortest stated runway, REQ-2274's own "SLA 4h"), against 36
      minutes before. A requirement with four hours left *should* breach in four hours —
      that is correct behaviour, not decay. Re-seed (`npm run db:seed`, ~4s) if the data
      is more than a few hours old.
- [x] **Rotate the Supabase database password — STILL OUTSTANDING, and the user's to do.** ✅ 2026-10-06
      It was shared in chat twice. Verified NOT in the repo: `.env.local` is gitignored and
      `git grep` finds the password in no tracked file, so nothing leaked through GitHub.
      The CVE advisory also recommends rotating secrets for any app that was online
      unpatched; this one only ever deployed after the patch, so that path is unlikely.
      After rotating, `.env.local` needs the new connection strings and so do the Vercel
      env vars.
- [x] Removed the `../tv-bench-BEFORE` worktree and pruned it. Its `node_modules` junction
      was deleted earlier. Do not recreate a shared-junction worktree — see Gotchas.

---

## SPRINT 4 — Responsiveness and the last hardcoded data · ✅ DONE (commit `f77c17d`)

The user reported the deployed site as slow and asked again about hardcoded data, so the
planned Sprint 4 was deferred one slot. Measured before changing anything.

**Not the cause:** the region. The deployed functions do run in `bom1`, co-located with
the Mumbai database — confirmed by `x-vercel-id: bom1::…` on a live response.

**Was the dominant cause, now FIXED by the user:** the functions were executing in
`iad1` (Washington DC) while the database is in ap-south-1 (Mumbai) — `x-vercel-id` read
`bom1::iad1`, edge in Mumbai, function in Virginia. Every query paid a ~200ms
cross-continent round trip, and timings scaled with query count, not page complexity:
`/vendor/roster` at 3 queries took 0.37s while `/` at ~8 took 2.5-2.8s.

`preferredRegion = ["bom1"]` was in the deployed build and Vercel ignored it, which is
Hobby-plan behaviour: all functions run in the project's single configured region.
The user changed **Settings → Functions → Function Region** to Mumbai. Now `bom1::bom1`,
and measured live:

| Route | iad1 | bom1 |
|---|---|---|
| `/` | 2.5-2.8s | **0.19s** |
| `/ops/margin` | 0.59-1.16s | 0.16s steady |
| `/client` | 0.36-1.0s | 0.17-0.21s |
| `/vendor/roster` | 0.37-0.42s | 0.17-0.23s |

**Lesson worth keeping:** co-locate compute with the database, and verify it with
`x-vercel-id` rather than trusting the code-level `preferredRegion` export. Also note the
earlier red herring — the first URL tested was a *preview* deployment with Deployment
Protection on, which 302s to `vercel.com/sso-api` and back on every request.

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

- [x] **`getVendorRoster` moves 173 rows to render 9** — DONE, and this note was wrong
      about why. It blamed row volume and prescribed server-side paging plus moving the
      roster's filter pills server-side. Both were aimed at the wrong call site.
      - The roster PAGE legitimately renders all 42 cards, so 173 rows is proportionate
        there. Nothing to fix and the filter pills stay client-side.
      - The waste was `getVendorOverview`, which loaded the same 173 rows and shaped 42
        view objects to display **six integers**.
      - Fixed in two steps, each measured on `/vendor`: (1) a shared
        `getVendorRosterCounts()` aggregate replaced the roster load in both the dashboard
        and the sidebar — 481ms → 437ms, only **9%**; (2) the five independent reads in
        `getVendorOverview` now run in one `Promise.all` — 437ms → **144ms**, a 3.3×
        total speedup. All six rendered numbers byte-identical before and after.
      - **The lesson: latency here is round-trip count, not row count.** Six sequential
        queries to Mumbai at ~60–70ms each spent almost all their time waiting. Look for
        serial awaits before optimising row volume.
      - Server-side paging for the roster page itself remains open, but only at launch
        scale (~2,000 resources). It is a behaviour change to the pills, not a perf tweak.
- [x] **Re-introducing `Promise.all` is safe now** — read this before "fixing" it back.
      Sprint 1 records that removing a fan-out cured the `/ops` hang. The actual root cause
      was the pool at `max: 1` deadlocking against Supavisor's transaction mode. The pool
      is `max: 10` (`src/db/client.ts`) and two-way `Promise.all` already ships on ten
      pages. A five-way fan-out is well inside the pool.
- [ ] ~~Mobile~~ — **superseded by the v2 handoff.** v1 targeted desktop ≥1280px and put
      mobile out of scope. `design_handoff_bench_exchange_v2/README.md` rule 5 requires it
      to work **from about 900px up**: auto-fit stat grids, flex-wrap two-column pages,
      dense tables scrolling inside their card, pills and buttons never wrapping. This is
      now part of the v2 migration below, not a separate question to ask.

---

## SPRINT 5 — Self-dealing rule and block list · DONE (commit `c571083`)

Both rules are enforced TWICE — in the matching query and in the database — because the
brief requires that an application bug cannot bypass them.

- [x] **Self-dealing rule.** A resource is never offered to a requirement whose client is
      the same organisation, or in the same DECLARED group. Application side:
      `src/services/matching-eligibility.ts`, used by the seed and the ops read model.
      Database side: migration 0004 adds `is_self_dealing()`, `match_is_blocked()` and a
      `BEFORE INSERT OR UPDATE` trigger on `matches` that RAISES.
- [x] **Block list** enforced in the same two places, bidirectionally, via the symmetric
      `orgs_are_blocked(a, b)` helper from 0002.
- [x] **30 tests**, four of which attempt a forbidden insert directly: own bench, group
      sibling, blocked pairing, plus a CONTROL asserting a legitimate pairing still
      succeeds — without that control, a rule that refused everything would pass.
- [x] Acceptance tests 3 and 4 from the brief.
- [x] Ops-only "N matching people on this client's own bench" note, via
      `ops_v_own_bench_matches`. Reads 14 for Cygnet — excluded from its pool, visible to
      the broker, never to the client.
- [x] Four gates: 19 routes 200 twice each, `db:verify` **25/25**, `test:leak` **30/30**,
      build and typecheck clean.

### Ten edge scenarios checked by hand, beyond the suite

All pass. Worth keeping because several are the ones a future change could break:

| Scenario | Result |
|---|---|
| UPDATE a match INTO a violation (not just INSERT) | refused |
| Broker still holds neither capability after a reseed | holds |
| Giving the broker a capability | refused |
| One user, one organisation (ADR-012's kept half) | 0 violations |
| An org blocking itself | refused |
| Self-dealing/blocked rows anywhere in `matches` | 0 |
| Self-dealing/blocked rows anywhere in `shortlist_items` | 0 |
| **The exchange is not emptied by the rule** | 94 matches across 19 requirements |
| Dual-role org's own people in its own pool | 0 of 5 candidates |
| Ops can still see the own-bench count | 14, ops only |

### Bugs found while building this

1. **`org_capabilities` and `memberships` were EMPTY.** Migration 0002 backfilled them
   once and the next `db:seed` destroyed both: the seed truncates `organizations CASCADE`
   and they reference it `ON DELETE CASCADE`, but were absent from the seed's
   owned-tables list. **Any table the seed can cascade into has to be owned by it.**
2. **The client match preview counted the client's own group's bench.** A dual-role
   company would have seen its own people inflating "42 profiles match" — and learned
   that the exchange can see its bench. Now excluded in SQL alongside blocked suppliers.
3. **The dual-role requirement had no pool**, so "its own people are absent" passed
   trivially against an empty set. It now sources 5 eligible candidates with 14 of its
   own excluded, which is both a real demo scenario and a meaningful assertion.
4. **Two test-harness bugs that looked like product failures.** Drizzle wraps the driver
   error, so the trigger's text is on `err.cause`, not `err.message`; and `matches` has
   `UNIQUE (requirement_id, resource_id)`, so re-inserting a seeded pair hits that
   constraint instead of the rule. The control test is what exposed both — it failed,
   which proved the harness rather than the rule was wrong.

---

## SPRINT 6 — Dual-role stage 3: UI · **6a DONE** (commit `f100d0a`), 6b to go

### SPRINT 6a — the workspace layer · ✅ DONE (2026-10-07)

Gates: 20 routes ×2 plus 5 dual-role routes all 200, `db:verify` **27/27**, `test:leak`
**42/42** (was 30), build and typecheck clean.

- [x] **Fixed the guard that made the whole feature unreachable.** `getDemoSession()`
      asserted `org_type === portal`; migration 0002 resolves `can_supply AND can_hire` to
      `'vendor'`, so the dual-role org threw "is vendor, not client" on its own hiring
      side. **`org_type` is a lossy projection and must never gate access** —
      `org_capabilities` is authoritative (ADR-012). The mapping lives in
      `requiredCapability()` and nowhere else: client→`can_hire`, vendor→`can_supply`,
      ops→`org_type='talentvibes'`.
- [x] Vendor-only org: one workspace, **no hint that a hiring side exists**.
      `workspaceTabs()` returns an EMPTY array rather than one tab — a lone inert tab is
      itself a hint. Verified at the markup level: supply-only Nimbus renders **zero**
      occurrences of "Workspace" and **zero** of "Hiring".
- [x] Dual-role org: "Hiring | Bench" switcher in the top bar, same login. A side needs
      BOTH the org capability AND the user's membership role, so a bench manager at a
      dual-role company sees one side and an admin sees both.
- [x] **The two rate views never appear on the same screen for the same org** — structural,
      not per-screen: neither side's read model carries the other's rate. Verified live for
      Cygnet: exact vendor rates on `/vendor/roster`, four bands
      (₹1L–1.3L … ₹1.4L–1.7L) on `/client/shortlists/req-2320`, never both.
- [x] The ops-only "N matching people on this client's own bench" note — renders **14** for
      Cygnet, tagged OPS ONLY, and leaks into none of the five client/vendor pages checked.
      `ownBenchMatches` had been computed since Sprint 5 and shown nowhere.
- [x] Acceptance tests 1, 2 and 6, plus both readings of 5 — `tests/leak/dual-role-ui.test.ts`.
      Test 6 flips `can_hire` on a real row and restores it in `afterAll`.
      **The brief's wording for test 5 is not recorded anywhere in the brain**, so both
      plausible readings are asserted and labelled rather than one being guessed.
- [x] Seed: a shortlist for REQ-2320, so the hiring side has real bands. Not decoration —
      without it "each side shows only its own rate" passes by showing **nothing**, the same
      vacuous-pass trap as an empty candidate pool.
- [x] The demo control lists **organisations**, not portals. Three portal links cannot
      express one organisation on two sides. `/demo/act-as` sets it in a cookie; demo only.

### SPRINT 6b — the ops organisation directory · ✅ DONE (commit `d6a7fad`)

Gates: 21 routes ×2 all 200, `db:verify` **28/28**, `test:leak` **45/45**, build and
typecheck clean. One screen, `/ops/organisations`, because these items are one subject.

- [x] **Dual-role badge** — plus a callout naming the org, its bench, its open roles and its
      fee model. **Ops-only by contract**; verified absent from five client/vendor pages
      while acting as the dual-role org.
- [x] **Org profile display** — capabilities, declared group **with its siblings**, fee
      model, block list **in both directions** (a one-directional reading would leave one
      side still seeing the other; a test pins both rows). Read-only: any write needs an
      audited service per working agreement 5.
- [x] **Margin grouped per org** — billed as client, paid as supplier, net position. For a
      dual-role org those two figures **are** the spread, so this is the only screen in the
      product where they may sit together.
- [x] **Probing-flag indicator** — `v_requirement_probing` and `v_org_probing_signals` had
      existed since migration 0002 with nothing reading them. **Read, not reimplemented**: a
      second definition in TypeScript would drift from the SQL. Currently flags nobody on the
      seeded data, which is honest — the view needs a shortlist to sit 5 days unanswered.
- [x] **One broker thread per workspace, never mixed** ✅ 2026-10-07 — the last item from the
      brief, now closed. **Why it matters:** for every org except a dual-role one,
      `counterparty_org_id` alone identifies the conversation. A dual-role org has two
      threads with the SAME counterparty id, so `side` is the discriminator — filtering only
      on the organisation mixes them. Three gaps were closed: Cygnet had no threads at all
      (now one per side, deliberately **unlinked** — `linked_thread_id` means "the
      counterpart half of one relayed exchange", ADR-008, which these are not); there was no
      vendor-side read model, so a vendor never saw its thread (`getVendorBrokerThread`,
      which never selects `redaction_note`); and the client Ask panel seeded itself from a
      **hardcoded message in the component** while the real conversation sat unread and
      `getClientBrokerThread` was called by nothing.

**Two first-draft mistakes worth remembering:**
1. The broker rendered "Hidden markup" — it holds the column default because every row
   does, but it is not a party to the exchange and has no fee model. Now "—".
2. `isProbingSuspect` also flagged `open >= 3 && placements === 0`. **That threshold is
   nowhere in the brief; it was invented**, which working agreement 8 forbids doing
   silently. It now tracks only the view's own count, with open roles and placements-ever
   beside it so ops applies judgement. A test pins it.

The ops nav gained a **sixth** item, past v2's five ops screens and deliberately —
`SCREENS.md` has no home for capability/group/fee/block visibility, and ops is the internal
console. `Skeleton.tsx` now derives its nav row count from `NAV` instead of hardcoding 5.

---

## SPRINT 7 — Migrate to the v2 design handoff · **7a DONE**, 7b–7e to go

The user chose **Full v2** on 2026-10-07 after being shown the risk, and chose to keep
**rate bands everywhere** rather than take v2's exact-rate-on-placements allowance. Staged
into 7a–7e so every stage ends at the four gates and there is always a stable commit to
demo from.

**7a (foundation) is complete and verified** — see the Sprint 7a block below. 7b–7e remain.

### The staging

- [x] **7a — Foundation** ✅ 2026-10-07 (one sprint; mechanical, scriptable, git-revertible).
      Drop in `tokens.css`; add the `data-tvtheme` light/dark toggle persisted in
      `localStorage("tvbx-theme")`; switch fonts to Plus Jakarta Sans + IBM Plex Mono;
      convert colours to `var(--token)`. **Recommended first.**

      **Measured cost — do not believe the cheaper version of this story.** An earlier draft
      of this note claimed the palette could change "underneath" the existing `s()` helper
      by repointing `TOKENS`. It cannot. The counts:

      - colours referenced via `TOKENS.*` / `ACCENT*`: **151**
      - bare hex literals: **885**, of which **307** sit inside `s("...")` declaration
        strings written at the point of use

      So repointing `TOKENS` alone re-themes roughly **15%** of colour usage and would ship
      a visibly half-themed app — sidebar and cards flipping to dark while `#e8e8ee`
      borders and `#6b6b78` body text stay light. **Light/dark is all-or-nothing.**

      It is still mostly mechanical, which is the good news: **517 of the 885 occurrences
      are just 9 values**, and they map cleanly onto v2 tokens — `#8a8a96`×145 → `--t4`,
      `#fff`×108 → `--surface`, `#e8e8ee`×53 → `--border`, `#101014`×42 → `--t1`,
      `#4a4a58`×38 → `--t2`, `#e0e0e8`×36 → `--border-2`, `#b45309`×36 → `--warn`,
      `#6d3ff0`×31 → `--brand`, `#6b6b78`×28 → `--t3`. Plan: a scripted substitution of
      ~20 mappings, then a manual pass on the tail, then verify **both** themes render —
      and the dark sidebar is a deliberate v1 design choice, not a token, so it needs a
      decision rather than a substitution.
- [ ] **7b — Shell** (one sprint). The above plus the 260px sidebar with
      HIRING / YOUR BENCH / BROKERING DESK groups, Lucide icons, the ⌘K command palette,
      toasts with Undo (6s auto-hide), the top-bar portal switcher and the help re-explainer.
- [ ] **7c–7e — Screens** (several sprints). All 16 screens re-skinned to `SCREENS.md`
      copy, plain language throughout ("People working", not "Engagements"), responsive from
      ~900px, and the three data-model decisions below resolved.

### Data-model deltas — two resolved, one needs the user

- [x] **Groups: declared, not inferred — RESOLVED, do not re-open.** v2 says `groupId` is
      "parent group by PAN/GST". The dual-role brief said the opposite verbatim and
      migration `0004`'s comment says so too: **declared in the MSA, never inferred from
      PAN or GSTIN**. The brief wins — v2 is a design document written without knowledge of
      it, and inferring a group from a tax identifier would silently create or miss
      self-dealing relationships. Keep what is built; no user decision needed.
- [x] **SLA thresholds — keep the built behaviour.** v2 wants `warn` under an absolute 8h;
      built uses ≤25% of the window, which is the whole reason
      `requirements.sla_window_hours` exists (it fixed `db:verify` drifting to 19/21 through
      the day). Low-stakes and reversible either way, so it is not worth a decision round:
      keep ≤25%. Revisit only if the user asks for the 8h rule by name.
- [ ] **SLA thresholds.** v2: `ok` = more than 8h left, `warn` = under 8h or client feedback
      due. Built: `warn` = ≤25% of the window remaining, which is the entire reason
      `requirements.sla_window_hours` exists (it fixed the daily drift to 19/21). v2's
      absolute 8h rule is simpler and would make the column unnecessary for `warn`.
- [ ] **⭐ THE ONE QUESTION FOR THE USER — exact client rate on placements?** v2's
      visibility matrix allows the client "band on shortlists, **exact on placements**".
      Built shows bands throughout. This is the only v2 delta that **loosens masking**, so
      it needs an explicit decision and an ADR, never a quiet edit. Check
      `/client/engagements` against `docs/MASKING.md` before changing anything. Note it is
      defensible either way: the client signs a contract at a real rate, so they arguably
      must see it — but the vendor rate must stay hidden regardless, and a dual-role org
      seeing exact client rates on one side is a margin-inference risk (see
      `flat_declared_fee`).

### Already agreed, no change needed

v2 matches what is built on: ranking weights 30/22/16/14/10/8 (ADR-011 exactly), freshness
10/14 days with 28-day linear decay, `TV-####` / `REQ-####` / `DUP-####` formats, masking
enforced server-side with per-audience DTOs, dual-role organisations, two separate
reliability scores, 90-day assessment validity. Only `noticeAccepted` differs cosmetically
(`"30" | "60"` vs `le_30`).

---

### SPRINT 7a — Foundation · ✅ DONE (2026-10-07)

All four gates green: **19 routes 200** (including both dynamic routes), `db:verify`
**25/25**, `test:leak` **30/30**, build and typecheck clean.

- [x] `app/globals.css` — the full v2 token set, light on `:root` and dark on
      `[data-tvtheme="dark"]`, with `color-mix` tints derived from `--brand`. Verified in
      the **served** stylesheet, not just the source: `--brand:#0b6ed9`, `--t1:#0f1729`,
      `--bg:#080a0f` under `[data-tvtheme=dark]`, `color-mix`, `tabular-nums`, and both
      `tvin` and `tv-shimmer` keyframes.
- [x] Fonts — **Plus Jakarta Sans + IBM Plex Mono**, self-hosted via `next/font/google`
      (not a `fonts.googleapis.com` link, which would put a third-party round trip on the
      critical path). Served CSS shows both faces with size-adjusted fallbacks.
- [x] Light/dark toggle — `src/lib/ui/ThemeToggle.tsx`, the two 32×30 sun/moon segments,
      persisted in `localStorage("tvbx-theme")`. **The theme is applied by a blocking
      inline script in `app/layout.tsx`, not by the component**, or a dark-mode user gets a
      white flash on every navigation; the component only syncs its own highlight.
- [x] `style.ts` — `TOKENS`, `STAGES`, `SLA_COLOR`, `MARGIN_COLOR` all onto `var(--…)`.
      Per-portal `ACCENT` collapsed to the single `--brand` (v2 rule 3: colour means status
      only). Added `GROUP_LABEL` (HIRING / YOUR BENCH / BROKERING DESK).
- [x] Shell rewritten by hand — 260px **light** sidebar, 30px brand logo tile, 38px search
      and nav rows, Lucide icons at 17px/1.75, plain-language nav labels, badge pills, the
      attention list with sub-lines, a 32px initials avatar, and the new **60px top bar**
      carrying the breadcrumb, the demo portal switcher, the theme toggle and help.
- [x] `Skeleton.tsx` rewritten to the same geometry, so the loading state no longer jumps.
- [x] **790 scripted hex→token replacements across 23 files.** Script kept at
      `scripts/migrate-colours-to-tokens.py` — it is idempotent, so it is safe to re-run
      after adding a screen that still carries literals.

**Three traps this sprint hit, all worth remembering:**

1. **The shell could not be scripted.** v1's sidebar was dark (`#111114`) with `#fff` text.
   `#fff` maps to `--surface`, and the v2 sidebar *is* `--surface` — so a blanket
   substitution produced white text on a white sidebar. Shell and Skeleton were migrated by
   hand for exactly this reason, and `Skeleton.tsx` had already been broken this way by the
   script before being rewritten.
2. **`color:#fff` is not always `--surface`.** On a `--t1` or status background it must
   become `--surface` (v2's "Dark button" recipe: dark bg, surface text) so it inverts
   correctly in dark mode. On a `--brand` background v2 says white **stays literal white**.
   Three brand buttons were converted wrongly by the script and restored by hand
   (`PostForm` ×1, `ShortlistBoard` ×2). The only two live hex values left in any `.ts`/
   `.tsx` file are those `color:#fff` on brand; everything else is in a comment.
3. **An automated check caught what review would not.** A scan for declarations whose
   `color` and `background` resolve to the *same* token found the invisible-text class of
   bug directly — it reports **0** now. Re-run it after any further colour work:
   it is the only cheap guard against a token swap making text vanish.

## SPRINT 7b — Make it a working POC · IN PROGRESS

Scope agreed with the user on 2026-10-07 after a question round. The governing instruction:
**"make this a fully working POC"** — if there is a backend, the UI should use it. A button
that does nothing is not acceptable; a button that says plainly it is not ready is.

### The audience, which drives the copy decisions

Senior people with years of experience who **do not want a technical system with a steep
learning curve or complex words**. Consequences already decided:

- **⌘K is removed entirely.** The user's words: *"what does that even mean"*. A keyboard
  shortcut is a thing to learn; this audience will not learn it. The search box becomes a
  normal, visible, working search.
- **Follow v2's `SCREENS.md` copy exactly.** It was written for non-technical HR staff, and
  keeping one source of truth beats inventing a third vocabulary. **7a renamed the nav but
  not the page headings**, so the app currently contradicts itself — sidebar "Open roles"
  against heading "Requirements". Fixing that is not a preference, it is a defect.
- **Four terms stay as they are**, confirmed by the user: **masked** (the product's core
  promise, and in the brief), **margin / spread** (ops-only, internal finance vocabulary),
  **bench / bench roster** (what vendor users say daily), **proctored** (it is the reason a
  client can trust the score).

### Decided

- [x] **Remove the "My desk" filter and the hardcoded `ownerShortSelf="P. Nair"`.** Every
      Talentvibes user sees every role. **Keep the owner name visible** on each row — a
      broker still needs to know who to ask about a role.
- [x] **Toasts with REAL undo.** ✅ The action commits immediately; Undo writes a
      **compensating change plus a second audit row**, so history shows it was done and then
      undone. Actions that genuinely cannot be undone get **no Undo button** rather than a
      lying one.
- [x] **"How this works" explainer** ✅ 2026-10-07 — per-portal plain English behind the `?`,
      which was previously a div that did nothing. Written per portal on purpose: a client is
      not told how the supplier side works, because telling them would itself be a masking
      problem. Each point says what you see, what you do not, **and why** — "why" is what
      stops someone asking for the supplier's name.
- [x] **Search: everything in the caller's portal** ✅ 2026-10-07 — server-backed, grouped
      by type, **three read models rather than one with a role branch** (ADR-003: search is
      the most tempting place in the product to break that rule). 17 leak tests, and the
      assertions are about ABSENCE because that is the direction that matters. ⌘K removed
      entirely and verified gone from all three portals.

### The four write paths the user chose, in their order

Each one needs the full definition of done from `../CLAUDE.md`: Zod at the boundary, a
tenancy check, a portal-specific response shape, **an audit row**, and a leak test.

- [x] **1. Add a bench resource** ✅ — the one the user named first. Form → `bench_resources`
      + `resource_skills`, a `TV-####` masked id allocated, audit row, redirect to the
      roster with a toast. Today the form has **zero** fetch calls.
- [x] **2. Post a new role** ✅ (the form had NO role-title field; added) — form → `requirements` at stage `new` with a `REQ-####` code,
      audit row, and it must appear on the ops pipeline immediately. Today `PostForm` only
      calls `match-preview`, which is a READ: nothing is created.
- [x] **3. Select / pass candidates, and request interviews** ✅ —
      `shortlist_items.client_decision` per decision, then `interviews` rows for round 1.
      Today it is local React state that vanishes on refresh.
- [x] **4. Resolve a duplicate, and submit interview feedback** ✅ — `duplicate_flags.status`
      (keep A / keep B / not a duplicate) and `interview_feedback`. Both audit rows.

- [x] **CSV exports** ✅ 2026-10-07 — `/api/export`, built from the same read model the
      screen uses, so masking is **inherited rather than re-implemented**: a vendor CSV
      cannot carry a client name because `getVendorEarnings` cannot return one. Two details
      worth keeping: a **UTF-8 BOM** (Excel on Windows mangles ₹ without it, and every
      figure here has one) and a **formula-injection guard** — Excel EXECUTES a value
      starting with `=`, `+`, `-` or `@`, so `=1+1` is written as `'=1+1`. Buttons use a
      `download` variant that renders a plain `<a>`; next/link would do an RSC navigation
      and the download would never start.

### A defect this sprint exposed, worth not repeating

**Every multi-table write must be one transaction.** The first version of the
post-a-role endpoint inserted the requirement, then the skills, then the audit row as
three separate statements. A request that failed in the middle left **two committed rows
with no skills and no audit row** — a silent violation of working agreement 5, because a
half-created record has no audit trail at all. Both orphans had to be deleted by hand
before `db:verify` passed again. Both create endpoints now wrap their writes in
`db.transaction`, which makes the audit row a condition of the record existing.
Transactions are safe on the Supavisor transaction-mode pooler — a transaction is the unit
it pools; it is session-level state that is unavailable there.

**`inArray`, never sql`= any(${array})`.** Drizzle's `sql` template spreads a JS array into
a parameter LIST, so `= any(($1, $2))` reaches Postgres and it answers "op ANY/ALL (array)
requires array on right side". That is what caused the failure above.

### Still dead after 7b — do not lose these

The user asked for these to be recorded so they are not forgotten. None of them persists
anything today, and each should either be built or say plainly that it is not ready.

| Where | Control | Note |
|---|---|---|
| `/client/interviews` | **Join** | needs a real meeting link; v2 says Talentvibes issues it |
| `/client/interviews` | **Reschedule**, **Propose new slot**, **Panel availability** | needs an availability model that does not exist yet |
| `/client/interviews` | **Save draft** | feedback drafts have no column; add one or drop the button |
| `/client/engagements` | **Request an extension** | needs an extension request table |
| `/client/shortlists` | **Ask Talentvibes** (index page) | opens nothing; the drawer only exists on the detail page |
| `/vendor/assessments` | **Invite N to a test** | needs the assessment provider adapter (ADR-006) |
| `/ops/duplicates` | **Detection rules** | a settings screen that does not exist |
| `/ops/pool` | **Save this view**, **Load more** | saved views need a table; Load more needs paging |
| `/ops/matching` | **Ask the supplier** relay | the write side of the broker thread |
| everywhere | **sending a broker message** | `getClientBrokerThread` now READS real data, but Send still only appends locally — there is no write endpoint for a client message |

### Not in 7b, deliberately

- The **322px portal-switcher dropdown** and the **ops dark internal-view strip** are
  cosmetic; they wait for 7c–7e with the rest of the screens.
- The **Ask Talentvibes drawer** as v2 specifies it (412px, typing indicator, mocked reply)
  is a redesign of a panel that now works; the write endpoint above matters more.

---

## Vocabulary — plain language across all three portals

Full audit, including what is deliberately unchanged and why:
**`project-brain/06-vocabulary.md`**.

- [x] **Talent pool columns** ✅ 2026-10-07 — `SUPPLIER` → `EMPLOYER`, `EXP` → `EXPERIENCE`,
      `SCORE` → `TEST SCORE`, `FRESHNESS` → `LAST CONFIRMED`, and the **filter chips renamed
      in the same edit** — a chip and a column naming one filter differently is the defect
      this pass exists to remove. The driver was not jargon: `SUPPLIER` sat directly beside
      `VENDOR RATE`, one company under two words on one table.
- [x] **`FRESHNESS` everywhere** ✅ 2026-10-07 — 11 sites. `LAST CONFIRMED` on the four
      headers; `NEEDS CONFIRMING` on the five vendor asides, because "LAST CONFIRMED ALERTS"
      is nonsense and an aside listing work takes the imperative.
- [x] **`RESOURCE` → `NAME`** ✅ 2026-10-07 — on the **three** tables that render `fullName`.
      The two that render an identifier were left: `NAME` over a masked ID implies a name is
      there to be seen, which on `/client/engagements` is the opposite of the guarantee.
- [x] **"Talentvibes · broker"** ✅ 2026-10-07 — was the raw `user_role` enum; the chip now
      shows the organisation alone, as the other two portals always did. A `ROLE_LABEL` map of
      guessed job titles was written and then deleted — *"no admin or anything but just
      something simple"*.
- [x] **`Expiring 2d` → `Expiring in 2d`** ✅ 2026-10-07 — it counts **forward**
      (`14 - days`), so under a `LAST CONFIRMED` header the bare form said the opposite of
      what it meant.
- [x] **A display string is never a sort key** ✅ 2026-10-07 — the switcher sorted on
      `a.role === "Broker"`; renaming that label would have reordered it silently.

### Round 2 — all six approved and applied ✅ 2026-10-07

- [x] **(a) "broker" → "your Talentvibes team"** ✅ — **21 strings, not 16**: the first sweep
      scoped itself to `app/**/*.tsx` and missed an API note, two in `ShortlistBoard`, the
      explainer heading and a read-model fallback. **The trap:** `brokerName` is a *name* whose
      fallback was the phrase `"your Talentvibes broker"`, so a blanket swap would have
      rendered *"your Talentvibes team, Talentvibes:"* — type-checking, building and passing
      all 108 tests, since no test asserts UI copy. The three render sites were reworded first,
      each to read correctly with a real name **and** with the fallback. **Ops keeps "broker"**
      ("The brokering desk"): internal console, same standing call as `margin` and `spread`.
- [x] **(b) the gap the pool rename opened** ✅ — `app/api/export/route.ts:134`
      `Supplier` → `Employer`.
- [x] **(c) screens adopt their own CSV wording** ✅ — `WORKING SINCE`, `YOUR MONTHLY RATE`,
      `BILLED THIS MONTH`.
- [x] **(d) the two identifier columns** ✅ — `RESOURCE` → `REFERENCE` on
      `/client/engagements` and the `/vendor` pipeline, where the cell is a masked ID.
- [x] **(e) `rel 4.2` → `reliability 4.2`** ✅
- [x] **(f) `QTY` → `HOW MANY`, `BUDGET/MO` → `BUDGET / MONTH`, `VALUE/MO` → `VALUE / MONTH`**
      ✅ — `REQ` kept: requirements really are `REQ-####`. `HOW MANY` is ≈52px and the ops
      pipeline's column was **exactly** 52px, so it was widened to 68px; six more header cells
      took `white-space:nowrap`.

- [x] **Checked against the v2 UI contract** ✅ 2026-10-07 — done *after* the renames, which
      was the wrong order. `design_handoff_bench_exchange_v2/SCREENS.md` prescribes column
      names. Two renames turned out to be **conformance** (`reliability` is v2's own word at
      `:222`; `TEST SCORE` resolves a contradiction between v2's `:65` and `:222`) and five are
      **deliberate owner-directed divergences** now recorded in `06-vocabulary.md` §4 so they
      are not "corrected" back. **Read the handoff first next time.**
- [x] **Fixed a mismatch (c) created** ✅ 2026-10-07 — the new client-engagements headers were
      copied from the **vendor earnings** CSV (`route.ts:95`); that screen's own CSV is line
      **112** and said `Since` / `Your rate`. Renamed in place, order untouched — the row
      builder is positional, so reordering a header alone would mislabel every cell.

### Still open — `06-vocabulary.md` §2

- [ ] **Take v2's pool subtitle** — `SCREENS.md:221` says *"full detail, nothing hidden"*
      where the app says *"· unmasked ·"*. Plainer, and it is the contract.
- [ ] **`YOUR RATE` vs `YOUR MONTHLY RATE`** — the vendor roster and pipeline still say the
      short form for the same monthly figure that earnings now spells out. Both columns have
      room (118px and 120px against ≈111px needed). Exposed by (c), not caused by it; left
      because it was outside what was approved.
- [ ] **Confirm "Full access"** — it labels Talentvibes in the organisation switcher
      (*Supplies · Hires · Both sides · Full access*), replacing "Broker". Not a word the
      owner picked.
- [ ] **A product question, not a rename:** `/vendor` shows a vendor a **shortened** name of
      their own employee (`src/read-models/vendor/index.ts:251`). Deliberate, or masking
      over-applied inward? They see the full name on the roster.

## Backlog — not assigned to a sprint

- [x] **Deployment is the user's.** Import `lakshyasonitv/DeployDesk` into their own ✅ 2026-10-07
      Vercel account and set `DATABASE_URL` (pooler 6543), `IDENTITY_PEPPER`,
      `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
      **I must not touch Vercel.**
- [ ] Ask the owner of the `vaibhavalteryx-1351` account to delete the stray `deploydesk`
      project (its secret values are already overwritten with placeholders)
- [x] **Rotate the Supabase database password** — shared in chat twice, not yet confirmed ✅ 2026-10-07
- [x] Get the `v2` prototype file if it exists; the UI was built from v1 ✅ 2026-10-07
      — the user added `design_handoff_bench_exchange_v2/`. See SPRINT 7 below.
- [ ] Flag to the design owner: client bands read higher than the mockups (ADR-004), and
      algorithm rank order differs in pools A, B and D (ADR-011) — both deliberate
- [ ] RLS beyond the dual-role policies — the second net `BUILD-PLAN.md` Phase 1 wants
- [ ] **drizzle-orm 0.44.7 has a HIGH advisory** — GHSA-gpj5-g38j-94v9, SQL injection via
      improperly escaped SQL identifiers, fixed in 0.45.2+. **Exposure here is low**: the
      vector is dynamically built identifiers, and the codebase has **zero** uses of
      `sql.raw` or `sql.identifier` (the two that existed were replaced with parameterised
      `inArray` earlier). Still worth upgrading, but 0.45.x is a breaking change, so it
      needs its own task with the 30 leak tests and 25 seed checks as the safety net — not
      a mid-sprint `npm audit fix --force`.
- [x] **Nothing converts to Asia/Kolkata.** ✅ FIXED — `src/lib/business-clock.ts`, 09:00–19:00
      IST Mon–Sat, fixed +05:30 offset. **The holiday table is still absent** and every
      function takes an optional holiday set defaulting to empty; wiring the table in needs
      no change to the arithmetic. Old note: `CLAUDE.md` working agreement 3 says business
      days, SLA clocks and the nightly freshness sweep run in IST, but `IST_TZ` in
      `src/lib/derived.ts` is referenced nowhere — SLA state and freshness are computed in
      UTC, a ~5.5h boundary shift. Found by the 2026-10-07 dead-code audit. Low impact on a
      demo (thresholds are in days), real before launch.
- [ ] **`rate_changes` is declared and never written.** No rate-change path exists yet, so
      this is an unbuilt feature rather than a missing audit row — but working agreement 5
      requires the audit row when that path is built.
- [ ] CI: typecheck, lint, migration check, leak suite
- [ ] Restricted application DB role, so the app never connects as the service role
- [ ] Real Supabase Auth replacing `src/lib/auth/session.ts`, including the portal check
      that returns 404 rather than 403
- [ ] Import-boundary test: no client page may import the ops or vendor read models
