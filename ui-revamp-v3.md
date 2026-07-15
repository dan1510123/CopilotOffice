# UI Revamp v3 — Shared UI Kit

**Branch:** `016-office-orchestrator`
**Date:** 2026-07-15

## Goal

The recent top-bar update (office tabs / control pills) established a polished
design language — rounded pill buttons, 1px accent borders, subtle hover
transitions, and a small accent palette. The rest of the app still used flat
4–5px buttons with no hover states, which read as "lacking in appeal / button
looks." This revamp propagates the top-bar language across **every remaining DOM
overlay** via a single shared UI kit.

## New: `src/ui/uiKit.ts`

Single source of truth for shared button + surface chrome (rendering side effects
live in the UI layer, never in `src/config`).

- **`UI`** — accent + surface color tokens aligned to the top-bar palette.
- **`uiButtonClass(variant)`** — returns `ui-btn ui-btn--<variant>` class string.
- **`injectUiKit()`** — idempotent, hot-reload-safe stylesheet injection
  (guarded by element id, mirroring `injectTopBarStyles()`).
- **Variants:** `default`, `primary`, `success`, `danger`, `amber`, `teams`,
  `teams-online`, `ghost`.
- Every `.ui-btn` gets consistent radius (8px), padding, monospace font, and
  `:hover` / `:active` / `:disabled` states.

Each overlay calls the idempotent `injectUiKit()` defensively so the styles are
present even if the overlay is opened in isolation.

## Surfaces updated

| File | What changed |
|------|--------------|
| `src/main.ts` | **Status bar**: glassy blurred surface + rounded tinted status-count chips; Reset / Re-connect buttons use the kit. **Overview header**: Sort + Close Office buttons. **New Office dialog**: layout toggles, Cancel, Create + softer modal surface. **Office settings popover**: Save, Delete + cohesive inputs/border. Wires `injectUiKit()` at startup next to `injectTopBarStyles()`. |
| `src/ui/SeriousTerminalController.ts` | Header (Detach/Close) + all footer buttons (Session History, New Session, Clear History, Close Session, Teams, Full Width, Refresh Focus) + history-popover close. Removed the private `buttonCss()` helper; button grid is now an even 2-column layout. Teams button toggles `teams` ↔ `teams-online` class. |
| `src/ui/TerminalOverlay.ts` | Game-mode terminal footer buttons (same set as above) + mobile keyboard button. Removed all manual `onmouseover` / `onmouseout` handlers and the local `btnStyle` string (hover now handled by the kit). Teams state toggles via class. |
| `src/layouts/default/DefaultDashboard.ts` | Agent card session buttons: New Session (primary), Close Session (danger), Teams (teams ↔ teams-online), edit (ghost). |
| `src/ui/SettingsPanel.ts` | Teams, BGM mute, Notification Reset / Test Toast / Save buttons. |
| `src/ui/NotificationSettingsPanel.ts` | Reset, Test Toast, Save buttons. |
| `src/ui/SpriteCustomizerPanel.ts` | Reset to Default button. |
| `src/ui/TeamsSettingsOverlay.ts` | `button()` helper now takes a variant; Cancel (default), Save (success). |
| `src/meeting/planApproval.ts` | `createButton()` now takes a variant; Approve (success), Revise / Send Feedback (amber), Cancel / Back (default). |

## Out of scope

- **Session / Issues / Pull requests / Gists tabs** — rendered by the Copilot CLI
  TUI *inside* the terminal, not our DOM, so they can't be restyled here.
- **`FleetDashboard`** — no action buttons (header / progress bar / agent list /
  footer only), nothing to convert.

## Tests updated

- `tests/unit/layouts/DefaultDashboard.test.ts` — the session-button assertions
  now match the composed class attribute (`class="session-new-btn ...`) since the
  buttons carry the shared `ui-btn` classes in addition to their behavioral class.

## Validation

- `npx tsc --noEmit` — clean
- `npm run test` — **742 / 742 passing**
- `npm run build` — game + electron bundles build successfully

## Net effect

~155 fewer lines overall: a large amount of duplicated inline button CSS was
collapsed into the shared kit, so future button styling changes happen in one place.
