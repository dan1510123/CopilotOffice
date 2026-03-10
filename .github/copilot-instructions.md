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
├── config/                   # Agent definitions, depth constants, notification settings
└── meeting/                  # Meeting Mode types + plan parsing
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
`officeManager.ts` manages multiple offices with per-agent status tracking. Persisted to `localStorage`. Pure data — never renders.

### Feature Flags
Top of `OfficeScene.ts`: `ENABLE_PING_PONG`, `ENABLE_DECORATIONS`, `ENABLE_BASKETBALL`.

### Procedural Sprites
All sprites generated in code (BootScene + SpriteGenerator) — no external image assets. 4-direction walk animations via DirectionalSprite.

### IPC Communication
Renderer → `window.copilotBridge` (preload context bridge) → Electron main → terminal server child process → node-pty.

### Input Focus
Two mutually exclusive states: `game` and `terminal`. All transitions through `InputManager` — never manipulate Phaser keyboard directly.

## NPC Agents

| ID | Name | Skill | Position | Purpose |
|----|------|-------|----------|---------|
| `generalist` | Gene | general | (3, 3) | General-purpose assistant |
| `architect` | Arthur | general | (4, 7) | Architect — orchestrates plans and agents |
| `debugger` | Dan | general | (9, 3) | Debugger — investigates and fixes issues |
| `admin` | Alice | general | (15, 7) | Office Admin — edits this game directly (`workingDir: '.'`) |

6 reserve agents (Azure, Validator, Deployer, Doctor, Scout, Accountant) have pre-generated sprites ready to activate. Status badges track: slacking → starting → ready ↔ waiting/thinking → slacking.

## Active Feature Plans

### Meeting Mode (in progress)
See **`MeetingMode.md`** for the full plan. Arthur plans tasks in a meeting room, outputs structured JSON with agent assignments, then agents spin up parallel CLI sessions. Always read `MeetingMode.md` before working on this feature.

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

## Code Style

- TypeScript strict mode — Phaser is the **sole renderer**
- Event-driven Phaser ↔ DOM communication via `game.events`
- Procedural assets only — no external sprite files
- All input focus transitions through `InputManager`
- DOM z-index layers: status bar (100), terminal overlay (10000), sprite card (10001)
- Phaser depth layers via `Depths.*` constants in `src/config/depths.ts` — use `ySortDepth()` for y-sorted objects
- Feature flags for optional content (top of `OfficeScene.ts`)

## Known Limitations

### Fleet V-Team: EventsWatcher key mismatch after session transfer
When Arthur's terminal is transferred from the source office to a fleet office (via `transferSession`), the server's `EventsWatcher` callback closure captures the **original** composite key (`office-0:architect`). The `copilot-event` channel (events.jsonl data) is only forwarded when `activeAgentViewers.has(ck)` — but the FleetTracker attaches with the **new** fleet office key. **Workaround:** FleetTracker attaches using the source officeId instead of the fleet officeId. This means the FleetTracker registers as a viewer on the original key, matching the closure. If this workaround is removed, `copilot-event` data (sub-agent lifecycle events) will silently stop flowing. The `copilot-tool-start`/`copilot-tool-complete` channels are **not** affected (they bypass the viewer check).
