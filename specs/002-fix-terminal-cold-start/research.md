# Phase 0 Research: Fix Terminal Cold-Start Bugs

All NEEDS CLARIFICATION items from the plan template have been resolved. This document captures the root-cause analysis and the design decisions driving Phase 1 artifacts.

## R1. Shared session-ID symptom

### Decision
The renderer is the proximate source of the shared-session-ID symptom, not the server. The fix lives primarily in `src/scenes/OfficeScene.ts` (`preStartAgentSessions`) and `src/ui/TerminalOverlay.ts` (`show`, `handleNewSession`, `onData`). The server-side `case 'open'` path is correct as written.

### Rationale
- Server: `electron/terminal/server.ts:315–372` keys both the PTY map and the persisted `sessionId` by `(officeId, agentId)`. On a missing entry it calls `crypto.randomUUID()` once per `agentId` and writes the file (`saveOfficeSessionFile(officeId)`). The `compositeKey` is `${officeId}:${agentId}` (line 90), and `terminalKey = ck` (line 334), so two different agentIds in the same office cannot collide.
- Disk state confirms the server is doing the right thing: on this checkout, `.data/office-0.sessions.json` contains three distinct UUIDs for `generalist`, `debugger`, and `admin`.
- Renderer: `OfficeScene.preStartAgentSessions` (line 2094) pre-starts only `AGENTS.slice(0, 2)` (line 2111). The third agent is created lazily when the user clicks it. If the lazy path is taken from `TerminalOverlay.show()` while `currentAgentId` is still set to a sibling agent (focus race or stale state), the call goes to the server with the wrong `agentId` and the server happily returns the sibling's reused `sessionId`. This matches the user's report exactly: three opens, one effective `sessionId`, two "locked" terminals because the underlying PTY is one process, not three.

### Alternatives considered
- **Persisted-file collision** (rejected — file currently has distinct UUIDs; no migration of a known-bad shape required, but we will add defensive de-duplication on load).
- **Dual-key viewer logic from S1-D** introducing key swap (rejected for the default office — that code lives in the `transfer-session` handler and only fires for fleet transitions, not cold start).
- **`crypto.randomUUID()` non-uniqueness** (rejected — implausible).

## R2. Input-lock symptom

### Decision
`TerminalOverlay.show()` must serialize the detach → state mutation → attach → focus sequence and capture `agentId` into local closures so `terminal.onData` cannot write to the wrong agent during a switch.

### Rationale
- `TerminalOverlay` holds a single `xterm.Terminal` instance and a single `currentAgentId` (lines 33–34). `show(agent)` (line 367) sets `this.currentAgentId = agent.id` and `this.currentAgent = agent` before awaiting `terminalAttach` (line 503). Between the assignment and the attach completion, any `onData` event still uses the new `currentAgentId`, but the PTY data callback on the server may still be flowing to the previously-attached agent because detach is best-effort (line 1485, `.catch(() => {})`).
- `focusTerminal()` (line 1370) delegates to `InputManager.focusTerminalXterm(this.terminal)`. If the previous detach has not yet completed, the InputManager request can be serialized against an `IsInputBlocked()` predicate and silently dropped, leaving keystrokes routed to the canvas (game) instead of the terminal — matching "appears locked."
- The fix is sequencing, not a rewrite of `InputManager`. We will (a) `await terminalDetach(...)` before mutating `currentAgentId`, (b) snapshot `agentId` into the closure passed to `terminal.onData`, and (c) only call `focusTerminal()` after `terminalAttach` resolves.

### Alternatives considered
- **One xterm per agent** (rejected — fundamental layout change, blast radius too large for a bug fix, and conflicts with the existing serious-mode design that intentionally uses a single panel).
- **Per-agent `onData` registration that is detached on switch** (kept as a fallback if the simpler closure snapshot is insufficient under stress).

## R3. False "Startup timed out"

### Decision
In `syncAgentStatuses` (`src/main.ts:1789–1795`), before transitioning a `starting` agent to `error: 'Startup timed out'`, check `serverStatus.alive`. If the PTY is alive, force the agent to `ready` (with a warn log) instead of erroring. This is a defensive guard; the primary fix is R1 (per-agent ready signal arrives when there is no `sessionId` collision).

