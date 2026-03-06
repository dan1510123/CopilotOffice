# COMPREHENSIVE AGENT STATUS TRACKING SYSTEM ANALYSIS

## EXECUTIVE SUMMARY

The agent status tracking system uses a **5-state finite state machine** with one parent state (slacking/active) and four child states (starting, ready, waiting, thinking). Status information flows from Copilot CLI → Server → IPC → Main Process → OfficeManager → Phaser Events → NPC Visual Updates.

Key architecture pattern: **OfficeManager is the single source of truth** for agent status, stored in a Map<agentId, AgentStatus>.

---

## 1. DATA MODEL - TYPE DEFINITIONS

### Core Types (src/office/officeManager.ts, lines 11-25)

**Agent State Enum:**
```typescript
export type AgentState = 'slacking' | 'active';
export type ActiveSubState = 'starting' | 'ready' | 'waiting' | 'thinking';
```

**Status Interface:**
```typescript
export interface AgentStatus {
  agentId: string;
  state: AgentState;           // 'slacking' (no session) | 'active' (has session)
  subState: ActiveSubState | null;     // null when slacking
  thinkingDetail: string | null;       // What agent is doing: tool name
  currentTool: string | null;          // Tool name for backward compat
}
```

### Office Data Structure

```typescript
export interface OfficeData {
  config: OfficeConfig;
  agents: Map<string, AgentStatus>;    // Per-agent status (SINGLE SOURCE OF TRUTH)
  agentTools: Map<string, ToolInfo[]>; // Track active tools per agent
}
```

### IPC Protocol Events (electron/terminal/protocol.ts)

Messages from Terminal Server to Main Process, relayed via TerminalRelay:

| Event | Parameters | From | To |
|-------|------------|------|-----|
| `copilot-tool-start` | agentId, toolName, toolId, status | Server | Renderer |
| `copilot-tool-complete` | agentId, toolId, success | Server | Renderer |
| `copilot-turn-start` | agentId | Server | Renderer |
| `copilot-turn-end` | agentId | Server | Renderer |
| `copilot-user-message` | agentId | Server | Renderer |
| `terminal-preload-status` | agentId, status ('preloading'\|'ready'\|'failed') | Server | Renderer |

---

## 2. STATUS PRODUCERS - ALL PLACES THAT CHANGE STATUS

### A. OfficeManager Helper Methods

Located in **src/office/officeManager.ts, lines 209-276**

```typescript
// Get or create initial status (slacking)
private getOrCreateStatus(officeId: string, agentId: string): AgentStatus

// Transition methods:
setAgentSlacking(officeId, agentId)
setAgentStarting(officeId, agentId)
setAgentReady(officeId, agentId)
setAgentWaiting(officeId, agentId)
setAgentThinking(officeId, agentId, detail, toolName)
clearAgentThinkingDetail(officeId, agentId)
```

### B. IPC Event Handlers in src/main.ts (lines 451-587)

**Critical Guard Logic:**
> All tool/turn event handlers have a **GUARD** that blocks status changes while `subState === 'starting'`
> This prevents race conditions but also causes event loss during preload.

**1. onTerminalPreloadStatus (CRITICAL - lines 562-587)**
- Trigger: Terminal server reports preload status
- State: 'preloading' → **setAgentStarting()**
- State: 'ready' → **setAgentReady()** ← ONLY EXIT FROM STARTING
- Note: **CLEARS STALE TOOLS** accumulated during preload

**2. onCopilotToolStart (lines 453-483)**
- Guard: Blocked if subState === 'starting'
- Logic:
  - If toolName === 'ask_user' → **setAgentWaiting()**
  - Else → **setAgentThinking(toolName)**
- Side effect: Tracks tool in agentTools[] Map

**3. onCopilotToolComplete (lines 485-512)**
- Guard: Blocked if subState === 'starting'
- Logic:
  - If no tools remain → **setAgentReady()**
  - Else → **setAgentThinking()** with next tool name

