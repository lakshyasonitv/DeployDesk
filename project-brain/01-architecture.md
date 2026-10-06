# 01 — Architecture

> How the project is built. Update when stack/structure/patterns change.
>
> **`../docs/ARCHITECTURE.md` is the authority.** This file is a thin index plus the Gotchas
> section, which is the part that exists nowhere else. `../CLAUDE.md` says "do not
> duplicate content between docs — link instead", so resist restating anything below.

## Stack

Next.js App Router route handlers (TypeScript, strict) · Postgres on Supabase with RLS ·
Drizzle ORM with checked-in append-only SQL migrations · Supabase Auth (JWT carries
`org_id`, `org_type`, `role`) · `pg_cron` + a DB job table · Resend for email ·
proctored assessments behind an adapter.

Rationale and rejected options: **ADR-001** and **ADR-002** in `../docs/DECISIONS.md`.

**UI layer** (rebuilt in Sprint 7a to the v2 handoff):

- `app/globals.css` holds the v2 design tokens — light on `:root`, dark on
  `[data-tvtheme="dark"]`, every tint derived from `--brand` through `color-mix`.
  **`--brand` is the only colour knob**; its `#0b6ed9` is approximated from
  thinkvibes.com and still needs confirming with the brand team.
- Fonts are **Plus Jakarta Sans** (UI) and **IBM Plex Mono** (IDs, key hints), self-hosted
  through `next/font/google` rather than linked from fonts.googleapis.com.
- Icons are **lucide-react** at 17-18px, stroke 1.75.
- `src/lib/ui/style.ts` — the `s()` / `sx()` inline-style helpers and the token maps.
  Nothing in here holds a hex literal any more; it names roles and the stylesheet resolves
  them, which is what makes the theme toggle work.
- `src/lib/ui/ThemeToggle.tsx` is the only client component in the shell.

## Folder structure

What exists today: `CLAUDE.md` at the repo root · ten spec docs inside **`docs/`**
(`ARCHITECTURE.md`, `MASKING.md`, `DATA-MODEL.md`, `DOMAIN.md`, `API.md`, `MATCHING.md`,
`DECISIONS.md`, `BUILD-PLAN.md`, `TESTING.md`, `SEED-DATA.md`) · `project-brain/` — this
folder · `scripts/` · and **two** design handoffs.

**The UI contract is `design_handoff_bench_exchange_v2/`.** v1
(`design_handoff_bench_exchange/`) is superseded and kept only for history — do not build
from it. v2 is the richer bundle: `README.md` (shell and global rules), `SCREENS.md` (all
16 screens with copy), `DESIGN_TOKENS.md` + `tokens.css`, `DATA_MODEL.md`, its own
`CLAUDE.md`, and a clickable `prototype/bench-exchange-standalone.html`.

Where v2 and the implementation disagree, three calls are already made and recorded in
`02-decisions.md` — **do not re-open them from the handoff**: groups stay declared in the
MSA (not inferred from PAN/GST), SLA `warn` stays at 25% of the window (not an absolute
8h), and the client never sees an exact client rate (bands everywhere, including
placements).

Application code is built: 19 routes across the three portals. The layer map and the three
hard rules that go with it are in `../docs/ARCHITECTURE.md` → **Layers**.

The shape in one line: `app/api/{client,vendor,ops}/` are thin (auth → validate → service
→ read model); `src/read-models/{client,vendor,ops}/` is the *only* place a response shape
is defined; `src/services/` is shared and works on full unmasked domain objects.

The asymmetry that makes the product work: **domain services are shared, read models are
not.**

## Key patterns & conventions

Full list: `../CLAUDE.md` → **Working agreements** and **Naming conventions**. The ones
that cause the most damage when forgotten:

| Convention | Where |
|---|---|
| Never a shared DTO across portals; three unrelated types in three folders | ADR-003 |
| Money is `bigint` **paise**, never floats/strings/rupees | ADR-007 |
| `timestamptz` UTC in the DB; SLA clocks and sweeps run **Asia/Kolkata** | `../CLAUDE.md` |
| Derived values are derived on read, never stored (freshness, SLA, margin colour) | `../docs/DOMAIN.md` |
| No `SELECT *` on any table carrying a masked column | `../CLAUDE.md` |
| Never name a variable `rate` — it is `vendor_rate` or `client_rate`, always | `../CLAUDE.md` |
| Migrations are append-only; every one has a matching `down` | `../CLAUDE.md` |

Definition of done for an endpoint is a 6-item checklist at the bottom of `../CLAUDE.md`.
Treat it as a gate, not a guideline.

## External services & config

Supabase (DB + Auth) · Resend (email) · external proctoring provider behind
`AssessmentProvider` (ADR-006 — likely to point at the in-house platform first) · object
storage for CVs, assessment reports and bulk-upload sheets, signed short-lived URLs only.

