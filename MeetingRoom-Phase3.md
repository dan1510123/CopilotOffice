# Meeting Room — Phase 3 Implementation Plan

## What's Done (Phase 1 & 2)

### Phase 1 — Meeting Room Core
- ✅ MeetingScene with 6×5 room, 3× zoom, seated player + Arthur
- ✅ Arthur's terminal auto-opens on meeting start
- ✅ Plan parsing from terminal output (ANSI-stripped, fenced JSON)
- ✅ Plan approval overlay (Approve / Revise / Cancel)
- ✅ Scene transition (Office → Meeting → Office)
- ✅ Exit animations and office re-entry with plan data

### Phase 2 — Fleet Infrastructure (Built but Not Wired)
- ✅ `FleetTracker` — observes sub-agent events from `events.jsonl`
- ✅ `FleetVisualizer` — bridges tracker data to Phaser via `fleet:*` game events
- ✅ `FleetDashboard` (src/ui) — DOM-based fleet progress panel
- ✅ OfficeScene `fleet:*` event listeners — spawn, badge, exit, late-spawn, complete
- ✅ Fleet v-team room layout with 14 seats and walk-in animations
- ✅ 14 fleet sprite sheets generated in BootScene
- ✅ Pre-seeded prompt support in terminal server
- ✅ Enhanced meeting prompt with working directory and file tree context
- ✅ Sub-agent event research (docs/fleet-subagents.md, docs/fleet-ui-flow.md)

---

## Phase 3: What Remains

The core pieces are built but **the pipeline is not connected**. The full meeting-to-fleet
experience requires wiring the components together and handling the end-to-end flow.

```
Current state:

  FleetTracker (class exists, never instantiated)
      ↓ ❌ gap
  FleetVisualizer (class exists, never instantiated)
      ↓ ❌ gap
  game.events (fleet:spawn, fleet:agent:badge, etc.)
      ↓ ✅ connected
  OfficeScene listeners (ready, waiting for events)
      ↓ ✅ connected
  NPC walk-in/badge/walk-out (ready)
```

### 3.1 Fleet Pipeline Wiring

**The critical missing piece.** Someone needs to instantiate and connect the pipeline.

**Where:** `src/scenes/OfficeScene.ts` (in `create()` or `rebuildLayout()`)

**What:**
```typescript
// When switching to fleet-vteam layout:
import { FleetTracker } from '../meeting/fleetTracker';
import { FleetVisualizer } from '../meeting/fleetVisualizer';

// In rebuildLayout() or a new method:
if (layout === 'fleet-vteam') {
  // 1. Create tracker for Arthur (the agent running fleet mode)
  this.fleetTracker = new FleetTracker('architect');
  await this.fleetTracker.startTracking();

  // 2. Create visualizer and connect to game events
  this.fleetVisualizer = new FleetVisualizer(
    this.fleetTracker,
    this.game.events,
    14  // max agents
  );
  this.fleetVisualizer.start(this);
}
```

**Key decision:** When to create the tracker. Options:
- **Option A:** Create when player enters fleet office (layout switch)
- **Option B:** Create when Arthur's terminal detects `session.mode_changed` to autopilot
- **Option C:** Create on any `subagent.started` event from Arthur

Option A is simplest — the player explicitly enters the fleet room, so we know to start tracking.

**Cleanup:** When leaving fleet layout, call `fleetVisualizer.dispose()` and `fleetTracker.dispose()`.

### 3.2 Fleet Mode Entry Detection

Currently there's no automatic detection of when Arthur enters fleet mode. Two paths:

**Path 1: Manual (from Meeting Room)**
The existing MeetingScene flow already handles plan approval. When the player approves and
returns to the office, `OfficeScene` wakes with `data.plan`. Wire this to:
1. Create a fleet office (or switch current office to fleet-vteam layout)
2. Start the FleetTracker on Arthur's agent
3. Wait for sub-agent events to flow

**Path 2: Automatic (from any agent terminal)**
Listen for `session.mode_changed` events (already in `events.jsonl` but not handled).
When any agent switches to `autopilot`, automatically start fleet tracking.

**Recommendation:** Start with Path 1 (manual via meeting room). Path 2 is an enhancement.

### 3.3 FleetDashboard Integration in Right Panel

Two FleetDashboard files exist:
- `src/layouts/fleet/FleetDashboard.ts` — pre-existing layout renderer (used by main.ts)
- `src/ui/FleetDashboard.ts` — new class with `updateState(FleetState)` API

**What's needed:** Connect the new FleetDashboard to receive FleetTracker updates and display
real-time sub-agent progress in the right panel. Options:

- **Option A:** Wire `FleetTracker.onUpdate()` → `FleetDashboard.updateState()` in main.ts
- **Option B:** Emit a `fleet:status` game event from FleetVisualizer (already designed),
  listen in main.ts and update the dashboard

