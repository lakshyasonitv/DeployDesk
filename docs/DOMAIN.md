# DOMAIN.md — glossary, lifecycles and business rules

## Glossary

| Term | Meaning |
|---|---|
| **Bench** | Engineers a vendor employs but has not deployed on a project. Idle payroll cost. |
| **Bench resource** | One such engineer, as a record. Never called "candidate" in vendor-facing copy. |
| **Client** | A company hiring through the exchange. |
| **Vendor / supplier** | A company offering its bench. Used interchangeably in the UI; prefer `vendor` in code. |
| **Broker** | A Talentvibes ops user who owns the relationship on both sides of a requirement. |
| **Masked ID** | `TV-4821`. The only candidate identifier a client ever sees. |
| **Requirement** | `REQ-2291`. A client's open demand. Has a quantity — one requirement can produce several placements. |
| **Match** | An ops-side scored pairing of a resource to a requirement. Not visible to anyone else. |
| **Shortlist** | A frozen set of masked profiles sent from ops to a client. |
| **Freshness** | How recently a vendor confirmed that a resource is still available. |
| **Vendor rate** | What Talentvibes pays the vendor, per month. |
| **Client rate** | What the client pays Talentvibes, per month. |
| **Spread** | `client_rate − vendor_rate`, in rupees. |
| **Margin** | `spread ÷ client_rate`, as a percentage. Ops-only. |
| **Engagement / placement** | A live deployment of a resource with a client. |
| **Duplicate flag** | Two vendors submitting the same human being. |
| **Reliability score** | 0–5 per vendor, reflecting how dependably its submissions convert. |
| **Lakh / crore** | ₹1L = 100,000; ₹1Cr = 10,000,000. Display convention only. |

## Requirement lifecycle

```
draft ──▶ new ──▶ matching ──▶ shortlisted ──▶ interviewing ──▶ placed ──▶ closed
                     ▲             │                │              │
                     └─────────────┴────────────────┘              ▼
                        (ops may move backwards)               cancelled
```

Ops can move a requirement to any stage — the pipeline board allows drag to any column and
arrow moves in both directions. Do not model this as a rigid forward-only machine.
Instead, permit any transition and enforce **guards**:

| Transition | Guard |
|---|---|
| `→ matching` | At least one eligible candidate exists, or ops explicitly overrides |
| `→ shortlisted` | A shortlist has been sent with ≥ 1 item |
| `→ shortlisted` | **Blocked** if any open duplicate flag lists this requirement in `blocks_requirements` |
| `→ interviewing` | At least one interview exists in `proposed` or later |
| `→ placed` | An `engagements` row exists for this requirement |
| `→ placed` below margin floor | Requires `margin_approved_by` and a note |
| `→ closed` | Filled quantity met, or ops closes with a reason |

Every transition writes a `requirement_stage_events` row. **Undo** in the UI is a new
transition back, not a deletion — the audit trail keeps both moves.

A requirement with `quantity > 1` stays in `interviewing` until the last position is filled;
each fill creates its own engagement.

## Bench resource lifecycle

```
draft ──▶ listed ──▶ in_process ──▶ deployed ──▶ listed (rolls off)
   │         │                          │
   └─────────┴──────▶ withdrawn ────────┘  ──▶ archived
```

- `draft` — created but not on the exchange. Not matchable.
- `listed` — on the exchange, matchable subject to eligibility gates.
- `in_process` — appears on at least one active shortlist or in an interview. Still
  matchable for other requirements, but ops sees the contention. The vendor sees the
  stage; the client sees nothing about other processes.
- `deployed` — placed. Not matchable. When the engagement's `end_date` passes, a job
  returns the resource to `listed` with freshness reset to unconfirmed, prompting the
  vendor to re-confirm.
- `withdrawn` — vendor pulled it. Increments `vendor_profiles.withdrawal_count`, which
  feeds reliability.

## Freshness

Derived from `last_confirmed_at`. **Never stored as a state column.**

