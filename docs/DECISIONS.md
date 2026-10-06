# DECISIONS.md — ADRs

Append new ADRs at the bottom. Never edit an accepted one — supersede it with a new record
and mark the old one `Superseded by ADR-NNN`.

---

## ADR-001: Next.js route handlers + Supabase Postgres

**Status:** Accepted · **Date:** 2026-08-24

### Context
The three portals are one product with one design system and one data model. The team is
small. An adjacent in-house product already runs on Next.js + Supabase, so the operational
knowledge exists. Volume at launch is low (tens of requirements, thousands of profiles).

### Options considered

| | Next.js route handlers + Supabase | Separate NestJS API + managed Postgres | Supabase client direct from the browser |
|---|---|---|---|
| Complexity | Low | Medium | Lowest |
| Masking safety | Good — server-side by construction | Good | **Unacceptable** |
| Team familiarity | High | Medium | High |
| Deploy surface | One | Two | One |
| Escape hatch later | Extract services when needed | Already separate | None |

### Decision
Next.js App Router route handlers as the API layer, Postgres on Supabase, Drizzle for
schema and queries, RLS as a second net.

Direct browser-to-Supabase access is **rejected outright**. Row Level Security can enforce
row visibility but not the column-level, derived and snapshot logic that masking requires —
rate bands, redacted relays and shortlist snapshots are all computed server-side. Exposing
the database to the browser would put the product's core guarantee in the hands of a policy
file.

### Consequences
- One deploy, one codebase, fast iteration.
- Long-running work (bulk imports, nightly sweeps) does not fit a request handler; it runs
  on `pg_cron` plus a job table (ADR-005).
- If the ops console later needs heavier analytics, extract a read service rather than
  splitting the whole API.

---

## ADR-002: Modular monolith, not microservices

**Status:** Accepted · **Date:** 2026-08-24

**Context.** Tempting boundaries exist (matching, brokering, billing).

**Decision.** One service, clear module boundaries inside it.

**Rationale.** The critical transaction — send a masked shortlist — touches matches,
shortlists, requirements, duplicates and the audit log atomically. Across services that
becomes a saga, and a partially-sent shortlist is a business-visible failure. Volume does
not justify the cost. Keep modules clean enough to extract later.

---

## ADR-003: Separate read models per portal; no shared serializer

**Status:** Accepted · **Date:** 2026-08-24

**Context.** The obvious design is one `Candidate` type with optional fields, filtered per
role. That design fails open: a new column added for ops appears in the client response
unless someone remembers to exclude it.

**Decision.** Three unrelated types in three folders, sharing no base interface, plus
Postgres views per audience, plus CI leak tests over golden fixtures.

**Consequences.** More typing, some duplication. Accepted deliberately: duplication that
fails closed beats abstraction that fails open. A reviewer seeing a shared base type across
portals should reject the change.

---

## ADR-004: Client-facing rate bands are derived from the client rate, never the vendor rate

**Status:** Accepted · **Date:** 2026-08-24

### Context
The design prototype shows masked cards with a rate band — `TV-4821: ₹1.35–1.55L` — while
the same candidate's ops record shows a vendor rate of ₹1.38L and a proposed client rate of
₹1.82L. Every fixture follows the same pattern: **the client-facing band brackets the vendor
cost.** A client comparing the band on the card with the invoice they eventually receive
recovers the spread, and therefore the margin, on every placement. This defeats the product.

It is almost certainly an artefact of building a prototype from one candidate list rather
than an intentional pricing decision — but it is baked into the fixtures, so it will be
copied unless this record exists.

### Decision
`shortlist_items.rate_band_*` is derived **only** from `proposed_client_rate`:

```
band_min = floor_to(rate × 0.95, ₹10,000)
band_max = ceil_to (rate × 1.10, ₹10,000)
```

Fixed multipliers and coarse ₹10,000 quantisation, so band width never varies with margin
and the exact rate cannot be recovered by comparison across candidates. The band is computed
once, at send time, and stored. `vendor_rate` is not an input to this function and must not
be in scope where it is defined.

