# Focus Summary — Agency Office Input & Focus Model

This document is the canonical specification for how keyboard focus and input
capture work between the **Game pane** (Phaser canvas) and the **Terminal pane**
(xterm.js overlay).

---

## 1. Focus States

The application has two mutually exclusive focus states:

| State      | Owner                  | What receives keys        |
|------------|------------------------|---------------------------|
| `game`     | Phaser canvas element  | Player movement (WASD / arrows), scene shortcuts |
| `terminal` | xterm.js textarea      | Terminal input, F10 close, Ctrl+Shift+N new-session |

There is also a transient `none` state at startup before `OfficeScene.create()`
completes and calls `InputManager.switchToGame()`.

---

## 2. Architecture — Listener Classes

All input capture is managed through four classes in `src/input/`:

### `InputManager` (`src/input/InputManager.ts`)
- **The single source of truth** for which focus state is active.
- Owns one instance each of `GlobalInputListener`, `GameInputListener`,
  `TerminalInputListener`.
- Public API:
  - `switchToGame(reason)` — transition to game focus
  - `switchToTerminal(reason, onNewSession)` — transition to terminal focus
  - `activateTerminalF10(onClose)` — install F10-close handler (terminal visible)
  - `deactivateTerminalF10()` — remove F10-close handler (terminal hidden)
  - `focusTerminalXterm(terminal)` — call `terminal.focus()` after 100 ms delay
  - `blurTerminalXterm(terminal)` — call `terminal.blur()`
  - `destroy()` — tear down all listeners (called on scene shutdown)
- All transitions log `[InputManager] ── switchTo<Mode>()` with `from`, `reason`,
  and `time` fields.

### `GlobalInputListener` (`src/input/GlobalInputListener.ts`)
- Installed **once** at app start on `document`, capture phase (`useCapture=true`).
- **Observational only** — does not `preventDefault` or `stopPropagation`.
- Logs every `keydown` as:
  ```
  [GlobalInput] keydown "<key>" | mode: <game|terminal> | target: <tagName> | time: <ms>
  ```
- Tracks `FocusMode` so logs are always contextual.

### `GameInputListener` (`src/input/GameInputListener.ts`)
- Wraps Phaser's `scene.input.keyboard` enable/disable lifecycle.
- `activate(reason)`:
  - Re-adds captures for `UP DOWN LEFT RIGHT SPACE` (needed by `createCursorKeys()`)
  - Sets `keyboard.enabled = true`
  - Calls `canvas.focus()`
  - Logs `[GameInput] activate()`
- `deactivate(reason)`:
  - Sets `keyboard.enabled = false`
  - Calls `keyboard.clearCaptures()` (Phaser stops calling `preventDefault` on keys)
  - Logs `[GameInput] deactivate()`

### `TerminalInputListener` (`src/input/TerminalInputListener.ts`)
- Two independent capture-phase listeners:
  1. **`f10Handler`** — active while terminal is _visible_; intercepts `F10` →
     calls `onClose()` callback.
  2. **`shortcutHandler`** — active while terminal has _keyboard focus_; intercepts
     `Ctrl+Shift+N` → calls `onNewSession()`. Does **not** stop propagation for any
     other key (xterm must receive them).
- Logs `[TerminalInput]` on every install/remove.

---

## 3. Transition Flows

### Game → Terminal (NPC interaction or agent card click)

```
User clicks NPC / agent card
  │
  ├─ OfficeScene.startConversation(agent)
  │     player.disableMovement()
  │     terminalOverlay.show(agent, onClose)
  │
  └─ TerminalOverlay.show()
        inputManager.activateTerminalF10(() => hide())   [F10 handler installed]
        focusTerminal()
          └─ inputManager.switchToTerminal("TerminalOverlay.focusTerminal()", onNewSession)
                  GameInputListener.deactivate()          [Phaser keyboard disabled]
                  TerminalInputListener.activateShortcuts() [Ctrl+Shift+N installed]
                  GlobalInputListener.setMode("terminal")
             inputManager.focusTerminalXterm(terminal)    [terminal.focus() after 100ms]
```

### Terminal → Game (F10 press or background click)

