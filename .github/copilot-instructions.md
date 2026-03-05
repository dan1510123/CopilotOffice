# Copilot Office - AI Coding Instructions

## Project Overview

This is **Copilot Office**, a 2D pixel-art RPG-style game built with Phaser 3 and Electron. Players walk around a virtual office and interact with NPC agents that represent different Azure/Copilot skills.

## Tech Stack

- **Phaser 3** - 2D game framework (browser-based)
- **Electron** - Desktop app wrapper with Node.js integration
- **TypeScript** - All code is TypeScript
- **esbuild** - Fast bundler for both game and Electron code

## Architecture

```
CopilotOffice/
├── src/                    # Browser-side Phaser game
│   ├── main.ts             # Game entry point, Phaser config
│   ├── scenes/
│   │   ├── BootScene.ts    # Procedural sprite generation
│   │   └── OfficeScene.ts  # Main game scene (layout, NPCs, interactions)
│   ├── entities/
│   │   ├── Player.ts       # Player movement (WASD/arrows, shift to sprint)
│   │   └── NPC.ts          # Agent NPCs with proximity detection
│   ├── ui/
│   │   ├── TerminalOverlay.ts  # xterm.js terminal for agent chat
│   │   ├── PongGame.ts         # Mini-game overlay
│   │   ├── VolleyballGame.ts   # Mini-game overlay
│   │   └── ArcadeGame.ts       # Mini-game overlay
│   └── config/
│       └── agents.ts       # NPC definitions (skills, positions, colors)
├── electron/               # Node.js main process
│   ├── main.ts             # Electron window, IPC handlers
│   ├── preload.ts          # Context bridge (exposes APIs to renderer)
│   ├── cli-bridge.ts       # CLI integration (mock responses currently)
│   └── events-watcher.ts   # File watcher for hot reload
└── dist/                   # Build output (gitignored)
```

## Key Patterns

### Build System
- Game code bundles to `dist/game.bundle.js` (browser IIFE)
- Electron code bundles to `dist/electron/` (Node.js CommonJS)
- Run `npm run build` to build both, `npm start` to build and launch

### Sprite Generation
All sprites are **procedurally generated** in `BootScene.ts` using Phaser graphics - there are no external image assets. Each NPC has a unique color defined in `agents.ts`.

### IPC Communication
- Renderer uses `window.electronAPI` (exposed via preload.ts)
- Main process handles IPC in `main.ts`
- CLI bridge provides skill routing (currently returns mock responses)

### Feature Flags
`OfficeScene.ts` has feature flags at the top to enable/disable mini-games and decorations:
```typescript
const ENABLE_PING_PONG = true;
const ENABLE_VOLLEYBALL = false;
const ENABLE_ARCADE = true;
```

## NPC Agents

Defined in `src/config/agents.ts`. Each agent has:
- `id` - Unique identifier
- `name` - Display name
- `skill` - Copilot skill name to route messages to
- `color` - Hex color for sprite generation
- `position` - Grid position in office
- `greeting` - Initial message when player approaches
- `workingDir` - Optional custom working directory for CLI

Current agents:
| Name | Skill | Purpose |
|------|-------|---------|
| Azure | azure-prepare | Prepares apps for Azure deployment |
| Val | azure-validate | Validates deployment readiness |
| Deploy Dan | azure-deploy | Deploys to Azure |
| Dr. Debug | azure-diagnostics | Troubleshoots Azure issues |
| Scout | azure-resource-lookup | Finds Azure resources |
| Penny | azure-cost-optimization | Optimizes Azure costs |
| Alice | general | Meta-agent that edits this game |

## Common Tasks

### Adding a New NPC
1. Add entry to `AGENTS` array in `src/config/agents.ts`
2. Define unique color, position (avoid overlapping), and skill
3. The sprite is auto-generated based on the color

### Adding a New Mini-Game
1. Create new class in `src/ui/` extending the overlay pattern (see `PongGame.ts`)
2. Add feature flag in `OfficeScene.ts`
3. Create interaction point in office layout
4. Handle show/hide in scene update loop

### Modifying Office Layout
Edit `createOfficeLayout()` in `OfficeScene.ts`. The office uses a tile-based grid system with `this.tileSize` (default 64px).

### Connecting Real CLI
Update `cli-bridge.ts` to:
1. Spawn actual Copilot CLI process
2. Route messages to skills via IPC
3. Parse and return responses

## Controls

| Key | Action |
|-----|--------|
| WASD / Arrow Keys | Move player |
| Shift | Sprint (2x speed) |
| Space | Interact with nearby NPC/object |
| Enter | Send message in terminal |
| Escape | Close terminal/mini-game |

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
- Phaser 3 scene-based architecture
- Event-driven communication between game and Electron
- Procedural asset generation over external files
