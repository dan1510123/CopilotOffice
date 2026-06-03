# Slice: S1-B — Scene Lifecycle and Office Switching

## Identity

- **slice_id**: `S1-B`
- **name**: Scene Lifecycle and Office Switching
- **domain**: scene
- **owner**: refactor-program
- **status**: complete

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

- [X] No hardcoded agent IDs in `src/scenes/**` (per pitfall note); rosters come from config + officeManager.
- [X] Boot → Office → Meeting transitions documented in-file.
- [X] `office:switch` preserves agent state, sprite metadata, and dashboard cards across both
      `default` and `fleet-vteam` layouts.
- [X] Full test suite passes; e2e smoke passes (or env-blocked status documented).

## Dependencies

- Depends on: S1-A (preferred; cleaner focus contract).
- Blocks: S2-A, S2-B benefit from this landing first.

## Rollback Strategy

Revert `src/scenes/**` and any modified office-switch wiring in `src/main.ts` to pre-slice commit.

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| 2026-06-03 | pass | pass 74/74 | env-blocked | esbuild 7.6mb, vitest 19 files / 74 tests in ~6.6s; e2e blocked in CLI/headless (same as baseline). |

## Notes

Risks: R-003 (hardcoded agent IDs may exist beyond the documented case).

### Audit (T021)
Pre-change grep of `src/scenes/**` for literal agent IDs from `src/config/agents.ts`
(`generalist`, `debugger`, `admin`, `architect`, `azure`, `validator`, `deployer`,
`doctor`, `scout`, `accountant`) found **only** `'architect'`:
- `src/scenes/MeetingScene.ts:98, 284, 318`
- `src/scenes/OfficeScene.ts:234, 243, 257, 393, 1993, 2011, 2012, 2391, 2403`

Mitigation: introduced `ARCHITECT_AGENT_ID` constant in `src/config/agents.ts`
(single source of truth). All scene references now import that constant. Post-change
grep returns zero hits. Sprite texture keys (e.g. `'npc_architect'`) in
`BootScene.ts` are intentionally left as asset identifiers (not agent IDs).
