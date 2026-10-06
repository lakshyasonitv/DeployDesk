# CLAUDE.md: Talentvibes Bench Exchange

Copy this file to the root of the implementation repo. It tells Claude Code how to build from the design handoff.

## What we're building
A brokered marketplace for bench IT engineers in India. It has three portals (Client, Vendor, Talentvibes Ops) and one design system. Full specs are in `design_handoff_bench_exchange_v2/`:
- `README.md` for the shell and global rules
- `SCREENS.md` for every screen, with copy and behaviour
- `DESIGN_TOKENS.md` + `tokens.css` for styling
- `DATA_MODEL.md` for entities, visibility rules, dual-role companies and the API
- `prototype/bench-exchange-standalone.html`, the clickable reference. Open it in a browser and match it.

## Stack (if the repo doesn't already have one)
- Next.js App Router + TypeScript + Tailwind. Map the `tokens.css` variables into `tailwind.config` (`colors: { surface: 'var(--surface)', … }`).
- Routes: `/client/*`, `/vendor/*`, `/ops/*`, each with its own layout and sidebar config. Use a shared `<AppShell>`.
- Fonts: Plus Jakarta Sans and IBM Plex Mono via `next/font/google`.
- Icons: `lucide-react`, at 17–18px with stroke 1.75.
- Use mock data from fixtures first (copy it from the logic class in `prototype/source/*.dc.html`). Wire up the API afterwards.

## Non-negotiables
1. **Masking is enforced in the API, not the UI.** Use a separate DTO for each audience. Client responses must never contain a candidate name, vendor name or vendor rate. Vendor responses must never contain a client name, client rate or margin. Write tests for this.
2. **Plain language for HR users.** Use the copy in SCREENS.md as written. Every page header has a one-line explainer.
3. **Colour means status only.** Use the tokens and don't introduce new colours. Brand comes from `--brand`.
4. **Light by default, dark toggle.** Set `data-tvtheme` on `<html>` and persist it in `localStorage('tvbx-theme')`.
5. **Every action gives feedback.** State changes show a toast with Undo (auto-hides after 6s).
6. **Responsive from about 900px.** Use auto-fit grids and flex-wrap. Dense tables scroll horizontally inside their card, with the header, rows and footer sharing a `min-width`. Pills and buttons never wrap.
7. **Indian formatting:** `₹1,38,000`, `₹1.38L`, `₹3.4Cr`, and dates like "22 Aug".

## Build order
1. Tokens, AppShell (sidebar, top bar, theme toggle, ⌘K palette, toast, Ask drawer)
2. Client: Shortlist review (the hero screen), then Overview, Open roles, Post a role, Interviews, People working
3. Ops: Pipeline (board and list, drag-and-drop with `@dnd-kit`), then Matching desk, Duplicate checks, Talent pool, Margin
4. Vendor: Roster with freshness, then Overview, Add people + CSV, Skill tests, Earnings

## Definition of done for each screen
- Matches the prototype's layout, copy and states, in both light and dark.
- No dead buttons.
- No text clipping at 900px, 1280px or 1440px widths.
- The masking tests pass.
