# CLAUDE.md — DeployDesk by Talentvibes

This file is loaded on every session. Read it fully before writing code.

## What this product is

**DeployDesk by Talentvibes** is a **brokered marketplace for IT bench capacity**.

(Renamed 2026-10-07; it was "Talentvibes Bench Exchange". The repo, the git remote and the
design handoffs still carry the old name. In code the product name lives in exactly one
place: `BRAND` in `src/lib/ui/style.ts`.)

- **Vendors** (supplier companies) list idle engineers sitting on their bench.
- **Clients** (hiring companies) post requirements and hire those engineers.
- **Talentvibes** sits in the middle as the **sole broker**. The two sides never see
  or contact each other. Ever.

There are three portals over one backend: `client`, `vendor`, `ops`.
The frontend design for all three is specified in
**`design_handoff_bench_exchange_v2/`** — treat `README.md` (shell and global rules) and
`SCREENS.md` (every screen, with copy) as the UI contract, with `DESIGN_TOKENS.md` /
`tokens.css` for styling.

`design_handoff_bench_exchange/` (v1) is **superseded** — kept for history only, do not
build from it. Where v2's `DATA_MODEL.md` disagrees with this file or with the implemented
dual-role brief, three calls are already recorded in `project-brain/02-decisions.md` and
must not be re-opened from the handoff: groups are **declared in the MSA**, never inferred
from PAN/GST; SLA `warn` stays at 25% of the window, not an absolute 8h; and the client
never sees an exact client rate — **bands everywhere, placements included**.

## The one rule that matters most

> **A client must never learn who the vendor is. A vendor must never learn who the
> client is. Neither side may ever see the margin.**

This is not a nice-to-have; it is the entire commercial reason the product exists.
If the client can identify the supplier, they cut Talentvibes out and the business dies.

Consequences you must hold in your head at all times:

- **Masking is enforced on the server, never in the client app.** A portal's endpoint
  returns only the fields that portal is allowed to see. There is no "filter it in the
  UI" and no shared serializer that gets pruned per-caller.
- **Never write a shared DTO across portals.** `client/`, `vendor/` and `ops/` each get
  their own read models. If you find yourself adding `if (role === 'ops')` inside a
  serializer, stop — that is the wrong shape.
- Read `docs/MASKING.md` before touching **any** read path. It is the authoritative
  field-level visibility matrix and it is enforced by tests.

## Documentation map

Read the ones relevant to your task. Do not duplicate content between them — link instead.

| File | Read it when |
|---|---|
| `docs/ARCHITECTURE.md` | Setting up the project, adding a module, deciding where code lives |
| `docs/MASKING.md` | **Any** read endpoint, serializer, view, or RLS policy |
| `docs/DATA-MODEL.md` | Writing migrations, adding a table or column |
| `docs/DOMAIN.md` | Business rules, lifecycles, state machines, glossary |
| `docs/API.md` | Adding or changing an endpoint |
| `docs/MATCHING.md` | Anything touching ranking, scoring, eligibility gates |
| `docs/DECISIONS.md` | Before making a non-obvious technical choice — and after |
| `docs/BUILD-PLAN.md` | Deciding what to work on next |
| `docs/TESTING.md` | Writing tests, especially leak tests |
| `docs/SEED-DATA.md` | Populating a dev database |

## Stack (see ADR-001)

- **Runtime / API** — Next.js (App Router) route handlers, TypeScript, strict mode
- **Database** — Postgres on Supabase, with Row Level Security as a second net
- **Migrations / queries** — Drizzle ORM; all schema changes are checked-in SQL migrations
- **Auth** — Supabase Auth, JWT carries `org_id`, `org_type`, `role`
- **Jobs** — `pg_cron` for scheduled sweeps, DB-backed job table for async work
- **Email** — Resend
- **Assessments** — external proctoring provider behind an adapter interface (see ADR-006)

## Working agreements

1. **Migrations are append-only.** Never edit a migration that has been applied. Write a
   new one. Every migration has a matching `down`.
2. **Money is stored as `bigint` paise** (₹1,38,000 → `13800000`). Never floats, never
   strings, never rupees. Formatting to `₹1.38L` is a presentation concern and belongs
   in the frontend.
3. **Timestamps are `timestamptz` in UTC.** Business days, SLA clocks and the nightly
   freshness sweep run in **Asia/Kolkata**. Convert at the edges, never in the middle.
4. **Derived values are derived.** Freshness state, decay bar width, column counts, nav
   badges, margin colour thresholds, SLA state — all computed on read from timestamps and
   amounts. `docs/DOMAIN.md` lists exactly what must never be stored.
5. **Everything that changes a stage, a rate, a shortlist or a duplicate resolution writes
   an audit row.** No exceptions. This is a brokered marketplace; disputes will happen.
6. **Validate at the boundary with Zod schemas**, one per endpoint, colocated with the route.
   Never trust a client-supplied `vendor_id`, `client_org_id` or rate.
7. **No `SELECT *` on tables that carry masked columns.** Name your columns so a new
   sensitive column can't silently leak into an existing response.
8. **When a spec question is genuinely open**, add it to the "Open questions" section of
   `docs/DECISIONS.md` and pick the safest default (the one that reveals less). Do not
   invent business rules silently.

## Naming conventions

- Tables and columns: `snake_case`, plural table names.
- Public-facing business identifiers keep their design-specified format: requirements are
  `REQ-####`, masked resources `TV-####`, duplicate flags `DUP-####`, vendors `NSW-0142`.
  These are separate from the internal `uuid` primary keys and are never used as FKs.
- Route namespaces mirror portals: `/api/client/*`, `/api/vendor/*`, `/api/ops/*`.
- Never name a variable `rate` on its own. It is always `vendor_rate` or `client_rate`.
  Ambiguity here is how margins leak.

## Definition of done for any endpoint

- [ ] Zod-validated input
- [ ] Tenancy check: caller's `org_id` owns the resource being read or written
- [ ] Portal-specific read model — no forbidden field in the response shape
- [ ] Leak test added to the golden-fixture suite (`docs/TESTING.md`)
- [ ] Audit row written for state-changing actions
- [ ] RLS policy exists and is tested with the service role bypassed

## Project Brain

This project keeps persistent memory in `project-brain/`. At the START of every session,
before other work: read `project-brain/03-progress.md` and the newest dated file in
`project-brain/journal/`, then give a 2-line "where we left off" summary. After completing
meaningful work, update the brain (journal + progress + tasks; decisions with reasons into
`project-brain/02-decisions.md`). If the user forgets, proactively suggest `/brain log`.
