---
applyTo: "src/meeting/**"
---

# Meeting Mode — `src/meeting/`

## Purpose

Meeting Mode is a structured planning workflow where the player meets with **Arthur (Architect)** in a dedicated meeting room scene. Arthur creates a task plan via his Copilot CLI session, decomposes it into subtasks, and assigns them to other agents (Gene, Dan, Alice). The player reviews and approves the plan before agents execute in parallel.

## Files

### `types.ts` — Shared Interfaces
- **`MeetingPlan`** — `{ plan: string, tasks: TaskAssignment[] }` — the overall plan description plus an array of task assignments.
- **`TaskAssignment`** — `{ agentId: string, title: string, description: string, prompt: string }` — a single task assigned to a specific agent, including the full prompt to send to their terminal.
- **`FleetStatus`** — `{ agentId: string, state: 'pending'|'starting'|'working'|'done'|'failed', taskTitle: string }` — tracks each agent's execution state during fleet mode.

### `planParser.ts` — Terminal Output Parser
Parses Arthur's Copilot CLI terminal output to extract a structured `MeetingPlan`:
1. **`stripAnsi(text)`** — removes ANSI escape codes (CSI sequences and OSC sequences) from raw terminal data.
2. **`extractJsonBlocks(text)`** — finds fenced ` ```json ``` ` code blocks and extracts their content.
3. **`validateMeetingPlan(obj, validAgentIds)`** — validates parsed JSON matches the `MeetingPlan` schema and filters tasks to only those with valid agent IDs.
4. **`parsePlanFromOutput(terminalOutput, validAgentIds?)`** — full pipeline: strip ANSI → extract JSON blocks → parse & validate → return `MeetingPlan | null`.

Default valid agent IDs: `['generalist', 'debugger', 'admin']` (excludes `architect` since Arthur is the planner).

### `planApproval.ts` — Plan Approval Overlay
DOM-based overlay (`z-index: 10002`) that displays the parsed plan for player review:
- Shows plan summary and per-task cards with agent name, color badge, title, and description.
- Three actions: **Approve** (execute plan), **Revise** (send feedback to Arthur's terminal), **Cancel** (dismiss).
- Revise mode shows a textarea for player feedback, then hides overlay and calls `onRevise(feedback)`.
- Uses `PlanApprovalCallbacks` interface: `{ onApprove, onRevise, onCancel }`.

### `fleetOrchestrator.ts` — Fleet Task Orchestration
Manages parallel agent spawning and task execution after a plan is approved:
- **`FleetOrchestrator`** class with event-driven architecture (`on`/`off`/`emit` pattern).
- **`FleetAgentState`** — per-agent state: `pending` → `starting` → `working` → `done`/`failed`, with timestamps and error tracking.
- **`executePlan(plan, workingDir)`** — initializes all agents as pending, attaches IPC listeners, then spawns agents with staggered starts (`STAGGER_DELAY_MS` = 1500 ms).
- **`spawnAgent()`** — calls `terminalStart`, retries once on failure (`RETRY_DELAY_MS` = 2000 ms), then writes the task prompt and sets session metadata.
- Tracks readiness via `onTerminalPreloadStatus` (→ `working`), completion via `onCopilotTurnEnd` (→ `done`), and unexpected exits via `onTerminalExit`.
- **`cancel()`** — kills all active agents and marks them as failed.
- Events: `fleet:agent:started`, `fleet:agent:working`, `fleet:agent:done`, `fleet:agent:failed`, `fleet:all:complete`.
- Uses a `detached` flag pattern to disable listeners without calling `removeListeners()` (which would nuke all IPC listeners including main.ts's).

### `fleetTracker.ts` — Renderer-Side Fleet State Machine
Tracks sub-agent lifecycle from the parent agent's (Arthur's) Copilot CLI event stream:
- **`FleetTracker`** — subscribes to `onCopilotEvent`, `onCopilotToolStart`, `onCopilotToolComplete` for a specific parent agent.
- **`SubAgentTracker`** — per-sub-agent state: `dispatched` → `running` → `completed`/`failed`, with `toolCallId`, `agentType`, `taskDescription`, `taskPrompt`, timestamps.
- **`FleetState`** — aggregate snapshot: `subAgents` map, `activeToolCount`, `totalToolsCompleted`, `isActive`, `counts` by state.
- Event processing pipeline: `tool.execution_start` (dispatched) → `subagent.started` (running) → `subagent.completed`/`subagent.failed` → `system.notification` (agent ID mapping).
- **Silent attach**: calls `terminalAttach` without showing the terminal UI to enable event flow. Periodic re-attach (10 s) as a safety net.
- `startTracking()` / `dispose()` / `reset()` lifecycle. `onUpdate(cb)` returns an unsubscribe function.

### `fleetVisualizer.ts` — Fleet NPC Visualization
Bridges `FleetTracker` data to OfficeScene Phaser visuals via game events:
- **`FleetVisualizer`** — subscribes to `FleetTracker.onUpdate()`, emits `fleet:*` game events.
- **Seat assignment**: Maps sub-agents to fleet NPC seats (random selection, excludes Arthur's seat at index 7). Uses a 2-second debounce window to batch initial assignments.
- **Game events emitted**: `fleet:assign` (batch seat mappings), `fleet:dismiss-unassigned` (walk out unused NPCs), `fleet:agent:badge` (per-agent status update), `fleet:agent:exit` (walk out on completion, 2 s delay), `fleet:agent:late-spawn` (single agent after initial batch), `fleet:status` (aggregate counts), `fleet:complete` (all done).
- Maps `SubAgentTracker` states to `AgentStatus` badge states: dispatched→starting, running→thinking, completed→ready, failed→error.
- `start(scene)` / `dispose()` lifecycle.

## Feature Context

Read `MeetingMode.md` at the repo root for the full design.

- **Phase 1** (done): Meeting room scene, sprite generation, scene transitions, terminal integration
- **Phase 2** (done): Plan parsing, plan approval UI, exit animations
- **Phase 3** (implemented): Fleet orchestrator, tracker, and visualizer — parallel sub-agent spawning, lifecycle tracking, and NPC visualization

## Key Rules

- Plan parser **must** handle malformed or partial terminal output gracefully — always return `null` on failure, never throw.
- ANSI escape code stripping is **required** before any JSON extraction — raw terminal data contains CSI/OSC sequences.
- Task assignments must reference valid agent IDs from `src/config/agents.ts`. Invalid IDs are skipped with a warning.
- The plan approval overlay sits at `z-index: 10002` (above terminal overlay at 10000).
- Always read `MeetingMode.md` before making changes to understand the current implementation state.

## Common Pitfalls

- **ANSI codes break JSON parsing**: Terminal output contains escape sequences that corrupt JSON. Always use `stripAnsi()` before `extractJsonBlocks()`.
- **Plan JSON may be split across events**: Terminal data arrives in chunks via IPC. Accumulate output before parsing — don't parse each data event independently.
- **Agent ID mismatch**: Arthur may output agent IDs that don't match the roster. The validator silently skips invalid tasks — check that at least one valid task remains.
- **Overlay z-index conflicts**: The approval overlay must be above the terminal overlay and sprite card bar. Use `z-index: 10002` or higher.
