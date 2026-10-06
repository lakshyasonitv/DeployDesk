# Handoff: Talentvibes Bench Exchange (v2)

## Overview
Bench Exchange is a **brokered B2B marketplace** for Indian IT companies.
- **Vendors** (suppliers) list idle "bench" engineers.
- **Clients** post roles and hire those engineers on contract.
- **Talentvibes** (by Thinkvibes) sits in the middle as the **sole broker**. The two sides never talk to each other or learn each other's identity. Talentvibes sets the client rate, pays the vendor rate and keeps the spread.

There are three portals. Each has its own navigation but they share one design system:

| Portal | Who uses it | Screens |
|---|---|---|
| Client | HR / hiring teams at the hiring company | Overview, Open roles, Post a new role, Candidate shortlists (**hero**), Interviews, People working |
| Vendor | Bench managers at the supplying company | Overview, Add people (+ CSV), Bench roster, Skill tests, Your earnings |
| Talentvibes Ops | Internal brokering desk | Role pipeline (board + list), Matching desk, Talent pool, Margin, Duplicate checks |

Users include **non-technical HR staff**, so the UI uses plain language throughout ("People working", not "Engagements"; "Is everyone still free?", not "Availability freshness"). Keep that tone when you implement it.

## About the design files
The files in `prototype/` are **design references built in HTML**: working prototypes that show the intended look, copy and behaviour. They are **not production code to copy**. Recreate them in the target codebase's own stack and patterns. If there is no codebase yet, use **Next.js (App Router) + TypeScript + Tailwind CSS**, with the CSS variables from `tokens.css` mapped into the Tailwind theme.

- `prototype/bench-exchange-standalone.html` opens by double-click, works offline and contains everything. Use it to click through all 16 screens.
- `prototype/source/*.dc.html` is the readable source. All markup uses inline styles, and the logic class at the bottom holds every piece of sample data and every interaction. Read it for exact values.

## Fidelity
**High-fidelity.** Colours, type, spacing, radii, copy and interactions are final. Match them closely. All sample data is realistic and can seed fixtures.

## Read in this order
1. `README.md`: this file, for overview, shell and global rules
2. `DESIGN_TOKENS.md` + `tokens.css`: colours (light and dark), type, spacing, radii, shadows
3. `SCREENS.md`: every screen in detail (layout, components, copy, behaviour)
4. `DATA_MODEL.md`: entities, masking rules, rate visibility, dual-role companies, API sketch
5. `CLAUDE.md`: a drop-in instruction file for Claude Code (copy it to your repo root)

---

## App shell (all portals)

```
┌──────────────┬──────────────────────────────────────────────────────────┐
│ Sidebar 260  │ Top bar 60px                                             │
│              ├──────────────────────────────────────────────────────────┤
│ logo         │ [Ops only] dark internal-view strip, 8px padding         │
│ search ⌘K    ├──────────────────────────────────────────────────────────┤
│ NAV GROUP    │ Page header (white, bottom border)                       │
│  5 items     │   H1 26/800 · one-line explanation 14px t2 · actions →   │
│ NEEDS ATTN   ├──────────────────────────────────────────────────────────┤
│  3 items     │ Scrollable content, padding 20px 24px 32px, bg = --bg     │
│ user footer  │                                                          │
└──────────────┴──────────────────────────────────────────────────────────┘
```

- Full viewport height (`100vh`, min 720px). Only the content area scrolls. Sidebar and top bar stay fixed.
- **Sidebar** (260px, `--surface`, right border):
  - Logo row: a 30×30 brand-blue tile (radius 9) with a white "T" glyph, then "Bench Exchange" (14.5/800) and "by Thinkvibes" (11.5, t3) on separate lines, never wrapping.
  - Search button: 38px tall, radius 10, `--surface-2`. Reads "Search or jump to…" with a `⌘K` key hint. It opens the command palette.
  - Group label: 10.5/700, letter-spacing .09em, t4. Values: HIRING / YOUR BENCH / BROKERING DESK.
  - Nav items: 38px tall, radius 10, 17px stroke icon, 13.5px label.
    - Active: `--brand-tint` background, `--brand-ink` text, weight 700.
    - Inactive: transparent, t2, weight 500.
    - Optional count badge: a pill (11.5/700) on `--surface-3`, or `--surface` when the item is active.
  - "NEEDS ATTENTION" / "TODAY'S QUEUE": 3 clickable items, each with a 6px status dot, a label (12.5/600) and a sub-line (11.5, t4). **Each line stays on one line with ellipsis.** Clicking an item opens the relevant screen.
  - User footer: 32px initials avatar, name, role, overflow dots.
