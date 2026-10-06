# Handoff: Talentvibes Bench Exchange (3-portal brokered marketplace)

## Overview

Talentvibes Bench Exchange is a **brokered** marketplace for IT bench capacity. Companies with idle
("bench") engineers list them; companies that need engineers hire them. Talentvibes sits in the
middle as the **sole broker** — the two sides never see or contact each other.

The design covers three portals in one design system:

1. **Client portal** — a company hiring resources (demo tenant: *Acme Finserv*)
2. **Vendor portal** — a supplier offering its bench (demo tenant: *Nimbus Softworks*)
3. **Talentvibes Ops console** — internal brokering desk (demo user: *Priya Nair*)

### The masking rules are the product — do not soften them

| Data | Client sees | Vendor sees | Ops sees |
|---|---|---|---|
| Candidate name / photo | **No** | Own resources only | Yes |
| Vendor (supplier) identity | **No** | Own only | Yes |
| Client identity | Own | **No** | Yes |
| Vendor rate | **No** | Own only | Yes |
| Client rate | Own | **No** | Yes |
| Margin / spread | **No** | **No** | Yes |
| Proctored test score + breakdown | Yes | Own only | Yes |

Clients see candidates as anonymous IDs (`TV-4821`). Any question about a candidate goes through a
broker message thread, never to the vendor.

## About the design files

`Talentvibes Bench Exchange.dc.html` is a **design reference created in HTML** — a working
prototype that shows intended look and behaviour. It is not production code to copy.

The task is to **recreate these designs in the target codebase's existing environment** (React,
Vue, Angular, etc.) using its established component library, routing, state management and styling
conventions. If no environment exists yet, pick the most appropriate stack for the project and
implement the designs there.

Notes on the prototype's construction, so you can read it:

- It is a single-file component: markup at the top, a `class Component` with the data and handlers
  at the bottom. All styling is **inline** (a constraint of the prototype format, not a
  recommendation) — move it to whatever the codebase uses (Tailwind, CSS modules, styled-components).
- All copy, sample data and colour values in the file are intentional and should be preserved.
- Screens are conditionally rendered off `state.portal` + `state.screen`. In a real app these should
  be routes, e.g. `/client/shortlists/:reqId`, `/vendor/roster`, `/ops/pipeline`.
- The portal switcher at the bottom of the sidebar is a **demo affordance only**. In production a
  user belongs to exactly one portal; auth/tenancy decides which shell they get.

## Fidelity

**High fidelity.** Colours, typography, spacing, density and interaction behaviour are final and
should be recreated closely. Exact values are in *Design tokens* below.

Two areas are deliberately not final: the `⌘K` search palette (affordance shown, no behaviour), and
avatar images (flat grey circles / monogram chips are placeholders — use the real avatar component,
but never on the client-facing masked cards).

---

## Global shell

Applies to all three portals.

- Page: `display:flex; height:100vh; min-height:720px; overflow:hidden; background:#f7f7f9;`
  colour `#101014`.
