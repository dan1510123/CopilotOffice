# Agent Status Tracking — Architecture Analysis

> **Purpose**: Document the current status tracking system to inform a potential rearchitecture.

---

## 1. Data Model

### Types (`src/office/officeManager.ts`)

```typescript
type AgentState    = 'slacking' | 'active';
type ActiveSubState = 'starting' | 'ready' | 'waiting' | 'thinking' | 'error';

interface AgentStatus {
  agentId: string;
  state: AgentState;
  subState: ActiveSubState | null;   // null when slacking
  thinkingDetail: string | null;     // e.g. "view", "grep", "Processing..."
  currentTool: string | null;        // derived from agentTools stack (last tool name)
  unreadCount: number;               // unread action count
  lastEvent: string | null;          // last event type received
  activityStartTime: number | null;  // when current activity began
  lastCompletedAction: string | null; // last completed tool/action
  recentActions: RecentAction[];     // recent action history
  taskSummary: string | null;        // summary of current task
}
```

### Storage

```
OfficeData {
  agents: Map<string, AgentStatus>       // agentId → status
  agentTools: Map<string, ToolEntry[]>   // agentId → active tool stack
}
```

- **Single source of truth**: `officeManager.currentOffice?.agents`
- Per-office — each office tracks its own agent statuses independently
- **Not persisted** — agent status maps are rebuilt at startup from the terminal server via `syncAgentStatuses()`
- Office configs are persisted to `.data/copilot-offices.json` (via `copilotBridge`) but status is transient

### Supplementary state in `main.ts`

```typescript
const agentPreloadStatus: Map<string, 'preloading' | 'ready' | 'failed'> = new Map();
```
Tracks preload status separately from the officeManager model. Used only in `onTerminalPreloadStatus` handler.

---

## 2. State Machine

```
                  ┌──────────────────────────────────────────┐
                  │                                          │
   ┌──────────┐  │  ┌──────────┐    ┌─────────┐    ┌──────────┐
   │ SLACKING │──┼─▶│ STARTING │───▶│  READY  │◀──▶│ THINKING │
   │   (💤)   │  │  │   (🚀)   │    │   (✓)   │    │   (🧠)    │
   └──────────┘  │  └──────────┘    └─────────┘    └──────────┘
        ▲        │       │               │  ▲            │
        │        │       │               │  │            │
        │        │       │               ▼  │            │
        │        │       │          ┌─────────┐          │
        │        │       │          │ WAITING  │          │
        │        │       │          │   (⏳)   │          │
        │        │       │          └─────────┘          │
        │        │       │                               │
        │        │       ▼                               │
        │        │  ┌──────────┐                         │
        │        │  │  ERROR   │                         │
        │        │  │   (❌)   │                         │
        │        │  └──────────┘                         │
        │        │                                       │
        └────────┴───────────────────────────────────────┘
                    (session close / terminal exit)
```

### Transitions

| From | To | Trigger | Code Location |
|------|----|---------|---------------|
| **slacking** | **starting** | `startConversation()` (player interacts) | `OfficeScene.ts` |
| **slacking** | **starting** | `onTerminalPreloadStatus(preloading)` | `main.ts` |
| **slacking** | **starting** | `syncAgentStatuses()` (alive but not ready) | `main.ts` |
| **slacking** | **ready** | `syncAgentStatuses()` (alive and ready) | `main.ts` |
| **starting** | **ready** | `onTerminalPreloadStatus(ready)` | `main.ts` |
| **starting** | **ready** | `syncAgentStatuses()` (catchup) | `main.ts` |
| **starting** | **error** | `onTerminalPreloadStatus(failed)` | `main.ts` |
| **starting** | **error** | `syncAgentStatuses()` (stuck >60s timeout) | `main.ts` |
| **ready** | **thinking** | `onCopilotTurnStart` | `main.ts` |
| **ready** | **thinking** | `onCopilotUserMessage` | `main.ts` |
| **ready** | **thinking** | `onCopilotToolStart` (non-ask_user tool) | `main.ts` |
| **ready** | **waiting** | `onCopilotToolStart` (ask_user tool) | `main.ts` |
| **thinking** | **ready** | `onCopilotTurnEnd` | `main.ts` |
| **thinking** | **ready** | `onCopilotToolComplete` (no remaining tools) | `main.ts` |
| **thinking** | **thinking** | `onCopilotToolComplete` (more tools remaining) | `main.ts` |
| **thinking** | **waiting** | `onCopilotToolStart` (ask_user) | `main.ts` |
| **waiting** | **thinking** | `onCopilotToolStart` (new non-ask_user tool) | `main.ts` |
| **error** | **slacking** | `agent:session:closed` event | `main.ts` |
| **error** | **starting** | user retries interaction | `OfficeScene.ts` |
| **any active** | **slacking** | `agent:session:closed` event | `main.ts` |
| **any active** | **slacking** | `syncAgentStatuses()` (no alive PTY) | `main.ts` |

