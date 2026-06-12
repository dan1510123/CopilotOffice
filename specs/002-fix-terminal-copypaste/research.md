# Research: Fix Terminal Copy/Paste

## R1: xterm.js 5.5.0 → 6.0.0 Migration

**Decision**: Upgrade @xterm/xterm from ^5.5.0 to ^6.0.0

**Rationale**: xterm 6.0.0 fixes the canvas renderer bug where `hasSelection()` returns stale `false` values immediately after a user creates a selection. This bug is the root cause that originally motivated the indirect copy event listener architecture. With the fix in place, direct `hasSelection()` calls at key-handler invocation time are reliable.

**Alternatives considered**:
- *Debounce/setTimeout workaround*: Rejected — introduces latency and race conditions; doesn't fix the root cause
- *WebGL renderer switch*: Rejected — different renderer has its own issues; canvas is the project default
- *Polling selection state*: Rejected — wasteful and adds complexity

**Migration notes**:
- The `Terminal` constructor API is unchanged between 5.x and 6.x
- `hasSelection()`, `getSelection()`, `paste()`, `attachCustomKeyEventHandler()` signatures are stable
- `allowProposedApi: true` option remains valid
- FitAddon `proposeDimensions()` return type unchanged
- No breaking type changes for current usage patterns

---

## R2: @xterm/addon-fit 0.10.0 → 0.11.0 Compatibility

**Decision**: Upgrade @xterm/addon-fit from ^0.10.0 to ^0.11.0 (paired with xterm 6.0.0)

**Rationale**: addon-fit 0.11.0 is the version aligned with xterm 6.0.0. The API surface used (`fit()`, `proposeDimensions()`) is unchanged.

**Alternatives considered**:
- *Keep addon-fit at 0.10.0*: Rejected — peer dependency mismatch with xterm 6.0.0 would produce install warnings and potential runtime issues

---

## R3: Copy Event Listener vs Direct Key Handler Approach

**Decision**: Move clipboard write directly into `attachCustomKeyEventHandler` callback; remove the separate `copy` event listener pattern.

**Rationale**: The current architecture uses a two-hop path:
1. Key handler returns `true` for Ctrl+C → allows native keyboard event to propagate
2. Native `copy` event fires on the terminal div
3. Copy event listener calls `hasSelection()`/`getSelection()` and writes to clipboard

This indirect path fails because:
- With xterm 5.5.0's canvas renderer bug, `hasSelection()` may return stale `false` by the time the copy event fires
- The timing gap between key-down and copy-event is non-deterministic
- The copy listener introduces unnecessary DOM event dependencies

The proven fix (validated in agency-cowork-main) is:
1. Key handler intercepts Ctrl+C at keydown
2. Immediately calls `hasSelection()` — returns accurate value with xterm 6.0.0
3. If selection exists: calls `getSelection()`, writes to clipboard, returns `false` (suppresses further handling)
4. If no selection: returns `true` (allows terminal SIGINT behavior)

**Alternatives considered**:
- *Keep copy listener + add retry logic*: Rejected — band-aid that doesn't eliminate the fundamental timing issue
- *Use xterm's built-in clipboard handling*: Rejected — doesn't give fine-grained control over SIGINT vs copy disambiguation

---

## R4: Clipboard API Strategy

**Decision**: Use `navigator.clipboard.writeText()` as primary, with `document.execCommand('copy')` textarea fallback for Electron contexts where the Clipboard API is unavailable.

**Rationale**: The existing `writeClipboardText()` helper already implements this dual strategy correctly in `SeriousTerminalController`. The same pattern should be reused in `TerminalOverlay` (which currently also has it in its copy listener). After refactoring, the helper remains but is called from the key handler instead of the copy listener.

**Alternatives considered**:
- *Electron clipboard module via IPC*: Rejected — adds IPC round-trip; navigator.clipboard works in renderer process
- *Only navigator.clipboard*: Rejected — may be blocked in some Electron security configurations

---

## R5: Scope of Removal (Copy Listener Infrastructure)

**Decision**: Remove from both `TerminalOverlay.ts` and `SeriousTerminalController.ts`:
- `attachTerminalCopyListener()` method
- `detachTerminalCopyListener()` method  
- `terminalCopyHandler` property
- All calls to `addEventListener('copy', ...)` and `removeEventListener('copy', ...)`

**Rationale**: With clipboard write moved into the key handler, the copy event listener is dead code. Its removal:
- Eliminates the timing-dependent two-hop path
- Removes ~40 lines per controller (listener setup, handler body, cleanup)
- Simplifies lifecycle management (no listener attach/detach on show/hide)

**Line count estimate**:
- TerminalOverlay.ts: ~30 lines (attachTerminalCopyListener + detachTerminalCopyListener + property + calls)
- SeriousTerminalController.ts: ~35 lines (same pattern + textarea fallback inline)
- Test updates: tests already expect direct key-handler behavior; copy listener tests become unnecessary

**Alternatives considered**:
- *Keep copy listener as fallback*: Rejected — creates confusion about which path actually handles copy; violates single-responsibility
