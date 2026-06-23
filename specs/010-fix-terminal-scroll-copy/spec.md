# Feature Specification: Fix Terminal Scrolling & Scrollbar Copy Interference

**Feature Branch**: `010-fix-terminal-scroll-copy`  
**Created**: 2026-06-16  
**Status**: Draft  
**Input**: User description: "Fix the scrolling — I cannot scroll within a terminal right now. Also there is a bar on the right side of the terminal that is being copied and that messes with commands."

## Problem Statement

Two related bugs affect the terminal experience:

### Bug A — Terminal scroll is broken
Users cannot scroll within the xterm.js terminal. The viewport does not respond to mouse wheel or keyboard-based scrolling (Shift+PageUp/Down). Both `TerminalOverlay` (game mode) and `SeriousTerminalController` (serious mode) are affected.

Root cause investigation areas:
- `TerminalOverlay` styles set `.xterm-viewport { background-color: ... }` but do NOT set `overflow-y: auto` (line 1202–1204 of `TerminalOverlay.ts`). The xterm viewport may be inheriting `overflow: hidden` from the parent `#terminal-container` (line 746).
- `SeriousTerminalController` does set `.xterm-viewport { overflow-y: auto !important; }` (line 915) but the terminal outer wrapper has `overflow: hidden` (line 134). The xterm styles element (`id="xterm-styles"`) is created by whichever controller runs first — the second one's `ensureXtermStyles()` early-returns if the element already exists, meaning game-mode styles can clobber serious-mode styles or vice versa.
- Mouse mode suppression (CSI handler intercepting modes 1000/1002/1003/1006) may be accidentally swallowing scroll-related escape sequences.

### Bug B — Scrollbar element leaks into clipboard
A visible bar on the right side of the terminal (likely the xterm scrollbar track or an OS-rendered scrollbar overlay) is being included when the user selects and copies terminal content. The copied text includes scrollbar UI artifacts, which corrupts pasted commands.

Root cause investigation areas:
- The xterm-viewport's scrollbar is a native browser scrollbar. When the user drags to select text, the browser's DOM selection can include the scrollbar gutter or scrollbar-adjacent DOM nodes.
- Per Constitution VI, copy paths cascade through `cachedSelection` → `terminal.getSelection()` → `window.getSelection().toString()` scoped to the terminal container. The DOM selection fallback (`window.getSelection()`) may be picking up text from scrollbar-adjacent elements or xterm's accessibility layer that includes scrollbar metadata.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Scroll through terminal output (Priority: P1)

As a user interacting with a Copilot agent, I need to scroll up through previous output to read earlier responses, review errors, or reference code that has scrolled past the visible area.

**Why this priority**: Without scrolling, long agent responses are inaccessible — the terminal is effectively a "latest-N-lines-only" window, making it impossible to review context.

**Independent Test**: Open a terminal, run a command that produces 100+ lines, attempt to scroll up with mouse wheel and verify content is accessible.

**Acceptance Scenarios**:

1. **Given** a terminal with 100+ lines of output, **When** the user scrolls up with the mouse wheel, **Then** previous output lines become visible and the viewport scrolls smoothly.
2. **Given** a terminal with scrollback content, **When** the user scrolls down past the last line, **Then** the viewport snaps back to the live cursor position.
3. **Given** the terminal in either game mode (TerminalOverlay) or serious mode (SeriousTerminalController), **When** the user scrolls, **Then** behavior is identical in both modes.

---

### User Story 2 — Copy terminal text without scrollbar artifacts (Priority: P1)

As a user copying commands or output from the terminal, I need the copied text to be clean — no scrollbar UI characters or invisible artifacts that would break a pasted command.

**Why this priority**: Corrupted clipboard content means users paste broken commands, which is confusing and wastes time. This is a P1 because it actively sabotages workflow.

**Independent Test**: Select text in the terminal, Ctrl+C, paste into Notepad — the pasted text must match exactly what was visually highlighted, with no extra characters from the scrollbar.

**Acceptance Scenarios**:

1. **Given** a terminal with a visible scrollbar, **When** the user selects text near the right edge and copies with Ctrl+C, **Then** the clipboard contains only the terminal text, with no scrollbar artifacts.
2. **Given** a terminal with a visible scrollbar, **When** the user right-clicks → Copy, **Then** the clipboard contains only terminal text.
3. **Given** text was copied from the terminal, **When** the user pastes into an external editor, **Then** the pasted text is identical to the visible selection.

---

### User Story 3 — Scrollbar visual styling (Priority: P2)

