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

## Feature Context

This is an **active feature under development**. Read `MeetingMode.md` at the repo root for the full design.

- **Phase 1** (done): Meeting room scene, sprite generation, scene transitions, terminal integration
- **Phase 2** (done): Plan parsing, plan approval UI, exit animations
- **Phase 3** (next): Fleet orchestrator — parallel agent spawning and execution
- See `MeetingRoomPhase2.md` for Phase 2 details and Phase 3 plan

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
