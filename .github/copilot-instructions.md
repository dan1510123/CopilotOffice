# Copilot Office - AI Coding Instructions

## Project Overview

This is **Copilot Office**, a 2D pixel-art RPG-style game built with Phaser 3 and Electron.Players walk around a virtual office and interact with NPC agents that represent different Copilot skills. Each NPC runs a real Copilot CLI session via xterm.js.

## Tech Stack

- **Phaser 3** (`^3.90.0`) - 2D game framework, the **sole** renderer (no legacy canvas)
- **Electron** (`^40.6.1`) - Desktop app wrapper with Node.js integration
- **TypeScript** (`^5.9.3`) - All code is TypeScript (strict mode)
- **esbuild** (`^0.27.3`) - Fast bundler for both game and Electron code
- **xterm.js** (`^5.3.0`) + **xterm-addon-fit** (`^0.8.0`) - Terminal emulator for agent conversations (DOM-based)
- **node-pty** (`^1.1.0`) - Pseudo-terminal for real CLI processes (Electron main process)
- **ansi-to-html** (`^0.7.2`) - Terminal color conversion

## Architecture

```
CopilotOffice/
├── src/                        # Browser-side (renderer process)
│   ├── main.ts                 # Entry point: DOM layout + Phaser.Game init + IPC bridge wiring
│   ├── index.html              # HTML host
│   ├── scenes/
│   │   ├── BootScene.ts        # Procedural sprite generation (all assets, no external files)
│   │   └── OfficeScene.ts      # Main Phaser scene (layout, NPCs, exit system, feature flags)
│   ├── entities/
│   │   ├── Player.ts           # Player movement (WASD/arrows, shift to sprint)
│   │   └── NPC.ts              # Agent NPCs with proximity detection, status badges, pulse animations
│   ├── ui/
│   │   ├── TerminalOverlay.ts  # xterm.js terminal overlay with session persistence + detach/popout
│   │   ├── PongGame.ts         # Pong mini-game overlay (behind feature flag)
│   │   ├── BasketballGame.ts   # Basketball mini-game overlay (behind feature flag)
│   │   └── DialogBox.ts        # Legacy dialog UI (deprecated — TerminalOverlay replaced it)
│   ├── input/
│   │   ├── InputManager.ts     # Central input coordinator (focus state + transitions)
│   │   ├── GameInputListener.ts      # Phaser keyboard enable/disable
│   │   ├── GlobalInputListener.ts    # Document-level key logger (debug only)
│   │   └── TerminalInputListener.ts  # F10 + Ctrl+Shift+N intercepts
│   ├── office/
│   │   └── officeManager.ts    # Multi-office CRUD + agent status tracking (no rendering)
│   └── config/
│       └── agents.ts           # NPC definitions (skills, positions, colors)
├── electron/                   # Node.js main process
│   ├── main.ts                 # Electron window, IPC handlers, file watcher for hot reload
│   ├── cli-bridge.ts           # CLI/PTY integration (currently mock — placeholder for real CLI)
│   └── terminal/
│       ├── preload.ts          # Context bridge (exposes copilotBridge to renderer)
│       ├── events-watcher.ts   # File watcher for hot reload
│       ├── ipc-relay.ts        # IPC relay for terminal data
│       ├── server.ts           # Terminal server
│       └── protocol.ts         # Terminal protocol
├── assets/                     # Reserved for future assets (currently empty — all sprites are procedural)
├── MeetingMode.md              # Meeting Mode feature plan (active — read before working on this feature)
├── docs/                       # Documentation
│   ├── agent-statuses.md       # Agent status system documentation
│   ├── agent-lifecycle.md      # Agent lifecycle documentation
│   └── scene-physics.md        # Scene layout, physics bodies, depth sorting guide
└── dist/                       # Build output (gitignored)
```

## Key Patterns

