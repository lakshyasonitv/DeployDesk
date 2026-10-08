---
project: talentvibes bench
status: active
last_log: 2026-10-08
---

# 03 — Progress

> The "you are here" map. **Rewritten each session, not appended to** — it had grown five
> stacked narrative blocks and two sections both titled "Earlier resume notes", with a
> "Start here next time" that still described Sprint 7b and a ⌘K palette removed days
> earlier. The narrative belongs in `journal/`; this file is the current picture only.

## Current state

**DeployDesk by Talentvibes** — a brokered marketplace for IT bench capacity. Three portals
(`client`, `vendor`, `ops`) over one database, with masking enforced in portal-specific read
models rather than RLS (ADR-003).

**Gates, as of 2026-10-08:**

| Gate | State |
|---|---|
| `npm test` | **207 passing**, 10 files |
| `npm run db:verify` | **30/30** |
| `npm run build` | clean |
| `npx tsc --noEmit` | clean |

**Built and working end to end:** all 16 screens on the v2 design; the dual-role workspace;
search across all three portals; CSV exports; the "How this works" explainer; the client
placement panel with a working extension request; interview slots (offer times, move a
round); real talent-pool filters with saved views and a search box; the draft → listed path;
**Talentvibes-controlled client rates**; **"Add to a requirement"** from the pool; and
**the matching engine** — `docs/MATCHING.md`'s six components and five gates, so a posted
requirement is sourced automatically instead of dead-ending on an empty desk.

**`05-status.md` is the authoritative list** of what works, what is half-built and the **6**
controls that still do nothing, each with a note on whether it needs a data model, an
external system, or just work.

### Database

Supabase `fmgwcspsuljefhfdcqen`, ap-south-1 (Mumbai). **39 base tables**, migrations
`0000`–`0005` applied.

**Two migrations are written and NOT applied**, both waiting on the owner, who runs
migrations. Nothing in the code queries either table yet, so the deployed site is safe until
they do.

| File | What it unblocks |
|---|---|
| `0006_panel_availability.sql` | "Set panel availability" on the client interviews screen — weekly windows per client org, IST, **advisory not a gate** |
| `0007_margin_policy.sql` | an ops-only setting for the target and floor margin, so 22% / 18% stop being constants in `rate-band.ts`. One row, enforced by the schema |

### Two numbers that look like a contradiction and are not

`db:seed` reports "reset 38 tables" while there are 39: it owns everything except
`applied_sql_migrations`, the hand-written-SQL ledger.

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
percent-encoded (`@` becomes `%40`). Ask the owner for credentials; do not guess.

### The commands that matter

| Command | What it does |
|---|---|
| `npm run dev` | dev server; **slow by design**, judge speed on `next start` instead |
| `npm run build` | production build — **stop `next dev` and `rm -rf .next` first**, or it fails with `Cannot find module for page` |
| `npx next start -p 3000` | production server, what to measure |
| `npm test` | **the gate** — 207 tests. It loads `.env.local`; bare `npx vitest` does not |
| `npm run db:verify` | 30 assertions over the seeded data |
| `npm run db:seed` | reseed (~4s) |
| `npm run db:apply -- --dry` | list pending hand-written SQL migrations, touch nothing |
| `npm run db:apply` | apply them |

## Rules the owner set, which still apply

1. **Never run a script that WRITES to Supabase without asking first and showing the exact
   SQL.** Migrations are files in the repo; seed data is a file the owner runs. Read-only
   verification (`db:verify`, `npm test`) is allowed.
2. **Never touch Vercel.** The Vercel connection available to this session belongs to a
   different account; the owner deploys from their own.
3. **Ask before building.** The owner has asked repeatedly for questions up front rather
   than assumptions — several features changed shape because of the answers.
4. **Update this brain as you go**, not at the end.

## Where to look first

| File | For |
|---|---|
| `05-status.md` | what works, what is half-built, what is inert — verified by inspection |
| `04-tasks.md` | what to do next, in Now / Next / Later order |
| `02-decisions.md` | **why** something is the way it is, newest first, with an index |
| `06-vocabulary.md` | the words the product says, including what is deliberately unchanged |
| `journal/` | the narrative, one file per day — what was tried and what failed |

## Three things to know before working in this code

- **Never find-and-replace over user-facing copy.** `app/vendor/page.tsx` looks freshness
  counters up on the label TEXT and swallows a miss into `?? 0`, so a sed over "Freshness"
  makes the dashboard silently report zero — it type-checks, builds and passes every test.
- **A display string must never also be a sort or lookup key.** The organisation switcher
  sorted on the literal `"Broker"`; renaming that label would have reordered it with nothing
  failing.
- **`next/link` for pages, plain `<a>` for route handlers.** A Link to a route handler
  silently does nothing on click and prefetches the handler on render.

## Start here next time

**1. Two migrations are waiting on the owner — `0006` and `0007`.** Once `0006` is applied,
wire panel availability: a read model, a `POST /api/client/interviews/availability`, and the
"Set panel availability" drawer back on the interviews header. It is **advisory, not a gate**
— a slot outside those windows is flagged and still sent. Once `0007` is applied: a reader
with the constants as its fallback, an ops-only settings control, and an audit row per change
(changing the FLOOR re-derives which past placements count as exceptions, because margin is
never stored).

**2. Continue the page-by-page audit.** The owner's pattern is: status first, questions
second, fixes third. **Role pipeline**, **Matching desk**, **Margin** and **Talent pool**
are done. Not yet audited: **Duplicate checks** and **Organisations** on the ops side, and
the whole client and vendor sides.

The two audits so far both found the same shape of defect — a control that *looked* like it
worked. The pipeline's due dates referred to a stage the role had left; the matching desk's
drag-to-reorder saved nothing and its reset toasted a lie. **Check persistence by reloading,
not by watching the screen update.**

**3. Standing items, none urgent:** the drizzle-orm 0.44.7 advisory (GHSA-gpj5-g38j-94v9 —
low exposure, no `sql.raw` or `sql.identifier` anywhere, but 0.45.x is breaking so it wants
its own pass), `rate_changes` is never written, and the stray `deploydesk` project on the
`vaibhavalteryx-1351` Vercel account for its owner to delete.

**The owner's own outstanding action: rotate the Supabase database password.** It was shared
in chat twice.
