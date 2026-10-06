# DATA-MODEL.md

Postgres. `snake_case`, plural tables, `uuid` primary keys via `gen_random_uuid()`.
Every table has `created_at timestamptz not null default now()` and
`updated_at timestamptz not null default now()` unless stated otherwise; these are omitted
below for brevity.

**Money**: `bigint`, minor units (paise). ₹1,38,000 → `13800000`.
**Rates are monthly** unless the column name says otherwise.

---

## 1. Tenancy and identity

### organizations
The single tenant root. Clients, vendors and Talentvibes itself are all organisations.

```
id                 uuid pk
org_type           enum('client','vendor','talentvibes') not null
name               text not null
public_code        text unique            -- 'NSW-0142' for vendors
status             enum('active','suspended','onboarding') not null default 'onboarding'
billing_address    jsonb
gstin              text
```

### vendor_profiles
One-to-one extension for `org_type = 'vendor'`.

```
org_id                 uuid pk → organizations(id)
reliability_score      numeric(2,1)        -- 0.0–5.0, computed, see DOMAIN.md
placements_count       int not null default 0
withdrawal_count       int not null default 0
onboarded_at           timestamptz
notes_internal         text                -- ops only
```

### client_profiles
```
org_id                 uuid pk → organizations(id)
account_owner_id       uuid → users(id)    -- the ops user who owns this account
default_notice_accepted text[]
```

### users
```
id             uuid pk                     -- matches Supabase auth.users.id
org_id         uuid not null → organizations(id)
email          citext not null unique
full_name      text not null
role           enum(...) not null          -- see below
status         enum('active','invited','disabled') not null
last_login_at  timestamptz
```

Roles by `org_type`:

| org_type | roles |
|---|---|
| client | `client_admin`, `hiring_manager`, `panel_member` |
| vendor | `vendor_admin`, `bench_manager` |
| talentvibes | `ops_admin`, `broker`, `finance` |

A user belongs to exactly one organisation. There is no cross-org membership and no
production portal switcher.

---

## 2. Skills taxonomy

### skills
```
id             uuid pk
slug           text unique not null        -- 'react', 'sap-abap'
label          text not null               -- 'React', 'SAP ABAP'
category       text                        -- 'frontend', 'enterprise', 'qa'
aliases        text[]                      -- 'ReactJS', 'React.js'
is_active      bool not null default true
```

A canonical taxonomy is load-bearing: skill match is 30% of the ranking score, and free-text
skills would make it meaningless. Vendor-supplied strings resolve through `aliases`;
unmatched strings go to a `skill_review_queue` for ops to canonicalise, and count as zero
match until resolved.

### resource_skills / requirement_skills
```
resource_id / requirement_id  uuid not null
skill_id                      uuid not null → skills(id)
is_primary                    bool not null default false
years                         numeric(3,1)     -- resource_skills only, nullable
pk (resource_id, skill_id)
```

---

## 3. Bench supply

### bench_resources
The real person. **The most sensitive table in the system.**

```
id                     uuid pk
vendor_org_id          uuid not null → organizations(id)
masked_id              text unique not null      -- 'TV-4821', random, immutable, never reused
full_name              text not null             -- ops + owning vendor only
employee_code          text                      -- vendor's internal id, e.g. 'NSW-3391'
base_city              text not null
experience_months      int not null
available_from         date                      -- null = immediate
notice_period_days     int
work_modes             text[] not null           -- {'onsite','hybrid','remote'}
vendor_rate_paise      bigint not null           -- monthly cost to Talentvibes
status                 enum('draft','listed','in_process','deployed','withdrawn','archived')
last_confirmed_at      timestamptz               -- drives freshness; NEVER store the state
listed_at              timestamptz
cv_object_key          text                      -- ops-only storage reference
contact_email          citext                    -- ops + owning vendor only
contact_phone          text                      -- ops + owning vendor only
pan_hash               text                      -- HMAC-SHA256, ops only
phone_hash             text                      -- HMAC-SHA256, ops only
email_hash             text                      -- HMAC-SHA256, ops only
github_handle          text
last_project_note      text                      -- ops-facing summary
source_import_id       uuid → bulk_imports(id)
```

