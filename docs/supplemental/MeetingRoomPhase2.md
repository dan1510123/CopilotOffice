# Meeting Room — Phase 2 Implementation Plan

> **Status**: Phase 2 items described below have been largely implemented. Fleet orchestration
> code exists in `src/meeting/fleetOrchestrator.ts`, `fleetTracker.ts`, and `fleetVisualizer.ts`.
> The remaining work is wiring the pipeline end-to-end (see `MeetingRoom-Phase3.md`).

## What's Done (Phase 1)

Phase 1 delivered the core meeting room experience:

### Files Created
| File | Purpose |
|------|---------|
| `src/scenes/MeetingScene.ts` | 6×5 tile meeting room, 3× zoom, seated player+Arthur, terminal overlay, plan detection, exit animations |
| `src/meeting/types.ts` | `TaskAssignment`, `MeetingPlan`, `FleetStatus` interfaces |
| `src/config/meetingPrompt.ts` | Arthur's meeting prompt template with agent roster + JSON output format |
| `src/meeting/planParser.ts` | ANSI stripping, fenced JSON extraction, plan validation |
| `src/meeting/planApproval.ts` | DOM overlay with Approve / Revise / Cancel flow |

### Files Modified
| File | Changes |
|------|---------|
| `src/scenes/BootScene.ts` | Added 4 meeting sprites: `meeting_table`, `meeting_double_door`, `meeting_whiteboard`, `meeting_chair` |
| `src/main.ts` | Registered `MeetingScene` in Phaser scene config |
| `src/scenes/OfficeScene.ts` | Arthur interaction override → `enterMeeting()`, wake handler for return with plan data |
| `src/entities/NPC.ts` | Added `walkTo()` tween method + `updateAttachedPositions()` |

### Current Flow
```
Player presses E near Arthur
  → OfficeScene.enterMeeting() → camera fade → scene.sleep('OfficeScene')
  → MeetingScene.create() → 3× zoomed room with Arthur's terminal auto-opened
  → Player chats with Arthur in terminal
  → Arthur outputs JSON plan in fenced code block
  → planParser detects it → PlanApprovalOverlay shows
  → Approve: exitMeeting(plan) → walk-to-doors animation → fade → wake OfficeScene with plan
  → Revise: sends feedback to Arthur's terminal, resets plan detection
  → Cancel: dismisses overlay, stays in meeting
  → Ctrl+Enter or "Leave Meeting" button: exitMeeting() without plan
  → OfficeScene wakes, triggers entrance, resets Arthur NPC status
```

### What's Working
- [x] Scene transition (Office → Meeting → Office)
- [x] Cozy 6×5 room with 3× camera zoom
- [x] Arthur's terminal auto-opens on meeting start
- [x] Plan parsing from terminal output (ANSI-stripped, fenced JSON)
- [x] Plan approval overlay (Approve/Revise/Cancel)
- [x] Exit via Ctrl+Enter or DOM button
- [x] Walk-to-doors exit animation
- [x] Office re-entry with plan data (stubbed for fleet)
- [x] NPC.walkTo() tween method ready for walk-in animations

---

## Phase 2: What Remains (Mostly Built)

> Most items below now have implementations. See current fleet code:
> - `src/meeting/fleetOrchestrator.ts` — agent spawning, staggered starts, retry logic, cancel support
> - `src/meeting/fleetTracker.ts` — sub-agent event tracking from events.jsonl
> - `src/meeting/fleetVisualizer.ts` — bridges tracker data to Phaser game events
> - Fleet V-Team layout with 14 seats in `src/config/agents.ts` (`FLEET_AGENTS`, `FLEET_SEAT_POSITIONS`)

### 2.1 Fleet Orchestrator — Parallel Agent Spawning (Built)
**New file**: `src/meeting/fleetOrchestrator.ts`

When the player approves a plan and returns to the office, the fleet orchestrator should:

1. **Spawn independent Copilot CLI sessions** for each assigned agent
2. **Track fleet status** per agent (pending → starting → working → done/failed)
3. **Emit events** for UI updates (`fleet:agent:started`, `fleet:agent:complete`, `fleet:all:complete`)

```typescript
class FleetOrchestrator {
  async executePlan(plan: MeetingPlan): Promise<void> {
    for (const task of plan.tasks) {
      // 1. copilotBridge.terminalStart(task.agentId, workingDir)
      // 2. Wait for 'ready' via onTerminalPreloadStatus
      // 3. copilotBridge.terminalWrite(task.agentId, task.prompt)
      // 4. Track status via FleetStatus[]
    }
  }
}
```

