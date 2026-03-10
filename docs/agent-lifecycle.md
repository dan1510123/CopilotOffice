# Agent Session Lifecycle

Documents the full lifecycle of agent terminal sessions — how they start, persist, resume, reset, and shut down.

## Session Storage

**File:** `.data/copilot-office-sessions.json` (`.data/` folder)

```json
{
  "current": {
    "generalist": "uuid-1",
    "architect": "uuid-2",
    "admin": "uuid-3"
  },
  "history": {
    "generalist": ["old-uuid-a", "old-uuid-b"]
  }
}
```

- `current` — one active session UUID per agent
- `history` — archived UUIDs from previous sessions (viewable in Session History popover)
- Loaded on terminal server startup (`server.ts` → `loadSessionIds()`)
- Saved after every mutation (`saveSessionIds()`)

**Copilot CLI session state** lives at `~/.copilot/session-state/{uuid}/` and includes `events.jsonl` (event log) plus other state files.

---

## Lifecycle Flows

### 1. First Open (No Prior Session)

**Trigger:** User clicks agent in dashboard or walks up and presses E  
**Path:** `TerminalOverlay.show()` → `terminalExists()` returns `false` → `startNewSession()`

```
Renderer                          Server (server.ts)
────────                          ──────
terminalExists(agentId)     →     getTerminalKey() → null
                            ←     false

terminalStart(agentId, wd)  →     startTerminalForAgent()
                                    agentSessionIds.get(agentId) → undefined
                                    sessionId = crypto.randomUUID()     ← NEW UUID
                                    agentSessionIds.set(agentId, sessionId)
                                    saveSessionIds()                    ← PERSIST
                                    pty.spawn('powershell.exe', ...)
                                    new EventsWatcher(sessionId)
                                    setTimeout(500ms):
                                      proc.write('copilot --resume <sessionId>\r')
                            ←     { success: true, pid, sessionId }
```

**Note:** `--resume` with a never-before-seen UUID is equivalent to starting fresh — the Copilot CLI creates a new session directory.

### 2. Reattach (Terminal Still Alive)

**Trigger:** User switches back to an agent they previously opened (PTY still running)  
**Path:** `TerminalOverlay.show()` → `terminalExists()` returns `true` → `terminalAttach()`

```
Renderer                          Server
────────                          ──────
terminalExists(agentId)     →     getTerminalKey() → found
                            ←     true

terminalAttach(agentId)     →     activeAgentViewers.add(agentId)
                                  scrollback = agentScrollbackBuffers.get(agentId)
                            ←     { success: true, scrollback }

getSessionId(agentId)       →     agentSessionIds.get(agentId)
                            ←     "uuid-1"
```

**No PTY restart, no new UUID.** The existing CLI process continues. Renderer just re-subscribes to PTY data output and gets scrollback to redraw the terminal.

### 3. New Session (Ctrl+Shift+N)

**Trigger:** User presses Ctrl+Shift+N while terminal is focused  
**Path:** `TerminalInputListener` → `handleNewSession()` → kill + start

```
Renderer                          Server
────────                          ──────
terminalKill(agentId)       →     killPtyProcess(proc)          ← PTY DIES
                                  ptyProcesses.delete(key)
                                  agentToTerminal.delete(agentId)
                                  archiveSessionId(agentId)     ← old UUID → history
                                  agentSessionIds.delete(agentId) ← CURRENT CLEARED
                                  saveSessionIds()              ← PERSIST
                                  watcher.stop()
                            ←     { success: true }

startNewSession(agentId)    →     [same as Flow 1 — new UUID generated]
```

**Result:** Old UUID archived. New UUID generated. Fresh `copilot --resume <newUUID>` starts a clean session.

### 4. Close Session (⏹ Button)

**Trigger:** User clicks "⏹ Close Session" in terminal footer  
**Path:** `handleCloseSession()` → `resetSession()`

```
Renderer                          Server
────────                          ──────
resetSession(agentId)       →     killPtyProcess(proc)          ← PTY DIES
                                  ptyProcesses.delete(key)
                                  agentToTerminal.delete(agentId)
                                  watcher.stop()
                                  agentScrollbackBuffers.delete(agentId)
                                  activeAgentViewers.delete(agentId)
                                  archiveSessionId(agentId)     ← old UUID → history
                                  newSessionId = crypto.randomUUID()  ← NEW UUID
                                  agentSessionIds.set(agentId, newSessionId)
                                  saveSessionIds()              ← PERSIST
                            ←     { success: true, sessionId: newSessionId }

TerminalOverlay.hide()            [agent set to 'slacking' status]
```

**Difference from New Session:** Close generates and saves the new UUID immediately but does NOT start a PTY. The PTY only starts when the user re-opens the agent.

### 5. Reset All Sessions (Status Bar Button)

**Trigger:** User clicks reset button in status bar  
**Path:** `resetAllSessions()`

