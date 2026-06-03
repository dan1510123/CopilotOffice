# Slice: S1-D — PTY Server and Preload Bridge (Electron Side)

## Identity

- **slice_id**: `S1-D`
- **name**: PTY Server and Preload Bridge
- **domain**: terminal
- **owner**: refactor-program
- **status**: proposed

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

- [ ] Sub-agent lifecycle forwarding does NOT depend on active terminal viewers (pitfall guard
      remains intact).
- [ ] Dual-key `activeAgentViewers` invariant is preserved (original key + new fleet key on
      attach; both cleaned up on detach); invariant documented in code comment.
- [ ] PATH sanitization and explicit `copilot` binary resolution remain protected and documented.
- [ ] Preload + protocol + server stay in lockstep (single coordinated change with S1-C).
- [ ] `window.copilotBridge` shape unchanged.

## Dependencies

- Pairs with: S1-C (must ship together).
- Blocks: S1-E (meeting/fleet relies on stable forwarding).

## Rollback Strategy

Revert `electron/terminal/**` and `electron/main.ts` terminal handlers to pre-slice commit.
Coordinate with S1-C rollback to keep renderer/server protocol aligned.

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
|        |       |      |     |       |

## Notes

Risks: R-001 (terminal renderer + server must ship together), R-002 (dual-key invariant).
Reference adaptations from `tracking/agency-cowork-notes.md` patterns 1, 3, 4.
