# Fleet V-Team Room — UI Flow Specification

> How the fleet v-team room visualizes Copilot CLI sub-agent activity in real-time.

---

## Architecture Overview

Arthur (the architect agent) runs in a **single terminal session**. When the player gives Arthur
a complex task, Arthur uses the Copilot CLI's built-in fleet/autopilot_fleet mode to spawn
sub-agents internally. We don't orchestrate multiple terminals — we **observe and visualize**.

```
Arthur's terminal (single Copilot CLI session)
  ↓
Copilot CLI spawns sub-agents internally (autopilot_fleet)
  ↓
events.jsonl emits subagent.started / subagent.completed / subagent.failed
  ↓
FleetTracker (src/meeting/fleetTracker.ts) observes via onCopilotEvent
  ↓
UI spawns / updates / removes NPC sprites in the fleet v-team room
```

---

## Existing Infrastructure

| Component | File | Status |
|-----------|------|--------|
| Fleet v-team room layout | `OfficeScene.ts` → `createFleetVTeamLayout()` | ✅ Built |
| 14 fleet sprite sheets | `BootScene.ts` → `npc_fleet_1` through `npc_fleet_14` | ✅ Built |
| 14 seat positions (9×3 conference table) | `agents.ts` → `FLEET_SEAT_POSITIONS` | ✅ Built |
| Walk-in animation | `OfficeScene.ts` → `triggerAgentWalkIn()` | ✅ Built |
| Layout switching | `OfficeScene.ts` → `rebuildLayout('fleet-vteam')` | ✅ Built |
| Sub-agent event tracking | `fleetTracker.ts` → `FleetTracker` class | ✅ Built |
| Event pipeline | `events-watcher.ts` → `server.ts` → `preload.ts` | ✅ Built |

---

## UI Flow

### Phase 1: Fleet Kickoff

```
Player talks to Arthur in the meeting room or office
  → Arthur receives a complex task
  → Arthur enters autopilot/fleet mode
  → Copilot CLI begins spawning sub-agents
```

**Trigger detection:** FleetTracker receives the first `subagent.started` event via
`onCopilotEvent`. This signals that a fleet has kicked off.

### Phase 2: Room Transition

```
First subagent.started detected
  → Determine N = number of sub-agents (from subagent.started events)
  → Switch OfficeScene to fleet-vteam layout: rebuildLayout('fleet-vteam')
  → Room appears with N desk positions active (not all 14 if fewer needed)
```

**Challenge:** Sub-agents may spawn in a burst (~1 second for 10 agents, as observed in
session `7c9808ee`). We need a short debounce window (~2 seconds) after the first
`subagent.started` to collect the full count before transitioning.

**Approach:**
1. First `subagent.started` → start 2-second collection window
2. Accumulate all `subagent.started` events during the window
3. After 2 seconds → switch to fleet-vteam layout with N agents
4. Late arrivals (after the window) → spawn and walk in dynamically

### Phase 3: Agent Walk-In

```
For each sub-agent (staggered 600ms apart):
  → Assign fleet sprite: npc_fleet_1, npc_fleet_2, ... (by arrival order)
  → Map toolCallId → NPC reference (for later updates)
  → NPC appears at bottom door entrance
  → NPC walks to assigned desk position
  → Badge shows: task description + ⏳ "Starting" (yellow)
```

**Sprite assignment:** Each sub-agent gets the next available fleet sprite. The mapping is:
```
toolCallId_abc → npc_fleet_1 → seat position [0]
toolCallId_def → npc_fleet_2 → seat position [1]
...
```

**Name assignment:** Use `taskDescription` from the `tool.execution_start(task)` event
as the NPC's display name (e.g., "Create scenes instructions").

### Phase 4: Active Work (Badges Update)

```
While sub-agents are running:
  → FleetTracker.onUpdate() fires on every event
  → For each sub-agent NPC:

  State: 'dispatched'
    → Badge: ⏳ yellow, text: "Queued"

  State: 'running'
    → Badge: 🧠 green (pulsing), text: taskDescription
    → Detail: current tool name if available from aggregate events

  State: 'completed'
    → Badge: ✅ blue, text: "Done"

  State: 'failed'
    → Badge: ❌ red, text: error message (truncated)
```

**Aggregate activity** (shown in room title or status bar):
```
Fleet: 7/10 complete  |  12 tools active  |  89 tools completed
```

### Phase 5: Agent Walk-Out (Completion)