```
[F10]
  └─ TerminalInputListener.f10Handler fires
        TerminalOverlay.hide()
          inputManager.deactivateTerminalF10()            [F10 handler removed]
          blurTerminal()
            └─ inputManager.switchToGame("TerminalOverlay.blurTerminal()")
                    TerminalInputListener.deactivateShortcuts()
                    GameInputListener.activate()           [Phaser keyboard re-enabled]
                    GlobalInputListener.setMode("game")
               inputManager.blurTerminalXterm(terminal)
          scene.game.canvas.focus()

[Background canvas click]
  └─ OfficeScene pointerdown handler
        terminalOverlay.blurTerminal()                    [same as above]
        player.enableMovement()
```

### External open (agent card in overview panel)

```
game.events.emit('terminal:open')  [from main.ts]
  └─ OfficeScene listener
        playerMovementEnabled = false
        player.disableMovement()

game.events.emit('open:agent:terminal', agentId)
  └─ OfficeScene listener → startConversation(agent) → same as "Game → Terminal" above
```

---

## 4. Key Rules

1. **Phaser must have its keyboard disabled while the terminal is focused.**
   If `keyboard.enabled = true` and there are active captures, Phaser calls
   `preventDefault()` on captured keys (arrows, space) before xterm ever sees them.

2. **Only `F10` and `Ctrl+Shift+N` are intercepted** from the document while the
   terminal is focused. Every other key passes through to xterm's textarea without
   being stopped.

3. **The `GlobalInputListener` never stops events.** It is for logging only.
   Actual interception happens in `GameInputListener` (via Phaser captures) and
   `TerminalInputListener` (via explicit `preventDefault` + `stopImmediatePropagation`).

4. **Focus transitions are always driven through `InputManager`.** Neither
   `TerminalOverlay` nor `OfficeScene` manipulates `keyboard.enabled`,
   `clearCaptures`, or `addCaptures` directly.

5. **`canvas.focus()` is called on every game-focus activation** so the browser's
   DOM focus matches Phaser's logical focus.

6. **`terminal.focus()` has a 100 ms delay** to ensure the xterm DOM is fully
   rendered and positioned before focus is requested.

---

## 5. Logging Format

Every focus event is logged to the browser console (or Electron renderer DevTools).

| Prefix            | When                                      |
|-------------------|-------------------------------------------|
| `[InputManager]`  | switchToGame / switchToTerminal calls     |
| `[GlobalInput]`   | every keydown + mode changes              |
| `[GameInput]`     | activate / deactivate calls               |
| `[TerminalInput]` | handler install / remove / key intercepts |
| `[TerminalOverlay]` | focusTerminal / blurTerminal calls      |
| `[OfficeScene]`   | background-click and startup events       |

Example console output during NPC interaction:
```
[OfficeScene] background click — returning focus to game
[TerminalOverlay] blurTerminal() — delegating to InputManager
[InputManager] ── switchToGame() ──────────────────────────────────────
  reason  : "TerminalOverlay.blurTerminal()"
  from    : "terminal"
  time    : 1741299600123
[GameInput] deactivate() — reason: "TerminalOverlay.blurTerminal()" | time: ...  ← (deactivateShortcuts first)
[TerminalInput] shortcut handler removed
[GameInput] activate() — reason: "TerminalOverlay.blurTerminal()" | time: ...
[GameInput] Phaser keyboard enabled, captures restored (UP DOWN LEFT RIGHT SPACE)
[GameInput] canvas.focus() called
[GlobalInput] mode updated: "terminal" → "game" | time: ...
[InputManager] ── switchToGame() complete ──────────────────────────
[InputManager] blurTerminalXterm() | time: ...
```

---

## 6. Files Reference

| File | Role |
|------|------|
| `src/input/InputManager.ts` | Orchestrator, public API, logging |
| `src/input/GlobalInputListener.ts` | Observational document listener |
| `src/input/GameInputListener.ts` | Phaser keyboard wrapper |
| `src/input/TerminalInputListener.ts` | F10 + Ctrl+Shift+N intercepts |
| `src/ui/TerminalOverlay.ts` | Calls InputManager; owns xterm lifecycle |
| `src/scenes/OfficeScene.ts` | Creates InputManager; handles scene events |
| `src/entities/Player.ts` | Uses Phaser cursor keys; unaware of InputManager |
| `electron/main.ts` | Removes app menu so F10 is not consumed by OS |
