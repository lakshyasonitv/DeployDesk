# BUILD-PLAN.md

Phases are ordered so that each one ends with something demonstrable, and so that the
masking guarantees exist **before** any data that could leak does. Do not reorder Phase 1
and Phase 2.

Mark items done in this file as you go.

---

## Phase 0 — Foundations

- [ ] Next.js + TypeScript project, strict mode, path aliases
- [ ] Supabase project; local dev via the Supabase CLI so migrations run offline
- [ ] Drizzle configured; first migration creates extensions (`pgcrypto`, `citext`,
      `pg_trgm`, `pg_cron`)
- [ ] Restricted application database role — the app never connects as service role
- [ ] Environment schema validated at boot (fail fast on a missing pepper or key)
- [ ] Structured logging with a request id; PII never logged, not even in error paths
- [ ] CI: typecheck, lint, migration check, test

**Done when** `pnpm dev` boots against a local Postgres with zero tables and CI is green.

---

## Phase 1 — Tenancy, auth and the masking harness

Build the enforcement machinery before the data it protects.

- [ ] `organizations`, `vendor_profiles`, `client_profiles`, `users`, `audit_log`
- [ ] Supabase Auth wired; JWT carries `org_id`, `org_type`, `role`
- [ ] Guard helpers: `requirePortal('client'|'vendor'|'ops')`, `requireRole`,
      `assertOwnership`
- [ ] RLS policies on every table created so far, tested with the service role bypassed
- [ ] Read-model folder structure with a lint rule forbidding imports across
      `read-models/client`, `/vendor`, `/ops`
- [ ] `sensitive_columns` registry seeded, plus the build step that fails when a tagged
      column appears in a client/vendor view
- [ ] Leak-test harness with golden fixtures — passing trivially, but wired into CI
- [ ] Audit-log helper used by one write path end to end

**Done when** a vendor user hitting `/api/client/overview` gets a 404, the leak suite runs
in CI, and adding a tagged column to a client view fails the build.

---

## Phase 2 — Supply side (vendor)

- [ ] `skills` taxonomy + seed, alias resolution, `skill_review_queue`
- [ ] `bench_resources`, `resource_skills`, `employment_history`
- [ ] Masked ID allocator — random, collision-safe, never reused (ADR-010)
- [ ] Identity hashing with a server-side pepper
- [ ] `availability_confirmations` + single and bulk confirm endpoints
- [ ] `v_resource_freshness` view; freshness derived on read, never stored
- [ ] Vendor roster endpoints with the five filter states from the design
- [ ] Bulk import: upload → async parse → `bulk_import_rows` → review queue → list
- [ ] CSV template + export
- [ ] Nightly freshness sweep job and the expiring-profiles email

**Done when** a vendor can add a resource, bulk-upload a sheet, see accurate freshness
states, and confirm availability in one click and in bulk.

---

## Phase 3 — Assessments

- [ ] `assessments` table with the four section scores
- [ ] `AssessmentProvider` adapter interface (ADR-006) + first implementation
- [ ] Invite, resend, nudge endpoints
- [ ] Signed webhook receiver, idempotent on `provider_ref`
- [ ] 90-day validity, expiry job, 60-day retake rule
- [ ] Name-free `summary_json` generation; raw report locked to ops
- [ ] Verify no write path to a score column exists from `/api/vendor/*`

**Done when** an invited candidate's completed test lands a score and breakdown on the
roster, and a 91-day-old score reads as expired without anyone touching it.

---

## Phase 4 — Demand side (client)

- [ ] `requirements` + `requirement_skills` + `requirement_stage_events`
- [ ] Post-a-requirement endpoint matching the design's form exactly (bands, notice
      multi-select, engagement type, hybrid days)
- [ ] Live match preview — aggregate-only, rate-limited, counts below 5 suppressed
- [ ] SLA calculation with IST business hours and a holiday calendar table
- [ ] `v_requirement_sla`; SLA sweep job
- [ ] Client dashboard endpoint with all four metric cards

**Done when** posting a requirement produces correct SLA states over a simulated clock, and
the preview endpoint cannot be used to isolate a single profile.

---

## Phase 5 — Matching (ops)

