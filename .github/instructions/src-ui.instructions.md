---
applyTo: "src/ui/**"
---

# UI Components — `src/ui/`

## Purpose

DOM-based and Phaser-based UI overlays for Agency Office. This directory contains the xterm.js
terminal overlay, mini-game overlays, a toast notification system, and a legacy dialog box.
All DOM overlays must coordinate with `InputManager` for keyboard focus transitions.

## TerminalOverlay.ts — Primary UI Component

The main interaction surface. An xterm.js-based terminal for agent conversations.

- **Session persistence** — reattaches to existing sessions; session IDs managed by the terminal
  server (never parsed from CLI output).
- **Detach / popout** — sessions can be detached or popped into a separate window.
- **Full-width toggle** — persisted to `localStorage` (`agencyOffice:terminalFullWidth`).
- **Agent sprite card header** — shows agent name, description, inception badge (admin only),
  session title, keyboard shortcuts.
- **Session controls footer** — agent sprite preview, session ID (click to copy), history popover.
- **Focus management** — calls `InputManager.switchToTerminal()` on show and
  `InputManager.switchToGame()` on hide. Never toggle Phaser keyboard directly.
- **IPC** — all terminal operations go through `window.copilotBridge` (see `preload.ts`).
  Uses `withTimeout()` wrapper (10 s) around IPC calls to avoid hanging.

## Mini-Game Overlay Pattern

`PongGame.ts` and `BasketballGame.ts` follow the same pattern:

- **Phaser Container** — rendered as Phaser GameObjects inside a `Phaser.GameObjects.Container`,
  not DOM elements. Use Phaser depth (`Depths.MINIGAME` = 200), not CSS z-index.
- **show() / hide()** — toggle visibility; `hide()` fires `onClose` callback.
- **Escape to close** — listen for `ESC` key to exit.
- **Self-contained game loop** — register an `update` handler on the scene; remove it on hide.
- **Feature flags** — gated by constants at the top of `OfficeScene.ts`
  (`ENABLE_PING_PONG`, `ENABLE_BASKETBALL`). Do not enable without checking flag state.

## Notification System

Three components work together:

| File | Role |
|------|------|
| `ToastNotification.ts` | Renders toast popups. Fixed position (top-left over game panel). Max 3 visible, auto-dismiss after 5 s. Rate-limited to 5 toasts per 2 s window. z-index 9000. |
| `NotificationService.ts` | Central dispatch. Checks per-event enable flags, deduplicates within a configurable window (default 3000 ms), resolves agent info, formats messages, routes to toast manager. |
| `NotificationSettingsPanel.ts` | Modal overlay (z-index 20000) with per-event-type toggle switches. Persists settings to `localStorage` via `config/notifications.ts`. |

Supported event types: `turnEnd`, `askUser`, `turnStart`, `toolStart`, `toolComplete`,
`sessionReady`, `sessionError`.

## CameraDragController.ts — Camera Pan Controller

Click-to-drag camera panning for the Phaser game viewport.

- **Drag vs click detection** — uses a 5px distance threshold to distinguish drags from NPC clicks.
- **`CameraDragConfig`** — accepts `worldWidth`, `worldHeight`, `tileSize`, optional `bufferTiles` (extra panning padding, default 1), and `excludeObjects` (game objects that should not trigger drag, e.g. zoom bar).
- **Camera clamping** — constrains scroll within room bounds plus the tile buffer. Centers camera when viewport exceeds bounds.
- **`wasDragging()`** — returns true once per gesture if dragging occurred; callers should skip click handling.
- **`onPlayerMove(playerX, playerY)`** — called from `update()` to smoothly lerp camera back to player after manual pan (0.08 lerp speed).
- **`enable()` / `disable()`** — toggle panning (disabled during terminal focus or mini-games).
- **`updateBounds()`** — refreshes camera bounds after zoom changes.
- **`destroy()`** — removes all pointer event listeners.

## FleetDashboard.ts — Fleet Execution Dashboard

DOM-based dashboard showing real-time fleet execution progress, displayed in the right panel during fleet mode.

- **Layout**: Header (title + progress text) → progress bar → scrollable agent list → aggregate footer.
- **`updateState(state: FleetState)`** — renders sub-agent rows sorted by state (running → dispatched → completed → failed), updates progress bar percentage, and aggregate tool counts.
- **Agent rows**: Each row shows status icon (⏳/🧠/✅/❌), task description, agent type badge, and elapsed time.
- **`show()` / `hide()`** — toggles `display: flex/none`.
- **`destroy()`** — removes container and injected `<style>` element.
- Styled inline via injected CSS (`.fleet-dashboard` class family). Background: `#1e1e2e`, accent: `#4488cc`.
- No z-index used — renders inline within the right panel DOM, not as an overlay.

## DialogBox.ts — DEPRECATED

Legacy Phaser-based conversation UI. Replaced entirely by `TerminalOverlay`.
**Do not extend, modify, or build new features on this class.** It remains only for reference.

## Z-Index Rules

| Layer | z-index |
|-------|---------|
| Status bar | 100 |
| Toast container | 9000 |
| Terminal overlay | 10000 |
| Sprite card | 10001 |
| Notification settings modal | 20000 |

New DOM elements must be placed at the correct stacking level. Always verify z-index when
adding overlays to avoid elements being hidden behind existing layers.

## Key Rules

- All DOM overlays **must** coordinate with `InputManager` for focus transitions.
- Terminal operations go through `window.copilotBridge` — never use `ipcRenderer` directly.
- Mini-games use Phaser depth values, not DOM z-index.
- Toast notifications auto-dismiss (5 s) and deduplicate within a 3000 ms window per agent+event.
- Overlay cleanup (removing listeners, clearing timers) must happen in hide/destroy methods.

## Common Pitfalls

- **Forgetting to disable game input** when showing a DOM overlay — player keeps moving.
- **Not cleaning up on overlay close** — dangling event listeners, timers, or ResizeObservers.
- **Z-index conflicts** — new overlays appearing behind the terminal or sprite card.
- **Direct Phaser keyboard toggling** — always go through `InputManager`, never call
  `scene.input.keyboard.enabled = false` directly.