### Consequences
- Bands on client cards will read higher than the design mockups. **That is correct.**
  Flag it to the design owner rather than reverting.
- Ops may override a band within a permitted range, with a note and an audit row.
- A leak test asserts that no client-facing band overlaps the corresponding vendor rate.

---

## ADR-005: Scheduled work via pg_cron plus a job table

**Status:** Accepted · **Date:** 2026-08-24

**Decision.** `pg_cron` triggers a job-enqueue function; workers drain a `jobs` table.
No external queue.

**Rationale.** The workload is small, periodic and database-centric (freshness sweeps, SLA
recomputation, billing runs). A dedicated queue is infrastructure without a payoff at this
scale. Jobs are idempotent and audited; failures retry with backoff and surface in the ops
console after three attempts.

**Revisit when** bulk imports regularly exceed 500 rows or a job needs to run more often
than every minute.

---

## ADR-006: Assessments behind a provider adapter

**Status:** Accepted · **Date:** 2026-08-24

**Context.** The exchange's differentiator is that every profile carries a *proctored* score
with a four-section breakdown, and neither vendors nor clients can influence it. There is an
in-house proctored-exam platform already in flight with the same four-section shape, so the
first implementation of the adapter is likely to point at it.

**Decision.** Define an `AssessmentProvider` interface (`invite`, `getStatus`, `getReport`,
`verifyWebhook`) and code against it. Do not couple domain logic to any provider's schema.
Store `provider` and `provider_ref` on every assessment row.

**Consequences.**
- The proctoring platform can be swapped, or a second provider added per track, without
  touching matching.
- Score authority stays with the provider: no API path in `/api/vendor/*` writes a score.
- The raw report stays ops-only; a name-free `summary_json` is what reaches clients.

---

## ADR-007: Money as bigint paise

**Status:** Accepted · **Date:** 2026-08-24

**Decision.** All amounts are `bigint` in paise. No floats, no decimals, no formatted
strings in the database or in API responses.

**Rationale.** Margin arithmetic on floats drifts, and the guardrail is 18.0% — a value that
rounding can flip either side of. Indian formatting (`₹1.38L`, `₹3.4Cr`) is presentation and
belongs in the UI, where the design already specifies both conventions.

---

## ADR-008: Two broker threads, never one shared thread

**Status:** Accepted · **Date:** 2026-08-24

**Context.** The naive model is one thread per candidate with three participants and
per-message visibility flags.

**Decision.** Two independent threads joined by `linked_thread_id`, visible only to ops.
Relaying creates a **new message** in the counterpart thread with `relayed_from_id` and a
human-approved redacted body.

**Rationale.** Visibility flags fail open: one bug in a filter and a client reads a vendor's
message. Separate threads fail closed — there is no query that returns the other side's
messages to a portal user, because the thread id is not theirs. It also matches reality:
the two conversations genuinely differ, and the redaction is editorial work a broker does.

---

## ADR-009: Shortlists are immutable snapshots

**Status:** Accepted · **Date:** 2026-08-24

**Decision.** Sending a shortlist copies the client-visible fields into `shortlist_items`.
The client read path never joins to `bench_resources` or `matches`.

**Rationale.** Two benefits. (1) Structural masking — the client-facing table has no vendor
column, so no query mistake can expose one. (2) Stability — a vendor editing a rate, or a
freshness timer expiring mid-review, must not change a shortlist a client is deciding on.
Ops is notified when a snapshot diverges from live data; the snapshot does not move.

**Consequences.** A second shortlist for the same requirement is a new `shortlists` row with
an incremented `sequence_no`, not a mutation of the first.

---

## ADR-010: Masked IDs are random and never reused

**Status:** Accepted · **Date:** 2026-08-24

**Decision.** `TV-####` allocated at random from unused values, immutable, never reused,
never derived from candidate data. Widen the format beyond four digits at ~30% occupancy.