### The "Starting Guard" (Feature-flagged)

The starting guard is controlled by `ENABLE_STARTING_GUARD` (default: `false`) in `main.ts`. When enabled, all IPC event handlers block status transitions while `subState === 'starting'`:

```typescript
const ENABLE_STARTING_GUARD = false;

// In each handler:
const current = officeManager.getAgentStatus(officeId, agentId);
if (!ENABLE_STARTING_GUARD || current?.subState !== 'starting') {
  // apply status change
} else {
  console.log(`[BLOCKED] ... blocked by starting guard`);
}
```

**Why it's off by default:** The terminal server (`server.ts`) already filters out historical events during startup — it skips all events until `hasSignalledReady` is true. The starting guard was a redundant second layer of defense. With it disabled, IPC events flow through normally, and the `VALID_TRANSITIONS` map in `officeManager.ts` provides warnings for unexpected transitions instead.

---

## 3. Event Pipeline (Full Data Flow)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Copilot CLI Process (node-pty)                                     │
│  Writes events to: ~/.copilot/session-state/{sessionId}/events.jsonl│
└─────────────────────┬───────────────────────────────────────────────┘
                      │ fs.watch + fs.watchFile + poll (500ms)
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  EventsWatcher (electron/terminal/events-watcher.ts)                │
│  Parses JSONL → CopilotEvent objects                                │
│  Runs in: Terminal Server child process                             │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ callback(event)
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Terminal Server (electron/terminal/server.ts)                       │
│  - Manages ready detection (hasSignalledReady flag)                 │
│  - Skips events until first turn_end/user.message                   │
│  - Maps event types:                                                │
│      tool.execution_start  → copilot-tool-start                     │
│      tool.execution_complete → copilot-tool-complete                │
│      assistant.turn_end    → copilot-turn-end                       │
│      assistant.turn_start  → copilot-turn-start                     │
│      user.message          → copilot-user-message                   │
│  - Sends preload-status: preloading (on PTY spawn)                  │
│  - Sends preload-status: ready (on first turn_end/user.message)     │
│  Runs in: Forked child process                                      │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ process.send(msg) — Node IPC
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  IPC Relay (electron/terminal/ipc-relay.ts)                         │
│  - Receives ServerToMain messages                                   │
│  - Forwards to renderer via win.webContents.send()                  │
│  - Pure pass-through — no status logic                              │
│  Runs in: Electron main process                                     │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ ipcRenderer.on() via contextBridge
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Preload Bridge (electron/terminal/preload.ts)                      │
│  - Exposes window.copilotBridge                                     │
│  - Registers ipcRenderer.on listeners for each event type           │
│  - Pure pass-through — no status logic                              │
│  Runs in: Renderer preload (isolated world)                         │
└─────────────────────┬───────────────────────────────────────────────┘
                      │ window.copilotBridge.onXxx(callback)
                      ▼
┌─────────────────────────────────────────────────────────────────────┐
│  Event Handlers (src/main.ts:451-587)                               │
│  - THE CENTRAL STATUS LOGIC — all transitions happen here           │
│  - Starting guard on every handler                                  │
│  - Manages agentTools stack (parallel tool tracking)                │
│  - Calls officeManager.setAgent{State}()                            │
│  - Emits Phaser events: agent:status:changed, agent:tool:start      │
│  - Calls updateTerminalContent() + updateStatusBar()                │
│  Runs in: Renderer (main world)                                     │
└──────────┬──────────────────────────┬───────────────────────────────┘
           │                          │
           ▼                          ▼
