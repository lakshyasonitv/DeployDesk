# SEED-DATA.md

The design prototype ships a complete, internally consistent fixture set. Reuse it — it
makes the backend demoable against the real UI on day one, and it gives the golden tests
something to be golden about.

**Source of truth:** `design_handoff_bench_exchange/README.md` and the `class Component`
block at the bottom of `Talentvibes Bench Exchange.dc.html` (constants `REQS`, `POOLS`,
`cands()`, roster and earnings tables).

**Reference date:** all relative values ("2h ago", "confirmed 2d", "4d") are relative to
**22–24 August 2026**. Seed with offsets from a configurable `SEED_NOW`, not absolute
timestamps, so freshness and SLA states stay correct whenever the seed is run.

---

## Organisations

**Talentvibes** (`org_type = 'talentvibes'`)

Ops users, from the design:

| Name | Role | Notes |
|---|---|---|
| Priya Nair | `broker` | "brokering desk 2", owns most requirements, is the client-facing broker |
| R. Verma | `broker` | assigned DUP-0147 |
| S. Iyer | `broker` | |
| (one) | `ops_admin` | needed for margin exception approvals |
| (one) | `finance` | needed for billing |

**Clients** (5)

| Name | Notes |
|---|---|
| Acme Finserv | Demo tenant for the client portal. Contact: Ananya (hiring manager). Panel members R. Sundaram (Eng Manager), D. Kulkarni (Staff FE), S. Ahuja (QA Lead). |
| Kestrel Logistics | |
| Northwind Retail | |
| Meridian Pharma | GxP/validated-systems requirements |
| Vantage Insurance | |

**Vendors** (7 named; the UI claims 14 supplier benches — generate 7 more thinly populated
so counts read correctly)

| Name | Code | Reliability | Notes |
|---|---|---:|---|
| Nimbus Softworks | NSW-0142 | 4.6 | Demo tenant for the vendor portal. 42 resources, 27 listed, 18 placed YTD |
| Sparkbridge Systems | — | 4.2 | |
| Cygnet Infotech Labs | — | 4.1 | |
| Helix Systems | — | 3.9 | |
| Vertex Digital | — | 3.6 | Holds TV-4488, the below-floor placement |
| Trueline Consulting | — | 3.4 | |
| Orbit Talent Services | — | 3.1 | The problem vendor: withdrawals, duplicate losses, stale profiles |

Orbit Talent Services is deliberately the weak supplier across the fixture set. Keep it —
its low reliability, unconfirmed profiles and duplicate involvement are what make the
vendor-reliability component and the duplicates screen testable.

---

## Nimbus Softworks bench (the vendor portal demo)

Seed all 42; the roster screen shows 9 with "Load more". The nine named ones, with the
states the design depends on:

| Name | Masked ID | City | Exp | Vendor rate | Assessment | Freshness |
|---|---|---|---:|---:|---|---|
| Arjun Rathore | TV-4821 | Bangalore | 6.2y | ₹1,38,000 | Scored 88 | confirmed 2d |
| Meghna Iyer | TV-6620 | Jaipur | 5.4y | ₹1,12,000 | Scored 91 | confirmed 1d |
| Rohit Deshmukh | TV-5107 | Pune | 8.0y | ₹1,84,000 | Scored 82 | expiring 12d |
| Ishita Bansal | TV-7702 | Pune | 6.3y | ₹1,45,000 | Not started | expiring 13d |
| Sanjay Pillai | TV-7715 | Bangalore | 7.1y | ₹1,46,000 | In progress | confirmed 3d |
| Neha Chaudhary | TV-6104 | Hyderabad | 4.8y | ₹98,000 | Scored 74 | unconfirmed 21d |
| Farhan Qureshi | TV-5990 | Bangalore | 9.4y | ₹2,15,000 | Scored 79 | unconfirmed 26d |
| Divya Ranganathan | TV-6833 | Pune | 3.9y | ₹92,000 | Scored 85 | expiring 11d |
| Karthik Nair | TV-7188 | Jaipur | 5.1y | ₹1,05,000 | Not started | confirmed 4d |

