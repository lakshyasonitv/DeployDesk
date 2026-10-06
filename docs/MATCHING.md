# MATCHING.md — ranking specification

Matching produces, for one requirement, a ranked pool of bench resources with a 0–100 score
and six explainable components. The ops matching workspace shows all six as bars, so every
component must be independently defensible to a broker who has to justify an ordering to a
client.

## Weights

The design fixes these. Store them in a `matching_weights` table with a version, so a
change does not silently rewrite the meaning of historical scores.

| Component | Weight | Field |
|---|--:|---|
| Skill match | 30% | `score_skill` |
| Proctored score | 22% | `score_test` |
| Experience fit | 16% | `score_exp_fit` |
| Rate vs budget | 14% | `score_rate` |
| Availability freshness | 10% | `score_freshness` |
| Vendor reliability | 8% | `score_vendor` |

```
algo_score = round(Σ component_score × weight)
```

Each component is 0–100 before weighting.

## Eligibility gates — applied before scoring

A resource that fails a gate is not scored and does not appear in the pool. Record the
reason in `matches.eligibility` when ops explicitly asks to see blocked candidates.

| Gate | Rule |
|---|---|
| Status | `status` must be `listed` or `in_process`. `deployed`, `draft`, `withdrawn` are out. |
| Freshness | `UNCONFIRMED` (≥ 14 days) is out of matching. |
| Duplicate | An open flag with confidence ≥ 85 blocks both resources. |
| Vendor status | The vendor org must be `active`. |
| Location | If the requirement is `onsite`, the resource must be in that city or accept relocation. Hybrid/remote do not gate on city. |

**Assessment is not a gate for matching**, only for shortlist inclusion. Ops needs to see a
strong unscored profile in order to chase the test — the design deliberately shows
`TV-7702` (test not started) at rank 2 in pool B.

## Components

### 1. Skill match — 30%

Requirement skills are weighted: primary skills count double.

```
score_skill = 100 × Σ(matched_weight) / Σ(required_weight)
```

Then adjust:
- **Adjacency credit**: a skill in the same `category` with no exact match scores 0.4 of
  its weight (React ↔ React Native, Selenium ↔ Playwright). Keep an explicit adjacency
  table — do not infer it from embeddings at this scale, because a broker has to be able to
  explain why a candidate ranked where they did.
- **Extra skills give no credit.** A candidate with fifteen unrelated skills is not a better
  match, and rewarding breadth pushes generalists over specialists.
- Skills that failed to resolve to the taxonomy count as unmatched.

### 2. Proctored score — 22%

```
scored, not expired   →  score_test = overall_score
in_progress           →  score_test = 40
not_started           →  score_test = 40
expired               →  score_test = 30
```

The constants are deliberately non-zero: an unscored profile should rank below a good
scored one but above a genuinely weak one, so brokers still see it and chase the test.
`expired` sits below `not_started` because a lapsed score signals inattention.

### 3. Experience fit — 16%

Band midpoints in months: `0-3` → 18, `3-5` → 48, `5-8` → 78, `8+` → 120.

```
delta_years = |resource_years − band_midpoint_years|
score_exp_fit = clamp(100 − delta_years × 12, 0, 100)
```

Inside the band, score 100. Overshooting is penalised more gently than undershooting —
a 9-year engineer for a 5–8y role is expensive but capable; a 3-year engineer is not:

```
if resource is below the band:  penalty × 1.5
```

### 4. Rate vs budget — 14%

Uses the **proposed client rate** against the client's budget, not the vendor rate.

```
mid   = (budget_min + budget_max) / 2

rate ≤ budget_min          →  100
budget_min < rate ≤ mid    →  100 − 10 × (rate − budget_min)/(mid − budget_min)
mid < rate ≤ budget_max    →   90 − 30 × (rate − mid)/(budget_max − mid)
rate > budget_max          →  max(0, 60 − 100 × (rate − budget_max)/budget_max)
```

Well under budget scores full marks but does **not** score above 100 — a suspiciously cheap
profile is usually a mismatch, not a bargain. Above the ceiling the score falls off fast;
the design shows `TV-5107` at 40 on the rate bar for being above the band.

### 5. Availability freshness — 10%

```
days = age of last_confirmed_at

days ≤ 3      → 100
4 ≤ days ≤ 9  → 100 − (days − 3) × 4      (96 … 76)
10 ≤ days ≤13 → 60 − (days − 10) × 8      (60 … 36)
days ≥ 14     → ineligible (gate)
```

Then apply notice period: `immediate` ×1.0, `≤ 15 days` ×0.95, `≤ 30 days` ×0.85,
`> 30 days or unknown` ×0.7. A profile that is fresh but three months from availability is
not actually available.

### 6. Vendor reliability — 8%

```
score_vendor = (reliability_score / 5) × 100
```
Provisional vendors (first 10 submissions) are capped at 75 so an unproven supplier cannot
outrank a proven one on this component alone.

## Proposed client rate

Ops needs a starting client rate to compute margin and the rate component. Default:

```
proposed_client_rate = vendor_rate / (1 − target_margin)     target_margin = 0.22
then round up to the nearest ₹1,000
then clamp into [budget_min, budget_max] if that keeps margin ≥ floor (0.18)
```

If clamping to the client's ceiling would push margin below the floor, **do not clamp** —
surface it to ops as "above budget, margin-constrained" and let a human decide. Silently
accepting a sub-floor margin to fit a budget is how the two below-floor placements in the
design fixtures happened.

## Ranking, override and reset

- `algo_rank` is the score order, ties broken by: higher test score → better freshness →
  higher vendor reliability → earlier `listed_at`. Never by `id` or insertion order —
  that clusters by vendor and is a side channel.
- `manual_rank` overrides it. When any manual rank exists for a requirement, the workspace
  shows "manual override active, algorithm ranking saved" — so **keep `algo_rank`**, do not
  overwrite it.
- `reset` clears `manual_rank` and `included` for that requirement only.
- The client sees the final order, and only the final order.

## Default inclusion set

Matching the prototype's behaviour, on first open:

```
included = top N by rank, where N = clamp(quantity + 1, 2, 4)
```

Ops adjusts from there. Do not auto-include a candidate that would be blocked from sending
(expired score, unstarted test, open duplicate flag) — flag it instead.

## Reason lines

Each match carries a one-line explanation shown in the workspace ("Top skill overlap;
available immediately", "Backend-first; above budget ceiling"). Generate these from the
component profile with a small rules table — highest and lowest component, plus any gate
near-miss — rather than free-form text. A broker relaying "why this order" to a client needs
these to be consistent.

## Recomputation triggers

- Requirement created, or its skills/budget/band/dates edited
- A resource is listed, delisted, re-rated, re-skilled or confirmed
- An assessment completes or expires
- Vendor reliability recomputed (nightly)
- Ops presses "Reset to algorithm" or "Source"

Recomputation **never** touches `manual_rank` or `included`. A broker's curation must
survive a nightly job.

## Evaluating changes

Before changing weights or formulas, run the new version over the last 90 days of
requirements and compare: did the eventually-placed candidate rank in the top 3 more often?
That is the only metric that matters. Record the comparison in `docs/DECISIONS.md`.
