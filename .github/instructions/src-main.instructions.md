---
applyTo: "src/main.ts"
---

# src/main.ts — Renderer Entry Point & Coordinator

## Purpose

Application entry point for the renderer process. Creates the split DOM layout,
initializes `Phaser.Game`, wires up all `window.copilotBridge` IPC event listeners,
and coordinates bidirectional Phaser↔DOM communication. This file is the **bridge**
between the Phaser game world and the DOM-based UI — keep it as a coordinator, not
a dumping ground for feature logic.

## DOM Layout

Creates a four-region split layout (all inside `#game-container`):

| Region | Height / Width | Content |
|--------|---------------|---------|
| **Office tabs bar** | top, 72px fixed | Horizontal office tabs, settings gear per office, "+ New Office" button |
| **Left panel** | 50% width | Phaser.Game canvas (the 2D office world) |
| **Right panel** | 50% width | Switches between **Overview Dashboard** (agent list with status) and **Terminal View** (xterm.js session) |
| **Status bar** | bottom, 58px fixed | Player coords, current agent, perf info — updates are **debounced** via `requestAnimationFrame` |

## Phaser Initialization

Creates `Phaser.Game` targeting the left panel container with the scene chain:
`BootScene` → `OfficeScene` (+ `MeetingScene` when applicable). The game instance
is stored in `phaserGameRef` for event wiring.

## IPC Bridge Wiring

All IPC goes through `window.copilotBridge` (exposed by `electron/terminal/preload.ts`).
**Never use raw Electron IPC from this file.** Key listeners wired up:

- `onTerminalData` — routes PTY output to the active xterm.js instance
- `onTerminalExit` — handles session cleanup, updates agent status to `slacking`
- `onCopilotEvent` — general Copilot lifecycle events
- `onCopilotToolStart` / `onCopilotToolComplete` — updates NPC tool badges
- `onCopilotTurnStart` / `onCopilotTurnEnd` — toggles agent `thinking` state
- `onCopilotUserMessage` — tracks user messages for session context
- `onTerminalPreloadStatus` — tracks agent preload readiness

## Event Coordination (game.events)

Key Phaser↔DOM event patterns:

- **`agent:interact`** → OfficeScene emits when player talks to NPC; main.ts opens terminal
- **`terminal:open` / `terminal:close`** → toggles player movement (disables game input during terminal focus)
- **`office:switch`** → emitted on tab click; Phaser scene reloads with new office config
- **`agent:status:changed`** / **`agent:tool:start`** → updates NPC status badges and pulse animations
- **`open:agent:terminal`** → emitted from dashboard to open a specific agent's terminal
- **`game:panel:clicked`** → focus management (returns input focus to Phaser)
- **`npc:highlight` / `npc:clear-highlight`** → visual feedback when terminal is open for an agent

## Office Tabs

DOM-managed tab bar for multi-office switching. Each tab shows office name with a
settings gear icon. The "+ New Office" button triggers `officeManager` CRUD.
Switching offices cleans up current listeners and re-wires for the new office context.

## Toast Notifications

Managed via `NotificationService` + `ToastNotificationManager`. Notifications fire
on agent status transitions (e.g., tool start/complete, session exit). Settings are
configurable per-user via `NotificationSettingsPanel`.

## Key Rules

- **Coordinator only** — feature logic belongs in dedicated modules (`TerminalOverlay`, `officeManager`, scenes), not here
- **All IPC through `copilotBridge`** — never import Electron IPC directly in renderer code
- **Status bar updates are debounced** — `scheduleStatusBarUpdate()` batches via `requestAnimationFrame`
- **`ENABLE_STARTING_GUARD` flag** — secondary safety net to block stale IPC events during agent startup (server-side filtering is primary)

## Common Pitfalls

- **Event listener leaks on office switch** — always clean up `copilotBridge` listeners and `game.events` when switching offices or the listeners accumulate
- **Focus desync** — game and terminal focus states can drift; all transitions must go through `InputManager`, never toggle Phaser keyboard directly
- **DOM z-index conflicts** — terminal overlay is `10000`, sprite card is `10001`, status bar is `100`; new overlays must respect this stacking order
- **Stale DOM on soft reload** — `container.innerHTML = ''` at the top prevents duplicate elements when `main.ts` re-executes during hot reload


## Post-Refactor (S1-C / S1-D / S2-A telemetry, 2026-06-04)

**Tool status reducer** lives in `src/util/toolStatus.ts`:

- `normalizeToolName(name)` — lowercase + collapse whitespace/dashes
- `isAskUserTool(name, status)` — matches canonical id + freeform CLI status text
- `nextSubStateAfterToolComplete(remainingTools)` — race-guard reducer: when an `ask_user` tool is still pending, it MUST win over the most recent tool name. Used by the `onCopilotToolComplete` handler.

**Lifecycle telemetry** lives in `src/util/lifecycleLog.ts`:

- Every `OfficeManager.setAgent*` mutation emits a structured `[lifecycle] agent=X office=Y from→to reason=Z` log line via `logLifecycleTransition`.
- Self-transitions are suppressed at the source; subscribers can't break producers (errors caught + logged).
- High-signal call sites in `src/main.ts` pass reason strings (`ask_user`, `ask_user_race_guard`, `tool_start`, `tool_complete`, `turn_end`, `preload_ready`, `preload_failed`, `session_closed`).

**Diagnostic handle**: `window.__phaserGame` exposes the live `Phaser.Game` instance for Playwright specs and devtools. Read-only — never assigned to from inside the app.

**Diagnostic logs**: search `grep '[lifecycle]'` to reconstruct any agent's full state graph during incident triage.