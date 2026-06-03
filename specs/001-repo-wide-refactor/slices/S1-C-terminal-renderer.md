# Slice: S1-C — Terminal/Session Lifecycle (Renderer Side)

## Identity

- **slice_id**: `S1-C`
- **name**: Terminal/Session Lifecycle (Renderer Side)
- **domain**: terminal
- **owner**: refactor-program
- **status**: proposed

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

- [ ] Open/attach/detach/close flows live behind a single renderer-side module.
- [ ] No ad-hoc DOM manipulation for terminal in `src/main.ts` outside of that module's API.
- [ ] `ask_user` is treated as a waiting-state signal even when other tool events complete in the
      same tick (pitfall guard).
- [ ] Status badge transitions (`slacking → starting → ready ↔ waiting/thinking → slacking`)
      covered by tests.
- [ ] `window.copilotBridge` shape unchanged.

## Dependencies

- Depends on: S1-A (focus discipline), S1-D (paired protocol changes ship together).
- Blocks: S1-E (meeting/fleet benefits from stable terminal lifecycle).

## Rollback Strategy

Revert renderer terminal module and `src/main.ts` wiring; coordinate with S1-D rollback to
preserve protocol compatibility.

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
|        |       |      |     |       |

## Notes

Reference adaptations from `tracking/agency-cowork-notes.md` patterns 1 and 2 (single PTY lifecycle
ownership; narrow preload contract).
