# API.md

REST over JSON. Three namespaces mirroring the three portals. A request to a namespace that
does not match the caller's `org_type` returns **404**, not 403 — do not confirm that a
route exists to someone who should not know about it.

## Conventions

- Base path `/api`. Versioning by header (`X-API-Version: 2026-08-01`) rather than URL —
  there is one consumer and URL versioning would churn the whole surface.
- IDs in URLs are the **public business codes** where the design shows them
  (`/api/client/shortlists/REQ-2291`), and UUIDs elsewhere. Resolve codes to UUIDs at the
  boundary.
- Money in responses is `{ "paise": 13800000 }` — an integer plus its unit. Never a
  pre-formatted string; the UI owns lakh/crore formatting.
- Lists are cursor-paginated: `?cursor=&limit=` returning `{ data, next_cursor, total }`.
  `total` is capped at 10,000 with `total_is_estimate: true` beyond that.
- Errors: `{ error: { code, message, details? } }`. Messages are generic for authorisation
  failures. Never name an organisation in an error body.
- All mutations accept `Idempotency-Key`. Sending a shortlist twice must not create two.

---

## Client portal — `/api/client/*`

### Dashboard
```
GET  /api/client/overview
     → metrics (open reqs, awaiting review, in interview, active engagements),
       open requirements table, awaiting-review tiles, active engagement list
```
Engagement entries carry `masked_id`, role, since-date and **the client's own rate**.

### Requirements
```
GET    /api/client/requirements                ?stage=&cursor=
POST   /api/client/requirements                create (draft or posted)
GET    /api/client/requirements/:code
PATCH  /api/client/requirements/:code          only while stage in (draft, new)
POST   /api/client/requirements/:code/close    { reason }
POST   /api/client/requirements/preview        live match preview — see below
```

`POST /requirements/preview` powers the "42 bench profiles match" rail. It is
**aggregate-only** and returns no profiles:

```json
{
  "total_matching": 42,
  "breakdown": [
    { "key": "skill_match",    "count": 42, "pct": 84 },
    { "key": "within_budget",  "count": 31, "pct": 62 },
    { "key": "score_above_80", "count": 24, "pct": 48 },
    { "key": "start_by_date",  "count": 18, "pct": 36 }
  ],
  "market_signal": { "median_ask_paise": 14800000, "band_label": "5–8y React in Bangalore" },
  "advisory": { "kind": "raise_floor", "delta_profiles": 11, "suggested_floor_paise": 14000000 }
}
```
Rate-limit it (it fires on every keystroke — debounce client-side, cap server-side) and
suppress any count below **5** to `"fewer than 5"`, so a client cannot binary-search the
filters to isolate one profile and infer its exact rate.

### Shortlists
```
GET  /api/client/shortlists                          all shortlists awaiting review
GET  /api/client/shortlists/:reqCode                 the masked profiles
POST /api/client/shortlists/:reqCode/select          { item_ids: [] }  toggle selection
POST /api/client/shortlists/:reqCode/request-interviews  { item_ids: [], note? }
```
`GET /shortlists/:reqCode` reads **only** from `shortlist_items`. Response shape per item:

```json
{
  "item_id": "…", "masked_id": "TV-4821", "position": 2,
  "experience_months": 74, "base_city": "Bangalore",
  "skills": ["React", "TypeScript", "Node.js"],
  "assessment": { "overall": 88, "coding": 91, "dsa": 84, "system_design": 82,
                  "communication": 90, "attempt_no": 1, "tested_on": "2026-08-09",
                  "proctor": "Talentvibes" },
  "rate_band": { "min_paise": 16000000, "max_paise": 17000000 },
  "availability": { "kind": "immediate", "label": "Available now" },
  "decision": "pending"
}
```
No `resource_id`, no `vendor`, no `name`, no `created_at`, no freshness. If you are adding
a field here, re-read `docs/MASKING.md` first.

