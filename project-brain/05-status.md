# 05 — What works today

> **Verified by inspection on 2026-10-07, not from memory.** Every row below was checked
> against the running app, the database, or a grep of the source. Re-verify before quoting
> it: the commands are at the bottom.
>
> Gates at the time of writing, commit `cbf6df1`:
> **20 pages + 12 API routes · 39 base tables · `db:verify` 30/30 · `npm test` 105/105 ·
> build + typecheck clean**
>
> `npm test` is the gate, not `npm run test:leak` — the latter only runs `tests/leak` and
> would miss `tests/business-clock.test.ts` entirely.

---

## 1. Fully working, end to end

These persist to Supabase, write an audit row, and are covered by tests.

| What | Where | Notes |
|---|---|---|
| **Add a person to the bench** | `/vendor/resources/new` | allocates `TV-####`, links catalogue skills, audit row, toast with real Undo (withdraws) |
| **Post a new role** | `/client/requirements/new` | allocates `REQ-####`, starts the IST business-hours clock, appears on the ops pipeline immediately, Undo cancels |
| **Select / pass a candidate** | `/client/shortlists/[code]` | persists to `shortlist_items.client_decision`, survives a refresh, optimistic with rollback |
| **Request interviews** | `/client/shortlists/[code]` | creates round 1 at `proposed`; `meeting_url` stays null because Talentvibes issues it. Undo withdraws only rounds still proposed |
| **Confirm availability ("still free")** | `/vendor/roster` | appends to `availability_confirmations`, updates `last_confirmed_at`, audit row |
| **Move a role along the pipeline** | `/ops` | drag or arrows → `requirements.stage` + stage event + audit row, all in one transaction |
| **Send a masked shortlist** | `/ops/matching/[code]` | immutable snapshot (ADR-009), duplicate and eligibility pre-checks |
| **Live match preview** | `/client/requirements/new` | aggregate counts only, buckets anything under 5, excludes own-group and blocked supply |
| **Light / dark theme** | everywhere | persists in `localStorage`, applied before first paint so there is no flash |
| **Search** | sidebar, all three portals | server-backed, grouped by type, **masking per portal** — client sees `TV-####` + a band, vendor sees its own people's names, ops sees everything. 17 leak tests |
| **"How this works" explainer** | `?` in the top bar, all portals | per-portal plain English; the `?` was a div that did nothing |
| **CSV exports** | client People working · vendor Your earnings · ops Margin | built from the SAME read model the screen uses, so file and screen cannot disagree. UTF-8 BOM for the rupee sign, and a formula-injection guard |
| **Act as another organisation** | top bar | demo affordance; the dual-role org is reachable this way |
| **Hiring | Bench switcher** | top bar, dual-role orgs only | a single-sided org sees **nothing** — verified in markup |

## 2. Half done — the endpoint works, the button does not call it

**This is the honest gap.** Both endpoints are written, transactional, and covered by the
write-path tests. Neither has any UI wired to it, so the buttons on screen still do nothing.

| Endpoint | Screen with the dead button | What is missing |
|---|---|---|
| `POST /api/ops/duplicates/resolve` | `/ops/duplicates` → "Keep this one" / "Not a duplicate" | the screen is a server component; it needs a small client island to call the route and show the toast |
| `POST /api/client/interviews/feedback` | `/client/interviews` → "Submit feedback" / "Save draft" | same, plus the ratings need to become controlled inputs |

**The placement panel** — `/client/engagements`, 2026-10-07. Every row opens everything the
client may know about that placement, and it is where **"Request an extension"** now works
(`POST`/`DELETE /api/client/engagements/extension`, audit row both ways, real Undo via
`withdrawn` rather than a delete). `getClientEngagements` is a new client read path with
three leak tests. The name is absent and the panel **says why** — see `02-decisions.md`.

## 3. Visible but inert — 15 controls that do nothing

Each needs a decision, not just wiring. Grouped by what they actually need.

**Needs a data model that does not exist yet**
- **Reschedule**, **Propose new slots**, **Panel availability** (`/client/interviews`) — no availability/slot model
- **Save draft** (`/client/interviews`) — feedback drafts have no column; the endpoint supports a null outcome, so this is close
- **Save this view** (`/ops/pool`) — saved views need a table
- **Detection rules** (`/ops/duplicates`) — a settings screen that does not exist

**Needs an external system**
- **Join** (`/client/interviews`) — a real meeting link; v2 says Talentvibes issues it
- **Invite N to test** (`/vendor/assessments`) — the assessment provider adapter (ADR-006)
- **Raise invoice** (`/vendor/earnings`) — billing integration

**Needs only work, no decisions**
- **Download statement** (`/client/engagements`, `/vendor/earnings`), **Export to finance** (`/ops/margin`) — agreed: real CSV from the same read model the screen uses, so file and screen cannot disagree
- **Load more** (`/ops/pool`) — server-side paging. The roster's version of this is
  **fixed**: "Load more" said neither how many more nor how many were left, and with 42
  people meant four clicks. It now reads "Show all 42 people" and the count beside it is a
  sentence rather than a bare ratio.
