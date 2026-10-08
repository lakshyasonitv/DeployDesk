# 02 — Decision Log

> Append-only. Newest entry at the TOP. Never edit old entries — if a decision is
> reversed, add a new entry linking back.
>
> **Scope of this file.** Architectural decisions live in `../docs/DECISIONS.md` as numbered
> ADRs (ADR-001 … ADR-010, plus ten open questions Q1–Q10). That file is the authority and
> has its own supersede protocol — do **not** copy ADRs here or they will drift the first
> time one is superseded.
>
> This file is for **session-level decisions below the ADR bar**: tooling choices, local
> conventions, workflow calls, and "we tried X and chose Y" notes. If a decision
> constrains the data model, the masking boundary, or money handling, it belongs in
> `../docs/DECISIONS.md` as a new ADR instead.
>
> Open spec questions follow the same split: genuinely open business questions go in the
> **Open questions** table in `../docs/DECISIONS.md` with the safer default recorded, per
> working agreement 8 in `../CLAUDE.md`.

<!-- Format:

## YYYY-MM-DD — <short decision title>
- **Decision:** what was decided
- **Why:** the actual reason
- **Rejected:** alternatives considered and why they lost
- **Impact:** what this touches / constrains going forward
-->

## 2026-10-06 — Dual-role organisations: three decisions taken before building

The user specified a dual-role workstream (one company acting as both supplier and
client). Three questions were settled before any schema was written.

**(a) Memberships — supersede narrowly, not wholesale.**
- **Decision:** keep "a user belongs to exactly one organisation" (unique on `user_id`).
  Change only two things: a membership holds a SET of roles (supply, demand, admin)
  rather than a single role, and the portal switcher becomes a production feature rather
  than a demo affordance. ADR-012 covers exactly those two points, and
  `docs/DATA-MODEL.md` and `docs/ARCHITECTURE.md` get pointers to it.
- **Why:** the original spec implied full cross-org membership, which would have reversed
  a documented rule far more broadly than dual-role actually needs. The narrow version
  gets the same UI outcome without loosening tenancy.
- **Rejected:** building memberships and leaving the docs contradicting the schema; and
  modelling dual-role purely at org level with no role set.
- **Impact:** tenancy checks stay single-org, so existing read models and leak tests keep
  working unchanged.

**(b) `org_capabilities` is authoritative; `org_type` becomes derived.**
- **Decision:** `can_supply` / `can_hire` are the source of truth, backfilled from the
  existing `org_type` enum. Two guards: no application code writes `org_type` directly
  (derive it by trigger or view, keeping it for ops filtering), and a constraint that the
  Talentvibes org has neither capability, since it is the broker and not a participant.
- **Why:** makes acceptance test 6 real — flipping `can_hire` makes the hiring workspace
  appear with no migration and no second account.
- **Impact:** `organizations` keeps its US spelling and all 30 tables' foreign keys. The
  new tables sit alongside it.

**(c) Sequencing.** Finish the 15 screens and verification first, commit a clean base,
then dual-role in three stages: migrations and RLS files (SQL approved before it runs),
then the matching function with self-dealing bypass tests, then UI. The 12 leak tests and
21 seed checks must stay green after each stage.

## 2026-10-06 — Database changes are file-first and approval-gated

- **Decision:** from this point, every schema change is written as a migration file in the
  repo and the SQL is shown to the user for approval before it touches Supabase. Seed data
  goes in a separate file the user runs.
- **Why:** the user set this as a hard constraint. Earlier in the same session I ran
  `db:push`, `db:migrate` and `db:seed` directly against two live projects, which was fine
  for a throwaway demo database and is not fine as a habit.
- **Impact:** slower loop, and the right default once anything real is in the database.
  The `db:*` npm scripts stay, but I propose rather than run them.

## 2026-10-06 — Inline styles copied from the prototype via a parser helper

- **Decision:** port the prototype's markup keeping its inline `style="..."` strings
  verbatim, and convert them at render with a ~10-line `s()` helper that parses a CSS
  declaration string into a React style object.
- **Why:** the design handoff is high fidelity and declares every colour, size and spacing
  value final. Hand-converting ~15 screens of inline styles into style objects or CSS
  classes is where a one-day build dies, and every conversion is a chance to drift off the
  spec. Copying the strings keeps fidelity exact and makes porting mechanical.
