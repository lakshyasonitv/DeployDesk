---
project: talentvibes bench
status: active
last_log: 2026-10-07
---

# 03 — Progress

> The "you are here" map. Rewritten every session by /brain log. Keep the frontmatter
> above updated: `last_log` = date of the latest log, `status` = active | paused | done.

## Current state

**Sprints 1-5 complete and pushed.** On 2026-10-07: the four Sprint 5 bugs were each
proved fixed with evidence, the `/vendor` dashboard went **481ms → 144ms**, the product was
renamed **DeployDesk by Talentvibes**, and the user added
`design_handoff_bench_exchange_v2/` and chose to adopt it **in full**. **Sprint 7a (the v2
foundation) is done**: the whole token set with a working light/dark toggle, Plus Jakarta
Sans + IBM Plex Mono, a rewritten 260px light shell with a 60px top bar, and 790 scripted
hex-to-token replacements across 23 files.

- **Database** — Supabase `fmgwcspsuljefhfdcqen`, ap-south-1 (Mumbai). Counted live on
  2026-10-07: **35 base tables and 5 views**, 22 RLS policies, 4 migrations applied.
  The arithmetic, because two nearby numbers look like a contradiction and are not:
  30 original + 4 dual-role (`groups`, `org_capabilities`, `memberships`, `org_blocks`)
  + `applied_sql_migrations` (the hand-written-SQL ledger) = 35. `db:seed` reports
  "reset 34 tables" because it owns everything except that ledger. The 5 views are
  2 probing + 2 portal engagement + `ops_v_own_bench_matches`.
- **Next.js 15.5.27** — patched for CVE-2025-66478 (CVSS 10.0 RCE in the RSC protocol).
  15.5.4 was vulnerable and Vercel refused to deploy it.
- **All screens built**, **19 routes**, every one 200 cold and warm. Warm page loads
  0.13-1.03s in production (`/ops/matching/[code]` is the slowest; `/vendor` 0.27s).
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

**Sprint 7b — the shell's interactive parts.** 7a (the v2 foundation) is done, verified and
committed; the user chose **Full v2**, staged 7a–7e. 7a left these as static markup:

1. the **Cmd-K command palette** — 620px modal, 86px from top, 45% dim overlay, results
   grouped by portal; the sidebar search button should open it
2. **toasts with Undo**, bottom-centre, `--t1` background, 6s auto-hide — v2 rule 4 wants
   one on every state-changing action, so this pairs with the three write paths
3. the **portal switcher dropdown** (322px menu; currently three inline top-bar links)
4. the **Ask Talentvibes drawer** (client, 412px) — switching portal must close it
5. the **ops dark internal-view strip** under the top bar

Then **7c–7e**: the 16 screens against `SCREENS.md`, plain-language copy inside page bodies
(7a only renamed the nav), and responsiveness from ~900px.

**Before any further colour work**, re-run the invisible-text scan — the check for
declarations whose `color` and `background` resolve to the same token. It currently reports
0 and it is the only cheap guard against a token swap making text disappear.

### Also still open: Sprint 6 — dual-role UI

Independent of the v2 work. Everything it needs exists in the data layer.

- A supply-only org must see **one workspace and no hint a hiring side exists** — not a
  disabled "Hire" tab. `org_capabilities` says which sides an org holds; `memberships.roles`
  says which the user holds.
- A dual-role org gets a "Hiring | Bench" switcher. **The two rate views must never appear
  on the same screen for the same org** — that is how it would infer the platform margin,
  and it is the reason dual-role orgs default to `flat_declared_fee`.
- One broker thread per workspace, never mixed.
- Ops console: dual-role badge, capability/group/fee/block-list controls, margin grouped
  per org, and the probing-flag indicator. `getOpsMatchingWorkspace()` already returns
  `ownBenchMatches` (14 for Cygnet), which no screen renders yet.
- Acceptance tests 1, 2, 5 and 6. Test 2 has data: Cygnet's admin holds
  `[supply, demand, admin]`.

Demo tenant: **Cygnet Infotech Labs** at `/ops/matching/REQ-2320`.

### Verified state at the end of 2026-10-07

All four gates green: **19 routes 200** (both dynamic routes included), `db:verify`
**25/25**, `test:leak` **30/30**, build and typecheck clean. The v2 tokens, both palettes
and both self-hosted font faces were verified in the **served** stylesheet, not just the
source.