**4. onCopilotTurnStart (lines 529-544)**
- Guard: Blocked if subState === 'starting'
- Logic: → **setAgentThinking('Processing...', null)**

**5. onCopilotTurnEnd (lines 514-527)**
- Guard: Blocked if subState === 'starting'
- Logic: → **setAgentReady()**

**6. onCopilotUserMessage (lines 546-560)**
- Guard: Blocked if subState === 'starting'
- Logic: → **setAgentThinking('Processing...', null)**

### C. Phaser Game Events (src/main.ts)

```typescript
// When user closes terminal session
phaserGame.events.on('agent:session:closed', (agentId: string) => {
  officeManager.setAgentSlacking(officeId, agentId);
});

// When terminal is reattached
phaserGame.events.on('agent:reattached', (agentId: string) => {
  syncAgentStatuses();  // Full reconciliation from server
});
```

### D. OfficeScene Initialization (lines 874-888)

```typescript
private startConversation(agent: AgentConfig): void {
  const status = officeManager.getAgentStatus(officeId, agent.id);
  if (!status || status.state === 'slacking') {
    officeManager.setAgentStarting(officeId, agent.id);  // → STARTING
    this.game.events.emit('agent:status:changed', agent.id);
  }
}
```

### E. Status Reconciliation (lines 593-642)

Runs on startup + every 10 seconds:

```typescript
async function syncAgentStatuses(): Promise<void> {
  const statuses = await window.copilotBridge.queryAgentStatuses();
  
  for (const agent of AGENTS) {
    const serverStatus = statuses[agent.id];
    
    if (serverStatus?.alive && serverStatus?.ready) {
      // Agent alive and ready
      officeManager.setAgentReady()
    } else if (serverStatus?.alive && !serverStatus?.ready) {
      // Alive but not ready
      officeManager.setAgentStarting()
    } else {
      // No running PTY
      officeManager.setAgentSlacking()
    }
  }
}
```

---

## 3. STATUS CONSUMERS - WHERE STATUS IS DISPLAYED

### A. NPC Badge Rendering (src/entities/NPC.ts)

**Badge Colors:**
```typescript
const BADGE_COLORS: Record<string, { fill: number; stroke: number }> = {
  slacking:  { fill: 0x555555, stroke: 0x666666 },  // Gray
  starting:  { fill: 0xff9944, stroke: 0xffbb66 },  // Orange (pulsing)
  ready:     { fill: 0x44aaff, stroke: 0x66ccff },  // Blue
  waiting:   { fill: 0xffb86c, stroke: 0xffcc88 },  // Amber
  thinking:  { fill: 0x50fa7b, stroke: 0x66ff99 },  // Green (pulsing)
};
```

**Update Method (lines 246-277):**
```typescript
updateAgentStatus(status: AgentStatus | undefined): void {
  const stateKey = status?.subState || 'slacking';
  this.updateBadgeForState(stateKey);
  
  // Badge icon/text:
  const icons = {
    slacking: '💤',
    starting: '🚀',
    ready:    '✓',
    waiting:  '⏳',
    thinking: '⚡',
  };
  
  // Pulsing animation for thinking/starting
  if (stateKey === 'thinking' || stateKey === 'starting') {
    // Scale from 0.85 to 1.15, 600ms, repeat
  }
}
```

### B. OfficeScene Badge Sync (lines 218-224, 907-918)

```typescript
this.game.events.on('agent:status:changed', () => {
  this.updateSessionBadges();
});

private async updateSessionBadges(): Promise<void> {
  for (const npc of this.npcs) {
    const status = officeManager.getAgentStatus(officeId, npc.config.id);
    npc.updateAgentStatus(status);
  }
}
```

### C. Dashboard Display (src/main.ts, lines 287-402)

**Agent Status Cards:**
```
├─ Status Label: "Starting" / "Ready" / "Waiting for input" / "Thinking: [tool]"
├─ Status Icon: 🚀 / ✓ / ⏳ / ⚡
├─ Status Color: Orange / Blue / Amber / Green
└─ Tools: If active, show last tool name
```