As a user, the scrollbar on the right side of the terminal should either blend with the terminal theme or be hidden entirely (using xterm's scroll-on-wheel without a visible track).

**Why this priority**: Cosmetic, but the visible scrollbar is the source of the copy corruption. Hiding or replacing the native scrollbar with a themed CSS-only scrollbar eliminates the copy problem at the source.

**Independent Test**: Open a terminal, verify the scrollbar area does not display a visually jarring native OS scrollbar. If visible, it should match the terminal's dark theme.

**Acceptance Scenarios**:

1. **Given** a terminal with scrollback content, **When** the user views the terminal, **Then** no bright/OS-native scrollbar is visible — either hidden entirely or styled to match the terminal dark theme.

---

### Edge Cases

- What happens when terminal output exactly fills the viewport (no scrollback yet)? Scrollbar should not appear.
- What happens when the user is scrolled up and new output arrives? Terminal should auto-scroll to bottom only if the user was already at the bottom; if scrolled up, hold position and optionally show a "new output" indicator.
- What happens when the user selects text that spans above/below the visible viewport? Selection should extend into scrollback.
- What happens when the terminal is resized (e.g., window resize triggers `fitAddon.fit()`)? Scroll position should be preserved.
- Does hiding the scrollbar affect accessibility (screen reader scrollback navigation)?

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Terminal MUST support mouse wheel scrolling through scrollback buffer in both TerminalOverlay and SeriousTerminalController.
- **FR-002**: Terminal MUST support keyboard scrolling (Shift+PageUp/Down) through scrollback buffer.
- **FR-003**: Copied terminal text MUST NOT include any characters or artifacts from the scrollbar UI element.
- **FR-004**: All existing clipboard functionality (Ctrl+C copy, Ctrl+V paste, right-click context menu Copy/Paste) MUST continue to work per Constitution VI and spec 005.
- **FR-005**: The `cachedSelection` → `terminal.getSelection()` → `window.getSelection()` cascade MUST exclude any scrollbar DOM nodes from the scoped selection.
- **FR-006**: Both terminal surfaces (TerminalOverlay and SeriousTerminalController) MUST be updated in the same change per Constitution VI rule 4.
- **FR-007**: The native browser scrollbar SHOULD be hidden or CSS-styled to prevent it from contributing DOM content to text selections.

### Key Entities

- **xterm-viewport**: The xterm.js internal `<div>` that wraps the terminal screen and provides native scroll. Its `overflow-y` style controls whether scrolling works and whether a scrollbar renders.
- **xterm-screen**: The xterm.js internal `<div>` containing rendered terminal rows. Selection events originate here.
- **cachedSelection**: Field on both TerminalOverlay and SeriousTerminalController that caches the last `onSelectionChange` value, per spec 005.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Users can scroll through 10,000 lines of scrollback in both terminal modes using mouse wheel.
- **SC-002**: Ctrl+C copy from any terminal region produces text that, when pasted, matches the visual selection exactly — verified by comparing clipboard content character-by-character.
- **SC-003**: No regressions in existing clipboard unit tests (`tests/unit/`) or e2e tests (`tests/e2e/`).
- **SC-004**: The xterm-styles element correctly applies to whichever terminal surface is active, without the first-created element blocking the second surface's styles.

## Assumptions

- The scrollbar artifact in copied text comes from the native browser scrollbar's DOM presence inside the xterm container, not from xterm's internal selection model (`terminal.getSelection()`).
- xterm.js `scrollback: 10000` is already configured in both surfaces and does not need to change.
- The mouse mode suppression (CSI handler for modes 1000/1002/1003/1006) is not the cause of the scroll bug — it intercepts DECSET sequences from the PTY, not user-initiated scroll events.
- Hiding the native scrollbar via CSS (`::-webkit-scrollbar` or `scrollbar-width: none`) will not break xterm's internal scroll tracking, which uses `scrollTop` programmatically.

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: No Phaser changes. All work is in DOM overlays (terminal containers) which are already outside the Phaser canvas per Principle I.
- **Event & Input Boundary**: No InputManager changes. Scroll events are handled by xterm.js internally. Clipboard keybindings remain unchanged per spec 005. Principle II preserved.
- **Session Integrity Impact**: No changes to PTY lifecycle, session attach/detach, or IPC channels. Principle III unaffected.
- **Configuration Impact**: No config/schema changes. The fix is CSS and potentially xterm `Terminal` options. Principle V unaffected.
- **Regression Plan**:
  - Run `npm run test` — all existing clipboard and terminal unit tests must pass.
  - Run `npm run test:e2e` — smoke and clipboard e2e tests must pass.
  - Manual verification: select text near the right edge of terminal → Ctrl+C → paste in Notepad → no artifacts.
  - Manual verification: scroll up in a terminal with 100+ lines → content is visible and scrolls smoothly.
  - Verify both TerminalOverlay AND SeriousTerminalController (Constitution VI rule 4).

## Implementation Hints

### Scroll fix
- Ensure `.xterm-viewport { overflow-y: auto !important; }` is applied in BOTH terminal surfaces' style blocks, not just SeriousTerminalController.
- Resolve the shared `xterm-styles` element conflict: both `ensureXtermStyles()` functions use `id="xterm-styles"` and the second one early-returns. Either merge into one shared style block, or use distinct IDs per surface.
- Check that parent containers (`overflow: hidden`) are not clipping the xterm-viewport's scrollable area. The `overflow: hidden` on the outer wrapper should only clip the container boundary, not prevent xterm's internal viewport scroll.

### Scrollbar copy fix
- Hide the native scrollbar with CSS while preserving scroll functionality:
  ```css
  .xterm-viewport::-webkit-scrollbar { width: 0; height: 0; }
  .xterm-viewport { scrollbar-width: none; } /* Firefox */
  ```
- This eliminates the scrollbar from the DOM layout entirely, so `window.getSelection()` cannot include it.
- Alternatively, if a visible scrollbar is desired, use CSS custom scrollbar styling to ensure it renders as a pseudo-element that does not participate in text selection.

### Clipboard preservation
- The `cachedSelection` path (xterm's `onSelectionChange()`) should be unaffected since xterm's selection model is independent of DOM scrollbar rendering.
- The `window.getSelection()` fallback in the cascade should scope its `anchorNode`/`focusNode` check to exclude any scrollbar-related DOM nodes (though hiding the scrollbar likely eliminates this issue entirely).

## Out of Scope

- Custom-themed scrollbar with position indicators or overview ruler. Defer.
- Touchpad/trackpad scroll physics tuning. Defer.
- "New output below" indicator when user is scrolled up. Defer.
- Horizontal scrolling or line wrapping changes. Defer.
