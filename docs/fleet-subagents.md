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

## Implementation: Current Architecture

Fleet/sub-agent tracking is built as a **separate, opt-in layer** that observes existing event pipelines without modifying core terminal code.

### Implemented Files

```
src/meeting/
  ├─ types.ts               ← Shared interfaces (MeetingPlan, TaskAssignment, FleetStatus)
  ├─ planParser.ts           ← Terminal output → MeetingPlan parser
  ├─ planApproval.ts         ← Plan approval overlay UI
  ├─ fleetTracker.ts         ← Renderer-side fleet state machine (event → state)
  ├─ fleetVisualizer.ts      ← Translates FleetTracker state into Phaser game events
  └─ fleetOrchestrator.ts    ← Orchestrates plan execution across agents
```

### `src/meeting/fleetTracker.ts`

Pure renderer-side state machine. Listens to existing `copilotBridge.onCopilotEvent()` and `copilotBridge.onCopilotToolStart()` — both already available.

```typescript
export type SubAgentState = 'dispatched' | 'running' | 'completed' | 'failed';

export interface FleetState {
  subAgents: ReadonlyMap<string, Readonly<SubAgentTracker>>;
  activeToolCount: number;
  totalToolsCompleted: number;
  isActive: boolean;
  counts: { dispatched: number; running: number; completed: number; failed: number };
}

export class FleetTracker {
  async startTracking(): Promise<void>;  // attaches terminal + sets up event listeners
  onUpdate(cb: FleetUpdateListener): () => void;  // subscribe to state changes
  getState(): FleetState;               // snapshot of current fleet state
  dispose(): void;                      // stop tracking and clean up
  reset(): void;                        // reset state for new fleet run
}
```

**Key implementation details:**
- Silently attaches terminal via `terminalAttach()` to ensure events flow (even without visible terminal)
- Periodically re-attaches every 10 seconds as safety net against detach races
- Uses existing `copilotBridge` APIs — no new IPC channels needed

### `src/meeting/fleetVisualizer.ts`

Translates FleetTracker state updates into Phaser game events for NPC visualization:

| Game Event | Purpose |
|-----------|---------|
| `fleet:assign` | Batch assignment of sub-agents to NPC sprites (2s debounce) |
| `fleet:dismiss-unassigned` | Unassigned agents walk out |
| `fleet:agent:badge` | Per-agent badge/status update |
| `fleet:agent:exit` | Agent walk-out animation on completion/failure |
| `fleet:agent:late-spawn` | Single agent arriving after initial batch |
| `fleet:status` | Aggregate fleet status update |
| `fleet:complete` | All agents finished |

### `src/meeting/fleetOrchestrator.ts`

Orchestrates plan execution across multiple agents:

```typescript
export class FleetOrchestrator {
  async executePlan(plan: MeetingPlan, workingDir: string): Promise<void>;
  cancel(): void;
  getFleetState(): FleetAgentState[];
  on(event: string, cb: Function): void;
  off(event: string, cb: Function): void;
}
```

### Risk Assessment

| Concern | Mitigation |
|---------|-----------|
| Breaking existing terminal flow | FleetTracker is a passive observer — reads events, never writes |
| Breaking existing event handlers | Uses `onCopilotEvent` which already works; doesn't modify server.ts handlers |
| Breaking existing IPC | No new IPC channels — all processing happens renderer-side |
| Breaking existing UI | FleetVisualizer emits game events consumed by OfficeScene; doesn't touch existing dashboard |

### Caveat: `onCopilotEvent` Requires Viewer Attached

The raw `copilot-event` passthrough in `server.ts` only fires when `activeAgentViewers.has(agentId)`. FleetTracker handles this by silently calling `terminalAttach()` on startup and periodically re-attaching every 10 seconds as a safety net. This adds the agent to `activeAgentViewers` even without showing the terminal UI — scrollback data is discarded but events flow.

---

## Open Questions

1. **`session.task_complete`**: Not observed in the fleet session (`7c9808ee`). May only fire for the parent session, not sub-agents. Needs more testing.
2. **`session.shutdown` data**: Contains rich metrics (code changes, model usage). Could be useful for fleet summary. Needs investigation.
3. **`read_agent` results**: The parent agent calls `read_agent` to get sub-agent output. We could intercept the `tool.execution_complete` for `read_agent` to capture results, but the `result` field structure needs verification.
