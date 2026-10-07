---
title: Vocabulary — the words the product says out loud
updated: 2026-10-07
---

# Vocabulary

The audit the product owner asked for on 2026-10-07: *"look into all the other words in the
website and tell me where we can make the change."*

One rule runs through all of it, and it is the rule that generated almost every finding
below:

> **One concept, one word, everywhere it is shown.**

Every defect here is the same shape — the same thing called two names in two places. That
is worse than an ugly word, because a reader who sees "Supplier" in one column and "Vendor
rate" in the next cannot tell whether they are being shown one party or two.

---

## 1. Applied 2026-10-07

### The talent pool (`/ops/pool`)

| Was | Now | Why |
|---|---|---|
| `SUPPLIER` | **`EMPLOYER`** | The cell is the company that employs this engineer. `docs/DOMAIN.md:7` defines bench as *"Engineers a vendor **employs** but has not deployed"*, so the word is the domain's own. It also sidesteps the supplier-vs-vendor choice the owner declined to make. |
| `EXP` | **`EXPERIENCE`** | An abbreviation saving four characters in a column that had room once widened. |
| `SCORE` | **`TEST SCORE`** | "Score" alone never said score *of what*. It is the independently proctored test result — the one number on this screen a client is ever shown, so it is worth naming. |
| `FRESHNESS` | **`LAST CONFIRMED`** | The clearest genuine jargon in the product. The column holds how recently availability was confirmed; now it says so. |

The **filter chips above the table were renamed in the same edit** (`Supplier` → `Employer`,
`Score` → `Test score`, `Freshness` → `Last confirmed`). A chip and a column that name the
same filter differently is the exact defect this pass exists to remove.

**Two layout facts that are easy to get wrong.** At 9px mono with `.12em` tracking a
character costs ≈6.5px, so `EXPERIENCE` needs ≈65px and its column was 58px — widened to
74px, which costs the `1fr` skills column 16px it can afford. Widening alone is not enough:
`TEST SCORE` and `LAST CONFIRMED` are two-word headers and **wrap at the space no matter how
wide the column is**, so the header cell also gained `white-space:nowrap`.

### `FRESHNESS` across the product

Renamed at every place a person reads it, 11 sites:

- `LAST CONFIRMED` — the pool header, the roster header (was `AVAILABILITY FRESHNESS`), the
  vendor overview section label, and the matching workspace's candidate detail.
- `NEEDS CONFIRMING` — the five vendor asides, which were `FRESHNESS ALERTS`.
  "LAST CONFIRMED ALERTS" is nonsense; an aside listing work to do takes the imperative.
- *"Rechecked every night at 02:00 IST"* — was *"Freshness recalculated nightly · 02:00 IST"*.

### `RESOURCE` → `NAME`, but only where a name is actually shown

"Resource" for a human being is the least humane word on these screens, but the five
`RESOURCE` columns were **not the same column**. Three show `fullName` as the primary line
and were renamed; two show only an identifier and became `REFERENCE` in round 2 (§1b).

| Screen | First cell renders | Action |
|---|---|---|
| `/ops/margin` | `fullName`, with `maskedId · vendorName` beneath | → `NAME` |
| `/vendor/earnings` | `fullName`, with `maskedId` beneath | → `NAME` |
| `/vendor/roster` | `fullName`, with `maskedId · baseCity` beneath | → `NAME` |
| `/client/engagements` | **`maskedId` alone — no name exists** | → `REFERENCE` (§1b) |
| `/vendor` pipeline | `maskedId` primary, `shortenName(fullName)` beneath | → `REFERENCE` (§1b) |

`NAME` over a masked ID would imply a name is there to be seen. On the client screen that is
the precise opposite of the product's guarantee, so this one is a **masking** decision, not a
typographic one.

### `Expiring 2d` → `Expiring in 2d`

Caught while renaming the column above it. The three pill values come from
`src/lib/derived.ts`, and they do not all point the same way in time:

```
confirmed      `Confirmed ${days}d`        — days SINCE confirmation   (backward)
expiring_soon  `Expiring ${14 - days}d`    — days UNTIL it expires     (FORWARD)
unconfirmed    `Unconfirmed ${days}d`      — days since                (backward)
```

