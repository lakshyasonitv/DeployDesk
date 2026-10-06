---
project: talentvibes bench
status: active
last_log: 2026-10-06
---

# 03 — Progress

> The "you are here" map. Rewritten every session by /brain log. Keep the frontmatter
> above updated: `last_log` = date of the latest log, `status` = active | paused | done.

## Current state

**Sprints 1-4 complete, committed and pushed.** Latest commit: `f77c17d` on `main`
at `github.com/lakshyasonitv/DeployDesk`. Working tree clean.

- **Database** — Supabase `fmgwcspsuljefhfdcqen`, ap-south-1 (Mumbai). **33 tables**
  (the original 30 plus groups, org_capabilities, memberships, org_blocks), 2 probing
  views, 2 portal engagement views, 22 RLS policies, 4 migrations applied.
- **Next.js 15.5.27** — patched for CVE-2025-66478 (CVSS 10.0 RCE in the RSC protocol).
  15.5.4 was vulnerable and Vercel refused to deploy it.
- **All 15 design screens**, 18 routes, every one 200 cold and warm. Warm page loads
  0.26-0.60s in production.
- **Gates: all four green** — routes 18/18 (twice each) · db:verify **21/21** ·
  test:leak 12/12 · build and typecheck clean.
- **Perceived performance** — TTFB ~0.01s via streamed loading skeletons; total time to
  full content 0.19-0.53s. Fonts self-hosted; no third-party request on the critical path.
- **No hardcoded data in the rendering path.** Two audit passes. Fixed: the client
  dashboard feedback count, the broker name, the interviews feedback card, the sidebar
  signed-in user, the talent pool client-rate column, the vendor pipeline skills, the
  portal switcher's org names, the landing-page tenants, the margin period label and the
  vendor payment-cycle figure. Business rules (SLA windows, margin thresholds) and design
  copy remain constants on purpose — see the note in 04-tasks.md before "fixing" them.

### Deployment: why it felt slow

Measured rather than guessed. **The region is correct** — the deployed functions run in
`bom1`, co-located with the Mumbai database, confirmed by `x-vercel-id` on a live
response. Two real causes:

1. **The URL being tested is a PREVIEW deployment with Vercel Deployment Protection on,**
   so every request 302s to `vercel.com/sso-api` and back before the app runs. Use the
   production deployment, or turn Deployment Protection off. Note
   `deploy-desk.vercel.app` is a 182-byte placeholder belonging to something else, not
   this app.
2. **No loading states** — fixed in Sprint 4. TTFB went 0.30-0.60s → ~0.01s.

### SLA decay: fixed

`db:verify` used to drift to 19/21 during the day. The window is now derived from the
runway each fixture states and stored in `requirements.sla_window_hours`. The shortest
runway is 4 hours instead of 36 minutes, so a demo day holds. Re-seeding
(`npm run db:seed`, ~4s) is still worth doing if the data is more than a few hours old.

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

**Sprint 5 — the self-dealing rule and bypass tests** (was Sprint 4; renumbered after the
performance sprint was inserted). A resource whose supplying org shares a `group_id` with
the requirement's client org must never be returned as a candidate. It has to live in two
places so an application bug cannot bypass it:

- the matching query — `getOpsMatchingWorkspace()` in `src/read-models/ops/index.ts`, and
  wherever matches are computed for a requirement;
- the database — a policy or constraint, alongside the `orgs_are_blocked(a, b)` helper
  from migration 0002, which is already symmetric and ready to use.

Block-list enforcement goes in the same two places. Then tests that **actively try to
bypass** both rules, not merely tests that they work — the user asked for that explicitly.
New SQL goes in a migration file with the SQL shown for approval before it runs.

One measured item worth doing first if the bench grows: `getVendorRoster` moves 173 rows
to render 9 and has no LIMIT. Fine at 42 resources, not at the 2,000 launch target. See
the note at the end of Sprint 4 in `04-tasks.md`.

## Milestones

- [x] **Sprint 1** — all 15 design screens; database live in Mumbai; `/ops` hang and the
      `statement_timeout` leak fixed
- [x] **Sprint 2** — performance: cheap sidebars, `/ops/margin` 10 queries to 2
- [x] **Sprint 3** — dual-role schema (33 tables), ADR-012, camelCase rename, 22 RLS
      policies, CVE-2025-66478 patched, hardcoded data removed from the rendering path
- [x] **Sprint 4** — responsiveness (TTFB 0.30-0.60s to ~0.01s), self-hosted fonts,
      durable SLA windows, last hardcoded data removed
- [ ] **Sprint 5** — self-dealing rule + block list, in the matching query AND the
      database, with bypass tests
- [ ] **Sprint 6** — dual-role UI (workspace switcher, ops console additions)
- [ ] Deployed — the user's to do; see Blocked
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