**Status Bar (bottom of screen):**
```
💤 Slacking 4  |  🚀 Starting 1  |  ✓ Ready 0  |  ⚡ Thinking 2  |  ⏳ Waiting 1
```

---

## 4. COMPLETE EVENT FLOW

### Full Chain: Click Agent → Status Updates → Visual Change

```
┌─ USER INTERACTION ─────────────────────────────────────────┐
│  User clicks Gene in OfficeScene                            │
└────────────────┬──────────────────────────────────────────┘
                 │
                 ▼
┌─ OFFICE SCENE (src/scenes/OfficeScene.ts:874) ─────────────┐
│  startConversation(agent) {                                 │
│    officeManager.setAgentStarting(officeId, agent.id)      │
│    emit 'agent:status:changed' to game events              │
│  }                                                          │
└────────────────┬──────────────────────────────────────────┘
                 │
                 ▼
┌─ OFFICE MANAGER (src/office/officeManager.ts:234) ──────────┐
│  setAgentStarting() {                                        │
│    status.state = 'active'                                  │
│    status.subState = 'starting'  ← BLOCKS ALL TOOL EVENTS   │
│    status.thinkingDetail = null                             │
│    status.currentTool = null                                │
│  }                                                          │
│  // Stored in: officeData.agents.get(agentId)              │
└────────────────┬──────────────────────────────────────────┘
                 │
                 ▼
┌─ PHASER GAME EVENTS ─────────────────────────────────────────┐
│  game.events.emit('agent:status:changed', agentId)          │
└────────────────┬──────────────────────────────────────────┘
                 │
         ┌───────┴───────┐
         │               │
         ▼               ▼
    ┌─ OFFICE SCENE ──┐  ┌─ MAIN.TS ──────────┐
    │updateSessionBadges() updateStatusBar()  │
    │ OfficeScene.ts:218    main.ts:748       │
    └─────────┬───────┘  └─────────┬──────────┘
              │                    │
              │ (NPC updates)      │ (DOM update)
              │                    │
              ▼                    ▼
         ┌─ NPC UPDATE ────┐  ┌─ DOM UPDATE ────┐
         │ updateAgentStatus │ updateTerminalContent()
         │ updateBadgeForState() updateStatusBar()
         │ Update color, icon    Debounced via RAF
         │ Start/stop pulse      Agent cards + status
         └──────────────────┘  └─────────────────┘

MEANWHILE: TERMINAL SERVER PRELOADING CLI
         │
         │ (copilot-turn-start arrives)
         │ → onCopilotTurnStart() checks guard
         │ → Blocked! subState === 'starting'
         │ → Event discarded
         │
         ▼
    ┌─ PRELOAD COMPLETE ────────────────────────────┐
    │ Server sends: 'terminal-preload-status' 'ready'│
    └────────────────┬───────────────────────────────┘
                     │
                     ▼
    ┌─ MAIN.TS (line 562) ──────────────────────────┐
    │ onTerminalPreloadStatus('ready') {             │
    │   officeManager.setAgentReady()  ← UNBLOCK!    │
    │   emit 'agent:status:changed'                  │
    │   Clear stale tools: agentTools.set([], [])   │
    │ }                                              │
    └────────────────┬───────────────────────────────┘
                     │
                     ▼
    ┌─ STATUS CHANGED: slacking → ready ────────────┐
    │ NPC badge: Orange → Blue                      │
    │ Icon: 🚀 → ✓                                    │
    │ Stop pulsing                                   │
    └───────────────────────────────────────────────┘

USER SENDS MESSAGE TO COPILOT
         │
         ▼
    ┌─ COPILOT PROCESSES ───────────────────────────┐
    │ Server sends: 'copilot-turn-start'            │
    └────────────────┬───────────────────────────────┘
                     │
                     ▼
    ┌─ MAIN.TS (line 529) ──────────────────────────┐
    │ onCopilotTurnStart() {                         │
    │   Guard OK - subState === 'ready', not 'starting'
    │   officeManager.setAgentThinking()            │
    │   emit 'agent:status:changed'                 │
    │ }                                              │
    └────────────────┬───────────────────────────────┘
                     │
                     ▼
    ┌─ STATUS CHANGED: ready → thinking ────────────┐
    │ NPC badge: Blue → Green                       │
    │ Icon: ✓ → ⚡                                   │
    │ Start pulsing                                 │
    │ Detail: "Processing..."                       │
    └───────────────────────────────────────────────┘

COPILOT STARTS TOOL
         │
         ▼
    ┌─ Server sends: 'copilot-tool-start' ──────────┐
    │   toolName: 'ask_user'                         │
    └────────────────┬───────────────────────────────┘
                     │
                     ▼
    ┌─ MAIN.TS (line 453) ──────────────────────────┐
    │ onCopilotToolStart('ask_user') {              │
    │   officeManager.setAgentWaiting()  ← ask_user │
    │   emit 'agent:status:changed'                 │
    │ }                                              │
    └────────────────┬───────────────────────────────┘
                     │
                     ▼
    ┌─ STATUS CHANGED: thinking → waiting ──────────┐
    │ NPC badge: Green → Amber                      │
    │ Icon: ⚡ → ⏳                                   │
    │ Stop pulsing                                  │
    └───────────────────────────────────────────────┘
```

