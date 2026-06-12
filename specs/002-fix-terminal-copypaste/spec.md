# Feature Specification: Fix Terminal Copy/Paste

**Feature Branch**: `002-fix-terminal-copypaste`  
**Created**: 2026-06-12  
**Status**: Draft  
**Input**: User description: "Permanently fix terminal copy/paste by upgrading xterm.js from 5.5.0 to 6.0.0 and replacing the broken 320-line caching infrastructure with agency-cowork-main's proven simple approach"

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Copy Selected Terminal Text (Priority: P1)

A user selects text in the terminal (via mouse drag or double-click word selection) and presses Ctrl+C (or Cmd+C on macOS). The selected text is immediately copied to the system clipboard without requiring any intermediate caching or event listeners.

**Why this priority**: Copy is the most fundamental clipboard operation. If users cannot reliably copy terminal output, they cannot extract command results, error messages, or any useful information from agent sessions.

**Independent Test**: Can be fully tested by selecting text in a terminal, pressing the copy shortcut, and pasting into any external application to confirm the correct text was captured.

**Acceptance Scenarios**:

1. **Given** text is selected in the terminal, **When** user presses Ctrl+C, **Then** the selected text is copied to the system clipboard and available for pasting elsewhere
2. **Given** text is selected in the terminal via double-click (word selection), **When** user presses Ctrl+C, **Then** the entire word is copied to the system clipboard
3. **Given** no text is selected in the terminal, **When** user presses Ctrl+C, **Then** the SIGINT signal is sent to the running process (standard terminal behavior preserved)
4. **Given** text is selected in the terminal, **When** user presses Ctrl+C, **Then** the selection query happens synchronously at handler invocation time (no caching, no stale state)

---

### User Story 2 - Paste into Terminal (Priority: P1)

A user presses Ctrl+V (or Cmd+V on macOS) to paste clipboard content into the active terminal session. The content is written to the PTY immediately.

**Why this priority**: Paste is equally critical for productivity — users paste commands, file paths, and configuration values into terminals constantly.

**Independent Test**: Can be fully tested by copying text from an external source, focusing the terminal, pressing the paste shortcut, and confirming the text appears at the cursor.

**Acceptance Scenarios**:

1. **Given** the terminal is focused and clipboard contains text, **When** user presses Ctrl+V, **Then** clipboard text is written to the terminal PTY
2. **Given** the terminal is focused and clipboard contains multi-line text, **When** user presses Ctrl+V, **Then** all lines are written to the PTY preserving line breaks
3. **Given** the terminal is focused and clipboard is empty, **When** user presses Ctrl+V, **Then** nothing happens (no error, no crash)

---

### User Story 3 - Context Menu Copy/Paste (Priority: P2)

A user right-clicks the terminal to access copy and paste options via a context menu. Copy uses the current selection; paste uses the system clipboard.

**Why this priority**: Context menu provides discoverability and an alternative input method, but keyboard shortcuts are the primary interaction path.

**Independent Test**: Can be fully tested by right-clicking the terminal, selecting Copy/Paste from the menu, and verifying clipboard operations complete correctly.

**Acceptance Scenarios**:

1. **Given** text is selected in the terminal, **When** user right-clicks and selects "Copy", **Then** the selected text is copied to the system clipboard
2. **Given** no text is selected, **When** user right-clicks, **Then** the "Copy" option is disabled or hidden
3. **Given** clipboard has content, **When** user right-clicks and selects "Paste", **Then** clipboard content is written to the terminal PTY

---

### User Story 4 - Removal of Caching Infrastructure (Priority: P2)

The existing broken caching infrastructure (cachedSelection, onSelectionChange listener, mouseup belt, nativeCopyPreempt flag, liveSelection tracking) is completely removed. The codebase is simplified to use direct xterm API calls.

**Why this priority**: The caching code is the root cause of copy/paste failures. Its removal eliminates the bug class entirely and reduces maintenance burden by ~320 lines.

**Independent Test**: Can be verified by confirming no references to cachedSelection, onSelectionChange, mouseup belt, nativeCopyPreempt, or liveSelection remain in the codebase, and all clipboard tests pass.

**Acceptance Scenarios**:

1. **Given** the codebase after this change, **When** searching for caching infrastructure identifiers, **Then** zero matches are found
2. **Given** the simplified clipboard handler, **When** copy is triggered, **Then** it calls hasSelection()/getSelection() directly on the xterm instance at invocation time
3. **Given** the simplified clipboard handler, **When** the terminal selection state changes, **Then** no background listener tracks or caches the selection

---

### User Story 5 - xterm.js 6.0.0 Upgrade (Priority: P1)

The terminal library is upgraded from xterm.js 5.5.0 to 6.0.0, along with the fit addon from 0.10.0 to 0.11.0. This resolves the canvas renderer bug where hasSelection() returns stale false values.

**Why this priority**: The upgrade is a prerequisite for the simple approach to work reliably. Without it, hasSelection() cannot be trusted, which is why the caching infrastructure was originally built.