```
days = floor(now_ist − last_confirmed_at, in days)

days <  10  →  CONFIRMED
days 10–13  →  EXPIRING_SOON
days >= 14  →  UNCONFIRMED

decay_bar_width_pct = max(6, (1 − min(days, 28) / 28) × 100)
```

Rules:

- A resource at `UNCONFIRMED` **drops out of matching**. It stays visible on the vendor's
  roster and stays in the ops talent pool, flagged.
- Confirming sets `last_confirmed_at = now()` and appends an `availability_confirmations`
  row. It does not touch anything else.
- The nightly sweep at **02:00 IST** does not mutate state — it sends the "7 profiles
  expiring" email and refreshes match eligibility. Freshness itself is always computed at
  read time so the roster is never stale between sweeps.
- A resource already on a live shortlist that goes stale does **not** disappear from that
  shortlist. The snapshot holds. Ops is notified so the broker can verify with the vendor.

## Assessment rules

- Proctored by Talentvibes. Vendors and clients can read scores; **neither can write them**.
- A score is valid for **90 days** from completion. After that the assessment is `expired`
  and the resource cannot be included in a shortlist until it is retaken.
- Retake policy: a candidate scoring below 80 may retake after **60 days**. The design
  shows attempt numbers on the client card, so attempts are visible — do not hide a second
  attempt.
- Matching uses the latest `scored`, non-expired assessment. `not_started` scores zero on
  the test component but does not block matching; it **does** block inclusion in a
  shortlist unless ops explicitly overrides with a note.
- The four sections are fixed: **coding, DSA, system design, communication**, each 0–100.
  The overall score is the provider's, not a recomputation — do not average the sections.

## Vendor reliability score

0.0–5.0, one decimal, recomputed nightly. It is 8% of the match score and drives the ops
recommendation on duplicate resolution, so it must be explainable.

Suggested starting formula — record the version used on each computation so historical
scores stay interpretable:

```
base                 3.0
+ placement_rate     up to +1.0   placements ÷ shortlisted submissions, last 180 days
+ freshness_hygiene  up to +0.5   share of listed profiles confirmed within 10 days
+ tenure             up to +0.5   share of placements completing their contracted term
− withdrawals        up to −1.0   submissions withdrawn after client selection
− duplicate_losses   up to −0.5   duplicate flags resolved against this vendor
clamp to [1.0, 5.0]
```

New vendors start at **3.5** with a `provisional` marker for their first 10 submissions, so
a single early outcome does not dominate. Never let the score reach 0 — a 0 reads as a data
error rather than a judgement.

## SLA

| Stage | Clock starts | Target |
|---|---|---|
| `new` → sourcing begun | Requirement posted | 4 business hours |
| `matching` → shortlist sent | Sourcing begun | **36 hours** (the promise in the client UI) |
| `shortlisted` → client responds | Shortlist sent | 3 business days, then `idle` |
| `interviewing` → feedback received | Interview completed | 2 business days |

State derived from `sla_due_at`:

```
remaining > 25% of window  →  ok      green
remaining ≤ 25%            →  warn    amber
remaining < 0              →  late    red
waiting on the client      →  idle    grey   (clock paused, no breach)
```

`idle` is important: an unresponsive client must not make an ops broker look late. Pausing
happens on entry to `shortlisted` and on `awaiting_vendor` interview states.

Business hours are **09:00–19:00 IST, Monday–Saturday**, excluding a configured Indian
holiday calendar. Put the calendar in a table, not in code.

## Interview flow

1. Client selects masked profiles and requests interviews.
2. Ops confirms supplier release with the vendor. The interview sits in `awaiting_vendor`
   with the client's proposed slots. The client sees "broker is confirming supplier
   release" — never "waiting on Nimbus Softworks".
3. Ops confirms a slot, issues a **Talentvibes-owned meeting link**, and briefs the
   candidate on the masking rules.
4. Client panel interviews. The candidate knows the client's name at this point in the real
   world; the *vendor* still does not. Brief candidates accordingly — this is a policy
   matter to confirm with the business, logged as an open question in `docs/DECISIONS.md`.
