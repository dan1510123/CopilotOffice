# Contract: UI-Server Terminal Backend

**Feature**: `012-sdk-control-plane` | **Date**: 2026-07-08

Defines the behavior the new `UiServerBackend` must satisfy to plug into the existing
`electron/terminal/terminal-backend.ts` `TerminalBackend` / `TerminalProcess` abstraction, plus the
per-office runtime lifecycle and fallback rules. This is an internal TypeScript contract (no
network API surface).

## `TerminalBackend` (existing interface — new implementation)

```
name: 'ui-server'
isAvailable(): boolean          // true only if the capability probe passed
start(options): Promise<TerminalProcess>
```

**Behavioral requirements**

1. `isAvailable()` MUST reflect a capability probe of the resolved CLI (`--ui-server` accepted vs
   "unknown option"). If unavailable, the server MUST fall back to `node-pty` (FR-010) and never
   surface a user-facing error.
2. `start(options)` MUST:
   - Reuse (or lazily launch) the **per-office** Hosted Runtime for `options.officeId`:
     `copilot --ui-server --port 0` inside node-pty, launched with the app's auth environment and
     sanitized PATH (reuse `sanitizeCopilotPath`).
   - Discover the control port from runtime stdout (`/listening on port (\d+)/i`).
   - Attach a single Control-Plane Client per office via `RuntimeConnection.forUri('localhost:<port>')`
     **without** `useLoggedInUser`/`gitHubToken`.
   - Create or resume the agent's session by its existing GUID (`options.sessionId`).
   - Return a `TerminalProcess` bound to that agent session.

## `TerminalProcess` (existing interface — new implementation)

```
pid: number                      // synthetic per-agent id (NOT an OS PID → never force-killed)
write(data): void                // human keystrokes → PTY stdin of the hosted runtime (foreground)
resize(cols, rows): void         // resize the hosting PTY
onData(cb): void                 // TUI bytes for the foreground agent → xterm
onExit(cb): void
kill(): void                     // detach this agent session (disconnect, not delete)
submitPrompt(text, label?): void // programmatic submit via SDK session.send({ prompt, mode:'enqueue' })
```

**Behavioral requirements**

3. `submitPrompt` MUST call `session.send({ prompt, mode: 'enqueue' })` (atomic, multi-line safe)
   and MUST NOT disturb any unsubmitted human input line (FR-019). `label` is display-only and is
   never included in the text sent to the agent.
4. `write` (human input) MUST route to the hosted runtime's PTY stdin for the **foreground** agent
   and MUST be gated on session readiness (FR-020).
5. `onData` MUST deliver TUI bytes for the currently foreground agent to the renderer via the
   existing `terminal-data` path; background agents produce events (not bytes).
6. `kill` MUST `disconnect` the SDK session (preserve on-disk history for later resume); it MUST NOT
   `deleteSession`. It MUST NOT force-kill the shared per-office runtime (other agents depend on it).

## Per-office runtime lifecycle

7. Foreground switch: when the user selects a different agent in the same office, the backend MUST
   call `setForegroundSessionId(guid)` so the hosted runtime's TUI renders that agent.
8. Office switch away: sessions MUST detach (not kill); the runtime MAY remain or be torn down per
   office lifecycle, but session GUIDs MUST remain resumable (FR-012, Constitution III).
9. Runtime crash: the backend MUST surface the failure via structured error/logging channels and
   support relaunching the office runtime and resuming sessions by GUID (per-office blast radius).
10. Shutdown: disconnect all sessions, stop the client, then kill the hosted runtime PTY by its own
    PID only (never name-based).

## Fallback & selection

11. Backend selection is a typed setting (`node-pty` | `ui-server` | `sdk`), default `node-pty`.
12. `sdk` (headless Variant-2) remains available but is out of scope for this feature.
13. Shell-only mode (`launchMode: 'shell'`) continues to require the `node-pty` backend.
