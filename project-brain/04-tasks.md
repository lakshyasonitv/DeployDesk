# 04 — Tasks

> Now = this/next session. Next = soon. Later = someday. Done = finished (newest on top,
> with date).
>
> Phase checkboxes live in `../docs/BUILD-PLAN.md` and are ticked there. This file is the
> working queue — what is actually in hand right now.

## Now — in order

- [ ] **1. Fix the `/ops` second-request hang.** Undo the `Promise.all` in
      `getOpsPipeline` and in `OpsAside` (it was a Sydney-latency fix, now obsolete), and
      raise `max` in `src/db/client.ts` to ~10. Diagnosis in `03-progress.md`.
- [ ] **2. Re-verify:** all 18 routes 200 cold AND warm, `db:verify` 21/21,
      `test:leak` 12/12, `next build` clean.
- [ ] **3. Commit the clean base** and push.
- [ ] **4. Prepare the camelCase rename migration** — `casing: "snake_case"` plus an
      append-only `ALTER TABLE ... RENAME COLUMN` for the 40 affected columns.
      **Show the SQL; do not run it.**

## Next — dual-role organisations, in the user's three stages

The 12 leak tests and 21 seed checks must stay green after each stage.

- [ ] **Stage 1 — schema.** ADR-012 (membership role SET + portal switcher becomes
      production, nothing wider). Then migration files for: `groups`, `org_capabilities`
      (authoritative, backfilled from `org_type`, with the Talentvibes-has-neither
      constraint and no app writes to `org_type`), `memberships` (unique on `user_id`,
      role set), `org_blocks` (bidirectional), `fee_model` per org
      (`hidden_markup` | `flat_declared_fee`, dual-role defaults to flat declared),
      `client_behaviour` score alongside `vendor_reliability`, and the probing signal.
      Plus RLS policy files. **SQL approved before anything runs.**
- [ ] **Stage 2 — matching.** Self-dealing rule (a resource whose vendor group equals the
      requirement's client group is never a candidate) in the matching function AND as a
      database policy, plus block-list enforcement in both. Tests that actively try to
      bypass both.
- [ ] **Stage 3 — UI.** Vendor-only org sees one workspace and no hint a hiring side
      exists (never a locked "Hire" tab). Dual-role gets a Hiring | Bench switcher, one
      broker thread per workspace, and the two rate views never on the same screen. Ops
      additions: dual-role badge, capability/group/fee/block-list controls, margin grouped
      per org, the ops-only "N matching people on this client's own bench" note, and the
      probing flag.
- [ ] Seed: one vendor-only org, one client-only org, one dual-role org, one pair of
      group-linked subsidiaries — realistic Indian IT data, in a file the user runs.

## Later

- [ ] Deployment is the user's: import the repo into their own Vercel account, set the
      four env vars. I must not touch Vercel.
- [ ] Ask the account owner to delete the stray `vaibhavalteryx-1351/deploydesk` project
      (its secrets are already overwritten).
- [ ] Rotate the Supabase database password — shared in chat, not yet confirmed rotated.
- [ ] Get the `v2` prototype file if it exists; the UI was built from v1.
- [ ] Flag to the design owner: client bands read higher than the mockups (ADR-004), and
      algorithm rank order differs in pools A, B and D (ADR-011). Both deliberate.
- [ ] RLS generally, beyond the dual-role policies — the second net the build plan wants.
- [ ] CI: typecheck, lint, migration check, leak suite.
- [ ] Restricted application DB role, so the app never connects as service role.
- [ ] Real Supabase Auth replacing the demo session in `src/lib/auth/session.ts`,
      including the portal check that returns 404 rather than 403.
- [ ] Import-boundary test: no client page may import the ops or vendor read models.

## Done

- [x] 2026-10-06 — All 15 design screens written; production build clean, 24 routes
- [x] 2026-10-06 — Moved the database from Sydney to Mumbai: warm query 410ms -> 30ms,
      seed 41.7s -> 4.7s, client/vendor pages 4-16s -> 0.4-3.2s. Functions pinned to bom1.
- [x] 2026-10-06 — Three dual-role decisions settled with the user before building
- [x] 2026-10-06 — Masked-shortlist send transaction with duplicate and eligibility
      pre-checks; three write paths with Zod, tenancy and audit rows
- [x] 2026-10-06 — Leak suite over the read models, 12/12 against live data
- [x] 2026-10-06 — Ops read model; all three portals now have one
- [x] 2026-10-06 — Migrations applied and seed verified, 21/21
- [x] 2026-10-06 — Schema for ~25 tables; derived-value and money libraries
- [x] 2026-10-06 — Fixture data extracted mechanically from the prototype
- [x] 2026-10-06 — Moved the ten spec docs into `docs/`, fixing CLAUDE.md's paths
- [x] 2026-10-06 — Pushed to `github.com/lakshyasonitv/DeployDesk`
- [x] 2026-10-06 — Project brain initialized