### Split Layout (DOM + Phaser)
`src/main.ts` creates a split DOM layout:
- **Office tabs bar** (top, 72px) — horizontal tabs to switch between offices, settings gear per office, "+ New Office" button
- **Left panel** (50%) — Phaser.Game renders here (the 2D office world)
- **Right panel** (50%) — DOM-based terminal dashboard (agent overview with status) or xterm.js terminal (when interacting)
- **Status bar** (bottom, 58px) — player coordinates, current agent interaction, performance info (debounced updates)

The right panel has two modes:
1. **Overview Dashboard** (default) — shows all agents with sprite preview, name, description, status indicator, and current tool; click to open agent terminal
2. **Terminal View** (when interacting) — header with agent name + session ID, xterm.js terminal, footer with controls

Phaser communicates with the DOM via `game.events`:
- `agent:interact` — emitted by OfficeScene when player talks to an NPC
- `terminal:open` / `terminal:close` — emitted by main.ts to disable/enable player movement
- `office:switch` — emitted by main.ts when user switches office tab
- `open:agent:terminal` — emitted by main.ts to open a specific agent's terminal
- `npc:highlight` / `npc:clear-highlight` — emitted by TerminalOverlay for NPC visual feedback
- `agent:tool:start` / `agent:status:changed` — emitted by main.ts to update NPC badges
- `agent:session:closed` — emitted by TerminalOverlay when a session ends
- `agent:reattached` — emitted by TerminalOverlay when reattaching to an existing session
- `game:panel:clicked` — emitted when game panel is clicked (for focus management)

### Multi-Office
`src/office/officeManager.ts` manages multiple office instances with full CRUD:
- Each office has a config (id, name, workingDirectory, createdAt) and per-agent status tracking
- Agent status model: `state` (slacking | active) + `subState` (starting | ready | waiting | thinking) + `thinkingDetail` + `currentTool`
- Switching offices updates the DOM tabs + emits `office:switch` to Phaser
- Persisted via `localStorage` (key: `copilot-offices`)
- Callbacks: `onOfficeChanged`, `onOfficesUpdated`

### Feature Flags
`OfficeScene.ts` uses feature flag constants at the top of the file:
```ts
const ENABLE_PING_PONG = false;    // Pong mini-game (disabled)
const ENABLE_DECORATIONS = false;  // Decorative furniture (disabled)
const ENABLE_BASKETBALL = true;    // Basketball mini-game (enabled)
```

### Build System
- Game code bundles to `dist/game.bundle.js` (browser IIFE, global name `CopilotOffice`)
- Electron code bundles to `dist/electron/` (Node.js CommonJS, external packages)
- Run `npm run build` to build both, `npm start` to build and launch

### Sprite Generation
All sprites are **procedurally generated** in `BootScene.ts` using Phaser Graphics — no external image assets. The sprite pool includes:
- **Player**: Office boss in suit (32×34px)
- **4 active agent sprites**: Gene (blue), Arthur (dark), Dan (green), Alice (pink) — defined by `agents.ts`
- **6 reserve agent sprites**: Azure (cloud wizard), Validator (knight), Deployer (rocket pilot), Doctor (medic), Scout (ranger), Accountant (treasure keeper) — ready for future agents
- **Furniture**: Floor, desk, chair, computer, windows (regular + sun-lit), wall, door, welcome mat, plus 18+ decorative pieces behind `ENABLE_DECORATIONS`

### IPC Communication
- Renderer uses `window.copilotBridge` (exposed via `electron/terminal/preload.ts`)
- Main process handles IPC in `electron/main.ts`
- Terminal data flows: node-pty → IPC → xterm.js

