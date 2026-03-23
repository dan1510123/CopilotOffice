# Meeting Mode — Feature Design & Implementation Plan

## Overview

Meeting Mode is a collaborative planning workflow where the player meets with **Arthur the Architect** in a dedicated meeting room scene. Arthur plans a task, decomposes it into subtasks, assigns them to available agents, and then those agents spin up in parallel to execute the work — each with their own visible Copilot CLI terminal session.

### User Flow

```
1. Player interacts with Arthur (E key or click) in the office
2. Scene transitions to a meeting room
3. Arthur's terminal opens on the right panel — player discusses the task
4. Arthur produces a structured plan with agent assignments
5. Player approves the plan
6. Player and Arthur walk out of the meeting room
7. Scene returns to the main office
8. Assigned agents spawn terminal sessions in parallel
9. Agent NPCs walk from the entrance to their desks, showing "working" status
10. Player can monitor agent progress via the dashboard or click into any agent's terminal
```

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                      MEETING MODE FLOW                       │
│                                                              │
│  OfficeScene ──[interact Arthur]──▶ MeetingScene             │
│       │                                │                     │
│       │                          Arthur's Terminal            │
│       │                          (planning session)          │
│       │                                │                     │
│       │                          Plan Complete               │
│       │                          (parse JSON tasks)          │
│       │                                │                     │
│       │                          Player Approves             │
│       │                                │                     │
│  ◀──[walk out + scene return]─────────┘                      │
│       │                                                      │
│  Fleet Orchestrator                                          │
│       ├─ Spawn Agent 1 Terminal (copilotBridge.terminalStart)│
│       ├─ Spawn Agent 2 Terminal                              │
│       └─ Spawn Agent N Terminal                              │
│       │                                                      │
│  NPC Walk Animations → Assigned Desks                        │
│       │                                                      │
│  Agents Working (visible terminals, status badges)           │
│       │                                                      │
│  Fleet Complete → Summary                                    │
└──────────────────────────────────────────────────────────────┘
```

---

## Research: Multi-Agent Orchestration

### Option 1: Copilot CLI Fleet Mode (`/fleet` or `autopilot_fleet`)
- Copilot CLI natively decomposes prompts into subtasks and runs subagents in parallel
- Runs **within a single CLI session** — not separate visible terminals per agent
- Best for: internal planning decomposition within Arthur's session

### Option 2: Multiple Independent CLI Sessions (via node-pty)
- Spawn N separate `copilot --resume {sessionId}` PTY processes
- Each agent gets a **visible terminal**, full session persistence
- Already fully supported by our `TerminalRelay` infrastructure
- Best for: the visible "agents working at desks" experience

### ✅ Chosen: Hybrid Approach
1. Arthur plans using his terminal (standard single-agent session with meeting prompt)
2. Arthur's system prompt instructs structured JSON output with task assignments
3. Our app **parses Arthur's plan** to extract task assignments
4. App spawns **independent Copilot CLI sessions** for each assigned agent
5. Each agent's terminal receives their specific task prompt

**Why hybrid?**
- Visible planning in Arthur's terminal (player watches/participates)
- Visible parallel execution — each agent NPC has their own real terminal
- Leverages existing infrastructure — TerminalRelay already handles N parallel PTYs
- Real work — each agent actually runs Copilot CLI doing their assigned task

---

## Phase 1: MeetingScene — Game UI

### 1.1 MeetingScene Phaser Scene
**New file**: `src/scenes/MeetingScene.ts`

Room layout (~16×10 tiles):
```
┌──────────────────────────────────┐
│  [whiteboard]                    │
│                                  │
│        ┌──────────────┐          │
│        │              │          │
│  ══    │   MEETING    │   Arthur │
│  ══    │    TABLE     │   (top)  │
│ doors  │  (rounded)   │          │
│        │              │          │
│        └──────────────┘          │
│                           Player │
│                          (bottom)│
└──────────────────────────────────┘
```

- Large rounded rectangular horizontal table, centered
- Player sprite on bottom side of table
- Arthur sprite on top side, facing down
- Double doors on the left wall
- Minimal decor: whiteboard, subtle carpet/rug
- All sprites procedurally generated (follow BootScene pattern)

**Registration**: Add `MeetingScene` to Phaser game config in `src/main.ts`

### 1.2 Sprite Generation (BootScene additions)
Add to `src/scenes/BootScene.ts`:
- Meeting table sprite (large, rounded rectangular, wood grain, ~192×96px)
- Double door sprite (wider than regular door, ~64×96px)
- Whiteboard sprite (~128×64px)
- Meeting chairs (smaller than office chairs)

### 1.3 Scene Transition System
**Trigger**: Interacting with Arthur (E key or click) goes directly to meeting mode.

```
OfficeScene → MeetingScene:
  1. Player tween walks toward Arthur
  2. Camera fade out (500ms)
  3. scene.sleep('Office') — preserves office state
  4. scene.start('Meeting') or scene.launch('Meeting')
  5. Camera fade in on meeting room