Under a column headed `LAST CONFIRMED`, a bare "Expiring 2d" reads as "confirmed two days
ago" — the opposite of what it means. Three characters fix it.

### "Talentvibes · broker" — a raw database enum in the top bar

Six ops pages rendered ``org: `${session.orgName} · ${session.role}` ``, and `role` is the
`user_role` pgEnum. So the chip printed the literal stored value: **"Talentvibes · broker"**,
and for the other two ops values it would have read **"Talentvibes · ops_admin"**, underscore
included.

**Resolved by showing the organisation alone.** The client and vendor portals already passed
`org: session.orgName` with no role; only ops appended one. Dropping it removes the word the
owner objected to, invents no job title for anybody, and makes all three portals identical.
The owner's instruction was explicit: *"no admin or anything but just something simple"* — so
the intermediate `ROLE_LABEL` map of guessed titles ("Account manager", "Bench manager") was
**deleted rather than left in the tree**. `role` stays on `DemoSession` as real data; an
authorisation check is its proper consumer, and its doc comment now says never to render it.

### A silent-failure coupling removed while in there

`getShellNav` sorted the organisation switcher with
`Number(a.role === "Broker") - Number(b.role === "Broker")` — comparing against the **display
label**. Renaming that label would have stopped Talentvibes being listed last with no error,
no type failure and no failing test. It now sorts on `isOps`, which is a fact rather than a
caption.

This is the same failure class as the search crash: a string doing double duty as data and as
copy. See §6 for the two that remain and must not be touched.

**Verification:** `npx tsc --noEmit` clean · `npm run build` clean · `npm test` **108/108**.
No test asserted any renamed string, so nothing here was proven by the suite — the suite only
proves nothing else broke.

---

## 1b. Applied 2026-10-07, second round

All six items from the original list (now §3) were approved and are done. `npx tsc --noEmit` clean ·
`npm run build` clean · `npm test` **108/108**.

### `"broker"` → `"your Talentvibes team"` — 21 strings, not 16

The first count missed five: an API response note
(`app/api/client/match-preview/route.ts:125`), two more in `ShortlistBoard` (the ask-panel
empty state and its message placeholder), the `HowItWorks` client heading, and a **fallback
name** — see the trap below. Two code comments that quote the copy were updated too, so they
do not go stale.

**The trap: `brokerName` is a NAME, and its fallback was a phrase.**
`src/read-models/client/index.ts:281` read
`accountOwner?.fullName ?? "your Talentvibes broker"`. A blanket swap would have produced
**"your Talentvibes team, Talentvibes:"** in the shortlist footer for any client with no
account owner. So the three places that render `brokerName` were reworded FIRST, each to read
correctly with a real name *and* with the fallback:

| Site | Now | With a name | With the fallback |
|---|---|---|---|
| shortlist footer | `{brokerName}:` | "R. Verma:" | "Your Talentvibes team:" |
| ask-panel empty state | `{brokerName} looks after this role for you` | "R. Verma looks after…" | "Your Talentvibes team looks after…" |
| client overview subtitle | `your Talentvibes team replies in ~2h` | — | — |

The fallback is now **capitalised** — `"Your Talentvibes team"` — because it begins a sentence
at both call sites.

**The named owner was dropped from the client overview subtitle on purpose.** It used to read
*"your broker R. Verma responds in ~2h"*. With the fallback in play, keeping both the phrase
and the name would say the same thing twice. The named person still appears on the shortlist
footer and in the message thread, which is where it earns trust — and `HowItWorks` still
promises *"A named person at Talentvibes owns your account."*

**Ops copy keeps the word.** `HowItWorks.ops` is still titled *"The brokering desk"* and still
says *"an unresponsive client must not make a broker look slow."* That is the internal
console, and it follows the owner's standing call that ops keeps its own vocabulary — the same
reasoning that kept `margin`, `spread` and `VENDOR RATE`.

### The other five

