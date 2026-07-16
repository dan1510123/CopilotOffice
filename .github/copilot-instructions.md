# Copilot Office - AI Coding Instructions

## Project Overview

A 2D pixel-art RPG-style game built with **Phaser 3** and **Electron**. Players walk around a virtual office and interact with NPC agents that represent different Copilot skills. Each NPC runs a real Copilot CLI session via xterm.js.

> **Directory-specific instructions** live in `.github/instructions/`. Each file uses `applyTo` frontmatter to scope guidance to its directory. This root file covers project-wide context only.

## Tech Stack

Phaser 3 (sole renderer) · Electron 40+ · TypeScript (strict) · esbuild · xterm.js + node-pty · ansi-to-html

## Architecture

```
src/                          # Renderer process (Phaser + DOM)
├── main.ts                   # Entry point — DOM layout, Phaser init, IPC wiring
├── scenes/                   # Phaser scenes (Boot → Office → Meeting)
├── entities/                 # Player + NPC game objects
├── sprites/                  # Procedural sprite generation + animation helpers
├── ui/                       # DOM overlays (terminal, mini-games, notifications)
├── input/                    # Three-tier keyboard focus system
├── office/                   # Multi-office state management (no rendering)
├── layouts/                  # Layout system (default + fleet-vteam)
├── config/                   # Agent definitions, depth constants, notification settings, player customization
└── meeting/                  # Meeting Mode: plan parsing, approval, fleet orchestration + tracking
electron/                     # Main process
├── main.ts                   # Window, IPC handlers, hot reload
└── terminal/                 # PTY server, preload bridge, event watcher, protocol types
```

## Key Patterns

### Split Layout (DOM + Phaser)
`src/main.ts` creates: office tabs (top) | Phaser game (left 50%) | terminal panel (right 50%) | status bar (bottom). The right panel switches between an agent Overview Dashboard and an xterm.js Terminal View.

### Event-Driven Communication
Phaser ↔ DOM coordination uses `game.events`. Key events: `agent:interact`, `terminal:open/close`, `office:switch`, `agent:status:changed`, `agent:tool:start`, `npc:highlight/clear-highlight`, `game:panel:clicked`.

### Multi-Office
`officeManager.ts` manages multiple offices with per-agent status tracking. Each `OfficeConfig` includes a `layout: OfficeLayout` field (`'default' | 'fleet-vteam'`). Persisted to `.data/copilot-offices.json`. Pure data — never renders.

### Feature Flags
Top of `OfficeScene.ts`: `ENABLE_DECORATIONS`, `ENABLE_BASKETBALL`, `ENABLE_GALAXIAN`, `ENABLE_ZOOM_BAR`.

### Procedural Sprites
All sprites generated in code (BootScene + SpriteGenerator) — no external image assets. 4-direction walk animations via DirectionalSprite.

### IPC Communication
Renderer → `window.copilotBridge` (preload context bridge) → Electron main → terminal server child process → node-pty.