> **Note two inconsistencies in the source fixtures** and resolve them at seed time:
> Meghna Iyer and Karthik Nair are attributed to Nimbus in the roster table but to
> Sparkbridge in the ops matching pools. Take the **ops pools as authoritative** for vendor
> attribution (ops sees unmasked truth), and adjust the Nimbus roster accordingly. Likewise
> Farhan Qureshi appears as both TV-5990 and TV-4455; use TV-5990 for the bench resource and
> treat TV-4455 as a distinct placement record or reconcile to one ID. Record whichever way
> you go in a comment on the seed file.

The remaining 33 are generated: 27 listed total, 6 in process, 9 idle, giving the 64%
utilisation the dashboard shows. Distribute freshness so 32 are confirmed, 7 expiring,
3 unconfirmed.

Bulk import history: `bench_aug26.csv`, 38 rows imported, 34 listed automatically,
4 needing review — two missing a rate, two suspected duplicates.

---

## Requirements

All 24 rows are listed in `design_handoff_bench_exchange/README.md` §11 with:
`id, role, client, qty, skills, value/mo, age, owner, stage, SLA, slaKind, budget, start,
band, location, pool, client note, sourced count`.

Transcribe them exactly. The distribution matters for the pipeline board — 4 new, 5
matching, 4 shortlisted, 5 interviewing, 4 placed (plus two more spread across stages),
across 5 clients and 3 owners, with **one SLA breach** (REQ-2295, "Overdue 2h").

Seed `sla_due_at` by working backwards from the intended state and `SEED_NOW`, rather than
storing the label. `REQ-2249` and `REQ-2266` are `idle` — awaiting client — so their clocks
must be paused, not merely long.

Client notes are per-requirement and are **client + ops only**. They are useful leak-test
bait: seed them with distinctive strings and assert none appears in any vendor response.

---

## Candidate pools

Four pools, A (React), B (Java/Node), C (QA), D (Enterprise), full data in the prototype's
`POOLS` constant. Each candidate carries: masked id, name, vendor, experience, vendor rate,
match score, reason line, six component values, city, notice, proctored score + date,
freshness, vendor reliability, proposed client rate, margin, last-project note.

Pool A in algorithm order (94, 89, 86, 81, 77, 68) is the golden case for
`docs/MATCHING.md`. If your scorer does not reproduce this order from the underlying
attributes, either the scorer or the fixture needs adjusting — investigate before changing
either.

The pools contain deliberate edge cases. Keep every one:

| Case | Fixture | Tests |
|---|---|---|
| Test not started | TV-7702 | Matchable but not shortlist-includable |
| Score expired | TV-6488 | Expiry gate, retest prompt |
| Unconfirmed 18d / 22d | TV-5981, TV-6488 | Drops out of matching |
| Low-reliability vendor | TV-5981, TV-3964 (Orbit) | Vendor component, duplicate recommendation |
| Above budget ceiling | TV-5107 | Rate component falling to 40 |
| Below the margin floor | TV-3964 at 17.4% | Guardrail, exception approval |
| Duplicate pair | TV-3964 ↔ TV-6104 | 60–84 confidence, flags without blocking |
| Currently placed, rolling off | TV-4102 (ends 30 Sep) | Deployed → listed transition |

**Do not seed `algo_score` directly.** Seed the underlying attributes and let the scorer
compute it. A seeded score would make the golden test tautological.

---

## Shortlist REQ-2291 (the hero screen)

Six masked profiles in the order the design shows: TV-6620, TV-4821, TV-5302, TV-5107,
TV-4488, TV-3964. Attempt numbers: TV-5302 and TV-3964 on attempt 2, the rest attempt 1.
Tested dates 12 Jul / 09 Aug / 15 Aug / 04 Aug / 30 Jul / 18 Aug respectively.

Client selection state starts with TV-6620 and TV-4821 selected, so the primary button reads
"Request interviews · 2".

Broker note on the footer strip, from Priya Nair, about TV-6620/TV-4821 clearing budget and
TV-4488 being above band.