```
subagent.completed fires for toolCallId_abc
  → Find NPC mapped to toolCallId_abc
  → Badge changes to ✅ "Done" (blue)
  → Wait 2 seconds (let player see the completion)
  → NPC walks from desk back to bottom door entrance
  → NPC fades out / is removed from scene
  → Free up the sprite for potential reuse
```

**Walk-out animation:**
- Same path as walk-in but reversed: desk → entrance → off-screen
- Speed: same as walk-in (~120px/frame)
- NPC faces downward (toward exit) during walk-out

### Phase 6: Agent Failure

```
subagent.failed fires for toolCallId_def
  → Find NPC mapped to toolCallId_def
  → Badge changes to ❌ "Failed" (red) with error snippet
  → Wait 2 seconds
  → NPC walks out (same exit animation as completion)
```

### Phase 7: Fleet Complete

```
All sub-agents are completed or failed (FleetState.isActive === false)
  → Show completion notification:
    "Fleet complete: 9/10 tasks succeeded"
  → Optional: summary overlay with per-task results
  → After player acknowledges, transition back to default office layout
  → Or stay in fleet room if player wants to review
```

---

## Data Flow: Event → NPC Mapping

```typescript
// Map from Copilot CLI sub-agent to visual NPC
interface FleetNPCMapping {
  toolCallId: string;        // from subagent.started
  npcSpriteKey: string;      // npc_fleet_1, npc_fleet_2, ...
  seatIndex: number;         // position in FLEET_SEAT_POSITIONS
  taskDescription: string;   // from tool.execution_start args.description
  npcRef: NPC | null;        // reference to Phaser NPC instance
}

// FleetTracker event → NPC update flow:
//
// FleetTracker.onUpdate(state => {
//   state.subAgents.forEach((tracker, toolCallId) => {
//     const mapping = npcMappings.get(toolCallId);
//     if (!mapping) return;
//
//     switch (tracker.state) {
//       case 'dispatched': setBadge(mapping.npcRef, 'starting', 'Queued');
//       case 'running':    setBadge(mapping.npcRef, 'thinking', tracker.taskDescription);
//       case 'completed':  setBadge(mapping.npcRef, 'ready', 'Done'); scheduleWalkOut(mapping);
//       case 'failed':     setBadge(mapping.npcRef, 'error', tracker.error); scheduleWalkOut(mapping);
//     }
//   });
// });
```

---

## Timing Characteristics (from real fleet session `7c9808ee`)

| Phase | Duration | Notes |
|-------|----------|-------|
| Sub-agent spawn burst | ~1 second | 10 agents spawned in rapid succession |
| First completion | ~50s after spawn | Fastest sub-agent |
| Completion spread | ~90s total | Completions trickle in over this window |
| Last completion | ~105s after spawn | Slowest sub-agent |
| Collection debounce | 2s recommended | Wait for all spawns before layout switch |

---

## Room Layout Reference

```
         Col 7   9   10  11  13
    ┌──────┬─────┬─────┬─────┬──────┐
    │  S1  │  S2 │  S3 │  S4 │  S5  │  Row 4 (above table)
    ├──────┴─────┴─────┴─────┴──────┤
    │      9 × 3 CONFERENCE TABLE   │  Rows 5-7
    ├──────┬─────┬─────┬─────┬──────┤
    │  S6  │  S7 │  S8 │  S9 │  S10 │  Row 8 (below table)
    └──────┴─────┴─────┴─────┴──────┘
  S11,S12                      S13,S14
  (left side)                  (right side)
  Col 5                        Col 15

  ════════════════════════════════════
           BOTTOM DOOR (entrance/exit)
```

14 seats max. For N < 14, fill seats starting from S1 sequentially.

---

## Edge Cases

| Case | Handling |
|------|----------|
| N > 14 sub-agents | Cap at 14 NPCs. Extra sub-agents tracked in dashboard but no sprite. |
| Late sub-agent spawn (after debounce window) | Dynamically spawn NPC and walk in. |
| Sub-agent completes before walk-in finishes | Queue the completion badge; apply after walk-in tween ends. |
| All agents fail | Show failure summary, transition back to office. |
| Player leaves fleet room mid-fleet | Fleet continues in background; re-entering shows current state. |
| Player talks to Arthur during fleet | Arthur's terminal is still accessible; won't interrupt fleet. |
| Fleet mode not detected (no subagent events) | No room transition; everything stays normal. |