- **Rejected:** (a) writing a template-to-JSX transpiler — the `{{ }}` / `sc-for` /
  `sc-if` format is simple but the edge cases around nested quotes and text nodes would eat
  more time than they save; (b) converting to Tailwind or CSS modules now — correct
  eventually, not today, and `docs/ARCHITECTURE.md` is agnostic about which.
- **Impact:** a runtime parse per styled element, which is negligible at this page size.
  Migrating to CSS modules later is a mechanical find-and-replace against the same strings.
  Recorded as a demo-time shortcut, not an endorsement.

## 2026-10-06 — Spec docs moved into docs/ rather than fixing CLAUDE.md's paths

- **Decision:** move the ten spec files from the repo root into `docs/`.
- **Why:** `CLAUDE.md` already referenced `docs/MASKING.md` and nine others in ten places,
  including the instruction to read `docs/MASKING.md` before touching any read path. Moving
  the files makes all ten references correct at once and leaves the contract untouched.
- **Rejected:** editing the ten references to point at the root — more edits, and it would
  have meant changing the project contract to match an accident rather than the reverse.
- **Impact:** `CLAUDE.md` is unchanged apart from the appended Project Brain section. The
  repo root is now the application root, which is what the Next.js scaffold wanted anyway.

## 2026-10-06 — Scope: all 15 screens, depth traded for breadth

- **Decision:** build all 15 screens from the design handoff for today's demo, implementing
  each screen's read path properly but little of the deeper business logic behind the later
  phases (assessments provider, brokering workflow, billing runs, duplicate detection).
- **Why:** the user has to demo the whole application today and chose breadth explicitly
  after being shown the trade-off. Masking stays fully enforced server-side regardless —
  it is cheap to do right now and a rewrite later, and it is the reason the product exists.
- **Rejected:** a six-screen hero-path slice with deeper logic. Better engineering, but it
  does not meet the stated need.
- **Impact:** screens behind the later phases render from seeded data with modest logic.
  What is *not* compromised: separate read models per portal, ADR-004 bands, bigint paise,
  random masked IDs, the snapshot shortlist. RLS is deferred — the read models are the
  first net, RLS is the second.

## 2026-10-06 — Project brain holds pointers, not copies

- **Decision:** `project-brain/` stays deliberately thin. `00-overview.md`,
  `01-architecture.md` and `02-decisions.md` link to the eleven root docs rather than
  summarising them. The files carrying genuinely new content are `01-architecture.md` →
  **Gotchas**, `03-progress.md`, `04-tasks.md` and the journal.
- **Why:** `../CLAUDE.md` states "do not duplicate content between them — link instead",
  and the root docs already own ~2,550 lines of spec. A brain that restates the ten ADRs
  becomes a second source of truth that silently diverges the first time an ADR is
  superseded — which is exactly the failure mode the ADR supersede protocol exists to
  prevent.
- **Rejected:** fully pre-filling every brain template from the docs. It reads better on
  day one and is wrong by month three.
- **Impact:** when a root doc changes, the brain usually needs no edit. Anything in the
  brain that *can* be derived from the docs should be deleted, not updated.


## 2026-10-07 — The product is "DeployDesk by Talentvibes"

- **Decision:** the product name is **DeployDesk by Talentvibes**, written in exactly one
  place: `BRAND` in `src/lib/ui/style.ts`. `BRAND.name` (`DeployDesk`) is the wordmark for
  tight lockups — the 222px sidebar, whose second line is already spent on `PORTAL_TAG`.
  `BRAND.full` is the complete lockup, for the landing page `h1` and the browser title.
  Page titles read `X · DeployDesk`.
- **Why:** the product owner asked for it directly. One constant rather than 20 string
  literals because the previous name was spread across 17 page titles and 3 wordmarks, and
  a rename should not be a 20-file search next time.
- **Conflicts with the handoff, deliberately:** `design_handoff_bench_exchange_v2/README.md`
  specifies the sidebar read "Bench Exchange" / "by Thinkvibes". The owner's instruction
  wins. A comment on `BRAND` records this so a future session matching the handoff does not
  silently revert it.
- **Rejected:** putting the full lockup in the sidebar. At 13px/800 in 175px of usable
  width it would wrap, and the README is explicit that the logo lines never wrap.

## 2026-10-07 — Latency here is round-trip count, not row count

- **Decision:** when a read model is slow, count its sequential `await`s before counting
  its rows. Independent reads go in one `Promise.all`.
