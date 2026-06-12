# Tasks: Fix Terminal Copy/Paste

**Input**: Design documents from `/specs/002-fix-terminal-copypaste/`
**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, quickstart.md ✓

**Tests**: Tests ARE requested (FR-010 requires updating existing tests; spec includes test files in scope).

**Organization**: Tasks grouped by user story to enable independent implementation and testing.

## Constitution-Driven Task Requirements

- [x] Terminal lifecycle validated — copy/paste across office switches and fleet/meeting modes verified
- [x] Input behavior unchanged — keyboard events still flow through registered xterm handler via `attachCustomKeyEventHandler`
- [x] Phaser-first constraint respected — terminal is DOM overlay; no canvas renderer changes
- [x] Regression validation — existing clipboard tests updated to confirm no recurrence
- [x] No new configuration surface — code simplification only

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (e.g., US1, US2, US3)
- Include exact file paths in descriptions

---

## Phase 1: Setup (xterm.js Upgrade — US5)

**Purpose**: Upgrade terminal dependencies to resolve the canvas renderer `hasSelection()` bug

- [ ] T001 [US5] Upgrade @xterm/xterm from ^5.5.0 to ^6.0.0 in package.json
- [ ] T002 [US5] Upgrade @xterm/addon-fit from ^0.10.0 to ^0.11.0 in package.json
- [ ] T003 [US5] Run `npm install` and verify no peer dependency conflicts or build errors
- [ ] T004 [US5] Verify application builds cleanly with `npm run build` after upgrade

**Checkpoint**: xterm 6.0.0 installed, application builds, `hasSelection()` returns accurate values

---

## Phase 2: Foundational (Test Infrastructure Updates)

**Purpose**: Update test mocks and infrastructure to align with xterm 6.0.0 APIs before modifying source code

**⚠️ CRITICAL**: Test infrastructure must be updated before implementation changes, or tests will fail for wrong reasons

- [ ] T005 Update xterm mock to reflect xterm 6.0.0 API surface in tests/setup/xterm-mock.ts
- [ ] T006 [P] Verify existing TerminalOverlay tests pass with updated mock in tests/integration/terminal/TerminalOverlay.test.ts
- [ ] T007 [P] Verify existing SeriousTerminalController tests pass with updated mock in tests/integration/terminal/SeriousTerminalController.test.ts

**Checkpoint**: All existing tests pass against xterm 6.0.0 mock — baseline established

---

## Phase 3: User Story 1 — Copy Selected Terminal Text (Priority: P1) 🎯 MVP

**Goal**: Ctrl+C with selection copies text directly via `hasSelection()`/`getSelection()` in the key handler; Ctrl+C without selection sends SIGINT

**Independent Test**: Select text in terminal → Ctrl+C → paste into external app → correct text appears. No selection → Ctrl+C → process interrupted.

### Tests for User Story 1

> **NOTE: Update existing tests to expect direct key-handler clipboard writes instead of copy event listener pattern**

- [ ] T008 [P] [US1] Update copy-with-selection test to verify `hasSelection()` + `getSelection()` + `writeClipboardText()` called directly in key handler in tests/integration/terminal/TerminalOverlay.test.ts
- [ ] T009 [P] [US1] Update copy-without-selection test to verify handler returns true (SIGINT passthrough) in tests/integration/terminal/TerminalOverlay.test.ts
- [ ] T010 [P] [US1] Update copy-with-selection test for SeriousTerminalController key handler in tests/integration/terminal/SeriousTerminalController.test.ts
- [ ] T011 [P] [US1] Update copy-without-selection test for SeriousTerminalController key handler in tests/integration/terminal/SeriousTerminalController.test.ts

### Implementation for User Story 1

- [ ] T012 [US1] Rewrite Ctrl+C/Cmd+C handling in custom key handler to call `hasSelection()` → `getSelection()` → `writeClipboardText()` directly and return false in src/ui/TerminalOverlay.ts
- [ ] T013 [US1] Rewrite Ctrl+C/Cmd+C handling in custom key handler to call `hasSelection()` → `getSelection()` → `writeClipboardText()` directly and return false in src/ui/SeriousTerminalController.ts
- [ ] T014 [US1] Ensure handler returns true when `hasSelection()` is false (preserving SIGINT) in src/ui/TerminalOverlay.ts
- [ ] T015 [US1] Ensure handler returns true when `hasSelection()` is false (preserving SIGINT) in src/ui/SeriousTerminalController.ts
- [ ] T016 [US1] Run tests to confirm copy tests pass: `npx vitest run tests/integration/terminal/`

**Checkpoint**: Copy via Ctrl+C works directly from key handler in both controllers. SIGINT preserved when no selection.

---

## Phase 4: User Story 2 — Paste into Terminal (Priority: P1)

**Goal**: Ctrl+V reads system clipboard and writes to terminal PTY via `terminal.paste()`

**Independent Test**: Copy text from external app → focus terminal → Ctrl+V → text appears at cursor in terminal.

### Tests for User Story 2

