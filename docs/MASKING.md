# MASKING.md — the visibility contract

**This is the most important document in the repository.** Every read path must comply.
When this document and any other document disagree, this one wins.

## The rule

- A **client** never learns the identity of a candidate or of the supplying vendor.
- A **vendor** never learns the identity of the hiring client.
- Neither side ever sees the **margin**, nor any figure from which the margin can be
  derived.
- **Ops** sees everything.

## Field visibility matrix

`✅` visible · `❌` never returned · `🔸` own records only · `🎭` masked/derived form only

| Field | Client | Vendor | Ops |
|---|:--:|:--:|:--:|
| Candidate legal name | ❌ | 🔸 | ✅ |
| Candidate photo / avatar | ❌ | 🔸 | ✅ |
| Candidate contact details (phone, email) | ❌ | 🔸 | ✅ |
| Candidate CV / resume file | ❌ | 🔸 | ✅ |
| Candidate employer history | ❌ | 🔸 | ✅ |
| Candidate PAN / phone hashes | ❌ | ❌ | ✅ |
| Masked resource ID (`TV-4821`) | ✅ | 🔸 | ✅ |
| Vendor (supplier) identity | ❌ | 🔸 | ✅ |
| Vendor reliability score | ❌ | 🔸 | ✅ |
| Vendor rate (cost to Talentvibes) | ❌ | 🔸 | ✅ |
| Client identity | 🔸 | ❌ | ✅ |
| Client rate (price to client) | 🔸 | ❌ | ✅ |
| Client budget band | 🔸 | ❌ | ✅ |
| Client's internal note on a requirement | 🔸 | ❌ | ✅ |
| Margin / spread | ❌ | ❌ | ✅ |
| Rate shown on a masked shortlist card | 🎭 band | ❌ | ✅ |
| Proctored score + four-section breakdown | ✅ | 🔸 | ✅ |
| Assessment report file | 🎭 summary | 🔸 | ✅ |
| Attempt number, tested date, validity | ✅ | 🔸 | ✅ |
| Availability / notice period | ✅ | 🔸 | ✅ |
| Freshness state | ❌ | 🔸 | ✅ |
| Skills, experience, base city | ✅ | 🔸 | ✅ |
| Interview panel names | 🔸 | ❌ | ✅ |
| Interview feedback (verbatim) | 🔸 | ❌ | ✅ |
| Interview feedback (redacted relay) | — | 🔸 | ✅ |
| Duplicate flags | ❌ | ❌ | ✅ |
| Other requirements a candidate is in | ❌ | 🔸 | ✅ |

Two entries deserve a note:

- **Freshness is ops/vendor-only.** It is an operational signal about supplier hygiene.
  A client seeing "unconfirmed 26d" learns that a supplier is slow, which is supplier
  information. The client sees availability (`Available now`, `From 1 Oct`, `30-day
  notice`) and nothing else.
- **The assessment report** may be summarised for the client (scores and section
  breakdown, which the design shows) but the raw report artefact often contains the
  candidate's name, code repository handles and webcam stills. Serve a generated,
  name-free summary — never the raw file.

## Masked identifiers

`TV-####` is a stable, globally unique, immutable public identifier on a bench resource.
The same value appears in the client shortlist and the vendor roster, which is what makes
brokered conversation possible ("about TV-4821").

Generation rules:

1. **Random, not sequential.** Sequential IDs leak listing order, which leaks which
   profiles arrived in the same bulk upload, which leaks vendor grouping.
2. Drawn from unused values in a large space; expand beyond four digits when occupancy
   passes ~30% rather than reusing retired IDs. IDs are **never reused**.
3. Not derived from any candidate attribute. No hashing of the name — that is reversible
   by dictionary attack.

A duplicate-flagged second submission gets its own ID with a suffix in ops views only
(`TV-7188-B` in the design). Clients never see suffixed IDs.

## Rate bands: the subtle one — read this before implementing shortlists

The client sees a **rate band**, not a number. The band must be derived from the
**client-facing price**, never from the vendor's cost.

