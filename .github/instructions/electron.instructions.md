---
applyTo: "electron/**"
---

# Electron Main Process

## Purpose

The `electron/` directory contains the Electron main process: BrowserWindow creation, IPC handler registration, a terminal server child process that owns all PTY processes, and a context bridge (preload) that is the renderer's sole communication channel with Node.js.

## main.ts — App Shell

Creates the BrowserWindow, loads the renderer, and wires everything together.

- **Orphan cleanup**: On startup, reaps PTY process trees (shell + copilot CLI) left alive by a previous ungracefully-exited session, using the persisted PID registry at `.data/pty-pids.json` (`reapRegisteredPtys` in `terminal/pty-registry.ts`) and `taskkill /T /F` (Windows) / process-group `SIGKILL` (Unix). Before killing, it validates process identity via the recorded creation time so a recycled PID can't kill an unrelated process. The registry is the source of truth — it does not depend on `wmic` (removed from modern Windows) or on matching an env-var tag against a command line.
- **Terminal server**: Spawns the server via `TerminalRelay.spawnServer()` before creating the window.
- **IPC registration**: `relay.registerIpc()` registers all `ipcMain.handle()` calls. Also registers `request-hard-reload` and `show-native-notification`.
- **Dev tools**: `OPEN_DEVTOOLS_ON_START` flag controls whether DevTools open automatically.
- **Hot reload**: `startFileWatcher()` runs esbuild in watch mode; on rebuild, sends `build-complete` to the renderer. Hard reload (`Ctrl+Shift+R`) shuts down and respawns the terminal server.
- **Shutdown**: On window close / `will-quit`, calls `relay.shutdown()` and kills the file watcher.

## terminal/server.ts — PTY Owner (Child Process)

Runs as a **forked child process** (not in the main Electron process). Owns all PTY lifecycle:

- **PTY spawn**: `startTerminalForAgent()` spawns a shell via node-pty, tags the env with `COPILOT_OFFICE_PROCESS`, records the PTY root PID in the registry (`.data/pty-pids.json`) for orphan reaping, then runs `copilot --resume <sessionId>`.
- **Scrollback buffers**: Per-agent raw ANSI buffers capped at 512 KB (`MAX_BUFFER_BYTES`). Oldest chunks are evicted when the limit is exceeded.
- **Session persistence**: Session IDs, history, and metadata are stored in `.data/copilot-office-sessions.json`. Supports archive (on kill/reset) and migration from legacy flat format.
- **Attach/detach**: `activeAgentViewers` set tracks which agents have a live viewer. PTY data is only forwarded when the agent has an active viewer; scrollback is replayed on attach.
- **Event watchers**: Each agent gets an `EventsWatcher` instance that monitors Copilot CLI events (tool start/complete, turn start/end, user message). Events are only forwarded after the agent signals ready.
- **Auto-titling**: First `user.message` event auto-sets session title from message content.
- **Batched output**: PTY data is batched (16 ms flush interval, 64 KB max pending) to reduce IPC overhead.
- **Process-tree kill**: `killPtyProcess()` uses `taskkill /T /F` on Windows to kill the entire process tree.
- **Cleanup**: On shutdown message, kills all PTY processes and exits.

## terminal/protocol.ts — IPC Type Definitions

Defines `MainToServer` and `ServerToMain` discriminated union types for all IPC messages:

- **MainToServer**: `start`, `write`, `resize`, `kill`, `attach`, `detach`, `exists`, `get-session-id`, `pop-out`, `shutdown`, `reset-all-sessions`, `reset-session`, `get-session-history`, `clear-session-history`, `list-active`, `query-agent-statuses`, `set-session-meta`, `get-session-meta`, `get-all-session-meta`, `create-office-session`, `delete-office-session`, `transfer-session`.
- **ServerToMain**: `ready`, `response`, `terminal-data`, `terminal-exit`, `copilot-event`, `copilot-tool-start`, `copilot-tool-complete`, `copilot-turn-start`, `copilot-turn-end`, `copilot-user-message`, `terminal-preload-status`, `session-meta-updated`.

## terminal/preload.ts — Context Bridge

Exposes `window.copilotBridge` to the renderer via `contextBridge.exposeInMainWorld()`. This is the **only** way the renderer communicates with main/server. Wraps all `ipcRenderer.invoke()` and `ipcRenderer.on()` calls. Also declares the global `Window.copilotBridge` TypeScript type.

Key method groups:
- **Terminal management**: `terminalStart`, `terminalWrite`, `terminalResize`, `terminalKill`, `terminalExists`, `terminalAttach`, `terminalDetach`, `terminalPopOut`
- **Session persistence**: `getSessionId`, `resetAllSessions`, `resetSession`, `getSessionHistory`, `clearSessionHistory`, `listActiveTerminals`, `queryAgentStatuses`
- **Session metadata**: `setSessionMeta`, `getSessionMeta`, `getAllSessionMeta`
- **Office session files**: `createOfficeSession`, `deleteOfficeSession`, `transferSession`
- **Office persistence**: `saveOffices`, `loadOffices`
- **Event listeners**: `onTerminalData`, `onTerminalExit`, `onTerminalPreloadStatus`, `onCopilotEvent`, `onCopilotToolStart`, `onCopilotToolComplete`, `onCopilotTurnEnd`, `onCopilotTurnStart`, `onCopilotUserMessage`, `onSessionMetaUpdated`
- **Listener cleanup**: `removeTerminalListeners`, `removeCopilotListeners`
- **System**: `requestHardReload`, `showNativeNotification`

