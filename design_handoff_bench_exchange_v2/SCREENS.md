# Screens

Every screen uses the shell from README.md: a page header with the H1, a one-line explainer and actions on the right (wrapping when narrow), then a scrolling content area. All copy below is final. Sample data is in the logic class of `prototype/source/*.dc.html`.

---

# CLIENT PORTAL. Company: **Acme Finserv**, user **Ananya Krishnan, Talent Acquisition Lead**

## C1 · Overview (`dash`)
- **Header:** "Good morning, Ananya" · "Everything happening on your open roles, in one place." · [Message Talentvibes] (secondary) and [Post a new role] (primary).
- **Explainer card** (dismissible with "Got it", re-opened by the top-bar ?): brand-tint background, brand-tint-2 border, radius 14. Title "How Talentvibes works", then: *"You post a role. We search 14 partner companies' available engineers and send you anonymous, test-verified profiles. You pick who to interview and we arrange everything. You never deal with the supplier — we sit in the middle on both sides."*
- **4 stat cards** (auto-fit, min 198px). Each has a label, a big value, a delta pill and a sub-line:
  - Open roles **4**, "+1" (ok), "9 people needed in total"
  - Shortlists waiting **3**, "2 new" (brand), "17 anonymous profiles"
  - In interview **4**, "2 due" (warn), "feedback forms to complete"
  - People working **5**, "₹8.4L/mo" (neutral), "average 4.2 months so far"
- **Row (flex-wrap 3:2):**
  - **"Your open roles"** card, with "View all roles" on the right (goes to C2). Each row is **stacked**, not a grid:
    - Left: role name (14.5/700), meta line (12.5, t3), then "**3** needed · ₹1.30–1.70L / month".
    - Right: stage pill, with the action link "Review 6 →" beneath it.
    - Stages: Shortlist ready (brand) · We're searching (warn) · Interviewing (ok) · Just posted (neutral).
  - **Side column:**
    - "Waiting for you" card: a "3 shortlists" pill and 3 tiles (role, age, "**6** anonymous profiles | avg test score **83.5**"). Clicking a tile goes to C4.
    - "People working now" card: 4 rows, each with a TV tile, role, "TV-#### · since 3 Mar" and a status dot + label.

## C2 · Open roles (`roles`)
- **Header:** "Open roles" · "Every role you have with us and exactly where it stands. Nothing here needs chasing — we'll come to you." · [Post a new role].
- **One card per role** (radius 16, padding 20):
  - Title (18/700) and stage pill. Meta: "3 people · 5–8 yrs · Bangalore or hybrid". A row with budget, start date and mono "REQ-2291 · Posted 18 Aug".
  - A dark action button on the right that changes by stage: "Review the 6 profiles" / "Open interviews" / "Ask Priya for an update" (opens the drawer) / "See what you asked for".
  - **5-step progress track:** Posted → We search → You review → Interviews → Placed.
    - Each step is a 14px dot with a 2.5px border plus a connecting bar. Done = filled brand. Current = brand border with an empty centre and a bold label. Future = border-2, t4 label.
  - A status box on `--surface-2`, e.g. "6 anonymous profiles waiting · average test score 83.5".
- **Footer prompt** (dashed border): "Need something else? Post a role and you'll have your first anonymous profiles within about 36 hours." · [Post a role].