---

## 5. STATE MACHINE - ALL VALID TRANSITIONS

### State Diagram

```
              SLACKING
           (no session)
            💤 Gray
                ▲
                │ session:closed
                │
        ┌───────┴──────────┐
        │                  │
        │         ┌────────┴────────┐
        │         │                 │
        ▼         ▼                 ▼
     STARTING   READY            THINKING
     (startup)  (idle)           (active)
     🚀 Orange  ✓ Blue           ⚡ Green
     Pulse      Normal           Pulse
        │         ▲                 ▲
        │ preload │ turn:end       │ turn:start
        │ :ready  │ tool:complete  │ tool:start
        │         │ (last)         │ user:message
        └─────────┘                │
                          ┌────────┴────────┐
                          │                 │
                        WAITING             │
                     (ask_user)        (from ready)
                      ⏳ Amber
                        ▲
                        │ tool:start
                        │ ask_user only
                        │
                        └─ THINKING

Legend:
→ Direct transition
⟳ Animation (pulse effect)
```

### Transition Table

| From | To | Trigger | Guard | Code Location |
|------|-----|---------|-------|---------------|
| slacking | starting | preload:preloading | None | main.ts:571 |
| slacking | starting | User clicks agent | None | OfficeScene:886 |
| starting | ready | preload:ready | None | main.ts:575 ← ONLY EXIT |
| ready | thinking | turn:start | OK | main.ts:536 |
| ready | thinking | user:message | OK | main.ts:553 |
| ready | thinking | tool:start (other) | OK | main.ts:472 |
| ready | waiting | tool:start (ask_user) | OK | main.ts:469 |
| thinking | thinking | tool:start (other) | OK | main.ts:504 |
| thinking | ready | tool:complete (last) | OK | main.ts:501 |
| thinking | ready | turn:end | OK | main.ts:521 |
| waiting | ready | turn:end | OK | main.ts:521 |
| * | slacking | session:closed | None | main.ts:741 |
| * | slacking | sync: no PTY | None | main.ts:626 |

---

## 6. CRITICAL ARCHITECTURE PATTERNS & ISSUES

### PATTERN 1: The "STARTING Guard"

**What:**
All IPC event handlers (tool, turn, user message) check:
```typescript
const current = officeManager.getAgentStatus(officeId, agentId);
if (current?.subState !== 'starting') {
  // Only then apply status change
}
```

**Why:**
Prevents race condition during terminal preload. Events arriving during 100-200ms startup window are ignored until preload completes.