Boundary rules per integration: `../docs/ARCHITECTURE.md` → **Integrations**. Env var *names*
go here once Phase 0 defines them; **never values**.

Two standing constraints worth repeating because they are easy to breach:
- **CVs are ops-only.** They carry names, employers and contacts — never served to a
  client under any circumstance.
- The app connects as a **restricted DB role**, never the service role, so RLS actually
  applies. Service role is for migrations and cron only.

## Gotchas

Hard-won surprises and traps. Everything here is non-obvious from reading the code.

- ~~**The `docs/` prefix does not resolve.**~~ **RESOLVED — the `docs/` folder exists**
  and holds all ten spec files, so `../CLAUDE.md`'s references are correct as written.
  Earlier brain entries told readers to strip the `docs/` prefix; that advice is obsolete
  and any remaining root-relative link in this folder is the thing to fix, not the path in
  CLAUDE.md. Corrected 2026-10-07.

- **Client rate bands will NOT match the design mockups, and that is correct.** Every
  fixture in the design prototype shows the client-facing band bracketing the *vendor*
  cost (`TV-4821: 1.35–1.55L` against a vendor rate of 1.38L), which hands a client the
  margin on every placement. ADR-004 derives the band from `proposed_client_rate` only, so
  bands read higher than the mockups. Do not "fix" the discrepancy by matching the design.
  Flag it to the design owner instead. Full reasoning: **ADR-004**.

- **Phase 1 before Phase 2, always.** `../docs/BUILD-PLAN.md` orders phases so the masking
  harness exists *before* any data that could leak. The build plan says explicitly: do not
  reorder Phase 1 and Phase 2.

- **A vendor hitting a client route is a 404, not a 403.** A 403 confirms the route
  exists. See `../docs/ARCHITECTURE.md` → **Tenancy and authorisation**.

- **Concurrency: safe up to the pool width, and now the main latency lever.** This entry
  replaces two older ones that said the opposite; read it before "fixing" a `Promise.all`
  back into sequential awaits. The history, because it is easy to misread:
  1. `max: 1` plus *any* concurrency over a Supavisor transaction-mode connection stalls
     indefinitely, and a one-socket pool takes every route down with it. That was the real
     cause of the Sprint 1 `/ops` hang — **not concurrency itself**.
  2. In the Sydney era each concurrent query opened a cold connection (~3s TLS), so
     five-in-parallel measured *slower* than five in sequence. That stopped being true
     when the database moved to Mumbai.
  3. The pool is now `max: 10` and a two-way `Promise.all` ships on ten pages.
  **Measured 2026-10-07:** `getVendorOverview` made six sequential round trips at roughly
  60-70ms each and spent ~440ms almost entirely waiting. Fanning out its five independent
  reads took it to **144ms** — and cutting its row volume first had won only 9%, so
  **latency here is round-trip count, not row count.** Look for serial `await`s before
  optimising rows. The still-valid caution: a fan-out wider than the pool exhausts it, so
  stay inside `max`.

- **Database region and function region must stay aligned.** Supabase cannot move a
  project's region, so changing it means a new project and a re-migrate. `preferredRegion`
  in `app/layout.tsx` is pinned to `bom1` to match ap-south-1. If one moves, move both.

- **40 columns were created camelCase, against the `snake_case` convention — now fixed.**
  `createdAt`, `updatedAt` and similar came out verbatim from the TypeScript keys because
  the schema used Drizzle's implicit-name API without `casing: "snake_case"`. The
  application still worked, since Drizzle quotes identifiers consistently, but
  hand-written SQL and RLS policies would have referenced the wrong names.
  Fixed by `casing: "snake_case"` (set in four places) plus migration
  `0001_snake_case_timestamps.sql`, which carries 40 guarded `RENAME COLUMN` statements.
  **Applied 2026-10-06** — the database is `snake_case` throughout, so hand-written SQL
  and RLS policies can be written the obvious way.

- **`drizzle-kit push` needs a TTY** and fails in this harness. Schema changes go through
  `db:generate` plus the migrator in `src/db/migrate.ts`, which is what working agreement
  1 requires anyway.

- **`db.<ref>.supabase.co` has no IPv4 address** on either project tried, so the "direct
  connection" string Supabase shows does not resolve from every network. `DIRECT_URL`
  points at the SESSION pooler on 5432 instead, which supports the session-level features
  migrations need. The transaction pooler on 6543 is for the app only.

- **Seeded SLA states decay within the hour, and `db:verify` catches it.** The check
  "exactly one SLA breach" starts failing a few hours after seeding: REQ-2302 is stage
  `new`, whose documented window is 4 business hours, and the fixture wants it in `warn` —
  which by definition means 25% or less remaining, so its deadline sits under an hour out
  and ages into `late`. **Fixed:** `requirements.sla_window_hours` (migration 0002)
  derives each fixture's window from its stated runway instead of the stage default, so the
  shortest runway is now ~4h and `db:verify` holds at 25/25 through the day. Re-seeding
  before a demo (`npm run db:seed`, ~4s) is still the quickest way to get crisp numbers,
  but is no longer needed to keep the suite green.

