# Slice: S1-E — Meeting Mode and Fleet Orchestration

## Identity

- **slice_id**: `S1-E`
- **name**: Meeting Mode and Fleet Orchestration
- **domain**: meeting
- **owner**: refactor-program
- **status**: proposed

## Classification

- **classification**: parity_preserving
- **approval_record**: N/A

## Scope

### scope_in

- `src/meeting/fleetOrchestrator.ts`
- `src/meeting/fleetTracker.ts`
- `src/meeting/fleetVisualizer.ts`
- `src/meeting/planApproval.ts`
- `src/meeting/planParser.ts`
- `src/meeting/types.ts`
- Plan/approval interactions inside `src/scenes/MeetingScene.ts`

### scope_out

- Scene shell lifecycle (S1-B owns MeetingScene scaffolding)
- Terminal lifecycle (S1-C/S1-D)
- Office persistence (S2-A)

## Behavior Baseline

- **baseline_id**: BL-005 Meeting Mode Entry; BL-006 Fleet Orchestration.
- **parity_checks**: `npm run build`, `npm run test` (incl. new parser/approval tests),
  optional `npm run test:e2e`.

## Acceptance Criteria

- [ ] Spawn → track → visualize → teardown contract documented in-file for each fleet module.
- [ ] FleetTracker `sourceOfficeId` attach (belt-and-suspenders for dual-key invariant) is
      preserved unless replaced by an equivalent server-side guarantee in S1-D.
- [ ] Plan parsing covered by Vitest fixtures (happy path + malformed).
- [ ] Plan approval covered by Vitest (accept/reject paths).

## Dependencies

- Depends on: S1-C and S1-D (stable terminal lifecycle).
- Blocks: nothing in P1.

## Rollback Strategy

Revert `src/meeting/**` and any MeetingScene plan/approval changes to pre-slice commit.

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
|        |       |      |     |       |

## Notes

MANDATORY: read `MeetingMode.md` before editing. Risk R-002 partially mitigated by FleetTracker
belt-and-suspenders attach.