| Item | Applied |
|---|---|
| **(b)** the gap the pool rename opened | `app/api/export/route.ts:134` `Supplier` → `Employer` |
| **(c)** screens adopt their own CSV wording | `SINCE` → `WORKING SINCE`, `YOUR RATE/MO` → `YOUR MONTHLY RATE`, `THIS MONTH` → `BILLED THIS MONTH`. **The client engagements CSV had to move too:** its own header set (`route.ts:112`) said `Since` / `Your rate`, so taking the wording from the *vendor* earnings CSV would have made that screen disagree with its own export — the exact defect (c) exists to remove. Renamed in place; column order untouched, because the row builder beneath it is positional |
| **(d)** the two identifier columns | `/client/engagements` and `/vendor` pipeline: `RESOURCE` → `REFERENCE` |
| **(e)** | pool: `rel 4.2` → `reliability 4.2` |
| **(f)** | `QTY` → `HOW MANY`, `BUDGET/MO` → `BUDGET / MONTH`, `VALUE/MO` → `VALUE / MONTH`. **`REQ` kept** — requirements really are `REQ-####`, so the header matches the data |

**Layout, again.** `HOW MANY` is ≈52px and the ops pipeline's `QTY` column was **exactly**
52px, so it would have overflowed — widened to 68px, taken from the `1fr` role column. Six
more header cells gained `white-space:nowrap`; every one of the new names is two words, and a
two-word header wraps at the space whatever the column width.

---

## 2. Still open

### a. Confirm "Full access"

It labels Talentvibes in the organisation switcher, where the set reads *Supplies · Hires ·
Both sides · Full access*. It replaced "Broker" and it is **not a word the owner picked**.

### b. A product question, not a rename

`/vendor` shows a vendor `shortenName(fullName)` of **their own employee**
(`src/read-models/vendor/index.ts:251`). Either that is deliberate or masking has been
over-applied inward — the vendor employs this person and sees their full name on the roster.

### c. `YOUR RATE` vs `YOUR MONTHLY RATE`

Exposed by (c) rather than caused by it. The vendor **earnings** table now says
`YOUR MONTHLY RATE` (matching its CSV), while the vendor **roster** and the vendor
**pipeline** still say `YOUR RATE` for the same monthly figure. Neither of those two has a
CSV, so nothing contradicts them — but it is the same one-concept-two-words rule.

Both columns have room (`118px` and `120px` against ≈111px needed), so it is a two-line
change plus `nowrap`. Not done because it was outside what was approved.

### d. Cosmetic, low priority

`initials(view.brokerName)` draws the shortlist footer avatar. With no account owner it now
renders "YT" from "Your Talentvibes team" (it was "yT" from the old fallback). Pre-existing,
marginally better, still not a person's initials.

---

## 3. The original decision list, for the record

Ordered by how much they mattered. All now applied — kept here because the reasoning is the
useful part.

### a. `"your broker"` — 16 user-facing strings

**Chosen: "your Talentvibes team."** The owner's objection was to the role chip, but the word
also appears in sixteen pieces of client-facing copy: *"Send to your broker"*, *"Your broker confirms"*, *"Note for your
broker"*, *"Shared with your broker only"*, *"your broker ⟨name⟩ responds in ~2h"*, and the
shortlist footer *"⟨name⟩, your broker:"*.

This one is a **brand decision, not a cleanup**, which is why it was not guessed at. "Broker"
is accurate and it is doing real work — it is *why* the client cannot see the supplier, and
the "How this works" explainer leans on it. But it can read transactional.

Candidates, with the trade-off stated:

| Option | Reads as | Cost |
|---|---|---|
| **"your Talentvibes team"** | A company standing behind the work. Survives staff changes. | Loses the single named human; "⟨name⟩, your Talentvibes team:" needs rewording. |
| "your account manager" | Standard, professional, instantly understood. | Implies account admin rather than sourcing. |
| "your Talentvibes contact" | Plain and neutral. | Vague about what they do. |
| leave as "broker" | Honest about the model. | The owner finds it unprofessional. |

Whatever is chosen must also be applied to the **"How this works" explainer**, which explains
the brokered model in these words.

### b. The margin export still says "Supplier"

