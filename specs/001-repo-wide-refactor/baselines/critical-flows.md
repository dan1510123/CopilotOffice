# Critical Flows — Behavior Baselines

Schema matches `data-model.md` → `BehaviorBaseline`. Every slice MUST link to one baseline_id below.

Behavior is captured from current code in `src/` and `electron/` as the authoritative source of
truth. Any drift from this baseline during a slice requires either a passing parity check or an
approved `ApprovalRecord`.

---

## BL-001 Player Movement

- **Inputs**: WASD or Arrow keys; Shift modifier for 2× sprint.
- **Owner**: `src/entities/Player.ts`, `src/input/GameInputListener.ts`, `src/scenes/OfficeScene.ts`.
- **Observable behavior**:
  - Holding a direction moves the player at base speed in tile-aligned axes.
  - Holding Shift while moving doubles speed (sprint).
  - Releasing all direction keys stops player; idle animation resumes facing last direction.
  - Movement is blocked by collision tiles and other NPC/furniture sprites.
- **Out of scope**: changes to base speed, sprint multiplier, or collision footprint without
  approved ApprovalRecord.

---

## BL-002 Agent Interaction (E key)

- **Inputs**: `E` key while player is adjacent to an NPC.
- **Owner**: `src/entities/NPC.ts`, `src/scenes/OfficeScene.ts`, `src/main.ts` (event wiring).
- **Observable behavior**:
  - Pressing `E` near an NPC emits `agent:interact` on `game.events` with the agent id.
  - The right panel switches from Overview Dashboard to Terminal View for that agent.
  - If no session exists for the agent, one is started; otherwise the existing session reattaches.
  - Status badge transitions: `slacking → starting → ready` on first open.
- **Out of scope**: changes to keybind, adjacency radius, or the agent → terminal contract.

---

## BL-003 Terminal Open / Close Lifecycle

- **Inputs**: open via `agent:interact`; close via `F10` or `Escape`.
- **Owner**: `src/ui/TerminalOverlay.ts`, `src/ui/SeriousTerminalController.ts`, `src/main.ts`,
  `electron/terminal/server.ts`, `electron/terminal/preload.ts`.
- **Observable behavior**:
  - `attach` displays the existing session buffer (scrollback replay).
  - `detach` keeps the session alive in the background; PTY continues to run.
  - `F10`/`Escape` triggers detach and returns InputManager to `game` focus.
  - `terminal:open` and `terminal:close` events fire on `game.events`.
  - Status badge updates reflect waiting/thinking/ready transitions driven by `copilot-event`
    messages from the PTY server.
- **Out of scope**: changes to the open/close keybinds, default detach behavior, or the
  `window.copilotBridge` API shape.

---

## BL-004 Office Switching

- **Inputs**: clicking an office tab or invoking the office switcher.
- **Owner**: `src/office/officeManager.ts`, `src/scenes/OfficeScene.ts`, `src/main.ts`,
  `.data/copilot-offices.json` persistence.
- **Observable behavior**:
  - Switching offices fires `office:switch` and re-renders the Phaser scene for the new office.
  - Each agent's status and session metadata persist across switches.
  - Sprite cards in the dashboard refresh to the new office's roster.
  - The active terminal session for an agent in the previous office is detached, not killed; it
    can be reattached when returning.
- **Out of scope**: changes to persistence file location or the per-office roster schema.

---

## BL-005 Meeting Mode Entry

- **Inputs**: triggering the meeting flow via Arthur's interaction or the meeting affordance.
- **Owner**: `src/meeting/planParser.ts`, `src/meeting/planApproval.ts`,
  `src/scenes/MeetingScene.ts`.
- **Observable behavior**:
  - Meeting Scene takes over the Phaser canvas; the office is paused (no input handling there).
  - Arthur outputs a structured plan; `planParser.ts` parses it into typed entries.
  - `planApproval.ts` renders the approval UI; user can approve/reject/edit.
  - Approval triggers `meeting:approved` with the typed plan payload.
- **Out of scope**: changes to plan schema or approval gate.

---

## BL-006 Fleet Orchestration

- **Inputs**: an approved meeting plan with agent assignments.
- **Owner**: `src/meeting/fleetOrchestrator.ts`, `src/meeting/fleetTracker.ts`,
  `src/meeting/fleetVisualizer.ts`, `electron/terminal/server.ts`.
- **Observable behavior**:
  - Orchestrator spawns one CLI session per assigned agent in parallel.
  - Tracker maintains per-agent fleet state on the renderer side.
  - Visualizer reflects fleet NPCs in a fleet-vteam office.
  - Sub-agent lifecycle events (`copilot-event`) flow even when the user is not viewing the
    agent's terminal.
- **Out of scope**: changes to fleet spawn topology or session-transfer key invariant.

---

## BL-007 Sub-Agent Lifecycle Forwarding

- **Owner**: `electron/terminal/server.ts`, `electron/terminal/events-watcher.ts`.
- **Observable behavior**:
  - Sub-agent start/complete events are forwarded to the renderer through `copilot-event` whether
    or not the agent's terminal is currently attached.
  - After session transfer to a fleet office, both the original composite key and the new fleet
    key are recognized for active forwarding (dual-key `activeAgentViewers` invariant).
- **Out of scope**: changes to forwarding gating logic without explicit ApprovalRecord.

---

## BL-008 Input Focus Transitions

- **Owner**: `src/input/InputManager.ts`, `src/input/GameInputListener.ts`,
  `src/input/TerminalInputListener.ts`, `src/input/GlobalInputListener.ts`.
- **Observable behavior**:
  - Two mutually exclusive focus states: `game` and `terminal`.
  - All transitions go through `InputManager` (no direct Phaser keyboard manipulation in scenes
    or UI overlays).
  - Opening an overlay (settings, mini-game) saves prior focus and restores it on close.
  - F10/Escape from terminal returns focus to `game`.
- **Out of scope**: any additional focus state or alternative routing path.

---

## BL-009 Status Badge Transitions

- **Owner**: `src/main.ts` (status wiring), agent badge components, `electron/terminal/server.ts`
  (event emission).
- **Observable behavior**:
  - State machine: `slacking → starting → ready ↔ waiting/thinking → slacking`.
  - `ask_user` events transition the badge to `waiting` even if other tools complete in the same
    tick.
  - Closing a session returns the badge to `slacking`.
- **Out of scope**: new badge states without ApprovalRecord.

---

## Critical Flow → Slice Map

| baseline_id | covered by slice |
|-------------|------------------|
| BL-001 | S1-B (scene) |
| BL-002 | S1-B (scene) + S1-C (terminal renderer) |
| BL-003 | S1-C (renderer) + S1-D (server) |
| BL-004 | S1-B (scene) + S2-A (office state) |
| BL-005 | S1-E (meeting/fleet) |
| BL-006 | S1-E (meeting/fleet) |
| BL-007 | S1-D (server) |
| BL-008 | S1-A (input) |
| BL-009 | S1-C (renderer) |