> ⚠️ **Do not copy the rate bands from the prototype.** They bracket the vendor rate.
> Derive them from the proposed client rate per ADR-004 — for TV-4821 that means a band
> around ₹1.82L, not ₹1.35–1.55L. The seeded bands should differ from the mockup, and the
> leak test asserts they do.

---

## Interviews

- TV-4821, Round 1, 25 Aug 11:00, 45 min, video, panel R. Sundaram + D. Kulkarni
- TV-6620, Round 2, 26 Aug 15:30, 60 min, onsite Whitefield, panel S. Ahuja + platform pairing
- TV-7715, Round 1, 28 Aug 10:00, 45 min, video, panel D. Kulkarni
- TV-5302, `awaiting_vendor`, client proposed Thu 27 Aug at 11:00 and 16:00, requested 4h ago

Feedback due today on TV-6620 round 2 (21 Aug 15:00): technical depth 4, problem solving 5,
communication 4, role fit 4, with the Playwright/CI notes and outcome pending.

---

## Engagements, margin and billing

Six live placements are itemised in the margin table (README §14) with vendor rate, client
rate, spread and margin. Seed engagements from those, plus the five on the client dashboard
and the five on the vendor earnings screen — reconcile the overlap; they describe the same
placements from three angles.

Deliberate cases:

- **TV-4488** (Vertex Digital → Acme Finserv, SAP ABAP): 14.2% margin, **below the 18%
  floor**, approved as a strategic entry, review at renewal 1 Oct. Seed with
  `margin_approved_by` set and an exception note.
- **TV-3964** (Orbit → Northwind Retail, .NET Core): 17.4%, also below floor.
- **TV-4102** (QA Automation): ends 30 Sep — the "ending" status and pro-rata case.
- **TV-4455** (SAP ABAP): started 1 Aug, `onboarding`, billed pro-rata (₹1,62,000 of
  ₹2,15,000) — the mid-month-start billing case.

The exchange-wide totals the ops screen shows (31 live placements, ₹3.4Cr run-rate) need
~25 generated engagements beyond the named ones.

---

## Duplicate flags

**DUP-0148** — 96% confidence, blocks the REQ-2291 shortlist, flagged 22 Aug 09:12.

- A (earlier, 12 Aug 09:41): Arjun Rathore, TV-4821, Nimbus Softworks, PAN hash …7f21c9,
  phone hash …4b8e, 6.2 years, Zeta Commerce 2021–24, score 88 · 09 Aug, rate ₹1,38,000,
  confirmed 2d, reliability 4.6/5 · 34 placements
- B (later, 18 Aug 16:07): A. Rathore, TV-7188-B, Orbit Talent Services, same hashes and
  employer, 6.5 years, test not started, rate ₹1,52,000, unconfirmed 6d, reliability
  3.1/5 · 9 placements
- Signals: PAN exact, phone exact, 3-of-3 employer overlap, same GitHub handle,
  6.2y vs 6.5y, ₹14,000 rate difference

**DUP-0147** — 71%, open, assigned to R. Verma: Kavya Menon (Trueline) vs K. M. Nair
(Vertex) — matching phone hash and overlapping Salesforce project history, **different
PAN**. Needs a human call. This is the fixture that proves the 60–84 band flags without
blocking.

---

## Broker threads

The client-side thread for REQ-2291 is seeded with three messages (broker → client →
broker) about the shortlist and TV-4488's rate, on 22 Aug at 09:40, 10:02 and 10:15.

Seed the **linked vendor-side thread too** — the prototype only shows one side, but the
two-thread model (ADR-008) is untestable with one. Add a vendor thread scoped to TV-4488
with a relayed message whose `relayed_from_id` points at the client message, and whose
redacted body has "Acme Finserv" and the client's budget removed. That single pair is what
the relay tests run against.

---

## Generating the `scale` profile

For performance work: 20,000 bench resources across 200 vendors, 500 requirements across
50 clients, 5,000 matches, 2,000 engagements. Use a **fixed seed**. Realistic distributions
matter more than volume — skills follow a long tail, freshness clusters near recent, and
80% of requirements belong to 20% of clients. A uniform distribution will make every index
look fine and hide the query that falls over in production.