Notes:

- Identity hashes use a **server-side pepper from the environment**, never a bare hash of
  the PAN. A bare SHA-256 of a 10-character PAN is brute-forceable in seconds.
- `status` is supply state; freshness is a separate derived concept. A `listed` resource
  can still be ineligible for matching because it is stale.
- `experience_months` is an integer, not "6.2y". The UI formats it.

### employment_history
Duplicate detection needs structured employer overlap, not a text blob.
```
id             uuid pk
resource_id    uuid not null → bench_resources(id) on delete cascade
employer_name  text not null
employer_slug  text not null              -- normalised for comparison
start_date     date
end_date       date
title          text
```

### availability_confirmations
Append-only audit of "still available" clicks. `bench_resources.last_confirmed_at` is a
denormalised copy of the latest row for query speed.
```
id             uuid pk
resource_id    uuid not null → bench_resources(id)
confirmed_by   uuid not null → users(id)
confirmed_at   timestamptz not null default now()
method         enum('single','bulk','api','email_link')
```

### bulk_imports / bulk_import_rows
```
bulk_imports
  id                 uuid pk
  vendor_org_id      uuid not null → organizations(id)
  uploaded_by        uuid not null → users(id)
  filename           text not null
  object_key         text not null
  rows_total         int not null default 0
  rows_listed        int not null default 0
  rows_needs_review  int not null default 0
  status             enum('parsing','review_pending','completed','failed')

bulk_import_rows
  id             uuid pk
  import_id      uuid not null → bulk_imports(id) on delete cascade
  row_number     int not null
  raw            jsonb not null
  errors         text[]                    -- {'missing_rate','unknown_skill'}
  duplicate_of   uuid → bench_resources(id)
  resolution     enum('pending','listed','rejected','merged')
  resource_id    uuid → bench_resources(id)
```

Expected columns per the design: `name, emp_id, skills, exp_years, city, rate_inr,
available_from`. Max 500 rows per upload.

---

## 4. Assessments

### assessments
```
id                   uuid pk
resource_id          uuid not null → bench_resources(id)
provider             text not null default 'invigil'
provider_ref         text                      -- external attempt id
attempt_no           int not null default 1
status               enum('not_started','invited','in_progress','scored','expired','abandoned')
track                text                      -- 'Frontend / React', 'QA Automation'
invited_at           timestamptz
started_at           timestamptz
completed_at         timestamptz
valid_until          timestamptz               -- completed_at + 90 days
overall_score        int                       -- 0–100
score_coding         int
score_dsa            int
score_system_design  int
score_communication  int
report_object_key    text                      -- ops-only raw report
summary_json         jsonb                     -- name-free, safe to surface
proctoring_flags     jsonb                     -- ops-only integrity signals
```

Only the **latest non-expired scored** assessment counts for matching. Retake policy is in
`docs/DOMAIN.md`. Vendors cannot edit scores — there is no write path from
`/api/vendor/*` to any score column.

---

## 5. Demand

### requirements
```
id                    uuid pk
code                  text unique not null      -- 'REQ-2291'
client_org_id         uuid not null → organizations(id)
created_by            uuid not null → users(id)
owner_user_id         uuid → users(id)          -- the ops broker
role_title            text not null
quantity              int not null default 1
experience_band       enum('0-3','3-5','5-8','8+') not null
budget_min_paise      bigint not null
budget_max_paise      bigint not null
engagement_type       enum('contract','c2h','full_time') not null
duration_text         text                      -- '6 months, extendable'
location_city         text
work_mode             enum('onsite','hybrid','remote') not null
hybrid_days           int
start_date            date
notice_accepted       text[] not null           -- {'immediate','le_30','le_60'}
client_note           text                      -- CLIENT + OPS ONLY, never to vendors
stage                 enum('draft','new','matching','shortlisted','interviewing','placed','closed','cancelled')
                        not null default 'draft'
sla_due_at            timestamptz
posted_at             timestamptz
closed_at             timestamptz
```