### Terminal Backends
`electron/terminal/server.ts` selects the terminal backend from `COPILOT_TERMINAL_BACKEND` (default `ui-server`, auto-falls back to `node-pty` when the CLI can't host `--ui-server`) and always keeps node-pty as the permanent fallback.

- `node-pty` (default/fallback): spawns the real Copilot TUI directly per agent; programmatic prompts use the raw PTY path.
- `ui-server` (spec 013 Variant 1): node-pty hosts one `copilot --ui-server` runtime per office. An SDK `CopilotClient` attaches with `RuntimeConnection.forUri('localhost:<port>')`; programmatic prompts use `session.send({ prompt, mode: 'enqueue' })`; status/tool/turn events come from `session.on(...)` normalized to `CopilotEvent`; viewer attach calls `setForegroundSessionId` to choose the visible agent.
- `sdk` (legacy headless): SDK spawns its own headless runtime over stdio; retained for compatibility, not the Variant 1 target.

`--ui-server` is undocumented/hidden. A capability probe and per-session start-time fallback to node-pty are mandatory; do not make `ui-server` the default without revisiting that invariant.

### Input Focus
Two mutually exclusive states: `game` and `terminal`. All transitions through `InputManager` — never manipulate Phaser keyboard directly.

## NPC Agents

| ID | Name | Skill | Position | Purpose |
|----|------|-------|----------|---------|
| `generalist` | Gene | general | (4, 3) | General-purpose assistant |
| `debugger` | Dan | general | (13, 3) | Debugger — investigates and fixes issues |
| `admin` | Alice | general | (17, 9) | Office Admin — edits this game directly (`workingDir: '.'`) |

Arthur appears in fleet-vteam offices at (10, 8) by default (and can be toggled into the default office via config). 6 reserve agents (Azure, Validator, Deployer, Doctor, Scout, Accountant) have pre-generated sprites ready to activate. Status badges track: slacking → starting → ready ↔ waiting/thinking → slacking.

## Active Feature Plans

### Meeting Mode and Fleet Execution (implemented)
Arthur plans tasks in a meeting room, outputs structured JSON with agent assignments, then agents spin up parallel CLI sessions via the fleet orchestrator. The meeting directory contains:

- `types.ts` / `planParser.ts` / `planApproval.ts` — plan parsing and approval UI
- `fleetOrchestrator.ts` — fleet task orchestration (spawns parallel agent sessions)
- `fleetTracker.ts` — renderer-side fleet state machine
- `fleetVisualizer.ts` — fleet NPC visualization

See **`MeetingMode.md`** for design context. Always read it before making changes to meeting/fleet code.

### Teams Remote Agents (implemented — spec 011)
A per-agent "Teams remote" control (in `TerminalOverlay` + `SeriousTerminalController`, gated by the `TeamsSettings.enabled` feature flag) brings an agent online in a Microsoft Teams channel **thread**; anyone can drive it by replying in-thread, which routes into the agent's persistent terminal session, with answers posted back. The main-process service lives in `electron/teams/`:

- `teamsService.ts` — orchestrator (register/route/reply, reconnect/teardown/GC lifecycle)
- `auth.ts` (az Graph + ic3 tokens) · `graphClient.ts` (send) · `trouterClient.ts` (real-time receive WS) · `chatsvcClient.ts` (poll fallback)
- `messageFilter.ts` (dedup→marker→stale→channel→classify→injection) · `dispatchQueue.ts` (per-agent FIFO) · `sessionGateway.ts` (adapter over the terminal server via `TerminalRelay.mainEvents`)
- `channelLink.ts` · `handleRegistry.ts` · `marker.ts` (self-loop guard) · `chunk.ts` · `channelResolver.ts` · `onlineAgentsStore.ts` (`.data/teams-online-agents.json`, 30-day GC)

Config: global `TeamsSettings` (feature flag + default channel deep-link + check-in prefs, `.data/teams-settings.json`) and a per-office `OfficeConfig.teamsChannelUrl` override; effective channel = `office.teamsChannelUrl ?? settings.defaultChannelUrl`. Renderer↔main over `teams:*` IPC. See **`specs/011-teams-remote-agents/`** for the full spec, plan, and contracts.

## Common Tasks

- **Add NPC**: `src/config/agents.ts` → `src/sprites/SpriteGenerator.ts` (or use reserve sprite)
- **Add mini-game**: New class in `src/ui/` → feature flag in `OfficeScene.ts`
- **Modify layout**: `createOfficeLayout()` in `OfficeScene.ts` (20×12 tile grid, 64px tiles)

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrows | Move player |
| Shift | Sprint (2x) |
| E | Interact with agent/furniture |
| F10 | Close terminal |
| Escape | Close terminal or mini-game |
| Ctrl+Shift+N | New session (terminal focused) |

## Development

```bash
npm run build        # Build game + electron
npm start            # Build and run
npm run dev          # Watch mode with hot reload
```

## Testing

Use the existing npm scripts for all validation:

```bash
npm run test          # Vitest unit/integration suite
npm run test:coverage # Vitest with coverage output
npm run test:e2e      # Playwright end-to-end tests (runs build first)
```

Testing notes:
- Prefer `npm run test` for quick local verification during iteration.
- Use `npm run test:coverage` when changing logic and you need coverage visibility.
- Use `npm run test:e2e` for workflow/UI regressions that require full app boot.

## Code Style

- TypeScript strict mode — Phaser is the **sole renderer**
- Event-driven Phaser ↔ DOM communication via `game.events`
- Procedural assets only — no external sprite files
- All input focus transitions through `InputManager`
- DOM z-index layers: status bar (100), terminal overlay (10000), sprite card (10001)
- Phaser depth layers via `Depths.*` constants in `src/config/depths.ts` — use `ySortDepth()` for y-sorted objects
- Feature flags for optional content (top of `OfficeScene.ts`)

## Regression-Prone Pitfalls (from recent history)

- **Do not hardcode agent IDs in scene/layout/dashboard logic.** Office rosters can be dynamic; use the named constants in `src/config/agents.ts` (`ARCHITECT_AGENT_ID`, `GENERALIST_AGENT_ID`, `DEBUGGER_AGENT_ID`, `ADMIN_AGENT_ID`, `DEFAULT_PLAN_AGENT_IDS`).
- **Do not use raw layout id string-compares in new scene code.** Read `getLayout(id).behaviors.X` instead — `supportsReserveAgents`, `restrictsInteractionToArchitect`, `hasPlayerPcTerminal`, `supportsFleetExecution`. See `src/layouts/types.ts`.
- **Guard status transitions against concurrent tool events.** Route through `src/util/toolStatus.ts` — `nextSubStateAfterToolComplete` is the canonical ask_user race-guard reducer, and `addActiveTool` / `removeCompletedTool` keep the tool set idempotent (dedup + unknown-toolId no-op). Do not reimplement the branching inline.
- **All agent-status presentation is derived from one config module.** `src/config/agentStatusPresentation.ts` is the single source of truth for every status name/color/icon/animation, plus `resolveStatusKey`, `describeActivity`, `computeStall` (~60s stall), and `formatElapsedMmSs` (live mm:ss timer). Badge (`NPC.ts`), both dashboards, and notifications MUST read from it — never hardcode a per-surface status label, hex, or emoji (spec 014). The primary status label stays concise (e.g. "Thinking"); the "what it's doing" detail renders in a separate fixed-height card slot so cards never reflow. Done clears via the single `clearCompletionAck` focus path (terminal open / card select / in-world interact) and never detaches the session.
- **Preserve and restore focus around overlays/popovers.** Every DOM-modal overlay (Settings, SpriteCustomizer, NotificationSettings) MUST expose `onOpen` / `onClose` callbacks and wire them to `InputManager.suspendGameInput()` / `resumeGameInput()` via the `settings:open` / `settings:close` event bus.
- **Use the `ZIndex` registry for new overlays.** `src/config/zIndex.ts` is the single source of truth for DOM layer values. Never pick a magic number ad hoc.
- **Do not gate fleet lifecycle events on active terminal viewers.** In `electron/terminal/server.ts`, the `isFleetCriticalEvent` branch forwards `subagent.*` / `system.notification` / `tool.execution_start[task]` regardless of viewers. Don't regress this.
- **Mutate `activeAgentViewers` only via `agent-viewers.ts`.** `addAgentViewer` / `removeAgentViewer` / `hasActiveViewer` own the dual-key invariant (R-002). Direct `Set.add` / `Set.delete` is reserved for non-transfer cleanup paths (PTY exit, reset, shutdown).
- **For terminal backend/SDK changes, keep protocol + preload + server compatible in the same change.** Path resolution and PATH sanitization are required to avoid selecting broken local binaries.
- **After large UI mode/layout changes, run parity checks for split-pane behavior and dashboard card rendering.** Watch for sprite/session metadata persistence regressions across default and serious/fleet views.
- **For office persistence, go through `OfficePersistencePort`.** Don't touch `window.copilotBridge` directly from `OfficeManager` — that boundary lives in `src/office/officePersistence.ts`.
- **Use `[lifecycle]` log lines during incident triage.** Every `OfficeManager.setAgent*` mutation emits structured telemetry — `grep '[lifecycle]'` reconstructs an agent's full state graph.

## Known Limitations

### BL-004 session-detach on office switch — partial coverage
Switching offices detaches viewers from the prior office; the existing flow relies on `reconnectAgentStatuses()` in `src/main.ts` to restore event flow. There is no automated regression test that switches offices and asserts the prior session is detached (not killed) and reattaches cleanly. The Playwright `electron-smoke.e2e.ts` covers boot + create + switch but does not assert the lifecycle invariant. Deferred — needs PTY-server integration test infrastructure.

> Note: The earlier "Fleet V-Team: activeAgentViewers key mismatch" limitation has been **resolved** by the S1-D refactor. The dual-key invariant is now extracted into `electron/terminal/agent-viewers.ts` with documented `addAgentViewer` / `removeAgentViewer` / `hasActiveViewer` helpers and 9 dedicated unit tests (`tests/unit/terminal/agentViewers.test.ts`). FleetTracker's silent-attach is preserved as defense in depth.

<!-- SPECKIT START -->
For additional context about technologies to be used, project structure,
shell commands, and other important information, read the current plan
at specs/016-office-orchestrator/plan.md
<!-- SPECKIT END -->