## C3 · Post a new role (`post`)
- **Header:** "Post a new role" · "Tell us what you need. We search 14 partner benches and come back with anonymous profiles — usually within 36 hours." · "Draft saved 2 min ago". Below that, a 4-step indicator (Skills · Seniority · Budget · Logistics) with 26px numbered circles.
- **Form card** (flex 3, padding 22), with sections separated by 1px dividers and 22px margins:
  1. **What skills do you need?** A tag input:
     - Chips can be removed by clicking. Typing and pressing Enter adds a skill. Backspace on an empty input removes the last chip.
     - The box border turns amber when there are no skills.
     - "Often added with these:" shows up to 3 suggestion pills ("+ GraphQL") that add on click.
  2. **How many, and how senior?** Experience segments (0–3 / 3–5 / 5–8 / 8+ yrs; the selected one is dark) and a quantity stepper (1–20).
  3. **What's your budget?** "Per person, per month. We'll tell you straight away if it's realistic."
     - A range bar with two thumbs (₹60,000–₹3,00,000) and two steppers in ₹10,000 steps: "Lowest you'll pay" and "Most you'll pay".
     - A live info box. Blue when 30 or more matches ("42 available engineers match this range."); amber when fewer ("Only 18…" or "That's a very thin pool — 6 engineers.").
  4. **Contract and start date**
     - Engagement type: Contract / Contract to hire / Full-time.
     - Duration: text input.
     - Where: text input, plus mode pills Onsite / Hybrid · 3 days / Remote.
     - Start date field.
     - Notice period accepted: multi-select of Immediate / Up to 30 days / 60 days.
  - **Footer:** [Send to Talentvibes] (primary) goes to C4 with the toast "Role sent to Talentvibes — we'll come back within 36 hours." Also [Save as draft] and "First shortlist usually arrives in **36 hours**".
- **Side column:**
  - **"Who's available right now"**: a big live number (42px), "engineers match your requirements", and 4 bars (right skills / within budget / scored 80+ / can start on time).
  - An amber tip: "raising your lower limit to ₹1.40L would add N more engineers who scored above 85…"
  - **"What happens next"**: a 4-step vertical timeline (You post, we search → You get anonymous profiles → We arrange the interviews → One contract, one invoice).
- **Match-count formula (demo only):** `max(3, round((hi-lo)/10000 × 23.6 × expFactor / max(1, skills×0.75)))`, where expFactor is {0–3:1.35, 3–5:1.15, 5–8:1, 8+:0.55}. The real app calls the matching API.

## C4 · Candidate shortlists (`shortlist`): **HERO SCREEN**
- **Header:** a pill "Ready for your review", "Sent to you 22 Aug · REQ-2291", H1 "Senior React Engineers", and "3 people needed · 5–8 years · 6-month contract · Bangalore or remote · ₹1.30–1.70L per month". Actions: [Ask a question] and [Request interviews · N] (N = number selected).
- **Masking notice:** a shield icon and *"Names, photos and supplier names are hidden on purpose. You are seeing verified skills, test results and rates — enough to choose who to meet."*
- **Filters** on the right: All 6 · Free now · Score 85+ · In budget.
- **Card grid:** 3 columns (auto-fit, min 300px), gap 14. Each **candidate card** has radius 16 and padding 17:
  - Top: a 30px person glyph tile, **TV-4821** (Plex Mono 15/600), "6.2 yrs experience · Bangalore". The score sits top-right (26/800; green ≥ 85, brand ≥ 80, otherwise t1) with "TEST SCORE" beneath.
  - Skill chips.
  - **"HOW THEY SCORED"** inset (`--surface-2`, radius 12), with "First attempt · tested 09 Aug" on the right. Four bars (Coding, Data structures, System design, Communication), 6px tall. Bar colour: green ≥ 85, brand ≥ 75, amber below.
  - Rate "₹1.35–1.55L" (15/800) with "per month", and an availability pill: Free now (ok) / From 1 Oct (warn) / 30-day notice (info).
  - Actions:
    - **[Request interview]** toggles. Selected = brand fill, "Interview requested", card border brand 1.5px, shadow `--sh2`.
    - **✕ Pass** shows an inline strip "Passed — we'll let the supplier know, without saying why." with Undo, plus a toast.
    - **💬 Ask** opens the drawer with the context "TV-4821 · React · 6.2 yrs".
- **Bottom note** from Priya (avatar "PN"): a quoted recommendation and a [Reply] button that opens the drawer.
- **Sample candidates:**
  - TV-6620 Jaipur, QA/Playwright, 91
  - TV-4821 Bangalore, React, 88
  - TV-5302 Pune, Salesforce, 85
  - TV-5107 Pune, Java Spring Boot, 82
  - TV-4488 Bangalore, SAP ABAP, 79, ₹2.10–2.40L
  - TV-3964 Hyderabad, .NET, 76