Not stored: `value_per_month` (derive as `budget_max × quantity`), `age`, `sla_state`,
`sourced_count`.

### requirement_stage_events
Every stage move, for the audit trail, the undo affordance and cycle-time analytics.
```
id             uuid pk
requirement_id uuid not null → requirements(id)
from_stage     text
to_stage       text not null
actor_id       uuid → users(id)               -- null for system moves
reason         text
occurred_at    timestamptz not null default now()
```

---

## 6. Matching and shortlists

### matches
The ops-side candidate pool for one requirement. **Never exposed to a client.**
```
id                        uuid pk
requirement_id            uuid not null → requirements(id) on delete cascade
resource_id               uuid not null → bench_resources(id)
algo_score                int not null              -- 0–100
score_skill               int not null
score_test                int not null
score_exp_fit             int not null
score_rate                int not null
score_freshness           int not null
score_vendor              int not null
reason_line               text                      -- one-line ops summary
algo_rank                 int not null
manual_rank               int                       -- null = follow algo_rank
included                  bool not null default false
hidden                    bool not null default false
proposed_client_rate_paise bigint
eligibility               enum('eligible','blocked_stale','blocked_score_expired',
                              'blocked_duplicate','blocked_deployed')
computed_at               timestamptz not null
unique (requirement_id, resource_id)
```

`margin_pct` is **derived**, never stored:
`(proposed_client_rate - vendor_rate) / proposed_client_rate × 100`.
Storing it invites drift when either rate changes.

### shortlists
```
id                 uuid pk
requirement_id     uuid not null → requirements(id)
sequence_no        int not null                 -- 1st, 2nd shortlist for this req
sent_by            uuid not null → users(id)
sent_at            timestamptz not null
broker_note        text                         -- the footer strip message to the client
opened_at          timestamptz                  -- powers 'client has not opened it yet'
unique (requirement_id, sequence_no)
```

### shortlist_items
**The client-facing snapshot.** The client shortlist endpoint reads from here and nowhere
else. This table structurally cannot leak: it has no vendor column and no vendor rate.
```
id                     uuid pk
shortlist_id           uuid not null → shortlists(id) on delete cascade
resource_id            uuid not null → bench_resources(id)   -- join key, NEVER serialised
masked_id              text not null              -- copied, so a later change can't shift it
position               int not null
experience_months      int not null
base_city              text not null
skills_snapshot        text[] not null
score_overall          int
score_coding           int
score_dsa              int
score_system_design    int
score_communication    int
assessment_attempt_no  int
assessment_tested_on   date
availability_label     text not null              -- 'Available now', 'From 1 Oct'
availability_kind      enum('immediate','dated','notice') not null
rate_band_min_paise    bigint not null            -- derived from CLIENT rate — see MASKING.md
rate_band_max_paise    bigint not null
client_decision        enum('pending','selected','passed') not null default 'pending'
decided_at             timestamptz
```

### interviews
```
id                  uuid pk
requirement_id      uuid not null → requirements(id)
shortlist_item_id   uuid not null → shortlist_items(id)
round_no            int not null
status              enum('proposed','awaiting_vendor','confirmed','completed','cancelled','no_show')
scheduled_at        timestamptz
duration_minutes    int
mode                enum('video','onsite','phone')
location_text       text                    -- 'Whitefield campus'
meeting_url         text                    -- ALWAYS issued by Talentvibes
proposed_slots      jsonb                   -- [{start,end}] while awaiting confirmation
requested_at        timestamptz
confirmed_at        timestamptz
```

### interview_panelists
Client-side names. Never relayed to a vendor.
```
interview_id   uuid not null → interviews(id) on delete cascade
user_id        uuid → users(id)
display_name   text not null            -- 'R. Sundaram'
title          text                     -- 'Eng Manager'
pk (interview_id, display_name)
```