**copilotBridge API surface**:
- Terminal: `terminalStart`, `terminalWrite`, `terminalResize`, `terminalKill`, `terminalExists`, `terminalAttach`, `terminalDetach`, `terminalPopOut`
- Sessions: `getSessionId`, `resetAllSessions`, `resetSession`, `getSessionHistory`, `clearSessionHistory`
- Status: `listActiveTerminals`, `queryAgentStatuses`
- Events: `onTerminalData`, `onTerminalExit`, `onTerminalPreloadStatus`, `onCopilotEvent`, `onCopilotToolStart`, `onCopilotToolComplete`, `onCopilotTurnStart`, `onCopilotTurnEnd`, `onCopilotUserMessage`
- Cleanup: `removeTerminalListeners`, `removeCopilotListeners`
- Reload: `requestHardReload`

### Exit System
The office has an exit door at the center bottom. The player can walk off-screen downward to "leave" the office, and re-enter by pressing Space/Enter.

## Input Handler Architecture

Keyboard input is managed by a three-tier listener system in `src/input/`, coordinated by `InputManager`. Two mutually exclusive focus states: `game` (Phaser keyboard active) and `terminal` (xterm.js active). All transitions go through `InputManager` — never enable/disable Phaser keyboard directly.

| File | Role |
|------|------|
| `InputManager.ts` | Central coordinator — owns all listeners, manages focus state, logs transitions with reasons |
| `GlobalInputListener.ts` | Document-level `keydown` listener (capture phase) — **purely observational**, never calls `preventDefault` |
| `GameInputListener.ts` | Wraps Phaser's `input.keyboard` — enables/disables keyboard + key captures (arrows, WASD, space) |
| `TerminalInputListener.ts` | Intercepts **F10** (close terminal) and **Ctrl+Shift+N** (new session). All other keys pass through to xterm |

**Key rules:** `TerminalInputListener` uses a two-phase model (F10 handler for visible lifetime, shortcut handler for focus lifetime). `OfficeScene.create()` instantiates `InputManager` and passes it to `TerminalOverlay`. All switch methods are idempotent.

## NPC Agents

Defined in `src/config/agents.ts`. Each agent has:
- `id` - Unique identifier
- `name` - Display name
- `skill` - Copilot skill name to route messages to
- `sprite` - Sprite key (generated in BootScene)
- `color` - Hex color for procedural sprite generation
- `position` - Grid position in office `{ x: col, y: row }`
- `greeting` - Message shown when player approaches
- `description` - Short description
- `workingDir` - Optional custom working directory for CLI

Current agents:
| ID | Name | Skill | Color | Position | Purpose |
|----|------|-------|-------|----------|---------|
| `generalist` | Gene | general | 0x4488cc (blue) | (3, 3) | General-purpose assistant |
| `architect` | Arthur | general | 0x1a1a2e (dark) | (4, 7) | Architect — orchestrates plans and agents |
| `debugger` | Dan | general | 0x22cc44 (green) | (9, 3) | Debugger — investigates and fixes issues |
| `admin` | Alice | general | 0xff69b4 (pink) | (15, 7) | Office Admin — edits this game's UI code directly (`workingDir: '.'`) |

### NPC Status Badge System
Each NPC displays a status badge (colored circle + text) tracking agent state:
- `slacking` (gray) — idle, no active session
- `starting` (yellow) — session starting up
- `ready` (blue) — session active, waiting for input
- `waiting` (orange) — awaiting response
- `thinking` (green, pulsing animation) — processing with optional detail text

Status is tracked per-office in `officeManager.ts` and updated via `game.events` (`agent:status:changed`, `agent:tool:start`).

## Active Feature Plans

### Meeting Mode (in progress)
See **`MeetingMode.md`** in the project root for the full implementation plan. This is the current priority feature. Key points:
- New `MeetingScene` Phaser scene — meeting room with Arthur the Architect
- Arthur plans tasks via terminal, outputs structured JSON plan with agent assignments
- After planning, player and Arthur walk back to the main office
- Assigned agents spin up parallel Copilot CLI sessions and walk to desks
- **Phases 1-3** (meeting room + planning + animations) are being implemented first; Phases 4-5 (fleet execution) follow
- Arthur's desk has been moved to `(4, 7)` (bottom-left, mirroring Alice)

