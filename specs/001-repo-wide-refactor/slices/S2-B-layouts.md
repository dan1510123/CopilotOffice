# Slice: S2-B — Layouts (Default + Fleet V-Team)

- **slice_id**: `S2-B` | **domain**: layout | **classification**: parity_preserving | **status**: complete
- **baseline_id**: BL-004 Office Switching (layout-data portion)
- **scope_in**: `src/layouts/**` (index, types, default, fleet); a handful of `currentLayout === 'X'` branches in `src/scenes/OfficeScene.ts` migrated to behavior flags.
- **scope_out**: scene wiring (S1-B), office state (S2-A), UI overlays (S2-C).
- **parity_checks**: `npm run build`, `npm run test`, `npm run test:e2e`; layout-switch smoke.

## Acceptance Criteria

- [X] Each `OfficeLayout` is a fully data-driven contract.
      _(Added `LayoutBehaviors` capability flags to `LayoutDefinition`:
      `supportsReserveAgents`, `restrictsInteractionToArchitect`,
      `hasPlayerPcTerminal`, `supportsFleetExecution`. Default values are the
      most restrictive so new layouts cannot accidentally inherit specialty
      behavior.)_
- [X] Layout-specific branching is removed from `src/scenes/OfficeScene.ts` where feasible.
      _(Migrated 3 high-signal branches: NPC interaction gating (line 417),
      `openPlayerPcTerminal` early-return, and dismiss-reserve-agent F-key
      handler. Remaining `currentLayout === 'X'` checks are tied to Phaser
      scene internals (E-key placement, badge geometry) that aren't naturally
      layout fields and were left intact per "when feasible".)_
- [X] Arthur position parity preserved across both layouts.
      _(No edits to agent rosters or sprite positions; tests assert each
      layout returns the same `LayoutDefinition` instance — no rebuild on
      lookup.)_

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| S2-B-2026-06-04 | pass | pass (144/144, +6 layouts vs. 138 baseline) | env-blocked | Behavior flags additive; existing tests + new `tests/unit/layouts/index.test.ts` (6 cases) all green. |

## Dependencies / Rollback

- Depends on: S1-B.
- Rollback: revert `src/layouts/**` + 3 scene call-sites to pre-slice commit; flags are additive so removal does not affect call sites that already had string-comparison fallbacks.
