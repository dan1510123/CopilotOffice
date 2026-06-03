# Slice: S1-B — Scene Lifecycle and Office Switching

## Identity

- **slice_id**: `S1-B`
- **name**: Scene Lifecycle and Office Switching
- **domain**: scene
- **owner**: refactor-program
- **status**: proposed

## Classification

- **classification**: parity_preserving
- **approval_record**: N/A

## Scope

### scope_in

- `src/scenes/BootScene.ts`
- `src/scenes/OfficeScene.ts`
- `src/scenes/MeetingScene.ts` (shell only; plan/approval interactions belong to S1-E)
- `office:switch` event chain in `src/main.ts`
- Scene-level consumption of `src/office/officeManager.ts` and `src/layouts/**`

### scope_out

- Layout content/data (S2-B owns layouts)
- Office persistence (S2-A owns office state)
- Meeting plan/approval logic (S1-E)

## Behavior Baseline

- **baseline_id**: BL-001, BL-002, BL-004
- **parity_checks**: `npm run build`, `npm run test`, `npm run test:e2e`, manual office-switch smoke.

## Acceptance Criteria

- [ ] No hardcoded agent IDs in `src/scenes/**` (per pitfall note); rosters come from config + officeManager.
- [ ] Boot → Office → Meeting transitions documented in-file.
- [ ] `office:switch` preserves agent state, sprite metadata, and dashboard cards across both
      `default` and `fleet-vteam` layouts.
- [ ] Full test suite passes; e2e smoke passes (or env-blocked status documented).

## Dependencies

- Depends on: S1-A (preferred; cleaner focus contract).
- Blocks: S2-A, S2-B benefit from this landing first.

## Rollback Strategy

Revert `src/scenes/**` and any modified office-switch wiring in `src/main.ts` to pre-slice commit.

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
|        |       |      |     |       |

## Notes

Risks: R-003 (hardcoded agent IDs may exist beyond the documented case).
