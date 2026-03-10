---
applyTo: "src/input/**"
---

# Input System — Three-Tier Keyboard Orchestration

## Purpose

Manages mutual exclusivity between Phaser game controls and xterm.js terminal input.
Only one side owns the keyboard at a time. All transitions are centrally coordinated
so no stale listeners or focus conflicts occur.

## Architecture

`InputManager` is the single entry point. It owns three sub-listeners:

| Listener                  | Scope              | Intercepts keys?          |
|---------------------------|--------------------|---------------------------|
| `GlobalInputListener`     | Entire app         | No (observational only)   |
| `GameInputListener`       | Phaser scene       | Yes (captures arrows/WASD/space) |
| `TerminalInputListener`   | Terminal overlay    | Yes (F10, Ctrl+Shift+N, Ctrl+F) |

Two mutually exclusive focus states exist: **`game`** (Phaser keyboard active) and
**`terminal`** (xterm.js active). The current state is tracked in `InputManager.currentFocus`.

## InputManager.ts — Central Coordinator

Public API consumed by `OfficeScene` and `TerminalOverlay`:

- `switchToGame(reason)` — deactivate terminal shortcuts → enable Phaser keyboard + captures → focus canvas
- `switchToTerminal(reason, onNewSession, onToggleFullscreen?)` — disable Phaser keyboard → activate terminal shortcuts
- `activateTerminalF10(onClose)` — install F10 close handler (independent of focus state)
- `deactivateTerminalF10()` — remove F10 handler
- `focusTerminalXterm(terminal)` — delayed focus with retry (100 ms + backoff, up to 3 attempts)
- `blurTerminalXterm(terminal)` — return DOM focus away from xterm
- `destroy()` — tear down all listeners

All methods are **idempotent** — safe to call repeatedly without side effects.

## GameInputListener.ts — Phaser Keyboard Wrapper

- `activate(reason)` — re-adds key captures (UP, DOWN, LEFT, RIGHT, SPACE), sets `keyboard.enabled = true`, calls `canvas.focus()`
- `deactivate(reason)` — sets `keyboard.enabled = false`, calls `clearCaptures()`
- Gracefully handles missing `scene.input.keyboard` (logs warning, no crash)

## GlobalInputListener.ts — Document-Level Observer

- Installs a single `keydown` listener in **capture phase** at startup
- Logs every key with modifiers, current mode, and target element tag
- Tracks current focus mode via `setMode()` for log context
- Intercepts `Ctrl+R` (soft reload) and `Ctrl+Shift+R` (hard reload with terminal cleanup)
- Runs for the entire application lifetime; installed/uninstalled once

## TerminalInputListener.ts — Two-Phase Intercept Model

Two independent capture-phase `keydown` handlers:

1. **F10 handler** (visible lifetime) — active whenever the terminal overlay is shown.
   Calls `onClose()` on F10, uses `stopImmediatePropagation` to prevent xterm from seeing it.
2. **Shortcut handler** (focus lifetime) — active only when terminal has keyboard focus.
   Intercepts `Ctrl+Shift+N` (new session) and `Ctrl+F` (toggle fullscreen).
   All other keys pass through untouched to xterm.

The two phases are **independent**: F10 can be active while shortcuts are inactive (e.g., terminal visible but game has focus).

## Critical Rules

- **NEVER** enable/disable Phaser keyboard directly — always go through `InputManager`
- All `InputManager` switch methods are idempotent; duplicate calls are harmless
- `GlobalInputListener` must **NEVER** call `preventDefault` or `stopPropagation` on regular keys (reload shortcuts are the sole exception)
- `TerminalInputListener` phases are independent — do not assume one implies the other
- Focus transfer to xterm requires a delay (~100 ms); use `focusTerminalXterm()` which retries

## Common Tasks

**Adding a terminal-scoped shortcut:** Add the key check inside `TerminalInputListener.activateShortcuts()`, call `preventDefault` + `stopImmediatePropagation`, and invoke the callback passed from `InputManager.switchToTerminal()`.

**Adding a game-scoped key capture:** Add the key code to the `addCapture()` array in `GameInputListener.activate()`. Handle the key in `OfficeScene.update()` via the existing cursor/key objects.

**Adding a global shortcut:** Add to `GlobalInputListener.onKeydown()`. Use `preventDefault` + `stopPropagation` only if the shortcut must block all other listeners.