## C5 · Interviews (`interviews`)
- **Header:** "Interviews" · "We book every slot. Candidates join under their anonymous ID until you make an offer." · [Set panel availability] [Propose new slots].
- **Left, "THIS WEEK":** interview cards.
  - A 70px date block (brand-tint) showing AUG / 25 / 11:00.
  - TV id and round pill, role and duration, a mode line ("Google Meet · link comes from us"), and a panel line.
  - Buttons: a dark CTA (Open briefing / View scorecard / Prepare questions) and [Reschedule through us], which opens the drawer.
  - "WAITING ON US": a dashed card for TV-5302 with "Asked 4h ago".
- **Right, "Your feedback":** a "Due today" pill and a context row "TV-6620 · Round 2 · Technical deep-dive · 21 Aug, 15:00".
  - Four ratings (Technical depth, Problem solving, Communication, Role fit). Each is 5 clickable segments, 9px tall, filled brand up to the chosen value, with "4 of 5" shown.
  - A notes box.
  - "What do you want to do?": Move forward / Hold / Not a fit. Selecting one makes it dark and shows the toast "Feedback for TV-6620 sent to Talentvibes · move forward".
  - A privacy note.

## C6 · People working (`engagements`)
- **Header:** "People working" · "Your live contracts. One invoice from Talentvibes covers all of them." · [Download invoice] [Request an extension].
- **4 stats:** 5 people working · ₹8.40L per month · 4.2 mo average tenure · 1 ending this quarter.
- **Table** (scrolls horizontally when narrow; min-width 706px): PERSON & ROLE · STARTED · ENDS · YOUR RATE / MO · STATUS · ACTION.
  - Rows are anonymous (TV id and role only).
  - An "Ends soon" end date shows in amber, bold.
  - The footer reads "TOTAL PER MONTH ₹8,40,000".

---

# VENDOR PORTAL. Company: **Nimbus Softworks**, supplier NSW-0142, user **Vikram Shetty, Bench Manager**

The vendor sees **real names of their own people** and **only their own rate**. They never see the client's name, the client rate or the margin.

## V1 · Overview (`vdash`)
- **Header:** "Your bench" · "Nimbus Softworks · supplier NSW-0142 · reliability 4.6 of 5 · one of 14 suppliers on the exchange" · [Confirm availability · 7] [Add people].
- **Hero stat:** "How much of your bench is earning" **64%** "of 42 engineers".
  - A stacked bar: working (ok) 64%, in process (warn) 14%, the rest empty.
  - Legend: 27 working / 6 in process / 9 idle.
  - Note: "Idle cost this month is about ₹9.8L. Listing those 9 could recover roughly ₹7.2L."