- **Why:** measured on the vendor dashboard. It loaded 173 rows and shaped 42 view objects
  to display six integers, which looked like the obvious culprit. Replacing that with a
  single aggregate won **9%** (481ms → 437ms). Fanning out the five independent queries won
  the rest (437ms → **144ms**, 3.3× total). Each round trip to Mumbai costs ~60–70ms, so
  six serial queries spent almost all their wall time waiting.
- **Supersedes a Sprint 1 note in practice:** Sprint 1 records that *removing* a
  `Promise.all` fan-out cured the `/ops` hang. The root cause was the pool at `max: 1`
  deadlocking against Supavisor's transaction mode, not concurrency itself. The pool has
  been `max: 10` since Sprint 2 and two-way `Promise.all` already ships on ten pages, so
  fan-out is safe — this is written down because it otherwise looks like re-breaking a
  fixed bug.
- **Rejected:** route caching. Every page is `force-dynamic` on purpose; stale masked data
  is worse than a slow page.
- **Impact:** a read-model refactor must prove "no behaviour change" by capturing the
  rendered values before and asserting them identical after. The four gates cannot catch a
  displayed number moving from 7 to 8.

## 2026-10-07 — One definition per label, enforced by one function

- **Decision:** where two screens show the same label, they call the same function. The
  sidebar and the vendor dashboard both now read `getVendorRosterCounts()`.
- **Why:** "assessments pending" had two definitions — the sidebar counted assessment ROWS
  not scored, the dashboard counted RESOURCES with no scored assessment. Both printed `13`
  on the current data, so neither a test nor an eyeball would have caught it, but they
  diverge the moment someone retakes a test. The resource-based definition was kept because
  it is what the label means: 13 people still waiting on a result.
- **Rejected:** aligning the two definitions and leaving both call sites. That fixes today's
  number and leaves tomorrow's drift in place.


## 2026-10-07 — Adopt the v2 handoff in full, in five staged sprints

- **Decision:** migrate to `design_handoff_bench_exchange_v2/` completely — all 16 screens,
  the plain-language copy, responsive from ~900px, and the Ask Talentvibes drawer. Staged
  as **7a** foundation (tokens, light/dark, fonts, hex→var), **7b** shell (260px sidebar,
  Lucide, ⌘K palette, toasts, portal switcher), then **7c–e** the screens. Each stage ends
  at the four gates, per the standing sprint rule.
- **Why:** the user chose full v2 after being shown the risk that the current build stops
  being demo-stable for several sprints. v2 declares colours, type, copy and interactions
  final, so partial adoption would leave the app permanently between two design systems.
- **Rejected:** foundation-only and foundation+shell. Both were offered with measured costs
  and declined in favour of the complete migration.
- **Impact:** the staging is what keeps this safe. Each sprint is committed and verified, so
  there is always a stable commit to demo from, and 7a is a mechanical diff that can be
  reverted wholesale. **Note:** repointing `TOKENS` alone is not enough — 151 colours go
  through tokens against 885 bare hex literals, so light/dark is all-or-nothing and the
  conversion must cover the bare literals in the same sprint.

## 2026-10-07 — The client never sees an exact client rate, placements included

- **Decision:** rate **bands** everywhere on the client side. v2's visibility matrix allows
  "band on shortlists, exact on placements"; we do not take it.
- **Why:** it is the only v2 delta that *loosens* masking, and the user declined it. A
  dual-role organisation seeing an exact client rate on one side is a margin-inference
  risk, which is the same reasoning behind `flat_declared_fee`.
