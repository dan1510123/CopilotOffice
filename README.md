# Copilot Office 🏢

A 2D pixel-art RPG-style game where you walk around a virtual office and interact with AI agents. Each agent runs as a real Copilot CLI session with full coding capabilities.

![Screenshot placeholder]

## Features

- **Pixel-art office environment** with procedurally generated sprites - no external image assets
- **3 unique NPC agents**, each with specialized capabilities:
  - **Gene** (Generalist) - General-purpose assistant for coding, debugging, and research
  - **Arthur** (Architect) - Orchestrates plans and spins up agents for complex tasks
  - **Alice** (Admin) - Has direct access to edit this game's UI code
- **Real terminal integration** via xterm.js - agents run actual Copilot CLI sessions
- **Mini-games** - Pong, Volleyball, and Arcade games for breaks
- **Hot reload** development mode with file watching

## Tech Stack

- **Phaser 3** - 2D game framework (browser-based)
- **Electron** - Desktop app with Node.js integration
- **TypeScript** - Type-safe development
- **esbuild** - Fast bundling for game and Electron code
- **xterm.js** - Terminal emulator for agent conversations
- **node-pty** - Pseudo-terminal for running CLI processes

## Getting Started

### Prerequisites

- Node.js 18+
- npm

### Installation

```bash
cd CopilotOffice
npm install
```

### Running the Game

```bash
# Build and run
npm start

# Development mode (with hot reload)
npm run dev
```

### Controls

| Key | Action |
|-----|--------|
| `WASD` or `Arrow Keys` | Move around the office |
| `Shift` | Sprint (2x speed) |
| `Space` | Interact with nearby agent or object |
| `Enter` | Send message in terminal |
| `Escape` | Close terminal or mini-game |

## Project Structure

```
CopilotOffice/
├── electron/               # Node.js main process
│   ├── main.ts             # Electron window, IPC handlers
│   ├── preload.ts          # Context bridge (exposes APIs to renderer)
│   ├── cli-bridge.ts       # CLI integration
│   └── events-watcher.ts   # File watcher for hot reload
├── src/
│   ├── main.ts             # Phaser game entry, config
│   ├── index.html          # HTML host page
│   ├── scenes/
│   │   ├── BootScene.ts    # Procedural sprite generation
│   │   └── OfficeScene.ts  # Main game scene (layout, NPCs, interactions)
│   ├── ui/
│   │   ├── TerminalOverlay.ts  # xterm.js terminal for agent chat
│   │   ├── DialogBox.ts        # Simple dialog interface
│   │   ├── PongGame.ts         # Pong mini-game
│   │   ├── VolleyballGame.ts   # Volleyball mini-game
│   │   └── ArcadeGame.ts       # Arcade mini-game
│   └── config/
│       └── agents.ts       # NPC definitions (skills, positions, colors)
└── dist/                   # Build output (gitignored)
```

## Adding New Agents

Edit `src/config/agents.ts` to add new NPCs:

```typescript
{
  id: 'unique-id',
  name: 'Display Name',
  skill: 'copilot-skill-name',
  sprite: 'sprite_key',
  color: 0xff0000,  // Hex color for procedural sprite
  position: { x: 5, y: 7 },  // Grid position in office
  greeting: "Hello message when player approaches",
  description: 'Short description',
  workingDir: 'optional/path',  // Optional custom working directory
}
```

Sprites are auto-generated based on the color - no image assets needed.

## Development

```bash
# Watch mode with hot reload
npm run dev

# Build only (no run)
npm run build

# Run without rebuilding
npm run electron
```

## License

ISC
