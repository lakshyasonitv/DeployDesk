# ARCHITECTURE.md

## Goals and constraints

**Functional goals**

1. Serve three portals (client, vendor, ops) from one database with strict, provable
   field-level separation.
2. Support the full brokered lifecycle: requirement → sourcing → matching → masked
   shortlist → brokered interviews → placement → billing.
3. Make every client↔vendor interaction pass through a Talentvibes broker, with the
   relay recorded.

**Non-functional constraints**

| Constraint | Target |
|---|---|
| Scale | ~2,000 bench resources, ~25 concurrent requirements, ~20 vendors, ~10 clients at launch. Design for 20× without re-architecting. |
| Ops board | Must stay usable at hundreds of requirements — pipeline endpoints must paginate and aggregate server-side. |
| Latency | Talent pool search p95 < 400 ms at 10k profiles (the UI advertises "62 results · 0.18s"). |
| Correctness over throughput | This is a low-volume, high-value marketplace. Prefer a boring, auditable transactional design over eventual consistency. |
| Team | Small. Optimise for one codebase, one deploy, few moving parts. |

## Shape

A **modular monolith**. One Next.js app, one Postgres database. No microservices — the
volume does not justify them and distributed transactions would make the masking guarantees
harder, not easier.

```
                    ┌───────────────────────────────────┐
   client portal ──▶│  /api/client/*                    │
   vendor portal ──▶│  /api/vendor/*   route handlers   │
   ops console   ──▶│  /api/ops/*                       │
                    └────────────────┬──────────────────┘
                                     │  each namespace has its OWN read models
                    ┌────────────────▼──────────────────┐
                    │  domain services (shared)         │
                    │  matching · shortlists · freshness│
                    │  brokering · margin · duplicates  │
                    └────────────────┬──────────────────┘
                                     │
                    ┌────────────────▼──────────────────┐
                    │  Postgres (Supabase)              │
                    │  tables + portal views + RLS      │
                    └────────────────┬──────────────────┘
                                     │
              pg_cron sweeps ────────┘        adapters ──▶ proctoring provider
              (freshness, SLA, billing)                ──▶ Resend (email)
                                                       ──▶ object storage (CVs, reports)
```

The important asymmetry: **domain services are shared, read models are not.** A service
like `matching` computes with unmasked data because ops needs it. What crosses the HTTP
boundary is decided entirely by the portal-specific read model in front of it.

## Layers

```
app/api/{client,vendor,ops}/…/route.ts   thin: auth → validate → call service → read model
src/read-models/{client,vendor,ops}/     the ONLY place a response shape is defined
src/services/                            business logic, works on full domain objects
src/db/schema/                           Drizzle table definitions
src/db/migrations/                       checked-in SQL, append-only
src/db/queries/                          reusable query builders
src/lib/auth/                            session, tenancy, role guards
src/lib/money/                           paise helpers, band generation
src/lib/adapters/                        proctoring, email, storage
src/jobs/                                cron entrypoints
tests/leak/                              golden-fixture masking tests
```

Rules:

- A route handler never touches the database directly.
- A service never returns an HTTP response shape.
- A read model never contains business logic — it selects and renames, nothing more.

## Tenancy and authorisation

Three checks, in this order, on every request:

1. **Authenticated** — valid Supabase session.
2. **Portal match** — the JWT's `org_type` matches the route namespace. A vendor user
   hitting `/api/client/*` is a 404 (not a 403 — do not confirm the route exists).
3. **Ownership** — the row belongs to the caller's `org_id`. A vendor may only read its
   own bench resources; a client only its own requirements.

A user belongs to **exactly one organisation**. The portal switcher in the prototype is a
demo affordance and has no production equivalent. Ops users are the only ones who can read
across organisations, and only through `/api/ops/*`.

### Defence in depth

| Layer | What it catches |
|---|---|
| Read models | The default case — forbidden fields are not in the shape at all |
| RLS policies | A service that forgets a `WHERE org_id = …` |
| Leak tests in CI | A new column silently added to an existing response |
| Audit log | Post-hoc — who saw what, when |

Application queries run as a **restricted database role, not the service role**, so RLS
actually applies. Reserve the service role for migrations and cron jobs, and never expose it
to a request-scoped code path.