### interview_feedback
```
id                       uuid pk
interview_id             uuid not null → interviews(id)
submitted_by             uuid not null → users(id)
rating_technical_depth   int   -- 1–5
rating_problem_solving   int
rating_communication     int
rating_role_fit          int
notes                    text                    -- verbatim, client + ops only
outcome                  enum('advance','hold','pass') not null
submitted_at             timestamptz not null
relayed_at               timestamptz
relayed_summary          text                    -- redacted version sent to the vendor
relayed_by               uuid → users(id)
due_at                   timestamptz
```

---

## 7. Placements and money

### engagements
```
id                     uuid pk
requirement_id         uuid not null → requirements(id)
resource_id            uuid not null → bench_resources(id)
client_org_id          uuid not null → organizations(id)
vendor_org_id          uuid not null → organizations(id)
role_title             text not null
start_date             date not null
end_date               date
status                 enum('onboarding','active','ending','ended','terminated')
vendor_rate_paise      bigint not null       -- what Talentvibes pays the vendor
client_rate_paise      bigint not null       -- what the client pays Talentvibes
margin_approved_by     uuid → users(id)      -- required when below the floor
margin_exception_note  text
```

`spread = client_rate - vendor_rate` and `margin_pct = spread / client_rate × 100` are
derived. Two separate contracts exist in the real world (Talentvibes↔client and
Talentvibes↔vendor); the single row models both sides, and neither side's API ever sees
the other's column.

### rate_changes
Rates change at renewal and mid-engagement. Keep history — invoices depend on it.
```
id             uuid pk
engagement_id  uuid not null → engagements(id)
side           enum('vendor','client') not null
old_paise      bigint
new_paise      bigint not null
effective_from date not null
reason         text
actor_id       uuid not null → users(id)
```

### invoices / invoice_lines
```
invoices
  id                uuid pk
  counterparty_org_id uuid not null → organizations(id)
  direction         enum('receivable','payable') not null   -- from client / to vendor
  period_month      date not null                            -- first of month
  status            enum('draft','issued','paid','void')
  issued_at         timestamptz
  due_at            timestamptz                              -- net 30
  paid_at           timestamptz
  total_paise       bigint not null default 0
  unique (counterparty_org_id, direction, period_month)

invoice_lines
  id             uuid pk
  invoice_id     uuid not null → invoices(id) on delete cascade
  engagement_id  uuid not null → engagements(id)
  description    text not null
  days_billed    int
  days_in_month  int
  amount_paise   bigint not null
  is_prorata     bool not null default false
```

Two invoices per engagement-month: one receivable from the client at `client_rate`, one
payable to the vendor at `vendor_rate`. **They are never joined in an API response.** The
vendor's earnings endpoint reads only `direction = 'payable'` rows for its own org.

---

## 8. Brokering

### broker_threads
One thread per side. There is no thread visible to both.
```
id                    uuid pk
side                  enum('client','vendor') not null
counterparty_org_id   uuid not null → organizations(id)
broker_user_id        uuid not null → users(id)
scope_type            enum('general','requirement','candidate','interview') not null
scope_requirement_id  uuid → requirements(id)
scope_resource_id     uuid → bench_resources(id)
scope_label           text not null      -- 'REQ-2291 · Senior React Engineers'
linked_thread_id      uuid → broker_threads(id)   -- the counterpart, ops-visible only
status                enum('open','closed')
last_message_at       timestamptz
```

### broker_messages
```
id               uuid pk
thread_id        uuid not null → broker_threads(id) on delete cascade
sender_user_id   uuid not null → users(id)
sender_side      enum('client','vendor','ops') not null
body             text not null
relayed_from_id  uuid → broker_messages(id)   -- set on the redacted counterpart copy
redaction_note   text                         -- ops-only: what was removed and why
read_at          timestamptz
sent_at          timestamptz not null default now()
```

A message row is only ever visible in its own thread. Relay creates a **new row** in the
linked thread; it does not share or reparent the original.

---

## 9. Duplicates