## terminal/ipc-relay.ts — IPC Bridge

`TerminalRelay` class bridges renderer ↔ main ↔ server IPC:

- **Server lifecycle**: `spawnServer()` forks `server.js`, waits for `ready` message (15 s timeout). Auto-respawns on unexpected exit. `shutdown()` sends shutdown message, force-kills after 3 s.
- **Request/response**: Uses `requestId` + `pendingRequests` map for async request matching.
- **Queued requests**: Requests arriving while server is down are queued and flushed on reconnect.
- **Message forwarding**: Non-response server messages (terminal-data, copilot events, etc.) are forwarded to the renderer window via `webContents.send()`.

## terminal/events-watcher.ts — CLI Event Parser

Monitors `~/.copilot/session-state/<sessionId>/events.jsonl` for structured Copilot CLI events. Uses triple-redundant file watching (fs.watch + fs.watchFile + manual poll at 500 ms). Parses JSONL lines into typed `CopilotEvent` objects. Includes `formatToolStatus()` helper for human-readable tool descriptions.

## terminal/session-repair.ts — V3 invariant (spec 002)

Pure helper that scans a freshly-loaded office session map for duplicate `sessionId` values across `agentId` keys. First occurrence wins; later duplicates are re-minted via `crypto.randomUUID()` and a `[TermServer] Repaired duplicate sessionId …` warning is emitted. Called from `loadOfficeSessionFile` so the V3 invariant from `specs/002-fix-terminal-cold-start/data-model.md` cannot be violated by a corrupted persisted file. Unit-tested via `tests/integration/terminal/server-cold-start.test.ts`.

## Forensic debug flag

Set `COPILOT_OFFICE_DEBUG_COLD_START=1` (server side) or `window.__COPILOT_OFFICE_DEBUG_COLD_START__ = true` in the renderer devtools before reload to surface the optional cold-start log lines documented in `specs/002-fix-terminal-cold-start/contracts/terminal-protocol.md` (`[OfficeScene] preStart …`, `[TerminalOverlay] switch …`). Default off so production builds stay quiet. The V3 `Repaired duplicate sessionId` warning is always logged regardless of the flag.

## cli-bridge.ts — MOCK / PLACEHOLDER

**Not used at runtime.** Contains hardcoded mock responses. Do not extend or rely on this file. All real terminal spawning is handled by `server.ts` via `ipc-relay.ts`.

## Key Rules

- All renderer ↔ main communication **must** go through `preload.ts` context bridge.
- Terminal spawning lives in `server.ts` (via `ipc-relay.ts`), **not** `cli-bridge.ts`.
- PTY processes must be cleaned up on session close, reset, and app shutdown. Always use `killPtyProcess()` — never bare `proc.kill()`.
- `server.ts` runs as a forked child process. Never import or call its functions from main.
- Protocol types in `protocol.ts` must stay in sync with handlers in both `server.ts` and `ipc-relay.ts`.

## Common Pitfalls

- **Orphaned PTYs**: If cleanup fails (crash, force-quit), stale processes persist. The orphan killer in `main.ts` handles this on next startup.
- **IPC type mismatches**: Adding a new message type requires updating `protocol.ts`, the handler in `server.ts`, and the relay in `ipc-relay.ts`.
- **Scrollback overflow**: Large outputs can hit the 512 KB buffer cap. Oldest chunks are evicted, which may break ANSI escape sequences mid-stream.
- **Ready signal race**: The 100 ms watcher-start delay in `server.ts` prevents the ready signal from firing before the renderer processes the preloading status.


## Post-Refactor (S1-D + S2-F, 2026-06-04)

**Dual-key viewer invariant (R-002)** is extracted into `electron/terminal/agent-viewers.ts` with documented `addAgentViewer` / `removeAgentViewer` / `hasActiveViewer` operating on a shared `ViewerMaps` object. server.ts attach/detach IPC handlers route through it; direct `Set.add` / `Set.delete` calls are only allowed in non-transfer cleanup paths (PTY exit, reset, shutdown).

**Sub-agent lifecycle forwarding** in server.ts bypasses `hasActiveViewer` for the `isFleetCriticalEvent` set (`subagent.*`, `system.notification`, `tool.execution_start` for `task`). FleetTracker (renderer) is a defense-in-depth safety net only; do not regress these unconditional sends.

**Non-terminal IPC** is now extracted into two modules so `electron/main.ts` stays focused on app shell:

- `electron/officeFileStore.ts` — pure FS wrapper for `.data/copilot-offices.json` (load/save/path). No electron deps → unit-testable.
- `electron/nonTerminalIpc.ts` — `registerNonTerminalIpc({ getMainWindow, onHardReloadRequested, officeStore })` wires the 4 handlers (`request-hard-reload`, `show-native-notification`, `save-offices`, `load-offices`). Response shapes match the prior inline implementation exactly so the renderer's `OfficePersistencePort` sees no protocol delta.

Terminal IPC (S1-D scope) stays in `electron/terminal/ipc-relay.ts`.