> ⚠️ **The prototype gets this wrong and you must not copy it.** In the design fixtures,
> TV-4821 has a vendor rate of ₹1.38L and a proposed client rate of ₹1.82L, but the masked
> client card shows a band of ₹1.35–1.55L — a band that brackets the *vendor cost*.
> Shipping that would hand the client the supplier's price and therefore the margin.
> See ADR-004 for the resolution and the required band algorithm.

Band rules:

- Compute from `proposed_client_rate` only. The vendor rate must not be an input.
- Quantise to coarse buckets (e.g. ₹10,000 steps) so the exact figure cannot be recovered
  by comparing bands across candidates.
- Band width must not vary with margin — a narrow band on a thin-margin candidate is a
  side channel.
- Store the band on `shortlist_items` at send time. Never recompute it on read.

## Side channels — things that leak without any forbidden field

A response can satisfy the matrix and still leak. Check for these:

| Channel | Leak | Mitigation |
|---|---|---|
| Ordering | Candidates returned grouped by vendor reveals vendor clusters | Serve the explicit `manual_rank`/`algo_rank` order; never fall back to insertion order or `id` |
| ID sequence | Sequential masked IDs cluster by vendor and upload batch | Random allocation (above) |
| Rate precision | An exact rupee figure on a client card is recoverable back to the vendor rate | Coarse bands only |
| Timing | Two candidates created within the same second are the same bulk upload | Never expose `created_at` on client-facing candidate records |
| Counts | "42 profiles on live benches match" is safe; "14 from one supplier" is not | Aggregates must never be broken down by vendor for a client, or by client for a vendor |
| Error messages | "Candidate belongs to Nimbus Softworks" in a 403 body | Generic errors; details to the audit log only |
| Free text | A broker message pasting a supplier name; a client note naming a competitor | Relay redaction is a broker action with automatic flagging — see below |
| File metadata | A PDF's `Author` field, an XLSX sheet name | Strip metadata on any file served cross-side |
| Interview links | A Google Meet link created on the vendor's workspace domain | Meeting links are always issued by Talentvibes |
| Email headers | Reply-to, display name, signature | All cross-side email is sent from Talentvibes; no forwarding |

## Redaction on relay

When ops relays a message or feedback across the divide:

1. The original is stored intact and attributed to its real author.
2. A **new** message is created in the counterpart thread, with `relayed_from_id` and a
   `redacted_body`.
3. Automatic flagging runs over the draft and highlights: known organisation names from
   the `organizations` table, currency amounts, email addresses, phone numbers, URLs and
   person names from the candidate/panel tables.
4. The broker confirms. **Never auto-send a machine-redacted message.** Flagging assists a
   human; it does not replace one.

The footer copy in the design — "Talentvibes relays anything relevant to the supplier with
your company name and commercials removed" — is a promise the backend has to keep.

## Enforcement

Four mechanisms, all required:

1. **Separate read models per portal.** A forbidden field is not merely filtered; it is
   absent from the type. `docs/ARCHITECTURE.md` explains the folder layout.
2. **Postgres views + RLS.** `client_v_*`, `vendor_v_*` views select only permitted
   columns and carry RLS policies keyed on `org_id`. Application code uses the restricted
   role so policies actually apply.
3. **Leak tests in CI.** A golden-fixture suite hits every `/api/client/*` and
   `/api/vendor/*` endpoint with a fully populated database and asserts that no response
   body — at any depth — contains a forbidden key, a known vendor name, a known client
   name, or any exact rate from the fixture set. This test must fail loudly when someone
   adds a column. See `docs/TESTING.md`.
4. **A schema-level tripwire.** Sensitive columns are tagged in a registry
   (`sensitive_columns`), and a build step fails if a tagged column appears in a
   client/vendor view definition.

## When in doubt

Return less. A missing field produces a bug report. A leaked field produces a lost customer
and, for candidate PII, a legal problem. There is no symmetry between those two failures.
