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
