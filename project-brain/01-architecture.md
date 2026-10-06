# 01 — Architecture

> How the project is built. Update when stack/structure/patterns change.
>
> **`../ARCHITECTURE.md` is the authority.** This file is a thin index plus the Gotchas
> section, which is the part that exists nowhere else. `../CLAUDE.md` says "do not
> duplicate content between docs — link instead", so resist restating anything below.

## Stack

Next.js App Router route handlers (TypeScript, strict) · Postgres on Supabase with RLS ·
Drizzle ORM with checked-in append-only SQL migrations · Supabase Auth (JWT carries
`org_id`, `org_type`, `role`) · `pg_cron` + a DB job table · Resend for email ·
proctored assessments behind an adapter.

Rationale and rejected options: **ADR-001** and **ADR-002** in `../DECISIONS.md`.

## Folder structure

What exists today, at the repo root: eleven spec docs (`ARCHITECTURE.md`, `MASKING.md`,
`DATA-MODEL.md`, `DOMAIN.md`, `API.md`, `MATCHING.md`, `DECISIONS.md`, `BUILD-PLAN.md`,
`TESTING.md`, `SEED-DATA.md`, `CLAUDE.md`) · `design_handoff_bench_exchange/` — the UI
contract, treat its README as authoritative · `project-brain/` — this folder.

Planned layout (no application code built yet — see `03-progress.md`): the layer map and
the three hard rules that go with it are in `../ARCHITECTURE.md` → **Layers**.

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
| Derived values are derived on read, never stored (freshness, SLA, margin colour) | `../DOMAIN.md` |
| No `SELECT *` on any table carrying a masked column | `../CLAUDE.md` |
| Never name a variable `rate` — it is `vendor_rate` or `client_rate`, always | `../CLAUDE.md` |
| Migrations are append-only; every one has a matching `down` | `../CLAUDE.md` |

Definition of done for an endpoint is a 6-item checklist at the bottom of `../CLAUDE.md`.
Treat it as a gate, not a guideline.

## External services & config

Supabase (DB + Auth) · Resend (email) · external proctoring provider behind
`AssessmentProvider` (ADR-006 — likely to point at the in-house platform first) · object
storage for CVs, assessment reports and bulk-upload sheets, signed short-lived URLs only.

Boundary rules per integration: `../ARCHITECTURE.md` → **Integrations**. Env var *names*
go here once Phase 0 defines them; **never values**.

Two standing constraints worth repeating because they are easy to breach:
- **CVs are ops-only.** They carry names, employers and contacts — never served to a
  client under any circumstance.
- The app connects as a **restricted DB role**, never the service role, so RLS actually
  applies. Service role is for migrations and cron only.

## Gotchas

Hard-won surprises and traps. Everything here is non-obvious from reading the code.

- **The `docs/` prefix in `../CLAUDE.md` does not resolve.** CLAUDE.md routes you to
  `docs/MASKING.md`, `docs/ARCHITECTURE.md`, `docs/DOMAIN.md` and so on, but all eleven
  markdown files sit at the **repo root** — there is no `docs/` folder. A session that
  follows CLAUDE.md literally will fail to find `docs/MASKING.md`, the one file CLAUDE.md
  calls mandatory before touching any read path. Strip the `docs/` prefix when reading.
  **Unresolved:** either create `docs/` and move the files, or fix the references — that
  call has not been made. Flagged 2026-10-06.

- **Client rate bands will NOT match the design mockups, and that is correct.** Every
  fixture in the design prototype shows the client-facing band bracketing the *vendor*
  cost (`TV-4821: 1.35–1.55L` against a vendor rate of 1.38L), which hands a client the
  margin on every placement. ADR-004 derives the band from `proposed_client_rate` only, so
  bands read higher than the mockups. Do not "fix" the discrepancy by matching the design.
  Flag it to the design owner instead. Full reasoning: **ADR-004**.

- **Phase 1 before Phase 2, always.** `../BUILD-PLAN.md` orders phases so the masking
  harness exists *before* any data that could leak. The build plan says explicitly: do not
  reorder Phase 1 and Phase 2.

- **A vendor hitting a client route is a 404, not a 403.** A 403 confirms the route
  exists. See `../ARCHITECTURE.md` → **Tenancy and authorisation**.

- **The connection pool must be wider than 1, and the query count must stay low.**
  Two separate lessons, learned the hard way on the same file (`src/db/client.ts`):
  (1) `max: 1` plus concurrent queries over a Supavisor transaction-mode connection
  stalls indefinitely, and because the pool is one socket wide it takes every route down,
  not just the one that stalled. (2) Raising `max` is not a licence to fan out: `/ops`
  issues roughly eight concurrent queries and still exhausts a pool of 5 on the SECOND
  request. Prefer fewer queries over more parallelism.

- **Parallelising queries was a Sydney-era fix and is now counterproductive.** When the
  database was in ap-southeast-2, a warm round trip cost ~410ms and a new connection ~3s,
  so `Promise.all` looked like an obvious win — except each concurrent query opened a cold
  connection, making five-in-parallel (3.1s) *slower* than five in sequence. After moving
  to ap-south-1 a warm query is ~30ms, so sequential is both fast and safe. Measure before
  parallelising; the numbers are in `app/layout.tsx`.

- **Database region and function region must stay aligned.** Supabase cannot move a
  project's region, so changing it means a new project and a re-migrate. `preferredRegion`
  in `app/layout.tsx` is pinned to `bom1` to match ap-south-1. If one moves, move both.

- **40 columns in the database are camelCase, against the `snake_case` convention.**
  `createdAt`, `updatedAt` and similar were created verbatim from the TypeScript keys
  because the schema uses Drizzle's implicit-name API without `casing: "snake_case"`.
  The application works, since Drizzle quotes identifiers consistently, but hand-written
  SQL and RLS policies will reference the wrong names — and RLS is the next workstream.
  Fix is `casing: "snake_case"` plus an append-only `ALTER TABLE ... RENAME COLUMN`
  migration. **Written for approval, not yet applied** (see the database-safety decision
  in `02-decisions.md`).

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
  and ages into `late`. Re-seed (`npm run db:seed`, ~4s) before a demo. The durable fix is
  a per-requirement SLA window column, which also resolves the underlying conflict: the
  fixture's own label for that row is "SLA 12h = warn", which implies a window of ~48h,
  not 4h. Proposed for the Sprint 3 migration batch.

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
  labelled "SLA 12h · warn", but `warn` means 25% or less of the window remains, so 12h
  of runway implies a ~60h window while docs/DOMAIN.md gives stage `new` four hours. The
  resolution is `requirements.sla_window_hours`: derive the window from the stated runway
  and store it per requirement. Without that, seeded demo data decays within the hour.

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

- **Pages and their sidebar helper duplicate the same read model.** `/client` calls
  `getClientOverview()` and `ShellAside()` calls it again; `/vendor/roster` does the same
  with `getVendorRoster()`. React's `cache()` around each read-model entry point dedupes
  within a request without touching any page.

- **Never build a production bundle while `next dev` is running.** They share `.next` and
  the build fails with `Cannot find module for page`. Stop the dev server and delete
  `.next` first.

- **Bash heredocs fail on larger TypeScript and TSX files** in this environment
  (`unexpected EOF`). Use the Write tool for code; heredocs are fine for short appends.

- **Remote is `github.com/lakshyasonitv/DeployDesk`.** Commits must be authored as
  Lakshya Soni; an earlier run used the session account's name by mistake and had to be
  rewritten before pushing. Repo-local `user.name`/`user.email` are set accordingly.