```
Renderer                          Server
────────                          ──────
resetAllSessions()          →     killAllPtyProcesses()         ← ALL PTYs DIE
                                  agentScrollbackBuffers.clear()
                                  for each agentId in agentSessionIds:
                                    agentSessionIds.set(agentId, crypto.randomUUID())
                                  saveSessionIds()              ← PERSIST
                            ←     { success: true }
```

**Note:** Does NOT archive old UUIDs to history — they are silently overwritten.

### 6. Game Restart (F5 / Electron Reload)

```
SHUTDOWN:
  Renderer unloads
  → ipc-relay.ts shutdown()
  → sends 'shutdown' to server
  → server: killAllPtyProcesses() + process.exit(0)
  → All PTYs die, all watchers stop
  → .data/copilot-office-sessions.json is NOT modified (current UUIDs preserved)

STARTUP:
  New server spawned
  → loadSessionIds() reads .data/copilot-office-sessions.json
  → agentSessionIds restored (e.g. generalist → "uuid-from-before-restart")
  → No PTYs running yet

  User opens agent terminal
  → terminalExists() → false (PTYs are dead)
  → startNewSession()
  → agentSessionIds.get(agentId) → "uuid-from-before-restart" (FOUND)
  → REUSES existing UUID                              ← ⚠️ THIS IS THE RESUME
  → copilot --resume <uuid-from-before-restart>
  → Copilot CLI loads session state from ~/.copilot/session-state/{uuid}/
  → Previous conversation and tool calls resume
```

The server reloads the persisted UUID from `.data/copilot-office-sessions.json` and the Copilot CLI finds existing session state at `~/.copilot/session-state/{uuid}/`. This is intentional resume behavior — users who want a fresh session should use Ctrl+Shift+N or the ⏹ Close Session button before restarting.

### 7. Pop Out (External Terminal)

**Trigger:** User clicks pop-out button  
**Path:** `terminalPopOut()`

```
Server spawns: wt -d <cwd> copilot --resume <sessionId>
```

Opens Windows Terminal with the same session UUID. Both the in-game terminal and the external terminal share the session.

---

## State Diagram

```
                    ┌─────────────┐
                    │   No Session │  (agent first seen, or after reset-all)
                    └──────┬──────┘
                           │ User opens terminal
                           ▼
                    ┌─────────────┐
          ┌────────│    Active    │◄──────────┐
          │        │  (PTY alive) │           │
          │        └──┬───┬───┬──┘           │
          │           │   │   │              │
     Ctrl+Shift+N    │   │   │ Close (⏹)    │ User re-opens
     (new session)   │   │   │              │
          │           │   │   ▼              │
          │           │   │ ┌──────────┐     │
          │           │   │ │ Closed   │─────┘
          │           │   │ │(new UUID │
          │           │   │ │ saved,   │
          │           │   │ │ no PTY)  │
          │           │   │ └──────────┘
          │           │   │
          │           │   │ Game restart / crash
          │           │   ▼
          │           │ ┌────────────┐
          │           │ │ Persisted  │───────┐
          │           │ │ (UUID in   │       │ User opens terminal
          │           │ │  JSON, no  │       │ → RESUMES old session
          │           │ │  PTY)      │       │
          │           │ └────────────┘       │
          │           │                      │
          ▼           ▼                      ▼
    ┌─────────────────────────────────────────────┐
    │              Active (PTY alive)              │
    │  copilot --resume <uuid> running in PTY     │
    └─────────────────────────────────────────────┘
```

---

## Key Implementation Details

| Concept | Location | Notes |
|---------|----------|-------|
| Session UUID storage | `server.ts` → `agentSessionIds` Map | In-memory, synced to JSON file |
| JSON persistence file | `.data/copilot-office-sessions.json` | `.data/` folder, survives restarts |
| UUID generation | `crypto.randomUUID()` | Standard v4 UUID |
| Archive old UUID | `archiveSessionId()` | Pushes to `history[agentId][]` |
| PTY spawn | `pty.spawn('powershell.exe', [...])` | With tagged env vars |
| CLI start command | `copilot --resume <sessionId>` | Always uses `--resume` flag |
| CLI start delay | `setTimeout(500ms)` | Waits for shell to initialize |
| Ready detection | PTY output contains `"Environment loaded"` | Triggers `preload-status: ready` |
| Event streaming | `EventsWatcher` → `events.jsonl` | File watcher with polling fallback |
| Scrollback buffer | `agentScrollbackBuffers` | Max 500 lines per agent |

---

## The `--resume` Flag

Every terminal start uses `copilot --resume <sessionId>`, regardless of whether the session is new or existing.

- **New UUID** (no prior `~/.copilot/session-state/{uuid}/`): Copilot CLI initializes a fresh session
- **Existing UUID** (session state directory exists): Copilot CLI loads prior conversation history and may resume incomplete tasks

There is no separate "start fresh" command path. The distinction is purely whether session state files exist on disk for the given UUID.
