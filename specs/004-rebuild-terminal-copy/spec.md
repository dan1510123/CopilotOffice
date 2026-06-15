# Spec 004: Rebuild Terminal Copy/Paste

**Status:** In progress (branch: `004-rebuild-terminal-copy`)
**Supersedes:** the copy paths added by spec 002 (US3 / C5) and the IPC-bridge clipboard work added as a 003 follow-up.

## Why

The current copy implementation has three parallel paths (Ctrl+C key handler, floating "📋 Copy" button, document `copy` event listener) routed through a `writeClipboardText` helper that tries `navigator.clipboard.writeText` then a hidden `<textarea>` + `execCommand('copy')` fallback. The user reports "copying still fails even though it says copied" in real Electron — multiple debug rounds (spec 002 rewrite, spec 003 IPC-bridge addition) have not fixed it. The surface area is large, the responsibilities overlap, and the UX is murky.

Time to throw it out and rebuild.

## What

### UX

1. **Ctrl+C** — when the xterm has a non-empty selection, copy it to the OS clipboard. Suppress the keystroke from reaching the PTY. (Copilot CLI does not use Ctrl+C as SIGINT — it has its own keybinding model — so intercepting Ctrl+C is safe for our use case.) With no selection, Ctrl+C passes through unchanged.
2. **Right-click on the terminal** — show a small native-looking context menu with **Copy** (enabled iff selection non-empty) and **Paste** (always enabled). Click-away dismisses it. Escape dismisses it.
3. No floating button. No native browser `copy` event listener. No `execCommand('copy')` fallback.

### Implementation

- **Single canonical write path:** Electron main-process `clipboard.writeText(text)` via IPC channel `clipboard-write-text`. This bypasses Permissions API + document-focus restrictions that make renderer-side clipboard APIs unreliable.
- **Single canonical read path:** Electron main-process `clipboard.readText()` via IPC channel `clipboard-read-text`. Used by paste.
- **Paste:** read clipboard text → forward to the PTY via the existing `terminalWrite(officeId, agentId, text)` IPC. The PTY does the work of inserting it into the running Copilot CLI / shell.
- **Context menu:** a small purpose-built HTML element (`<div id="terminal-context-menu">`) absolutely-positioned at the cursor, shown on the terminal div's `contextmenu` event, dismissed on `mousedown` anywhere else or Escape.
- **Both renderers in scope:** game-mode `TerminalOverlay` and serious-mode `SeriousTerminalController` get the same mechanism.

### Out of scope

- Cross-platform clipboard tricks (we are Electron-only)
- Image / rich-text copy
- Drag-to-select changes (xterm handles selection unchanged)
- Keyboard shortcut for paste (operator can right-click; Ctrl+Shift+V conventions deferred)

## Acceptance

1. Select text in the game-mode terminal, press Ctrl+C, paste into Notepad → matches selection.
2. Select text in the serious-mode terminal, press Ctrl+C, paste into Notepad → matches selection.
3. Right-click in either terminal → menu shows; Copy is enabled with a selection / disabled without; Paste is always enabled.
4. Click Paste → the clipboard text appears in the terminal's PTY input (visible if a shell prompt is open).
5. Ctrl+C with no selection in either terminal does not silently swallow the keystroke.
6. No regression of `npm test` (all 197 tests still pass after test updates for the removed paths).
7. Build clean with no TypeScript errors.

## Removal checklist (what gets deleted)

- `TerminalOverlay.installCopySelectionButton()` and the `📋 Copy` floating button
- `TerminalOverlay.attachTerminalCopyListener()` / `detachTerminalCopyListener()` / `terminalCopyHandler` field
- `TerminalOverlay.writeClipboardText()` — replaced by direct bridge call
- The branching Ctrl+C handler inside `attachCustomKeyEventHandler` — replaced by a simpler version
- All of the same in `SeriousTerminalController`
- The `tests/integration/terminal/TerminalOverlay.test.ts` "US3 C5" and "C5 wires onSelectionChange visibility" tests, and the SeriousTerminalController C5 test — superseded by new tests

## Kept from prior work

- `clipboard-write-text` IPC handler in `electron/nonTerminalIpc.ts` (added as the 003 follow-up)
- `window.copilotBridge.clipboardWriteText(text)` preload export
- All spec 002 cold-start / session-repair / startup-timeout fixes (unrelated)
- All spec 003 sprite-card uniqueness + serious-mode open-flow fixes (unrelated)
