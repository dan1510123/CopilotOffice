# Copilot Office — Feature Summary

*A 2D pixel-art RPG where you walk around a virtual office and collaborate with AI agents through real Copilot CLI terminals.*

---

## 🎮 Core Experience

| Feature | Status | Description |
|---------|--------|-------------|
| **Player Movement** | ✅ Shipped | WASD/arrow keys + shift-to-sprint in a 20×12 tile office |
| **NPC Interaction** | ✅ Shipped | Walk up to an agent and press `E` (or click) to open a real terminal conversation |
| **Procedural Sprites** | ✅ Shipped | All characters and furniture are pixel-art generated at runtime — zero image assets |
| **Y-Sorted Depth** | ✅ Shipped | Isometric-style rendering where objects closer to the camera render in front |
| **Collision Physics** | ✅ Shipped | Walls, desks, and NPCs block the player with bump feedback |

## 🤖 Agent System (4 Active Agents)

| Agent | Role | Personality |
|-------|------|-------------|
| **Gene** (blue) | Generalist | Coding, debugging, research — your go-to |
| **Arthur** (dark) | Architect | Plans tasks, orchestrates multi-agent work, runs meetings |
| **Dan** (green) | Debugger | Investigates bugs, stack traces, root cause analysis |
| **Alice** (pink) | Admin | Edits the game's own UI code (recursive/inception mode) |

**+ 6 reserve sprites** ready for future agents (Azure, Validator, Deployer, Doctor, Scout, Accountant).

### Agent Status System
- Real-time status badges on each NPC: **slacking** → **starting** → **ready** → **waiting** → **thinking** → **error**
- Pulsing green animation when an agent is actively thinking
- Unread action count per agent
- Status tracked independently per office

## 💬 Terminal System

| Feature | Status | Description |
|---------|--------|-------------|
| **xterm.js Integration** | ✅ Shipped | Full terminal emulator with ANSI color support in the right panel |
| **Session Persistence** | ✅ Shipped | Agent sessions survive app restarts via `--resume` |
| **Multi-Agent Parallel** | ✅ Shipped | Multiple agents can have active CLI sessions simultaneously |
| **Fullscreen Toggle** | ✅ Shipped | `Ctrl+F` expands terminal to 100% width (persisted) |
| **New Session** | ✅ Shipped | `Ctrl+Shift+N` creates a fresh session for any agent |
| **Event Watching** | ✅ Shipped | Parses Copilot CLI events in real-time (tool start/end, turn start/end) |
| **Scrollback Buffer** | ✅ Shipped | Up to 512KB of terminal history per agent |

## 🏢 Multi-Office System

| Feature | Status | Description |
|---------|--------|-------------|
| **Office Tabs** | ✅ Shipped | Top bar with tabs for switching between offices |
| **Office CRUD** | ✅ Shipped | Create, rename, change working directory, delete offices |
| **Per-Office State** | ✅ Shipped | Each office tracks its own agent statuses independently |
| **Persistence** | ✅ Shipped | Offices saved to localStorage, restored on startup |

## 📋 Meeting Mode (Arthur's Planning Room)

| Feature | Status | Description |
|---------|--------|-------------|
| **Meeting Room Scene** | ✅ Phase 1 | Separate cozy scene — meeting table, whiteboard, zoomed-in camera |
| **Planning Terminal** | ✅ Phase 1 | Arthur auto-opens terminal with specialized planning prompt |
| **Plan Detection** | ✅ Phase 1 | Parses JSON task plans from Arthur's terminal output |
| **Plan Approval UI** | ✅ Phase 1 | Modal showing tasks + agent assignments; approve, revise, or cancel |
| **Exit Animation** | ✅ Phase 1 | Player & Arthur walk to doors, fade to black, return to office |
| **Agent Walk-In** | ✅ Phase 1 | Assigned agents animate walking from entrance to their desks |
| **Fleet Orchestration** | ✅ Phase 2 | Parallel agent spawning via fleetOrchestrator, fleetTracker, fleetVisualizer |
| **Pre-seeded Prompts** | 📋 Planned | Server-side prompt injection on terminal start |
| **Git Worktrees** | 📋 Planned | Isolated working directories per agent |
| **Meeting Re-entry** | 📋 Planned | Return to meeting room while fleet is running |

