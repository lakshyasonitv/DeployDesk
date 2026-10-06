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

- **Never build a production bundle while `next dev` is running.** They share `.next` and
  the build fails with `Cannot find module for page`. Stop the dev server and delete
  `.next` first.

- **Bash heredocs fail on larger TypeScript and TSX files** in this environment
  (`unexpected EOF`). Use the Write tool for code; heredocs are fine for short appends.

- **Remote is `github.com/lakshyasonitv/DeployDesk`.** Commits must be authored as
  Lakshya Soni; an earlier run used the session account's name by mistake and had to be
  rewritten before pushing. Repo-local `user.name`/`user.email` are set accordingly.