- **3 stats:** Listed 27 (+4) · Shortlisted 11 (6 live) · Placed this year 18 (+3 Aug).
- **"Where your people are in the process":** stacked rows (name, "TV-#### · skills", "Your rate ₹1,38,000 / month"; stage pill and "updated 2h ago" on the right). Stages: Interview R1/R2 (brand) · Shortlisted (ok) · Not chosen (neutral).
- **Side column:**
  - **"Is everyone still free?"** (amber border, "Needs a click"): copy about the 14-day rule, three count tiles (Confirmed, ok / Expiring soon, warn / Unconfirmed, danger) and [Confirm all 7 expiring].
  - **"Skill tests"**: "Tested people get shortlisted 3.1× more often." Three bars (Scored 18 / In progress 4 / Not started 9) and [Invite the 9 who haven't started].

## V2 · Add people (`add`)
- **Header:** "Add people to your bench" · "We hide the name, photo and your company name before any client sees the profile."
- **Form card:**
  - **Who they are**, with a pill "Only you and Talentvibes see this":
    - Full name and Employee ID inputs.
    - Base city segments: Pune / Bangalore / Hyderabad / Jaipur.
    - A green notice: "Clients will only ever see this person as **TV-####**…"
  - **What they can do**: a tag input that works like C3, plus experience / free from / will work fields.
  - **Your rate**: a 46px value with ± steppers in ₹5,000 steps and a brand border.
    - A benchmark note: inside the ₹1.32–1.61L range it is neutral. Above or below, it turns amber with the matching message, ending "You will never see what the client pays."
  - **Skill test**: [Send test invite now] [Schedule for later].
  - **Footer:** [List on the exchange] goes to the roster with the toast "<name> listed as TV-7702 — masked and live on the exchange." Also [Save as draft].
- **Side column:**
  - **"Got a lot of people?"**: a dashed drop zone with "browse your files · up to 500 rows" and a mono header sample `name, emp_id, skills, exp_years, city, rate_inr, available_from`.
    - "Last upload · bench_aug26.csv" with 38 read / 34 listed / 4 need a look.
    - An amber note and [Review 4 rows] [Template].
  - **"What the client will see"**: a live masked preview card (TV-####, years · city, up to 3 skills, "NO TEST YET") with ✕ lines for "Name and photo hidden", "“Nimbus Softworks” hidden" and "Client sees a rate set by Talentvibes".

## V3 · Bench roster (`roster`)
- **Header:** "Bench roster" · "42 engineers · 27 listed on the exchange · confirm each person every 14 days to stay in matching." · [Export] [Confirm all · N].
- **Filter pills** (dark selected): Everyone 42 · Listed 27 · Idle 9 · Expiring soon 7 · Unconfirmed 3. On the right: "Freshness recalculated nightly at 02:00 IST".
- **Table** (sticky header; min-width 776px): PERSON · EXP · YOUR RATE · SKILL TEST · STILL FREE? · CONFIRM.
  - SKILL TEST: a dot and label (Scored 88 / In progress / Not started) with a sub-line.
  - **STILL FREE?**: a pill (Confirmed free, ok / Expiring soon, warn / Not confirmed, danger), "N days ago", and a 5px **freshness bar** whose width is `max(6%, (1 − min(days,28)/28) × 100%)` in the pill colour.
  - **CONFIRM**: a [Still free] primary button. Once clicked it shows the greyed "Confirmed", plus a toast with Undo, and the row turns green.
  - Unconfirmed rows get a faint red background (`danger` at 3% on surface).

## V4 · Skill tests (`assess`)
- **Header:** "Skill tests" · "Tests are run and watched by Talentvibes. You and the client see the same score — you can't change it." · [Invite 9 to test].
- **Card grid** (auto-fit, min 300px). Each card shows the name, "TV-#### · track" and a status pill (Scored / In progress / Not started).
  - A big score (34px) or "—", with a caption ("TESTED 12 AUG" / "SECTION 2 OF 4" / "INVITE NOT SENT").
  - Four mini bars.
  - A footer with a note ("Valid until 10 Nov") and an action link (View report / Send a nudge / Send invite / Resend invite).

## V5 · Your earnings (`earnings`)
- **Header:** "Your earnings" · "Your contracted rate for each placement. Talentvibes contracts separately with the client." · [Download statement] [Raise invoice].
- **4 stats:** Billed this month ₹7.42L · Earned this year ₹58.6L · Average rate ₹1.48L (+4%) · Next payout 7 Oct (on time).
- **Table** (min-width 612px): PERSON & ROLE · SINCE · YOUR RATE / MO · THIS MONTH · STATUS.
  - The header row also carries a pill "Last 12 cycles on time".
  - The footer reads "TOTAL DUE TO YOU ₹7,42,000".
- **Note:** "Talentvibes is the contracting party for every placement. The client's name, the client's rate and our margin are not shared with suppliers…"
- **There must be no client-rate column anywhere in this portal.**

---

# TALENTVIBES OPS. User **Priya Nair, brokering desk 2**

Every Ops screen has a **dark strip** under the top bar: a lock icon and "Internal view — you can see real names, both rates and our margin. Clients and suppliers cannot."

## O1 · Role pipeline (`pipeline`)
- **Header:** "Role pipeline" · "24 client roles live · 5 clients · 14 supplier benches · 1 past its deadline. Drag a card, or use the arrows." · a **Board | List** segmented toggle · [Open matching desk].
- **Toolbar:**
  - A 320px search box (role, client, owner, REQ id, skill).
  - Toggle chips: **My desk** (owner = me), **Deadline at risk** (warn or late SLA), **Nobody sourced yet** (0 candidates). Each shows its count.
  - Clear, and "Showing X of 24 roles" on the right.
- **Stages** (column title, colour, card action):
  1. Just in (t4) → "Source"
  2. We're searching (warn) → "Match"
  3. Sent to client (brand) → "Review"
  4. Interviewing (info) → "Track"
  5. Placed (ok) → "Margin"
- **Board:** 5 columns, each `flex: 1 1 0; min-width: 208px`. The board scrolls horizontally if needed, and each column scrolls vertically on its own.
  - Column header: a colour square, the title and a count pill. A sub-line reads "N roles". **More than 6 cards shows the amber "N roles — more than we like to carry, scroll for the rest".**
  - Card: role (13.5/700), "Client · N needed", skill chips, a divider, value/mo, and an SLA dot + label (ok / warn / late / idle grey).
  - Card footer: ‹ back · [action] (brand-tint, full width) · › forward.
  - **Drag and drop** between columns. While dragging, every column tints `--surface-2` with a brand-tint-2 border, and the dragged card fades to 50%.
  - Every move shows a toast "<role> moved to “<stage>”" with **Undo**.
  - Late cards get a red 30% border.
  - Clicking the card or its action opens O2 with that role selected. Placed cards open O4.
- **List view:** the same data in one sortable table (min-width 794px): ROLE · CLIENT · QTY · VALUE / MO · OWNER · STAGE — MOVE IT (‹ pill ›) · SLA. Overdue rows get a faint red background. The footer reads "…the list view is the one to use when the board gets busy."
- **Why both views exist:** stage changes are **manual** (Ops owns the process), but some are also set automatically by events. Sending a shortlist moves a role to "Sent to client". Booking an interview moves it to "Interviewing". The list view keeps hundreds of roles usable.

## O2 · Matching desk (`matching`)
- **Header:**
  - A stage pill and "REQ-2291 · posted 4 days ago · P. Nair".
  - H1 "Matching desk".
  - On its own row below, a **role picker button**: "WORKING ON | Senior React Engineers | Acme Finserv ▾".
  - Actions: [Reset order] [Send shortlist · N].
- **Role picker dropdown** (470px, positioned under the button): "Pick a role to match · N roles are waiting on a shortlist." It lists every role in Just in / We're searching / Sent to client, each with role, "client · N needed · owner", a stage pill and SLA. Selecting one loads that role's candidate pool.
- **Left panel** (`flex: 0 1 300px; min-width: 232px`, scrolls):
  - "THE ROLE": name and sub-line.
  - 8 key/value facts: People needed, Experience, Where, Start, Client budget (brand), Value per month, Margin target "22% or better" (ok), Deadline (SLA colour).
  - "HOW WE RANK": six weight bars: Skill match 30%, Test score 22%, Experience fit 16%, Rate against budget 14%, How fresh the availability is 10%, Supplier reliability 8%.
  - A client-note box.
  - If the pool contains duplicates, a red box "2 duplicate flags affect this pool. Clear them before sending" linking to O5.
- **Right panel:**
  - A toolbar with "Ranked candidates · N", a pill reading "Suggested order" (neutral) or "You changed the order" (amber), and the hint "Drag a row, or use the arrows — the client sees this order".
  - **Ranked rows** (radius 15, padding 15 17, flex-wrap):
    - A position tile 32px (brand when included) with ▲▼ buttons under it.
    - Name (unmasked), an "In the shortlist" or "Held back" pill, Plex Mono ID, vendor, and "6.2 yrs · ₹1.38L/mo to us".
    - Match score (24/800; green ≥ 85, brand ≥ 75, amber below), "MATCH SCORE" and a reason sentence.
    - **6 reason bars** in auto-fit min 86px: Skills · Test · Exp fit · Rate · Free? · Supplier. Each shows its value. Colour: ok ≥ 80, brand ≥ 60, warn ≥ 40, danger below.
    - [Include / Included] toggle and [Details / Hide].
    - **Details** expand into 8 facts (City, Notice period, Test score, Availability, Supplier reliability, Supplier gets, We'd charge, Margin, red if under 18%) and a background note.
  - Drag to reorder (the drop target is another row). ▲▼ also reorder.
  - By default the top `min(4, max(2, qty+1))` candidates are included.
  - **Send shortlist** sets the role to "Sent to client", returns to O1 and shows the toast "N anonymous profiles sent to <client> for <role>" with Undo.

## O3 · Talent pool (`pool`)
- **Header:** "Talent pool" · "1,284 engineers across 14 supplier benches · full detail, nothing hidden · 892 have a valid test score." · [Save this view] [Add to a shortlist].
- **Filter chips**, toggleable (✕ when on): React, 5–8 years, Score 75+, Confirmed free (on by default), plus Any city, Any supplier, Rate under ₹1.6L. On the right: "62 matching engineers · found in 0.18s".
- **Table** (sticky header; min-width 868px): NAME & SKILLS · SUPPLIER (with "reliability 4.6" and a coloured dot) · EXP · SCORE · VENDOR RATE · CLIENT RATE (bold) · CITY · STILL FREE? (pill). Ends with "Load more".

## O4 · Margin (`margin`)
- **Header:** "Margin" · "What the supplier gets, what the client pays, and what we keep. Talentvibes only." · [August 2026 ▾] [Export to finance].
- **4 stats:**
  - What we kept in August ₹2.84L +12%
  - Average margin 24.5% (target 22%)
  - **Below our floor 2**: an amber-tinted card
  - Annual run rate ₹3.4Cr: an inverted dark card
- **Table** (min-width 706px): PERSON & ROLE (with "· vendor" in the sub-line) · CLIENT · SUPPLIER GETS · CLIENT PAYS · WE KEEP (bold) · MARGIN (pill: ok ≥ 18%, warn 15–18%, danger below 15%).
  - Danger rows get a faint red background.
  - The footer shows the three totals: SUPPLIERS ₹8,74,000 · CLIENTS ₹11,58,000 · WE KEEP ₹2,84,000 (green, 20/800).
- **Amber note:** "Two placements are below our 18% floor. TV-4488 (Vertex Digital) was approved at 14.2% as a way into Acme's SAP programme — review it at renewal on 1 October."

## O5 · Duplicate checks (`dupes`)
- **Header:** "Duplicate checks" · "The same person sent to us by two different suppliers. Clear these before a shortlist goes out." · [Detection rules] and a "2 open" danger-soft badge.
- **Case card DUP-0148** (red 26% border, radius 18):
  - A red header strip: "Almost certainly the same person · 96% confident" and "Flagged 22 Aug 09:12 · blocking the React shortlist".
  - Body (flex-wrap): **left submission | centre "WHY WE FLAGGED IT" (216px) | right submission**.
    - Each side shows a pill ("Came in first" ok / "Came in later" warn), the submitted time, the name (19/800) and "TV-#### · sent by **Vendor**".
    - Each side has 8 facts. Matching identity fields are shown in red: PAN (hashed), Phone (hashed), Experience, Last employer, Test score, Supplier rate, Availability, Supplier reliability.
    - Each side has [Keep this one] / [Keep this one instead] and [Call them].
    - The centre lists signals as tinted boxes: Same hashed PAN · Same hashed phone · Same employer history (red) · Same GitHub handle · Experience differs (amber) · Rate differs (neutral).
  - Footer: "**Our recommendation:** keep the Nimbus Softworks submission — it came in 6 days earlier, availability is confirmed, and their reliability is 4.6 against 3.1. We'll tell Orbit the profile is already represented. Neither the client nor the candidate is told." · [Keep Nimbus, reject Orbit] (dark) [Not a duplicate].
- **When resolved:** the card is replaced by a green "DUP-0148 cleared" card with the outcome and [Reopen]. The badge drops to "1 open" and the O2 duplicate warning disappears.
- **Second, lighter case DUP-0147** (71%, amber): Kavya Menon (Trueline) vs K. M. Nair (Vertex). Same phone, different PAN, "Someone needs to call." Assigned to R. Verma, with [Open].
