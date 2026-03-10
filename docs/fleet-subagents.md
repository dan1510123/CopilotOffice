# Fleet & Sub-Agent Event Tracking

> Research findings from analyzing real Copilot CLI `events.jsonl` data.
> Sessions analyzed: `ba7d606c` (single agent with explore sub-agents), `7c9808ee` (10-agent fleet).

---

## How Copilot CLI Events Work

The Copilot CLI writes events to `~/.copilot/session-state/{sessionId}/events.jsonl` as newline-delimited JSON. Each event has:

```typescript
interface CopilotEvent {
  type: string;        // event type (e.g., "subagent.started")
  data: unknown;       // event-specific payload
  id: string;          // unique event ID (UUID)
  timestamp: string;   // ISO 8601
  parentId: string;    // parent event ID (for chain correlation)
}
```

Our `EventsWatcher` (`electron/terminal/events-watcher.ts`) reads ALL events with no type filtering — every event the CLI writes gets passed to the server callback.

---

## Complete Event Type Inventory

Found across real sessions:

| Event Type | Currently Handled | Data |
|------------|:-----------------:|------|
| `assistant.turn_start` | ✅ | — |
| `assistant.turn_end` | ✅ | — |
| `tool.execution_start` | ✅ | `{ toolCallId, toolName, arguments }` |
| `tool.execution_complete` | ✅ | `{ toolCallId, success, result? }` |
| `user.message` | ✅ | — |
| **`subagent.started`** | ❌ | `{ toolCallId, agentName, agentDisplayName, agentDescription }` |
| **`subagent.completed`** | ❌ | `{ toolCallId, agentName, agentDisplayName }` |
| **`subagent.failed`** | ❌ | `{ toolCallId, agentName, agentDisplayName, error }` |
| **`system.notification`** | ❌ | `{ content: "Agent X completed successfully..." }` |
| **`session.mode_changed`** | ❌ | `{ previousMode, newMode }` |
| **`session.plan_changed`** | ❌ | `{ operation: "create" }` |
| `session.start` | ❌ | Session initialization |
| `session.shutdown` | ❌ | Metrics, code changes, model usage |
| `session.error` | ❌ | Error details |
| `abort` | ❌ | — |
| `assistant.message` | ❌ | Response content |
| `hook.start` / `hook.end` | ❌ | Lifecycle hooks |

---

## Sub-Agent Event Flow

When a Copilot CLI agent spawns a sub-agent (via the `task` tool), this event sequence fires:

### Single Sub-Agent (e.g., explore)
```
[18] tool.execution_start  tool=task        callId=...ALpZxHiJ   ← parent dispatches task tool
[19] subagent.started      agent=explore    callId=...ALpZxHiJ   ← sub-agent begins (same callId!)
[20] assistant.message                                            ← sub-agent's first response
[21] tool.execution_start  tool=glob        callId=...Tze48e5M   ← sub-agent runs glob
[22] tool.execution_start  tool=glob        callId=...ManKUNbb   ← sub-agent runs glob (parallel)
[23-26] tool.execution_start tool=glob (×4 more)                  ← sub-agent batch tool calls
[27-32] tool.execution_start tool=grep (×6)                       ← sub-agent searches
[33-39] tool.execution_complete (×7)                               ← tools complete
... more sub-agent tool activity ...
[XX] subagent.completed    agent=explore    callId=...ALpZxHiJ   ← sub-agent finishes
```

### Fleet (10 Parallel Sub-Agents)

From session `7c9808ee`:
```
06:08:08  user.message                            ← user request
06:08:13  session.mode_changed  plan → autopilot → interactive
06:08:19  subagent.started     agent=explore      ← initial exploration
06:09:45  subagent.completed   agent=explore
06:10:32  session.plan_changed  operation=create   ← plan created
06:10:49  session.mode_changed  interactive → autopilot  ← autopilot engaged!
06:12:56  assistant.message    "dispatch all 10 sub-agents in parallel"
06:12:57  subagent.started ×10 agent=general-purpose   ← FLEET SPAWNED (~1s burst)
06:13:47  subagent.completed   (first finishes ~50s later)
  ... completions trickle in over ~90s ...
06:14:41  subagent.completed   (last of 10 finishes)
06:14:08  system.notification ×7  "Agent X completed successfully"
```