### duplicate_flags
```
id                 uuid pk
code               text unique not null       -- 'DUP-0148'
resource_a_id      uuid not null → bench_resources(id)   -- the earlier submission
resource_b_id      uuid not null → bench_resources(id)
confidence         int not null               -- 0–100
signals            jsonb not null             -- see below
status             enum('open','kept_a','kept_b','not_duplicate') not null default 'open'
assigned_to        uuid → users(id)
blocks_requirements uuid[]                    -- reqs whose shortlist is held
resolved_by        uuid → users(id)
resolved_at        timestamptz
resolution_note    text
detected_at        timestamptz not null
unique (least(resource_a_id, resource_b_id), greatest(resource_a_id, resource_b_id))
```

`signals` shape, matching the design's centre column:
```json
[
  {"key":"pan_hash",    "label":"PAN hash",         "verdict":"exact",   "severity":"high"},
  {"key":"phone_hash",  "label":"Phone hash",       "verdict":"exact",   "severity":"high"},
  {"key":"employers",   "label":"Employer history", "verdict":"3 of 3 overlap","severity":"high"},
  {"key":"github",      "label":"GitHub handle",    "verdict":"same",    "severity":"medium"},
  {"key":"experience",  "label":"Experience stated","verdict":"6.2y vs 6.5y","severity":"medium"},
  {"key":"rate",        "label":"Rate differs",     "verdict":"₹14,000 apart","severity":"low"}
]
```

Neither the client nor the candidate is ever told a duplicate flag exists. The losing vendor
is told only that the profile is already represented.

---

## 10. Cross-cutting

### audit_log
```
id             uuid pk
actor_id       uuid → users(id)        -- null for system
actor_org_id   uuid → organizations(id)
action         text not null           -- 'shortlist.sent', 'requirement.stage_changed'
entity_type    text not null
entity_id      uuid not null
before         jsonb
after          jsonb
context        jsonb                   -- ip, user agent, request id
occurred_at    timestamptz not null default now()
```
Append-only; no update or delete grant for the application role. Partition by month once
it grows.

### notifications
```
id           uuid pk
user_id      uuid not null → users(id)
kind         text not null
payload      jsonb not null
read_at      timestamptz
```

### saved_views
Powers the ops talent-pool "Save this view".
```
id        uuid pk
user_id   uuid not null → users(id)
name      text not null
filters   jsonb not null
```

### sensitive_columns
The tripwire registry from `docs/MASKING.md`. Seeded by migration, asserted in CI.
```
table_name   text not null
column_name  text not null
visible_to   text[] not null      -- {'ops'}, {'ops','owning_vendor'}
pk (table_name, column_name)
```

---

## Indexes worth creating up front

```
bench_resources        (vendor_org_id, status), (last_confirmed_at), (masked_id),
                       (pan_hash), (phone_hash), (email_hash)
resource_skills        (skill_id, resource_id)
requirements           (client_org_id, stage), (owner_user_id, stage), (sla_due_at)
matches                (requirement_id, algo_rank), (resource_id)
shortlist_items        (shortlist_id, position)
interviews             (requirement_id, scheduled_at), (status, scheduled_at)
engagements            (status, client_org_id), (status, vendor_org_id)
broker_messages        (thread_id, sent_at desc)
audit_log              (entity_type, entity_id, occurred_at desc)
```

Ops talent-pool search across name, skills and city needs a trigram index on
`bench_resources.full_name` plus the skill join. Full-text search is not required at this
scale; revisit past ~50k profiles.

## Views to define

| View | Purpose |
|---|---|
| `v_resource_freshness` | `last_confirmed_at` → days, state, decay width |
| `v_requirement_sla` | `sla_due_at` + stage → `ok/warn/late/idle` |
| `v_engagement_margin` | spread and margin percentage, **ops only** |
| `client_v_shortlist_items` | client-safe projection of `shortlist_items` |
| `vendor_v_pipeline` | vendor-safe projection of `matches` + `interviews` for own resources |
| `ops_v_talent_pool` | fully unmasked, joined, filterable |
