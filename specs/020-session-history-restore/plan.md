# Implementation Plan: Restore a Previous Session from History

**Branch**: `020-session-history-restore` | **Date**: 2026-07-30 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/020-session-history-restore/spec.md`

## Summary

Make each session-history entry actionable: an operator clicks a past session,
confirms a dialog, and the agent's active session **swaps** to that archived
session. The formerly-current session is archived into history (reusing the
feature-019 title-snapshot archive path) and only the promoted entry is removed
from history — a reversible swap. Resume is **best-effort**: the target session
is relaunched via `copilot --session-id=<id>` (the same mechanism already used
to launch archived sessions on restart); when prior context cannot be confirmed
restored the operator sees an explicit "context may not be restored" state — never
a silent blank session.

Technical approach: a **new typed protocol message** `restore-session` wired
end-to-end in one change (protocol → server handler → ipc-relay → preload bridge
→ both renderer surfaces → test bridge mock — FR-015). The core swap/promote logic
is extracted into a **pure, unit-testable helper** `promoteHistoryEntry(history,
sessionId)` in `session-history.ts` (mirroring 019's `pushArchivedEntry`), so it
is testable without importing `server.ts` (which runs `main()` on import). The
server handler reuses the existing collision guard and `archiveSessionId()`, then
kills + restarts the PTY so it relaunches the target id.

## Technical Context

**Language/Version**: TypeScript (strict mode), targeting Electron main (Node) + renderer (DOM)
**Primary Dependencies**: Electron, node-pty, xterm.js, Phaser 3, Vitest
**Storage**: Per-office JSON session file `.data/copilot-office-sessions.json` (shape `{ current, history, metadata }`) — **no shape change**
**Testing**: Vitest (`npm run test`), jsdom for renderer/DOM helpers, unit tests for pure helpers
**Target Platform**: Windows desktop (Electron); PowerShell dev environment
**Project Type**: Desktop app (Electron main + PTY server child process + Phaser/DOM renderer)
**Performance Goals**: Interactive UI; a restore is a single user-gated operation — no throughput target. Swap must be O(history length)
**Constraints**: TypeScript strict (no `any`/unsafe casts); Phaser-first rendering (DOM only for overlays); all renderer↔main traffic through `preload.ts` bridge; session ID is the sole authoritative identifier
**Scale/Scope**: Small blast radius — 1 new protocol message, 1 new pure helper, 1 new server handler, bridge/relay/preload passthroughs, 2 renderer surfaces, 1 test-mock method

**Resolved decisions** (from spec `## Clarifications / Session 2026-07-29`, no open NEEDS CLARIFICATION):

- Best-effort resume with explicit "context may not be restored" advisory (FR-013).
- Reversible SWAP semantics (archive current → promote selected → remove only promoted) (FR-005/006/014).
- Mid-turn: warn harder, do NOT block (FR-016).
- Both surfaces clickable; restore disabled in read-only views (FR-011/017).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Phaser-first constraint respected** — no in-canvas renderer added. The clickable
  affordance + confirmation live entirely in the existing DOM history popovers
  (`sessionHistoryRender.ts`, `TerminalOverlay`, `SeriousTerminalController`).
- [x] **Event-driven boundaries preserved** — restore flows over one new typed request/response
  message (`restore-session`) end-to-end; no hidden cross-layer coupling, no side channels.
  IPC types stay in `protocol.ts` and are mirrored in `server.ts` + `ipc-relay.ts` (documented rule).
- [x] **Input focus transitions routed through `InputManager`** — no new global key handling; the
  confirmation is a scoped, ephemeral UI interaction. Existing overlay focus contract untouched.
- [x] **Session lifecycle integrity maintained** — reuses `archiveSessionId()` (title-before-clear,
  019), reuses the existing collision guard, keeps session ID as the sole identifier, and relaunches
  the target via `copilot --session-id=<id>` (the existing resume mechanism). Continuity across
  office switches/restarts preserved via unchanged persistence.
- [x] **Configuration-first approach** — no hardcoded per-agent/per-office special cases; the new
  operation is added to the typed message protocol, not as an ad hoc channel. Persisted record shape
  unchanged (only which id occupies current vs archived changes).
- [x] **Regression validation scope defined** — see Regression Plan in spec + Phase 1 contracts:
  confirm-swap, cancel no-op, round-trip, no-loss/no-dup, collision-graceful, id-copy-isolation,
  restart durability, resume-advisory, dual-surface parity, and end-to-end wiring (FR-015).

**Result: PASS (initial).** No violations; Complexity Tracking below intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/020-session-history-restore/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   └── restore-session.md
├── checklists/          # (pre-existing)
└── spec.md              # Feature specification (input)
```

### Source Code (repository root)

Files touched by this feature (existing files unless marked NEW):

```text
electron/terminal/
├── protocol.ts              # ADD MsgRestoreSession to MainToServer union
├── session-history.ts       # ADD pure helper promoteHistoryEntry() (unit-testable)
├── server.ts                # ADD `case 'restore-session'` handler (archive → set-current → promote → kill+restart PTY → save)
├── ipc-relay.ts             # ADD ipcMain.handle('terminal-restore-session', …) → request({ type:'restore-session', … })
└── preload.ts               # ADD restoreSession(...) bridge method + Window.copilotBridge type entry

src/ui/
├── sessionHistoryRender.ts        # ADD optional onSelect + readOnly options to row/list builders (id-span isolation preserved)
├── TerminalOverlay.ts             # WIRE onSelect → confirm dialog → restoreSession → refresh; gate on read-only; mid-turn warning
└── SeriousTerminalController.ts   # WIRE same onSelect → confirm → restoreSession → refresh; gate on read-only

tests/
├── setup/copilot-bridge-mock.ts   # ADD restoreSession mock (FR-015 shared mock)
├── unit/terminal/                 # NEW unit tests for promoteHistoryEntry()
└── unit/ui/ (or integration)      # NEW tests for row onSelect/read-only + confirm-swap/cancel-noop flows
```

**Structure Decision**: This is the established Electron-desktop layout — Electron
main/PTY-server code under `electron/terminal/`, renderer/DOM UI under `src/ui/`,
Vitest suites under `tests/`. No new top-level directories. The feature deliberately
mirrors the 019 extraction pattern: pure logic in `session-history.ts`, wiring in
`server.ts`, shared rendering in `sessionHistoryRender.ts`, parity across both
terminal surfaces.

## Complexity Tracking

> No constitution violations — this section is intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | _(n/a)_    | _(n/a)_                              |
