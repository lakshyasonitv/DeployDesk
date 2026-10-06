---
project: talentvibes bench
status: active
last_log: 2026-10-06
---

# 03 — Progress

> The "you are here" map. Rewritten every session by /brain log. Keep the frontmatter
> above updated: `last_log` = date of the latest log, `status` = active | paused | done.

## Current state

**Sprint 1 is complete, committed and pushed (`2313554`). All four gates green. Both of
the connection-pool defects are fixed and re-verified on a production build.** A second, larger workstream
(dual-role organisations) has been specified and scoped but not started.

Working and verified:

- **Database** — Supabase, now in **ap-south-1 (Mumbai)**, project `fmgwcspsuljefhfdcqen`.
  30 tables, migrated and seeded. `npm run db:verify` → **21/21 pass**.
  `npm run test:leak` → **12/12 pass** against live data.
- **Region move paid off enormously.** The project started in ap-southeast-2 (Sydney):
  warm query ~410ms from India, ~3s per new connection, full seed 41.7s. In Mumbai the
  same warm query is **~30ms** and the seed takes **4.7s**. Client and vendor pages went
  from 4–16s to 0.4–3.2s. Functions are pinned to `bom1` to stay co-located.
- **Build** — `next build` compiles 24 routes, all correctly dynamic (`ƒ`), no prerender
  of database data.
- **Screens** — all 15 from the design handoff, plus three extras (client requirements
  list, shortlists index, engagements). Client and vendor routes all return 200 fast.
- **Write paths** — three, each with Zod at the boundary, org from the session rather
  than the request body, a tenancy check and an audit row: availability confirm, stage
  move, and the masked-shortlist send transaction (duplicate + eligibility pre-checks,
  snapshot, stage move, audit, all atomic).

## Start here next time

**Sprint 2 — performance.** Full definition, with the measured numbers, is in
`04-tasks.md`. In one line: pages fetch the same data twice and the sidebars run entire
read models for three badge numbers, so wrap the read models in React `cache()` and give
the sidebars their own cheap COUNT queries.

Sprints 3, 4 and 5 are dual-role organisations, in the three stages the user set. Sprint 3
is schema and RLS **files only** — the SQL goes to the user for approval before anything
touches Supabase, and the camelCase column rename is folded into the same batch so there
is one review rather than two.

## Milestones

- [x] Database live, migrated, seeded, verified (21/21)
- [x] Three read models, one per portal, no shared base (ADR-003)
- [x] Leak suite over the read models (12/12)
- [x] All 15 design screens written
- [x] Production build clean, 24 routes
- [x] **`/ops` second-request hang fixed** (and the `statement_timeout` leak)
- [ ] Deployed — the user deploys from their own Vercel account; see Blocked
- [ ] camelCase column rename — folded into the Sprint 3 SQL review
- [ ] Sprint 2: performance (dedupe + cheap sidebars)
- [ ] Sprint 3: dual-role schema + RLS files
- [ ] Sprint 4: matching function + bypass tests
- [ ] Sprint 5: dual-role UI
- [ ] RLS generally — still absent; read models are the only net today

## Blocked / waiting on

1. **Deployment is the user's to do.** They asked that I not touch Vercel: the connection
   I have is to a different account. Code is pushed to
   `github.com/lakshyasonitv/DeployDesk`. They import the repo in their own Vercel
   account and set four env vars: `DATABASE_URL` (transaction pooler, 6543),
   `IDENTITY_PEPPER`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
2. **A stray Vercel project exists on the wrong account** (`vaibhavalteryx-1351/deploydesk`),
   created before the user said to stay off Vercel. Its two secret env values have been
   overwritten with placeholders, so the credential is no longer stored there, but the
   project itself can only be deleted by that account's owner.
3. **The Supabase password has been shared in chat twice** and was briefly stored in that
   stray project. Rotation was recommended and has not been confirmed done.
4. **No `v2` prototype in the repo.** The user referred to
   "Talentvibes Bench Exchange v2.dc.html"; only the v1 file is present. The UI was built
   from v1 plus the 50KB handoff README.

Also outstanding, not blocking: the ADR-004 band deviation and the ADR-011 scorer
divergence both need raising with the design owner, since the built screens deliberately
differ from the mockups in those two ways.
