# 00 — Project Overview

> Identity of the project — what and why. Update only when direction changes.

## What is being built

**Talentvibes Bench Exchange** — the backend for a brokered marketplace in IT bench
capacity. Vendors (supplier companies) list idle engineers; clients (hiring companies)
post requirements and hire them. Talentvibes is the sole broker in the middle.

Three portals over one backend — `client`, `vendor`, `ops` — built as one Next.js app
on Supabase Postgres. The frontend is already designed and specified; this repo is the
server behind it.

## Who is it for / what problem does it solve

Three distinct users, and they must stay separated:

- **Vendors** — have engineers sitting idle on the bench, burning cost, and no reliable
  demand channel.
- **Clients** — need vetted contract engineers fast, with a *proctored* score they can
  trust rather than a vendor's own claim.
- **Talentvibes ops (brokers)** — the only party that sees both sides. Sources, ranks,
  masks, relays, and prices every placement.

The commercial reason the product exists: **neither side may ever identify the other, or
see the margin.** If a client can identify the supplier, they contract them directly and
the business dies. See the non-negotiable rule at the top of `../CLAUDE.md`, and the
field-level visibility matrix in `../MASKING.md`.

## Dual-role organisations (added 2026-10-06)

Some companies are both sides of the exchange: an IT services firm with engineers on its
bench also hires contract engineers. This is now a first-class case, not an edge case.

- What a company may do lives in `org_capabilities (can_supply, can_hire)` — the
  authoritative record. `organizations.org_type` is derived from it.
- A user still belongs to exactly one organisation, but a membership carries a SET of
  roles (supply, demand, admin). The portal switcher became a production feature for
  multi-capability orgs. See **ADR-012**.
- Three consequences that shape the UI and are easy to get wrong:
  1. a supply-only org must see **no trace** of a hiring side — not even a disabled tab;
  2. the two rate views must never appear on the same screen for the same org, or it can
     infer the platform's margin;
  3. dual-role orgs therefore default to a **flat declared fee** rather than a hidden
     markup — if the fee is declared, there is no margin to infer.
- A **self-dealing rule** follows: a resource whose supplying org shares a `group_id` with
  the requirement's client org must never be offered as a candidate. Groups are declared
  by ops from the MSA, never inferred from PAN or GSTIN.

## What does "done" look like

v1 ships the full brokered lifecycle:

> requirement → sourcing → matching → **masked shortlist** → brokered interviews →
> placement → billing

The hero path is **Phase 6 — the masked shortlist**: a client reviews candidates rendered
entirely from immutable snapshot data (ADR-009), with the leak suite proving no vendor
identity, exact vendor rate, or margin reached them.

Phase-by-phase scope and the "done when" test for each phase live in `../BUILD-PLAN.md`
(13 phases, 0 through 12). That file is the authority — tick boxes there, not here.

Launch scale: ~2,000 bench resources, ~25 concurrent requirements, ~20 vendors,
~10 clients. Designed for 20x without re-architecting.

## Explicitly OUT of scope

Two lists already exist and are authoritative — do not duplicate them here:

- `../BUILD-PLAN.md` → **Anti-goals** (shared candidate API across portals, client-side
  masking of any kind, direct browser→Supabase for business data, websockets, mobile)
- `../ARCHITECTURE.md` → **What is deliberately out of scope for v1** (command palette,
  multi-currency, self-serve vendor onboarding)

The one worth memorising: **there is no such thing as client-side masking in this
product.** Every masking decision is server-side, in a portal-specific read model.
