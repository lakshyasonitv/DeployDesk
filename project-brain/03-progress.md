---
project: talentvibes bench
status: active
last_log: 2026-10-06
---

# 03 — Progress

> The "you are here" map. Rewritten every session by /brain log. Keep the frontmatter
> above updated: `last_log` = date of the latest log, `status` = active | paused | done.

## Current state

**Sprints 1-3 complete, committed and pushed.** Latest commit: `a487cb7` on `main`
at `github.com/lakshyasonitv/DeployDesk`. Working tree clean.

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

## How to run this from a cold start

```bash
cd "C:/Users/Lakshya Soni/Documents/talentvibes bench"
npm ci                 # NOT `npm install` — it has silently rewritten package.json before
npm run dev            # http://localhost:3000
```

**`.env.local` is gitignored and will NOT be in a fresh clone.** It needs five values:

| Variable | Value |
|---|---|
| `DATABASE_URL` | Supabase **transaction** pooler, port **6543** (app runtime) |
| `DIRECT_URL` | Supabase **session** pooler, port **5432** (migrations, seed, verify) |
| `IDENTITY_PEPPER` | any non-empty string; the seed falls back if unset |
| `NEXT_PUBLIC_SUPABASE_URL` | `https://fmgwcspsuljefhfdcqen.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | the browser-safe anon key |

Both URLs are `aws-0-ap-south-1.pooler.supabase.com`. Do **not** use
`db.<ref>.supabase.co` — it has no IPv4 record and will not resolve. The password must be
percent-encoded (`@` becomes `%40`). Ask the user for credentials; do not guess.

### The commands that matter

| Command | What it does |
|---|---|
| `npm run dev` | dev server; **slow by design**, judge speed on `next start` instead |
| `npm run build` | production build — **stop `next dev` and `rm -rf .next` first**, or it fails with `Cannot find module for page` |
| `npx next start -p 3000` | production server, what to measure |
| `npm run db:seed` | reseed (~4s). **Run before any demo** — see the SLA decay note above |
| `npm run db:verify` | 21 assertions over the seeded data |
| `npm run test:leak` | 12 masking leak tests against live data |
| `npm run db:apply -- --dry` | list pending hand-written SQL migrations, touch nothing |
| `npm run db:apply` | apply them |

### Rules the user set, which still apply

1. **Never run a script that WRITES to Supabase without asking first and showing the exact
   SQL.** Migrations are files in the repo; seed data is a file the user runs. Read-only
   verification (`db:verify`, `test:leak`) is allowed.
2. **Never touch Vercel.** The Vercel connection available to this session belongs to a
   different account. The user deploys from their own.
3. **Work in sprints.** Each one ends at a committed, verified state; do not run on
   continuously. The four gates are at the top of `04-tasks.md`.
4. **Update this brain as you go**, not at the end — the user has asked twice.

## Start here next time

Two small things first, both ~15 minutes, both listed in `04-tasks.md`:

1. **Wire `requirements.sla_window_hours`.** The column exists (migration 0002) but
   nothing reads or writes it, so `db:verify` still decays to 20/21 hours after a seed.
   Needs: `slaFor()` in `src/lib/derived.ts` to accept an override and prefer it over the
   per-stage default; `slaDueAtFor()` in `src/db/seed/demand.ts` to write the window it
   actually used; and `getOpsPipeline()` in `src/read-models/ops/index.ts` to pass the
   column through. Then `db:verify` should hold at 21/21 regardless of elapsed time.
2. **`git worktree remove ../tv-bench-BEFORE`** — the Sprint 2 comparison copy. Its
   `node_modules` junction is already deleted; do not recreate one (see Gotchas).

**Then Sprint 4 — the self-dealing rule.** A resource whose supplying org is in the same
`group_id` as the requirement's client org must never be returned as a candidate. It has
to live in two places so an application bug cannot bypass it:

- the matching query — `getOpsMatchingWorkspace()` in `src/read-models/ops/index.ts`, and
  wherever matches are computed for a requirement;
- the database — a policy or constraint, alongside the existing `orgs_are_blocked(a, b)`
  helper from migration 0002, which is already symmetric and ready to use.

Block-list enforcement goes in the same two places. Then tests that **actively try to
bypass** both rules, not merely tests that they work — the user asked for that explicitly.
New SQL goes in a migration file with the SQL shown for approval before it runs.

## Milestones

- [x] **Sprint 1** — all 15 design screens; database live in Mumbai; `/ops` hang and the
      `statement_timeout` leak fixed
- [x] **Sprint 2** — performance: cheap sidebars, `/ops/margin` 10 queries to 2
- [x] **Sprint 3** — dual-role schema (33 tables), ADR-012, camelCase rename, 22 RLS
      policies, CVE-2025-66478 patched, hardcoded data removed from the rendering path
- [ ] **Sprint 4** — self-dealing rule + block list, in the matching query AND the
      database, with bypass tests
- [ ] **Sprint 5** — dual-role UI (workspace switcher, ops console additions)
- [ ] Deployed — the user's to do; see Blocked
- [ ] `sla_window_hours` wired, so `db:verify` stops decaying to 20/21
- [ ] RLS made effective — the 22 policies exist but are inert until the app connects as a
      restricted role with real Supabase Auth. Read models remain the only live net.
- [ ] Real Supabase Auth replacing the demo session in `src/lib/auth/session.ts`

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