- **Add to a requirement** (`/ops/pool`) — add a pool candidate to a match set
- **Ask Talentvibes** (`/client/shortlists` index) — opens nothing; the drawer exists only on the detail page
- **Sending a broker message** — the thread now READS real data, but Send only appends locally; there is no write endpoint for a client message

## 3b. Unblocked by migration 0005 — tables exist and are seeded, UI not wired

Applied 2026-10-07 after the SQL was shown and approved. The data is there; **the buttons
still do nothing**, which is the next piece of work.

| Table | Seeded | Control waiting on it |
|---|---|---|
| `holiday_calendar` | 6 rows (3 fixed national dates × 2 years) | **already in use** — the create endpoint reads it when setting a deadline |
| `interview_slots` | 7 (2 accepted, 1 declined with a reason) | Propose new slots · Reschedule · Panel availability |
| `extension_requests` | 1, at `with_supplier` | ~~Request an extension~~ — **wired 2026-10-07** |
| `saved_views` | 2, scoped to user **and** org | Save this view |

**Holidays: three rows a year on purpose.** Republic Day, Independence Day and Gandhi
Jayanti are the only Indian public holidays with a fixed nationwide date. Diwali, Holi, Eid
and Good Friday move with a lunar or liturgical calendar or vary by state, and a date stated
from memory would not fail loudly — it would silently shift a real SLA deadline by a working
day. HR supplies the rest. Proven to work: a role posted 1 Oct 17:00 IST + 4 business hours
lands 2 Oct without the table and **3 Oct with it**, because 2 Oct is Gandhi Jayanti.

Two tables deliberately NOT created: feedback drafts (a null `outcome` in
`interview_feedback` already IS a draft, and the endpoint supports it) and duplicate
detection rules (no agreed thresholds exist; inventing them is what working agreement 8
forbids).

## 4. Agreed next, not started

**Wiring the five controls that migration 0005 unblocked** — see section 3b. The endpoints
for two of them already exist and are tested (`ops/duplicates/resolve`,
`client/interviews/feedback`); the other three need an endpoint as well as a screen.

~~Search~~, ~~the explainer~~ and ~~CSV exports~~ are **done** — see section 1. ⌘K was
removed entirely on the owner's instruction ("what does that even mean") and verified
absent from all three portals.

## 5. Known gaps, deliberately left

| Gap | Why it is acceptable now | What it costs later |
|---|---|---|
| **RLS is inert** | the app connects as `postgres` (bypasses RLS) and the policies key on `auth.uid()`, which is empty. Masking is enforced by the read models, which have 88 tests behind them | needs real Supabase Auth + a restricted DB role before launch. **Never describe this as RLS-protected** |
| **No responsive layout** | 12 fixed grids, 1 auto-fit, 1 media query. Audience is senior staff on laptops | v2 rule 5 wants ~900px up; agreed to do it per screen during 7c–7e |
| **Holiday calendar absent** | the IST clock is correct for 09:00–19:00 Mon–Sat; holidays take an optional set that defaults to empty | an Indian holiday will be treated as a working day until the table exists |
| **`drizzle-orm` 0.44.7** | GHSA-gpj5-g38j-94v9, high. Exposure is low: zero uses of `sql.raw` or `sql.identifier` | 0.45.x is a breaking change; wants its own pass with the 88 tests as the net |
| **`rate_changes` never written** | no rate-change path is built | working agreement 5 needs the audit row when it is |
| **Roster moves 173 rows** | 42 cards are actually rendered, so it is proportionate | at ~2,000 bench resources it needs server-side paging, which also moves the filter pills server-side |
| **Demo session, not auth** | `src/lib/auth/session.ts` picks an org; it is not a security boundary | Phase 1: real session, a portal check that 404s, an ownership check per row |
| **Test files run serially** | six suites share one database, and acceptance test 6 deliberately mutates a capability | `fileParallelism: false`. Costs a few seconds; removes a whole class of flake |

## 6. How to re-verify this page

```
npm run db:seed        # ~5s. Re-seed before a demo; SLA fixtures age.
npm run db:verify      # expect 30/30
npm test               # expect 88/88 — the WHOLE suite, not test:leak
npm run build          # must be clean; stop any dev server first
npx next start -p 3000 # then click through; judge speed here, never on `npm run dev`
```

Inventory commands that produced the tables above:

```
find app -name page.tsx                      # 20 pages
find app/api -name route.ts                  # 9 endpoints
grep -rl "use client" app --include=*.tsx    # which components can write
grep -rn "<Button" app --include=*.tsx | grep -v "href=\|onClick"   # dead controls
```


---

## 7. Two traps that cost time, so they are written down

**Anything `Shell.tsx` imports ends up in the browser bundle.** `Shell` is imported by
client components, so importing a UI constant from a read model dragged the Postgres driver
in with it and the build failed on `Can't resolve 'fs'`. Presentation copy belongs in
`src/lib/ui/`, not in `src/read-models/`.

**`npx vitest` does not load `.env.local`; `npm test` does.** A suite run the first way
reports "no tests" and looks broken when it is simply missing `DIRECT_URL`.
