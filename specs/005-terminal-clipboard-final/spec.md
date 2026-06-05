# Spec 005: Terminal Clipboard, Final

**Status:** Drafted (branch: `005-terminal-clipboard-final`)
**Supersedes:** the copy paths from spec 002 (US3/C5), the IPC clipboard added as a 003 follow-up, and the rebuild in spec 004 (`004-rebuild-terminal-copy`).

## Why this exists (root-cause investigation)

Three prior attempts (specs 002, 003 follow-up, 004) all shipped “copy works” and all silently failed in real Electron. The deep dive turned up **two independent bugs** that compound and make the symptom look unfixable:

### Bug A — `success: true` on verification failure (smoking gun)

`electron/nonTerminalIpc.ts` writes to the OS clipboard, immediately reads it back, compares, and returns:

```ts
clipboard.writeText(text);
const verify = clipboard.readText();
const matched = verify === text;
return { success: true, verified: matched };   // ← success is hardcoded true
```

The renderer’s copy helper (`TerminalOverlay.copyToClipboard`, `SeriousTerminalController.copyToClipboard`) checks only `r?.success === true` and reports “copied” to the user. So whenever the write *appears* to succeed but the read-back doesn’t match, the app cheerfully toasts “copied” while the OS clipboard holds something else. The verification field we explicitly added to catch this case is being ignored.

### Bug B — selection is polled from event handlers instead of subscribed

Neither `TerminalOverlay` nor `SeriousTerminalController` subscribes to `terminal.onSelectionChange()`. Every copy path calls `terminal.hasSelection()` / `terminal.getSelection()` **synchronously inside an event handler** — the Ctrl+C key handler, the contextmenu listener, and (spec 004’s workaround) the right-mousedown capture listener. xterm 5.5 runs its own mouse/focus handlers in parallel on sibling DOM nodes, so any of these reads can race and observe an empty/stale selection depending on renderer (canvas vs WebGL), focus state, and event ordering. The “snapshot on right-mousedown” hack added in commit `7a84acc` did not fix this because the race is not strictly mousedown-ordered.

### Why prior fixes missed both

- No Playwright e2e ever drove the **full** copy flow against the real OS clipboard. Unit tests only asserted the mock bridge was called — they couldn’t catch Bug A or Bug B.
- Diagnostics were only `console.log`. The user (rightly) does not want to open DevTools every time, so failure modes were invisible.
- The team kept rewriting renderer code while the actual lying happened in the main process.

## What we will build

### UX (unchanged in shape from spec 004, fixed in substance)

1. **Ctrl+C** with a selection → copy via OS clipboard, suppress the keystroke. Without a selection → pass through to the PTY. (Copilot CLI does not treat Ctrl+C as SIGINT, so intercepting is safe.)
2. **Ctrl+V** → read OS clipboard, forward text to the PTY via `terminalWrite`.
3. **Right-click on the terminal** → small HTML context menu with **Copy** and **Paste**. Both items are always clickable. Copy noops + toasts when there is no selection; otherwise it copies the cached selection. Paste always pastes.
4. **In-app toast** is the single source of user feedback. It distinguishes:
   - `Copied N chars`
   - `Nothing selected to copy`
   - `Copy failed: clipboard verification mismatch`
   - `Copy failed: clipboard bridge unavailable`
   - `Pasted N chars`
   - `Paste failed: …`

### Implementation

#### Renderer (`src/ui/TerminalOverlay.ts` and `src/ui/SeriousTerminalController.ts`)

- **Selection cache subscription.** When the `Terminal` is created and before `.open()` is called, subscribe:
  ```ts
  this.cachedSelection = '';
  this.selectionDisposable = this.terminal.onSelectionChange(() => {
    this.cachedSelection = this.terminal.getSelection() ?? '';
  });
  ```
  The disposable is stored on a field and disposed in `destroy()` / `closeView()` / anywhere the terminal is recreated. The cache is reset to `''` on terminal teardown, agent switch, and serious-mode view close.
- **All copy paths read `this.cachedSelection`** — never `hasSelection()`/`getSelection()` from inside a handler. This eliminates Bug B.
- **Remove** the right-mousedown snapshot listener and the `lastRightClickSelection` field (superseded).
- **Context menu** stays HTML-based and absolutely positioned. Both items are always enabled visually; Copy uses cached selection and shows a toast if empty.
- **Toast** is a single shared helper (`showClipboardToast(message, kind)`) — small fixed-position element near the terminal, auto-dismisses after ~1.5 s. Implemented once in a helper module so both overlays use the same code.