- **Sidebar**: `width:222px`, `background:#111114`, white text, `padding:16px 0`, never scrolls the app.
  Order: brand block → search field → nav list → context aside → portal switcher + user block
  (pinned bottom via `margin-top:auto`).
  - Brand: 22px rounded square (6px radius) with a per-portal gradient, product name at
    `800 13px, letter-spacing -.3px`, and a mono portal tag at `600 9px, letter-spacing .12em, #6c6c78`.
  - Search: `border:1px solid #26262c; radius 7px; padding:6px 9px`, label `#8b8b96 12px`, `⌘K`
    keycap `10px mono` in a `1px solid #33333b` box.
  - Nav item: `padding:7px 10px; radius 7px; font-size:13px; white-space:nowrap`, label left,
    count right (`700 10.5px` mono). Active: `background:#1e1e26`, `#fff`, weight 700, count in the
    portal accent. Inactive: `#a0a0ac`, weight 500, count `#6c6c78`.
  - Context aside: mono section label (`700 9px, .14em, #5c5c68`) + rows of a 5px status dot and a
    truncated 11.5px `#a0a0ac` label. Content differs per portal (open reqs / freshness alerts /
    today's queue).
  - Portal switcher: `DEMO · SWITCH PORTAL` mono label, then three rows with a 6px accent square;
    selected row `background:#1e1e26`, `#fff`, weight 700.
- **Content column**: `flex:1; display:flex; flex-direction:column; overflow:hidden`. Each screen
  supplies a white header block (`border-bottom:1px solid #e8e8ee`) then one scrolling body
  (`flex:1; overflow:auto`).
- Screen header pattern: optional mono eyebrow / status pill, `22px/800/-.6px` title, `12.5px #6b6b78`
  subtitle, actions right-aligned (secondary = `1px solid #e0e0e8` on white; primary = accent fill,
  white text, `600–700 12.5px`, radius 8px, `padding:8px 13px`).
- Card pattern: `background:#fff; border:1px solid #e8e8ee; border-radius:12px; padding:13–20px;
  box-shadow:0 1px 2px rgba(16,16,20,.04)`.
- Table pattern: header row `background:#fafafc`, `border-bottom:1px solid #eeeef3`, labels
  `700 9.5px mono, letter-spacing .1em, #8a8a96`, uppercase; body rows `border-bottom:1px solid
  #f2f2f6`, `padding:11–12px 16–26px`; CSS **grid** with fixed px columns and one `1fr` content
  column (not `<table>`). Sticky header where the body scrolls.
- Skill chip: `padding:2–3px 7–8px; radius 5–6px; background:#f3f3f7; color:#4a4a58;
  font:600 10.5–11px; white-space:nowrap`.
- Status pill: `padding:3px 8px; radius 20px; font:700 10–10.5px` with a semantic bg/fg pair.
- Metric card: mono label `700 9.5px, .12em, #8a8a96` → value `28px/800/-1px` → delta
  (`700 11.5px`, semantic colour) → sub `11.5px #8a8a96`.

### Per-portal identity

| | Client | Vendor | Ops |
|---|---|---|---|
| Accent | `#6d3ff0` (nav accent `#a78bfa`) | `#059669` (nav accent `#34d399`) | `#b45309` (nav accent `#fbbf24`) |
| Accent tint bg | `#f1ecff` | `#ecfdf5` | `#fff3e4` |
| Brand gradient | `linear-gradient(135deg,#8b5cf6,#6366f1)` | `linear-gradient(135deg,#34d399,#0d9488)` | `linear-gradient(135deg,#fbbf24,#f97316)` |
| Portal tag | `CLIENT PORTAL` | `VENDOR PORTAL` | `OPS CONSOLE · INTERNAL` |
| Extra chrome | — | — | Internal band above every screen |
| Nav | Overview · Requirements · Shortlists · Interviews · Engagements | Overview · Add resource · Bench roster · Assessments · Earnings | Pipeline · Matching · Talent pool · Margin · Duplicates |

**Ops internal band** (full width, above the screen header):
`padding:6px 26px; background:#1c1917; color:#fbbf24; font:700 9.5px mono; letter-spacing:.14em`,
5px amber dot, text `INTERNAL · TALENTVIBES BROKERING CONSOLE · UNMASKED DATA`, right side
`Priya Nair · brokering desk 2 · logged 08:14 IST` in `#a8a29e` weight 500.

---

## Screens

### 1. Client · Dashboard (`/client`)

**Purpose** — the hiring manager's morning view: what is open, what needs review, who is working.

Layout: header (`Good morning, Ananya`, actions *Ask Talentvibes* / *Post a requirement*) → body
`padding:20px 26px 30px`:

1. Four metric cards, `grid-template-columns:repeat(4,1fr); gap:12px` — Open requirements **4**
   (+1, 9 positions in total) · Awaiting review **3** (2 new, 17 masked profiles) · In interview **4**
   (2 feedback forms due) · Active engagements **5** (₹8.4L/mo, avg tenure 4.2 months).
2. `grid-template-columns:1.55fr 1fr; gap:16px; margin-top:16px`.
   - **Open requirements** table. Columns `96px 1fr 78px 128px 132px 96px` = REQ / ROLE / QTY /
     BUDGET/MO / STAGE / ACTION. Rows: REQ-2291 Senior React Engineers (5–8y · Bangalore / Remote ·
     start 15 Sep) ×3 ₹1.30–1.70L **SHORTLISTED** → *Review 6*; REQ-2274 SAP ABAP Consultant (8y+ ·
     Pune · start 1 Oct) ×1 ₹2.00–2.60L **MATCHING** → *View*; REQ-2260 QA Automation Engineers
     (4–7y · Hyderabad · immediate) ×2 ₹1.00–1.30L **INTERVIEWING** → *Schedule*; REQ-2255
     Salesforce Developer (3–5y · Remote · start 1 Oct) ×2 ₹0.90–1.20L **NEW** → *View*.
     Action is a `700 11.5px` accent text button.
   - Right column, two cards:
     - **Awaiting your review** (pill `3`): three clickable tiles — REQ-2291 Senior React Engineers,
       6 masked profiles, avg score 83.5, *2h ago*; REQ-2260 QA Automation Engineers, 5 profiles,
       86.2, *yesterday*; REQ-2249 Node.js Platform Engineer, 6 profiles, 79.8, *2 days ago*.
     - **Active engagements**: 34px monogram tile + `TV-#### · role` + `since … · ₹…/mo` + status
       dot & label. TV-3310 Java Spring Boot (3 Mar, ₹1.92L, Active) · TV-2984 .NET Core (12 Apr,
       ₹1.44L, Active) · TV-4102 QA Automation (2 Jun, ₹1.26L, **Ends 30 Sep**, amber) · TV-3877
       Salesforce (19 May, ₹1.18L, Active) · TV-4455 SAP ABAP (1 Aug, ₹2.60L, Onboarding, blue).

### 2. Client · Post a requirement (`/client/requirements/new`)

Two columns, `1.6fr 1fr; gap:18px; align-items:start`.

**Form card** (`padding:20px`), mono section labels with `1px #eeeef3` dividers between groups:

- *ROLE* — Primary skill: chip input, filled chips React / TypeScript / Node.js in accent tint,
  ghost "Add a skill…"; suggestion row (GraphQL, Next.js, React Native) as outlined chips.
  Experience band: 4 segments 0–3y / 3–5y / **5–8y** / 8y+, selected = `#101014` fill, white.
  Quantity: stepper showing **3** with − / + buttons.
- *COMMERCIALS* — Budget range, label + value `₹1,30,000 — ₹1,70,000` (`700 12.5px` mono).
  Dual-thumb slider: 5px `#eeeef3` track, accent selected span (left 26% / right 33%), 15px white
  thumbs with 3px accent border; scale ends ₹60K … ₹3L in mono. Below: market-signal panel
  (`background:#f5f2ff; color:#5a2fd0; 11.5px/600`) — "42 profiles on live benches match this band.
  Median ask for 5–8y React in Bangalore is ₹1.48L." Engagement type segments **Contract** / C2H /
  Full-time; Duration field "6 months, extendable".
- *LOGISTICS* — Location "Bangalore · Whitefield" + mode pills Onsite / **Hybrid · 3 days** /
  Remote; Start date "15 September 2026"; Notice period accepted, multi-select segments
  **Immediate** + **≤30 days** selected, 60 days not.
- Footer above a `1px #eeeef3` rule: primary *Send to Talentvibes*, secondary *Save draft*,
  right-aligned note "Typical first shortlist: **36 hours**".

**Right rail**

- **How brokering works** — dark card (`#101014`, radius 12px). Four numbered steps in
  `#26262c` 20px tiles with accent numerals: (1) *You post, we source* — "Talentvibes searches 14
  supplier benches. Suppliers never see your name." (2) *Masked shortlist* — "You review IDs, skills,
  proctored scores and rate bands only." (3) *Brokered interviews* — "We schedule, relay feedback and
  hold both commercial conversations." (4) *One contract* — "You contract with Talentvibes. We
  contract with the supplier."
- **Live match preview** — "Updates as you edit. Identities stay hidden.", big **42** + "bench
  profiles match", then four labelled bars: Skill match 42 (84%), Within budget 31 (62%),
  Score ≥ 80 24 (48%), Start by 15 Sep 18 (36%). Amber advisory box (`#fff8ec` / `1px #f7e2bd` /
  `#8a5a08`): "**Tighten your band?** Raising the floor to ₹1.40L would add 11 profiles with
  proctored scores above 85."

### 3. Client · Shortlist review — **hero screen** (`/client/shortlists/REQ-2291`)

**Purpose** — decide who to interview from masked profiles. This screen carries the product promise:
enough signal to decide, zero identity.

Header: `SHORTLIST READY` pill (accent tint) + `REQ-2291 · delivered 22 Aug` mono; title
*Senior React Engineers*; sub "3 positions · 5–8 yrs · 6-month contract · Bangalore / Remote ·
₹1.30–1.70L per month"; actions *Ask Talentvibes* + primary **Request interviews · {n}** (n = selected
count, starts at 2).

Toolbar row: "**6 masked profiles**" · "· ranked by proctored score · names, photos and supplier
withheld" · right, mono hint "J / K to move · E to shortlist".

**Masked candidate card** — `grid-template-columns:repeat(3,1fr); gap:12px`, card `padding:13px`,
border `#e8e8ee`, or `#c9b6ff` when selected:

1. Top row: masked ID `700 15px mono, -.5px`; under it `{exp} · {city}` in `11.5px #8a8a96`.
   Right: score `19px/800/-.6px` in the availability colour + mono `PROCTORED` caption.
2. Skill chips (wrap, 4px gap).
3. Score breakdown above a `1px dashed #e8e8ee` rule: four rows, 74px label (`10.5px #8a8a96`),
   4px accent-filled track on `#eeeef3`, value `600 10.5px` mono — Coding, DSA, System design,
   Communication.
4. Provenance line `10.5px #8a8a96`: "Proctored by Talentvibes · attempt 1 · tested 09 Aug".
5. Rate block (`13px/700` + "per month") and availability pill (soft bg + 5px dot).
6. Actions: **Interview** / **Selected ✓** (fills accent when selected) · *Pass* · **?** (accent,
   opens the broker thread scoped to this candidate).

Cards (order as shown):

