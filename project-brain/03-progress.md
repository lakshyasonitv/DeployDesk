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

## Where to look first

**`05-status.md` is the honest picture** — what works end to end, what is half done (an
endpoint with a dead button), and the 16 controls that still do nothing, each with a note on
whether it needs a data model, an external system, or just work. It was verified by
inspection on 2026-10-07, not written from memory, and it carries the commands to re-verify.

## People working, and one layout bug

`/client/engagements` rows now open a **placement panel** — the contract, the engineer, the
independent test result, and a working **"Request an extension"** (`extension_requests`, the
last of migration 0005's tables to be wired). New client read path
`getClientEngagements`, three leak tests, 113 tests green.

**The panel carries no name, and says why on screen.** A name is a side channel to the
supplier: name → public profile → current employer. `docs/MASKING.md:20` is a flat `❌` with
no placement exception, and `SCREENS.md:99` says the same for this screen. Showing the name
post-placement was put to the owner and declined.

Also fixed, reported from the screen: the shortlist candidate cards stretched past the
viewport. `<ScoreBars width={9999} />` — full width was unrepresentable, so a sentinel number
stood in, and **`1fr` is `minmax(auto, 1fr)`**, so the child's min-content width became the
column's minimum. `tests/layout-guards.test.ts` now fails any pixel width over 2000px.

## Vocabulary

Plain-language pass across all three portals, 2026-10-07. The audit — what changed, what is
recommended and waiting, and what is deliberately unchanged **and why** — is
**`project-brain/06-vocabulary.md`**. Read it before renaming anything a user reads.

One rule: **one concept, one word, everywhere it is shown.** A column header, the filter chip
that drives it and the CSV column exported from it are three views of one concept.

Two things to know before touching copy:

1. **Never find-and-replace.** `app/vendor/page.tsx:42` and `:144` look freshness counters up
   on the **label text** and swallow a miss into `?? 0`. A sed over "Freshness" makes the
   vendor dashboard silently report zero — it type-checks, it builds, no test fails.
2. **A header on a masked column is a masking decision.** `/client/engagements` shows
   `maskedId` alone; "NAME" above it would imply a name exists to be seen.

**All of it is applied**, including the owner's choice of **"your Talentvibes team"** over
"broker" in 21 client-facing strings. **Checked against the v2 UI contract afterwards —
which was the wrong order.** `design_handoff_bench_exchange_v2/SCREENS.md` prescribes column
names: two renames turned out to be conformance, five are deliberate owner-directed
divergences now recorded in `06-vocabulary.md` §4. **Read the handoff before renaming
anything a user reads.** Ops keeps "broker" in its own copy, the same standing
call that kept `margin` and `spread`. Two small things remain open — §2: confirm "Full access"
in the organisation switcher, and decide whether a vendor should see a **shortened** name of
their own employee.

A third thing to carry forward: **no test asserts any UI string.** The suite proves nothing
else broke; it cannot prove the copy is right.

## Start here next time

**Sprint 6 is COMPLETE** (6a `f100d0a`, 6b `d6a7fad`, threads `78e4ef4`). Every item from
the dual-role brief is built, verified and committed.

**Sprint 7b — the shell's interactive parts** is the main open work. 7a left these as
static markup, and the first one is a visible flaw: **the sidebar search box advertises ⌘K
and does nothing**, against v2 rule 4 ("no dead buttons"). Wire or hide it before a demo.
Then toasts with Undo (6s), the 322px portal-switcher menu, the Ask Talentvibes drawer
(switching portal must close it), and the ops dark internal-view strip. After that 7c–7e:
the 16 screens to `SCREENS.md`, plain-language copy inside page bodies, responsive from
~900px.

Three things to know before working in this code:

- **`next/link` for pages, `<a>` for route handlers.** A Link to a route handler silently
  does nothing on click and prefetches the handler on render. This caused the unclickable
  demo switcher.
- **Never gate access on `org_type`** — it is a lossy projection. Use `requiredCapability()`.
- **Treat a "why this is slow" comment as expiring.** One on `/ops/matching` outlived both
  of its reasons and kept the worst page in the app 2× slower than it needed to be.

Two standing items: the **drizzle-orm 0.44.7 high advisory** (low exposure — no `sql.raw`
or `sql.identifier` anywhere — but 0.45.x is breaking, so its own pass with the 45 tests as
the net), and the stray `deploydesk` project on the `vaibhavalteryx-1351` Vercel account.

---

## Earlier resume notes

**Sprint 6b — the ops console's remaining dual-role surfaces.** 6a is done, verified and
committed (`f100d0a`): the capability-keyed guard, the "Hiring | Bench" switcher, the
organisation-based demo control, the ops-only own-bench note, and acceptance tests 1/2/5/6.
Full definition in `04-tasks.md`; the five remaining items are the dual-role badge, org
profile controls, margin grouped per org, the probing-flag indicator, and one broker thread
per workspace.

Two things worth knowing before touching this area:

- **Never gate access on `org_type`.** It is a lossy projection — migration 0002 resolves
  `can_supply AND can_hire` to `'vendor'`. Use `requiredCapability()`. An `org_type === ...`
  comparison in an access path is a bug; see `02-decisions.md`.
- **`isDualRole()` is ops-only by contract.** Telling a client that its supplier also hires
  narrows the counterparty to a handful of companies.

Then **Sprint 7b** (⌘K palette, toasts with Undo, the 322px switcher menu, Ask Talentvibes
drawer, ops internal strip) and **7c–7e** (16 screens to `SCREENS.md`, page-body copy,
responsive from ~900px). The sidebar search box still advertises ⌘K and does nothing — v2
rule 4 is "no dead buttons", so wire or hide it before a demo.

---

## Earlier resume notes

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

All four gates green: **22 routes x2 all 200**, `db:verify` **30/30**, `test:leak`
**49/49**, build and typecheck clean under `noUnusedLocals`.
