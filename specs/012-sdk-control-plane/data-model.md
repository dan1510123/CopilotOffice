# Phase 1 Data Model: SDK Control Plane (Variant 1)

**Feature**: `012-sdk-control-plane` | **Date**: 2026-07-08

This feature is control-plane state, not persisted business data. Entities below describe in-memory
runtime state in the Electron terminal server plus the existing persisted session identity.

## Entities

### Hosted Runtime
A `copilot --ui-server --port 0` process launched inside node-pty, one **per office**.
- **Attributes**: `officeId`, `ptyProcess` (node-pty handle), `pid`, `controlPort` (discovered from
  `listening on port <N>`), `status` (`launching` → `listening` → `ready` → `crashed` → `stopped`),
  `renderForegroundSessionId`.
- **Owns**: authentication (launched with the app's auth environment).
- **Renders**: exactly one foreground session's TUI at a time.
- **Relationships**: 1 office → 1 hosted runtime; 1 runtime → N agent sessions.

### Control-Plane Client
An SDK `CopilotClient` attached to a Hosted Runtime via `RuntimeConnection.forUri('localhost:<port>')`.
- **Attributes**: `officeId`, `client`, `connectionStatus`.
- **Constraints**: created **without** `useLoggedInUser`/`gitHubToken` (runtime owns auth).
- **Operations**: `createSession`, `resumeSession`, `listSessions`, `setForegroundSessionId`,
  `getForegroundSessionId`.
- **Relationships**: 1 hosted runtime → 1 control-plane client.

### Agent Session
The persistent conversation identity for an agent within an office.
- **Attributes**: `sessionId` (existing per-agent GUID from office session files), `officeId`,
  `agentId`, `sdkSession` (SDK `CopilotSession`), `ready` (readiness gate), `inTurn`.
- **Persistence**: GUID stored in `.data/*` office session maps (unchanged); conversation state
  under `~/.copilot`.
- **Operations**: `send({ prompt, mode:'enqueue' })` (programmatic only), `session.on(...)`,
  `disconnect` (detach, not delete).
- **Relationships**: N agent sessions multiplexed on 1 hosted runtime; 1:1 with an agent per office.

### Foreground Selection
Which Agent Session a Hosted Runtime currently renders.
- **Attributes**: `officeId`, `foregroundSessionId`.
- **Transitions**: user switches visible agent → `setForegroundSessionId(guid)` → TUI redraws.

### Backend Selection (config)
Typed setting choosing the terminal backend.
- **Values**: `node-pty` (default, legacy fallback), `ui-server` (Variant 1), `sdk` (legacy headless).
- **Rule**: selecting `ui-server` requires a passing capability probe; otherwise auto-fallback to
  `node-pty`.

## Lifecycle / state transitions

```
Office opened
  → launch Hosted Runtime (node-pty: copilot --ui-server --port 0)
  → status: launching → listening (port discovered) → ready
  → attach Control-Plane Client (forUri localhost:port)
  → for each agent: createSession(guid) OR resumeSession(guid)   [readiness gate before input]
  → user selects agent → setForegroundSessionId(guid)            [TUI renders that agent]
  → human types → PTY stdin → TUI (native)                        [FR-017]
  → programmatic prompt → session.send(enqueue)                   [FR-004/019 ordered, preserves human line]
  → status/tool/turn/assistant events → session.on → CopilotEvent [FR-006]
Office switched away
  → detach sessions (disconnect, NOT delete) — session GUID preserved [FR-012]
Runtime crash
  → surface via error channel; relaunch office runtime; resumeSession by GUID [per-office blast radius]
Office closed / shutdown
  → disconnect sessions; stop client; kill hosted runtime PTY (own PID)
```

## Invariants

- Session identity (GUID) is stable across attach/detach/resume and office switches (Constitution III).
- One foreground session per hosted runtime; background sessions remain live for events.
- No input is delivered to a session before it signals ready (FR-020).
- Programmatic sends never splice into or clear a human's unsubmitted input (FR-019/SC-007).
- Fleet-critical events (`subagent.*`, `system.notification`, task `tool.execution_start`) forward
  even without an attached viewer (unchanged guarantee).