**Risk:**
- **Event Loss**: Tool/turn events fired during preload are silently discarded
- **Race Condition**: If preload stalls >500ms, events pile up in event queue
- **Silent Failures**: No logging of blocked events (only in console)

**Example Scenario:**
```
T0:   User clicks Gene → setAgentStarting()
T50:  CLI boots, sends tool-start → BLOCKED (subState='starting')
T100: Tool starts executing → BLOCKED (still subState='starting')
T200: Preload finishes, sends 'ready' → setAgentReady()
      Tools array CLEARED (line 579)
T250: Tool completion arrives → agent ready, tool cleared
      State machine: ready (correct) but tool history lost
```

### PATTERN 2: Tool State Tracking (Dual Source of Truth)

**Where:**
- Main.ts: `agentTools: Map<agentId, Tool[]>` (line 14)
- OfficeManager: `AgentStatus.thinkingDetail` and `currentTool`

**Why:**
Tool information displayed in dashboard doesn't fit in OfficeManager.AgentStatus
agentTools tracks ALL tools, status tracks tool BEING EXECUTED

**Risk:**
```typescript
// These can become MISALIGNED:
agentTools.get(agentId) = [{ toolId, name, status }] // Tool 1, Tool 2
officeManager.getAgentStatus.thinkingDetail = "Tool 1"

// After tool complete, agentTools updated
agentTools.set(agentId, [{ toolId, name, status }])  // Tool 2 only
// But if status update stalled, thinking detail still "Tool 1"
```

### PATTERN 3: Debounced UI Updates

**Code (main.ts:28-43):**
```typescript
let pendingStatusBarUpdate = false;

function scheduleStatusBarUpdate() {
  if (pendingStatusBarUpdate) return;
  pendingStatusBarUpdate = true;
  requestAnimationFrame(() => {
    pendingStatusBarUpdate = false;
    updateStatusBarNow();
  });
}
```

**Purpose:** Coalesce multiple status changes into single DOM update

**Risk:**
- updateStatusBarNow() regenerates HTML for ALL agents (line 653+)
- updateTerminalContentNow() regenerates HTML for ALL agent cards (line 291+)
- With 4 agents and 10 events/sec = ~10 full HTML rewrites/sec

### PATTERN 4: Event Emission Cascade

**Flow:**
```
officeManager.setAgentStarting()
  ↓
main.ts: emit 'agent:status:changed'
  ↓
├─ OfficeScene: on 'agent:status:changed' → updateSessionBadges()
├─ main.ts: on 'agent:status:changed' → updateStatusBar()
└─ Both trigger requestAnimationFrame for debounced DOM updates
```

**Risk:**
- Double-listening pattern (OfficeScene AND main.ts)
- No guarantee of event order
- If OfficeScene update lags, dashboard and Phaser can be out of sync

### PATTERN 5: Periodic Reconciliation

**Code (main.ts:645-649):**
```typescript
syncAgentStatuses();  // On startup

const STATUS_SYNC_INTERVAL_MS = 10_000;
setInterval(syncAgentStatuses, STATUS_SYNC_INTERVAL_MS);
```

**Why:**
Catch missed events and recover from race conditions

**Risk:**
- queryAgentStatuses() does IPC round-trip (10ms+)
- Runs even if no agents are active
- Can emit 10 status-changed events just from reconciliation
- No debounce between sync result and UI updates

---

## 7. KNOWN ISSUES & GAPS

### HIGH PRIORITY

1. **No Error State**
   - If preload fails (e.g., missing Copilot), no "failed" state
   - Agent stuck in STARTING state forever
   - User has no indication of problem

2. **No Timeout on STARTING**
   - If preload stalls (slow CPU, disk I/O), no timeout
   - STARTING guard blocks all events indefinitely
   - Application appears frozen

3. **Office Switch Race Condition**
   - User switches offices while preload in progress
   - Status update arrives for old office
   - officeManager.currentOfficeId now points to new office
   - Status update goes to wrong office