┌────────────────────┐    ┌───────────────────────────────────────────┐
│  officeManager     │    │  Phaser Game Events                       │
│  (state store)     │    │  agent:status:changed → OfficeScene       │
│  agents Map        │    │  agent:tool:start     → OfficeScene       │
│  agentTools Map    │    │                                           │
└────────────────────┘    └──────────┬────────────────────────────────┘
                                     │
                                     ▼
                          ┌───────────────────────────────────────────┐
                          │  OfficeScene.updateSessionBadges()        │
                          │  - Reads officeManager.getAgentStatus()   │
                          │  - Calls npc.updateAgentStatus(status)    │
                          │                                           │
                          │  NPC.updateAgentStatus()                  │
                          │  - Updates badge color (BADGE_COLORS map) │
                          │  - Updates icon emoji (💤🚀✓⏳🧠❌)        │
                          │  - Thinking detail → truncated text       │
                          │  - Pulse animation for thinking/starting  │
                          └───────────────────────────────────────────┘
```

---

## 4. Status Producers (Who Sets Status)

### 4a. `OfficeScene.startConversation()` (line 917)
Sets `starting` immediately when player initiates conversation with a slacking agent:
```typescript
if (!status || status.state === 'slacking') {
  officeManager.setAgentStarting(officeId, agent.id);
  this.game.events.emit('agent:status:changed', agent.id);
}
```

### 4b. IPC Event Handlers in `main.ts` (lines 451-587)
Six handlers, each with the starting guard:

| Handler | Sets Status To | Condition |
|---------|---------------|-----------|
| `onCopilotToolStart` | **thinking** (with tool name) | Non-ask_user tool |
| `onCopilotToolStart` | **waiting** | ask_user tool |
| `onCopilotToolComplete` | **ready** | No remaining tools |
| `onCopilotToolComplete` | **thinking** (with last tool) | Still has active tools |
| `onCopilotTurnEnd` | **ready** | Always (if not starting) |
| `onCopilotTurnStart` | **thinking** ("Processing...") | Always (if not starting) |
| `onCopilotUserMessage` | **thinking** ("Processing...") | Always (if not starting) |
| `onTerminalPreloadStatus(preloading)` | **starting** | Was slacking |
| `onTerminalPreloadStatus(ready)` | **ready** | Always (bypasses guard) |

### 4c. `syncAgentStatuses()` (line 594)
Runs on startup + every 10 seconds. Queries terminal server for `{ alive, ready }` per agent:
```typescript
if (alive && ready)  → setAgentReady (if was slacking or starting)
if (alive && !ready) → setAgentStarting (if was slacking)
if (!alive)          → setAgentSlacking (if was active)
```

### 4d. `agent:session:closed` handler (line 739)
When user explicitly closes a session → `setAgentSlacking()`

### 4e. `agent:reattached` handler (line 753)
When terminal is reattached → triggers `syncAgentStatuses()` for reconciliation

---

## 5. Status Consumers (Who Reads Status)

### 5a. NPC Badges (`src/entities/NPC.ts`)
`updateAgentStatus(status)` method:
- Maps state to badge color via `BADGE_COLORS` lookup
- Sets emoji icon: 💤 🚀 ✓ ⏳ 🧠 ❌
- Truncates thinkingDetail to 5 chars for badge text
- Pulse animation for `thinking` and `starting` states

### 5b. Dashboard Cards (`src/main.ts:300-340`)
`updateTerminalContent()` renders HTML agent cards:
- Status dot color + label text per card
- Shows tool name in thinkingDetail
- Rebuilds full HTML on every status change

### 5c. Status Bar (`src/main.ts:650-671`)
Counts agents per state and displays summary:
```
💤 Slacking 2  🚀 Starting 1  ✓ Ready 1  🧠 Thinking 0  ⏳ Waiting 0
```

---

## 6. Tool Tracking (Parallel Tool State)

Separate from the status model, `main.ts` maintains an `agentTools` map:

```typescript
// In OfficeData:
agentTools: Map<string, { toolId: string; name: string; status: string }[]>
```

- `onCopilotToolStart` → pushes to the array
- `onCopilotToolComplete` → removes by toolId
- When all tools complete → status becomes `ready`
- When some remain → status shows the last tool's name
- **Cleared on preload ready** to prevent stale tools from startup

### Dual tracking concern
The `agentTools` stack and `AgentStatus.currentTool` can diverge:
- `currentTool` stores the last tool name set by `setAgentThinking()`
- `agentTools` tracks the full parallel tool stack
- When `toolComplete` fires and tools remain, the last tool in the array becomes `currentTool`
- No formal reconciliation between the two

---

## 7. Architecture Issues & Observations

### ✅ FIXED — Starting guard silently drops events
~~Events arriving while `subState === 'starting'` are logged but discarded.~~
**Fix:** Starting guard is now behind `ENABLE_STARTING_GUARD` feature flag (default: `false`). Server-side filtering in `server.ts` already handles historical event suppression, making the client-side guard redundant. Events now flow through normally.

### ✅ FIXED — No error state for failed preload
~~`preload.ts` can emit `status: 'failed'`, but `onTerminalPreloadStatus` has no handler for it.~~
**Fix:** Added `'error'` subState with red badge (❌). `onTerminalPreloadStatus` now handles `status === 'failed'` → `setAgentError()`. Added 60-second timeout in `syncAgentStatuses()` for agents stuck in `starting`.

### ✅ FIXED — No state change validation
~~Setters don't validate the current state before transitioning. Any status can jump to any other.~~
**Fix:** Added `VALID_TRANSITIONS` map in `officeManager.ts`. All setters call `validateTransition()` which logs `console.warn` on invalid transitions. Transitions still execute for backward compatibility.

### ✅ FIXED — Tool state lives in two places
~~`AgentStatus.currentTool` and `OfficeData.agentTools` can diverge with no formal reconciliation.~~
**Fix:** `currentTool` is now derived from the `agentTools` stack inside `setAgentThinking()`. The stack is the single source of truth — `currentTool` equals the last tool name in the stack, or `null` if empty.

### 🟡 MEDIUM — Two producers for `starting`
Both `OfficeScene.startConversation()` and `onTerminalPreloadStatus(preloading)` can set `starting`. This is intentional (scene sets it immediately for instant UI feedback before IPC arrives), but creates a potential double-set if both fire.

### 🟡 MEDIUM — `syncAgentStatuses()` can override active substates
The 10-second sync only knows `{ alive, ready }`. If an agent is `thinking` and the sync runs, it won't downgrade to `ready` (only slacking/starting get corrected). But there's no handling for edge cases like a server restart mid-thinking.

### 🟡 MEDIUM — Full DOM rebuild on every event
`updateTerminalContent()` rebuilds the entire dashboard HTML on every `agent:status:changed` and `agent:tool:start` event. During rapid tool cycling this can fire dozens of times per second. Currently debounced via `scheduleTerminalContentUpdate()` but the debounce timing may need tuning.

### 🟢 LOW — Phaser events don't carry status payload
`agent:status:changed` fires with just the agentId. Every consumer must then call `officeManager.getAgentStatus()` to get the actual status. This works but adds unnecessary coupling.

---

## 8. File Reference

| File | Role in Status Tracking |
|------|------------------------|
| `src/office/officeManager.ts` | **Data model + setters** — AgentStatus type, 7 setter methods, `VALID_TRANSITIONS` map, `validateTransition()`, getAgentStatus() |
| `src/main.ts` | **Central status logic** — IPC handlers, `ENABLE_STARTING_GUARD` flag, syncAgentStatuses (with 60s timeout), dashboard + status bar rendering |
| `src/entities/NPC.ts` | **Visual consumer** — badge colors (including error red), icons, pulse animations |
| `src/scenes/OfficeScene.ts` | **Interaction trigger** — startConversation() sets starting, updateSessionBadges() reads status |
| `electron/terminal/server.ts` | **Event source** — ready detection, event forwarding, preload signals |
| `electron/terminal/events-watcher.ts` | **File watcher** — reads events.jsonl, parses JSONL |
| `electron/terminal/ipc-relay.ts` | **Pass-through** — forwards ServerToMain messages to renderer |
| `electron/terminal/preload.ts` | **Bridge** — exposes copilotBridge API to renderer |
| `electron/terminal/protocol.ts` | **Type definitions** — ServerToMain / MainToServer message types |
| `src/config/agents.ts` | **Agent definitions** — static config (not status) |