MeetingScene → OfficeScene:
  1. Player + Arthur tween walk toward doors
  2. Camera fade out
  3. scene.stop('Meeting')
  4. scene.wake('Office', { plan: parsedPlan })
  5. Camera fade in on office
```

**Data passing**: Use Phaser's scene data mechanism: `this.scene.start('Meeting', { ... })`

### 1.4 Input Integration
- New `InputManager` instance for MeetingScene
- Terminal overlay on right panel (reuse existing `TerminalOverlay`)
- Player does **NOT** freely walk — seated at table
- Input defaults to terminal focus (Arthur's session)
- F10 / Escape closes terminal but stays in meeting (doesn't return to office)

---

## Phase 2: Arthur's Planning Session

### 2.1 Meeting Prompt System
**New file**: `src/config/meetingPrompt.ts`

Arthur's system prompt instructs him to:
1. Greet the player and ask about the task
2. Discuss requirements, ask clarifying questions
3. Break the task into subtasks
4. Assign each subtask to a specific agent from the roster
5. Output a structured JSON plan in a fenced code block

**Agent roster included in prompt**:
```
Available Agents:
- Gene (generalist): General-purpose assistant — coding, debugging, research
- Dan (debugger): Bug investigation, stack traces, root cause analysis
- Alice (admin): Office Admin — UI code, game features, CSS/layout (workingDir: '.')
```

### 2.2 Plan Output Parser
**New file**: `src/meeting/planParser.ts`

Monitors Arthur's terminal output for structured plan markers:

```json
{
  "plan": "Brief description of overall plan",
  "tasks": [
    {
      "agentId": "generalist",
      "title": "Implement API endpoints",
      "description": "Create REST endpoints for user CRUD...",
      "prompt": "The full prompt to send to this agent's terminal"
    },
    {
      "agentId": "debugger",
      "title": "Write integration tests",
      "description": "Test all new endpoints with edge cases...",
      "prompt": "The full prompt to send to this agent's terminal"
    }
  ]
}
```

**Parsing strategy**:
- Strip ANSI escape codes from terminal output
- Look for ` ```json ... ``` ` fenced blocks
- Parse JSON, validate `agentId`s against known agents
- Emit `meeting:plan:ready` event with parsed plan
- **Fallback**: Manual "approve" button if auto-parse fails

### 2.3 Plan Approval UI
After Arthur outputs the plan:
- Show plan summary overlay in meeting room (task list with agent assignments)
- Buttons: **Approve** | **Revise** (sends feedback to Arthur) | **Cancel** (return to office)
- On **Approve**: trigger Phase 3 exit sequence

### 2.4 Meeting Types
**New file**: `src/meeting/types.ts`

```typescript
interface TaskAssignment {
  agentId: string;
  title: string;
  description: string;
  prompt: string;
}

interface MeetingPlan {
  plan: string;
  tasks: TaskAssignment[];
}