**Key decisions needed**:
- Spawn in parallel (Promise.all) vs staggered (1-2 second delays)?
- Same working directory for all agents, or per-agent (git worktrees)?
- How to detect agent completion (listen for copilot turn-end events)?

**Integration point**: `OfficeScene` wake handler currently has `// Phase 4 TODO: trigger fleet orchestrator with data.plan` — wire it here.

### 2.2 Agent Walk-to-Desk Animations
**Modify**: `src/scenes/OfficeScene.ts`

After each agent's terminal spawns:
1. NPC sprite appears at bottom entrance (where player enters)
2. NPC uses `walkTo()` (already implemented) to walk to their desk position
3. NPC shows "working" status badge (green pulsing) on arrival

This creates the visual effect of agents "arriving at work" to do their tasks.

**Approach**:
- Stagger walks by ~500ms per agent for visual clarity
- Use existing `AGENTS` position data for desk targets
- Agents already at their desks (from previous sessions) skip the walk

### 2.3 Agent Status Integration During Fleet
**Modify**: `src/office/officeManager.ts`, `src/scenes/OfficeScene.ts`

Map fleet states to existing agent status system:
| Fleet State | Agent Status | Badge |
|-------------|-------------|-------|
| `pending` | `slacking` | Gray 💤 |
| `starting` | `active/starting` | Yellow 🚀 |
| `working` | `active/thinking` | Green 🧠 (pulsing) |
| `done` | `active/ready` | Blue ✓ |
| `failed` | `active/error` | Red ❌ |

The existing `officeManager.setAgentThinking()`, `setAgentReady()`, etc. already support this — just need to call them from the fleet orchestrator.

### 2.4 Fleet Dashboard Panel
**Modify**: `src/main.ts` (right panel)

When a fleet is active, the right-panel dashboard should show:
- **Fleet header**: "Fleet Active — N of M tasks complete"
- **Per-agent row**: agent name, task title, status indicator, current tool
- **Click agent** → opens their terminal (existing attach/detach flow)
- **Progress bar**: visual N/M completion indicator

When fleet completes:
- Show completion notification/animation
- Summary of all agent results
- Option to review each agent's terminal output

### 2.5 Meeting Prompt Improvements
**Modify**: `src/config/meetingPrompt.ts`

Current prompt is functional but could be enhanced:
- Include the current working directory context
- Pass file tree or recent git log for better task decomposition
- Allow custom "meeting agenda" items
- Support re-entering a meeting to check on fleet progress

### 2.6 Pre-seeded Prompt Support
**Modify**: `electron/terminal/server.ts` or `ipc-relay.ts`

Currently, after spawning a terminal, we wait for it to be ready then write the prompt. A cleaner approach would be:
- Add a `preseededPrompt` option to `terminalStart`
- Server automatically sends the prompt once the CLI is ready
- Reduces race conditions and simplifies fleet orchestrator logic

---

## Phase 2 File Changes Summary

### New Files
| File | Purpose |
|------|---------|
| `src/meeting/fleetOrchestrator.ts` | Spawn and coordinate parallel agent sessions |

### Modified Files
| File | Changes |
|------|---------|
| `src/scenes/OfficeScene.ts` | Wire fleet orchestrator on wake, agent walk-in animations |
| `src/office/officeManager.ts` | Fleet tracking state, bulk status updates |
| `src/main.ts` | Fleet dashboard panel UI, fleet events |
| `src/config/meetingPrompt.ts` | Enhanced context (working dir, file tree) |
| `electron/terminal/server.ts` | Pre-seeded prompt support (optional) |

---

## Implementation Order

```
Independent (can parallelize):
  ├─ fleet-orchestrator (core spawning logic)
  ├─ fleet-dashboard (right panel UI)
  └─ prompt-improvements (meetingPrompt enhancements)

Sequential:
  fleet-orchestrator
    → agent-walk-in (walk-to-desk after spawn)
    → agent-status-integration (status badge updates during fleet)

  fleet-dashboard
    → fleet-completion (summary, notifications)

Optional:
  └─ pre-seeded-prompt (server-side prompt injection)
```

---

## Open Questions

1. **Git worktrees**: Should agents work in isolated directories to avoid conflicts? Current plan is same working directory — acceptable for read-heavy tasks, risky for parallel writes.
2. **Agent completion detection**: How to reliably detect when an agent finishes? Options: parse terminal for completion markers, listen for `copilot-turn-end` events, or timeout-based.
3. **Meeting re-entry**: Should the player be able to go back into a meeting with Arthur while a fleet is running? Useful for checking progress or adjusting plans.
4. **Error handling**: What happens if an agent's terminal crashes mid-task? Show error badge, allow retry, or skip?
