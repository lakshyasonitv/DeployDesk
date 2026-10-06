# Data model, visibility rules and API sketch

## Core entities
```ts
type OrgRole = "client" | "vendor";

interface Organisation {
  id: string;                 // "org_acme"
  name: string;               // "Acme Finserv"
  roles: OrgRole[];           // a company can be BOTH (see "Dual-role companies")
  groupId: string;            // parent group by PAN/GST — subsidiaries share it
  supplierCode?: string;      // "NSW-0142" (vendor role)
  vendorReliability?: number; // 0–5, vendor role only
  clientReliability?: number; // 0–5, client role only (feedback on time, interviews held)
}

interface User {
  id: string; orgId: string; name: string; title: string;
  permissions: ("client.view" | "client.manage" | "vendor.view" | "vendor.manage" | "ops.*")[];
}

interface Requirement {           // "role" in the UI
  id: string;                     // "REQ-2291"
  clientOrgId: string;
  title: string; skills: string[];
  experienceBand: "0-3" | "3-5" | "5-8" | "8+";
  quantity: number;
  budgetMin: number; budgetMax: number;  // INR per person per month
  engagementType: "contract" | "contract_to_hire" | "full_time";
  durationText: string; location: string; workMode: "onsite" | "hybrid" | "remote";
  startDate: string; noticeAccepted: ("immediate" | "30" | "60")[];
  stage: "new" | "matching" | "shortlisted" | "interviewing" | "placed";
  ownerUserId: string;            // Ops owner
  slaDueAt: string;               // drives ok / warn / late
  clientNote?: string;
}

interface Resource {              // a bench engineer
  id: string;                     // internal
  publicId: string;               // "TV-4821" — the ONLY identifier outside Ops/owner vendor
  vendorOrgId: string;
  fullName: string; employeeId: string;      // vendor + ops only
  panHash: string; phoneHash: string;        // ops only, for duplicate detection
  city: string; experienceYears: number; skills: string[];
  vendorRate: number;                        // what the vendor gets; vendor + ops only
  availableFrom: string; noticeDays: number;
  availabilityConfirmedAt: string;           // freshness
  listed: boolean;
}

interface Assessment {
  resourceId: string;
  status: "not_started" | "invited" | "in_progress" | "scored" | "expired";
  score?: number;                            // 0–100
  breakdown?: { coding: number; dataStructures: number; systemDesign: number; communication: number };
  attempt: number; testedAt?: string; validUntil?: string;   // 90-day validity
}

interface ShortlistEntry {
  requirementId: string; resourceId: string;
  rank: number;                // ops-controlled order — the client sees this order
  included: boolean;
  matchScore: number;
  reasons: { skills: number; test: number; experience: number; rate: number; freshness: number; vendor: number };
  clientRateBand: [number, number];   // what the client sees
  clientDecision?: "interview" | "pass";
}

interface Interview { id: string; requirementId: string; resourceId: string; round: number;
  startsAt: string; durationMin: number; mode: string; panel: string[];
  feedback?: { technical: number; problemSolving: number; communication: number; roleFit: number; notes: string;
               outcome: "move_forward" | "hold" | "not_a_fit" } }

interface Placement { id: string; requirementId: string; resourceId: string;
  vendorRate: number; clientRate: number; // margin = (client - vendor) / client
  startDate: string; endDate: string; status: "onboarding" | "active" | "ending" | "ended" }

interface DuplicateCase { id: string;               // "DUP-0148"
  resourceIds: [string, string]; confidence: number; // 0–1
  signals: { kind: "pan" | "phone" | "employer" | "github" | "experience" | "rate"; match: "exact" | "partial" | "differs"; detail: string }[];
  status: "open" | "kept_a" | "kept_b" | "not_duplicate"; assigneeUserId?: string }
```