When working on Meeting Mode, always read `MeetingMode.md` first to understand the current state and pick up from where the last session left off.

## Common Tasks

### Adding a New NPC
1. Add entry to `AGENTS` array in `src/config/agents.ts`
2. Define unique color, position (avoid overlapping with existing agents), and skill
3. Add a matching sprite generation block in `BootScene.ts` (follow the 8-bit hero pattern)
4. Reserve sprites already exist for: azure, validator, deployer, doctor, scout, accountant

### Adding a New Mini-Game
1. Create new class in `src/ui/` following the overlay pattern (see `PongGame.ts`)
2. Add a feature flag constant at the top of `OfficeScene.ts`
3. Add a furniture interaction point in `createOfficeLayout()` in `OfficeScene.ts`
4. Handle show/hide in the `update()` loop

### Modifying Office Layout
Edit `createOfficeLayout()` in `OfficeScene.ts`. The office uses a tile-based grid (20×12 tiles, default 64px tile size with responsive scaling). Tiles and furniture are Phaser GameObjects with depth for Z-sorting. Decorative items are behind the `ENABLE_DECORATIONS` feature flag.

### Connecting Real CLI
`electron/cli-bridge.ts` is a **mock/placeholder** and is NOT used at runtime. Terminal spawning is handled by `TerminalRelay` in `electron/terminal/ipc-relay.ts` via node-pty.

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Move player |
| Shift | Sprint (2x speed) |
| E | Interact with nearby agent or Pong table |
| Enter | Send message in terminal |
| F10 | Close active terminal / stop interaction |
| Escape | Close terminal or mini-game |
| Space / Enter | Re-enter office after exiting |
| Ctrl+Shift+N | New session (when terminal focused) |

### Controls UI Positioning

The in-game `instructionText` in `OfficeScene.ts` must stay above the SpriteCard bar when the terminal is open — position it high enough to avoid being clipped.

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Build game + electron
npm run build:game   # Build game bundle only
npm run build:electron  # Build electron code only
npm start            # Build and run
npm run dev          # Watch mode with hot reload (concurrently)
npm run electron     # Run without rebuilding
```

## Code Style

- TypeScript strict mode
- Phaser 3 scene-based architecture — **Phaser is the only renderer**
- Event-driven communication between Phaser and DOM via `game.events`
- Procedural asset generation — no external sprite files
- `src/office/officeManager.ts` is pure config/state data, never renders anything
- Feature flags for optional features (top of `OfficeScene.ts`)
- All focus/input transitions go through `InputManager` — never manipulate Phaser keyboard directly
- Always consider `z-index` when adding or moving DOM elements — the app layers multiple overlays (terminal overlay: 10000, sprite card: 10001, status bar: 100). New elements must be placed at the correct stacking level to avoid being hidden behind other layers.
- **Phaser depth layers** are defined in `src/config/depths.ts` — use `Depths.*` constants and `ySortDepth()` for y-sorted objects:

| Depth | Constant | What goes here |
|-------|----------|----------------|
| -10 | `BACKGROUND` | Floor tiles, background fill |
| 0 | `FLOOR_DETAIL` | Welcome mat, rug, floor decorations |
| 1 | `WALLS` | Wall tiles, windows, door |
| 9 | `NPC_EFFECTS` | Highlight ring, highlight glow |
| 10–50 | `ySortDepth()` | Furniture, NPCs, player (y-sorted: higher y = renders in front) |
| 55 | `NPC_LABELS` | Name labels, description labels |
| 60 | `BADGES` | NPC session badges, session text |
| 100 | `UI_OVERLAY` | Prompts, title/instruction text |
| 200 | `MINI_GAMES` | Pong, Basketball game containers |
| 1000 | `DIALOG` | Dialog box (deprecated) |