#### Electron main (`electron/nonTerminalIpc.ts`)

- **Fix Bug A.** Verify-readback failure must return `success: false`:
  ```ts
  clipboard.writeText(text);
  const verify = clipboard.readText();
  const matched = verify === text;
  if (!matched) {
    console.warn('[Main/Clipboard] verify mismatch');
    return { success: false, verified: false, error: 'clipboard verification failed' };
  }
  return { success: true, verified: true };
  ```
- Trim the verbose diagnostic logging added in commit `7a84acc` down to one `console.warn` on failure.

#### Preload (`electron/terminal/preload.ts`)

- Type for `clipboardWriteText` already declares `success` + `error`. Add `verified?: boolean` to the return type so the renderer can read it for diagnostics in the toast.

#### Removals

- `lastRightClickSelection` field and the right-mousedown capture-phase snapshot listener in both files.
- The bulk of `console.log` diagnostic noise added in commit `7a84acc`.

## E2E coverage (the missing piece)

Add `tests/e2e/clipboard.spec.ts` (Playwright + electron-playwright):

1. Launch the Electron app.
2. Click into Gene’s terminal so it opens.
3. Type `hello clipboard 005` via `terminal.paste` *into the pty* (or use a shell prompt) so the text appears on a row.
4. Programmatically select via a test-only renderer hook: `window.__copilotOfficeE2E.selectTerminalText(startCol, startRow, length)` — exposed only when `process.env.E2E === '1'`. The hook calls `terminal.select(...)` and updates the cache.
5. Dispatch `Ctrl+C` via Playwright keyboard.
6. Read the OS clipboard via `electronApp.evaluate(({ clipboard }) => clipboard.readText())`.
7. Assert it equals the selected substring.
8. Negative test: with no selection, Ctrl+C must **not** overwrite the OS clipboard (pre-populate it with a sentinel and verify it survives).

Add a unit test for Bug B specifically: with the xterm mock, fire `onSelectionChange` with text `"abc"`, then immediately set `hasSelection()` to return false (simulating the race), then invoke the Ctrl+C path and assert `bridge.clipboardWriteText` was called with `"abc"`.

Add a unit test for Bug A: mock `bridge.clipboardWriteText` to return `{ success: true, verified: false }` and assert the toast shows the failure message rather than the success message.

## Acceptance

1. Real-world: select text in either terminal, press Ctrl+C, paste into Notepad → matches selection. Toast shows `Copied N chars`.
2. Real-world: right-click → menu appears with text still selected. Click Copy → paste in Notepad matches.
3. Real-world: with no selection, Ctrl+C is forwarded to the PTY; no toast, no clipboard mutation.
4. Real-world: Ctrl+V and right-click → Paste both insert clipboard text into the PTY.
5. Unit + e2e tests above all pass.
6. If the OS clipboard write fails verification, the toast says so — the app never lies again.

## Out of scope

- Copy-on-selection (auto-copy without Ctrl+C). Defer.
- Image / rich-text clipboard. Defer.
- Ctrl+Shift+V or any platform-conditional paste shortcut. Defer.
- Native Electron context menu via `webContents.on('context-menu')` — xterm’s canvas/WebGL selection is not exposed to Chromium’s `selectedText`, so this would not be simpler. Defer.

## Risks and fallbacks

- **Risk:** `onSelectionChange` does not fire under some xterm internal path. Mitigation: e2e and unit coverage will catch this immediately on the actual library version; if seen we add a defensive `hasSelection()` check as a *secondary* source that only fills the cache when non-empty (never overwrites a cached value with empty).
- **Risk:** the selection cache holds stale text after agent switch / view close. Mitigation: explicit reset in every teardown/switch path, plus a unit test for each.
- **Risk:** OS-level race where verify-readback briefly sees old contents. Mitigation: the IPC handler can retry once with a 5 ms delay before declaring failure, but only if real-world testing shows false negatives.

## Cleanup after merge

- Delete spec 004’s `console.log` diagnostics that we intentionally kept while spec 005 was open.
- Update root agent instruction’s “Regression-Prone Pitfalls” with the lesson: **subscribe to `onSelectionChange`; never poll xterm selection from inside event handlers; always honor verify-readback in clipboard IPC.**
