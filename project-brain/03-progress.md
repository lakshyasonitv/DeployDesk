---
project: talentvibes bench
status: active
last_log: 2026-10-06
---

# 03 — Progress

> The "you are here" map. Rewritten every session by /brain log. Keep the frontmatter
> above updated: `last_log` = date of the latest log, `status` = active | paused | done.

## Current state

**Sprints 1-5 complete, committed and pushed.** Latest commit: `c571083` on `main`
at `github.com/lakshyasonitv/DeployDesk`. Working tree clean.

- **Database** — Supabase `fmgwcspsuljefhfdcqen`, ap-south-1 (Mumbai). **33 tables**
  (the original 30 plus groups, org_capabilities, memberships, org_blocks), 2 probing
  views, 2 portal engagement views, 22 RLS policies, 4 migrations applied.
- **Next.js 15.5.27** — patched for CVE-2025-66478 (CVSS 10.0 RCE in the RSC protocol).
  15.5.4 was vulnerable and Vercel refused to deploy it.
- **All 15 design screens**, 18 routes, every one 200 cold and warm. Warm page loads
  0.26-0.60s in production.
- **Gates: all four green** — routes 19/19 (twice each) · db:verify **25/25** ·
  test:leak **30/30** · build and typecheck clean.
- **Self-dealing and block list enforced twice** — in the matching query and by a database
  trigger, with four tests that attempt a bypass and a control that proves the rule is not
  simply refusing everything.
- **Perceived performance** — TTFB ~0.01s via streamed loading skeletons; total time to
  full content 0.19-0.53s. Fonts self-hosted; no third-party request on the critical path.
- **No hardcoded data in the rendering path.** Two audit passes. Fixed: the client
  dashboard feedback count, the broker name, the interviews feedback card, the sidebar
  signed-in user, the talent pool client-rate column, the vendor pipeline skills, the
  portal switcher's org names, the landing-page tenants, the margin period label and the
  vendor payment-cycle figure. Business rules (SLA windows, margin thresholds) and design
  copy remain constants on purpose — see the note in 04-tasks.md before "fixing" them.

### Deployment: live and fast

**URL: https://deploy-desk-peach.vercel.app** — unprotected, serving the current build.

The slowness is resolved. It was a region mismatch: functions executed in `iad1`
(Washington DC) against the ap-south-1 (Mumbai) database, so every query paid a ~200ms
cross-continent round trip. `x-vercel-id` read `bom1::iad1`. The code-level
`preferredRegion = ["bom1"]` was deployed and ignored — Hobby plan runs all functions in
the project's single configured region. The user changed Settings → Functions → Function
Region to Mumbai. Now `bom1::bom1`, and measured live:

| Route | before (iad1) | after (bom1) |
|---|---|---|
| `/` | 2.5-2.8s | **0.19s** |
| `/ops/margin` | 0.59-1.16s | 0.16s steady |
| `/client` | 0.36-1.0s | 0.17-0.21s |
| `/vendor/roster` | 0.37-0.42s | 0.17-0.23s |

**Always confirm the function region with `x-vercel-id`, not with the code export.**
First cold hit after idle can still be ~0.26-0.79s; steady state is ~0.17s.

### SLA decay: fixed and verified

`db:verify` used to drift to 19/21 during the day; it now holds at **21/21**. The window
is derived from the runway each fixture states and stored in
`requirements.sla_window_hours`, which the seed writes and both the ops read model and the
verifier prefer over the per-stage default. Seeded data stays correct for about 4 hours
(the shortest stated runway) against 36 minutes before. Re-seed
(`npm run db:seed`, ~4s) if it is older than that.

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

**Sprint 6 — dual-role UI**, the last stage of the dual-role brief. Everything it needs
now exists in the data layer. Definition in `04-tasks.md`; the shape of it:

- A supply-only org must see **one workspace and no hint a hiring side exists** — not a
  disabled "Hire" tab. `org_capabilities` says which sides an org holds; `memberships.roles`
  says which the user holds.
- A dual-role org gets a "Hiring | Bench" switcher. **The two rate views must never appear
  on the same screen for the same org** — that is how it would infer the platform margin,
  and it is the reason dual-role orgs default to `flat_declared_fee`.
- One broker thread per workspace, never mixed.
- Ops console: dual-role badge, capability/group/fee/block-list controls, margin grouped
  per org (billed as client, paid as supplier, net position), and the probing-flag
  indicator. The ops-only own-bench note is already wired — `getOpsMatchingWorkspace()`
  returns `ownBenchMatches`, which no screen renders yet.
- Acceptance tests 1, 2, 5 and 6. Test 2 has data: Cygnet's admin holds
  `[supply, demand, admin]`.

The demo tenant for this is **Cygnet Infotech Labs** — dual-role, 14 people on its own
bench, and its own requirement `REQ-2320` at `/ops/matching/REQ-2320`.

## Milestones

- [x] **Sprint 1** — all 15 design screens; database live in Mumbai; `/ops` hang and the
      `statement_timeout` leak fixed
- [x] **Sprint 2** — performance: cheap sidebars, `/ops/margin` 10 queries to 2
- [x] **Sprint 3** — dual-role schema (33 tables), ADR-012, camelCase rename, 22 RLS
      policies, CVE-2025-66478 patched, hardcoded data removed from the rendering path
- [x] **Sprint 4** — responsiveness (TTFB 0.30-0.60s to ~0.01s), self-hosted fonts,
      durable SLA windows, last hardcoded data removed
- [x] **Sprint 5** — self-dealing rule + block list in both the query and the database,
      30 tests, 10 further edge scenarios
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
