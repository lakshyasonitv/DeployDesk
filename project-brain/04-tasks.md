# 04 — Tasks

> Now = this/next session. Next = soon. Later = someday. Done = finished (newest on top,
> with date).
>
> Phase checkboxes live in `../BUILD-PLAN.md` and are ticked there. This file is the
> working queue — what is actually in hand right now.

## Now

Phase 0 — Foundations. Order matters; this is the build plan's order.

- [ ] Scaffold Next.js + TypeScript, App Router, strict mode, path aliases
- [ ] Decide the package manager (build plan's exit test implies **pnpm**)
- [ ] `git init` + first commit: the eleven root docs, the design handoff, and
      `project-brain/`, before any code lands
- [ ] Resolve the `docs/` path discrepancy — move the docs into `docs/`, or correct the
      references in `CLAUDE.md`. Pick one and record it in `02-decisions.md`
- [ ] Supabase project + local dev via the Supabase CLI, so migrations run offline
- [ ] Drizzle configured; first migration creates `pgcrypto`, `citext`, `pg_trgm`,
      `pg_cron`
- [ ] Restricted application DB role — the app must never connect as the service role
- [ ] Environment schema validated at boot; fail fast on a missing pepper or key
- [ ] Structured logging with a request id; **PII never logged, not even in error paths**
- [ ] CI: typecheck, lint, migration check, test
- [ ] Verify Phase 0 exit test: `pnpm dev` boots against a local Postgres with zero tables
      and CI is green

## Next

Phase 1 — Tenancy, auth and the masking harness. Build the enforcement machinery before
the data it protects. Full item list: `../BUILD-PLAN.md` → Phase 1.

- [ ] First tables: `organizations`, `vendor_profiles`, `client_profiles`, `users`,
      `audit_log`
- [ ] Supabase Auth wired; JWT carries `org_id`, `org_type`, `role`
- [ ] Guard helpers: `requirePortal`, `requireRole`, `assertOwnership`
- [ ] RLS on every table so far, tested **with the service role bypassed**
- [ ] Read-model folders + lint rule forbidding imports across `client/`, `vendor/`,
      `ops/`
- [ ] `sensitive_columns` registry + the build step that fails when a tagged column
      appears in a client/vendor view
- [ ] Leak-test harness with golden fixtures, wired into CI (passing trivially is fine)

## Later

- [ ] Raise the ADR-004 band discrepancy with the design owner — client bands will read
      higher than the mockups, and that is correct. Do this before Phase 6.
- [ ] Get business answers on open questions Q1, Q5 and Q7 (see
      `03-progress.md` → Blocked / waiting on)
- [ ] Phases 2–12 — see `../BUILD-PLAN.md`

## Done

- [x] 2026-10-06 — Project brain initialized; repo surveyed and state recorded