| ID | Skills | Exp | Score (C/D/S/Comm) | Rate ₹/mo | Availability | City |
|---|---|---|---|---|---|---|
| TV-6620 | QA Automation, Playwright, Selenium, CI/CD | 5.4y | **91** (93/88/86/92) | 1.10–1.25L | Available now | Jaipur |
| TV-4821 | React, TypeScript, Node.js | 6.2y | **88** (91/84/82/90) | 1.35–1.55L | Available now | Bangalore |
| TV-5302 | Salesforce, Apex, LWC | 3.8y | **85** (88/80/79/87) | 0.85–1.00L | From 1 Oct | Pune |
| TV-5107 | Java Spring Boot, Kafka, AWS | 8.0y | **82** (84/78/88/76) | 1.80–2.05L | From 15 Sep | Pune |
| TV-4488 | SAP ABAP, Fiori, HANA | 9.1y | **79** (80/72/84/78) | 2.10–2.40L | Available now | Bangalore |
| TV-3964 | .NET Core, Azure, SQL Server | 4.5y | **76** (79/74/70/82) | 0.95–1.10L | 30-day notice | Hyderabad |

Availability colours: *Available now* `#16a34a` on `#e9f7ee`; dated `#c2410c` on `#fdf0e7`;
notice-period `#1d4ed8` on `#e8eefc`. Attempts: TV-5302 and TV-3964 are attempt 2, rest attempt 1.
Tested dates: 12/09/15/04/30 Jul/18 Aug respectively.

Footer strip (white card): 28px avatar + "**Priya Nair, your broker:** 'TV-6620 and TV-4821 both
clear your budget and can start on the 15th. TV-4488 is above band — I can negotiate if the SAP
overlap matters to you.'" + dark **Reply** button (opens the broker thread).

### 4. Client · Interviews & feedback (`/client/interviews`)

Header actions: *Panel availability*, primary *Propose new slots*. Body
`grid-template-columns:1.35fr 1fr; gap:16px`.

**Left — SCHEDULED · THIS WEEK.** Each card: 62px date tile (`background:#f6f4ff`, mono month
`#6d3ff0`, day `20px/800` `#3d1f8f`, time `10.5px/700`) + masked ID (`700 14px` mono) + round pill +
`role · duration · mode` + `Panel: …` + buttons (dark primary CTA, outlined *Reschedule via broker*).

- AUG 25, 11:00 — TV-4821, **ROUND 1** (accent tint), Senior React Engineer, 45 min, Google Meet ·
  link from Talentvibes, panel "R. Sundaram (Eng Manager), D. Kulkarni (Staff FE)", CTA *Join briefing*.
- AUG 26, 15:30 — TV-6620, **ROUND 2** (green tint `#e8f6ef`/`#127a4a`), QA Automation Engineer,
  60 min, Onsite · Whitefield campus, panel "S. Ahuja (QA Lead), Platform pairing", CTA *View scorecard*.
- AUG 28, 10:00 — TV-7715, **ROUND 1**, Senior React Engineer, 45 min, Google Meet, panel
  "D. Kulkarni (Staff FE)", CTA *Prepare questions*.

Then **AWAITING TALENTVIBES CONFIRMATION**: dashed-border card — TV-5302, "You proposed Thu 27 Aug,
11:00 & 16:00 — broker is confirming supplier release.", *Requested 4h ago*.

**Right — Feedback · TV-6620** card. `DUE TODAY` amber pill; "Round 2 · Technical deep-dive ·
21 Aug, 15:00". Four 1–5 ratings rendered as five equal 6px pips (filled accent): Technical depth 4,
Problem solving 5, Communication 4, Role fit 4. Notes box (74px min-height, `12px/1.5`):
"Strong on Playwright and CI pipelines; walked our team through a flaky-test triage cleanly. Would
want a short pairing round with the platform lead before we commit." Outcome: **Advance** (dark) /
Hold / Pass. Footer note: "Feedback is relayed to the supplier by Talentvibes with commercial details
removed."

### 5. Broker message panel (client, global overlay)

**Purpose** — the only channel between client and vendor; every question is brokered.

Trigger points: *Ask Talentvibes* (dashboard + shortlist headers), broker-strip **Reply**,
*Reschedule via broker*, and the **?** on any masked card (opens scoped to `TV-4821 · React · 6.2y`).

Anatomy: `position:fixed; inset:0` scrim `rgba(16,16,20,.28)` (click to dismiss) + right drawer
`width:392px`, full height, `border-left:1px solid #e8e8ee`, `box-shadow:-18px 0 48px rgba(16,16,20,.14)`.

- Header: 34px monogram `PN` (accent tint), "Priya Nair", "Your Talentvibes broker · replies in ~2h", `×`.
- Context bar: `background:#faf9ff`, mono `ABOUT` + the scope in `700 11.5px #5a2fd0`.
- Thread (scrolls, auto-scrolls to newest): broker bubbles left `#f7f7fa` / `#26262e`, user bubbles
  right `#101014` / white, radius 12px, max-width 88%, meta line `10px` mono `#a3a3b0`. Seeded with
  three messages (broker → client → broker) about REQ-2291 and TV-4488's rate.
