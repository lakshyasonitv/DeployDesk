# 04 — Tasks

> Now = this/next session. Next = soon. Later = someday. Done = finished (newest on top,
> with date).
>
> Phase checkboxes live in `../docs/BUILD-PLAN.md` and are ticked there. This file is the
> working queue — what is actually in hand right now.
>
> **Goal: a deployed demo of all 15 screens, today (2026-10-06).** Work the Now list
> strictly top to bottom; each step depends on the one above it.

## Now — in order

- [ ] **1. Get the Supabase connection strings** (blocked on the user — see
      `03-progress.md`). Transaction pooler :6543 and direct :5432.
- [ ] **2. `npm run db:push`** — create the ~25 tables on Supabase
- [ ] **3. `npm run db:seed`** — load the fixture set
- [ ] **4. Verify the seed** against the design: freshness states, REQ-2295 as the single
      SLA breach, TV-3964 at 17.4% and TV-4488 at 14.2% below the floor, six REQ-2291
      bands derived from the client rate (higher than the mockups, per ADR-004)
- [ ] **5. Ops read model** — pipeline, matching workspace, talent pool, margin, duplicates
- [ ] **6. Deploy a skeleton to Vercel** — one page reading one row, to prove the pipe
      before building screens on it
- [ ] **7. UI shell** — sidebar, design tokens, the `s()` inline-style helper, portal
      switcher
- [ ] **8. The demo trio** — client shortlist review, ops matching workspace, vendor roster
- [ ] **9. The remaining twelve screens**
- [ ] **10. Leak test** over the read-model functions + an import-boundary test
- [ ] **11. Final deploy and a walkthrough of all 15 screens**

## Next

- [ ] Push to `github.com/lakshyasonitv/DeployDesk.git` (currently refused — needs
      approval or a manual push)
- [ ] Flag to the design owner: client rate bands read higher than the mockups (ADR-004),
      and algorithm rank order differs in pools A, B and D (ADR-011). Both deliberate.
- [ ] RLS policies — the second net. Read models are the first and are in place.
- [ ] CI: typecheck, lint, migration check, leak suite
- [ ] Restricted application DB role, so the app never connects as service role

## Later

- [ ] Real Supabase Auth with the three demo tenants; today's build uses a demo session
- [ ] Business answers on open questions Q1, Q5, Q7
- [ ] Phases 3, 7, 8, 9, 10 proper (assessments provider, brokering, interviews, billing,
      duplicates) — the demo seeds their data but implements little of their logic
- [ ] Phase 12 hardening — rate limiting, file metadata stripping, PII retention, load test

## Done

- [x] 2026-10-06 — Read models: client portal and vendor portal
- [x] 2026-10-06 — Seed written in full (7 modules); ADR-011 recorded for the scorer
      divergence found while writing it
- [x] 2026-10-06 — Fixture data extracted mechanically from the prototype into JSON,
      counts cross-checked against `docs/SEED-DATA.md`
- [x] 2026-10-06 — Derived-value and money libraries, including `deriveRateBand()` (ADR-004)
      and the random masked-ID allocator (ADR-010)
- [x] 2026-10-06 — Drizzle schema for ~25 tables, typechecking clean
- [x] 2026-10-06 — Next.js app scaffolded by hand, deps installed, DB client configured
      for the transaction pooler
- [x] 2026-10-06 — Moved the ten spec docs into `docs/`, fixing the paths `CLAUDE.md`
      already referenced
- [x] 2026-10-06 — Project brain initialized; repo surveyed and state recorded