**Rationale.** Sequential allocation leaks listing order, which correlates with bulk-upload
batches, which correlates with vendor identity. Reuse would let a client believe a returning
ID is the same person. Deriving from a name is reversible.

---

## Open questions

Resolve these with the business before the affected code ships. Until then, take the
**safer default** listed and note it in the code.

| # | Question | Safer default in the meantime |
|---|---|---|
| Q1 | Is the client's identity revealed to the vendor at placement, or never? The vendor dashboard says "hides the hiring company until placement", but the earnings screen says client identity is never shared. | **Never.** Do not build a reveal path. |
| Q2 | Does the candidate learn the client's name before an interview? In practice they must, to attend. What are they told about the vendor's exclusion? | Brief candidates via ops with an explicit NDA clause; never through the vendor. |
| Q3 | Can a client see that the same masked ID appeared on an earlier shortlist for a different requirement of theirs? | **No.** Cross-requirement correlation is a fingerprinting vector. |
| Q4 | Retake policy exact numbers: 60 days after a sub-80 score, 90-day validity. Confirmed by the business? | Use 60/90 as specified; make both configurable. |
| Q5 | Below-floor margin approval — who can approve? Any ops user, or `ops_admin` only? | `ops_admin` only. |
| Q6 | Multi-currency and non-India expansion? | Model amounts with a `currency` column now, hardcode `INR`, so the migration later is not a rewrite. |
| Q7 | Data retention for withdrawn/archived bench resources and their PII. | Anonymise `full_name`, contacts and hashes 24 months after archival; keep the masked ID and outcome data. Confirm against DPDP Act obligations with counsel. |
| Q8 | Does a client ever get the assessment report file, or only the summary? | Summary only. |
| Q9 | Vendor reliability formula weights — the design shows scores (4.6, 3.1) but no derivation. | Use the formula in `docs/DOMAIN.md`, version it, revisit after 90 days of real outcomes. |
| Q10 | Is the exchange exclusive — can a client contract a vendor directly after meeting them at an interview? | Contractual, not technical. Ensure the audit log can evidence introduction dates. |

---

## ADR-011: Demo seed computes `algo_score` from components; the prototype's own scores diverge

**Status:** Accepted · **Date:** 2026-10-06

### Context

`docs/SEED-DATA.md` names Pool A (94, 89, 86, 81, 77, 68) as the golden case for
`docs/MATCHING.md` and says: *"If your scorer does not reproduce this order from the
underlying attributes, either the scorer or the fixture needs adjusting — investigate
before changing either."*

Investigated. Applying the documented weights (30/22/16/14/10/8) to the six component
values the prototype ships for each candidate reproduces the fixture's own `match` value
only in Pool C. Elsewhere it diverges, and in three of four pools it changes the order:

| Pool | Order reproduced | Largest divergence |
|---|---|---|
| A | No — TV-6620 and TV-7715 swap | TV-6612, +3 |
| B | No — TV-7702 and TV-6119 swap | TV-5981, +5 |
| C | **Yes** | TV-7341, +3 |
| D | No — TV-4488 and TV-5990 swap | TV-4488, −7 |

The divergences are not random: they are largest where a candidate is penalised by the
freshness or vendor components. TV-4488 is `Unconfirmed 26d` with a freshness component of
30, which the weighted sum punishes to 81 while the fixture ranks it top of Pool D at 88.
The conclusion is that the prototype's `match` values and its component bars were authored
independently, for visual effect, rather than one being computed from the other.

### Decision

Seed the six component values and **compute** `algo_score` from them with the documented
weights. Do not seed `algo_score`.

### Rationale

The ops matching workspace renders the six components as bars next to the total. If the
total were seeded from the mockup, a broker adding up the bars would get a different
number — visibly incoherent on the one screen whose entire purpose is explaining an
ordering to a human. `docs/MATCHING.md` requires every component to be "independently
defensible to a broker who has to justify an ordering to a client"; a total that does not
follow from the bars cannot be defended.

This also keeps `docs/SEED-DATA.md`'s instruction intact — "Do not seed `algo_score`
directly. A seeded score would make the golden test tautological."