- [ ] T017 [P] [US2] Update paste test to verify clipboard read + `terminal.paste()` call in key handler in tests/integration/terminal/TerminalOverlay.test.ts
- [ ] T018 [P] [US2] Update paste test to verify clipboard read + `terminal.paste()` call in key handler in tests/integration/terminal/SeriousTerminalController.test.ts
- [ ] T019 [P] [US2] Add test for empty clipboard paste (no error, no crash) in tests/integration/terminal/TerminalOverlay.test.ts

### Implementation for User Story 2

- [ ] T020 [US2] Verify Ctrl+V/Cmd+V handling in key handler calls `preventDefault()`, `stopPropagation()`, reads clipboard, and calls `terminal.paste()` in src/ui/TerminalOverlay.ts
- [ ] T021 [US2] Verify Ctrl+V/Cmd+V handling in key handler calls `preventDefault()`, `stopPropagation()`, reads clipboard, and calls `terminal.paste()` in src/ui/SeriousTerminalController.ts
- [ ] T022 [US2] Handle empty/null clipboard gracefully (no-op, no error thrown) in both controllers
- [ ] T023 [US2] Run tests to confirm paste tests pass: `npx vitest run tests/integration/terminal/`

**Checkpoint**: Paste via Ctrl+V works in both controllers. Multi-line and empty clipboard handled gracefully.

---

## Phase 5: User Story 4 — Removal of Caching Infrastructure (Priority: P2)

**Goal**: All legacy copy event listener code is deleted. Zero references to caching identifiers remain.

**Independent Test**: `grep -r "cachedSelection\|onSelectionChange\|terminalCopyHandler\|attachTerminalCopyListener\|detachTerminalCopyListener\|nativeCopyPreempt\|liveSelection" src/` returns zero matches.

### Tests for User Story 4

- [ ] T024 [P] [US4] Remove or update any test cases that assert copy event listener attachment/detachment behavior in tests/integration/terminal/TerminalOverlay.test.ts
- [ ] T025 [P] [US4] Remove or update any test cases that assert copy event listener attachment/detachment behavior in tests/integration/terminal/SeriousTerminalController.test.ts

### Implementation for User Story 4

- [ ] T026 [P] [US4] Remove `attachTerminalCopyListener()` method from src/ui/TerminalOverlay.ts
- [ ] T027 [P] [US4] Remove `detachTerminalCopyListener()` method from src/ui/TerminalOverlay.ts
- [ ] T028 [P] [US4] Remove `terminalCopyHandler` property from src/ui/TerminalOverlay.ts
- [ ] T029 [P] [US4] Remove all `addEventListener('copy', ...)` and `removeEventListener('copy', ...)` calls from src/ui/TerminalOverlay.ts
- [ ] T030 [P] [US4] Remove `attachTerminalCopyListener()` method from src/ui/SeriousTerminalController.ts
- [ ] T031 [P] [US4] Remove `detachTerminalCopyListener()` method from src/ui/SeriousTerminalController.ts
- [ ] T032 [P] [US4] Remove `terminalCopyHandler` property from src/ui/SeriousTerminalController.ts
- [ ] T033 [P] [US4] Remove all `addEventListener('copy', ...)` and `removeEventListener('copy', ...)` calls from src/ui/SeriousTerminalController.ts
- [ ] T034 [US4] Remove any remaining references to cachedSelection, nativeCopyPreempt, liveSelection, or mouseup belt from both controllers
- [ ] T035 [US4] Run full test suite to confirm no regressions: `npx vitest run tests/integration/terminal/`
- [ ] T036 [US4] Verify zero matches: search codebase for removed identifiers (cachedSelection, terminalCopyHandler, attachTerminalCopyListener, detachTerminalCopyListener, nativeCopyPreempt, liveSelection)

**Checkpoint**: All caching infrastructure removed. Codebase reduced by ~250+ lines. All tests pass.

---

## Phase 6: User Story 3 — Context Menu Copy/Paste (Priority: P2)

**Goal**: Right-click context menu Copy uses direct `hasSelection()`/`getSelection()`; Paste reads clipboard and calls `terminal.paste()`

**Independent Test**: Right-click terminal → select Copy → paste into external app → correct text. Right-click → Paste → clipboard content appears in terminal.

### Implementation for User Story 3

- [ ] T037 [P] [US3] Update context menu Copy handler to use direct `hasSelection()`/`getSelection()` + `writeClipboardText()` (same as key handler path) in src/ui/TerminalOverlay.ts
- [ ] T038 [P] [US3] Update context menu Copy handler to use direct approach in src/ui/SeriousTerminalController.ts
- [ ] T039 [P] [US3] Ensure context menu Copy is disabled/hidden when `hasSelection()` returns false in both controllers
- [ ] T040 [US3] Verify context menu Paste uses clipboard read + `terminal.paste()` (consistent with Ctrl+V path) in both controllers
- [ ] T041 [US3] Run tests to confirm no regressions: `npx vitest run tests/integration/terminal/`

**Checkpoint**: Context menu Copy/Paste works using same direct-query approach as keyboard shortcuts.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, cleanup, and cross-mode verification