### Interviews
```
GET   /api/client/interviews                     grouped: scheduled, awaiting confirmation
POST  /api/client/interviews/:id/propose-slots   { slots: [{start,end}] }
POST  /api/client/interviews/:id/reschedule      routes through the broker
GET   /api/client/interviews/:id/feedback
PUT   /api/client/interviews/:id/feedback        { ratings, notes, outcome }
```

### Engagements
```
GET  /api/client/engagements        masked_id, role, start, client rate, status
```

### Broker
```
GET   /api/client/broker/threads                ?scope_type=&scope_id=
POST  /api/client/broker/threads                { scope_type, scope_id }  get-or-create
GET   /api/client/broker/threads/:id/messages   ?cursor=
POST  /api/client/broker/threads/:id/messages   { body }
POST  /api/client/broker/threads/:id/read
```
The `?` button on a masked card opens a thread with `scope_type=candidate`,
`scope_id=<shortlist_item_id>` — **not** a resource id. The client has no resource ids.

---

## Vendor portal — `/api/vendor/*`

Every endpoint is implicitly scoped to the caller's own organisation. A `vendor_org_id`
in a request body is ignored, never trusted.

### Dashboard
```
GET /api/vendor/overview
    → utilisation (deployed / in process / idle, idle cost, recoverable estimate),
      metrics, pipeline on own profiles, freshness summary, assessment throughput
```
The pipeline rows show `masked_id`, own short name, own rate, stage and last update.
**No client name, ever** — the design's own caption says Talentvibes hides the hiring
company until placement. Confirm with the business whether the client is revealed at
placement or never (open question in `docs/DECISIONS.md`); default to **never** until told
otherwise.

### Bench roster
```
GET    /api/vendor/resources          ?filter=all|listed|idle|expiring|unconfirmed &cursor=
POST   /api/vendor/resources          create
GET    /api/vendor/resources/:id
PATCH  /api/vendor/resources/:id
POST   /api/vendor/resources/:id/list        put on the exchange
POST   /api/vendor/resources/:id/withdraw    { reason }
POST   /api/vendor/resources/:id/confirm     availability confirmation
POST   /api/vendor/resources/confirm-bulk    { resource_ids: [] } or { filter: "expiring" }
GET    /api/vendor/resources/export          CSV of own roster
```

### Bulk upload
```
POST /api/vendor/imports                 multipart CSV/XLSX, max 500 rows
GET  /api/vendor/imports/:id             counts + status
GET  /api/vendor/imports/:id/rows        ?resolution=pending
POST /api/vendor/imports/:id/rows/:rowId/resolve  { action: 'list'|'reject'|'merge', … }
GET  /api/vendor/imports/template        the CSV template
```
Parse asynchronously; the endpoint returns immediately with `status: parsing`. Duplicate
detection runs on the parsed rows before anything is listed.

### Assessments
```
GET  /api/vendor/assessments                    ?status=
POST /api/vendor/assessments/invite             { resource_ids: [] }
POST /api/vendor/assessments/:id/resend
POST /api/vendor/assessments/:id/nudge
GET  /api/vendor/assessments/:id/report         name-free summary
```
There is **no write path to any score column** from this namespace. Not a permission check —
the route simply does not exist.

### Earnings
```
GET /api/vendor/earnings                ?month=2026-08
GET /api/vendor/earnings/statement      ?month=  PDF/CSV
POST /api/vendor/invoices               raise an invoice against payable lines
```
Reads only `invoices.direction = 'payable'` for the caller's org. The receivable side is
not joinable from this namespace — enforce it with a view, not a `WHERE` clause someone can
forget.

### Broker
Same shape as the client's, with `side = 'vendor'`. Threads are scoped to resources and
requirements-as-anonymous-briefs. A vendor thread's `scope_label` must never contain a
client name — use the role and band ("Senior React, 5–8y, Bangalore").

---

## Ops console — `/api/ops/*`

Ops sees everything. These endpoints still write audit rows for every read of unmasked PII
in bulk (talent pool exports, duplicate reviews).