## Visibility matrix (enforce server-side)
| Field | Client | Vendor (owner) | Vendor (other) | Ops |
|---|---|---|---|---|
| Resource name, photo, employee ID | ✕ | ✓ | ✕ | ✓ |
| Vendor company name | ✕ | own | ✕ | ✓ |
| `publicId` (TV-####) | ✓ | ✓ | ✕ | ✓ |
| Skills, experience, city, availability, test score + breakdown | ✓ | ✓ | ✕ | ✓ |
| Vendor rate | ✕ | ✓ | ✕ | ✓ |
| Client rate / rate band | ✓ (band on shortlists, exact on placements) | ✕ | ✕ | ✓ |
| Margin / spread | ✕ | ✕ | ✕ | ✓ |
| Client company name | own | ✕ (until placement, then optional) | ✕ | ✓ |
| PAN/phone hashes, duplicate cases | ✕ | ✕ | ✕ | ✓ |

Use **separate response DTOs per audience**, such as `ClientCandidateCard`, `VendorResourceRow` and `OpsCandidate`. Never take a full object and hide fields in the UI.

## Stage rules (requirement pipeline)
- Ops can move a role to any stage (drag, arrows, or the list view). Every move is audit-logged and can be undone.
- Automatic moves happen on events:
  - First candidate sourced: new → matching
  - Shortlist sent: → shortlisted
  - First interview booked: → interviewing
  - Placement signed: → placed
- SLA states: `ok` (more than 8h left), `warn` (under 8h, or client feedback due), `late` (past due), `idle` (waiting on the client).

## Ranking
`matchScore = 0.30·skills + 0.22·test + 0.16·experience + 0.14·rate + 0.10·freshness + 0.08·vendorReliability`. Each component is scored 0–100.
- Freshness decays linearly to 0 over 28 days since `availabilityConfirmedAt`.
- A profile unconfirmed for more than 14 days, or with an expired test, is **excluded from matching**.
- An Ops override stores an explicit `rank` and sets `overridden = true`, which shows the "You changed the order" pill.

## Availability freshness (vendor roster)
- `confirmed`: confirmed within the last 10 days
- `expiring`: 10–14 days ago
- `unconfirmed`: more than 14 days ago (dropped from matching)
- Clicking "Still free" sets `availabilityConfirmedAt = now`. A nightly job at 02:00 IST recalculates every state.

## Duplicate detection
- Run on create and on CSV import. Compare against resources from **other** vendors.
- Signals: exact match on hashed PAN, exact match on hashed phone, employer-history overlap, GitHub handle, experience within ±1 year, rate difference.
- Confidence ≥ 0.9 **blocks** sending any shortlist that contains either resource until the case is resolved.
- Default recommendation: keep the earlier submission, unless it is unconfirmed or from a vendor with reliability under 3.5.
- Neither the client nor the candidate is told.

---

## Dual-role companies (a vendor that is also a client)

One account with two roles, plus guard-rails:

1. **One organisation, two hats.** One KYC/GST check and one master agreement with a client schedule and a supplier schedule.
   - Permissions are set **per user**. The HR team gets `client.*` and the bench manager gets `vendor.*`.
   - Users who hold both see a **Hiring / Supplying** switch in the top bar. The demo's portal switcher is the visual reference.
2. **No self-matching.** The matching query must enforce `resource.vendorGroupId != requirement.clientGroupId`. Group by parent PAN/GST so subsidiaries are caught too.
   - Optionally, show the client a note: "You have N matching people on your own bench." Internal redeployment happens off-exchange, with no fee.
3. **Walls stay up.** Holding both roles unlocks nothing. Their supplier users still can't see client rates or margins, and their client users still only see masked profiles.
   - Show **bands, not exact rates**, on shortlists so nobody can work out the per-deal margin.
   - Flag likely price-discovery behaviour: many roles posted, shortlists viewed, no interviews booked.
4. **Separate money.** Keep separate `receivables` (invoices to them as a client) and `payables` (payouts to them as a vendor).
   - **No netting by default.** Indian GST and TDS expect separate invoices. Offer netting only as a signed opt-in.
5. **Separate reputations.** Track `vendorReliability` and `clientReliability` independently.
6. **Ops.** Show a "Dual role" badge wherever the organisation appears.
   - The margin view gains a per-organisation net position: billed to them, paid to them, and net.
   - Non-solicitation applies in both directions.

---

## REST sketch
```
# Client
GET  /api/client/overview
GET  /api/client/requirements                     → ClientRequirement[] (with stage + progress step)
POST /api/client/requirements                     ← form from Post a new role
GET  /api/client/requirements/:id/match-preview?skills=&exp=&lo=&hi=   → { total, inBudget, scored80, startOnTime }
GET  /api/client/shortlists/:requirementId        → ClientCandidateCard[] (masked)
POST /api/client/shortlists/:requirementId/decisions  ← { publicId, decision: "interview"|"pass" }
GET  /api/client/interviews
POST /api/client/interviews/:id/feedback
GET  /api/client/placements
GET  /api/client/messages?context=  POST /api/client/messages

# Vendor
GET  /api/vendor/overview
POST /api/vendor/resources            POST /api/vendor/resources/import (CSV, ≤500 rows → { read, listed, needsReview[] })
GET  /api/vendor/resources?filter=all|listed|idle|expiring|unconfirmed
POST /api/vendor/resources/:id/confirm-availability     POST /api/vendor/resources/confirm-all
GET  /api/vendor/assessments          POST /api/vendor/assessments/:resourceId/invite
GET  /api/vendor/earnings?month=      (vendor rates only)

# Ops
GET   /api/ops/requirements?q=&owner=&risk=&unsourced=   PATCH /api/ops/requirements/:id { stage }
GET   /api/ops/requirements/:id/candidates               → OpsCandidate[] with reasons
PUT   /api/ops/requirements/:id/shortlist   ← { order: resourceId[], included: resourceId[] }
POST  /api/ops/requirements/:id/shortlist/send
GET   /api/ops/pool?filters…        GET /api/ops/margin?month=
GET   /api/ops/duplicates           POST /api/ops/duplicates/:id/resolve { outcome }
```
