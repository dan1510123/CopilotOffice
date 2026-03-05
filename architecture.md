# Agency Office — Architecture Reference

> **Purpose**: Deep-detail documentation of every subsystem so you can understand the
> entire codebase without reading source. Written to support re-architecture decisions.

---

## Table of Contents

1. [Overview](#1-overview)
2. [Build System](#2-build-system)
3. [Electron Main Process](#3-electron-main-process)
4. [Phaser Game Engine](#4-phaser-game-engine)
5. [Player & NPC Entities](#5-player--npc-entities)
6. [UI Overlays](#6-ui-overlays)
7. [Agent Configuration](#7-agent-configuration)
8. [Data Flows](#8-data-flows)
9. [State Management](#9-state-management)
10. [Resource Management](#10-resource-management)
11. [Known Issues & Technical Debt](#11-known-issues--technical-debt)

---

## 1. Overview

Agency Office is a 2D pixel-art RPG-style desktop app where the player walks around a
virtual office and talks to NPC agents. Each NPC wraps a Copilot CLI session inside an
xterm.js terminal, so conversations are real AI interactions — not scripted dialog.

### Tech Stack

| Layer | Technology | Role |
|-------|-----------|------|
| Desktop shell | Electron 40 | Window, IPC, node-pty |
| Game engine | Phaser 3 (Arcade physics) | 2D scenes, sprites, input |
| Terminal | xterm.js 5 + FitAddon | VT100 terminal emulator |
| PTY | node-pty 1.1 | Pseudo-terminal for shell processes |
| Language | TypeScript (strict, ES2020) | All code |
| Bundler | esbuild | IIFE bundle (browser) + CJS (Node) |

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Electron Main Process                    │
│                                                                 │
│  ┌──────────┐  ┌──────────────┐  ┌────────────┐  ┌──────────┐  │
│  │ node-pty  │  │ EventsWatcher│  │  Session    │  │ esbuild  │  │
│  │ (per agent│  │ (per agent)  │  │  Persistence│  │ watcher  │  │
│  │  shell +  │  │ events.jsonl │  │  (JSON file)│  │ (rebuild)│  │
│  │  copilot) │  │ fs.watch +   │  │             │  │          │  │
│  │           │  │ 500ms poll   │  │             │  │          │  │
│  └─────┬─────┘  └──────┬───────┘  └──────┬──────┘  └────┬─────┘  │
│        │               │                 │               │        │
│        └───────┬───────┴────────┬────────┘               │        │
│                │   IPC Bridge   │                         │        │
│                │  (ipcMain ↔    │                         │        │
│                │   ipcRenderer) │                         │        │
├────────────────┼────────────────┼─────────────────────────┼────────┤
│                │  Preload       │                         │        │
│                │  (contextBridge│                         │        │
│                │   copilotBridge│                         │        │
│                │   API)         │                         │        │
├────────────────┼────────────────┼─────────────────────────┼────────┤
│                │                │     Renderer Process     │        │
│                ▼                ▼                          ▼        │
│  ┌─────────────────────────────────────────────────────────────┐  │
│  │                    src/index.html                            │  │
│  │  ┌────────────────────┐  ┌────────────────────────────────┐ │  │
│  │  │   Phaser 3 Game    │  │    Legacy Canvas System        │ │  │
│  │  │  BootScene →       │  │  officeManager, gameLoop,      │ │  │
│  │  │  OfficeScene       │  │  renderer, officeState         │ │  │
│  │  │  (Player, NPCs,    │  │  (multi-office, tabs,          │ │  │
│  │  │   mini-games)      │  │   terminal panel)              │ │  │
│  │  └────────┬───────────┘  └──────────────┬─────────────────┘ │  │
│  │           │                             │                    │  │
│  │           ▼                             ▼                    │  │
│  │  ┌────────────────────────────────────────────────────────┐  │  │
│  │  │              UI Overlays (DOM-based)                    │  │  │
│  │  │  TerminalOverlay (xterm.js) | PongGame | ArcadeGame    │  │  │
│  │  │  VolleyballGame             | DialogBox (unused)       │  │  │
│  │  └────────────────────────────────────────────────────────┘  │  │
│  └─────────────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────────┘
```

### Directory Structure

```
AgencyOffice/
├── electron/                    # Node.js main process
│   ├── main.ts                  # Window, IPC handlers, PTY management
│   ├── preload.ts               # Context bridge (copilotBridge API)
│   ├── cli-bridge.ts            # CLI routing (currently unused)
│   └── events-watcher.ts        # Monitors copilot events.jsonl
├── src/                         # Renderer process (browser)
│   ├── index.html               # Single-page shell
│   ├── main.ts                  # Entry point: legacy canvas system + DOM setup
│   ├── config/
│   │   └── agents.ts            # NPC agent definitions
│   ├── scenes/
│   │   ├── BootScene.ts         # Procedural sprite generation
│   │   └── OfficeScene.ts       # Main game scene (Phaser)
│   ├── entities/
│   │   ├── Player.ts            # Player movement & controls
│   │   └── NPC.ts               # Agent NPCs with indicators
│   ├── ui/
│   │   ├── TerminalOverlay.ts   # xterm.js terminal modal
│   │   ├── PongGame.ts          # Ping pong mini-game
│   │   ├── VolleyballGame.ts    # Volleyball mini-game (disabled)
│   │   ├── ArcadeGame.ts        # Asteroids mini-game
│   │   └── DialogBox.ts         # Legacy dialog system (unused)
│   └── office/                  # Legacy canvas-based office system
│       ├── officeManager.ts     # Multi-office management
│       ├── constants.ts         # Tile sizes, zoom, animation params
│       ├── types.ts             # TileType, Character, Seat, Layout
│       ├── engine/
│       │   ├── gameLoop.ts      # RAF loop with delta capping
│       │   ├── officeState.ts   # Character spawn, pathfinding, state
│       │   └── renderer.ts      # Canvas tile/furniture/character renderer
│       ├── layout/
│       │   ├── officeLayouts.ts # Default/small/open-plan layouts
│       │   ├── furnitureCatalog.ts  # Furniture sprite definitions
│       │   └── themes.ts        # Color theme presets
│       └── sprites/
│           ├── spriteCache.ts   # Sprite caching
│           └── spriteData.ts    # 16×16 pixel sprite definitions
├── dist/                        # Build output (gitignored)
├── copilot-office-sessions.json # Persistent session GUIDs
├── package.json
└── tsconfig.json
```

### Two Parallel Systems

The codebase contains **two rendering systems** that coexist:

1. **Legacy canvas system** (`src/office/`, `src/main.ts`) — The **currently active** system.
   Canvas-based office visualization with multi-office tabs, character pathfinding, a split
   terminal panel, and xterm.js integration. This is what actually runs when you launch the app.

2. **Phaser 3 system** (`src/scenes/`, `src/entities/`) — An RPG-style game with player
   movement, NPC interactions, mini-games, and a terminal overlay. **Not currently functional**
   because Phaser is not installed as a dependency. The code exists but cannot be bundled.

Both systems share the same `agents.ts` configuration and `copilotBridge` IPC layer.

---

## 2. Build System

### esbuild Configuration

Two separate bundles, no shared config file — scripts defined directly in `package.json`:

**Game bundle** (browser):
```
esbuild src/main.ts
  --bundle
  --outfile=dist/game.bundle.js
  --platform=browser
  --format=iife
  --global-name=AgencyOffice
```
- IIFE format exposes `window.AgencyOffice` global
- Browser platform — no Node.js APIs available
- Single output file loaded by `src/index.html`

**Electron bundle** (Node.js):
```
esbuild electron/main.ts electron/preload.ts electron/cli-bridge.ts electron/events-watcher.ts
  --bundle
  --outdir=dist/electron
  --platform=node
  --format=cjs
  --packages=external
```
- CommonJS format for Electron's main process
- `--packages=external` prevents bundling `node_modules` (Electron, node-pty, etc.)
- Multiple entry points → separate output files in `dist/electron/`

### npm Scripts

| Script | Command | Purpose |
|--------|---------|---------|
| `build:game` | esbuild → `dist/game.bundle.js` | Bundle browser code |
| `build:electron` | esbuild → `dist/electron/` | Bundle Node.js code |
| `build` | `build:game && build:electron` | Build everything |
| `start` | `build && electron .` | Build + launch app |
| `dev` | concurrently: game watch + electron watch + electron . | Live-reload dev mode |
| `electron` | `electron .` | Launch without rebuild |

### TypeScript Configuration

```json
{
  "target": "ES2020",
  "module": "commonjs",
  "lib": ["ES2020", "DOM"],
  "strict": true,
  "esModuleInterop": true,
  "resolveJsonModule": true,
  "declaration": true,
  "declarationMap": true,
  "sourceMap": true
}
```

Includes `src/**/*` and `electron/**/*`. TypeScript is used for type checking only — esbuild
handles the actual compilation (it ignores `tsconfig.json` output settings).

### Dependencies

| Package | Version | Purpose |
|---------|---------|---------|
| electron | ^40.6.1 | Desktop window + Node.js integration |
| node-pty | ^1.1.0 | Native PTY for shell processes |
| xterm | ^5.3.0 | Terminal emulator (browser) |
| xterm-addon-fit | ^0.8.0 | Auto-size terminal to container |
| ansi-to-html | ^0.7.2 | ANSI escape → HTML (currently unused) |
| esbuild | ^0.27.3 | Bundler |
| concurrently | ^9.2.1 | Parallel script runner for dev mode |
| typescript | ^5.9.3 | Type checking |

> **Note**: Phaser 3 is imported (`import Phaser from 'phaser'`) in 9 source files under
> `src/scenes/`, `src/entities/`, and `src/ui/`, but **phaser is not listed in
> `package.json` and is not installed in `node_modules`**. The Phaser scene files
> (`BootScene.ts`, `OfficeScene.ts`, `Player.ts`, `NPC.ts`, mini-games) will fail to
> bundle. The actively running system is the legacy canvas-based renderer in `src/main.ts`
> + `src/office/`. The Phaser code appears to be a parallel implementation that was started
> but is not currently connected to the build.

---

## 3. Electron Main Process

### File: `electron/main.ts`

#### Window Lifecycle

```
app.whenReady()
  ├─ loadSessionIds()           — Read copilot-office-sessions.json
  ├─ require('node-pty')        — Dynamic import (native module)
  ├─ startFileWatcher()         — Spawn esbuild --watch for auto-rebuild
  └─ createWindow()
       ├─ BrowserWindow(2560×1440, maximized)
       │    webPreferences:
       │      preload: dist/electron/preload.js
       │      contextIsolation: true
       │      nodeIntegration: false
       ├─ loadFile(src/index.html)
       ├─ on('did-start-navigation') → killAllPtyProcesses() on reload
       └─ on('closed') → killAllPtyProcesses() + kill watcher

app.on('window-all-closed')   → killAllPtyProcesses(), quit (non-macOS)
app.on('will-quit')           → killAllPtyProcesses() (final cleanup)
app.on('activate')            → recreate window if none exist (macOS)
```

#### IPC Handler Catalog

All handlers use `ipcMain.handle()` (invoke/return pattern):

| Channel | Parameters | Returns | Purpose |
|---------|-----------|---------|---------|
| `terminal-start` | `agentId, workingDir?` | `{success, pid?, sessionId?, reused?, error?}` | Spawn PTY + start copilot CLI |
| `terminal-write` | `agentId, data` | `{success, error?}` | Write data to PTY stdin |
| `terminal-resize` | `agentId, cols, rows` | `{success, error?}` | Resize PTY dimensions |
| `terminal-kill` | `agentId` | `{success, error?}` | Kill PTY process |
| `terminal-exists` | `agentId` | `boolean` | Check if agent has active PTY |
| `terminal-attach` | `agentId` | `{success}` | Start forwarding PTY data to renderer |
| `terminal-detach` | `agentId` | `{success}` | Stop forwarding PTY data |
| `terminal-pop-out` | `agentId` | `{success, error?}` | Open session in Windows Terminal |
| `save-session-id` | `agentId, sessionId` | `{success}` | Persist session GUID to disk |
| `get-session-id` | `agentId` | `string \| null` | Retrieve saved session GUID |

One-way events sent from main → renderer via `webContents.send()`:

| Channel | Payload | Purpose |
|---------|---------|---------|
| `terminal-data` | `agentId, data` | Batched PTY output (60fps) |
| `terminal-exit` | `agentId, exitCode` | PTY process exited |
| `terminal-preload-status` | `agentId, status` | Preload progress |
| `copilot-event` | `agentId, CopilotEvent` | Raw copilot event |
| `copilot-tool-start` | `agentId, toolName, toolId, status` | Tool execution began |
| `copilot-tool-complete` | `agentId, toolId, success` | Tool execution finished |
| `copilot-turn-end` | `agentId` | Copilot turn completed |
| `copilot-user-message` | `agentId` | User message detected |
| `build-complete` | *(none)* | esbuild rebuild finished |

#### PTY Process Management

**Spawning** (`startTerminalForAgent`):

1. Check for existing terminal via `agentToTerminal` map → reuse if found
2. Get or generate persistent session GUID (saved to disk)
3. Spawn PTY: `pty.spawn(powershell.exe | bash, [])`
   - Terminal type: `xterm-256color`
   - Initial size: 120 cols × 30 rows
   - Working directory: `process.cwd()` or custom `workingDir` joined to cwd
   - Environment: inherits `process.env` + `AGENCY_OFFICE_PROCESS=true` + `AGENCY_OFFICE_AGENT={agentId}`
4. Create `EventsWatcher` for the session
5. Register data handler with batching
6. After 500ms delay: write `copilot --resume {sessionId}\r` to PTY

**Data Batching**:

```
PTY output → proc.onData(data)
  ├─ if !activeAgentViewers.has(agentId) → discard (early return)
  ├─ pendingData += data
  └─ if no flushTimer → setTimeout(flushData, 16ms)   ← ~60fps

flushData():
  ├─ if pendingData && viewer active → webContents.send('terminal-data', agentId, pendingData)
  └─ pendingData = ''
```

This prevents IPC flooding when PTY produces high-volume output.

**Cleanup** (`killAllPtyProcesses`):

```
for each proc in ptyProcesses:
  proc.process.kill()
ptyProcesses.clear()
agentToTerminal.clear()

for each watcher in agentWatchers:
  watcher.stop()
agentWatchers.clear()
```

Triggered on: page reload, window close, app quit.

**Pop-Out** (`terminal-pop-out`):

Spawns `wt -d {cwd} copilot --resume {sessionId}` as a detached process, allowing the user
to continue the same copilot session in Windows Terminal.

**Session Pool** (vestigial):

A `startNewPooledSession()` function exists that spawns a `__pool__` PTY running
`copilot` (without `--resume`). The pool PTY discards all data. This appears unused —
`PRELOAD_AGENTS` is empty and the pool is never assigned to an agent.

#### In-Memory Collections

| Collection | Type | Contents |
|-----------|------|----------|
| `ptyProcesses` | `Map<string, PtyProcess>` | Active PTY processes keyed by terminal ID |
| `agentToTerminal` | `Map<string, string>` | Agent ID → terminal key mapping |
| `activeAgentViewers` | `Set<string>` | Agents whose data should be forwarded to renderer |
| `agentWatchers` | `Map<string, EventsWatcher>` | File watchers per agent |
| `agentSessionIds` | `Map<string, string>` | Agent ID → session GUID (also persisted to disk) |

### File: `electron/events-watcher.ts`

Monitors copilot's real-time event log at:
```
~/.copilot/session-state/{sessionId}/events.jsonl
```

**Lifecycle**:
1. `start(callback)` → check if `events.jsonl` exists
2. If not: poll every **200ms** until it appears
3. Once found: `startWatching()`
   - Read existing content (catch up)
   - Primary: `fs.watch()` on file changes
   - Fallback: poll every **500ms** (redundant reads are no-ops via offset tracking)
4. On new data: read from last offset, split lines, parse JSON, emit `CopilotEvent`
5. `stop()` → clear all timers, close watcher, null callback

**Event Types Recognized**:
- `tool.execution_start` → forwarded as `copilot-tool-start`
- `tool.execution_complete` → forwarded as `copilot-tool-complete`
- `assistant.turn_end` → forwarded as `copilot-turn-end`
- `user.message` → forwarded as `copilot-user-message`

**Tool Status Formatting** (`formatToolStatus`):
Converts tool names + args into human-readable strings:
- `view` → "Reading {filename}"
- `edit` → "Editing {filename}"
- `powershell` → "Running: {command (40 chars)}"
- `glob` → "Finding files: {pattern}"
- `grep` → "Searching: {pattern}"
- `task` → "Subtask: {description}"
- `ask_user` → "Waiting for your answer"

### File: `electron/preload.ts`

Context bridge exposing `window.copilotBridge` to the renderer:

**Invoke methods** (async, request/response):
- `terminalStart(agentId, workingDir?)` → `terminal-start`
- `terminalWrite(agentId, data)` → `terminal-write`
- `terminalResize(agentId, cols, rows)` → `terminal-resize`
- `terminalKill(agentId)` → `terminal-kill`
- `terminalExists(agentId)` → `terminal-exists`
- `terminalAttach(agentId)` → `terminal-attach`
- `terminalDetach(agentId)` → `terminal-detach`
- `terminalPopOut(agentId)` → `terminal-pop-out`
- `saveSessionId(agentId, sessionId)` → `save-session-id`
- `getSessionId(agentId)` → `get-session-id`

**Event listeners** (one-way, main → renderer):
- `onTerminalData(callback)` — PTY output
- `onTerminalExit(callback)` — PTY process exit
- `onTerminalPreloadStatus(callback)` — Preload status updates
- `onCopilotEvent(callback)` — Raw copilot events
- `onCopilotToolStart(callback)` — Tool started
- `onCopilotToolComplete(callback)` — Tool completed
- `onCopilotTurnEnd(callback)` — Turn completed
- `onCopilotUserMessage(callback)` — User message sent

**Cleanup methods**:
- `removeTerminalListeners()` — removes `terminal-data`, `terminal-exit` listeners
- `removeCopilotListeners()` — removes all `copilot-*` listeners

### File: `electron/cli-bridge.ts`

Skill routing layer. Currently unused — all communication goes through PTY directly.
Originally designed to route messages to specific copilot skills (azure-prepare,
azure-validate, etc.) but bypassed in favor of direct `copilot --resume` PTY sessions.

---

## 4. Phaser Game Engine

### Initialization

The Phaser game is created in `OfficeScene` (or via the scene system). The game config
specifies Arcade physics, transparent background, and two scenes: `BootScene` → `OfficeScene`.

### BootScene (`src/scenes/BootScene.ts`)

**Purpose**: Generate all sprite textures procedurally and transition to the main scene.

**Loading UI**:
- Progress bar: 320×50px centered, `#00ff88` fill on `#222222` background
- Loading text: 20px monospace, white
- Destroyed on load complete

**Generated Textures** (all programmatic — no external image files):

| Texture Key | Size | Description |
|-------------|------|-------------|
| `player` | 32×34 | Office boss: dark hair, skin-tone face, navy suit (#1a2a4a), red tie, white collar |
| `npc_generalist` | 32×32 | Blue-robed character (#4488cc) |
| `npc_architect` | 32×32 | Dark blue-black character (#1a1a2e) |
| `npc_admin` | 32×32 | Hot pink character (#ff69b4), recursive symbol |
| `npc_azure` | 32×32 | Cloud Wizard — blue robes (#0078d4), staff |
| `npc_validator` | 32×32 | Knight — green armor (#008833), helmet, shield |
| `npc_deployer` | 32×32 | Rocket pilot — orange suit (#ff6600), goggles |
| `npc_doctor` | 32×32 | Medic — white coat, red stethoscope |
| `npc_scout` | 32×32 | Ranger — purple cloak (#6622aa), binoculars |
| `npc_accountant` | 32×32 | Treasure keeper — green vest, gold coins (#ffcc00) |
| `floor` | 32×32 | Light blue-gray carpet (#8899aa), checkerboard |
| `wall` | 32×32 | Light gray-blue (#c8d4e0), brown baseboard |
| `desk` | 32×32 | Wooden desk (#5c4033), handles (#ccaa66) |
| `chair` | 32×32 | Office chair — black seat, blue cushion |
| `computer` | 32×24 | Monitor — dark frame, blue screen, green code lines |
| `indicator` | 32×28 | Yellow speech bubble with "E" key prompt |
| `plant` | 32×32 | Potted plant — green leaves, brown pot |
| `cooler` | 32×32 | Water cooler — blue jug, white dispenser |
| `coffee` | 32×32 | Coffee machine |
| `bookshelf` | 32×32 | Bookshelf with colored spines |
| `cabinet` | 32×32 | Filing cabinet |
| `whiteboard` | 32×32 | Whiteboard |
| `clock` | 32×32 | Wall clock |
| `couch` | 32×32 | Office couch |
| `trash` | 32×32 | Trash can |
| `poster` | 32×32 | Wall poster |
| `pingpong` | 64×64 | Ping pong table with 2 players |
| `volleyball` | 32×32 | Volleyball court marker |
| `arcade` | 32×32 | Arcade cabinet |
| `mcdonalds` | 32×32 | McDonald's stand |

After all textures are generated, transitions to `OfficeScene`.

### OfficeScene (`src/scenes/OfficeScene.ts`)

**Feature Flags** (top of file):

```typescript
const ENABLE_PING_PONG    = true;
const ENABLE_VOLLEYBALL   = false;
const ENABLE_DECORATIONS  = true;
const ENABLE_MCDONALDS    = false;
const ENABLE_ARCADE       = true;
```

**World Setup**:
- Map: **27 tiles wide × 16 tiles tall**
- Tile size: `Math.max(48, Math.floor(Math.min(screenWidth/27, screenHeight/16)))` — default **64px**
- Sprite scale: `tileSize / 32` (≈ 2.0 for 64px tiles)
- Physics bounds: `(tileSize, 2×tileSize, 25×tileSize, 14×tileSize)`
- Camera: centered on room, no follow (room fits screen)

**create() sequence**:
1. Calculate tile size and sprite scale from screen dimensions
2. Set world and camera bounds
3. `createOfficeLayout()` — floor, windows, furniture, game stations
4. Create `Player` at center-bottom: `(mapWidth × tileSize / 2, (mapHeight - 3) × tileSize)`
5. Scale player, set depth to **50**, configure hitbox
6. `createNPCs()` — one NPC per agent in `AGENTS` config
7. Instantiate overlays: `TerminalOverlay`, `PongGame`, `VolleyballGame`, `ArcadeGame`
8. Create hidden prompt texts for game interactions
9. `preStartAgentSessions()` — background-start the admin agent
10. Register **E key** for interactions
11. Add player-wall collider
12. Display title ("🏢 AGENCY OFFICE") and control instructions

**Office Layout** (`createOfficeLayout`):

| Layer | Content | Collision |
|-------|---------|-----------|
| Floor tiles | Blue-gray carpet covering entire map | No |
| Windows | North/east/west walls (alternating window types) | No |
| Corner pieces | Decorative wall corners | No |
| Agent desks | Per AGENTS: desk + computer above | No |
| Boss desk | 3-tile-wide desk at center-bottom + computer + chair, labeled "YOU" | No |
| Carpet | 8×4 tile brown rectangle (#4a3728, 60% opacity), depth -1 | No |
| Decorations | Plants, water cooler, coffee machine, bookshelves, filing cabinets, whiteboard, clocks, couch, trash, posters | No |
| Ping pong table | Left-center area | No |
| Arcade machine | Right-center area | No |
| Volleyball court | Right-center (disabled) | No |
| McDonald's stand | Right side (disabled) | No |

**Update Loop** (runs every frame):

```
update()
  ├─ Skip if any mini-game is visible
  ├─ player.update()                         — Process movement input
  ├─ updateNearestInteractable()             — Find closest NPC/desk
  ├─ updatePingPongProximity()               — Show/hide ping pong prompt
  ├─ updateVolleyballProximity()             — Show/hide volleyball prompt
  ├─ updateMcdonaldsProximity()              — Show/hide nuggets prompt
  ├─ updateArcadeProximity()                 — Show/hide arcade prompt
  └─ if E key just pressed && terminal not visible:
       Priority: McDonald's → Arcade → Ping Pong → Volleyball → NPC/Desk
       └─ startConversation(agent) or startMiniGame()
```

**Interaction Distance**: `2 × tileSize` (128px for default 64px tiles)

**startConversation(agent)**:
1. `player.disableMovement()`
2. `terminalOverlay.show(agent, onClose)`
3. On close callback: `player.enableMovement()`, `updateSessionBadges()`

**Session Preloading** (`preStartAgentSessions`):
- Only pre-starts the **admin** agent (Alice — can edit game code)
- Checks for saved session ID first
- Calls `terminalStart('admin', workingDir)` before scene finishes loading
- Other agents start on-demand when the player presses E

---

## 5. Player & NPC Entities

### Player (`src/entities/Player.ts`)

**Class**: `Phaser.Physics.Arcade.Sprite`

**Movement**:

| Property | Value |
|----------|-------|
| Base speed | 300 px/s |
| Sprint multiplier | 2× (600 px/s) |
| Sprint key | Shift |
| Hitbox | 24×24px, offset (4, 8) |
| Diagonal normalization | Yes — consistent speed at all angles |

**Controls**:
- Arrow keys (up/down/left/right)
- WASD keys
- Shift for sprint
- Velocity set to 0 when movement disabled

**Movement Logic**:
```
speed = shiftKey.isDown ? 300 × 2 : 300
accumulate directional inputs (opposite keys cancel)
if diagonal: normalize velocity, scale to speed
body.setVelocity(vx × speed, vy × speed)
```

**Lifecycle Methods**:
- `enableMovement()` — re-enable input processing
- `disableMovement()` — set velocity to 0, ignore input
- Hitbox scales proportionally with sprite scale

### NPC (`src/entities/NPC.ts`)

**Class**: `Phaser.Physics.Arcade.Sprite` (static body — NPCs don't move)

**Positioning**: `(config.position.x × tileSize + tileSize/2, config.position.y × tileSize + tileSize/2)`

**Visual Elements**:

| Element | Details |
|---------|---------|
| **Sprite** | Agent-specific texture from BootScene, scaled to `tileSize/32` |
| **Hitbox** | 28×28px, offset (2, 4) |
| **Name label** | Bold monospace, white on `#000000cc` background, positioned -28×scale above NPC. Supports multi-line (splits on `" ("`) |
| **Indicator** | Yellow "E" speech bubble, positioned -48×scale above. Pulsing animation: 500ms duration, 12px Y range, yoyo loop. Hidden by default |
| **Session badge** | Green circle: `#00cc44` fill, `#00ff66` stroke. Positioned 16×scale right, -24×scale above. Radius: 8×scale. Shown when agent has active session |
| **Message count** | Text inside session badge, `Math.max(10, tileSize/6)` font size. Shown if count > 0 |

**Depth**: 50+ (always rendered above floor/furniture)

**Methods**:
- `setNearPlayer(near: boolean)` — show/hide interaction indicator
- `getNearPlayer()` → boolean — query proximity state
- `setHasActiveSession(hasSession, messageCount?)` — update badge visibility and count

---

## 6. UI Overlays

### TerminalOverlay (`src/ui/TerminalOverlay.ts`)

The primary interaction interface. Wraps xterm.js in a fixed-position modal overlay.

**DOM Structure**:
```
#terminal-overlay (fixed, 80% width/height, z-index 10000, border: 2px #3a5a8a)
├── header (#1a1a2e background)
│   ├── Agent name + description
│   ├── "🎭 INCEPTION MODE" badge (admin agent only)
│   └── Close button (×)
├── #terminal-container (flex: 1)
│   └── xterm.js Terminal instance
└── footer
    ├── Agent sprite canvas (32×34 → scaled to 160×170px, pixelated rendering)
    ├── Agent name
    ├── Session ID display (click to copy)
    └── "New Session" button
```

**xterm.js Configuration**:

| Setting | Value |
|---------|-------|
| Background | `#0a0a14` |
| Foreground | `#e0e0e0` |
| Cursor color | `#00ff88` (green) |
| Cursor style | Block, blinking |
| Selection | `#3a5a8a` |
| Font | Cascadia Code, 24px, line height 1.2 |
| Scrollback | 10,000 lines |
| Theme | Dracula-inspired (16 ANSI colors) |

**Lifecycle**:

```
show(agent, onClose)
  ├─ Set currentAgentId, currentAgent
  ├─ Create container (if first show)
  ├─ Update header, footer, agent sprite
  ├─ Create or clear xterm Terminal
  ├─ Check: terminalExists(agentId)?
  │   ├─ No  → startNewSession(agentId, workingDir)
  │   └─ Yes → getSessionId() for display
  ├─ Register IPC listeners (setupTerminalListeners)
  ├─ Fit terminal (3 passes: 50ms, 150ms, 300ms)
  ├─ Focus terminal (200ms delay)
  ├─ Disable Phaser keyboard input
  └─ Setup keyboard handler (capture phase)

hide()
  ├─ container.style.display = 'none'
  ├─ Set isVisible = false
  ├─ Re-enable Phaser keyboard
  ├─ Remove F10 keyboard handler
  ├─ *** KEEP PTY ALIVE IN BACKGROUND ***
  └─ Call onCloseCallback()

destroy()
  ├─ terminal.dispose()
  ├─ container.remove() from DOM
  ├─ copilotBridge.removeTerminalListeners()
  └─ copilotBridge.removeCopilotListeners()
```

**Keyboard Handling** (registered on `document`, capture phase):

| Key | Action |
|-----|--------|
| F10 | Close overlay |
| Ctrl+Shift+N | Kill terminal + start new session |
| Space, Enter, Backspace, Tab | Direct PTY passthrough |
| Arrow keys | ANSI escape: `\x1b[A` (up), `\x1b[B` (down), `\x1b[C` (right), `\x1b[D` (left) |
| Ctrl+C | Send `\x03` (SIGINT) |
| Ctrl+D | Send `\x04` (EOF) |
| Ctrl+L | Send `\x0c` (clear) |
| Printable chars | Forwarded directly to PTY |

**Session ID Parsing**:

The overlay watches PTY output for UUID patterns and extracts session IDs:
1. `session-state/{UUID}` path pattern
2. `session-state/{20+ hex chars}` pattern
3. `Session: {UUID}` format
4. Standalone UUID on a line

When found, saved via `copilotBridge.saveSessionId(agentId, sessionId)`.

**Resize Handling**:
- On show: FitAddon.fit() called 3 times (50ms, 150ms, 300ms delays)
- On window resize: refit if visible
- Dimensions sent to main process via `terminalResize(cols, rows)`

### PongGame (`src/ui/PongGame.ts`)

Ping pong mini-game rendered entirely with Phaser primitives.

**Overlay Pattern**: `Phaser.GameObjects.Container` at depth 200. Dark background overlay
(0x000000, 0.8 alpha). Full-screen blocking.

**Dimensions**: 600×400px game area (scales down to fit screen)

**Physics** (frame-based, not Arcade physics):

| Constant | Value |
|----------|-------|
| Paddle speed | 8 px/frame |
| Ball speed | 5 px/frame |
| Speed-up on hit | ×1.1 |
| Max ball speed | 12 px/frame |
| AI base speed | 3 px/frame |
| AI speed-up per point | ×1.05 |
| AI reaction threshold | 20px distance from ball |

**Layout**:
- Table: 0x1560bd blue, white border
- Player paddle (left): green, 10×80px
- AI paddle (right): red, 10×80px
- Ball: white, 12×12px
- Dashed center net (aesthetic)
- Score: 48px bold text, top center
- Title: "🏓 PING PONG"

**Controls**: W/S or ↑/↓ move paddle, SPACE launches ball, ESC exits.

**AI**: Tracks ball Y position, reacts if ball >20px away. Intentionally imperfect.

### VolleyballGame (`src/ui/VolleyballGame.ts`)

**Status**: Disabled (`ENABLE_VOLLEYBALL = false`)

Side-view volleyball with jumping, gravity, and spike mechanics.

**Overlay Pattern**: Same as Pong — Phaser Container, depth 200.

**Dimensions**: 700×450px

**Physics**:

| Constant | Value |
|----------|-------|
| Player gravity | 0.25 px/frame² |
| Ball gravity | 0.12 px/frame² (floaty) |
| Jump force | -11 px/frame |
| Move speed | 6 px/frame |
| Ball bounce factor | 0.85 |
| Base hit force | 4 px/frame |
| Spike force | 7 px/frame |
| Speed multiplier | Increases with score |

**Layout**: Sky (0x87ceeb), sand court (0xf4d03f), center net (100px tall).
Players have head + articulated arms that swing on spike.

**Controls**: A/D or ←/→ move, W or ↑ jump, SPACE spike, ESC exit.

### ArcadeGame (`src/ui/ArcadeGame.ts`)

Asteroids clone rendered with `Phaser.GameObjects.Graphics`.

**Overlay Pattern**: Phaser Container with Graphics canvas. Includes decorative arcade
cabinet bezel, marquee (0xcc2222), and control panel.

**Dimensions**: 400×300px game area

**Physics**:

| Constant | Value |
|----------|-------|
| Ship rotation | 0.08 rad/frame |
| Ship thrust | 0.12 px/frame² |
| Friction | 0.99 (×0.99 per frame) |
| Bullet speed | 6 px/frame |
| Bullet lifetime | 50 frames |
| Max bullets | 5 simultaneous |
| Invincibility | 2000ms on spawn |

**Asteroid Generation**:
- Large: 25px radius, 20 points
- Medium: 15px radius, 50 points
- Small: 8px radius, 100 points
- 7–10 irregular vertices per asteroid, rotation ±0.03 rad/frame
- Speed: `1 + level × 0.2`
- Level N+1 spawns `3 + N` asteroids

**Controls**: ←/→ rotate, ↑ thrust, SPACE shoot, ENTER start, ESC exit.
3 lives, progressive difficulty.

### DialogBox (`src/ui/DialogBox.ts`)

**Status**: Legacy, unused. Not imported anywhere in the current codebase.
Was the old Phaser-based dialog system for NPC conversations before xterm.js
terminal overlay replaced it.

---

## 7. Agent Configuration

### Data Structure (`src/config/agents.ts`)

```typescript
interface AgentConfig {
  id: string;           // Unique identifier ('generalist', 'architect', 'admin')
  name: string;         // Display name ('Gene', 'Arthur', 'Alice')
  skill: string;        // Copilot skill for routing ('general')
  sprite: string;       // Texture key from BootScene ('npc_generalist')
  color: number;        // Hex color for sprite generation (0x4488cc)
  position: {           // Grid position in office (col, row)
    x: number;
    y: number;
  };
  greeting: string;     // Message when player approaches
  description: string;  // Brief description shown in terminal header
  workingDir?: string;  // Optional custom PTY working directory
}
```

### Current Agents

| ID | Name | Color | Position | Description | Working Dir |
|----|------|-------|----------|-------------|-------------|
| `generalist` | Gene | 0x4488cc (blue) | (3, 7) | General-purpose assistant | *(default)* |
| `architect` | Arthur | 0x1a1a2e (dark blue-black) | (3, 13) | Orchestrates plans & spins up agents | *(default)* |
| `admin` | Alice | 0xff69b4 (hot pink) | (20, 13) | Edits game UI code | `src` |

All agents currently use the `general` skill. The `skill` field exists for future routing
through `cli-bridge.ts` but is unused since all agents run `copilot --resume {sessionId}`.

### Adding a New Agent

1. Add entry to `AGENTS` array in `src/config/agents.ts`
2. Ensure unique `id`, `position` (no overlaps), and `color`
3. Add sprite generation in `BootScene.ts` using the new texture key
4. Rebuild — the NPC will appear automatically at the configured grid position

---

## 8. Data Flows

### App Boot → Game Ready

```
electron .
  │
  ├─ Electron main process starts
  │   ├─ loadSessionIds()                    ← Read copilot-office-sessions.json
  │   ├─ require('node-pty')                 ← Load native PTY module
  │   ├─ startFileWatcher()                  ← Spawn esbuild --watch
  │   └─ createWindow()
  │       └─ BrowserWindow.loadFile(src/index.html)
  │
  ├─ Renderer process starts
  │   ├─ Preload injects window.copilotBridge
  │   ├─ Load dist/game.bundle.js
  │   │
  │   ├─ Legacy canvas system initializes (main.ts)
  │   │   ├─ officeManager.ensureDefaultOffice()
  │   │   ├─ Create DOM: tabs bar + office panel + terminal panel
  │   │   ├─ Initialize xterm terminals per agent
  │   │   └─ Start canvas game loop (RAF)
  │   │
  │   └─ Phaser game initializes
  │       ├─ BootScene.preload()
  │       │   └─ Generate all sprite textures procedurally
  │       ├─ BootScene.create()
  │       │   └─ this.scene.start('OfficeScene')
  │       └─ OfficeScene.create()
  │           ├─ Build office layout
  │           ├─ Create player + NPCs
  │           ├─ Create overlays
  │           ├─ preStartAgentSessions()     ← Start admin PTY in background
  │           └─ Begin update() loop
  │
  └─ Game ready — player can move and interact
```

### Player → NPC Conversation

```
1. Player walks near NPC (distance < 2 × tileSize)
   └─ NPC indicator (yellow E bubble) starts pulsing

2. Player presses E key
   └─ OfficeScene.startConversation(agent)
       ├─ player.disableMovement()
       └─ terminalOverlay.show(agent, onClose)

3. TerminalOverlay.show()
   ├─ Check: copilotBridge.terminalExists(agentId)?
   │
   ├─ [First time] Terminal does NOT exist:
   │   └─ copilotBridge.terminalStart(agentId, workingDir)
   │       └─ IPC → main process
   │           ├─ Spawn PTY (powershell/bash)
   │           ├─ Create EventsWatcher
   │           ├─ Register data batching
   │           ├─ activeAgentViewers.add(agentId)
   │           └─ After 500ms: write "copilot --resume {sessionId}\r"
   │
   └─ [Returning] Terminal EXISTS:
       └─ copilotBridge.terminalAttach(agentId)
           └─ activeAgentViewers.add(agentId)  ← Start receiving data again

4. Copilot CLI starts, outputs greeting
   └─ PTY → batched 16ms → IPC 'terminal-data' → xterm.write(data)

5. User types in terminal
   └─ xterm.onData() → copilotBridge.terminalWrite(agentId, data)
       └─ IPC → main → PTY.write(data)

6. Copilot processes, responds
   ├─ PTY output → batched → terminal-data → xterm.write()
   └─ events.jsonl updated → EventsWatcher → copilot-tool-start/complete → renderer

7. User presses F10 to close
   └─ terminalOverlay.hide()
       ├─ container hidden (display: none)
       ├─ PTY stays alive in background
       ├─ player.enableMovement()
       └─ updateSessionBadges() → green badge on NPC
```

### Mini-Game Lifecycle

```
1. Player walks near game station (e.g., ping pong table)
   └─ Prompt text appears: "Press E to play"

2. Player presses E
   └─ OfficeScene.startPongGame()
       ├─ player.disableMovement()
       └─ pongGame.show(onClose)

3. PongGame.show()
   ├─ Reset scores, ball position
   ├─ container.setVisible(true)
   └─ Register scene 'update' listener
       └─ PongGame.update() called every frame
           ├─ Poll keyboard (W/S, arrows, space, esc)
           ├─ Update paddle positions
           ├─ Update ball position + physics
           ├─ Check collisions (paddle, walls)
           └─ Detect scoring

4. Player presses ESC
   └─ pongGame.hide()
       ├─ container.setVisible(false)
       ├─ Unregister update listener
       └─ onClose callback
           └─ player.enableMovement()
```

---

## 9. State Management

### Persistent State (Disk)

**`copilot-office-sessions.json`** (repository root):
```json
{
  "generalist": "a1b2c3d4-...",
  "architect": "e5f6g7h8-...",
  "admin": "i9j0k1l2-..."
}
```
- Maps agent ID → copilot session GUID
- Loaded on app startup (`loadSessionIds()`)
- Saved after: new session created, session ID parsed from PTY output
- Enables `copilot --resume {sessionId}` across app restarts

**Legacy: `localStorage`** (via officeManager):
- Multi-office configurations (names, layouts, agent assignments)
- Office theme preferences
- Used only by the legacy canvas system

### Runtime State (Main Process)

| Variable | Type | Lifetime |
|----------|------|----------|
| `ptyProcesses` | `Map<string, PtyProcess>` | Cleared on reload/quit |
| `agentToTerminal` | `Map<string, string>` | Cleared on reload/quit |
| `activeAgentViewers` | `Set<string>` | Modified per attach/detach |
| `agentWatchers` | `Map<string, EventsWatcher>` | Cleared on reload/quit |
| `agentSessionIds` | `Map<string, string>` | Persisted to disk |
| `mainWindow` | `BrowserWindow \| null` | App lifecycle |
| `watcherProcess` | `ChildProcess \| null` | App lifecycle |
| `pty` | `typeof import('node-pty')` | App lifecycle |

### Runtime State (Renderer — Phaser)

| Location | State | Details |
|----------|-------|---------|
| `OfficeScene` | `player` | Position, velocity, movement enabled |
| `OfficeScene` | `npcs: NPC[]` | Static positions, indicator states, badge states |
| `OfficeScene` | `terminalOverlay` | Visibility, current agent, xterm instance |
| `OfficeScene` | `pongGame`, `volleyballGame`, `arcadeGame` | Mini-game instances |
| `OfficeScene` | Proximity flags | `nearPingPong`, `nearVolleyball`, `nearMcdonalds`, `nearArcade` |
| `OfficeScene` | `nearestNPC`, `nearestDesk` | Closest interactable objects |
| `Player` | `cursors`, `wasd`, `shiftKey` | Keyboard input state |
| `NPC` | `nearPlayer`, `hasActiveSession` | Interaction state |
| `TerminalOverlay` | `isVisible`, `currentAgentId`, `sessionId` | Terminal state |

### Runtime State (Renderer — Legacy Canvas)

| Location | State | Details |
|----------|-------|---------|
| `main.ts` | `agentTerminals` | `Map<string, AgentTerminal>` — xterm instances per agent |
| `main.ts` | `activeTerminalAgentId` | Currently shown terminal |
| `main.ts` | `agentPreloadStatus` | `Map<string, 'preloading' \| 'ready' \| 'failed'>` |
| `main.ts` | `zoom`, `panX`, `panY` | Canvas viewport |
| `main.ts` | `selectedAgentId`, `interactingWithAgent`, `nearbyAgentId` | Interaction state |
| `officeManager` | Office configs, current office, agent assignments | Multi-office state |
| `officeState` | Characters, furniture, tiles | Canvas rendering state |

---

## 10. Resource Management

### Complete Resource Inventory

#### Timers & Intervals

| Timer | Location | Interval | Active When | Cleanup |
|-------|----------|----------|-------------|---------|
| EventsWatcher `fileExistsTimer` | events-watcher.ts | 200ms | Until events.jsonl found | `stop()` or auto-clear on file found |
| EventsWatcher `pollTimer` | events-watcher.ts | 500ms | While watching file | `stop()` |
| PTY data `flushTimer` | main.ts | 16ms | After PTY data received | Auto-clears after flush |
| Terminal fit (×3) | TerminalOverlay.ts | 50ms, 150ms, 300ms | On show() | One-shot setTimeout |
| Terminal focus | TerminalOverlay.ts | 200ms | On show() | One-shot setTimeout |
| Copilot CLI start | main.ts | 500ms | After PTY spawn | One-shot setTimeout |
| NPC indicator tween | NPC.ts | 500ms yoyo | While near player | Phaser auto-cleanup |
| Pong update | PongGame.ts | Per frame | While visible | `hide()` removes listener |
| Volleyball update | VolleyballGame.ts | Per frame | While visible | `hide()` removes listener |
| Arcade update | ArcadeGame.ts | Per frame | While visible | `hide()` removes listener |
| esbuild watcher | main.ts | Continuous | Entire app lifetime | Killed on quit |
| RAF game loop | officeState/gameLoop | Per frame | Always | Never stopped |

#### OS Processes

| Process | Per-Agent | Lifecycle |
|---------|-----------|-----------|
| PTY shell (PowerShell/bash) | Yes (1 per agent) | Killed on terminal-kill, reload, or quit |
| Copilot CLI (child of shell) | Yes (1 per agent) | Dies with parent shell |
| esbuild --watch | No (1 global) | Killed on quit |

Each background agent session = **1 shell process + 1 copilot CLI child** = ~15–30MB RAM.

#### IPC Listeners (Renderer Side)

Per terminal overlay session (registered in `setupTerminalListeners`):

| Listener | Channel | Cleanup |
|----------|---------|---------|
| Terminal data | `terminal-data` | `removeTerminalListeners()` on destroy() |
| Terminal exit | `terminal-exit` | `removeTerminalListeners()` on destroy() |
| Copilot event | `copilot-event` | `removeCopilotListeners()` on destroy() |
| Tool start | `copilot-tool-start` | `removeCopilotListeners()` on destroy() |
| Tool complete | `copilot-tool-complete` | `removeCopilotListeners()` on destroy() |
| Turn end | `copilot-turn-end` | `removeCopilotListeners()` on destroy() |
| User message | `copilot-user-message` | `removeCopilotListeners()` on destroy() |

**Important**: Listeners are NOT removed on `hide()` — only on `destroy()`.

#### File Watchers

| Watcher | Location | Target | Cleanup |
|---------|----------|--------|---------|
| `fs.watch()` | EventsWatcher | `~/.copilot/session-state/{id}/events.jsonl` | `stop()` on PTY exit or app quit |
| esbuild stdout | main.ts | Build output detection | Process killed on quit |

#### DOM Elements

Per terminal overlay:
- Fixed-position container div (survives `hide()`)
- xterm.js canvas elements (GPU-accelerated rendering)
- Header, footer, agent sprite canvas
- **Not removed on hide** — stays in DOM with `display: none`

#### Per-Agent Resource Summary

When an agent's terminal is **open and visible**:

| Resource | Overhead |
|----------|----------|
| PTY process | ~15–30MB RAM |
| xterm Terminal instance | ~1.5–2MB (10K scrollback) |
| FitAddon | ~50KB |
| EventsWatcher | ~100KB + 1 file handle + 500ms timer |
| DOM container | ~500KB–1MB (hidden canvases) |
| IPC listeners | ~10KB (7 listeners) |
| Data batching | 1 timer (16ms, on-demand) |
| **Total** | **~18–35MB per agent** |

When **hidden** (background): same resources minus active data forwarding (batching timer
idle, IPC listeners still registered but events gated by `activeAgentViewers`).

---

## 11. Known Issues & Technical Debt

### Resource Leaks

**🔴 IPC Listeners Not Cleaned on Hide**

When the terminal overlay is hidden (user closes it), IPC listeners for `terminal-data`,
`terminal-exit`, and all `copilot-*` events remain registered. They are only cleaned up on
`destroy()`, which is never called during normal gameplay — `hide()` is used instead.

Impact: Listeners accumulate if the overlay is shown/hidden with different agents. The
`removeAllListeners` approach in `destroy()` is also heavy-handed — it removes listeners
for ALL agents, not just the current one.

**🔴 EventsWatcher Polling Never Pauses**

Each agent's `EventsWatcher` polls the events.jsonl file every 500ms regardless of whether
the terminal is visible. The early-exit check in the event callback (`activeAgentViewers`)
prevents IPC forwarding, but the file I/O still happens.

Impact: N agents = N file reads every 500ms, even when all terminals are hidden.

**🟡 Terminal Window Resize Listener Never Removed**

The `window.addEventListener('resize', ...)` handler in `TerminalOverlay` is registered on
show but never removed on hide. Multiple show/hide cycles could accumulate listeners.

**🟡 DOM Containers Never Destroyed**

Hidden terminal overlay containers stay in the DOM. With only 3 agents this is trivial, but
it doesn't scale.

### Architectural Coupling

**🔴 Two Parallel Rendering Systems**

`src/main.ts` runs a legacy canvas-based office system (officeManager, gameLoop, renderer)
alongside the Phaser game. Both systems:
- Import and use `AGENTS` configuration
- Create their own terminal instances (xterm in main.ts, TerminalOverlay in Phaser)
- Manage their own interaction state
- Render to the same page

This duplication creates confusion about which system is "primary" and doubles the DOM/memory
footprint for terminals.

**🟡 Tight Coupling Between OfficeScene and Overlays**

OfficeScene directly instantiates and manages all overlays (TerminalOverlay, PongGame, etc.)
and manually tracks proximity flags for each game station. Adding a new interactive object
requires modifying OfficeScene in multiple places (create, update, proximity check, E key
handler).

**🟡 Agent-Terminal 1:1 Assumption**

The system assumes one terminal per agent. The `agentToTerminal` map, `activeAgentViewers`
set, and session persistence all key on `agentId`. Supporting multiple concurrent sessions
per agent would require rearchitecting these data structures.

### Missing Features

**🟡 No Terminal Session Limit**

There is no cap on concurrent PTY processes. Opening terminals for all agents spawns N shell
processes + N copilot CLIs. With 3 agents this is ~60–100MB overhead; with more agents it
could become problematic.

**🟡 No Graceful PTY Shutdown**

`proc.process.kill()` sends SIGKILL — copilot sessions are terminated immediately without
cleanup. A graceful shutdown (sending `exit\r` or SIGTERM first) would allow copilot to
save state.

**🟡 Preload System Disabled**

The `PRELOAD_AGENTS` array is empty with a comment: "Preload was causing UI hangs." Only
the admin agent is pre-started. The original intent was to have all agent terminals warm
and ready before the player interacts.

**🟡 Session Pool Unused**

`startNewPooledSession()` creates a `__pool__` PTY that is never assigned to any agent.
This is vestigial code from an abandoned optimization attempt.

### Code Quality

**🟡 Frame-Based Physics in Mini-Games**

PongGame, VolleyballGame, and ArcadeGame all use per-frame position updates (`px/frame`)
instead of delta-time-based physics. Game speed varies with frame rate — slower on
low-performance machines, faster on high-refresh displays.

**🟡 Magic Numbers**

Many constants are inline: interaction distances (2× tileSize), animation durations (500ms),
timer intervals (16ms, 50ms, 150ms, 300ms, 500ms), and physics values. These should be
extracted to a constants file for tuning.

**🟡 DialogBox.ts Orphaned**

`src/ui/DialogBox.ts` is not imported anywhere but remains in the codebase. It was the
predecessor to TerminalOverlay and should be removed.

---

## 12. Terminal UI — Pitfalls & Fixes Log

This section records hard-won lessons about the xterm.js + Phaser + Electron terminal stack
so future sessions don't re-investigate the same issues.

---

### 🔴 CSS padding on `.xterm` breaks FitAddon geometry (cursor drift)

**Symptom**: The PTY cursor appears in the wrong column / text wraps at the wrong width.

**Root cause**: `FitAddon.proposeDimensions()` measures the `.xterm` element's bounding rect to
compute cols/rows. If CSS `padding` is applied directly to `.xterm`, the measured width
*includes* the padding gutter, so the addon tells the PTY it has more columns than xterm
actually renders. Every line that wraps at the PTY's column boundary renders one position off
in the xterm viewport.

**Fix** (`TerminalOverlay.ts → injectStyles()`): Never add padding to `.xterm`. Instead, wrap
the element that `terminal.open()` is called on inside an outer container that holds the padding:

```
#terminal-container  (outer — has padding: 10px; box-sizing: border-box)
  └── inner div      (no padding — terminal.open() called here)
      └── .xterm     (created by xterm; fills inner div exactly)
```

FitAddon now measures the inner div (zero padding), producing accurate col/row counts.

**Do NOT**: add `padding` to the element passed to `terminal.open()`.

---

### 🔴 Adding padding to the element `terminal.open()` is called on breaks keyboard input

**Symptom**: Clicking the terminal and trying to type does nothing — keyboard input is silently
swallowed.

**Root cause**: xterm.js inserts absolutely-positioned overlay elements (canvas layers, the
hidden `<textarea>` for input) relative to the element passed to `terminal.open()`. When that
element has CSS padding, the coordinate space shifts — click targets and the textarea input
area end up offset from where they appear visually, making the terminal appear focused but
not actually receiving input.

**Fix**: Same as above — use an outer wrapper for padding and pass the *inner* (padding-free)
div to `terminal.open()`.

---

### 🔴 Phaser captures Space (and arrow keys) even when `keyboard.enabled = false`

**Symptom**: Spacebar (and sometimes arrow keys) typed in the xterm terminal are silently
dropped — they never appear in the shell. All other keys work.

**Root cause**: Phaser's `KeyboardPlugin.createCursorKeys()` registers Space, arrows, and
Shift in Phaser's internal capture list at startup. Phaser's window-level `keydown` handler
calls `event.preventDefault()` for every key in that list, regardless of whether
`keyboard.enabled` is `true` or `false`. This prevents the browser's default textarea
behaviour, which is how xterm injects input.

**Fix** (`TerminalOverlay.ts → setupKeyboardHandler()`): Install a `keydown` listener in the
**capture phase** (`addEventListener(..., true)`) that calls
`event.stopImmediatePropagation()` for every key except F10 (reserved for closing the
terminal). Because this listener runs before Phaser's window listener, Phaser never sees the
event and never calls `preventDefault()`. xterm receives the event normally via its own
listener on the `<textarea>`.

```ts
this.escapeHandler = (event: KeyboardEvent) => {
  if (!this.isVisible) return;
  if (event.key === 'F10') return;          // handled separately
  event.stopImmediatePropagation();         // block Phaser; do NOT preventDefault
};
document.addEventListener('keydown', this.escapeHandler, true);
```

**Do NOT**: rely solely on `clearCaptures()` + `keyboard.enabled = false` — `clearCaptures()`
doesn't persist if any other Phaser code re-registers captures, and the `enabled` flag does
not gate `preventDefault()` calls in the Phaser 3 keyboard plugin.

---

### 🟡 PTY spawned at fixed 120×30 before xterm measures its real size

**Symptom**: On first open, the terminal renders a slightly wrong number of columns until the
user resizes the window. Usually harmless but can cause initial prompt wrapping.

**Root cause**: `server.ts → startTerminalForAgent()` spawns the PTY with hardcoded
`cols: 120, rows: 30`. The actual xterm viewport size isn't known yet. `fitAddon.fit()` runs
shortly after and sends a resize, but there's a brief window where PTY and xterm disagree.

**Mitigation**: `TerminalOverlay.show()` calls `fitAddon.fit()` via a double
`requestAnimationFrame` (two frames, ~32ms) to ensure DOM layout has settled before measuring
and sending the corrected size to the PTY via `terminalResize`.

---

*Last updated: March 2026.*