## 🎯 Mini-Games

| Game | Status | Description |
|------|--------|-------------|
| **Pong** | ⚠️ Built, flag off | 1v1 vs AI, difficulty scaling, in-office ping pong table |
| **Basketball** | ⚠️ Built, flag off | Free-throw shooting, power charge, streak multiplier |

*Both are fully playable — just need the feature flag flipped to `true`.*

## 🔔 Notification System

| Feature | Status | Description |
|---------|--------|-------------|
| **Toast Notifications** | ✅ Shipped | Top-right toasts for agent events (turn end, ask user, errors) |
| **OS Notifications** | ✅ Shipped | Native desktop notifications alongside toasts |
| **Settings Panel** | ✅ Shipped | Per-event toggles, deduplication window slider, custom templates |
| **Click-to-Open** | ✅ Shipped | Click a toast → jumps to that agent's terminal |

## 🖥️ UI & Layout

| Feature | Status | Description |
|---------|--------|-------------|
| **Split Panel** | ✅ Shipped | Left = Phaser game world, Right = agent dashboard or terminal |
| **Agent Dashboard** | ✅ Shipped | Overview of all agents with status, current tool, last action, unread count |
| **Status Bar** | ✅ Shipped | Bottom bar: current office, active agent, unread count, shortcuts |
| **Sprite Cards** | ✅ Shipped | Agent portrait + name + description in terminal footer |
| **Context Prompts** | ✅ Shipped | Dynamic instruction text based on proximity ("Press E to talk to Gene") |
| **Debug Mode** | ✅ Shipped | 🐛 button toggles physics body visualization |
| **Layout System** | ✅ Shipped | Pluggable layouts (`src/layouts/`) with default and fleet variants (dashboard + click handler) |
| **Camera Drag** | ✅ Shipped | CameraDragController enables click-to-drag camera panning with click/drag discrimination |
| **Responsive Tiles** | ✅ Shipped | Tile size: `max(48, floor(min(screenW/20, screenH/12)))` scales to screen |
| **Player Customization** | 🔧 Partial | Config module (`playerCustomization.ts`) with color presets; UI panel planned |

## ⌨️ Input System

| Feature | Status | Description |
|---------|--------|-------------|
| **Focus Management** | ✅ Shipped | Seamless switching between game controls and terminal typing |
| **Click-to-Interact** | ✅ Shipped | Click any NPC to open their terminal directly |
| **Global Shortcuts** | ✅ Shipped | F10 close, Ctrl+Shift+N new session, Ctrl+F fullscreen — always work |

## 🛠️ Developer Experience

| Feature | Status | Description |
|---------|--------|-------------|
| **Hot Reload** | ✅ Shipped | `Ctrl+R` soft reload (keeps sessions), `Ctrl+Shift+R` hard reload |
| **Watch Mode** | ✅ Shipped | `npm run dev` with concurrent esbuild watchers |
| **Feature Flags** | ✅ Shipped | 4 boolean toggles at top of OfficeScene.ts (PING_PONG, DECORATIONS, BASKETBALL, ZOOM_BAR) |
| **Debug Logging** | ✅ Shipped | Namespaced console logs across all subsystems |

---

## 📊 By the Numbers

- **4** active AI agents + **6** reserve agent slots
- **2** mini-games (behind feature flags)
- **3** Phaser scenes (Boot, Office, Meeting)
- **7** notification event types with per-type configuration
- **4** feature flags (ENABLE_PING_PONG, ENABLE_DECORATIONS, ENABLE_BASKETBALL, ENABLE_ZOOM_BAR)
- **20×12** tile office grid
- **0** external image assets (100% procedural sprites)
- **3-tier** terminal architecture (xterm.js → Electron IPC → node-pty)

---

## 🚧 Planned / In Progress

1. **Fleet Refinement** — Fleet orchestrator, tracker, and visualizer are built; refining parallel execution and completion detection
2. **Pre-seeded Prompts** — Inject task context into agent terminals at spawn time
3. **Git Worktrees** — Each agent works in an isolated branch/directory
4. **Meeting Re-entry** — Jump back into the meeting room while agents are working
5. **Player Customizer UI** — SpriteCustomizerPanel for in-game character color customization (config exists)
6. **Decorative Furniture** — 18+ sprites already generated, behind feature flag