- **Top bar** (60px, `--surface`, bottom border):
  - Breadcrumb on the left: `Portal · Company › Screen`. The portal part truncates and the screen name never does.
  - On the right, in order:
    1. **Portal switcher**, demo only. A "DEMO" tag, "Viewing as **Client**" and a chevron. It opens a 322px menu with three portals. A real user only ever sees their own portal.
    2. **Light/Dark toggle**: two 32×30 segments, sun and moon. The choice persists in `localStorage("tvbx-theme")` and is applied as `data-tvtheme="dark"` on `<html>`.
    3. **Help (?)**: re-shows the "How Talentvibes works" explainer.
- **Command palette (⌘K / Ctrl+K)**: a centred 620px modal 86px from the top with a 45% dim overlay. It has a search input and results grouped by portal, each result with a 28px code tile, title, description and chevron. Esc closes it. The empty state reads: "Nothing matches that. Try “interview”, “earnings” or “duplicate”."
- **Toast**: bottom-centre, dark (`--t1` background, `--surface` text), radius 13, with a green check, the message, **Undo** (brand colour) and Dismiss. Auto-dismisses after 6s. Every destructive or state-changing action shows a toast with Undo.
- **Ask Talentvibes panel** (client): a 412px right-hand drawer.
  - Header: Priya Nair, "replies in about 2 hours", close ✕.
  - An "ABOUT" context strip naming the role or candidate it was opened from.
  - The message thread. Your bubbles are brand-coloured and right-aligned. Hers are `--surface-2` and left-aligned.
  - Quick-question chips, an input with Send (Enter also sends), and a privacy note.
  - A mocked reply arrives after 1.4s with a "Priya is typing…" indicator.
  - **Switching portal must close this panel.**

## Global rules
1. **Masking (non-negotiable).** The client side never sees a candidate's name, photo or vendor company name. Candidates appear only as `TV-####` (IBM Plex Mono). The vendor side never sees the client's name, the client rate or the margin. Only Ops sees everything. Enforce this in the **API layer**, not just the UI. See `DATA_MODEL.md`.
2. **Plain language.** Every page header has a one-line plain-English explanation under the H1. Keep the copy in `SCREENS.md` as written.
3. **Colour only for meaning.** Brand blue means primary action, selection or "with the client". Green means good, confirmed or placed. Amber means attention or expiring. Red means late, unconfirmed, duplicate or below the margin floor. Everything else is neutral greys.
4. **Every action responds.** There are no dead buttons. When a backend call isn't ready, show the toast.
5. **Responsive.** It must work from about 900px wide upwards:
   - Stat rows use `repeat(auto-fit, minmax(198px, 1fr))`.
   - Two-column pages are flex-wrap, with roughly 3:2 flex-basis (main 460–540px, side about 310px).
   - Dense full-width tables scroll horizontally inside their card. The header row, body rows and footer share one `min-width` so they stay aligned.
   - Tables inside half-width cards become stacked rows (see SCREENS.md) instead of scrolling.
   - Pills and buttons never wrap (`white-space: nowrap`).
6. **Tabular numbers** everywhere (`font-variant-numeric: tabular-nums`). Format INR the Indian way: `₹1,38,000`, `₹1.38L`, `₹3.4Cr`.

## Files in this bundle
```
design_handoff_bench_exchange_v2/
├── README.md            ← you are here
├── CLAUDE.md            ← copy to repo root for Claude Code
├── DESIGN_TOKENS.md     ← all values, light + dark
├── tokens.css           ← drop-in CSS variables
├── SCREENS.md           ← every screen, component, copy, behaviour
├── DATA_MODEL.md        ← entities, masking, dual-role, API sketch
└── prototype/
    ├── bench-exchange-standalone.html   ← open in a browser
    └── source/
        ├── Talentvibes Bench Exchange v2.dc.html
        └── support.js   ← runtime needed to open the source file
```

## Assets
- **Fonts:** Plus Jakarta Sans (400/500/600/700/800) for UI, and IBM Plex Mono (400/500/600) for IDs (TV-####, REQ-####, DUP-####), key hints and CSV snippets. Both are on Google Fonts.
- **Icons:** hand-drawn 18×18 stroke SVGs (stroke 1.7–2.2, round caps) are inline in the source. You can swap them for **Lucide** equivalents: layout-grid, file-text, users, calendar, briefcase, upload, list, clipboard, wallet, columns, target, database, bar-chart-2, alert-triangle, shield-check, message-circle, x, chevron-*, sun, moon, help-circle.
- **No photos, by design.** Candidate avatars are a neutral person glyph in a 30–38px rounded tile.
- **Brand colour:** the `--brand` default `#0b6ed9` was approximated from thinkvibes.com. **Confirm the exact hex with the brand team.** Every tint is derived from `--brand` with `color-mix`, so changing that one variable re-themes the whole app.
