# Slice: S1-D — PTY Server and Preload Bridge (Electron Side)

## Identity

- **slice_id**: `S1-D`
- **name**: PTY Server and Preload Bridge
- **domain**: terminal
- **owner**: refactor-program
- **status**: complete

## Classification

- **classification**: parity_preserving
- **approval_record**: N/A

## Scope

### scope_in

- `electron/terminal/server.ts`
- `electron/terminal/preload.ts`
- `electron/terminal/protocol.ts`
- `electron/terminal/event-source.ts`
- `electron/terminal/events-watcher.ts`
- `electron/terminal/ipc-relay.ts`
- `electron/terminal/terminal-backend.ts`
- `electron/terminal/agent-viewers.ts` _(NEW — extracted dual-key invariant)_
- Terminal-related IPC handlers in `electron/main.ts`

### scope_out

- Non-terminal window/IPC handlers in `electron/main.ts` (S2-F)
- Renderer-side terminal module (S1-C, paired)
- Fleet orchestration logic (S1-E)

## Behavior Baseline

- **baseline_id**: BL-003 Terminal Lifecycle; BL-007 Sub-Agent Lifecycle Forwarding.
- **parity_checks**: `npm run build`, `npm run test`, `npm run test:e2e` (terminal smoke),
  manual fleet session transfer smoke.

## Acceptance Criteria

- [X] Sub-agent lifecycle forwarding does NOT depend on active terminal viewers (pitfall guard
      remains intact). _(server.ts `isFleetCriticalEvent` branch forwards
      `subagent.*`, `system.notification`, and `tool.execution_start` for the
      `task` tool regardless of `hasActiveViewer`; comment explains the
      FleetTracker detach race.)_
- [X] Dual-key `activeAgentViewers` invariant is preserved (original key + new fleet key on
      attach; both cleaned up on detach); invariant documented in code comment.
      _(Extracted to `electron/terminal/agent-viewers.ts` with named
      `addAgentViewer` / `removeAgentViewer` / `hasActiveViewer` and a header
      comment block; attach/detach IPC handlers route through it; behaviour
      covered by `tests/unit/terminal/agentViewers.test.ts`.)_
- [X] PATH sanitization and explicit `copilot` binary resolution remain protected and documented.
      _(No edits to `resolveCopilotCliPath` / `sanitizeCopilotPath` in
      `terminal-backend.ts`; still imported by server.ts.)_
- [X] Preload + protocol + server stay in lockstep (single coordinated change with S1-C).
      _(No protocol or preload edits in this slice; build passes for both
      `preload.ts` and `server.ts` in the same `npm run build:electron` run.)_
- [X] `window.copilotBridge` shape unchanged.

## Dependencies

- Pairs with: S1-C (must ship together).
- Blocks: S1-E (meeting/fleet relies on stable forwarding).

## Rollback Strategy

Revert `electron/terminal/**` and `electron/main.ts` terminal handlers to pre-slice commit.
Coordinate with S1-C rollback to keep renderer/server protocol aligned.

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| S1-C+S1-D-2026-06-03 | pass | pass (94/94, +9 agentViewers + 11 toolStatus vs. 74 baseline) | env-blocked | `npm run test:e2e` fails identically to baseline ("Process failed to launch!"); re-run on a desktop session. Paired ship with S1-C. FleetTracker `sourceOfficeId`-driven silent attach in `src/meeting/fleetTracker.ts` confirmed still present (out of scope for this slice; will be re-evaluated in S1-E). |

## Notes

Risks: R-001 (terminal renderer + server must ship together), R-002 (dual-key invariant).
Reference adaptations from `tracking/agency-cowork-notes.md` patterns 1, 3, 4.
