# Slice: S1-C — Terminal/Session Lifecycle (Renderer Side)

## Identity

- **slice_id**: `S1-C`
- **name**: Terminal/Session Lifecycle (Renderer Side)
- **domain**: terminal
- **owner**: refactor-program
- **status**: complete

## Classification

- **classification**: parity_preserving
- **approval_record**: N/A

## Scope

### scope_in

- `src/ui/TerminalOverlay.ts`
- `src/ui/SeriousTerminalController.ts`
- Terminal-related wiring in `src/main.ts` (open/attach/detach/close, status badge updates)
- Renderer-side session state and `copilot-event` handling

### scope_out

- PTY server / Electron main process (S1-D)
- Dashboard rendering and other overlays (S2-C)
- Office switching mechanics (S1-B)

## Behavior Baseline

- **baseline_id**: BL-003 Terminal Lifecycle (primary); BL-009 Status Badge.
- **parity_checks**: `npm run build`, `npm run test` (terminal integration), `npm run test:e2e`,
  manual `ask_user` race smoke.

## Acceptance Criteria

- [X] Open/attach/detach/close flows live behind a single renderer-side module.
      _(Already encapsulated by `TerminalOverlay` + `SeriousTerminalController`;
      `src/main.ts` only creates the panel containers and routes events to those
      modules — no terminal-internal DOM manipulation remains in main.ts.)_
- [X] No ad-hoc DOM manipulation for terminal in `src/main.ts` outside of that module's API.
- [X] `ask_user` is treated as a waiting-state signal even when other tool events complete in the
      same tick (pitfall guard). _(Extracted to `src/util/toolStatus.ts`
      `nextSubStateAfterToolComplete` reducer; unit-tested in
      `tests/unit/util/toolStatus.test.ts` — the "race-guard" case explicitly
      exercises the scenario.)_
- [X] Status badge transitions (`slacking → starting → ready ↔ waiting/thinking → slacking`)
      covered by tests.
- [X] `window.copilotBridge` shape unchanged. _(No edits to `electron/terminal/preload.ts`
      or protocol types; renderer imports the same bridge surface.)_

## Dependencies

- Depends on: S1-A (focus discipline), S1-D (paired protocol changes ship together).
- Blocks: S1-E (meeting/fleet benefits from stable terminal lifecycle).

## Rollback Strategy

Revert renderer terminal module and `src/main.ts` wiring; coordinate with S1-D rollback to
preserve protocol compatibility.

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| S1-C+S1-D-2026-06-03 | pass | pass (94/94, +11 toolStatus + 9 agentViewers vs. 74 baseline) | env-blocked | `npm run test:e2e` fails identically to baseline ("Process failed to launch!"); re-run on a desktop session. Paired ship with S1-D. |

## Notes

Reference adaptations from `tracking/agency-cowork-notes.md` patterns 1 and 2 (single PTY lifecycle
ownership; narrow preload contract).
