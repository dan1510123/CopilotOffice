# Agency Office - AI Coding Instructions

## Project Overview

This is **Agency Office**, a 2D pixel-art RPG-style game built with Phaser 3 and Electron. Players walk around a virtual office and interact with NPC agents that represent different Copilot skills. Each NPC runs a real Copilot CLI session via xterm.js.

## Tech Stack

- **Phaser 3** - 2D game framework, the **sole** renderer (no legacy canvas)
- **Electron** - Desktop app wrapper with Node.js integration
- **TypeScript** - All code is TypeScript (strict mode)
- **esbuild** - Fast bundler for both game and Electron code
- **xterm.js** - Terminal emulator for agent conversations (DOM-based)
- **node-pty** - Pseudo-terminal for real CLI processes (Electron main process)

## Architecture

```
AgencyOffice/
├── src/                        # Browser-side (renderer process)
│   ├── main.ts                 # Entry point: DOM layout + Phaser.Game init + IPC bridge wiring
│   ├── index.html              # HTML host
│   ├── scenes/
│   │   ├── BootScene.ts        # Procedural sprite generation (all assets, no external files)
│   │   └── OfficeScene.ts      # Main Phaser scene (layout, NPCs, Pong mini-game)
│   ├── entities/
│   │   ├── Player.ts           # Player movement (WASD/arrows, shift to sprint)
│   │   └── NPC.ts              # Agent NPCs with proximity detection + session badge
│   ├── ui/
│   │   ├── TerminalOverlay.ts  # xterm.js terminal overlay for agent chat
│   │   ├── PongGame.ts         # Pong mini-game overlay (only mini-game)
│   │   └── DialogBox.ts        # Simple dialog UI
│   ├── input/
│   │   ├── InputManager.ts     # Central input coordinator (focus state + transitions)
│   │   ├── GameInputListener.ts      # Phaser keyboard enable/disable
│   │   ├── GlobalInputListener.ts    # Document-level key logger (debug only)
│   │   └── TerminalInputListener.ts  # F10 + Ctrl+Shift+N intercepts
│   ├── office/
│   │   └── officeManager.ts    # Multi-office config + agent status tracking (no rendering)
│   └── config/
│       └── agents.ts           # NPC definitions (skills, positions, colors)
├── electron/                   # Node.js main process
│   ├── main.ts                 # Electron window, IPC handlers
│   ├── cli-bridge.ts           # CLI/PTY integration
│   └── terminal/
│       ├── preload.ts          # Context bridge (exposes copilotBridge to renderer)
│       ├── events-watcher.ts   # File watcher for hot reload
│       ├── ipc-relay.ts        # IPC relay for terminal data
│       ├── server.ts           # Terminal server
│       └── protocol.ts         # Terminal protocol
└── dist/                       # Build output (gitignored)
```

## Key Patterns

### Split Layout (DOM + Phaser)
`src/main.ts` creates a split DOM layout:
- **Left panel**: Phaser.Game renders here (the 2D office world)
- **Right panel**: DOM-based terminal dashboard + xterm.js terminal
- **Tabs bar**: DOM tabs to switch between offices

Phaser communicates with the DOM via `game.events`:
- `agent:interact` — emitted by OfficeScene when player talks to an NPC
- `terminal:open` / `terminal:close` — emitted by main.ts to disable/enable player movement
- `office:switch` — emitted by main.ts when user switches office tab

### Multi-Office
`src/office/officeManager.ts` manages multiple office instances:
- Each office has a config (id, name, workingDirectory) and per-agent status tracking
- Switching offices updates the DOM tabs + emits `office:switch` to Phaser
- Persisted via `localStorage`

### Build System
- Game code bundles to `dist/game.bundle.js` (browser IIFE)
- Electron code bundles to `dist/electron/` (Node.js CommonJS)
- Run `npm run build` to build both, `npm start` to build and launch

### Sprite Generation
All sprites are **procedurally generated** in `BootScene.ts` using Phaser Graphics — no external image assets. Each NPC color is defined in `agents.ts`.

### IPC Communication
- Renderer uses `window.copilotBridge` (exposed via `electron/terminal/preload.ts`)
- Main process handles IPC in `electron/main.ts`
- Terminal data flows: node-pty → IPC → xterm.js