### MEDIUM PRIORITY

4. **Missing Transition: READY → WAITING**
   - Only reachable from THINKING
   - If ask_user fires before any other tool, behavior undefined
   - Assumption: turn-start always precedes tool-start

5. **Tool State Mismatch After Preload**
   - Line 579: agentTools cleared after preload:ready
   - Discards any queued tools sent during preload
   - Correct behavior (ignore startup noise) but loses history

6. **NPC Badge Update Not Automatic**
   - Must call npc.updateAgentStatus() explicitly
   - OfficeScene does this via updateSessionBadges()
   - But if called outside event flow, NPCs don't update
   - No automatic pull-based sync

### LOW PRIORITY

7. **Status Bar Regenerates All Agents**
   - Line 653+: Full HTML regeneration
   - Even if only 1 agent changed status
   - With 4 agents × 10 events/sec = ~40 agent renders/sec

8. **Console Logging Only**
   - Event blocks logged only to console (no UI indication)
   - Race conditions silent (no warn/error)
   - Makes debugging difficult

9. **No Test Coverage**
   - No unit tests for state transitions
   - No integration tests for event flow
   - State machine rules documented only in code

---

## 8. SUMMARY - DATA FLOW AT A GLANCE

```
Copilot CLI               Terminal Server           Electron Main           Renderer
(subprocess)              (fork process)            (IPC relay)            (Phaser + DOM)

   │                           │                        │                      │
   ├─ events stdout ──→  watch events ─→ send message ──→ relay ─→ send IPC ──→ Listener
   │                                                              ↓
   │                                                    onTerminalPreloadStatus
   │                                                    onCopilotTurnStart
   │                                                    onCopilotToolStart
   │                                                              │
   │                                                              ▼
   │                                                    OfficeManager.setState()
   │                                                    (Stores in agents Map)
   │                                                              │
   │                                                              ▼
   │                                                    Phaser: emit 'agent:status:changed'
   │                                                              │
   │                                                    ┌─────────┴──────────┐
   │                                                    │                    │
   │                                                    ▼                    ▼
   │                                            OfficeScene:         main.ts:
   │                                            updateSessionBadges  updateStatusBar
   │                                                    │                   │
   │                                                    ▼                   ▼
   │                                              NPC.updateAgentStatus  DOM:
   │                                              Badge color/icon/text  agent-cards
   │                                                    │              status-bar
   │                                                    ▼              counts
   │                                            Visual (Phaser)       Visual (HTML)
```

---

## KEY TAKEAWAYS

| Aspect | Current Implementation | Quality |
|--------|------------------------|---------|
| **State Definition** | Clear types, 5-state machine | ✅ Good |
| **Centralization** | OfficeManager is single source of truth | ✅ Good |
| **Type Safety** | Full TypeScript, no any | ✅ Good |
| **Event Flow** | Clear → Relay → Main → Scene → NPC | ✅ Clear |
| **Guard Logic** | Prevents startup race but blocks events | ⚠️ Critical |
| **Error Handling** | No error/failed state | ❌ Missing |
| **Timeout Handling** | No timeout on STARTING | ❌ Missing |
| **Concurrency Safety** | Office switch race, event ordering | ⚠️ Risk |
| **Performance** | Full DOM rerender per event | ⚠️ Inefficient |
| **Testing** | No test coverage | ❌ Missing |
| **Documentation** | None (code is source of truth) | ❌ Missing |

---

## RECOMMENDATIONS

1. **Add 'failed' State**: Handle preload failures gracefully
2. **Add STARTING Timeout**: 30s max, then error state
3. **Fix Office Switch Race**: Snapshot officeId at preload start
4. **Remove Duplicate Listeners**: Single event handler pattern
5. **Improve Reconciliation**: Only sync when needed (debounce)
6. **Better Logging**: Log blocked events, reconciliation results
7. **Add Tests**: Unit tests for state machine
8. **Document State Machine**: ASCII diagram in code