interface FleetStatus {
  agentId: string;
  state: 'pending' | 'starting' | 'working' | 'done' | 'failed';
  taskTitle: string;
}
```

---

## Phase 3: Exit Animations & Return to Office (Done)

### 3.1 NPC Walk Animation System
**Modified file**: `src/entities/NPC.ts`

New method on NPC class:
```typescript
async walkTo(targetX: number, targetY: number, speed?: number): Promise<void> {
  // 1. Calculate direction from current position to target
  // 2. Set walk animation for that direction
  // 3. Create Phaser tween moving x,y to target
  // 4. Update direction as tween progresses (for multi-segment paths)
  // 5. On complete: stop animation, set standing frame
  // 6. Resolve promise
}
```

Uses **Phaser tweens** (not physics) for scripted movement — no pathfinding needed.

### 3.2 Meeting Exit Sequence
On plan approval:
1. Close Arthur's terminal overlay
2. Short delay (500ms) for dramatic effect
3. Player tweens toward left-side double doors
4. Arthur tweens toward left-side double doors (slightly behind player)
5. Camera fade to black
6. Transition back to OfficeScene with plan data

### 3.3 Office Re-entry Sequence
OfficeScene receives plan data via `scene.wake()` event:
1. Player enters from normal entrance (tween upward)
2. Arthur appears at his desk position (2, 9)
3. If plan has task assignments → trigger Phase 4 (fleet spawning)

---

## Phase 4: Parallel Agent Spawning (Code Exists — Wiring Incomplete)

Fleet orchestration code has been built but the full pipeline is not yet connected end-to-end.

### 4.1 Fleet Orchestrator (Built)
**File**: `src/meeting/fleetOrchestrator.ts`

The `FleetOrchestrator` class exists and handles:
- Staggered agent spawning via `copilotBridge.terminalStart()`
- Per-agent state tracking (pending → starting → working → done/failed)
- Event listeners for terminal preload status, exit, and copilot turn end
- Retry logic (one retry on spawn failure)
- Cancel support with process-tree kill
- Event emission: `fleet:agent:started`, `fleet:agent:working`, `fleet:agent:done`, `fleet:agent:failed`, `fleet:all:complete`

### 4.1b Fleet Tracker (Built)
**File**: `src/meeting/fleetTracker.ts`

The `FleetTracker` class monitors Copilot CLI sub-agent events from `events.jsonl`:
- Tracks sub-agent lifecycle: dispatched → running → completed/failed
- Parses `tool.execution_start`, `subagent.started`, `subagent.completed`, `subagent.failed` events
- Provides `FleetState` snapshots with aggregate counts and active tool tracking
- Uses silent `terminalAttach()` to enable event flow without showing the terminal UI

### 4.1c Fleet Visualizer (Built)
**File**: `src/meeting/fleetVisualizer.ts`

The `FleetVisualizer` bridges `FleetTracker` data to Phaser game events:
- Maps sub-agents to fleet NPC seat positions (14 seats, Arthur's seat reserved)
- 2-second debounce window for batch seat assignment
- Emits `fleet:assign`, `fleet:dismiss-unassigned`, `fleet:agent:badge`, `fleet:agent:exit`, `fleet:agent:late-spawn`, `fleet:status`, `fleet:complete`
- Handles walk-out scheduling for completed/failed agents

### Remaining gaps
- **Pipeline wiring**: FleetTracker and FleetVisualizer are never instantiated — need to be connected in OfficeScene
- **Meeting→Fleet transition**: OfficeScene wake handler has a stub for fleet orchestration
- **FleetDashboard integration**: Dashboard exists but not wired to FleetTracker updates

### 4.2 Agent Walk-to-Desk Animation (Built)
Fleet V-Team uses a dedicated layout (`fleet-vteam`) with a 9×3 conference table and 14 seats
(5 top, 5 bottom, 2 left, 2 right). Seat index 7 (bottom-middle) is reserved for Arthur.
Agent walk-in/walk-out animations and badge updates are driven by `fleet:*` game events
emitted by `FleetVisualizer`.

### 4.3 Agent Status Integration
Leverage existing `officeManager.ts` status system:
- `starting` → terminal spawning
- `active/thinking` → agent working (with `thinkingDetail` from tool events)
- `ready` → agent completed task

---

## Phase 5: Fleet Dashboard (Partially Built)

### 5.1 Fleet Overview Panel
Modify right-panel dashboard when fleet is active:
- Per-agent row: name, task title, status indicator, current tool
- Click agent → view their terminal (existing attach/detach)
- Overall progress bar (N of M tasks complete)

### 5.2 Fleet Completion
When all agents finish:
- Completion notification/animation
- Agents return to idle state
- Fleet summary in dashboard
- Option to review each agent's work

---

## File Changes Summary

### New Files
| File | Phase | Purpose |
|------|-------|---------|
| `src/scenes/MeetingScene.ts` | 1 | Meeting room Phaser scene |
| `src/meeting/types.ts` | 2 | Shared types (MeetingPlan, TaskAssignment, FleetStatus) |
| `src/config/meetingPrompt.ts` | 2 | Arthur's meeting system prompt template |
| `src/meeting/planParser.ts` | 2 | Parse structured plan from terminal output |
| `src/meeting/planApproval.ts` | 2 | Plan approval overlay (Approve/Revise/Cancel) |
| `src/meeting/fleetOrchestrator.ts` | 4 | Spawn and coordinate parallel agent sessions |
| `src/meeting/fleetTracker.ts` | 4 | Track sub-agent events from events.jsonl |
| `src/meeting/fleetVisualizer.ts` | 4 | Bridge tracker data to Phaser game events |

### Modified Files
| File | Phase | Changes |
|------|-------|---------|
| `src/scenes/BootScene.ts` | 1 | Meeting room sprite generation (table, doors, whiteboard) |
| `src/main.ts` | 1 | Register MeetingScene in Phaser config, meeting events |
| `src/scenes/OfficeScene.ts` | 1,3 | Meeting trigger on Arthur interaction, fleet return handling |
| `src/entities/NPC.ts` | 3 | Add `walkTo()` tween-based movement method |
| `src/config/agents.ts` | 1 | ✅ Done — Gene (4,3), Arthur (2,9), Dan (13,3), Alice (17,9) |
| `src/config/depths.ts` | 1 | Add meeting-specific depth constants if needed |
| `src/ui/TerminalOverlay.ts` | 1 | Support meeting mode terminal header |
| `src/office/officeManager.ts` | 4 | Fleet tracking state |
| `electron/terminal/server.ts` | 4 | Pre-seeded prompt support on terminal start (optional) |

---

## Technical Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Scene management | `scene.sleep()` / `scene.wake()` | Preserves office state during meeting |
| NPC movement | Phaser tweens (not physics) | Simpler for scripted paths, no pathfinding needed |
| Meeting trigger | E key / click on Arthur → direct to meeting | No separate "Talk" option — Arthur is the Architect |
| Plan parsing | JSON in fenced code blocks + ANSI stripping | Robust enough with manual fallback button |
| Agent isolation | Same working directory | Simpler to start; git worktrees can be added later |
| Multi-agent backend | Hybrid (Arthur plans → app spawns independent sessions) | Best of both worlds: visible planning + visible execution |
| Implementation scope | Phases 1-3 done, Phase 4 code built (wiring incomplete) | Meeting room + planning + animations done; fleet code exists but pipeline not connected |

---

## Implementation Order (Phases 1-3)

```
Independent (can parallelize):
  ├─ meeting-sprites (BootScene sprite generation)
  ├─ meeting-scene (MeetingScene.ts)
  ├─ meeting-prompt (meetingPrompt.ts)
  └─ npc-walk (NPC.walkTo() method)

Sequential:
  meeting-sprites + meeting-scene
    → scene-transitions (Office↔Meeting transitions)
    → meeting-input (InputManager + terminal integration)

  meeting-prompt
    → plan-parser (planParser.ts)
    → plan-approval-ui (approve/revise/cancel)

  npc-walk + plan-approval-ui
    → meeting-exit (walk out sequence)
    → office-reentry (return to office with plan data)
```