---

## Where Task Descriptions Live

**Critical insight:** `subagent.started` does NOT contain the task description. It only has `agentName`, `agentDisplayName`, and `toolCallId`.

The task description is in the preceding `tool.execution_start` event (where `toolName=task`):

```json
{
  "type": "tool.execution_start",
  "data": {
    "toolCallId": "tooluse_qGU0oWD4RYYOpK45Se3B8H",
    "toolName": "task",
    "arguments": {
      "agent_type": "general-purpose",
      "description": "Create scenes instructions",
      "mode": "background",
      "prompt": "Create the file .github/instructions/src-scenes.instructions.md..."
    }
  }
}
```

**Correlation chain:**
```
tool.execution_start (toolName=task, callId=X)   → has description + prompt
  → subagent.started (callId=X)                  → sub-agent begins
  → ... tool calls from sub-agent ...
  → subagent.completed (callId=X)                → sub-agent finishes
  → system.notification                          → "agent-N completed"
```

The `toolCallId` is the join key across all these events.

---

## The `subagent.failed` Event

Discovered in session `8a4aa394`:

```json
{
  "type": "subagent.failed",
  "data": {
    "toolCallId": "tooluse_mPri061LOJ4AsteoPDXayh",
    "agentName": "explore",
    "agentDisplayName": "Explore Agent",
    "error": "Error: Failed to get response from the AI model; retried 5 times (total retry wait time: 6.09s) Last error: CAPIError: Request was aborted."
  }
}
```

This gives us structured error information without parsing terminal output.

---

## `system.notification` Event

Fires when background sub-agents complete. Content is a string:

```
Agent "agent-6" (general-purpose) has completed successfully.
Use read_agent with agent_id "agent-6" to retrieve the full results.
```

Note: The `agent-N` IDs are the Copilot CLI's internal numbering (not our `agentId` from `agents.ts`).

---

## ParentId Chain Analysis

### Can We Attribute Tool Calls to Specific Sub-Agents?

**Short answer: No, not reliably for parallel fleets.**

Each event has a `parentId` field. For tool calls made by sub-agents, the chain looks like:

```
tool.execution_start (e.g., glob)
  → parentId → tool.execution_start (report_intent)
    → parentId → assistant.message
      → parentId → [MISSING: sub-agent's internal turn ID]
```

The chain breaks because the sub-agent's internal assistant turns have IDs that don't appear in the parent's event stream. With 10 parallel sub-agents, we found **73 unique missing root parentIds** — the sub-agent's internal context is opaque.

### What This Means

When multiple sub-agents run in parallel, their `tool.execution_start`/`tool.execution_complete` events are **interleaved** in the parent stream with no reliable way to attribute a specific `glob` or `edit` call to sub-agent #3 vs sub-agent #7.

---

## What We CAN vs CAN'T Track

### ✅ Reliably Trackable Per Sub-Agent

| Signal | Event | Data Available |
|--------|-------|----------------|
| Task assignment | `tool.execution_start` (toolName=task) | `args.description`, `args.prompt`, `args.agent_type`, `args.mode` |
| Sub-agent spawned | `subagent.started` | `agentName`, `agentDisplayName`, `toolCallId` |
| Sub-agent completed | `subagent.completed` | `toolCallId` |
| Sub-agent failed | `subagent.failed` | `toolCallId`, `error` message |
| Completion notification | `system.notification` | "Agent N completed successfully" |
| Parent reads results | `tool.execution_start` (toolName=read_agent) | `args.agent_id` |

### ❌ NOT Trackable Per Sub-Agent

| Want | Why Not |
|------|---------|
| Which tool a specific sub-agent is currently running | parentId chain breaks into sub-agent internal context; tool calls interleaved across all agents |
| Sub-agent's progress percentage | No progress events emitted |
| Sub-agent's output/result text | Only available to parent via `read_agent`; not in events |

### ✅ Trackable as Aggregate (Across All Sub-Agents)

| Signal | How |
|--------|-----|
| Total tools currently running | Count `tool.execution_start` minus `tool.execution_complete` |
| Tool types in flight | `toolName` from active `tool.execution_start` events |
| Overall fleet activity level | Rate of tool events per second |

---

## Practical Tracking Design