**Independent Test**: Can be verified by confirming package.json lists the new versions, the application builds without errors, and hasSelection() returns accurate values immediately after selection.

**Acceptance Scenarios**:

1. **Given** the upgraded packages, **When** the application builds, **Then** no compilation errors or type mismatches occur
2. **Given** a user selects text in the terminal (canvas renderer), **When** hasSelection() is called immediately, **Then** it returns true (not stale false)
3. **Given** the upgraded xterm.js, **When** the terminal renders, **Then** visual appearance and behavior are identical to the prior version

---

### Edge Cases

- What happens when the terminal is not focused but user triggers a global copy shortcut? The operation should be ignored or handled by whatever element has focus.
- What happens when selection spans multiple terminal lines with line wrapping? The full logical content should be copied, unwrapping soft line breaks.
- What happens when clipboard access is denied by the browser/Electron permissions? A graceful error should be shown or the operation should silently fail without crashing.
- What happens during rapid successive copy operations? Each should independently query the current selection state.
- What happens if the user selects text and then the terminal scrolls (new output)? The selection may be invalidated by xterm.js itself; the handler should gracefully return empty/no-op.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST upgrade @xterm/xterm from ^5.5.0 to ^6.0.0
- **FR-002**: System MUST upgrade @xterm/addon-fit from ^0.10.0 to ^0.11.0
- **FR-003**: System MUST remove all selection caching code (cachedSelection variable, onSelectionChange listener, mouseup event belt, nativeCopyPreempt flag, liveSelection tracking)
- **FR-004**: System MUST implement copy by calling terminal.hasSelection() and terminal.getSelection() directly inside the custom key handler at invocation time
- **FR-005**: System MUST send SIGINT when Ctrl+C is pressed with no active selection
- **FR-006**: System MUST implement paste by reading from the system clipboard and writing to the terminal PTY
- **FR-007**: System MUST provide context menu items for Copy and Paste that use the same direct-query approach
- **FR-008**: System MUST preserve existing copyToClipboard and pasteFromClipboardToTerminal utility functions (simplified implementation)
- **FR-009**: System MUST maintain all existing keyboard shortcut bindings (Ctrl+C, Ctrl+V, Cmd+C, Cmd+V)
- **FR-010**: System MUST update existing tests to reflect the simplified architecture

### Key Entities

- **Terminal Instance**: The xterm.js Terminal object that provides hasSelection(), getSelection(), and selection event APIs
- **Custom Key Handler**: The xterm attachCustomKeyEventHandler callback that intercepts keyboard shortcuts before they reach the PTY
- **Clipboard Utilities**: The copyToClipboard and pasteFromClipboardToTerminal helper functions used by both keyboard and context menu paths

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Copy operation succeeds on first attempt 100% of the time when text is selected (zero stale-state failures)
- **SC-002**: Copy/paste latency is imperceptible to users (under 100ms from keypress to clipboard write)
- **SC-003**: Codebase related to clipboard handling is reduced by at least 250 lines (from ~320 lines of caching infrastructure)
- **SC-004**: All existing terminal clipboard tests pass after migration
- **SC-005**: Zero regression in terminal rendering, scrolling, or input behavior after xterm upgrade
- **SC-006**: Copy/paste works identically across all terminal instances in the application (agent terminals, fleet terminals, meeting terminals)

## Assumptions

- The xterm.js 6.0.0 upgrade does not introduce breaking API changes beyond the selection fix (only canvas renderer bug fix is relevant)
- The @xterm/addon-fit 0.11.0 is compatible with @xterm/xterm 6.0.0
- The Electron clipboard API (navigator.clipboard or electron clipboard module) is available and does not require special permissions configuration
- The agency-cowork-main pattern of direct hasSelection()/getSelection() calls has been validated as working correctly with xterm 6.0.0
- Existing test infrastructure can be adapted to test the simplified approach without requiring new testing frameworks
- The canvas renderer is the active renderer (not WebGL or DOM fallback)

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: This change does not affect Phaser rendering. The terminal is a DOM overlay element in the split layout model. xterm.js upgrade affects only the terminal DOM container, preserving the Phaser-first rendering principle.
- **Event & Input Boundary**: The custom key handler is the established input interception point for the terminal. The simplified approach maintains this pattern — keyboard events still flow through the registered handler. InputManager focus transitions are unaffected since the terminal focus model does not change.
- **Session Integrity Impact**: Copy/paste operations are purely UI-level clipboard interactions. They do not affect the PTY session, IPC channels, or agent lifecycle. The terminal session pipeline (renderer → preload bridge → Electron main → terminal server → PTY) is not modified. Only the pre-PTY keyboard interception layer changes.
- **Configuration Impact**: No configuration or schema changes required. The fix is a code simplification that removes unnecessary infrastructure without introducing new configuration surface.
- **Regression Plan**: Existing terminal clipboard tests must be updated and pass. Manual verification of copy/paste across office switches and fleet/meeting modes is required since these flows involve terminal lifecycle transitions. The xterm upgrade should be verified against all terminal instantiation paths.
