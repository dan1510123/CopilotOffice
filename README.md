# Copilot Office 🏢

A 2D pixel-art RPG-style desktop game where you walk around a virtual office and interact with AI agents. Each NPC runs a **real GitHub Copilot CLI session** with full coding capabilities — plan tasks, debug code, and orchestrate multi-agent workflows from inside a game. You can even bring an agent **online in a Microsoft Teams channel** and drive it from your phone.

![Copilot Office](https://raw.githubusercontent.com/dan1510123/CopilotOffice/main/assets/game-screenshot.png)

## Features

- **Pixel-art office environment** — every sprite is procedurally generated in code; there are no external image assets
- **Real Copilot agents** — each NPC runs an actual Copilot CLI session, rendered live in an xterm.js terminal
- **3 active NPC agents by default**, each with a distinct personality:
  - **Gene** (Generalist) — general-purpose coding, debugging, and research
  - **Dan** (Debugger) — bug investigation and root-cause analysis
  - **Alice** (Admin) — has direct access to edit this game's own source code (`workingDir: '.'`)
- **6 reserve agents** — Azure (Cloud Wizard), Val (Validator), Rex (Deployer), Doc (Code Doctor), Scout (Ranger), and Penny (Accountant) have pre-generated sprites ready to seat at an empty desk
- **Arthur (the Architect)** — hosts Meeting Mode and appears in fleet v-team offices (can be toggled into the default office in config)
- **Teams remote agents** — bring any agent online in a Microsoft Teams channel thread; anyone can reply in-thread to drive the agent's terminal session and get answers posted back (feature-flagged)
- **Office Orchestrator** — a concierge agent (its own always-gated Copilot session) that you chat with in natural language ("someone to review my code") and that proposes and, on your approval, brings the right office agent online for you; it can also list and switch between offices to find the right agent
- **Multi-office management** — switch between projects with independent agent state and working directories per office
- **Meeting Mode** — a private meeting room where Arthur decomposes a complex request into a structured, reviewable plan
- **Fleet execution** — approved plans spin up parallel agent sessions in a dedicated v-team office
- **Real-time status badges** — agent states (slacking → starting → ready ↔ waiting/thinking) with animated indicators
- **Toast & OS notifications** — configurable per-event notifications for agent activity
- **Session persistence** — offices, seated agents, and terminal sessions survive restarts
- **Player & sprite customization** — customize your character's appearance and colors
- **Mini-games** — a built-in Galaxian arcade game (Pong and Basketball are also included behind feature flags)
- **Hot reload** development mode with file watching

## Tech Stack

- **Phaser 3** — 2D game framework (the sole renderer)
- **Electron 40+** — desktop shell with a Node.js main process
- **TypeScript** — strict mode throughout
- **esbuild** — fast bundling for both the game and Electron code
- **xterm.js** — terminal emulator for agent conversations
- **node-pty** — pseudo-terminal that hosts the Copilot CLI
- **@github/copilot-sdk** — SDK control plane for the `ui-server` terminal backend
- **ws** — WebSocket transport (SDK runtime + Teams real-time receive)

### Terminal backends

The terminal server (`electron/terminal/server.ts`) selects a backend via the `COPILOT_TERMINAL_BACKEND` environment variable:

- **`node-pty`** (fallback, always available) — spawns the real Copilot TUI directly, one PTY per agent
- **`ui-server`** (default) — node-pty hosts one `copilot --ui-server` runtime per office and the Copilot SDK attaches over a local port; automatically falls back to `node-pty` when the CLI can't host `--ui-server`
- **`sdk`** (legacy) — the SDK spawns its own headless runtime over stdio

## Getting Started

### Prerequisites

To use the app **in full** you'll need:

- **Node.js 18+** and **npm**
- **GitHub Copilot access** — the agents run the real Copilot CLI, so you must be signed in to a GitHub account with an active Copilot subscription. The CLI runtime ships with the app via the `@github/copilot-sdk` platform package; on first run, authenticate through the CLI as prompted.
- **(Teams remote agents only) Azure CLI** — the Teams feature acquires Microsoft Graph and IC3 tokens via `az account get-access-token`, so you must have the [Azure CLI](https://learn.microsoft.com/cli/azure/install-azure-cli) installed and be logged in (`az login`) with an account that has access to the target Teams channel. This feature is off by default and enabled in Settings.

### Install from npm (global command)

```bash
npm i -g copilotoffice
copilotoffice
```

### Install from source (development)

```bash
git clone https://github.com/dan1510123/CopilotOffice.git
cd CopilotOffice
npm install

# Build and run
npm start

# Development mode (with hot reload)
npm run dev
```

### Controls

| Key | Action |
|-----|--------|
| `WASD` / `Arrow Keys` | Move around the office |
| `Shift` | Sprint (2x speed) |
| `E` | Interact with nearby agent or object |
| `F10` | Close terminal |
| `Escape` | Close terminal or mini-game |
| `Ctrl+Shift+N` | New terminal session (terminal focused) |

> The **🎩 Office Orchestrator** button in the top toolbar opens the orchestrator
> chat. Describe what you need in plain language and it proposes an agent to bring
> online. Bringing an agent online is **always gated** — the orchestrator runs in
> its own non-YOLO session, so it asks for your approval every time, regardless of
> the global YOLO setting. The orchestrator can also **list every office** and
> **switch offices** for you (ungated navigation) when the agent you need lives in
> a different office than the one currently on screen.
>
> **Bring the orchestrator online in Teams.** The panel's **💬 Bring online in
> Teams** button registers the orchestrator as a Microsoft Teams remote agent (like
> office agents — see below), so you can drive it by replying in its channel thread.
> The non-YOLO gate is preserved: when the remote orchestrator wants to bring an
> agent online, its approval prompt is **relayed into the thread** — reply
> `approve`/`A` or `deny`/`D` to decide. Unanswered gates auto-deny after 5 minutes.
> A remote `switch_office` also changes the on-screen desktop office.

## Project Structure

```
CopilotOffice/
├── electron/                    # Electron main process
│   ├── main.ts                  # Window, IPC handlers, hot reload
│   ├── nonTerminalIpc.ts        # Non-terminal IPC handlers
│   ├── officeFileStore.ts       # Office persistence on disk
│   ├── cli-bridge.ts            # Legacy placeholder (not used at runtime)
│   ├── terminal/                # Terminal server subsystem
│   │   ├── server.ts            # PTY/SDK owner (forked child process)
│   │   ├── terminal-backend.ts  # Backend selection (node-pty / ui-server / sdk)
│   │   ├── pty-registry.ts      # Live PTY/session bookkeeping
│   │   ├── agent-viewers.ts     # Active-viewer dual-key invariant helpers
│   │   ├── office-foreground.ts # Foreground session selection (ui-server)
│   │   ├── session-repair.ts    # Session recovery
│   │   ├── ipc-relay.ts         # IPC bridge (renderer ↔ main ↔ server)
│   │   ├── preload.ts           # Context bridge (window.copilotBridge)
│   │   ├── protocol.ts          # IPC message type definitions
│   │   ├── event-source.ts      # Backend-agnostic event source
│   │   └── events-watcher.ts    # Copilot CLI event file parser
│   └── teams/                   # Teams remote agents (main-process service)
│       ├── teamsService.ts      # Orchestrator (register/route/reply lifecycle)
│       ├── auth.ts              # Graph + IC3 tokens via `az`
│       ├── graphClient.ts       # Send channel messages
│       ├── trouterClient.ts     # Real-time receive (WebSocket)
│       ├── chatsvcClient.ts     # Poll fallback receive
│       ├── messageFilter.ts     # Dedup / marker / classify pipeline
│       ├── dispatchQueue.ts     # Per-agent FIFO dispatch
│       ├── sessionGateway.ts    # Adapter over the terminal server
│       ├── onlineAgentsStore.ts # Online-agent persistence + GC
│       └── ...                  # channelLink, marker, chunk, resolvers, IPC
├── src/                         # Renderer process (Phaser + DOM)
│   ├── main.ts                  # Entry point — DOM layout, Phaser init, IPC wiring
│   ├── index.html               # HTML host page
│   ├── scenes/                  # Phaser scenes
│   │   ├── BootScene.ts         # Procedural sprite generation
│   │   ├── OfficeScene.ts       # Main game scene (layout, NPCs, interactions)
│   │   └── MeetingScene.ts      # Meeting room with Arthur for planning
│   ├── entities/                # Game entities (Player, NPC)
│   ├── sprites/                 # Procedural sprite generation + animation
│   ├── ui/                      # DOM overlays
│   │   ├── TerminalOverlay.ts   # xterm.js terminal for agent sessions
│   │   ├── SeriousTerminalController.ts # Split-pane terminal controller
│   │   ├── FleetDashboard.ts    # Fleet execution dashboard
│   │   ├── SettingsPanel.ts     # Settings overlay
│   │   ├── TeamsSettingsOverlay.ts # Teams feature settings
│   │   ├── SpriteCustomizerPanel.ts # Player appearance customization
│   │   ├── GalaxianGame.ts      # Galaxian mini-game
│   │   ├── PongGame.ts / BasketballGame.ts # Mini-games (feature-flagged)
│   │   ├── NotificationService.ts / NotificationSettingsPanel.ts / ToastNotification.ts
│   │   └── CameraDragController.ts / DialogBox.ts
│   ├── input/                   # Keyboard focus management (InputManager + listeners)
│   ├── office/                  # Multi-office state management (officeManager.ts)
│   ├── meeting/                 # Meeting mode & fleet orchestration
│   │   ├── types.ts / planParser.ts / planApproval.ts
│   │   └── fleetOrchestrator.ts / fleetTracker.ts / fleetVisualizer.ts
│   ├── layouts/                 # Layout system
│   │   ├── types.ts / index.ts  # Layout registry + behaviors
│   │   ├── default/             # Default office layout
│   │   └── fleet/               # Fleet v-team layout
│   └── config/                  # Static configuration
│       ├── agents.ts            # Agent definitions, reserve + fleet config
│       ├── depths.ts / zIndex.ts # Phaser depth + DOM z-index constants
│       ├── notifications.ts     # Notification event settings
│       ├── meetingPrompt.ts     # Meeting coordinator prompt
│       └── playerCustomization.ts # Player color customization
└── dist/                        # Build output
```

## Adding New Agents

Edit `src/config/agents.ts` to add new NPCs. Six reserve agent slots (Azure, Val, Rex, Doc, Scout, Penny) already have pre-generated sprites — activate one by adding its config, or add a brand-new entry to the `AGENTS` array:

```typescript
{
  id: 'unique-id',
  name: 'Display Name',
  skill: 'general',
  sprite: 'sprite_key',
  color: 0xff0000,             // Hex color for the procedural sprite
  position: { x: 5, y: 7 },    // Grid position in the office (20×12 tile grid)
  greeting: "Hello message shown when the player approaches",
  description: 'Short description',
  workingDir: 'optional/path', // Optional custom working directory
}
```

Sprites are auto-generated from the color — no image assets needed.

> **Tip:** Don't hardcode agent IDs in scene/layout/dashboard logic. Use the named
> constants exported from `src/config/agents.ts` (`GENERALIST_AGENT_ID`,
> `DEBUGGER_AGENT_ID`, `ADMIN_AGENT_ID`, `ARCHITECT_AGENT_ID`, `DEFAULT_PLAN_AGENT_IDS`).

## Development

```bash
# Watch mode with hot reload
npm run dev

# Build only (no run)
npm run build

# Run without rebuilding
npm run electron
```

## Testing

```bash
npm run test          # Vitest unit/integration suite
npm run test:coverage # Vitest with coverage output
npm run test:e2e      # Playwright end-to-end tests (runs a build first)
```

## Release channels

- **Stable**: `npm i -g copilotoffice` (uses the npm `latest` dist-tag)
- **Beta**: `npm i -g copilotoffice@beta` (uses the npm `beta` dist-tag)

For maintainers: pushing to GitHub is not enough for `npm i -g copilotoffice` by name —
you must publish to npm. Typical flow:

```bash
npm run build
npm test
npm version patch
npm publish

# Beta example
npm version prerelease --preid=beta
npm publish --tag beta
```

## License

ISC