Option B is cleaner — main.ts already listens to game events.

### 3.4 Meeting Room → Fleet Room Transition

The end-to-end flow from meeting to fleet:

```
Player talks to Arthur in Meeting Room
  → Arthur outputs JSON plan
  → PlanApprovalOverlay shows
  → Player clicks "Approve & Execute"
  → exitMeeting(plan) → walk-to-doors animation → fade → wake OfficeScene
  → OfficeScene wakes with data.plan
  → ??? (currently stubbed — needs implementation)
```

**What's needed in the OfficeScene wake handler:**
1. Receive the approved `MeetingPlan` from the wake data
2. Switch to fleet-vteam layout: `rebuildLayout('fleet-vteam')`
3. Start FleetTracker + FleetVisualizer
4. Write the plan prompt to Arthur's terminal (or use pre-seeded prompt)
5. Wait for sub-agent events to start flowing
6. NPCs walk in and show progress

**Alternative:** Arthur may already be executing the plan from the meeting terminal.
In that case, we just need to start tracking — no prompt writing needed.

### 3.5 Fleet Completion Handling

When all sub-agents finish (`fleet:complete` event):

1. Show a completion notification (could use existing `NotificationService`)
2. Update fleet dashboard with summary
3. Give player option to:
   - Review Arthur's terminal output (the parent session has all results)
   - Stay in fleet room and browse agent badges
   - Return to default office layout

**Not yet designed:** What the completion UI looks like. Could be:
- A simple toast notification: "Fleet complete: 9/10 tasks succeeded"
- A modal overlay with per-task results
- Just badge updates (simplest)

### 3.6 Error Recovery

What happens when things go wrong:

| Scenario | Current Handling | Needed |
|----------|-----------------|--------|
| Sub-agent fails | FleetTracker sets `state: 'failed'` with error | ✅ Badge shows ❌, NPC walks out |
| Arthur's terminal crashes | `onTerminalExit` fires | ❌ Need to detect and stop fleet tracking |
| Player closes Arthur's terminal mid-fleet | Terminal killed | ❌ Need to gracefully wind down fleet |
| All sub-agents fail | FleetTracker reports `isActive: false` | ⚠️ `fleet:complete` fires but no success summary |
| Network timeout / model errors | `subagent.failed` event has error text | ✅ Handled by FleetTracker |

### 3.7 Re-entry and Persistence

What if the player:
- **Leaves the fleet room** — Fleet continues in background (events.jsonl keeps flowing).
  Re-entering should show current state (badges restored from FleetTracker snapshot).
- **Switches offices** — Fleet tracking per-office. Switching back should restore state.
- **Reloads the app** — Fleet state is lost (FleetTracker is in-memory). Could persist to
  localStorage but probably not worth it for v1.

---

## Phase 3 File Changes Summary

### Modified Files
| File | Changes |
|------|---------|
| `src/scenes/OfficeScene.ts` | Instantiate FleetTracker + FleetVisualizer in rebuildLayout, cleanup on layout switch, handle wake data from MeetingScene |
| `src/main.ts` | Wire FleetDashboard to `fleet:status` events, show/hide fleet panel |
| `src/meeting/fleetVisualizer.ts` | Possibly add `fleet:status` event emission for dashboard updates |

### No New Files Expected
All components exist — this is purely wiring and integration.

---

## Implementation Order

```
Sequential (each builds on the previous):
  3.1 Fleet Pipeline Wiring
    → 3.4 Meeting Room → Fleet Room Transition
    → 3.3 FleetDashboard Integration
    → 3.5 Fleet Completion Handling

Independent:
  3.2 Fleet Mode Entry Detection (can be added later)
  3.6 Error Recovery (hardening pass)
  3.7 Re-entry and Persistence (nice-to-have)
```

**Minimum viable fleet experience (3.1 + 3.4):**
Player approves plan → fleet room appears → NPCs walk in → badges update → NPCs walk out when done.

**Full experience (3.1 through 3.5):**
Above + right panel dashboard + completion notification.

---

## Open Questions

1. **Should fleet tracking start from the meeting room?** Arthur may begin fleet mode while still
   in the meeting terminal. Should we start FleetTracker before returning to the office?

2. **Single office or separate fleet office?** Currently `rebuildLayout('fleet-vteam')` transforms
   the current office. Alternative: create a new "fleet office" (already partially supported in main.ts).

3. **What triggers Arthur to use fleet mode?** The meeting prompt asks Arthur to create a plan,
   but doesn't explicitly tell him to use `autopilot_fleet`. Should the prompt be updated to
   instruct fleet mode after approval?

4. **FleetDashboard: which one?** Two dashboard files exist. Should we use the pre-existing
   layout renderer (`src/layouts/fleet/FleetDashboard.ts`) and enhance it, or replace it with
   the new class (`src/ui/FleetDashboard.ts`)?
