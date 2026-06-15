# Implementation Plan: Fix Terminal Cold-Start Bugs

**Branch**: `worktree-next-steps-20260603-133614` | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/002-fix-terminal-cold-start/spec.md`

## Summary

Three correlated cold-start bugs in the default office terminal stack:

1. **Shared session IDs across three fresh agents** — root cause is in the renderer pre-start sequence (`OfficeScene.preStartAgentSessions`, `src/scenes/OfficeScene.ts:2094`), not the server. The server's `case 'open'` path (`electron/terminal/server.ts:315–372`) correctly mints `crypto.randomUUID()` per `agentId` and persists to `.data/office-<id>.sessions.json`. The persisted file on disk shows three distinct UUIDs today, so the symptom must be an in-memory aliasing or a renderer-side reuse of one `agentId` for multiple calls. Suspect: `AGENTS.slice(0, 2)` pre-starts only the first two agents (`OfficeScene.ts:2111`), and the third (Alice) gets started lazily when the operator opens its terminal; if any of those three calls is dispatched with the same `agentId` (because of a closure or stale `currentAgentId` in `TerminalOverlay`), the server's reuse path returns the same `sessionId` it minted earlier. The fix has to make the pre-start sequence symmetric across all three agents and assert per-call `agentId` correctness.
2. **Input lock on two of three terminals** — TerminalOverlay holds a single `xterm.Terminal` instance and a single `currentAgentId` (`src/ui/TerminalOverlay.ts:33–34, 367–384`). When the user switches between agent terminals, `onData` is bound to `this.currentAgentId` (`TerminalOverlay.ts:1193–1224`); if the previous detach/attach handshake fails or the new attach loses the focus race (`focusTerminal()` at `TerminalOverlay.ts:1370–1395` delegates to `InputManager.focusTerminalXterm`), input falls through to either the wrong agent or nowhere. Fix: make detach idempotent, await the new attach before `terminal.focus()`, and ensure `currentAgentId`/`currentAgent` mutations are atomic with the xterm callback rebind.
3. **False "Startup timed out"** — `syncAgentStatuses` (`src/main.ts:1771–1795`) trips the 60s timeout when the agent's `subState === 'starting'` for too long. The transition into `ready` requires a `terminal-preload-status: ready` event keyed by `agentId` (`src/main.ts:1700–1716`). The server emits that event from `signalReady()` (`electron/terminal/server.ts:388–393`) only once per `ck = compositeKey(officeId, agentId)`. If two `open` calls collide on the same `agentId` (bug 1), only the first composite key's `agentReadyState` gets set and only one agent receives `ready`. Fix follows from bug 1; add a guard so a stale `starting` whose underlying PTY is alive does not produce a `Startup timed out` error.

### Approach

- **Phase A — Pin root causes**: instrument the cold-start path with structured logs (renderer side: every `terminalStart`/`terminalAttach` call with caller, `officeId`, `agentId`, awaited `sessionId`; server side: keep existing `New session GUID` / `Reusing session GUID` lines). Reproduce locally with a wiped `.data/` to confirm the renderer-side aliasing hypothesis.
- **Phase B — Repair `preStartAgentSessions`**: pre-start all three default agents (not the first two), sequentially or in `Promise.all` with per-agent error isolation, and assert distinct returned `sessionId`s.
- **Phase C — Repair input routing**: rework `TerminalOverlay.show()` so the detach → state mutation → attach → focus sequence is awaitable and serialized; gate `onData` writes on a captured `agentId` snapshot, not on the live `this.currentAgentId`.
- **Phase D — Repair startup-timeout logic**: in `syncAgentStatuses`, before flipping a `starting` agent to `error: 'Startup timed out'`, consult `serverStatus.alive`; if the PTY is alive, force a `setAgentReady` instead of an error, and log the recovery. Belt-and-suspenders for bug 1 leaving stale `starting` agents.
- **Phase E — Repair copy-from-terminal**: investigate `attachTerminalCopyListener` in both `TerminalOverlay` and `SeriousTerminalController` (`TerminalOverlay.ts:178`, `SeriousTerminalController.ts:609`). Apply the canonical xterm + Electron clipboard pattern (preventDefault on `Ctrl+C` when there is a selection, then write `terminal.getSelection()` to clipboard via the preload bridge or `navigator.clipboard`).
- **Phase F — Smoke tests**: add Vitest unit tests for the server's per-agent session-ID invariant and the `syncAgentStatuses` PTY-alive recovery; add a Playwright e2e that cold-boots, opens all three terminals, types per-agent markers, copies a selection, and asserts the four invariants. Use the same env-blocked marker convention as feature 001.

## Technical Context

**Language/Version**: TypeScript strict mode, Node 20+ (Electron 40).
**Primary Dependencies**: Electron, Phaser 3, xterm.js (`@xterm/xterm`, `@xterm/addon-fit`), node-pty, Vitest, Playwright.
**Storage**: JSON files under `.data/` — `copilot-offices.json` (office roster), `office-<id>.sessions.json` (per-office session map: `current` agentId→sessionId, `history`, `metadata`).
**Testing**: Vitest unit/integration (`npm run test`), Playwright e2e (`npm run test:e2e`).
**Target Platform**: Electron desktop app on Windows / macOS / Linux. Smoke tests target the platforms the existing 001 suite targets.
**Project Type**: Desktop app (renderer + Electron main + terminal server child process).
**Performance Goals**: Cold-start time-to-ready for the three default agents MUST NOT regress vs. baseline (SC-004). Status sync runs on a debounce; no new hot path.
**Constraints**: 60s `STARTING_TIMEOUT_MS` is the contract for "startup timed out" — the fix is to make the ready signal arrive correctly, not extend the window. Must preserve session continuity across office switches, meeting mode, and fleet orchestration (FR-012).
**Scale/Scope**: 3 default agents on cold start. Fix surface: ~4 source files (`server.ts`, `OfficeScene.ts`, `TerminalOverlay.ts`, `main.ts`) plus tests.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Phaser-first constraint respected**: no new in-canvas renderer; all changes in DOM overlay, terminal server, status sync, scene pre-start logic.
- [x] **Event-driven boundaries preserved**: keeps existing `game.events` channels (`agent:status:changed`, `agent:reattached`, `terminal:open/close`) and IPC contract in `electron/terminal/protocol.ts`. No new hidden coupling.
- [x] **Input focus transitions routed through `InputManager`**: focus changes in `TerminalOverlay.focusTerminal()` continue to delegate to `InputManager.focusTerminalXterm` and `InputManager.requestSwitch('terminal', ...)`. The fix tightens the sequencing around those calls but does not bypass them.
- [x] **Session lifecycle integrity maintained**: per-agent `sessionId` invariant strengthened, not weakened. Office-switch / meeting / fleet transfer paths (`server.ts` `transfer-session` and `agent-viewers.ts` dual-key logic) are read-only references — no changes to those handlers in the default-office fix.
- [x] **Configuration-first approach used for agents/layouts/feature flags**: roster comes from `AGENTS` in `src/config/agents.ts`; the fix removes the `slice(0, 2)` hardcoded count and iterates the roster instead.
- [x] **Regression validation scope defined**: new Vitest + Playwright smoke tests (FR-010/011 in spec) cover the cold-start invariants and copy-from-terminal.

No violations to track in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/002-fix-terminal-cold-start/
├── plan.md              # This file
├── spec.md              # Feature spec (already written)
├── research.md          # Phase 0 — RCA + decisions
├── data-model.md        # Phase 1 — session/state entities
├── quickstart.md        # Phase 1 — how to repro + verify the fix
├── contracts/
│   └── terminal-protocol.md  # Phase 1 — observable contract delta (additive only)
├── checklists/
│   └── requirements.md  # Spec quality checklist (from /speckit.specify)
└── tasks.md             # Phase 2 — created later by /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── main.ts                              # syncAgentStatuses (Phase D), agent preload status routing
├── scenes/
│   └── OfficeScene.ts                   # preStartAgentSessions (Phase B)
├── ui/
│   ├── TerminalOverlay.ts               # currentAgentId/show/onData/focusTerminal (Phase C); copy listener (Phase E)
│   └── SeriousTerminalController.ts     # copy listener (Phase E)
├── input/
│   └── InputManager.ts                  # consulted only; no changes expected
└── config/
    └── agents.ts                        # AGENTS roster — read; iterated instead of sliced

electron/
└── terminal/
    ├── server.ts                        # Read for RCA confirmation; targeted log/guard changes only if RCA shifts here
    ├── protocol.ts                      # Read only — no IPC contract changes planned
    ├── preload.ts                       # Read only
    └── agent-viewers.ts                 # Read only — dual-key viewer logic stays as-is

tests/
├── integration/
│   └── terminal/
│       ├── server-cold-start.test.ts    # NEW — per-agent sessionId invariant, persisted file round-trip
│       ├── sync-agent-statuses.test.ts  # NEW — PTY-alive guard against false Startup timed out
│       └── TerminalOverlay.test.ts      # EXTENDED — agent switch input routing
└── e2e/
    └── default-office-cold-start.spec.ts # NEW — Playwright: 3 distinct sessions, input echo, copy works, no false timeout

.data/                                    # Local persisted state; tests use a tmp workspace, not this dir
```

**Structure Decision**: Single-project Electron desktop layout already in place. The fix touches four production files and adds three test files. No new modules or packages.

## Complexity Tracking

No constitution violations — section intentionally empty.
