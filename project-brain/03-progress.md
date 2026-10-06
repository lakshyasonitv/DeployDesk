---
project: talentvibes bench
status: active
last_log: 2026-10-06
---

# 03 — Progress

> The "you are here" map. Rewritten every session by /brain log. Keep the frontmatter
> above updated: `last_log` = date of the latest log, `status` = active | paused | done.

## Current state

**Specification complete, implementation at zero.** The repo holds eleven root markdown
docs (~2,550 lines) covering architecture, data model, masking, domain rules, API,
matching, decisions, build plan, testing and seed data, plus the finished frontend design
handoff in `design_handoff_bench_exchange/`. There is **no application code at all** — no
`package.json`, no `src/`, no migrations, no Next.js project. Not a git repo either.

Every checkbox in `../BUILD-PLAN.md` is unticked, including all seven items of Phase 0.
Ten ADRs are accepted and ten open questions (Q1–Q10) are parked with safer defaults
recorded, so the technical direction is settled and the spec is unusually detailed for a
pre-code project — the next session's job is scaffolding, not deciding.

Nothing is broken, because nothing runs yet.

## Start here next time

**Begin Phase 0 of `../BUILD-PLAN.md`, in its listed order.** The first concrete action:
scaffold the Next.js + TypeScript project (App Router, strict mode, path aliases) in the
repo root alongside the existing docs, then `git init` and commit the docs plus
`project-brain/` as the first commit before any code lands.

Phase 0's exit test, verbatim from the build plan: *"`pnpm dev` boots against a local
Postgres with zero tables and CI is green."*

Two decisions to make while scaffolding, neither yet taken:
1. Whether the eleven root docs move into `docs/` to match the paths `../CLAUDE.md`
   already uses, or the references get corrected instead (see Gotchas in
   `01-architecture.md`).
2. Package manager — the build plan's "done when" says `pnpm dev`, which implies pnpm, but
   nothing is committed to yet.

Do **not** jump ahead to Phase 2. The build plan deliberately puts the masking harness
(Phase 1) before any data that could leak, and says so explicitly.

## Milestones

Mirrors `../BUILD-PLAN.md`, which is the authority — tick there first, then here.

- [ ] **Phase 0** — Foundations (Next.js, Supabase, Drizzle, restricted DB role, CI)
- [ ] **Phase 1** — Tenancy, auth and the masking harness *(before any real data)*
- [ ] **Phase 2** — Supply side: vendor roster, masked IDs, freshness, bulk import
- [ ] **Phase 3** — Assessments behind the provider adapter
- [ ] **Phase 4** — Demand side: requirements, SLA clocks, client dashboard
- [ ] **Phase 5** — Matching: six scorers, eligibility gates, proposed client rate
- [ ] **Phase 6** — Shortlists, the hero path *(snapshot + leak suite)*
- [ ] **Phase 7** — Brokering: two-sided threads and audited relay
- [ ] **Phase 8** — Interviews and feedback
- [ ] **Phase 9** — Placements, margin and billing
- [ ] **Phase 10** — Duplicate detection and resolution
- [ ] **Phase 11** — Ops console completeness
- [ ] **Phase 12** — Hardening before launch

## Blocked / waiting on

Nothing blocking Phase 0 — it can start immediately.

Needs a business answer before the affected phase ships (all have a safer default recorded
in the **Open questions** table of `../DECISIONS.md`, so none of them block today):

- **Q1** — is client identity ever revealed to the vendor? Default: **never**, no reveal
  path built. Affects Phase 9.
- **Q5** — who approves a below-floor margin? Default: `ops_admin` only. Affects Phase 9.
- **Q7** — PII retention for archived bench resources; needs counsel on DPDP Act
  obligations. Affects Phase 12.

Also outstanding, not a blocker: the client-facing rate bands in the design mockups leak
the margin (ADR-004). **Needs raising with the design owner** before Phase 6 renders a
shortlist, so the deviation is expected rather than filed as a bug.
