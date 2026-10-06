# 02 — Decision Log

> Append-only. Newest entry at the TOP. Never edit old entries — if a decision is
> reversed, add a new entry linking back.
>
> **Scope of this file.** Architectural decisions live in `../DECISIONS.md` as numbered
> ADRs (ADR-001 … ADR-010, plus ten open questions Q1–Q10). That file is the authority and
> has its own supersede protocol — do **not** copy ADRs here or they will drift the first
> time one is superseded.
>
> This file is for **session-level decisions below the ADR bar**: tooling choices, local
> conventions, workflow calls, and "we tried X and chose Y" notes. If a decision
> constrains the data model, the masking boundary, or money handling, it belongs in
> `../DECISIONS.md` as a new ADR instead.
>
> Open spec questions follow the same split: genuinely open business questions go in the
> **Open questions** table in `../DECISIONS.md` with the safer default recorded, per
> working agreement 8 in `../CLAUDE.md`.

<!-- Format:

## YYYY-MM-DD — <short decision title>
- **Decision:** what was decided
- **Why:** the actual reason
- **Rejected:** alternatives considered and why they lost
- **Impact:** what this touches / constrains going forward
-->

## 2026-10-06 — Project brain holds pointers, not copies

- **Decision:** `project-brain/` stays deliberately thin. `00-overview.md`,
  `01-architecture.md` and `02-decisions.md` link to the eleven root docs rather than
  summarising them. The files carrying genuinely new content are `01-architecture.md` →
  **Gotchas**, `03-progress.md`, `04-tasks.md` and the journal.
- **Why:** `../CLAUDE.md` states "do not duplicate content between them — link instead",
  and the root docs already own ~2,550 lines of spec. A brain that restates the ten ADRs
  becomes a second source of truth that silently diverges the first time an ADR is
  superseded — which is exactly the failure mode the ADR supersede protocol exists to
  prevent.
- **Rejected:** fully pre-filling every brain template from the docs. It reads better on
  day one and is wrong by month three.
- **Impact:** when a root doc changes, the brain usually needs no edit. Anything in the
  brain that *can* be derived from the docs should be deleted, not updated.