5. Client submits feedback. Ops relays a redacted summary to the vendor.
6. Outcome `advance` → next round. `pass` → item marked passed. Client-side decisions are
   never relayed verbatim; a "pass" reaches the vendor as a neutral outcome with the
   commercial and identity context removed.

## When a price becomes negotiable

**Stated by the owner, 2026-10-08.**

> Price negotiation starts only once the talent has cleared **all** the rounds — both
> Talentvibes's own rounds and the client's rounds.

Nothing before that point is a price. It is a **starting figure**, and the only number in the
exchange that is actually settled beforehand is the **vendor rate** — what the supplier wants
for their engineer. The client rate is negotiated, and it is negotiated last.

In the model, "cleared all the rounds" means both of:

| Whose rounds | Cleared when |
|---|---|
| **Talentvibes's** | the resource holds a `passed` assessment that is still inside its `valid_until` |
| **The client's** | every `interviews` round for that resource has concluded and the client has selected them (`shortlist_items.client_decision = 'selected'`) |

*The mapping above is an interpretation of the rule and has not been confirmed line by line;
the sentence quoted from the owner is the authority.*

### What follows from it

- The **proposed client rate** on the matching desk is indicative. It exists so a shortlist
  can carry a band and so the ranking has something to score, not because it is agreed.
- **Any report that treats it as settled is wrong**, which is why the ops Margin screen was
  removed on 2026-10-08 — it presented a margin per placement as a fact across the whole
  exchange. See `project-brain/02-decisions.md`.
- A margin shown **while somebody is choosing a rate** is a different thing and stays: it is
  arithmetic on a number being typed, not a claim about a concluded deal.

## Margin rules

**There is no margin screen.** It was removed on 2026-10-08 — see § *When a price becomes
negotiable* above. What remains is margin computed **at the point somebody chooses a rate**,
never a report of margin across placements.

- Target margin: **≥ 22%**. This is the figure the **proposed client rate** is computed from,
  so it cannot simply be deleted: it is the default a negotiation starts at.
- Floor: **18%**. Below the floor an engagement requires an explicit approval
  (`margin_approved_by`) plus a note. The guardrail panel that used to list the exceptions
  went with the screen; the approval and the note are still columns on `engagements`, still
  seeded, and still checked by `db:verify`. **Whether the floor survives is an open question**
  put to the owner on 2026-10-08 and not yet answered — if a client rate is negotiated, a hard
  threshold requiring written justification may be the wrong shape. Unchanged until they say.
- Margin is computed at the **proposed client rate** during matching, and at the
  **contracted rates** once an engagement exists. Show ops both; never conflate them.
- Colour thresholds (presentation, but keep the boundaries in one shared constant so the
  API and UI agree): ≥ 22% green, 18–22% amber, < 18% red.

## Duplicate detection

Run on resource create, on bulk import, and nightly across the full corpus.

Confidence scoring — tune the weights, keep the signals:

| Signal | Weight |
|---|---|
| PAN hash exact match | 60 |
| Phone hash exact match | 25 |
| Email hash exact match | 15 |
| Employer history overlap (≥ 2 employers with overlapping dates) | 20 |
| GitHub handle identical | 10 |
| Name similarity (trigram ≥ 0.7, handles "Arjun Rathore" vs "A. Rathore") | 10 |
| Experience within 1 year | 5 |

Thresholds: ≥ 85 auto-flag and **block** any shortlist containing either resource;
60–84 flag for human review without blocking; below 60 no flag.

Resolution: ops keeps one submission and rejects the other. The recommendation favours the
**earlier submission** with the better freshness and higher vendor reliability. The losing
vendor is told only that the profile is already represented on the exchange. **Neither the
client nor the candidate is informed.**

Note the real-world case the design hints at (`TV-3964` vs `TV-6104`): the same person may
genuinely have moved between vendors. A differing PAN with a matching phone is "needs a
human call", not an automatic rejection.

## Values that must always be derived, never stored

Repeating this because it is the most common source of drift:

- freshness state and decay bar width
- SLA state
- requirement age, value per month, sourced count
- margin and spread
- pipeline column counts, nav badges, result counts
- match score bar colours and margin colour thresholds
- "42 profiles match" style live previews