`app/api/export/route.ts:134` — the ops margin CSV header set is
`["Reference","Name","Role","Supplier","Vendor rate","Client rate",…]`. The pool screen now
says `EMPLOYER`. **The rename above created this gap**, and leaving it reinstates the exact
defect this pass set out to remove.

**Recommendation: `Supplier` → `Employer` there.** One word, same concept, no new decision.

### c. Screen headers lag behind their own CSV

The exports were given plain-English headers last session; the screens they were built from
were not. The same data now carries two names depending on whether you look at it or download
it — which defeats the point of generating both from one read model.

| Screen column | The CSV already calls it | Recommendation |
|---|---|---|
| `SINCE` | **Working since** | adopt the CSV's |
| `YOUR RATE/MO` | **Your monthly rate** | adopt the CSV's — `/MO` is an abbreviation of an abbreviation |
| `THIS MONTH` | **Billed this month** | adopt the CSV's; the cell is a rupee figure, and "This month" does not say *what* about this month |

### d. The two identifier columns

`app/api/export/route.ts:112` already answers this: the client engagements CSV calls that
column **"Reference"**, and it has no Name column at all, because the client has no name to
be shown.

- `/client/engagements` — `RESOURCE` → **`REFERENCE`**. Truthful, matches the CSV, and says
  nothing about a name.
- `/vendor` pipeline — `RESOURCE` → **`REFERENCE`**, since the masked ID is the primary line.
  Separately worth a look: this screen shows a vendor `shortenName(fullName)` of **their own
  employee**. Either that is deliberate or masking has been over-applied inward. That is a
  product question, not a rename.

### e. `rel 4.2` on the pool

`app/ops/pool/page.tsx:97` renders `rel {r.vendorReliability}` under the employer name. "rel"
is expanded nowhere in the product. Recommendation: **`reliability 4.2`** — there is room, or
the coloured dot beside it already carries the at-a-glance signal and the word can sit in a
`title`.

### f. `REQ`, `QTY`, `BUDGET/MO`, `VALUE/MO`

Four screens (`/client`, `/client/requirements`, `/ops` pipeline, `/client/engagements`).
`REQ` is defensible — requirements *are* `REQ-####`, so the header matches the data. `QTY`,
`BUDGET/MO` and `VALUE/MO` are abbreviations with room to spell out: **`HOW MANY`**,
**`BUDGET / MONTH`**, **`VALUE / MONTH`**.

### g. `· unmasked ·` in the pool subtitle

`app/ops/pool/page.tsx:54`. The owner chose to keep "masked", so this is consistent and is
listed only for completeness. Plainer if wanted: *"full names and rates visible"*.

---

## 4. Checked against the v2 design handoff

`CLAUDE.md` names `design_handoff_bench_exchange_v2/` the **UI contract**, and the owner chose
full v2 adoption. `SCREENS.md` prescribes column names, so every rename above was re-checked
against it **after** the fact. Two were conformance; five are deliberate divergences the owner
directed; one fixes a contradiction inside v2 itself.

### Two renames turned out to match the contract

- **`rel 4.2` → `reliability 4.2`.** `SCREENS.md:222` specifies the supplier cell as *"SUPPLIER
  (with **"reliability 4.6"** and a coloured dot)"*. The abbreviation was the app's own, not
  v2's. This was conformance, not invention.
- **`SCORE` → `TEST SCORE`** resolves a contradiction **inside v2**: its candidate card
  (`SCREENS.md:65`) labels the number *"TEST SCORE"*, while its pool table (`:222`) says
  *"SCORE"*. The change picks v2's own clearer label and makes the two agree.

### Five deliberate divergences from the contract

Recorded so nobody "corrects" them back to v2, and so a future v2 revision knows what was
overridden and why. **All five were the owner's explicit instruction**, not drift.