- Typing indicator: "Priya is typing…" pill, accent tint.
- Composer: four quick-reply chips ("Can we hold TV-6620 for a week?", "What is the notice period on
  the top two?", "Any room on the rate for TV-4488?", "Can you add one more profile under ₹1.5L?"),
  text input (Enter sends), **Send** button (accent when the draft is non-empty, `#c9bef0` when empty).
- Footer: "Talentvibes relays anything relevant to the supplier with your company name and
  commercials removed."

Behaviour: sending appends the user message, shows the typing indicator, and appends a broker reply
after **1400 ms** (replies cycle through four canned responses; candidate-scoped threads append
"(Re: TV-4821)"). In production this is a real message thread — the timing exists only to show the
interaction.

### 6. Vendor · Dashboard (`/vendor`)

Header: "Nimbus Softworks · bench", sub "Supplier ID NSW-0142 · reliability score 4.6/5 · you are one
of 14 suppliers on the exchange"; actions *Confirm availability (7)* + primary *Add bench resource*.

Row 1 `grid-template-columns:1.15fr repeat(4,1fr)`:

- **Bench utilisation** — dark card. **64%** with "+9 pts MoM" in `#34d399`; stacked 7px bar
  (64% green, 14% amber, rest `#26262c`); legend "27 deployed / 6 in process / 9 idle"; footer
  "Idle cost this month: **₹9.8L**. Listing 9 idle profiles could recover ~₹7.2L."
- Metric cards: Profiles listed **27** (+4, of 42 on bench) · Shortlisted **11** (6 live, across 5
  requirements) · Placed YTD **18** (+3 Aug, avg 6.4 month tenure) · Monthly billing **₹7.4L**
  (5 active placements).

Row 2 `1.5fr 1fr`:

- **Pipeline on your profiles** — "Talentvibes hides the hiring company until placement".
  Columns `100px 1fr 120px 130px 118px` = RESOURCE (masked ID + own short name) / SKILLS / **YOUR
  RATE** / STAGE / UPDATED. Rows: TV-4821 A. Rathore ₹1,38,000 INTERVIEW R1 2h ago · TV-6620 M. Iyer
  ₹1,12,000 INTERVIEW R2 yesterday · TV-7715 S. Pillai ₹1,46,000 SHORTLISTED yesterday · TV-5107
  R. Deshmukh ₹1,84,000 SHORTLISTED 2 days ago · TV-6104 N. Chaudhary ₹98,000 NOT SHORTLISTED 4 days ago.
- **Availability freshness** (amber-bordered `#f7dcae`, `ACTION NEEDED` pill): "Profiles unconfirmed
  for 14 days drop out of matching. Confirming takes one click and lifts your ranking." Three tiles —
  32 Confirmed (green), 7 Expiring soon (amber), 3 Unconfirmed (red) — then full-width green
  **Confirm all 7 expiring**.
- **Assessment throughput**: Scored 18 (67%), In progress 4 (15%), Not started 9 (33%); note
  "Scored profiles are shortlisted **3.1×** more often. 9 of your listed resources have not started
  the proctored test."

### 7. Vendor · Add bench resource + bulk upload (`/vendor/resources/new`)

Left form card, sections *IDENTITY · INTERNAL ONLY* (Full name "Ishita Bansal", Employee ID
"NSW-3391", Base city "Pune" + green reassurance panel "Clients will see this profile as **TV-####**
only. Name and Nimbus Softworks are never exposed."), *CAPABILITY* (skill chips Java Spring Boot /
Microservices / PostgreSQL; Total experience "6 years 4 months"; Available from "Immediate"; Work mode
"Hybrid / Remote"), *YOUR RATE* (monthly rate to Talentvibes `1,45,000` shown `14px/700` mono +
benchmark panel "Benchmark for 5–8y Java in Pune: **₹1.32L – ₹1.61L**. You will never see the
client-side rate."), proctored assessment (*Send test invite now* dark / *Schedule for later*), then
**List on exchange** + *Save as draft*.

Right rail:

- **Bulk upload** (`CSV · XLSX`): dropzone `2px dashed #cfe9dd` on `#f6fdfa` — "Drop your bench sheet
  here / or **browse files** · max 500 rows", column hint in mono
  `name, emp_id, skills, exp_years, city, rate_inr, available_from`. Last import
  `bench_aug26.csv`: Rows imported **38**, Listed automatically **34**, Needs review **4** (amber dot).
  Amber panel: "**4 rows need attention.** Two are missing a rate; two look like duplicates of
  profiles already on your bench." Buttons *Review 4 rows* (dark) + *Template*.
- **What the client sees** — dark card containing a masked-card mock: `TV-####`, "6.3y · Pune",
  score em-dash + `PENDING TEST`, two skill chips, and "Name · photo · Nimbus Softworks / Rate shown
  to client is set by Talentvibes".

### 8. Vendor · Bench roster (`/vendor/roster`)

Header: "42 resources · 27 listed on the exchange · confirm availability every 14 days to stay in
matching"; actions *Export CSV* + **Confirm all expiring · {n}**. Filter pills: **All 42** (dark) ·
Listed 27 · Idle 9 · **Expiring 7** (amber) · **Unconfirmed 3** (red); right, mono "Freshness
recalculated nightly · 02:00 IST".

Table, sticky header, columns `170px 1fr 66px 118px 128px 176px 122px` = RESOURCE (own name + masked
ID · city) / SKILLS / EXP / **YOUR RATE** / ASSESSMENT / **AVAILABILITY FRESHNESS** / CONFIRM.

- Assessment cell: dot + label (`Scored 88` green / `In progress` `#c2410c` / `Not started` `#9aa0ab`)
  + sub ("proctored, valid 90 days" / "started 2 days ago" / "invite not sent").
- Freshness cell: state pill + "{n}d ago" + a 4px decay bar whose width is
  `max(6%, (1 − min(days,28)/28) × 100%)` in the state colour. States: **CONFIRMED**
  `#e8f6ef`/`#0f7a4a`, **EXPIRING SOON** `#fff3e4`/`#b45309` (≥ 10 days), **UNCONFIRMED**
  `#fdecec`/`#b91c1c` (≥ 14 days).
- Confirm cell: green **Still available** button; after clicking it becomes a disabled-looking
  `Confirmed ✓` (`#f3f3f7` / `#8a8a96`), freshness flips to CONFIRMED / "just now" and the bar refills.
  *Confirm all expiring* does this for every row.

Rows: Arjun Rathore TV-4821 Bangalore (React, TypeScript, Node.js) 6.2y ₹1,38,000 Scored 88
confirmed 2d · Meghna Iyer TV-6620 Jaipur 5.4y ₹1,12,000 Scored 91 confirmed 1d · Rohit Deshmukh
TV-5107 Pune 8.0y ₹1,84,000 Scored 82 expiring 12d · Ishita Bansal TV-7702 Pune 6.3y ₹1,45,000
Not started expiring 13d · Sanjay Pillai TV-7715 Bangalore 7.1y ₹1,46,000 In progress confirmed 3d ·
Neha Chaudhary TV-6104 Hyderabad 4.8y ₹98,000 Scored 74 unconfirmed 21d · Farhan Qureshi TV-5990
Bangalore 9.4y ₹2,15,000 Scored 79 unconfirmed 26d · Divya Ranganathan TV-6833 Pune 3.9y ₹92,000
Scored 85 expiring 11d · Karthik Nair TV-7188 Jaipur 5.1y ₹1,05,000 Not started confirmed 4d.
Footer: "Showing 9 of 42 · **Load more**".

### 9. Vendor · Assessments (`/vendor/assessments`)

Header sub: "Proctored by Talentvibes. Scores are visible to you and to clients — you cannot edit
them." Action *Invite 9 to test*. Cards `repeat(3,1fr); gap:12px`: name + `masked ID · track`, status
pill (**SCORED** green / **IN PROGRESS** amber / **NOT STARTED** grey), big score `30px/800` (em-dash
when none) with mono caption (`PROCTORED · 12 AUG`, `SECTION 2 OF 4`, `INVITE NOT SENT`,
`INVITE SENT 20 AUG`), four unlabelled-value breakdown bars, footer note + accent text action
(*View report* / *Nudge candidate* / *Send invite* / *Resend invite*).

Data: Meghna Iyer TV-6620 QA Automation **91** (93/88/86/92) valid until 10 Nov · Arjun Rathore
TV-4821 Frontend/React **88** (91/84/82/90) valid until 07 Nov · Rohit Deshmukh TV-5107 Java backend
**82** (84/78/88/76) retake after 60d · Sanjay Pillai TV-7715 React Native in progress (100/62/0/0)
started 22 Aug 14:10 · Ishita Bansal TV-7702 Java backend not started, listed 3 days ago · Karthik
Nair TV-7188 QA Automation not started, expires in 4 days.

### 10. Vendor · Earnings (`/vendor/earnings`) — own rate only

Header sub: "Your contracted rate per placement. Talentvibes contracts separately with the client."
Actions *Download statement* + *Raise invoice*.

Metric cards: Billed this month **₹7.42L** (+₹1.26L, 5 active placements) · YTD earnings **₹58.6L**
(18 placements since Jan) · Avg rate/resource **₹1.48L** (+4%, your contracted rate) · Payment cycle
**7th** (on time, net 30 · last 12 cycles clear).

Table `168px 1fr 96px 120px 120px 130px` = RESOURCE / ROLE / SINCE / **YOUR RATE/MO** / THIS MONTH /
STATUS. Priyanka Joshi TV-3310 Java Spring Boot Engineer 3 Mar ₹1,62,000 / ₹1,62,000 BILLED ·
Nikhil Sharma TV-2984 .NET Core Engineer 12 Apr ₹1,18,000 BILLED · Aditi Verma TV-4102 QA Automation
2 Jun ₹1,04,000 **ENDS 30 SEP** · Rahul Krishnan TV-3877 Salesforce Developer 19 May ₹96,000 BILLED ·
Farhan Qureshi TV-4455 SAP ABAP Consultant 1 Aug ₹2,15,000 / ₹1,62,000 **PRO-RATA** (blue).
Summary bar: "5 active placements · 1 ending 30 Sep" and `TOTAL DUE ₹7,42,000` (`20px/800` mono).
Closing note: "Talentvibes is the contracting party for every placement. Client identity, client rate
and margin are not shared with suppliers — this keeps the exchange neutral for both sides."

**No client rate, client name or margin may appear anywhere in this portal.**

### 11. Ops · Requirement pipeline (`/ops/pipeline`)

**Purpose** — the brokering desk's work queue. Must stay usable at hundreds of requirements.

Header: title, sub "24 live requirements · 5 clients · 14 supplier benches · 1 SLA breach · drag a
card between columns or use ← →" (all counts derived from data, never hardcoded); Board/List segmented
control (`#f1f1f4` track, white active pill); primary *Open matching workspace*.

Filter bar (all functional): search input (matches REQ id, role, client, owner, skills) · toggle
**My desk · P. Nair** · toggle **SLA at risk** (slaKind warn|late) · toggle **Needs sourcing**
(`sourced === 0`) · *Clear filters* (only when a filter is active) · right, mono "{n} of {total}
requirements shown". Active toggle = `#fff3e4` / `#b45309` / border `#f0dcc0`.

Toast (below the header, full width): `#101014`, green dot, "{REQ} · {role} moved to {stage}",
**Undo** in `#fbbf24`, *Dismiss* right.

**Board**: five columns, `flex:1; gap:11px`, each `background:#f2f2f5; border:1px solid #eaeaef;
radius 12px`, `display:flex; flex-direction:column` with its **own scroll area**
(`flex:1; min-height:0; overflow:auto`) — the page itself never scrolls. Column header: 7px stage
square, mono title, count chip (white, `1px #e8e8ee`, radius 20). Under it a WIP line: normally
"{n} requirements" `#9a9aa6`, but "WIP {n} · over the limit of 6, scroll for the rest" in `#b45309`
when a column exceeds 6. Empty column shows a dashed "Drop a requirement here" target.

Stages / colours: NEW `#9aa0ab` · MATCHING `#b45309` · SHORTLISTED `#6d3ff0` · INTERVIEWING `#1d4ed8`
· PLACED `#0f7a4a`. Pill tints: `#f3f3f7`/`#4a4a58`, `#fff3e4`/`#b45309`, `#f1ecff`/`#6d3ff0`,
`#e8eefc`/`#1d4ed8`, `#e8f6ef`/`#0f7a4a`.

Card: `draggable`, `cursor:grab`, `opacity .5` while dragged, border `#b45309` when dragged /
`#f0c9c9` when SLA late / `#d9c9ff` when it is the selected requirement / else `#e8e8ee`.
Content: REQ id (click → matching) + age · role (click → matching) · `{client} · ×{qty} · {owner}` ·
skill chips · value + SLA dot & label · action row **← | {stage action} | →**, where the middle label
is Source / Match / Review / Track / Margin by stage and arrows are `#dcdce4` when at either end.

**List view**: one scrolling table, sticky header, columns
`98px 1fr 132px 52px 104px 92px 158px 120px 92px` = REQ / ROLE (+ mono sub "skills · band ·
location") / CLIENT / QTY / VALUE/MO / OWNER / **STAGE · MOVE** (← pill →) / SLA / ACTION. Rows are
grouped in stage order; late rows get `background:#fffbfb`. Footer repeats the result count and
explains the view.

SLA colours: ok `#0f7a4a`, warn `#b45309`, late `#b91c1c`, idle `#8a8a96`.

**Seed data — 24 requirements.** `id, role, client, qty, skills, value/mo, age, owner, stage, SLA,
slaKind, budget, start, band, location, candidate pool, client note, sourced count`:

```
REQ-2291 Senior React Engineers        Acme Finserv      x3 React,TypeScript      4.8L 4d  P. Nair  shortlisted  Send by 16:00  warn 1.30-1.70L 15 Sep 5-8y  Bangalore/hybrid A 6
REQ-2274 SAP ABAP Consultant           Acme Finserv      x1 SAP ABAP,Fiori        2.6L 2d  P. Nair  matching     SLA 4h         warn 2.00-2.60L 1 Oct  8y+   Pune/onsite     D 5
REQ-2288 Node.js Engineers             Kestrel Logistics x3 Node.js,AWS           4.1L 1d  R. Verma matching     SLA 11h        ok   1.20-1.55L 22 Sep 4-7y  Remote          B 5
REQ-2295 QA Automation Engineers       Northwind Retail  x2 Playwright,API        2.2L 1d  P. Nair  matching     Overdue 2h     late 1.00-1.25L 8 Sep  4-7y  Hyderabad/hybrid C 5
REQ-2312 Salesforce Developers         Northwind Retail  x2 Apex,LWC              2.4L 1h  S. Iyer  new          SLA 23h        ok   1.00-1.30L 1 Oct  3-5y  Remote          D 0
REQ-2309 SAP ABAP Consultant           Meridian Pharma   x1 SAP ABAP,HANA         2.6L 4h  P. Nair  new          SLA 20h        ok   2.10-2.70L 15 Oct 8y+   Pune/onsite     D 0
REQ-2307 Data Engineers                Acme Finserv      x2 Spark,Airflow         3.2L 6h  R. Verma new          SLA 18h        ok   1.45-1.80L 1 Oct  5-8y  Bangalore/hybrid B 0
REQ-2305 React Native Developer        Vantage Insurance x1 React Native          1.6L 8h  S. Iyer  new          SLA 16h        ok   1.30-1.60L 29 Sep 5-8y  Remote          A 0
REQ-2302 QA Lead                       Kestrel Logistics x1 QA Strategy,Selenium  1.8L 12h P. Nair  new          SLA 12h        warn 1.55-1.85L 6 Oct  8y+   Pune/hybrid     C 0
REQ-2298 Java Spring Boot Engineers    Meridian Pharma   x2 Spring Boot,Kafka     3.4L 2d  R. Verma matching     SLA 9h         ok   1.55-1.85L 22 Sep 5-8y  Hyderabad/hybrid B 5
REQ-2293 .NET Core Developers          Vantage Insurance x2 .NET Core,Azure       2.4L 3d  S. Iyer  matching     SLA 7h         warn 1.05-1.30L 15 Sep 3-5y  Remote          D 5
REQ-2290 Salesforce Admin              Acme Finserv      x1 Salesforce,Flows      1.1L 5d  S. Iyer  matching     SLA 14h        ok   0.95-1.15L 1 Oct  3-5y  Remote          D 4
REQ-2249 Node.js Platform Engineer     Acme Finserv      x1 Node.js,Kafka         1.7L 6d  P. Nair  shortlisted  Awaiting client idle 1.45-1.75L 8 Sep  5-8y  Bangalore/hybrid B 6
REQ-2266 .NET Core Developers          Vantage Insurance x2 .NET Core,Azure       2.4L 5d  S. Iyer  shortlisted  Awaiting client idle 1.10-1.35L 15 Sep 3-5y  Remote          D 5
REQ-2258 QA Automation Engineer        Northwind Retail  x1 Playwright            1.2L 7d  P. Nair  shortlisted  Feedback due   warn 1.05-1.25L 1 Sep  4-7y  Remote          C 5
REQ-2260 QA Automation Engineers       Acme Finserv      x2 Selenium,CI/CD        2.5L 9d  P. Nair  interviewing R2 on 26 Aug   ok   1.00-1.30L 1 Sep  4-7y  Hyderabad/hybrid C 5
REQ-2231 Java Spring Boot Engineers    Kestrel Logistics x2 Spring Boot,Kafka     3.6L 12d R. Verma interviewing Feedback due   warn 1.60-1.90L 1 Sep  5-8y  Pune/hybrid     B 5
REQ-2224 React Engineer                Northwind Retail  x1 React,Next.js        1.5L 14d S. Iyer  interviewing Offer stage    ok   1.25-1.55L 1 Sep  5-8y  Remote          A 6
REQ-2219 SAP ABAP Consultant           Meridian Pharma   x1 SAP ABAP              2.7L 16d P. Nair  interviewing R1 on 27 Aug   ok   2.20-2.80L 15 Sep 8y+   Pune/onsite     D 5
REQ-2211 Data Engineer                 Acme Finserv      x1 Spark,Airflow         1.7L 18d R. Verma interviewing R2 on 28 Aug   ok   1.50-1.80L 8 Sep  5-8y  Bangalore/hybrid B 5
REQ-2205 SAP ABAP Consultant           Acme Finserv      x1 SAP ABAP              2.9L 22d P. Nair  placed       Margin 14.2%   warn 2.20-2.90L 1 Aug  8y+   Bangalore/onsite D 5
REQ-2198 Salesforce Developer          Vantage Insurance x1 Apex,LWC              1.3L 28d S. Iyer  placed       Margin 24.1%   ok   1.05-1.35L 19 May 3-5y  Remote          D 4
REQ-2187 .NET Core Developer           Northwind Retail  x1 .NET Core             1.4L 34d S. Iyer  placed       Margin 21.6%   ok   1.15-1.45L 12 Apr 3-5y  Remote          D 4
REQ-2176 Java Spring Boot Engineer     Acme Finserv      x1 Spring Boot           2.2L 41d R. Verma placed       Margin 25.7%   ok   1.85-2.20L 3 Mar  5-8y  Pune/hybrid     B 5
```

Client notes (shown in the matching panel) are per requirement — e.g. REQ-2291: "Prefer someone who
has shipped a design system. Budget can stretch 10% for the right person."; REQ-2295: "The suite is
Playwright on GitHub Actions — we want someone who has run it in CI."; REQ-2231: "Panel feedback for
two candidates is 3 days late — escalate to the account lead."

### 12. Ops · Matching workspace (`/ops/matching/:reqId`)

**Purpose** — build and override the ranked shortlist for one requirement, then send it masked.

Header: stage pill + `{client} · posted {age} ago · {owner}` · title "Matching workspace" · a
**requirement picker** button (`REQ-2291 ▾`: mono id + truncated role + caret; open state
`background:#fff8ef`, border `#f0dcc0`) · pool note "{n} candidates sourced from {m} benches" (or
"no candidates sourced yet — matching starts here") · actions *Reset to algorithm* and primary
**Send masked shortlist · {includedCount}**.

**Requirement picker dropdown** — absolutely positioned panel (`width:430px`, radius 12,
`box-shadow:0 16px 40px rgba(16,16,20,.16)`), header `SELECT A REQUIREMENT · {n} ON YOUR DESK`,
scrollable rows (`max-height:330px`) of `REQ id | role + "{client} · ×{qty} · {owner}" | stage pill |
SLA`, selected row tinted `#fff8ef`; footer "Only requirements in Matching, Shortlisted or New appear
here." Selecting a row swaps the whole workspace (facts, weighting, candidate pool, overrides).

**Left panel** (`width:320px`, white, scrolls): `REQUIREMENT` label, role title, "{client} · {n}
positions · owner {owner}", then facts — Positions, Experience, Location, Start, **Client budget**
(amber), Value, **Target margin ≥ 22%** (green), **SLA** (SLA colour). Then `WEIGHTING` bars: Skill
match 30%, Proctored score 22%, Experience fit 16%, Rate vs budget 14%, Availability freshness 10%,
Vendor reliability 8%. Then the client-note panel (amber) and, where flagged, a red panel
"**2 duplicate flags** touch this pool. *Resolve before sending*" linking to Duplicates.

**Right panel** (`background:#f7f7f9`): toolbar "Ranked candidates · {n}" + override note
("· algorithm ranking" or "· manual override active, algorithm ranking saved") + right hint
"Drag a row or use ▲▼ to reorder · client sees this order". Then candidate rows (`gap:10px`):

- 34px rank block: position numeral `19px/800`, mono `RANK`, ▲▼ buttons.
- 186px identity block (**unmasked**): masked ID + `IN SHORTLIST` / `HELD BACK` pill, real name,
  vendor, `{exp} · {rate}/mo`.
- Flexible reason block: match score `20px/800` in `#b45309` + mono `MATCH SCORE` + one-line reason.
  Below, six bars in `repeat(6,1fr)` — **SKILL, TEST, EXP FIT, RATE, FRESH, VENDOR** — each with its
  value; bar colour `#b45309` ≥ 80, `#d9a066` ≥ 60, else `#e0b3b3`.
- 96px actions: **Include / Included** (dark → accent when included) and **Profile / Hide**.
- Expanded profile (Profile toggle): four-column detail grid — CITY, NOTICE, PROCTORED, FRESHNESS,
  VENDOR RELIABILITY, VENDOR RATE, PROPOSED CLIENT RATE, **MARGIN AT THAT RATE** (red below 18%) —
  plus a full-width note (last project / risk).

Reorder: HTML5 drag between rows, or ▲▼. Include toggles drive the *Send · n* count. Sending moves
the requirement to **shortlisted**, returns to the pipeline and raises a toast. *Reset to algorithm*
clears both the order and the include set for that requirement.

**Candidate pools** — pool A (React), B (Java/Node), C (QA), D (Enterprise); each candidate carries
`id, name, vendor, exp, vendor rate, match score, reason line, six reason values, city, notice,
proctored score + date, freshness, vendor reliability, proposed client rate, margin, last-project
note`. Pool A, in algorithm order:

```
TV-4821 Arjun Rathore     Nimbus Softworks     6.2y ₹1.38L  94  96/88/92/90/100/95  Bangalore  Immediate  88 · 09 Aug  Confirmed 2d   4.6/5  ₹1.82L  24.2%
TV-6620 Meghna Iyer       Sparkbridge Systems  5.4y ₹1.12L  89  74/91/88/100/100/88 Jaipur     Immediate  91 · 12 Aug  Confirmed 1d   4.2/5  ₹1.44L  22.2%
TV-7715 Sanjay Pillai     Nimbus Softworks     7.1y ₹1.46L  86  92/82/95/78/84/95   Bangalore  15 days    84 · 18 Aug  Confirmed 3d   4.6/5  ₹1.94L  24.7%
TV-7024 Deepak Chandran   Helix Systems        5.9y ₹1.29L  81  88/79/80/92/58/78   Hyderabad  30 days    81 · 06 Aug  Expiring 11d   3.9/5  ₹1.68L  23.2%
TV-6612 Ritika Agarwal    Trueline Consulting  5.2y ₹1.21L  77  82/76/72/95/88/62   Pune       Immediate  79 · 14 Aug  Confirmed 5d   3.4/5  ₹1.58L  23.4%
TV-5107 Rohit Deshmukh    Cygnet Infotech Labs 8.0y ₹1.84L  68  52/82/88/40/90/76   Pune       15 Sep     82 · 04 Aug  Expiring 12d   4.1/5  ₹2.36L  22.0%
```

Pools B, C and D follow the same shape (see the prototype's `POOLS`), including deliberate edge
cases: an unstarted test (TV-7702), an expired score (TV-6488), a low-reliability vendor
(TV-5981 / TV-3964, Orbit Talent Services), and a duplicate-flagged pair (TV-3964 vs TV-6104).

### 13. Ops · Talent pool (`/ops/pool`) — unmasked

Header: "1,284 profiles across 14 supplier benches · unmasked · 892 with valid proctored scores";
actions *Save this view* + *Add to REQ-2291*. Filter chip row: active chips (with `×`) Skill: React,
Exp: 5–8y, Score ≥ 75, Freshness: confirmed; inactive City: any, Vendor: any, Vendor rate ≤ ₹1.6L;
`+ Add filter`; right, mono "62 results · 0.18s".

Table columns `158px 148px 1fr 58px 74px 108px 108px 96px 126px` = NAME (+ masked ID) / SUPPLIER
(+ "rel 4.6" with a reliability dot) / SKILLS / EXP / SCORE (green ≥ 85, amber ≥ 78, grey below) /
**VENDOR RATE** / **CLIENT RATE** / CITY / FRESHNESS pill. Eight rows shown (Arjun Rathore, Sanjay
Pillai, Meghna Iyer, Deepak Chandran, Ritika Agarwal, Rohit Deshmukh, Nikhil Sharma, Suresh Balan),
footer "Showing 8 of 62 matching profiles · **Load more**".

### 14. Ops · Margin (`/ops/margin`)

Header sub: "Vendor rate, client rate and spread on every live placement · visible to Talentvibes
only"; actions *August 2026* + *Export to finance*.

Metric cards: Gross spread · Aug **₹2.84L** (+12%) · Average margin **24.5%** (target 22%, median
25.1% · floor 18%) · **Below floor 2** (amber card `#fffaf2` / `#f5e3c8`, "TV-4488 at 14.2%, TV-3964
at 17.4%") · Run-rate · annual **₹3.4Cr** (dark card, "31 live placements exchange-wide").

Table `150px 130px 1fr 118px 118px 118px 86px` = RESOURCE (+ masked ID · vendor) / CLIENT / ROLE /
VENDOR RATE / CLIENT RATE / SPREAD / MARGIN pill (green ≥ 22%, amber 18–22%, red < 18%), all numeric
columns right-aligned mono:

```
Arjun Rathore   TV-4821 Nimbus         Acme Finserv     Senior React Engineer      1,38,000  1,82,000  44,000  24.2%
Meghna Iyer     TV-6620 Sparkbridge    Acme Finserv     QA Automation Engineer     1,12,000  1,44,000  32,000  22.2%
Priyanka Joshi  TV-3310 Nimbus         Acme Finserv     Java Spring Boot Engineer  1,62,000  2,18,000  56,000  25.7%
Rahul Krishnan  TV-3877 Trueline       Northwind Retail Salesforce Developer         96,000  1,31,000  35,000  26.7%
Nikhil Sharma   TV-3964 Orbit Talent   Northwind Retail .NET Core Developer          98,000  1,18,600  20,600  17.4%
Suresh Balan    TV-4488 Vertex Digital Acme Finserv     SAP ABAP Consultant        2,15,000  2,50,600  35,600  14.2%
```

Summary bar: "6 of 31 live placements · filtered to Acme Finserv & Northwind Retail" and
`VENDOR ₹8,74,000 · CLIENT ₹11,58,000 · SPREAD ₹2,84,000` (spread `17px` green). Guardrail note
(amber): "**Guardrail:** two placements sit below the 18% floor. TV-4488 (Vertex Digital) was approved
at 14.2% as a strategic entry into Acme's SAP programme — review at renewal on 1 Oct."

### 15. Ops · Duplicate candidates (`/ops/duplicates`)

**Purpose** — catch the same person submitted by two suppliers before a shortlist goes out.

Header sub: "Same person submitted by two suppliers · resolve before a shortlist goes out"; actions
*Detection rules* + *2 open flags*.

**DUP-0148 card** (`border:1px solid #f0c9c9`): red banner (`#fdecec`, `border-bottom:1px solid
#f6cfcf`) — "Likely the same person · 96% confidence", "Flagged 22 Aug, 09:12 · blocks REQ-2291
shortlist", mono `DUP-0148` right. Body `grid-template-columns:1fr 200px 1fr`:

- **Submission A · EARLIER** (green pill, `12 AUG 09:41`) — Arjun Rathore, TV-4821, submitted by
  **Nimbus Softworks**. Facts: PAN hash …7f21c9 (red), Phone hash …4b8e (red), Experience 6.2 years,
  Last employer Zeta Commerce (2021–24) (red), Proctored score 88 · 09 Aug (green), Vendor rate
  ₹1,38,000, Freshness Confirmed 2d (green), Vendor reliability 4.6 / 5 · 34 placements (green).
  Buttons *Keep this one* (dark) + *Contact vendor*.
- **Match signals** (centre, `#fafafc`): PAN hash identical / exact match · Phone hash identical /
  exact match · Employer history / 3 of 3 overlap (all red tiles) · GitHub handle / same, on both CVs ·
  Experience stated / 6.2y vs 6.5y (amber) · Rate differs / ₹14,000 apart (neutral).
- **Submission B · LATER** (amber pill, `18 AUG 16:07`) — A. Rathore, TV-7188-B, submitted by
  **Orbit Talent Services**. Same hashes and employer, Experience 6.5 years, Proctored score Not
  started, Vendor rate ₹1,52,000, Freshness Unconfirmed 6d (amber), reliability 3.1 / 5 · 9
  placements (amber). *Keep this one* is the muted variant.

Resolution bar: "Recommended: keep the **Nimbus Softworks** submission — earlier by 6 days, confirmed
availability, reliability 4.6 vs 3.1. Notify Orbit Talent Services that the profile is already
represented; neither client nor candidate is told." Buttons **Keep Nimbus · reject Orbit** (dark) and
*Not a duplicate*.

**DUP-0147** secondary row (amber dot, 71%): "Kavya Menon (Trueline Consulting) vs K. M. Nair (Vertex
Digital) — matching phone hash and overlapping Salesforce project history, different PAN. Needs a
human call.", *assigned to R. Verma*, *Open*.

---

## Interactions & behaviour

Implemented in the prototype (all of it should exist in the real app, backed by APIs):

| Interaction | Where | Behaviour |
|---|---|---|
| Portal switch | Sidebar (demo only) | Swaps shell, accent, nav and default screen. Production: auth-scoped. |
| Nav / screen change | Sidebar, in-screen CTAs | Should be routes. Counts in nav are live, derived from data. |
| Candidate select | Client shortlist | Toggles per-candidate; drives the *Request interviews · n* count and the card's border/CTA. |
| Ask Talentvibes | Client, 5 entry points | Opens the broker drawer; the **?** on a card scopes the thread to that candidate. |
| Send message | Broker drawer | Appends the message, shows "Priya is typing…", appends a reply after 1400 ms, auto-scrolls (`el.scrollTop = el.scrollHeight`). Quick chips send canned questions. |
| Confirm availability | Vendor roster | Per-row and bulk. Flips freshness to CONFIRMED / "just now", refills the decay bar, disables the button. |
| Stage move | Ops board + list | Drag card to a column, or ← →. Emits a toast with **Undo**. Arrows clamp at both ends. |
| Search / filters | Ops pipeline | Live filtering across id, role, client, owner, skills + My desk / SLA at risk / Needs sourcing; result count and column counts follow. |
| Board ↔ List | Ops pipeline | List is the high-volume view; same actions inline. |
| Requirement picker | Ops matching | Selects which requirement the workspace is matching; swaps facts and candidate pool. |
| Rank override | Ops matching | HTML5 drag between rows or ▲▼; sets a per-requirement override flag shown in the toolbar. |
| Include / hold back | Ops matching | Per-requirement include set; drives *Send masked shortlist · n*. |
| Profile expand | Ops matching | Inline unmasked detail grid incl. margin at the proposed rate. |
| Send masked shortlist | Ops matching | Moves the requirement to Shortlisted, returns to the pipeline, toasts. |
| Reset to algorithm | Ops matching | Clears order + include overrides for that requirement. |

Not built (intentional): `⌘K` palette, real file upload, date pickers, pagination beyond "Load more",
auth, and responsive/mobile layouts — the design targets desktop ≥ 1280px (built at 1440×900).

Motion is deliberately minimal: no page transitions; only the typing delay and hover/opacity changes.
Drag uses `opacity:.5` on the source and an accent border. If the codebase has a motion system, keep
it at that level of restraint.

## State

Per portal/screen state in the prototype (map to server data + local UI state):

- `portal`, `screen` → routing.
- Client: `picked[]` (selected candidate ids), `askOpen`, `askCtx`, `askDraft`, `askTyping`,
  `askThread[]`.
- Vendor: `confirmed[]` (ids confirmed this session; server-side this is a `lastConfirmedAt`
  timestamp per resource, with freshness derived from it).
- Ops: `view` (board|list), `q`, `desk`, `risk`, `unsourced`, `stageOv{reqId→stage}`,
  `toast{msg,id,prev}`, `selectedReq`, `pickerOpen`, `rankByReq{reqId→[candidateId]}`,
  `inByReq{reqId→[candidateId]}`, `openCand`, `drag`.

Derived, never stored: column counts, result counts, nav badges, freshness state and bar width,
match-score bar colours, margin colour thresholds.

Data the API needs to supply: requirements (with stage, SLA, owner, budget, client note),
candidates/bench resources (with masked id, real identity, vendor, rate, proctored score + breakdown,
freshness timestamp, vendor reliability), matches (score + six reason components), placements
(vendor rate, client rate, spread), duplicate flags (confidence + signal list), broker threads.

**Enforce masking on the server, not in the client.** Each portal's endpoints should return only the
fields that portal is allowed to see — a client-side filter would leak names, vendors and margins.

## Design tokens

**Colour — neutrals**

```
#101014 text / dark fill      #26262e  message text
#111114 sidebar               #1c1917  ops internal band
#1e1e26 sidebar active        #26262c  sidebar border
#4a4a58 body secondary        #6b6b78  muted body
#8a8a96 labels                #9a9aa6  faint labels
#a0a0ac sidebar inactive      #6c6c78  sidebar faint
#e8e8ee card border           #eeeef3  inner divider
#f2f2f6 table row divider     #fafafc  table header bg
#f3f3f7 chip bg               #f7f7f9  app bg
#f2f2f5 kanban column bg      #fff     surface
```

**Colour — accents & semantics**

```
client   #6d3ff0  tint #f1ecff   nav #a78bfa   deep #5a2fd0 / #3d1f8f
vendor   #059669  tint #ecfdf5   nav #34d399   deep #065f46
ops      #b45309  tint #fff3e4   nav #fbbf24   panel #fffaf2 border #f5e3c8
success  #16a34a / #0f7a4a / #127a4a   tint #e8f6ef / #e9f7ee
warning  #c2410c / #b45309             tint #fdf0e7 / #fff3e4 / #fff8ec border #f7e2bd
danger   #b91c1c                       tint #fdecec  border #f6cfcf
info     #1d4ed8                       tint #e8eefc
stages   new #9aa0ab · matching #b45309 · shortlisted #6d3ff0 · interviewing #1d4ed8 · placed #0f7a4a
bars     #b45309 ≥80 · #d9a066 ≥60 · #e0b3b3 <60   track #eeeef3
```

**Typography** — Manrope (400/500/600/700/800) for UI; JetBrains Mono (400/500/600/700) for IDs,
labels, counts and money. Both from Google Fonts.

```
Screen title      22px / 800 / -.6px
Panel title       17px / 800 / -.5px
Section title  13.5px / 800
Metric value      28px / 800 / -1px      (26px in dense rows, 30-34px in hero cards)
Body           12.5px / 400-600
Small             12px / 400-600
Caption         11-11.5px / 400-600
Micro          10.5px / 600-700
Mono label       9-10px / 600-700 / letter-spacing .08-.14em / UPPERCASE
Mono value    11-15px / 600-700
```

**Spacing** — 2 / 3 / 4 / 5 / 6 / 7 / 8 / 9 / 10 / 11 / 12 / 13 / 14 / 16 / 18 / 20 / 22 / 26 px.
Screen padding `20px 26px` (dense screens `14px 26px`); card padding 13–20px; grid gaps 10–18px.

**Radius** — 2 (stage square) · 3 (bar) · 5 (chip / keycap) · 6 (small chip) · 7 (nav item, small
button) · 8 (button) · 9 (input, inner panel) · 11–12 (card) · 14 (large card) · 20 (pill) · 50%
(avatar / dot).

**Shadow** — card `0 1px 3px rgba(0,0,0,.06)` / `0 1px 2px rgba(16,16,20,.04)`; drawer
`-18px 0 48px rgba(16,16,20,.14)`; dropdown `0 16px 40px rgba(16,16,20,.16)`.

**Bars & dots** — status dot 5–7px; progress bar 2/4/5/6/7px on `#eeeef3`; decay bar 4px.

## Assets

None. No images, no icon set, no logos. Every graphic element is CSS: gradient brand square, status
dots, progress bars, monogram avatars, dashed dropzones. Where a real product would show an avatar,
the prototype uses a flat `#f3f3f7` / `#3b3b45` circle or a mono monogram chip — **never on
client-facing masked cards**. If the target codebase has an icon library, icons may be added to nav
and buttons; the design does not depend on them.

Currency is written `₹1,38,000` for exact amounts and `₹1.38L` / `₹2.84L` / `₹3.4Cr` in compact
contexts (Indian lakh/crore). Keep both conventions.

## Files

- `Talentvibes Bench Exchange.dc.html` — the full three-portal prototype (all 15 screens; markup at
  the top, data + handlers in the `class Component` block at the bottom).
- `Bench Exchange Directions.dc.html` — the five explored visual directions for the hero screen.
  Direction **1b "Signal"** was chosen and is what the prototype implements; the other four are
  context for why (rejected: a table-dense ledger, a warm editorial broker's desk, a dark mono
  console, an editorial dossier layout).