### Consequences

- Algorithm-order rankings in the ops workspace will differ from the design mockups in
  pools A, B and D. **That is correct.** Flag it to the design owner rather than reverting.
- The hero shortlist screen is unaffected: the design's shortlist order for REQ-2291
  (TV-6620, TV-4821, TV-5302, TV-5107, TV-4488, TV-3964) is a broker's `manual_rank`, not
  the algorithm order, and is seeded as such.
- The golden test for the scorer should assert against hand-worked component arithmetic,
  not against the prototype's `match` values. Pool C can serve as the one fixture where
  both agree.
- Revisit if the business confirms the mockup ordering was intentional — in which case the
  weights in `docs/MATCHING.md` are wrong, not the fixtures.

---

## ADR-012: A membership holds a set of roles, and the portal switcher becomes production

**Status:** Accepted · **Date:** 2026-10-06
**Supersedes, in part:** the single-role, no-switcher assumptions in `docs/DATA-MODEL.md`
§1 and `docs/ARCHITECTURE.md` → *Tenancy and authorisation*.

### Context

Some companies on the exchange are both sides of it: an IT services firm with engineers on
its bench also hires contract engineers. Today the model cannot express that. `users.role`
is a single enum value, and both `docs/DATA-MODEL.md` and `docs/ARCHITECTURE.md` state that
the prototype's portal switcher "is a demo affordance and has no production equivalent".

The obvious change — full cross-org membership, one user in many organisations — would
reverse the tenancy model far more broadly than dual role actually needs, and every
ownership check in the codebase assumes a single org.

### Decision

Two changes, and deliberately no more:

1. **A membership holds a SET of roles**, from `('supply', 'demand', 'admin')`, rather than
   a single role. One person at a dual-role company can hold both `supply` and `demand`.
2. **The portal switcher becomes a production feature** for organisations with more than
   one capability, rendered as "Hiring | Bench". For single-capability organisations it is
   not rendered at all.

**What does NOT change:** a user still belongs to **exactly one organisation**. The new
`memberships` table carries `UNIQUE (user_id)` to enforce it in the database. Every
ownership check, read model and leak test that assumes one org per user stays correct.

Capability lives on the organisation, in `org_capabilities (can_supply, can_hire)`, which
becomes the authoritative record. `organizations.org_type` is retained for ops filtering
and existing queries but becomes **derived** — a trigger maintains it and application code
must not write it. The Talentvibes organisation has neither capability, enforced by that
trigger: it is the broker, not a participant.

### Rationale

Capability is a property of a company; role is a property of a person. Conflating them in
`users.role` is what made dual role inexpressible. Separating them is the smallest change
that works.

Keeping one organisation per user matters more than it might appear. The masking guarantee
is enforced by portal-specific read models that take an org id; "which org is this
caller?" has to have exactly one answer, or the question "may this caller see this row?"
stops being decidable.

### Consequences

- A vendor-only organisation must see **no trace** of a hiring side — not a disabled tab,
  not an empty workspace. A locked "Hire" tab advertises a product the company has not
  been enabled for and invites the question of why.
- The two rate views must never appear on the same screen for the same organisation. A
  dual-role org that can see what it is paid as a supplier *and* what it is charged as a
  client, side by side on one screen, can infer the platform's margin.
- For the same reason, dual-role organisations default to `fee_model = 'flat_declared_fee'`
  rather than a hidden markup. If the fee is declared, there is no margin to infer.
- Receivables and payables for a dual-role org are both its own invoices and are both
  visible to it — but must never be netted in a response. No netting by default.
- A **self-dealing rule** becomes necessary: a resource whose supplying organisation is in
  the same group as the requirement's client must never be returned as a candidate. That
  is implemented in the matching function *and* as a database rule, so an application bug
  cannot bypass it.
- Groups are declared by ops from the MSA, never inferred from PAN or GSTIN. Two
  subsidiaries can share a PAN prefix without being related, and genuinely related
  companies can share neither identifier.