## Input Handler Architecture

Keyboard input is managed by a three-tier listener system in `src/input/`, coordinated by a central `InputManager`. This prevents conflicts between Phaser (game) and xterm.js (terminal) fighting over keyboard events.

### Files

| File | Role |
|------|------|
| `src/input/InputManager.ts` | Central coordinator — owns all listeners, manages focus state (`game` \| `terminal` \| `none`), logs all transitions with reasons |
| `src/input/GlobalInputListener.ts` | Document-level `keydown` listener (capture phase) — **purely observational**, never calls `preventDefault`. Logs all keys with modifiers for debugging |
| `src/input/GameInputListener.ts` | Wraps Phaser's `input.keyboard` — enables/disables keyboard + key captures (arrows, WASD, space). Focuses canvas when activated |
| `src/input/TerminalInputListener.ts` | Intercepts keys when terminal is visible — **F10** (close terminal, always active) and **Ctrl+Shift+N** (new session, only when focused). All other keys pass through to xterm |

### Focus Flow

```
InputManager.switchToGame(reason)
  → GameInputListener.activate()      (enable Phaser keyboard + captures)
  → TerminalInputListener.deactivateShortcuts()
  → GlobalInputListener.setMode('game')
  → canvas.focus()

InputManager.switchToTerminal(reason)
  → GameInputListener.deactivate()    (disable Phaser keyboard, clear captures)
  → TerminalInputListener.activateShortcuts()
  → GlobalInputListener.setMode('terminal')
  → xterm.focus()
```

### Wiring

1. **OfficeScene.create()** instantiates `InputManager(this)` and passes it to `TerminalOverlay`
2. **TerminalOverlay.show()** calls `inputManager.activateTerminalF10()` then `switchToTerminal()`
3. **TerminalOverlay.hide()** calls `inputManager.deactivateTerminalF10()` then `switchToGame()`
4. **OfficeScene shutdown** calls `inputManager.destroy()` to clean up all listeners

### Key Rules

- All focus transitions go through `InputManager` — never enable/disable Phaser keyboard directly
- `TerminalInputListener` uses a two-phase model: F10 handler (visible lifetime) vs shortcut handler (focus lifetime)
- `GlobalInputListener` is read-only — it exists for debugging, not control flow
- All switch methods are idempotent and safe to call repeatedly

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
| Name | Skill | Purpose |
|------|-------|---------|
| Gene | general | General-purpose assistant |
| Arthur | general | Architect — orchestrates plans and agents |
| Alice | general | Admin — edits this game's UI code directly |

## Common Tasks

### Adding a New NPC
1. Add entry to `AGENTS` array in `src/config/agents.ts`
2. Define unique color, position (avoid overlapping with existing agents), and skill
3. The sprite is auto-generated from the color in BootScene — no image needed

### Adding a New Mini-Game
1. Create new class in `src/ui/` following the overlay pattern (see `PongGame.ts`)
2. Add a feature flag constant at the top of `OfficeScene.ts`
3. Add a furniture interaction point in `createOfficeLayout()` in `OfficeScene.ts`
4. Handle show/hide in the `update()` loop

### Modifying Office Layout
Edit `createOfficeLayout()` in `OfficeScene.ts`. The office uses a tile-based grid with `this.tileSize` (default 64px). Tiles and furniture are Phaser GameObjects with depth for Z-sorting.

### Connecting Real CLI
Update `electron/cli-bridge.ts` to:
1. Spawn the actual Copilot CLI process via node-pty
2. Route messages to skills via IPC
3. Parse and return responses

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Move player |
| Shift | Sprint (2x speed) |
| E | Interact with nearby agent or Pong table |
| Enter | Send message in terminal |
| F10 | Close active terminal / stop interaction |
| Escape | Close terminal or mini-game |

## Development Commands

```bash
npm install          # Install dependencies
npm run build        # Build game + electron
npm start            # Build and run
npm run dev          # Watch mode with hot reload
npm run electron     # Run without rebuilding
```

## Code Style

- TypeScript strict mode
- Phaser 3 scene-based architecture — **Phaser is the only renderer**
- Event-driven communication between Phaser and DOM via `game.events`
- Procedural asset generation — no external sprite files
- `src/office/officeManager.ts` is pure config/state data, never renders anything