| v2 prescribes | We ship | Why |
|---|---|---|
| `SUPPLIER` (`:222`) | **`EMPLOYER`** | The owner asked for this word specifically: *"just change the SUPPLIER word to something more reasonable sounding."* |
| `STILL FREE?` (`:222`) | **`LAST CONFIRMED`** | Offered as an option alongside v2's phrasing; the owner chose "Last confirmed" knowing it was the less v2-faithful one. It also names what the column *is* rather than asking a question in a table header. |
| `EXP` (`:222`) | **`EXPERIENCE`** | Owner-approved; abbreviation with room to spell out. |
| `QTY` (`:190`) | **`HOW MANY`** | Owner-approved. |
| `VALUE / MO` (`:190`) | **`VALUE / MONTH`** | Owner-approved; `/MO` is an abbreviation of an abbreviation. |

### One v2 improvement not yet taken

`SCREENS.md:221` writes the pool subtitle as *"1,284 engineers across 14 supplier benches ·
**full detail, nothing hidden** · 892 have a valid test score."* The app says *"· unmasked
·"* (`app/ops/pool/page.tsx:54`). **v2's phrasing is plainer and it is the contract** — a
better answer than the §3g suggestion written before the handoff was consulted. Recommended,
not applied.

---

## 5. Deliberately unchanged, with the reason

Record these so a later pass does not "fix" them.

- **`EMPLOYER` collides with "Employer history."** `docs/DATA-MODEL.md:518` uses
  *"Employer history"* on the duplicates screen for a person's **past** employers, a
  duplicate-detection signal. The ops portal therefore now carries two senses of "employer":
  the current one (pool) and prior ones (duplicates). Judged acceptable — different screens,
  and the duplicates one is always qualified by "history" — but it is the inverse of the
  defect this pass opened with, so it is on the record.
- **`"Paid as supplier"` and `"Billed as client"`** (`/ops/organisations`) stay. These name a
  **finance relationship**, not employment; "Paid as employer" would be wrong.
- **`vendor` stays `vendor`, `supplier` stays `supplier`.** The owner declined to flatten one
  into the other: *"i dont want you to change vendor to supplier or vice versa."* They are
  used 43 and 47 times respectively. If a single word is ever wanted, that is one decision
  applied everywhere at once — never screen by screen.
- **`VENDOR RATE` / `CLIENT RATE` stay.** The owner's standing call, twice: ops staff use
  these daily, they pair with `SPREAD` and `MARGIN`, and simplifying them would be
  patronising. `CLAUDE.md` also forbids a bare `rate` — ambiguity there is how margins leak.
- **`bench`, `masked`, `proctored`, `margin`, `spread`** stay, same reasoning.
- **Nav labels are already plain** and need nothing: *Open roles, Candidate shortlists,
  People working, Add people, Bench roster, Skill tests, Your earnings, Role pipeline,
  Matching desk, Talent pool, Duplicate checks, Organisations*.
- **`SLA` never reaches a user.** It survives only as the `SLA_COLOR` identifier; the labels
  are already plain — *"Due in 6h"*, *"Overdue 4h"*, *"Awaiting client"*, *"No deadline"*.
- **"Full access"** now labels Talentvibes in the organisation switcher, where the set reads
  *Supplies · Hires · Both sides · Full access*. It replaced "Broker". Not a word the owner
  picked — flagged for confirmation.

---

## 6. Strings that are also lookup keys — do not sed

The reason none of this was done with a find-and-replace.

`app/vendor/page.tsx` matches freshness counters **on the label text** and swallows a miss
into `?? 0`:

```ts
app/vendor/page.tsx:42   o.freshness.find((f) => f.label === "Expiring")?.n ?? 0
app/vendor/page.tsx:144  o.freshness.find((f) => f.label === t.key)?.n ?? 0
```

The producers are `src/read-models/vendor/index.ts:245-247` (`"Confirmed"`, `"Expiring"`,
`"Unconfirmed"`) and `FRESH_TILE[].key` in the page. A repo-wide replace over "Freshness" or
those three words would make the vendor dashboard **silently report zero** — it type-checks,
it builds, and no test fails.

`freshnessState`, `FRESHNESS_PILL` and `FRESHNESS_STYLE` are likewise identifiers, not copy,
and were left alone.

**If any of these three words is ever renamed, the producer, both lookups and
`FRESH_TILE[].key` change in one edit.** Better still, give the tiles a stable `key` separate
from their label, the way the switcher sort was fixed in §1.