### Data Model

```typescript
interface SubAgentTracker {
  toolCallId: string;           // join key: task start → subagent.started → completed
  agentType: string;            // "general-purpose", "explore", etc.
  taskDescription: string;      // from tool.execution_start args.description
  taskPrompt: string;           // from tool.execution_start args.prompt
  state: 'dispatched' | 'running' | 'completed' | 'failed';
  dispatchedAt: number;         // tool.execution_start timestamp
  startedAt: number | null;     // subagent.started timestamp
  completedAt: number | null;   // subagent.completed timestamp
  error: string | null;         // from subagent.failed
  notificationAgentId: string | null; // "agent-N" parsed from system.notification
}

interface FleetTracker {
  subAgents: Map<string, SubAgentTracker>;  // keyed by toolCallId
  activeToolCount: number;       // aggregate: tools currently in flight
  totalToolsCompleted: number;   // aggregate: total tools finished across all sub-agents
}
```

### Event → State Mapping

1. `tool.execution_start` (toolName=task) → create `SubAgentTracker` with state=`dispatched`, extract `description` + `prompt` from `arguments`
2. `subagent.started` → match by `toolCallId`, set state=`running`, record `startedAt`
3. `tool.execution_start` (any other tool) → increment `activeToolCount`
4. `tool.execution_complete` → decrement `activeToolCount`, increment `totalToolsCompleted`
5. `subagent.completed` → match by `toolCallId`, set state=`completed`, record `completedAt`
6. `subagent.failed` → match by `toolCallId`, set state=`failed`, store `error`
7. `system.notification` → parse "agent-N" ID from content string, store on matching tracker

### Fleet Dashboard UI

**Per Sub-Agent Row:**
```
[✅ Done]    "Create scenes instructions"    (general-purpose)  completed in 47s
[🔄 Running] "Create electron instructions"  (general-purpose)  running 32s...
[❌ Failed]  "Create config instructions"    (general-purpose)  "Error: model timeout"
[⏳ Queued]  "Create meeting instructions"   (general-purpose)  dispatched...
```

**Aggregate Activity Bar:**
```
Fleet: 7/10 complete  |  12 tools running  |  89 tools completed
```

---

## Implementation: Isolated Architecture

To avoid risk to existing functionality, fleet/sub-agent tracking is built as a **separate, opt-in layer** that sits alongside existing code without modifying it.

### New Files Only (No Existing Code Modified)

```
electron/terminal/
  ├─ server.ts              ← UNCHANGED
  ├─ ipc-relay.ts           ← UNCHANGED
  ├─ preload.ts             ← UNCHANGED (except 1 thin registration block)
  ├─ protocol.ts            ← UNCHANGED
  ├─ events-watcher.ts      ← UNCHANGED
  └─ fleet-events.ts        ← NEW: fleet event processing + IPC

src/meeting/
  ├─ types.ts               ← UNCHANGED
  ├─ planParser.ts          ← UNCHANGED
  ├─ planApproval.ts        ← UNCHANGED
  └─ fleetTracker.ts        ← NEW: renderer-side fleet state machine
```

### `electron/terminal/fleet-events.ts` (NEW)

This module registers a **secondary event listener** on the existing server message bus. It doesn't touch `server.ts` internals — it listens to the same IPC channel that already forwards raw `copilot-event` messages.

```typescript
// fleet-events.ts — Standalone fleet event processor
// Hooks into existing copilot-event passthrough (no server.ts changes)

import { ipcMain } from 'electron';

interface SubAgentEvent {
  agentId: string;
  toolCallId: string;
  agentName: string;
  agentDisplayName: string;
  taskDescription?: string;
  taskPrompt?: string;
  error?: string;
  timestamp: string;
}

export function registerFleetEvents(mainWindow: BrowserWindow) {
  // Listen to the EXISTING copilot-event channel that server.ts already emits
  // Also listen to copilot-tool-start which already fires for all tool calls
  // No changes to server.ts needed — we're a passive observer

  ipcMain.on('fleet:subscribe', (event, agentId: string) => {
    // Renderer opts in to fleet tracking for a specific agent
    // We start forwarding fleet-specific events to a separate channel
  });
}
```