- **Fewer queries only reads as "faster" where queries were the bottleneck.** Sprint 2 cut
  `/client` from 8 queries to 6 and `/vendor/roster` from 6 to 4, and both pages' wall
  time did not move (−5% and +4%, inside noise over six samples). The ops pages, where the
  sidebar was 9 of 10 queries, gained 23-76%. Measure wall time, not just query count,
  before claiming a win.

- **NEVER junction a second checkout's `node_modules` at the real one.** To build a
  before/after comparison I made `../tv-bench-BEFORE/node_modules` a junction to the main
  repo's. Running `npm run build` in that worktree wrote *through* the junction and pruned
  the shared tree: 93 packages became 72, `next/types` and the `next` bin shim vanished,
  and a later `npm install` corrupted it further until `next` would not resolve at all.
  Recovery was `rm -rf node_modules && npm ci`. Give each worktree its own install, or
  copy the build output instead of sharing dependencies.

- **`npm install` can rewrite `package.json`.** During that recovery it silently bumped
  `next` from a pinned `15.5.4` to `^16.3.8` and alphabetised the dependency block, while
  the lockfile still pinned 15.5.4 — three sources disagreeing. Check `git diff
  package.json` after any install that was not a deliberate dependency change.

- **Vercel blocks deploys on vulnerable Next.js versions.** The build succeeds, then the
  deploy step refuses with "Vulnerable version of Next.js detected". CVE-2025-66478 is a
  CVSS 10.0 RCE in the React Server Components protocol affecting App Router apps on
  15.x/16.x. Patched on our line at 15.5.7; this project runs **15.5.27**. The advisory
  also recommends rotating application secrets if the app was ever online unpatched.

- **Hand-written SQL needs its own ledger.** drizzle-kit only tracks migrations it
  generated (journal + snapshot per migration), so renames, triggers, views and RLS
  policies are invisible to it. `src/db/apply-sql.ts` keeps an `applied_sql_migrations`
  table, hashes each file, and refuses to re-run one whose contents changed — which is
  how append-only gets enforced rather than merely documented.

- **A missing `loading.tsx` is the difference between "slow" and "frozen".** Every page is
  `force-dynamic`, so without one Next leaves the previous screen up until the server
  finishes. Adding a skeleton per portal took TTFB from 0.30-0.60s to ~0.01s. Total time
  did not move — the queries cost the same — so describe it as perceived performance, not
  a speedup.

- **Vercel preview URLs are SSO-protected by default.** A preview host like
  `project-<hash>-<team>.vercel.app` 302s to `vercel.com/sso-api` and back on every
  request, which the user will experience as the app being slow. Check for a `Location`
  header before investigating application performance. `x-vercel-id` also reveals the
  function region, which is how the bom1 co-location was confirmed live.

- **A fixture's SLA label can contradict the stage window it sits in.** REQ-2302 is
  labelled "SLA 12h · warn", but `warn` means 25% or less of the window remains, so 12h of
  runway implies a ~60h window while `docs/DOMAIN.md` gives stage `new` four hours.
  Resolved by `requirements.sla_window_hours` (migration 0002), which stores the window per
  requirement rather than inferring it from the stage. **Note v2 proposes a different rule
  entirely** — `warn` under an absolute 8h — which was considered and declined; see
  `02-decisions.md`, 2026-10-07.

- **The seed must OWN every table it can cascade into.** `TRUNCATE organizations CASCADE`
  empties anything referencing it with `ON DELETE CASCADE`, whether or not the seed
  mentions it. `org_capabilities` and `memberships` were backfilled by migration 0002 and
  then silently destroyed by the next `db:seed`, so the dual-role schema sat live and
  empty. They are now in `OWNED_TABLES` and rebuilt by `src/db/seed/dual-role.ts`.

- **`null = null` is NULL in SQL, and that trap is load-bearing here.** The self-dealing
  rule compares `parent_group_id`. Without an explicit null guard, every pair of ungrouped
  organisations would compare as "same group" in a naive implementation and the exchange
  would empty itself. Both the SQL and the TypeScript guard explicitly, and there is a
  test asserting two ungrouped orgs are NOT related.

- **A bypass test needs a control.** Four tests assert the database refuses a forbidden
  match. A fifth asserts a LEGITIMATE match still succeeds — without it, a rule that
  refused everything would pass all four. That control is what caught two harness bugs:
  Drizzle wraps the driver error so the trigger text is on `err.cause` not `err.message`,
  and `matches` has `UNIQUE (requirement_id, resource_id)` so re-inserting a seeded pair
  hits the constraint rather than the rule.

