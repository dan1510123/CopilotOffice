# Slice: S1-A — Input Focus and Keyboard Routing

## Identity

- **slice_id**: `S1-A`
- **name**: Input Focus and Keyboard Routing
- **domain**: input
- **owner**: refactor-program
- **status**: complete

## Classification

- **classification**: parity_preserving
- **approval_record**: N/A

## Scope

### scope_in

- `src/input/InputManager.ts`
- `src/input/GameInputListener.ts`
- `src/input/TerminalInputListener.ts`
- `src/input/GlobalInputListener.ts`
- Focus-related wiring in `src/main.ts`
- Any direct Phaser keyboard manipulation found in `src/scenes/**` or `src/ui/**` that should
  be migrated through `InputManager`.

### scope_out

- New input states beyond `game`/`terminal`.
- Keybinding changes (E, F10, Escape, WASD, Shift, Ctrl+Shift+N).
- Renderer/overlay business logic unrelated to focus.

## Behavior Baseline

- **baseline_id**: BL-008 Input Focus Transitions (primary); BL-001 Player Movement (secondary,
  to ensure sprint/movement keys still route via InputManager).
- **parity_checks**: `npm run build`, `npm run test` (input + integration), manual focus smoke.
  Optional: `npm run test:e2e`.

## Architectural Note (added during scoping)

Audit of `src/scenes/**`, `src/entities/**`, and `src/ui/**` showed that the existing focus
architecture is NOT "InputManager owns all key registrations" — it is **focus-gating via
`scene.input.keyboard.enabled`**. `GameInputListener` toggles the keyboard's `enabled` flag and
`addCapture` set; every other component (Player, OfficeScene E/F keys, mini-games' ESC/SPACE,
DialogBox) registers its own keys against the same gated keyboard instance. Switching focus to
`terminal` disables the keyboard wholesale, which gates all consumers at once.

This is a working contract. The S1-A acceptance criteria are scoped accordingly: enforce the
focus-gating contract and overlay save/restore, NOT a wholesale migration of key registration.
Any wholesale centralization would be `behavior_altering` and require an ApprovalRecord.

## Acceptance Criteria

- [X] Focus-gating contract documented in-code at the top of `src/input/InputManager.ts`:
      "Switching focus toggles `scene.input.keyboard.enabled`; consumers register their own keys
      against the same gated instance."
- [X] Two-state focus contract (`game` ↔ `terminal`) preserved; no new states.
- [X] Every overlay (settings, mini-game, terminal) requests focus through `InputManager` on open
      and restores prior focus on close — verified by Vitest.
- [X] No NEW direct `scene.input.keyboard.enabled` toggles outside `src/input/**` are introduced
      (existing per-component `addKey` calls are allowed under the gating contract).
- [X] `tests/unit/input/*.test.ts` extended to cover overlay focus save/restore.
- [X] Full test suite passes.

## Dependencies

- Depends on: Phase 2 baselines complete.
- Blocks: S1-B (scene), S1-C (terminal renderer) prefer this lands first.

## Rollback Strategy

If parity fails: revert `src/input/**` and `src/main.ts` focus wiring to pre-slice commit.
Re-open InputManager refactor as a smaller sub-slice. No data persistence is involved.

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| 2026-06-03-S1A | pass | pass 74/74 (~8.4s) | env-blocked (skipped) | Build: game bundle 7.6mb. Unit baseline was 69; +5 tests added in `tests/unit/input/OverlayFocusRestore.test.ts`. `npm run test:e2e` not run — Electron launch is restricted in the current CLI/headless context (same env limitation captured in baseline). |

## Notes

Pitfall reference: see `.github/copilot-instructions.md` "Regression-Prone Pitfalls" — overlay
focus restoration is a recurring regression source.