**Alternative approach (simpler):** Since `onCopilotEvent` already forwards ALL raw events when a viewer is attached, the renderer can do all fleet processing client-side — no Electron changes needed at all for v1.

### `src/meeting/fleetTracker.ts` (NEW)

Pure renderer-side state machine. Listens to existing `copilotBridge.onCopilotEvent()` and `copilotBridge.onCopilotToolStart()` — both already available.

```typescript
// fleetTracker.ts — Renderer-side fleet state machine
// Uses ONLY existing copilotBridge APIs — no new IPC channels needed

export class FleetTracker {
  private subAgents = new Map<string, SubAgentTracker>();
  private activeToolCount = 0;
  private totalToolsCompleted = 0;
  private listeners: FleetEventListener[] = [];

  constructor(private agentId: string) {}

  /** Call this once to start tracking. Uses existing bridge APIs. */
  startTracking() {
    // These APIs already exist and work:
    window.copilotBridge.onCopilotEvent(this.agentId, (agentId, event) => {
      this.processEvent(event);
    });
  }

  private processEvent(event: CopilotEvent) {
    switch (event.type) {
      case 'tool.execution_start':
        if (event.data.toolName === 'task') {
          // Sub-agent dispatched — extract description from arguments
          this.createSubAgent(event.data.toolCallId, event.data.arguments);
        }
        this.activeToolCount++;
        break;
      case 'tool.execution_complete':
        this.activeToolCount--;
        this.totalToolsCompleted++;
        break;
      case 'subagent.started':
        this.updateSubAgent(event.data.toolCallId, 'running');
        break;
      case 'subagent.completed':
        this.updateSubAgent(event.data.toolCallId, 'completed');
        break;
      case 'subagent.failed':
        this.updateSubAgent(event.data.toolCallId, 'failed', event.data.error);
        break;
      case 'system.notification':
        this.handleNotification(event.data.content);
        break;
    }
    this.notifyListeners();
  }

  /** Subscribe to fleet state changes */
  onUpdate(cb: FleetEventListener) { ... }

  /** Get current fleet state snapshot */
  getState(): FleetState { ... }

  /** Clean up listeners */
  dispose() { ... }
}
```

### Integration Point

The `FleetTracker` is instantiated by `FleetDashboard.ts` (also new) or directly in `main.ts` when a fleet is active. It doesn't modify any existing code paths — it's additive only.

```typescript
// In main.ts or FleetDashboard.ts (when fleet starts):
const tracker = new FleetTracker('architect');  // track Arthur's sub-agents
tracker.startTracking();
tracker.onUpdate((state) => {
  updateFleetDashboardUI(state);  // new UI, doesn't touch existing dashboard
});
```

### Risk Assessment

| Concern | Mitigation |
|---------|-----------|
| Breaking existing terminal flow | FleetTracker is a passive observer — reads events, never writes |
| Breaking existing event handlers | Uses `onCopilotEvent` which already works; doesn't modify server.ts handlers |
| Breaking existing IPC | No new IPC channels in v1 — all processing happens renderer-side |
| Breaking existing UI | FleetDashboard is a new DOM element, toggled on only during fleet mode |

### Caveat: `onCopilotEvent` Requires Viewer Attached

The raw `copilot-event` passthrough in `server.ts` only fires when `activeAgentViewers.has(agentId)`. For fleet tracking to work without the terminal visible, we'd need ONE small change in `server.ts`:

**Option A (minimal server.ts change):** Add fleet events to the "always send" list alongside `copilot-tool-start`, `copilot-turn-end`, etc. These already fire without a viewer.

**Option B (no server.ts change):** Call `terminalAttach(agentId)` silently when fleet starts — this adds the agent to `activeAgentViewers` even without showing the terminal UI. The scrollback data is discarded but events flow.

Option B is preferred for v1 — zero changes to `server.ts`.

---

## Open Questions

1. **`session.task_complete`**: Not observed in the fleet session (`7c9808ee`). May only fire for the parent session, not sub-agents. Needs more testing.
2. **`session.shutdown` data**: Contains rich metrics (code changes, model usage). Could be useful for fleet summary. Needs investigation.
3. **`read_agent` results**: The parent agent calls `read_agent` to get sub-agent output. We could intercept the `tool.execution_complete` for `read_agent` to capture results, but the `result` field structure needs verification.
