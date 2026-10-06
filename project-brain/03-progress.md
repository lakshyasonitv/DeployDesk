---
project: talentvibes bench
status: active
last_log: 2026-10-06
---

# 03 — Progress

> The "you are here" map. Rewritten every session by /brain log. Keep the frontmatter
> above updated: `last_log` = date of the latest log, `status` = active | paused | done.

## Current state

**Goal set on 2026-10-06: deploy a working demo of all 15 screens to Supabase + Vercel,
today.** The backend foundation and the seed are written and typecheck clean; no UI exists
yet and nothing is deployed. Build order from here is sequential — see "Start here next
time".

What is real and verified:

- **Repo** — the ten spec docs now live in `docs/`, so the paths `CLAUDE.md` already used
  resolve (all ten checked). Git initialised, one commit. **Not pushed** — see Blocked.
- **Next.js app** scaffolded by hand (`create-next-app` refuses the directory name because
  it contains a space). 93 packages installed. Folder layout matches
  `docs/ARCHITECTURE.md`, including the three separate read-model folders ADR-003 requires.
- **Schema** — ~25 tables across six files in `src/db/schema/`, transcribed from
  `docs/DATA-MODEL.md`: tenancy, supply, demand, matching, ops. `npx tsc --noEmit` passes.
- **Derived-value library** — freshness (10/14-day thresholds, decay bar), SLA (25% warn
  boundary, `idle` pause), experience and age formatting. Nothing stored that
  `docs/DOMAIN.md` lists as derived.
- **Money** — bigint paise throughout, parsers for the fixtures' `₹1.38L` / `₹92K` /
  `₹1,38,000` forms, and `deriveRateBand()` implementing ADR-004 with the vendor rate
  deliberately absent from its signature.
- **Fixture extraction** — the prototype's data pulled out mechanically into
  `src/db/seed/prototype-fixtures.json` (63 KB) rather than retyped: 24 requirements,
  21 pool candidates, 27 distinct masked IDs, 23 per-screen arrays. Counts cross-checked
  against `docs/SEED-DATA.md` (1 SLA breach, 2 idle, 7 vendors, 5 clients, 3 owners).
- **Seed** — written in full across seven modules: orgs/users/skills, bench resources
  (fixtures + generated filler to 42 on the Nimbus bench), requirements, matches,
  the REQ-2291 shortlist, interviews, engagements, invoices, duplicate flags, the
  two-sided broker threads with a relayed message, audit rows, and the
  `sensitive_columns` tripwire registry. **Never executed** — no database yet.
- **Read models** — client and vendor portals done. Ops not started.

## Start here next time

**Sequential order. Do not start a step before the one above it is verified.**

1. **Unblock the database.** Needs the Supabase connection strings (see Blocked). Then
   `npm run db:push` to create the schema, and `npm run db:seed`.
2. **Verify the seed against the design** — spot-check that freshness states, the one SLA
   breach (REQ-2295), the two below-floor margins (TV-3964 at 17.4%, TV-4488 at 14.2%) and
   the six REQ-2291 shortlist bands all read correctly.
3. **Ops read model** — the last of the three. Pipeline, matching workspace, talent pool,
   margin, duplicates.
4. **Deploy a skeleton early.** One trivial page that reads one row, pushed to Vercel, to
   prove the whole pipe (pooler connection, env vars, build) before building 15 screens on
   top of an unproven path.
5. **UI** — shell and design tokens first, then screens in this order: client shortlist
   review → ops matching workspace → vendor roster (the same candidate rendered three
   ways, which is the demo), then the remaining twelve.
6. **Leak test** — point it at the read-model functions, not the route handlers, because
   the pages call the read models directly and that is the chokepoint both paths share.

## Milestones

- [x] **Phase 0** — Foundations *(partial: app, schema, config done; CI and the restricted
      DB role not done)*
- [ ] **Database live** — schema pushed and seeded on Supabase
- [ ] **Deployed skeleton** on Vercel, reading one real row
- [ ] **Ops read model**
- [ ] **UI shell** + design tokens
- [ ] **15 screens** — 0 of 15 built
- [ ] **Leak test** in CI
- [ ] Phases 1–12 proper — see `../docs/BUILD-PLAN.md`

## Blocked / waiting on

1. **Supabase connection strings.** Have the project URL
   (`cwjlrgzjloeqyailnfoj.supabase.co`) and the publishable key, but the publishable key
   cannot create tables. Need, from Project Settings → Database → Connection string:
   the **transaction pooler** URI (port 6543, for the app) and the **direct** URI
   (port 5432, for migrations and seeding). The Supabase MCP connector is installed but
   still unauthorised; `/mcp` would be the alternative.
2. **Git push refused** by the permission classifier ("Remote Repoint") when pushing to
   `github.com/lakshyasonitv/DeployDesk.git`. The remote is added and the repo is empty
   and reachable. Needs either an approval or the user running the push.
3. **Vercel token** not yet provided. Vercel MCP *is* authorised (team
   `vaibhavalteryx-1351`), so deploying is possible without it, but each redeploy then
   re-sends every file, which is slow when fixing build errors.

Not blocking, but outstanding: the ADR-004 band deviation and the ADR-011 scorer
divergence both need flagging to the design owner, since the built screens will not match
the mockups in those two specific ways — on purpose.