- [ ] `matching_weights` table, versioned
- [ ] Six component scorers, each unit-tested against hand-worked examples
- [ ] Eligibility gates
- [ ] Proposed client rate calculation with the margin floor behaviour from
      `docs/MATCHING.md`
- [ ] `matches` table, algo rank, manual rank, include set, reset
- [ ] Ops matching workspace endpoints, including the expanded unmasked profile
- [ ] Reason-line generation
- [ ] Recomputation triggers — verify they never clobber `manual_rank` or `included`

**Done when** the seeded pools from `docs/SEED-DATA.md` reproduce the design's rank order,
and a nightly recompute leaves a broker's manual ordering intact.

---

## Phase 6 — Shortlists — the hero path

- [ ] `shortlists` + `shortlist_items` snapshot
- [ ] Rate band derivation from the **client** rate (ADR-004) with its own unit tests
- [ ] The atomic `send` transaction, with duplicate and eligibility pre-checks
- [ ] Client shortlist read path, sourced only from `shortlist_items`
- [ ] Selection and request-interviews endpoints
- [ ] Leak tests: no vendor name, no exact vendor rate, no margin, no `resource_id`, and
      no band overlapping a vendor rate anywhere in a client response

**Done when** the client shortlist screen renders entirely from snapshot data and the leak
suite proves it.

---

## Phase 7 — Brokering

- [ ] `broker_threads` (two-sided) + `broker_messages`
- [ ] Thread scoping: general, requirement, candidate, interview
- [ ] Client and vendor message endpoints; ops relay with `relayed_from_id`
- [ ] Auto-flagging for relay preview — org names, amounts, contacts, URLs, person names
- [ ] Notifications and unread counts
- [ ] Verify: no query in any portal namespace can reach the counterpart thread

---

## Phase 8 — Interviews and feedback

- [ ] `interviews`, `interview_panelists`, `interview_feedback`
- [ ] Client proposes slots → `awaiting_vendor` → ops confirms with a Talentvibes-issued
      meeting link
- [ ] Feedback capture with four 1–5 ratings and an outcome
- [ ] Redacted relay of feedback to the vendor
- [ ] Feedback-due SLA and reminders

---

## Phase 9 — Placements, margin and billing

- [ ] `engagements`, `rate_changes`
- [ ] `v_engagement_margin`; margin floor guardrail and exception approval
- [ ] Ops margin screen endpoints
- [ ] `invoices` / `invoice_lines`, receivable and payable, with pro-rata
- [ ] Monthly billing job
- [ ] Vendor earnings endpoints — payable only, structurally unable to join receivable
- [ ] Statement export

---

## Phase 10 — Duplicates

- [ ] `duplicate_flags` with the signals payload shape
- [ ] Detection on create, on import, and nightly
- [ ] Confidence scoring, configurable weights and thresholds
- [ ] Blocking behaviour on shortlist send
- [ ] Resolution endpoints and the recommendation logic
- [ ] Notify the losing vendor without naming the other vendor

---

## Phase 11 — Ops console completeness

- [ ] Pipeline board and list with server-side grouping, counts and per-column pagination
- [ ] Filters: search, my desk, SLA at risk, needs sourcing
- [ ] Stage moves with undo (as a forward transition, per `docs/DOMAIN.md`)
- [ ] Talent pool search with saved views and audited export
- [ ] Org and user administration
- [ ] Audit log browser

---

## Phase 12 — Hardening before launch

- [ ] Full leak suite across every client and vendor endpoint, with a populated database
- [ ] Rate limiting on preview, search and export endpoints
- [ ] File metadata stripping on anything served cross-side
- [ ] PII retention job (open question Q7)
- [ ] Backup and restore rehearsed, including a point-in-time restore drill
- [ ] Runbooks: duplicate escalation, mis-sent shortlist recall, margin exception review
- [ ] Load test the pipeline at 500 requirements and the pool at 20k profiles

---

## Anti-goals

Do not build, unless someone asks with a reason:

- A shared "candidate" API across portals
- Client-side masking of any kind
- Direct browser access to Supabase for business data
- Real-time websockets (polling is sufficient — see `docs/API.md`)
- A recommendation model that cannot explain its ordering to a broker
- Mobile layouts (the design targets desktop ≥ 1280px)
