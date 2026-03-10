---
applyTo: "electron/**"
---

# Electron Main Process

## Purpose

The `electron/` directory contains the Electron main process: BrowserWindow creation, IPC handler registration, a terminal server child process that owns all PTY processes, and a context bridge (preload) that is the renderer's sole communication channel with Node.js.

## main.ts — App Shell

Creates the BrowserWindow, loads the renderer, and wires everything together.

- **Orphan cleanup**: On startup, kills stale PTY processes tagged with `COPILOT_OFFICE_PROCESS` from previous crashed sessions (platform-aware: `wmic`/`taskkill` on Windows, `pgrep`/`SIGKILL` on Unix).
- **Terminal server**: Spawns the server via `TerminalRelay.spawnServer()` before creating the window.
- **IPC registration**: `relay.registerIpc()` registers all `ipcMain.handle()` calls. Also registers `request-hard-reload` and `show-native-notification`.
- **Dev tools**: `OPEN_DEVTOOLS_ON_START` flag controls whether DevTools open automatically.
- **Hot reload**: `startFileWatcher()` runs esbuild in watch mode; on rebuild, sends `build-complete` to the renderer. Hard reload (`Ctrl+Shift+R`) shuts down and respawns the terminal server.
- **Shutdown**: On window close / `will-quit`, calls `relay.shutdown()` and kills the file watcher.

## terminal/server.ts — PTY Owner (Child Process)

Runs as a **forked child process** (not in the main Electron process). Owns all PTY lifecycle:

- **PTY spawn**: `startTerminalForAgent()` spawns a shell via node-pty, tags the env with `COPILOT_OFFICE_PROCESS`, then runs `copilot --resume <sessionId>`.
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

- **MainToServer**: `start`, `write`, `resize`, `kill`, `attach`, `detach`, `exists`, `get-session-id`, `pop-out`, `shutdown`, `reset-all-sessions`, `reset-session`, `get-session-history`, `clear-session-history`, `list-active`, `query-agent-statuses`, `set-session-meta`, `get-session-meta`, `get-all-session-meta`.
- **ServerToMain**: `ready`, `response`, `terminal-data`, `terminal-exit`, `copilot-event`, `copilot-tool-start`, `copilot-tool-complete`, `copilot-turn-start`, `copilot-turn-end`, `copilot-user-message`, `terminal-preload-status`, `session-meta-updated`.

## terminal/preload.ts — Context Bridge

Exposes `window.copilotBridge` to the renderer via `contextBridge.exposeInMainWorld()`. This is the **only** way the renderer communicates with main/server. Wraps all `ipcRenderer.invoke()` and `ipcRenderer.on()` calls. Also declares the global `Window.copilotBridge` TypeScript type.

## terminal/ipc-relay.ts — IPC Bridge

`TerminalRelay` class bridges renderer ↔ main ↔ server IPC:

- **Server lifecycle**: `spawnServer()` forks `server.js`, waits for `ready` message (15 s timeout). Auto-respawns on unexpected exit. `shutdown()` sends shutdown message, force-kills after 3 s.
- **Request/response**: Uses `requestId` + `pendingRequests` map for async request matching.
- **Queued requests**: Requests arriving while server is down are queued and flushed on reconnect.
- **Message forwarding**: Non-response server messages (terminal-data, copilot events, etc.) are forwarded to the renderer window via `webContents.send()`.

## terminal/events-watcher.ts — CLI Event Parser

Monitors `~/.copilot/session-state/<sessionId>/events.jsonl` for structured Copilot CLI events. Uses triple-redundant file watching (fs.watch + fs.watchFile + manual poll at 500 ms). Parses JSONL lines into typed `CopilotEvent` objects. Includes `formatToolStatus()` helper for human-readable tool descriptions.

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
