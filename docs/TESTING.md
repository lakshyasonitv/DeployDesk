# TESTING.md

## Priorities

This is a low-volume, high-trust product. A slow endpoint costs patience; a leaked vendor
name costs the business. Test accordingly:

1. **Leak tests** — masking. Non-negotiable, blocking in CI.
2. **Transactional integrity** — shortlist send, billing runs, stage guards.
3. **Derived-value correctness** — freshness, SLA, margin, rate bands.
4. **Matching determinism** — same inputs, same order, every time.
5. Everything else.

## Leak tests — the suite that must never be skipped

**Setup.** A fully populated fixture database (`docs/SEED-DATA.md`) with deliberately
distinctive values that are trivially greppable: vendor names, client names, candidate
names, and exact rates that appear nowhere else.

**Method.** For every endpoint under `/api/client/*` and `/api/vendor/*`, as every role,
with every filter permutation that changes the shape:

1. Fetch the response.
2. Walk the JSON **recursively to any depth**, including inside strings, arrays and nested
   objects.
3. Assert none of the following appears:

| Check | Client responses | Vendor responses |
|---|---|---|
| Forbidden key names (`vendor_id`, `vendor_name`, `vendor_rate_paise`, `margin*`, `spread*`, `full_name`, `resource_id`, `pan_hash`, `client_org_id`, `client_rate_paise`, `client_note`) | ✅ | ✅ |
| Any known vendor name from the fixture set | ✅ | own only |
| Any known client name from the fixture set | own only | ✅ |
| Any candidate legal name | ✅ | own only |
| Any exact vendor rate value | ✅ | own only |
| Any exact client rate value | — | ✅ |
| Any employer name from `employment_history` | ✅ | own only |
| A rate band overlapping the corresponding vendor rate (ADR-004) | ✅ | — |
| `created_at` on a candidate-shaped object | ✅ | — |
| Freshness state | ✅ | — |

**Enumeration, not enumeration-by-hand.** Derive the endpoint list from the route
filesystem so a new route that is never added to the test list fails the coverage check.
A leak test suite that a developer must remember to extend is a leak test suite that will
be forgotten.

**Also assert the positive.** Each portal's expected fields must be *present*. A response
that returns `{}` would pass every negative check.

### Side-channel tests

- **Ordering**: shuffle the fixture insertion order, re-run the client shortlist endpoint,
  assert the returned order is identical (it follows explicit rank, not insertion order).
- **ID clustering**: allocate 500 masked IDs across 5 vendors and assert no statistically
  significant correlation between ID value and vendor.
- **Preview suppression**: craft filters matching exactly 1, 4 and 5 profiles; assert the
  first two return `"fewer than 5"` and cannot be narrowed further.
- **Error bodies**: request another org's requirement; assert the 404 body contains no
  organisation name, no id and no hint that the resource exists.

## Unit tests

**Derived values.** Table-driven, using the exact boundaries from `docs/DOMAIN.md`:

- Freshness: days 0, 3, 9, 10, 13, 14, 27, 28, 100 → state and decay width. The 9/10 and
  13/14 boundaries are the ones that will break.
- SLA: inside/outside business hours, across a weekend, across a configured holiday, and
  the `idle` pause on entry to `shortlisted`.
- Margin: 17.9%, 18.0%, 18.1%, 21.9%, 22.0%, 22.1% → colour band and floor behaviour. Use
  paise integers; assert no float appears anywhere in the computation.
- Rate bands: assert `band_min > vendor_rate` for every seeded candidate, and that
  quantisation makes two candidates with different exact rates share a band.

**Matching.** Each of the six components gets hand-worked examples from `docs/MATCHING.md`.
Then a golden test: the seeded pools must reproduce the design's published rank order. When
you change a weight, this test fails — that is the point. Update the golden file
deliberately, with a note in `docs/DECISIONS.md`.

**Duplicate confidence.** The `TV-4821` / `TV-7188-B` fixture must score ≥ 85 and block.
The `TV-3964` / `TV-6104` fixture must land in 60–84 and flag without blocking.

## Integration tests

**Shortlist send** — the transaction that matters most:

- Happy path: creates a shortlist, snapshots items, moves the stage, writes audit, notifies.
- Blocked by an open duplicate flag → nothing is created, stage unchanged.
- One ineligible candidate in the set → whole send rejected, nothing partially written.
- Idempotency key replayed → one shortlist, not two.
- Concurrent sends for the same requirement → one succeeds, one fails cleanly.
- After sending, mutate the underlying resource's rate and freshness → assert the client's
  view is **unchanged** (ADR-009).

**Stage guards** — every transition in the `docs/DOMAIN.md` table, including the ones that
must be blocked, plus undo producing a second event rather than deleting the first.

**Brokering** — a client message and a vendor message on linked threads; assert neither
portal can read the other's thread by id, by scope, or through any list endpoint.

**Billing** — a mid-month start and a mid-month end in the same period; assert pro-rata
amounts on both the receivable and payable sides, and that the vendor endpoint returns only
payable lines.

**RLS** — run the whole integration suite a second time with the application connecting as
the restricted role and RLS enforced. Anything that passes only with the service role has a
missing policy.

## Test data

Use `docs/SEED-DATA.md`. Three profiles:

| Profile | Contents | Used by |
|---|---|---|
| `minimal` | 1 client, 1 vendor, 3 resources, 1 requirement | Unit and fast integration |
| `design` | Exactly the prototype's fixtures — 24 requirements, 4 pools, 2 duplicate flags | Golden tests, leak suite, demos |
| `scale` | 20k resources, 500 requirements, generated | Performance and index checks |

Never generate fixtures randomly without a fixed seed — a leak test that passes on Tuesday
and fails on Wednesday teaches people to re-run CI rather than read the failure.

## Performance checks

Run against `scale`, asserted as budgets in CI (fail at 2× budget, warn at 1.5×):

| Endpoint | Budget p95 |
|---|---|
| `GET /api/ops/pool` with four filters | 400 ms |
| `GET /api/ops/pipeline?view=board` at 500 requirements | 500 ms |
| `POST /api/client/requirements/preview` | 200 ms |
| `GET /api/vendor/resources` at 2,000 own resources | 300 ms |

Check `EXPLAIN` plans for the pool query in review — a sequential scan on
`bench_resources` at scale is the first thing that will regress.

## What not to test

- Design token values and CSS — that is the frontend's contract with the design file.
- Third-party SDK behaviour; mock at the adapter boundary instead.
- Exact copy strings, except the ones that are compliance promises: the masking footers on
  the broker drawer, the vendor earnings screen and the add-resource form. Those are
  commitments, and a test is the right place to record them.