## Read models per portal

Rather than one `Candidate` type with optional fields, define three unrelated types:

- `ClientMaskedCandidate` — masked id, skills, experience, city, proctored score +
  breakdown, rate band, availability. **No** name, photo, vendor, exact rate, margin.
- `VendorRosterResource` — own name, own employee id, masked id, own vendor rate, own
  assessment, freshness. **No** client name, client rate, margin.
- `OpsCandidate` — everything.

They live in different folders and share no base interface. This is deliberate: a shared
base is exactly the mechanism by which a field leaks. See `docs/MASKING.md`.

## Background work

| Job | Cadence | What it does |
|---|---|---|
| Freshness sweep | Nightly 02:00 IST | Recomputes matching eligibility, emails vendors about expiring profiles, ages profiles out of the pool at 14 days |
| SLA sweep | Every 15 min | Recomputes `sla_state`, raises ops notifications on `warn`/`late` transitions |
| Assessment expiry | Nightly | Marks scores older than 90 days `expired`, notifies the owning vendor |
| Duplicate detection | On resource create/import, plus nightly full pass | Hash and fuzzy matching, raises `duplicate_flags` |
| Billing run | Monthly, 1st | Generates invoice lines including pro-rata for mid-month starts and ends |
| Match refresh | On requirement change, on new listing | Recomputes candidate pools for open requirements |

Jobs are **idempotent** and write to the same audit log as user actions, with a system actor.

## Data flow: the critical path

Requirement → masked shortlist, the sequence the whole product hangs on:

1. Client posts a requirement (`POST /api/client/requirements`). Stage `new`.
   The live match preview shown while typing is a **read-only, aggregate-only** endpoint —
   it returns counts and bands, never profiles.
2. Ops (or the match job) sources candidates → `matches` rows with algorithm score,
   six component scores and a proposed client rate. Stage `matching`.
3. Ops opens the matching workspace, reorders (`manual_rank`), toggles `included`, and
   sends. On send:
   - a `shortlists` row is created and **`shortlist_items` snapshot** the fields the client
     will see, frozen at that moment;
   - the requirement moves to `shortlisted`;
   - an audit row records who sent what.
4. The client reads `/api/client/shortlists/:reqId`, which serves **only from
   `shortlist_items`** — never from `matches` or `bench_resources`. This is a structural
   guarantee: the client-facing table physically does not contain vendor identity, exact
   vendor rate, or margin.

Snapshotting is not just a masking device. It means a vendor editing a rate, or a freshness
timer expiring, does not silently change a shortlist a client is mid-way through reviewing.

## Brokering: two threads, never one

A "conversation" about a candidate is **two separate threads** joined only by the broker:

```
client user ──▶ thread(side=client) ──▶ broker ──▶ thread(side=vendor) ──▶ vendor user
```

There is no shared thread row and no message visible to both sides. When ops relays a
message, a **new message** is created in the counterpart thread with a `relayed_from_id`
pointer and a redacted body. Redaction is a human action by the broker, assisted by
automatic flagging of company names, amounts and contact details — never an automatic
rewrite of what a user typed.

Interview feedback follows the same path: the client's scorecard is stored intact, and a
redacted version with commercials and client identity removed is relayed to the vendor.

## Integrations

| Integration | Boundary |
|---|---|
| Proctored assessments | `AssessmentProvider` interface: `invite`, `getStatus`, `getReport`. Webhook `assessment.completed` writes score + four section scores. See ADR-006 — this is a strong candidate for reusing the in-house proctoring platform. |
| Email | `Mailer` interface over Resend. All templates server-rendered; no client identity in vendor emails, no vendor identity in client emails — enforced by a lint rule over template inputs. |
| File storage | CVs, assessment reports, bulk-upload sheets. Signed, short-lived URLs only. **CVs are ops-only** — they contain names, employers and contact details, so they are never served to a client under any circumstance. |
| Bulk upload | CSV/XLSX parsed server-side into `bulk_import_rows`, validated row by row, with a review queue for failures and suspected duplicates. |

## What is deliberately out of scope for v1

Matching the prototype's own exclusions: command palette search, real-time websockets
(polling is fine at this volume), mobile layouts, multi-currency, and self-serve vendor
onboarding. Add them when there is a reason, not before.