- [ ] T042 [P] Verify `writeClipboardText()` helper uses navigator.clipboard.writeText with execCommand fallback in both controllers
- [ ] T043 Run full project build: `npm run build`
- [ ] T044 Run complete test suite: `npx vitest run`
- [ ] T045 [P] Verify copy/paste works across office switch (terminal lifecycle transition)
- [ ] T046 [P] Verify copy/paste works in fleet mode terminal
- [ ] T047 [P] Verify copy/paste works in meeting mode terminal
- [ ] T048 Run quickstart.md manual verification checklist

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately
- **Foundational (Phase 2)**: Depends on Phase 1 (xterm 6.0.0 must be installed)
- **US1 Copy (Phase 3)**: Depends on Phase 2 (test mocks must be updated)
- **US2 Paste (Phase 4)**: Depends on Phase 2 — can run in parallel with Phase 3
- **US4 Removal (Phase 5)**: Depends on Phase 3 + Phase 4 (new handlers must be in place before removing old infrastructure)
- **US3 Context Menu (Phase 6)**: Depends on Phase 5 (caching removed, direct approach established)
- **Polish (Phase 7)**: Depends on all prior phases

### User Story Dependencies

- **US5 (xterm upgrade)**: No story dependencies — Setup phase
- **US1 (Copy)**: Depends on US5 (needs xterm 6.0.0 `hasSelection()` fix)
- **US2 (Paste)**: Depends on US5 — Independent of US1 (different key handler branch)
- **US4 (Removal)**: Depends on US1 + US2 (new handlers replace the old code)
- **US3 (Context Menu)**: Depends on US4 (uses same simplified pattern post-removal)

### Within Each User Story

- Tests updated FIRST to define expected behavior
- Implementation follows test expectations
- Verification run after each story completes

### Parallel Opportunities

- **Phase 1**: T001 + T002 can be done in single package.json edit
- **Phase 2**: T006 + T007 run in parallel (different test files)
- **Phase 3**: T008–T011 all parallel (different test assertions in different files)
- **Phase 4**: T017–T019 all parallel (different test files)
- **Phase 5**: T026–T033 all parallel (removing from different files/methods)
- **Phase 6**: T037–T039 all parallel (different files)
- **Phase 7**: T045–T047 all parallel (different mode verifications)

---

## Parallel Example: User Story 1 (Copy)

```bash
# Launch all test updates in parallel:
Task: "Update copy-with-selection test in TerminalOverlay.test.ts"
Task: "Update copy-without-selection test in TerminalOverlay.test.ts"
Task: "Update copy-with-selection test in SeriousTerminalController.test.ts"
Task: "Update copy-without-selection test in SeriousTerminalController.test.ts"

# Then implementation (TerminalOverlay and SeriousTerminalController can be parallel):
Task: "Rewrite Ctrl+C handling in TerminalOverlay.ts"
Task: "Rewrite Ctrl+C handling in SeriousTerminalController.ts"
```

## Parallel Example: User Story 4 (Removal)

```bash
# All removals can be parallel (different methods in different files):
Task: "Remove attachTerminalCopyListener from TerminalOverlay.ts"
Task: "Remove detachTerminalCopyListener from TerminalOverlay.ts"
Task: "Remove terminalCopyHandler from TerminalOverlay.ts"
Task: "Remove attachTerminalCopyListener from SeriousTerminalController.ts"
Task: "Remove detachTerminalCopyListener from SeriousTerminalController.ts"
Task: "Remove terminalCopyHandler from SeriousTerminalController.ts"
```

---

## Implementation Strategy

### MVP First (US5 + US1 + US2 Only)

1. Complete Phase 1: xterm.js upgrade (US5)
2. Complete Phase 2: Test mock updates
3. Complete Phase 3: Copy works directly (US1)
4. Complete Phase 4: Paste works directly (US2)
5. **STOP and VALIDATE**: Copy/paste both work via keyboard shortcuts
6. This alone fixes the user-facing bug

### Incremental Delivery

1. Setup + Foundational → xterm 6.0.0 installed, tests pass
2. Add US1 (Copy) → Test independently → Core bug fixed!
3. Add US2 (Paste) → Test independently → Full keyboard clipboard
4. Add US4 (Removal) → Verify no caching remains → Codebase simplified
5. Add US3 (Context Menu) → Test independently → Complete feature
6. Polish → Cross-mode verification → Ship

### Risk Mitigation

- US5 upgrade is lowest-risk (API surface stable per research.md)
- US1 + US2 can be validated with manual testing immediately
- US4 removal is safe AFTER new handlers are proven working
- US3 is additive and can be deferred without blocking the fix

---

## Notes

- [P] tasks = different files, no dependencies
- [Story] label maps task to specific user story for traceability
- The primary bug fix is complete after Phase 4 (MVP scope)
- Phase 5 (removal) is cleanup that prevents regression
- Phase 6 (context menu) is quality-of-life improvement
- Commit after each phase for clean revert points
- ~100 lines changed per controller (plan.md estimate); ~320 lines removed total
