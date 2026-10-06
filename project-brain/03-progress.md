---
project: talentvibes bench
status: active
last_log: 2026-10-06
---

# 03 — Progress

> The "you are here" map. Rewritten every session by /brain log. Keep the frontmatter
> above updated: `last_log` = date of the latest log, `status` = active | paused | done.

## Current state

**Sprints 1-3 complete, committed and pushed.** Latest: `784d4f9`.

- **Database** — Supabase `fmgwcspsuljefhfdcqen`, ap-south-1 (Mumbai). **33 tables**
  (the original 30 plus groups, org_capabilities, memberships, org_blocks), 2 probing
  views, 2 portal engagement views, 22 RLS policies, 4 migrations applied.
- **Next.js 15.5.27** — patched for CVE-2025-66478 (CVSS 10.0 RCE in the RSC protocol).
  15.5.4 was vulnerable and Vercel refused to deploy it.
- **All 15 design screens**, 18 routes, every one 200 cold and warm. Warm page loads
  0.26-0.60s in production.
- **Gates:** routes 18/18 · test:leak 12/12 · build clean · typecheck clean ·
  db:verify **20/21** (the one failure is SLA time decay, explained below).
- **No hardcoded data in the rendering path.** Audited and fixed: the client dashboard
  feedback count, the broker name, the interviews feedback card, the sidebar signed-in
  user, and the talent pool client-rate column. All five now query the database.

### The one known failing check

db:verify's "exactly one SLA breach" drops to 20/21 a few hours after each seed.
REQ-2302 is stage `new`, whose documented window is 4 business hours, and the fixture
wants it in `warn` — which means 25% or less remaining, so its deadline sits under an hour
out and ages into `late`. **Not a regression and not a code defect.** Migration 0002 added
`requirements.sla_window_hours` to fix it properly, but nothing reads or writes that
column yet. Until that is wired: run `npm run db:seed` (~4s) shortly before a demo.

## Start here next time

**Sprint 4 — dual-role matching and bypass tests.** Definition in `04-tasks.md`. The
self-dealing rule (a resource whose vendor group equals the requirement's client group is
never a candidate) goes in the matching query AND as a database rule, with tests that
actively try to bypass both, plus block-list enforcement in the same two places.

Before that, two small follow-ups Sprint 3 created, both listed in `04-tasks.md`: wire
`sla_window_hours` so db:verify stops decaying, and remove the ../tv-bench-BEFORE worktree.

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
