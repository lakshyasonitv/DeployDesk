# Design tokens

`tokens.css` holds the drop-in implementation. This file explains how each token is used.

## Colour: light (default)
| Token | Hex | Use |
|---|---|---|
| `--bg` | `#f4f6f9` | App background behind cards |
| `--surface` | `#ffffff` | Cards, sidebar, top bar, page headers |
| `--surface-2` | `#f8fafc` | Inputs, table header rows, inset info boxes, list hover |
| `--surface-3` | `#f1f4f8` | Skill chips, progress tracks, neutral pills |
| `--border` | `#e3e7ee` | All 1px borders |
| `--border-2` | `#d2d8e2` | Inactive button borders, dashed drop zones, empty-column dashes |
| `--t1` | `#0f1729` | Headings, values, primary text. Also the background of dark "secondary-primary" buttons and the toast |
| `--t2` | `#475369` | Body copy |
| `--t3` | `#6b7789` | Labels, meta, table header text |
| `--t4` | `#98a2b3` | Hints, captions, group labels |
| `--brand` | `#0b6ed9` | Primary buttons, active states, selected borders, focus |
| `--brand-tint` | brand 10% on surface | Active nav background, selected filter, info boxes |
| `--brand-tint-2` | brand 20% on surface | Borders of tinted boxes, selected filter border |
| `--brand-ink` | brand 76% + black | Text placed on brand-tint |
| `--ok` / `--ok-tint` | `#067647` / `#e9f9f0` | Confirmed, placed, active, score ≥ 85, margin ≥ 18% |
| `--warn` / `--warn-tint` | `#b54708` / `#fff6e9` | Expiring, due today, at-risk deadline, in progress |
| `--danger` / `--danger-tint` | `#b42318` / `#fdeeec` | Overdue, unconfirmed, duplicate, below margin floor |
| `--info` / `--info-tint` | `#175cd3` / `#eaf2ff` | Onboarding, notice period, interviewing stage |

## Colour: dark (`data-tvtheme="dark"`)
`bg #080a0f · surface #101419 · surface-2 #151a21 · surface-3 #1c222b · border #242b35 · border-2 #333c48 · t1 #eef1f6 · t2 #c2cad6 · t3 #93a0b1 · t4 #6b7789 · brand #4f9df2 · ok #4fd18b/#0d2a1d · warn #efb15c/#2c2011 · danger #f58b82/#2c1513 · info #7db3fb/#111f33`

In dark mode the tints mix at 16%/28% and `--brand-ink` mixes towards white. White text on `--brand` buttons stays white in both themes.

## Pill and chip recipes
- **Status pill:** padding 4px 10px, radius 999, 11.5px/700, `background: X-tint; color: X`. It usually has a 5px dot in the same colour, followed by a 6px gap.
- **Skill chip:** padding 4px 9px, radius 8, 12px/600, `--surface-3` background, `--t2` text.
- **Editable skill chip (forms):** padding 6px 11px, radius 9, 13px/700, brand-tint background, brand-ink text, with a 12px ✕. Clicking it removes the chip.
- **Filter chip:** height 34px, padding 0 12–13px, radius 9 (or 999 on the vendor roster). Unselected: surface, border, t2, weight 500. Selected (blue): brand-tint, brand-tint-2 border, brand-ink, weight 700. The vendor roster and segmented choices use a **dark selected** variant instead: `--t1` background, `--surface` text.

## Typography (Plus Jakarta Sans)
| Role | Size / weight / tracking |
|---|---|
| Page H1 | 26px / 800 / -0.6px (Matching desk 24px) |
| Card title | 16px / 700 (feedback card 17px) |
| Big stat | 28–30px / 800 / -1px. Hero stats 36–42px / 800 / -1.4 to -1.8px |
| Score on candidate card | 26px / 800 / -1px, line-height 1 |
| Body | 13–14px / 400–600, line-height 1.5–1.6 |
| Page explainer | 14px / 400, `--t2` |
| Nav item | 13.5px, 500 or 700 when active |
| Table header | 11.5px / 700, UPPERCASE, `--t3` |
| Table cell | 13–13.5px. Primary cell 13.5–14px / 700 with a 11.5–12px `--t3`/`--t4` sub-line |
| Section label | 11–12px / 700 UPPERCASE, `--t3`/`--t4`, letter-spacing .08–.09em on group labels |
| Pill | 11–11.5px / 700 |
| IDs | IBM Plex Mono 12–15px / 600 |

## Spacing
A 4px base, used as `3 · 4 · 5 · 6 · 7 · 8 · 9 · 10 · 11 · 12 · 13 · 14 · 15 · 16 · 17 · 18 · 20 · 22 · 24`.
- Page gutter: 24px horizontal. Content padding: `20px 24px 32px`. Page header: `22px 24px 18px`.
- Card padding 17–22px (forms 22). Gap between cards 14–18px.
- Table cell padding 13–15px vertical, 18–20px horizontal.
- Form field height 40px (primary value 46px). Button height 40–42px in headers, 34–38px in cards.

## Radius
`5` key hints · `7–8` mini buttons and skill chips · `9–10` buttons, inputs, nav items · `11–12` info boxes, large buttons · `13–14` stat cards, toast · `15–16` content cards · `18` duplicate case card · `999` pills.

## Shadows
`--sh` on every card at rest. `--sh2` on selected candidate cards and included matching rows. `--sh3` on menus, the palette, the drawer and the toast. No other shadows.

## Motion
Menus, palette and toast use `tvin` (opacity 0→1, translateY 6px→0) at 140–160ms ease-out. The toast auto-hides after 6000ms. The mocked chat reply arrives at 1400ms. Nothing else animates. Avoid decorative motion.

## Buttons
| Variant | Style |
|---|---|
| Primary | `--brand` background, white text, 700, shadow `--sh`, radius 10–11 |
| Dark | `--t1` background, `--surface` text, 700. Used for the in-card main action that isn't the page's primary CTA |
| Secondary | `--surface` background, 1px `--border`, `--t2`/`--t1` text, 600 |
| Danger-soft | `--danger-tint` background, `--danger` text, 1px danger 22% border |
| Text link | `--brand`, 12.5px/700, no underline. A trailing "→" when it navigates |
| Icon square | 30–38px, 1px border, radius 8–10, centred 13–15px icon |