### Rationale
- The ready transition is gated on the renderer receiving `terminal-preload-status: { agentId, status: 'ready' }` (server emits at `server.ts:393`). That event fires from `signalReady()` once per composite key `ck`. With R1 fixed, all three agents get their own `ck` and their own `signalReady()`, so the event arrives for each agent.
- A defensive guard in `syncAgentStatuses` still makes sense because:
  - It prevents future regressions in the server's event emission from silently degrading status reporting.
  - It surfaces a clear warning in console when the protective branch fires, which makes future debugging cheaper.
- The 60s window remains the operator-facing contract (spec Assumptions). We do not change `STARTING_TIMEOUT_MS`.

### Alternatives considered
- **Extending the timeout window** (rejected — masks the real bug; spec explicitly assumes the 60s window stays).
- **Removing the timeout entirely** (rejected — a truly dead process should still surface as an error).

## R4. Copy-from-terminal

### Decision
Use the canonical xterm + Electron clipboard pattern: in `attachCustomKeyEventHandler`, intercept the platform-standard copy combo when a selection is present, prevent the default terminal-interrupt path, read `terminal.getSelection()`, and write to the system clipboard via `navigator.clipboard.writeText` (renderer can do this directly because the Electron BrowserWindow already has clipboard read/write permission). Mirror the change in both `TerminalOverlay.ts` (`attachTerminalCopyListener` at line 178, custom key handler at line 1166) and `SeriousTerminalController.ts` (lines 609, 746).

### Rationale
- Today's `attachTerminalCopyListener` exists but, per the user's bug report, fails — likely because Ctrl+C is unconditionally treated as terminal interrupt or because the listener writes to the wrong clipboard surface.
- `navigator.clipboard.writeText` works inside an Electron renderer without preload changes for this app's existing permissions; if that turns out to be wrong on a target platform (CI sandboxing), we fall back to `window.copilotBridge.clipboardWrite(text)` and add the IPC handler. We will not add the IPC unless required, to keep blast radius small.
- Context-menu copy is implemented as a tiny floating `<button>` that appears on `terminal.onSelectionChange` and triggers the same code path.

### Alternatives considered
- **Disable Ctrl+C selection-based copy and require a separate keybinding** (rejected — violates spec FR-008 "platform's standard copy keyboard shortcut").
- **Patch xterm.js or use `@xterm/addon-clipboard`** (rejected — adds a dependency; the in-house handler is ~20 lines).

## R5. Smoke test strategy

### Decision
Three layers, matching feature 001's pattern:

1. **Vitest unit (server)** — exercise `case 'open'` with three agents, assert three distinct `sessionId`s in `ptyProcesses` and in the persisted file; round-trip a `loadOfficeSessions` after a forged collision and assert dedup.
2. **Vitest integration (renderer)** — extend `tests/integration/terminal/TerminalOverlay.test.ts` with an agent-switch test that asserts `terminal.onData` writes to the new agent only after `attach` resolves. Add a `sync-agent-statuses.test.ts` that asserts the `alive`-guard recovery branch fires when `subState === 'starting'` past timeout.
3. **Playwright e2e** — `tests/e2e/default-office-cold-start.spec.ts`: cold-start with wiped `.data/`, open all three terminals in sequence, type distinct markers, assert each terminal echoes its own marker, copy a selection from each, assert clipboard contents, assert no `Startup timed out` badge within 60s. Mark env-blocked if the CI runner cannot host an Electron + xterm session (same rationale convention as 001).

### Rationale
Mirrors the existing repo convention. Splits invariants across the cheapest test layer that can detect each regression so failures point at the right surface.

### Alternatives considered
- **e2e-only** (rejected — slow, flaky, doesn't pinpoint which layer regressed).
- **Unit-only** (rejected — cannot validate FR-004 input echo or FR-008 clipboard end-to-end).

## R6. Reference repo `agency-cowork-main`

### Decision
Consult for two patterns: (a) multi-session orchestration with stable per-session identifiers, and (b) terminal clipboard integration. Adopt only patterns that are idiomatic in this codebase's current architecture (single xterm-per-panel, IPC bridge).

### Rationale
Spec asks us to review it for prior art. Direct code copy is forbidden by spec assumptions. After scanning their session-management layer, the relevant pattern is keying every cross-process message by a stable `sessionId` rather than a tuple — we already do this; nothing to change. Their clipboard pattern is the standard `getSelection() → navigator.clipboard.writeText`, which is what R4 already chooses. Outcome: confirmatory, no design changes.
