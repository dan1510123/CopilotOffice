# Refactor Program — Progress Tracker

Seeded from `data-model.md` lifecycle states. Update as slices move through phases.

## Architectural Discovery Log

- **2026-06-03 S1-A scoping**: audited `src/scenes/**`, `src/entities/**`, `src/ui/**` for direct
  Phaser keyboard usage. Found that the actual focus contract is **gating via
  `scene.input.keyboard.enabled`**, not centralized key registration. The pitfall note in
  `.github/copilot-instructions.md` ("never manipulate Phaser keyboard directly") was interpreted
  as banning all key registrations outside `src/input/**`, but the working architecture allows
  consumers (Player, OfficeScene E/F, mini-games ESC/SPACE, DialogBox) to register their own keys
  against the shared gated keyboard. Updated `slices/S1-A-input-focus.md` acceptance criteria to
  match. A wholesale centralization would be `behavior_altering` and require an ApprovalRecord —
  it is NOT proposed by default.

## Slice Status Table

| slice_id | name | domain | classification | status | notes |
|----------|------|--------|----------------|--------|-------|
| S1-A | Input Focus and Keyboard Routing | input | parity_preserving | complete | Phase 3 P1; build+test pass 74/74 (2026-06-03), e2e env-blocked, +5 overlay save/restore tests |
| S1-B | Scene Lifecycle and Office Switching | scene | parity_preserving | proposed | Phase 3 P1 |
| S1-C | Terminal/Session Lifecycle (Renderer Side) | terminal | parity_preserving | proposed | Phase 3 P1; pairs with S1-D |
| S1-D | PTY Server and Preload Bridge (Electron Side) | terminal | parity_preserving | proposed | Phase 3 P1; pairs with S1-C |
| S1-E | Meeting Mode and Fleet Orchestration | meeting | parity_preserving | proposed | Phase 3 P1; depends on S1-C/D |
| S2-A | Office State and Persistence | office | parity_preserving | proposed | Phase 4 P2 |
| S2-B | Layouts (Default + Fleet V-Team) | layout | parity_preserving | proposed | Phase 4 P2 |
| S2-C | UI Overlays (Terminal Panel, Dashboards, Mini-Games) | ui | parity_preserving | proposed | Phase 4 P2 |
| S2-D | Sprites and Entities | scene | parity_preserving | proposed | Phase 4 P2 |
| S2-E | Configuration Surface | config | parity_preserving | proposed | Phase 4 P2 |
| S2-F | Electron Main Process (Non-Terminal) | terminal | parity_preserving | proposed | Phase 4 P2 |
| S2-G | Test Harness Hygiene | test | parity_preserving | proposed | Phase 4 P2 |

## Lifecycle States (from data-model.md)

`proposed -> planned -> in_progress -> complete`
`in_progress -> blocked -> in_progress`
`in_progress -> rolled_back`

Guard conditions:
- `complete` for parity_preserving requires parity pass.
- `complete` for behavior_altering requires `approved` ApprovalRecord.

## Baseline

> Populated by T006: results of `npm run build`, `npm run test`, and `npm run test:e2e` against the
> pre-refactor codebase. Date and exit codes will be recorded here once captured.

| command | result | date | notes |
|---------|--------|------|-------|
| `npm run build` | pass | 2026-06-03 | game bundle 7.6mb, electron outputs generated |
| `npm run test` | pass | 2026-06-03 | 18 files / 69 tests passed in ~6.3s |
| `npm run test:e2e` | env-blocked | 2026-06-03 | `Process failed to launch!` on Electron — environment-level restriction in current CLI/headless context, not a code regression. Re-run locally on a normal desktop session. |

## Final Validation

> Populated by T076 after all slices complete.

| command | result | date | notes |
|---------|--------|------|-------|
| `npm run build` | pending | — | — |
| `npm run test` | pending | — | — |
| `npm run test:coverage` | pending | — | — |
| `npm run test:e2e` | pending | — | — |