- **RLS policies are OR-ed, so adding one WIDENS access.** To narrow `shortlist_items`,
  migration 0004 had to REPLACE the policy from 0003, not add a second. A second
  permissive policy would have granted more, which is the opposite of the intent.

- **A trigger, not a CHECK, when the rule spans tables.** Self-dealing involves
  `matches -> requirements -> organizations` and `matches -> bench_resources ->
  organizations`. A CHECK constraint sees only its own row. The trigger also RAISES rather
  than silently dropping, so violations are loud.

- **Judge performance on `next start`, not `npm run dev`.** Dev mode compiles each route
  on first visit and runs React's development build. The same pages measured 1.5-3.1s cold
  in dev and 0.26-0.60s in production. Several "it's slow" reports trace to this alone.

- **A sidebar can cost more than the page.** `OpsAside()` runs the entire
  `getOpsPipeline()` read model plus `getOpsDuplicates()` to render three badge numbers.
  On `/ops/margin` that was 9 of the page's 10 queries and 443ms of its 471ms — 94% of the
  data time spent on the sidebar, not the content. Badge counts want their own `COUNT`
  query, never a full read model.

- **Pages and their sidebar helper used to duplicate the same read model.** `/client`
  called `getClientOverview()` and `ShellAside()` called it again; the vendor pages did the
  same with `getVendorRoster()`. React's `cache()` was the obvious dedupe and was
  **deliberately not adopted** — there are zero `cache()` calls in the codebase. The
  cheaper fix was to stop the sidebars calling heavy read models at all: badge counts get
  their own aggregate (`getVendorSidebar` / `getVendorRosterCounts`), one query instead of
  173 rows. Revisit `cache()` only if a genuinely shared heavy read reappears.

- **Never build a production bundle while `next dev` is running.** They share `.next` and
  the build fails with `Cannot find module for page`. Stop the dev server and delete
  `.next` first.

- **Bash heredocs fail on larger TypeScript and TSX files** in this environment
  (`unexpected EOF`). Use the Write tool for code; heredocs are fine for short appends.

- **A colour token swap cannot be done by blanket find-and-replace.** Sprint 7a converted
  885 hex literals to CSS variables, and three things only surfaced by doing it:
  1. **The shell had to be migrated by hand.** v1's sidebar was dark `#111114` with `#fff`
     text; `#fff` maps to `--surface` and v2's sidebar **is** `--surface`, so the
     substitution produced white text on a white sidebar. `Skeleton.tsx` was actually
     broken this way by the script before being rewritten.
  2. **`color:#fff` has two correct answers.** On `--t1` or a status background it becomes
     `--surface`, so it inverts properly in dark mode (v2's "Dark button" recipe is
     literally "`--t1` background, `--surface` text"). On a `--brand` background v2 says
     white **stays literal white**. The only two live hex values in any `.ts`/`.tsx` file
     are exactly those, in `Shell.tsx`, and they are deliberate.
  3. **Scan for same-token pairs afterwards.** A check for declarations whose `color` and
     `background` resolve to the *same* token finds invisible text directly, which review
     does not. It reports 0; re-run it after any colour work.
  The conversion script is `scripts/migrate-colours-to-tokens.py` and is idempotent.

- **Theme must be applied by a blocking inline script, not an effect.** `app/layout.tsx`
  reads `localStorage("tvbx-theme")` in a `<script>` in `<head>` and sets `data-tvtheme`
  before first paint. Doing it in a `useEffect` runs after hydration, so a dark-mode user
  gets a white flash on **every** navigation. Every `localStorage` access is wrapped in
  try/catch because it throws outright in a private window or with site data blocked, and a
  theme preference is not worth a blank page.

- **The four gates cannot catch a displayed number changing.** Routes still return 200 and
  the leak and seed suites assert nothing about dashboard values, so a read-model refactor
  that silently moves a figure from 7 to 8 passes everything. When refactoring a read model,
  capture the rendered values **before** and assert them identical **after**. That is how
  the `getVendorOverview` rewrite was proven behaviour-neutral across all six figures.

- **Two screens showing the same label must call the same function.** "Assessments pending"
  had drifted into two definitions — the sidebar counted assessment ROWS not scored, the
  dashboard counted RESOURCES with no scored assessment. Both printed `13` on the seeded
  data, so nothing would have caught it until someone retook a test. Both now go through
  `getVendorRosterCounts()`, so the second definition no longer exists to drift from.

- **Remote is `github.com/lakshyasonitv/DeployDesk`.** Commits must be authored as
  Lakshya Soni; an earlier run used the session account's name by mistake and had to be
  rewritten before pushing. Repo-local `user.name`/`user.email` are set accordingly.