- **Rejected:** exact rate on placements only (v2's own rule), and exact-except-for-dual-role
  (more faithful to intent, but a conditional masking rule is a rule that gets applied
  wrongly later).
- **Impact:** `docs/MASKING.md` stands unchanged; no ADR needed for a loosening that is not
  happening. When implementing v2's "People working" screen, keep the band field — do not
  follow `DATA_MODEL.md` here.


## 2026-10-07 — `org_type` never gates access; capabilities do

- **Decision:** every access decision keys on `org_capabilities`, never on
  `organizations.org_type`. The portal→capability mapping lives in one function,
  `requiredCapability()` in `src/lib/auth/workspace.ts`: client needs `can_hire`, vendor
  needs `can_supply`, ops needs `org_type = 'talentvibes'`.
- **Why:** `org_type` is a **lossy projection**. Migration 0002's trigger collapses two
  booleans into one enum and resolves `can_supply AND can_hire` to `'vendor'`. The old
  guard asserted `org_type === portal`, so the dual-role organisation — the single case the
  entire brief exists for — was refused its own hiring workspace with "is vendor, not
  client". Nothing surfaced it: all routes returned 200 and all tests passed, because
  nothing had ever asked a dual-role org for its hiring side.
- **Rejected:** adding a `'both'` value to the `org_type` enum. It would spread the
  dual-role case into every existing `org_type` comparison in the codebase, and ADR-012
  already made capabilities authoritative — a second authority is the problem, not the fix.
- **Impact:** `org_type` is a display and filtering convenience only. Production's 404 guard
  must use the same function. Any new `org_type === ...` comparison in an access path is a
  bug.

## 2026-10-07 — "No hint" means an empty array, not a disabled tab

- **Decision:** `workspaceTabs()` returns `[]` when an organisation has fewer than two
  sides, and the shell renders nothing at all for an empty list.
- **Why:** the brief requires a supply-only company to see no trace of a hiring side. A
  single inert tab, or a greyed one, is itself the disclosure — a locked door tells you
  there is a room. Returning one tab would have been the natural shape and would have
  quietly violated the requirement.
- **Rejected:** returning one tab and letting the shell decide; a `disabled` flag on the
  hiring tab. Both put the rule in the renderer, which is the "filter it in the UI" shape
  `CLAUDE.md` forbids.
- **Impact:** verified at the markup level rather than the function level — supply-only
  Nimbus renders zero occurrences of "Workspace" and zero of "Hiring". That is the only
  level that actually proves the absence of a hint.

## 2026-10-07 — The demo switcher picks an organisation, not a portal

- **Decision:** the top-bar demo control lists organisations (Acme / Nimbus / Cygnet /
  Talentvibes). The dual-role workspace tabs choose the side.
- **Why:** three portal links cannot express *one organisation appearing on two sides*,
  which is exactly what dual-role means. Picking an organisation is also closer to
  production, where a user belongs to one organisation and has no portal choice at all.
- **Rejected:** keeping the portal list and adding Cygnet twice. It would imply two
  accounts, and the brief is explicit that it is the same login.
- **Impact:** `/demo/act-as` writes the choice to a cookie and is a **demo affordance that
  must be deleted with the demo**, along with the switcher. The dual-role workspace tabs are
  a separate, production feature (ADR-012) — do not merge the two.


## 2026-10-07 — `next/link` for pages, `<a>` for route handlers

- **Decision:** anything whose href points at a Route Handler uses a plain `<a>`.
- **Why:** `next/link` performs a client-side RSC navigation — it fetches the destination
  expecting a flight payload. A route handler answers with a 307 and a `Set-Cookie`, so the
  transition silently does nothing; this is why the "Acting as" organisation names were not
  clickable. `next/link` also **prefetches by default**, so rendering the bar could have
  fired the handler and set the cookie with no click at all.
- **Rejected:** `prefetch={false}` with `next/link`. It stops the accidental prefetch but
  not the failed navigation, so the control would still do nothing on click.
- **Impact:** `/demo/act-as` is the only such link today. The dual-role workspace tabs keep
  `next/link` because `/client` and `/vendor` are real pages.

## 2026-10-07 — Re-check a "why this is slow" comment when its reason is fixed

- **Decision:** a comment justifying a slow or serial shape is treated as a claim with an
  expiry date, not a constraint. When the thing it blames is changed, the comment gets
  re-tested.
- **Why:** `/ops/matching` was the slowest page in the app at ~1.0s and stayed that way
  because of *"OpsAside alone issues several queries, and running it alongside others
  exhausted the connection pool."* That was true when written. Sprint 2 then reduced
  `OpsAside` to a single count query and the pool went from 5 to `max: 10` — and the comment
  outlived both. Fanning out the five reads took it to **0.489s**. The identical comment on
  `/vendor/resources/new` cost the same way.
- **Impact:** two pages ~2× faster for no behaviour change. Pairs with the standing lesson
  that latency here is round-trip count, not row count.

## 2026-10-07 — Dual-role orgs are on a flat declared fee, and the seed enforces it

- **Decision:** any organisation holding both capabilities is set to
  `fee_model = 'flat_declared_fee'`, applied by the seed and asserted by `db:verify`.
- **Why:** this is the **commercial half** of the masking rule and it had never been
  implemented — `organizations.fee_model` carried a comment describing it while every row,
  the dual-role org included, sat on the column's `hidden_markup` default. A company on both
  sides can compare what it is **paid as a supplier** against what it is **charged as a
  client**; with a hidden markup those two statements reveal the spread. With the fee
  declared there is nothing left to infer.
- **Rejected:** relying on screen separation alone ("the two rate views never share a
  screen"). That defends against reading the spread on one page, not against subtracting two
  invoices.
- **Impact:** the pairing is deliberate — screen separation AND a declared fee. The column
  now uses its `fee_model` enum rather than plain `text`.


## 2026-10-07 — Business clocks run in IST, with the holiday table still absent

- **Decision:** SLA deadlines and freshness thresholds are computed in **Asia/Kolkata**,
  per `docs/DOMAIN.md`: business hours are **09:00–19:00 IST, Monday–Saturday**. The
  arithmetic lives in `src/lib/business-clock.ts` and uses a **fixed +05:30 offset**, which
  is exact rather than approximate — India has had no DST since 1945.
- **Why:** an audit found that **nothing in the codebase did this**. `IST_TZ` was declared
  and referenced nowhere, so every deadline and every freshness threshold was plain UTC
  elapsed time, against working agreement 3. Two concrete consequences: a profile confirmed
  at 23:00 IST read as one day stale two IST midnights later instead of two — a ~5.5h error
  at the boundary that decides whether a person is matchable at all; and a role due Monday
  morning looked **40 hours** away on a Saturday evening rather than the 2 working hours it
  actually had.
- **Rejected:** `Intl.DateTimeFormat` round-tripping or a timezone library. For a
  single-country product with a fixed offset both add cost and obscure the arithmetic. If a
  second country is ever served, replace this file rather than extend it.
- **Rejected:** hardcoding an Indian holiday list. `docs/DOMAIN.md` says to put the
  calendar "in a table, not in code", and that table does not exist yet. A hardcoded list
  is the invented business rule working agreement 8 forbids, and it is wrong the first year
  a date moves. **Every function takes an optional holiday set and defaults to empty**, so
  the table wires in without touching the arithmetic — and a test proves the hook works.
- **Impact:** 20 tests in `tests/business-clock.test.ts` pin the boundaries. The seeded
  demo data did not shift, because the figures only diverge across an evening or a Sunday
  and the suite was run mid-week.

## 2026-10-07 — RLS stays inert, and the product is read-model-protected

- **Decision:** leave the 22 RLS policies in place and unexercised, and say so plainly
  wherever someone might assume otherwise — a prominent note at the top of
  `src/db/client.ts`.
- **Why:** the app connects as `postgres`, a superuser, which **bypasses RLS entirely**,
  and the policies key on `auth.uid()` / `current_org_id()` while the demo session is
  resolved in application code, so those functions have nothing to read. Two independent
  reasons it does nothing. Masking is enforced by the portal-specific read models (ADR-003)
  and that is the net with 88 tests behind it.
- **Rejected:** adding a restricted database role now. It would make RLS bite immediately,
  and any policy that is wrong or missing becomes a "row not found" bug across the app
  rather than a latent risk — a poor trade before a demo.
- **Rejected:** testing the policies against a restricted role without switching the app.
  Worth doing, but it proves a net nobody is standing on yet; the write-path tests were the
  better use of the same effort.
- **Impact:** three rules now written down where they will be read: do **not** describe this
  system as RLS-protected, do **not** weaken a read model because "RLS will catch it", and
  a new read path still needs its own leak test.

## 2026-10-07 — One concept, one word, and never a find-and-replace to get there

**Decision.** User-facing vocabulary is governed by one rule: **one concept, one word,
everywhere it is shown.** A column header, the filter chip that drives it, and the CSV column
exported from it are three views of one concept and must read the same. The full audit,
including everything deliberately left alone, lives in `project-brain/06-vocabulary.md`.

**Why.** Every defect found in the pass was the same shape, not an ugly word: the talent pool
had `SUPPLIER` sitting directly beside `VENDOR RATE` — one company under two words on one
table. A reader cannot tell whether that is one party or two. That costs more than jargon
does.

**Rejected: flattening "vendor" and "supplier" into one word.** It is the obvious fix for the
same-table defect, and the owner declined it (*"i dont want you to change vendor to supplier
or vice versa"*). `EMPLOYER` resolves the collision without pre-empting that choice, and
`docs/DOMAIN.md:7` supplies the word directly — bench is *"Engineers a vendor **employs** but
has not deployed"*. If one word is ever wanted it is a single decision applied everywhere at
once, never screen by screen.

**Rejected: renaming all five `RESOURCE` columns to `NAME`.** Two of the five render an
identifier and no name — `/client/engagements` renders `maskedId` alone, because the client
has no name to be shown. "NAME" there would imply one exists to be seen, which is the opposite
of the product's guarantee. **A header on a masked column is a masking decision, not a
label.** Those two are recommended as `REFERENCE`, which is already what the CSV calls them.

**Rejected: a find-and-replace.** `app/vendor/page.tsx:42` and `:144` look freshness counters
up on the **label text** and swallow a miss into `?? 0`. A sed over "Freshness" — or over
`Confirmed`/`Expiring`/`Unconfirmed` — makes the vendor dashboard silently report zero; it
type-checks, it builds, and no test fails. Every rename was a targeted replacement with an
asserted occurrence count, and the lookups were re-verified against their producer afterwards.

**Corollary, applied the same session.** A display string must never also be a sort or lookup
key. `getShellNav` sorted the organisation switcher on `a.role === "Broker"`, so renaming that
label would have silently changed the order; it now sorts on `isOps`. Where a label and a key
must coexist, the key is separate and stable.

---

## 2026-10-07 — A person's role is never rendered, and no job titles were invented

**Decision.** The shell shows the **organisation only**. `DemoSession.role` keeps the real
`user_role` enum value as data, and its doc comment says never to render it.

**Why.** Six ops pages rendered ``org: `${orgName} · ${session.role}` ``, printing the stored
enum into the top bar: **"Talentvibes · broker"** — and **"Talentvibes · ops_admin"**,
underscore included, for the other two ops values. A person's own title is the last place a
schema detail should surface.

**Rejected: a `ROLE_LABEL` map of job titles.** Written first, then deleted. It mapped
`broker → "Account manager"`, `ops_admin → "Admin"` and so on, which meant **the product
inventing job titles for a company whose titles it does not know**. The owner's instruction
settled it — *"no admin or anything but just something simple"* — and the simplest answer was
also the consistent one: the client and vendor portals already passed `org: session.orgName`
with no role, so only ops was the odd one out. Dropping it removes the objected-to word,
labels nobody, and makes all three portals identical. Dead code carrying guessed titles is
worse than no code.

**Still open:** `"your broker"` appears in 16 client-facing strings and in the "How this works"
explainer. That is a brand decision, deliberately not guessed — `06-vocabulary.md` §3a has the
options and the trade-offs.

## 2026-10-07 — A masked column's header, and a masked panel's absences, are masking decisions

**Decision.** The "People working" rows open a panel carrying everything the client may know
about a placement. It carries **no name**, and it says so in plain words on the panel itself.

**Why the name is withheld, stated properly.** Not because names are sensitive in themselves.
A name is a **side channel to the supplier**: name → public profile → current employer → the
supplier, whom the client could then contract with directly, which ends the business.
`docs/MASKING.md:20` is a flat `❌` for the client with no placement exception, its
side-channel table is the authority, and the v2 handoff says the same for this exact screen —
*"Rows are anonymous (TV id and role only)"* (`SCREENS.md:99`).

**Why it is written on the screen and not just enforced.** The owner asked for "full
information about the resource like name date of joining etc." An absence with no explanation
reads as a bug, and the next person to ask will ask again. The panel's footer gives the
reason, which is also the one argument that makes a client content with it: the same rule
keeps *their* rate private from the supplier.

**Rejected: showing the name post-placement.** There is a real argument — once someone works
at your company daily you already know their name, so masking it protects nothing. Put to the
owner explicitly and declined. If it is ever revisited it needs its own ADR,
`docs/MASKING.md` amended, the leak suite updated and `SCREENS.md:99` overridden; it is not a
change to make inside a feature.

**Rejected: a read-only panel.** Assessed and argued against before building. The rich
content — the proctored score and its four-section breakdown — lives on `shortlist_items`,
and the seed creates engagements with `requirement_id = null`, so **most placements have no
snapshot at all**. Strip it and the panel largely restates the row it was opened from. A test
score is also the least decision-relevant fact about someone seven months into a placement:
you know their actual performance better than any test does. So the panel is where you ACT —
it carries the extension request, a button that had existed with no handler since the screen
was built.

**Rejected: keeping "Request an extension" in the page header**, which is where
`SCREENS.md:96` puts it. An extension belongs to one person, and a header button has no way
to say which of five placements is meant — it would either guess or open a chooser that the
row click already is. A deliberate departure from the handoff, recorded here.

**Consequence for the read model.** `getClientEngagements` reaches `bench_resources`
directly rather than through the shortlist snapshot, and that table carries `full_name`,
`vendor_org_id`, `vendor_rate_paise`, contact details, the PAN/phone/email hashes and
`last_confirmed_at`. Columns are named explicitly (working agreement 7). Two available
columns are deliberately **not** selected: `github_handle`, because a repository handle
identifies a person as surely as a name, and `last_project_note`, because a note about
someone's last project can name the supplier's other client.

**Tenancy has two predicates, not one.** `shortlist_items` has no client column; it reaches a
client only through `shortlists → requirements.client_org_id`. So the snapshot query pins
**both** the engagement's `client_org_id` and the requirement's. With only the first, a
resource placed at two clients would match the other client's shortlist row and we would
serve its snapshot. Asserted by `tests/leak/read-models.test.ts`.

---

## 2026-10-07 — A sentinel number is not a layout, and `1fr` means `minmax(auto, 1fr)`

**Decision.** `ScoreBars` accepts `width?: number | string`, so `"100%"` expresses "fill the
container". `tests/layout-guards.test.ts` fails any inline pixel width above 2000px.

**Why.** Reported from the screen: the shortlist candidates "can expanded horizontally so it
is not making any sense and also it is not working properly". The cause was
`<ScoreBars sections={...} width={9999} />`. `ScoreBars` could only be given a number, so
full width was **unrepresentable** and a sentinel stood in for it — rendering a 9999px-wide
div inside a `repeat(3, 1fr)` grid. **`1fr` is `minmax(auto, 1fr)`**, so each column's
*minimum* became its child's min-content width. The cards stretched far past the viewport and
took their own buttons off screen with them, which is why the screen also looked broken. One
cause, both symptoms.

**The API gap was the bug.** Clamping the number would have hidden it; the fix is to make the
intent sayable. `maxWidth: 100%` and `minWidth: 0` were added to the bars as well, so they can
never dictate their container's width again.

**Rejected: a behaviour test.** Same reasoning as `tests/client-boundary.test.ts`. This
type-checked, built clean, server-rendered correct HTML and passed every test; it was visible
only to a person looking at the page. A DOM test would cover the one component that happened
to break, so the guard is a lint over every file instead — and it was **verified by
reintroducing the bug and watching it fail** with the file, line and reason.

**Also fixed in passing:** the grid was `repeat(3, 1fr)` at every width, so three columns
squashed on a narrow window. Now `repeat(auto-fit, minmax(272px, 1fr))` — three across on a
desktop, then two, then one, which is what `SCREENS.md` intended by "auto-fit, min 300px".

## 2026-10-08 — Display is an edge, and it was the one nobody converted

**Decision.** Every date a person reads goes through `istFormat()`. `tests/business-clock.test.ts`
pins it with absolute strings.

**Why.** `IST_TZ` was declared in `src/lib/derived.ts` and used for documentation only.
Sixteen formatters passed `"en-IN"` with **no `timeZone`**, which formats in whatever zone
the process runs in — UTC on Vercel. An interview booked for 11:00 IST rendered as **05:30**
on the deployed site. The locale was right and the clock was wrong, which is the hardest kind
of wrong to notice: nothing errors, nothing looks malformed, the time is simply not the time.

Working agreement 3 says business clocks run in Asia/Kolkata and to convert at the edges. The
audit that introduced the business clock fixed the **arithmetic** and left the **rendering**,
so the rule was half-applied for as long as the product has existed.

**Rejected: a formatter per shape.** One `istFormat(value, opts)` instead, taking the Intl
options each call site already passed. Seven money formatters are untouched —
`toLocaleString("en-IN")` on a *number* has no timezone to get wrong.

**Date-only columns were accidentally correct and are now correct on purpose.** `date` parses
as UTC midnight, and 05:30 IST on the 31st is still the 31st — but the same value in a zone
*behind* UTC would have shown the 30th.

---

## 2026-10-08 — A control that needs a table it does not have is removed, not faked

**Decision.** "Panel availability" is **off the interviews screen**. "Propose new slots" and
"Reschedule" ship, because `interview_slots` supports them completely.

**Why.** Recurring availability — "Tuesdays suit us" — has nowhere to live:
`interview_slots.interview_id` is `not null`, so every slot hangs off one specific round.
That is a new table, and the database-safety rule says to ask before adding one.

**Rejected: keeping the button and making it a read-only list of slots.** That was the first
plan and it is worse than leaving it inert. It renames a *write* control into a *view*: a
person clicks a button that says "set" and gets a list. Working agreement 8 says pick the
safest default and do not invent business rules silently; quietly redefining what a control
does is the same failure wearing different clothes.

---

## 2026-10-08 — Pool filters live in the URL, and a filter must agree with what it filters

**Decision.** The talent pool's filters are query parameters, pushed into SQL. A saved view
is therefore nothing but a set of parameters.

**Why the URL.** A view becomes a navigation rather than a second state mechanism, the page
re-queries on its own under `force-dynamic`, a filtered pool can be pasted to a colleague,
and the back button undoes a filter.

**Why in SQL.** The one filter that already worked, `search`, ran in memory **after**
`.limit(60)` — so it searched the first 60 rows of 1,284 and the count beside it described
the page. `matchCount` (no limit, counted in the database) and `resultCount` (rendered) are
now separate numbers, and a test asserts the first does not move when the page size does.

**The freshness filter uses the same arithmetic as the pill it filters on** — an IST
calendar-date subtraction, not `now() - interval '10 days'`. Elapsed-hours arithmetic would
let a row sit under "Needs confirming" while its own pill read "Confirmed".

**That check caught a real bug.** The three freshness states are exhaustive and exclusive, so
their counts must sum to the unfiltered total. They summed to one MORE: the `unconfirmed`
condition was an **un-parenthesised OR**, so `and(...conds)` produced
`status in (...) and last_confirmed_at is null or days >= 14`, which SQL reads as
`(status in (...) and last_confirmed_at is null) or (days >= 14)` — the second branch escaped
the status filter and pulled in withdrawn profiles. **An OR inside an AND needs its own
parentheses, every time.**

**The score filter is pinned to the highest attempt**, which is the row the SCORE column
shows. Otherwise someone whose first attempt scored 90 and whose retake scored 60 passes an
"80+" filter and then renders 60.

**Skills AND together**, one EXISTS each: naming two skills means one person with both.

**No audit row for a saved view.** Working agreement 5 covers a stage, a rate, a shortlist or
a duplicate resolution. A saved view is none of them and no dispute turns on which filters a
broker bookmarked; writing one anyway would dilute a log whose value is that every line in it
matters. `filters` is `jsonb`, so it is Zod-validated rather than trusted — without a schema
the endpoint would store any object posted to it and the pool would read it back as filters.

## 2026-10-08 — `/` is a router, and the smoke page is gone

**Decision.** `app/page.tsx` redirects. It honours the acting-organisation cookie via
`landingFor()` and defaults to `/client`.

**Why.** The owner's reason was that the organisation switcher in the top bar already does
the portal-choosing the page's three links were for. Two more reasons agree with it:

- **It had done its job.** Its own comment said *"it will be replaced by the portal router"*.
  It existed to prove the pipe end to end — Vercel build, env vars, the Supavisor transaction
  pooler from a serverless function, and one real read through a portal read model with
  ADR-004 bands — before any screen existed to sit on top of it. `npm test` and `db:verify`
  cover all of that now, on every change rather than on every visit.
- **It published more than it needed to.** It was the first thing anyone opened, and it
  described the product to itself — "three portals, one database, masking enforced on the
  server" is an architecture note, not a landing page — above a row of table counts that gave
  the exact size of the exchange to anyone with the URL.

**`getPortalSwitcherOptions()` was deleted with it**, along with its `title()` helper. The
page was its only caller, and the same reasoning that deleted the `ROLE_LABEL` map applies:
dead code with real-looking semantics is worse than no code, because the next person assumes
it is used.

**`landingFor()` was extracted rather than duplicated.** The rule — supply-only to the vendor
side, hire-only to the client side, dual-role to the vendor side with tabs offering the other,
broker to ops — now has one definition shared by the switcher's hrefs and by `/`. The
switcher's hrefs had never been asserted, so there are now four tests on it: a change to
where the root URL sends people would otherwise have broken nothing visible.

**Verified at runtime, not just compiled.** `next start` plus a request: `GET /` returns
`307 → /client`.

**`ACCENT_GRADIENT` in `style.ts` is now unused and deliberately kept.** It is a design token
from the v2 handoff, not logic — an unused palette entry is a palette, whereas an unused
function implies a caller.
