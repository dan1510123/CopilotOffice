# Slice: S1-E — Meeting Mode and Fleet Orchestration

## Identity

- **slice_id**: `S1-E`
- **name**: Meeting Mode and Fleet Orchestration
- **domain**: meeting
- **owner**: refactor-program
- **status**: complete

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

- [X] Spawn → track → visualize → teardown contract documented in-file for each fleet module.
      _(Header docblocks added to `fleetOrchestrator.ts`, `fleetTracker.ts`, and
      `fleetVisualizer.ts` naming each module's phase, the inter-module
      pipeline, and explicit boundary rules. See module headers.)_
- [X] FleetTracker `sourceOfficeId` attach (belt-and-suspenders for dual-key invariant) is
      preserved unless replaced by an equivalent server-side guarantee in S1-D.
      _(Preserved by user decision (2026-06-03) — defense in depth. The
      FleetTracker header now documents how it composes with the server-side
      dual-key invariant from S1-D: server mirrors viewer registrations across
      alias keys and forwards `isFleetCriticalEvent` payloads unconditionally;
      FleetTracker adds a silent attach + 10s periodic re-attach as a renderer
      safety net.)_
- [X] Plan parsing covered by Vitest fixtures (happy path + malformed).
      _(`tests/unit/meeting/planParser.test.ts` — 18 cases covering
      `stripAnsi`, `extractJsonBlocks`, `validateMeetingPlan`, and
      `parsePlanFromOutput` with malformed JSON, missing fields, invalid
      agentIds, custom allowlists, and the first-valid-wins fallback.)_
- [X] Plan approval covered by Vitest (accept/reject paths).
      _(`tests/unit/meeting/planApproval.test.ts` — 7 cases covering DOM
      render, approve, cancel, revise → send / back, empty feedback
      suppression, and unknown-agent display fallback.)_

## Dependencies

- Depends on: S1-C and S1-D (stable terminal lifecycle).
- Blocks: nothing in P1.

## Rollback Strategy

Revert `src/meeting/**` and any MeetingScene plan/approval changes to pre-slice commit.

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| S1-E-2026-06-03 | pass | pass (125/125, +18 planParser + 7 planApproval vs. 100 baseline) | env-blocked | `tests/e2e/meeting-fleet.e2e.ts` authored; both e2e tests fail with the same baseline "Process failed to launch!" — re-run on a desktop session. Added `window.__phaserGame` diagnostic handle so the spec can dispatch fleet:deploy-requested without screen scripting. |

## Notes

MANDATORY: read `MeetingMode.md` before editing. Risk R-002 mitigated server-side by
S1-D's `agent-viewers.ts` dual-key invariant; FleetTracker's silent attach +
periodic re-attach is preserved as defense in depth (user decision 2026-06-03).
