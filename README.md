# Copilot Office 🏢

A 2D pixel-art RPG-style game where you walk around a virtual office and have conversations with different AI agents representing Copilot skills.

![Screenshot placeholder]

## Features

- **Pixel-art office environment** with desks, computers, and decorations
- **6 unique NPC agents**, each representing a different Azure skill:
  - **Azure** - Prepares apps for Azure deployment
  - **Val** - Validates deployment readiness
  - **Deploy Dan** - Deploys to Azure
  - **Dr. Debug** - Troubleshoots Azure issues
  - **Scout** - Finds Azure resources
  - **Penny** - Optimizes Azure costs
- **Real-time conversations** with agents via the dialog system
- **CLI integration** ready for connecting to actual Copilot skills

## Tech Stack

- **Phaser 3** - 2D game framework
- **Electron** - Desktop app runtime
- **TypeScript** - Type-safe development
- **esbuild** - Fast bundling

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
| `Space` | Talk to nearby agent |
| `Enter` | Send message in dialog |
| `Escape` | Close dialog |

## Project Structure

```
CopilotOffice/
├── electron/           # Electron main process
│   ├── main.ts         # App window and IPC
│   ├── preload.ts      # Renderer bridge
│   └── cli-bridge.ts   # CLI integration
├── src/
│   ├── main.ts         # Phaser game entry
│   ├── scenes/
│   │   ├── BootScene.ts    # Asset generation
│   │   └── OfficeScene.ts  # Main game scene
│   ├── entities/
│   │   ├── Player.ts       # Player character
│   │   └── NPC.ts          # Agent NPCs
│   ├── ui/
│   │   └── DialogBox.ts    # Chat interface
│   └── config/
│       └── agents.ts       # NPC definitions
└── dist/               # Build output
```

## CLI Integration

The game includes a bridge layer for connecting to the Copilot CLI. Currently using mock responses, but the `cli-bridge.ts` can be extended to spawn actual CLI processes and route messages to skills.

To enable real CLI integration:
1. Update `cli-bridge.ts` to spawn the Copilot CLI
2. Implement message routing to the appropriate skill
3. Parse and return responses

## Future Enhancements

- [ ] Real sprite animations (walking, idle)
- [ ] Sound effects and music
- [ ] Multiple office rooms/floors
- [ ] Save/load conversation history
- [ ] Custom agent configuration
- [ ] Actual CLI integration (spawn copilot subprocess)

## License

ISC