### Pipeline
```
GET   /api/ops/pipeline          ?view=board|list &q= &owner= &sla_risk= &unsourced= &cursor=
POST  /api/ops/requirements/:code/stage   { to_stage, reason? }
POST  /api/ops/requirements/:code/stage/undo   { event_id }
PATCH /api/ops/requirements/:code         owner, SLA, internal notes
```
Board mode returns requirements grouped by stage with **per-column counts computed
server-side** and per-column pagination — the board must stay usable at hundreds of
requirements, so do not return every card and group in the browser.

### Matching workspace
```
GET   /api/ops/matching/:reqCode           requirement facts, weighting, ranked pool
POST  /api/ops/matching/:reqCode/source    (re)run the algorithm, refresh the pool
PATCH /api/ops/matching/:reqCode/rank      { ordered_resource_ids: [] }
PATCH /api/ops/matching/:reqCode/include   { resource_id, included }
POST  /api/ops/matching/:reqCode/reset     clear manual rank + include overrides
GET   /api/ops/matching/:reqCode/candidates/:resourceId   expanded unmasked profile
POST  /api/ops/matching/:reqCode/send      { item_ids, broker_note, rate_overrides? }
```
`send` is the pivotal transaction. In one database transaction:
1. verify no open blocking duplicate flag;
2. verify every included candidate is eligible (fresh, scored, not deployed);
3. create `shortlists` + snapshot `shortlist_items` with **bands derived from the client
   rate** (`docs/MASKING.md`);
4. move the requirement to `shortlisted`;
5. write the audit row;
6. notify the client.

If any step fails, nothing is sent. A half-sent shortlist is worse than none.

### Talent pool
```
GET  /api/ops/pool     ?skill=&exp_min=&exp_max=&score_min=&freshness=&city=&vendor=
                       &vendor_rate_max=&cursor=
POST /api/ops/pool/save-view       { name, filters }
POST /api/ops/pool/add-to-req      { requirement_code, resource_ids: [] }
GET  /api/ops/pool/export          CSV — audited, rate-limited
```

### Margin
```
GET /api/ops/margin           ?month=&client=&vendor=
GET /api/ops/margin/export    finance export
POST /api/ops/engagements/:id/margin-exception  { note }  approve below-floor
```

### Duplicates
```
GET  /api/ops/duplicates                  ?status=open
GET  /api/ops/duplicates/:code
POST /api/ops/duplicates/:code/resolve    { action: 'keep_a'|'keep_b'|'not_duplicate', note }
GET  /api/ops/duplicates/rules
PUT  /api/ops/duplicates/rules            weights and thresholds
```

### Brokering
```
GET  /api/ops/broker/threads                    both sides, with linkage
POST /api/ops/broker/threads/:id/messages       reply to one side
POST /api/ops/broker/threads/:id/relay          { message_id, redacted_body, to_thread_id }
GET  /api/ops/broker/relay/preview              { message_id } → auto-flagged spans
```
`relay/preview` returns the spans a human should check — organisation names, amounts,
contact details. It never auto-sends.

### Interviews and admin
```
GET  /api/ops/interviews                        today's queue
POST /api/ops/interviews                        create from a client request
POST /api/ops/interviews/:id/confirm            { slot, meeting_url }
POST /api/ops/interviews/:id/relay-feedback     { summary }
GET  /api/ops/orgs                              directory
POST /api/ops/orgs                              onboard a client or vendor
POST /api/ops/orgs/:id/users                    invite
GET  /api/ops/audit                             ?entity_type=&entity_id=
```

---

## Webhooks in

```
POST /api/webhooks/assessments    signed by the proctoring provider
     events: assessment.started, assessment.completed, assessment.abandoned,
             assessment.integrity_flag
```
Verify the signature, dedupe on `provider_ref`, and process idempotently. Never trust a
score that arrives without a valid signature.

## Realtime

Polling is sufficient at this volume. The ops pipeline polls every 30s; the broker drawer
polls every 10s while open. Revisit if the broker desk grows past a handful of people.
