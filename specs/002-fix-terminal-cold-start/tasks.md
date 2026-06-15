---

description: "Implementation tasks for fix-terminal-cold-start (002)"
---

# Tasks: Fix Terminal Cold-Start Bugs

**Input**: Design documents from `/specs/002-fix-terminal-cold-start/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/terminal-protocol.md, quickstart.md

**Tests**: The spec explicitly requires smoke tests (FR-010/FR-011, User Story 5/aka 4). Test tasks are INCLUDED below.

**Organization**: Tasks are grouped by user story. User stories from spec.md are:

- **US1 (P1)**: Each agent gets its own working terminal at cold start (distinct sessionIds + responsive input)
- **US2 (P1)**: Startup status reflects what actually happened (no false "Startup timed out")
- **US3 (P2)**: Copy selected text from an agent terminal
- **US4 (P2)**: Regression-proof smoke tests for default-office cold start

## Constitution-Driven Task Requirements

- All input behavior changes verified via `InputManager`-based focus transitions (US1 tasks).
- Terminal/session lifecycle changes carry regression tests for office switch and meeting/fleet continuity (polish phase task).
- No Phaser renderer changes; no config schema changes (renderer iterates existing `AGENTS` roster instead of hardcoded slice).
- Logging additions are forensic and protocol-compatible (no IPC shape changes).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no dependency on incomplete tasks → safe to run in parallel
- **[Story]**: US1, US2, US3, US4 — omitted for Setup, Foundational, Polish

## Path Conventions

Single-project Electron desktop layout (already in place). Production code under `src/` and `electron/`. Tests under `tests/integration/terminal/` and `tests/e2e/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm baseline and prepare a clean reproduction environment.

- [X] T001 Verify `npm install` is clean and `npm run build` succeeds against the worktree HEAD before any code changes, to establish a green baseline (capture build output to local notes — no file changes).
- [X] T002 [P] Snapshot current `.data/copilot-offices.json` and `.data/office-0.sessions.json` into `specs/002-fix-terminal-cold-start/baseline/` (gitignored if needed) so post-fix behavior can be compared against the pre-fix on-disk state.
- [X] T003 [P] Reproduce the three bugs locally by wiping `.data/` and walking through `specs/002-fix-terminal-cold-start/quickstart.md` § 1; record the exact symptom observed for each of US1, US2, US3 in a short note under `specs/002-fix-terminal-cold-start/baseline/repro-notes.md`. This is the pre-fix evidence.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Forensic logging and shared test helpers that every user story implementation will rely on.

**⚠️ CRITICAL**: Must complete before any of US1–US4 implementation begins.

- [X] T004 Add the four optional forensic log lines from `specs/002-fix-terminal-cold-start/contracts/terminal-protocol.md` § "Optional additive log lines" — gate them behind a single boolean `DEBUG_COLD_START` constant at top of `electron/terminal/server.ts` and `src/scenes/OfficeScene.ts` so they can be turned off without code edits. Concretely: `[OfficeScene] preStart agent=…`, `[TerminalOverlay] switch from=… to=…`, `[Office] Agent X stuck in starting past timeout but PTY alive — recovering to ready`, `[TermServer] Repaired duplicate sessionId for officeId=… agentId=… from=… to=…`.
- [X] T005 [P] Create `tests/integration/terminal/_helpers/coldStartHarness.ts` exposing: (a) `withTempDataDir()` that points `.data/` at a `os.tmpdir()` location for the duration of one test; (b) `mockTerminalBackend()` returning a fake `terminalBackend` whose `start()` resolves immediately with a unique pid; (c) `seedOfficeSessions(officeId, map)` helper to write a pre-populated sessions file. No production code imports — test-only helper.
- [X] T006 [P] Create `tests/e2e/_helpers/electron-cold-start.ts` exposing a `bootColdOffice()` Playwright helper that wipes the workspace `.data/`, launches the built Electron app via `_electron.launch`, and returns a `Page` plus a `getMainProcessLog()` accessor. Mirror the env-block convention used by `tests/e2e/_helpers/...` for feature 001 — skip the test with a documented reason if `process.env.CI_E2E_BLOCKED === '1'`.

**Checkpoint**: Logging and harnesses are in place. User-story implementation can now begin.

---

## Phase 3: User Story 1 — Distinct sessions + responsive input (Priority: P1) 🎯 MVP

**Goal**: All three default-office agents get distinct sessionIds at cold start, and each agent's terminal echoes only its own keystrokes when the user switches between them.

**Independent Test**: Boot the default office cold, open Gene → type `gene1`, switch to Dan → type `dan1`, switch to Alice → type `alice1`. Assert each terminal shows only its own marker, and `.data/office-0.sessions.json` contains three pairwise-distinct UUIDs.

### Tests for User Story 1 ⚠️ Write FIRST, ensure they FAIL before implementation

- [X] T007 [P] [US1] Vitest unit test `tests/integration/terminal/server-cold-start.test.ts` that drives the server's `case 'open'` (via the same internal dispatch path the existing terminal server tests use) for three distinct agentIds in a fresh office, asserts three distinct returned `sessionId`s, asserts three distinct entries in `ptyProcesses`, and asserts the persisted sessions file written via `saveOfficeSessionFile` has three pairwise-distinct UUIDs in `current`.
- [X] T008 [P] [US1] Vitest unit test in the same file that seeds a persisted sessions file with a forged duplicate (`generalist` and `debugger` mapped to the same UUID), calls `getOfficeSession('office-0')`, and asserts V3 repair fired — distinct UUIDs after load, and the `[TermServer] Repaired duplicate sessionId` warning was emitted.
- [X] T009 [P] [US1] Extend `tests/integration/terminal/TerminalOverlay.test.ts` with an agent-switch test: render the overlay, call `show(geneAgent)` and simulate `terminal.onData('g')`, then call `show(danAgent)` and simulate `terminal.onData('d')`. Assert `terminalWrite` was called once with `(officeId, 'generalist', 'g')` and once with `(officeId, 'debugger', 'd')` — never with `(officeId, 'generalist', 'd')`.

### Implementation for User Story 1

- [X] T010 [US1] In `src/scenes/OfficeScene.ts` `preStartAgentSessions()` (currently `~line 2094`), replace `const agentsToStart = AGENTS.slice(0, 2)` with iteration over the full roster returned by `getLayout(this.currentLayout).agents` (or the equivalent current-roster accessor). Pre-start every agent with its own `terminalStart(oid, agent.id, ...)` call; collect results in `Promise.allSettled` so one failed start does not poison the others. Emit the T004 forensic log line per agent on resolve. Address C1 in `contracts/terminal-protocol.md`.
- [X] T011 [US1] In `src/ui/TerminalOverlay.ts` `show(agent)` (currently `~line 367`), restructure the sequence to: (1) capture `prevOfficeId`/`prevAgentId`; (2) if non-null, `await window.copilotBridge.terminalDetach(prevOfficeId, prevAgentId)` (no longer `.catch(() => {})` — surface failures); (3) only then mutate `this.currentAgentId`, `this.currentAgent`, `this.attachedOfficeId`; (4) `await terminalAttach(...)`; (5) call `focusTerminal()` last. Address C2 and V5/V7 in `data-model.md`.
- [X] T012 [US1] In the same file, in the helper that registers `terminal.onData` (currently `~line 1193`), capture `const boundAgentId = this.currentAgentId` and `const boundOfficeId = this.attachedOfficeId ?? this.getOfficeId()` into the closure passed to `onData`, and use those captured values in the `window.copilotBridge.terminalWrite(...)` call instead of reading `this.currentAgentId` live. If the handler must be re-registered per agent, dispose the previous registration via the `IDisposable` returned by `onData`. Address C3 and V6.
- [X] T013 [US1] In `electron/terminal/server.ts` `getOfficeSession()` / loader path (`~lines 67–155`), after reading the JSON, scan `current` for any duplicate sessionId across keys. For each duplicate after the first, mint a fresh `crypto.randomUUID()` and overwrite the entry; emit `[TermServer] Repaired duplicate sessionId for officeId=… agentId=… from=… to=…` and write the repaired file back via `saveOfficeSessionFile(officeId)`. Address V3.

**Checkpoint**: Tests T007–T009 pass. Run the quickstart § 2 verification by hand — three distinct UUIDs on disk, each terminal echoes its own input. US1 is independently demonstrable.

---

## Phase 4: User Story 2 — Accurate startup status (Priority: P1)

**Goal**: An agent whose CLI process is alive never falsely transitions to `error: 'Startup timed out'`. A truly-dead agent still surfaces the timeout error.

**Independent Test**: Drive `syncAgentStatuses` with a fake `queryAgentStatuses` that returns `{ alive: true, ready: false }` for an agent whose renderer state is `subState: 'starting'` with `activityStartTime = now - 61_000`. Assert the agent ends up `ready`, not `error`. Then repeat with `alive: false` and assert the agent ends up `error: 'Startup timed out'`.

### Tests for User Story 2 ⚠️ Write FIRST

- [X] T014 [P] [US2] Vitest unit test `tests/integration/terminal/sync-agent-statuses.test.ts`: stub `window.copilotBridge.queryAgentStatuses`, seed `officeManager` with a `starting` agent past timeout, and assert the recovery branch fires when `alive: true` (status becomes `ready`, warn log present) and the original error branch fires when `alive: false` (status becomes `error: 'Startup timed out'`).
- [X] T015 [P] [US2] In the same test file, add a case asserting that an agent which is `starting` but **not** past timeout is left untouched regardless of `alive` value (no premature recovery).

### Implementation for User Story 2

- [X] T016 [US2] In `src/main.ts` `syncAgentStatuses` (lines 1789–1795), wrap the existing `setAgentError(...'Startup timed out')` block with a `serverStatus.alive` check. If `alive`, call `officeManager.setAgentReady(officeId, agent.id)` instead, emit the T004 forensic log `[Office] Agent X stuck in starting past timeout but PTY alive — recovering to ready`, and `continue`. If `alive` is false or undefined, fall through to the original error path. Address C4 and V4.

**Checkpoint**: Tests T014–T015 pass. US2 is independently demonstrable via the unit test even without the full app running.

---

## Phase 5: User Story 3 — Copy selected text from a terminal (Priority: P2)

**Goal**: Operator can select text in any agent terminal and copy it to the system clipboard via the standard keyboard shortcut or via a context-menu button; paste reproduces the selection verbatim.

**Independent Test**: In a manual or Playwright run, open Gene's terminal, select a substring of visible output, press Ctrl+C (Cmd+C on macOS), paste into a text input, and confirm the pasted text matches the selection exactly. Repeat with the context-menu copy button.

### Tests for User Story 3 ⚠️ Write FIRST

- [X] T017 [P] [US3] Add a Vitest case to `tests/integration/terminal/TerminalOverlay.test.ts` that simulates a non-empty xterm selection and synthesizes a `Ctrl+C` `KeyboardEvent` through `attachCustomKeyEventHandler`, asserting the handler called `navigator.clipboard.writeText` with the selection text and called `event.preventDefault()`. Mock `navigator.clipboard.writeText` and `terminal.getSelection`.
- [X] T018 [P] [US3] Add the analogous Vitest case to `tests/integration/terminal/SeriousTerminalController.test.ts` covering `SeriousTerminalController.attachCustomKeyEventHandler`.

### Implementation for User Story 3

- [X] T019 [US3] In `src/ui/TerminalOverlay.ts` `attachCustomKeyEventHandler` body (`~line 1166`) and `attachTerminalCopyListener` (`~line 178`), implement the canonical pattern from `research.md` R4: detect platform-standard copy combo (Ctrl+C on Win/Linux, Cmd+C on macOS), check `terminal.hasSelection()` (or `terminal.getSelection().length > 0`), and if so, call `event.preventDefault()`, await `navigator.clipboard.writeText(terminal.getSelection())`, and return `false` from the handler so xterm does not also fire its terminal-interrupt path. If `navigator.clipboard.writeText` throws, log `[TerminalOverlay] clipboard write failed` and fall through without preventing default (so existing interrupt semantics remain when no selection or write fails). Address C5.
- [X] T020 [US3] Apply the identical change to `src/ui/SeriousTerminalController.ts` in `attachCustomKeyEventHandler` (`~line 746`) and `attachTerminalCopyListener` (`~line 609`). Keep the copy-button DOM behavior in `attachTerminalCopyListener` consistent across both controllers.
- [X] T021 [US3] Add a context-menu copy affordance in both controllers: a small floating `<button>` that becomes visible on `terminal.onSelectionChange` when the selection is non-empty, positioned near the selection, with `onclick` invoking the same `navigator.clipboard.writeText(terminal.getSelection())` path used by the keyboard handler. Hide on selection-cleared. No new CSS file — inline styles consistent with existing overlay buttons.

**Checkpoint**: Tests T017–T018 pass. Manual verification per quickstart § 2 step 7 passes for all three agents.

---

## Phase 6: User Story 4 — Regression smoke tests (Priority: P2)

**Goal**: A repeatable test suite that asserts the four cold-start invariants (distinct sessions, responsive input, no false timeout, working copy-from-terminal) and that fails with a distinct, actionable message when any invariant regresses.

**Independent Test**: Run `npm run test -- tests/integration/terminal/server-cold-start.test.ts tests/integration/terminal/sync-agent-statuses.test.ts tests/integration/terminal/TerminalOverlay.test.ts` and `npm run test:e2e -- default-office-cold-start.spec.ts`. All pass (or env-block with documented rationale).

### Implementation for User Story 4

- [X] T022 [US4] Create `tests/e2e/default-office-cold-start.spec.ts` using the `bootColdOffice()` helper from T006. Steps: wipe `.data/`, launch Electron, wait for the default office, open Gene's terminal, type `gene-marker\r`, switch to Dan, type `dan-marker\r`, switch to Alice, type `alice-marker\r`. Assertions: (a) read `.data/office-0.sessions.json` and assert three distinct UUIDs in `current`; (b) each terminal's visible buffer contains only its own marker; (c) within 60s of cold-start, no agent badge text contains `Startup timed out`; (d) for each agent, programmatically select a substring, fire `Ctrl+C` via Playwright keyboard, and assert `page.evaluate(() => navigator.clipboard.readText())` matches the selection.
- [X] T023 [US4] In each new test file (T007, T014, T017, T018, T022), prefix the test descriptions with the invariant they protect so failures are self-describing: e.g. `it('US1 V1: three cold-start opens produce three distinct sessionIds', ...)`, `it('US2 V4: starting+alive past timeout recovers to ready', ...)`, `it('US3 C5: Ctrl+C with non-empty selection writes to clipboard', ...)`. This satisfies SC-006.
- [X] T024 [US4] If the Playwright e2e cannot run in this environment (Electron + xterm + clipboard permissions on the runner), wrap the e2e file with the same `test.skip(condition, 'env-blocked: …')` marker convention used in `tests/e2e/` for feature 001, citing the specific reason inline. The unit/integration tests T007–T018 must still pass; only T022 may be env-blocked.

**Checkpoint**: All four invariants protected by automated tests. Intentionally regressing each invariant in a throwaway local change produces a distinct named failure (SC-006 verification).

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verify the fix doesn't regress neighboring flows; update docs; clean up.

- [X] T025 Manual regression check (or extension of existing test): switch between offices during cold start; confirm sessions for non-current offices still spin up correctly and the dual-key viewer logic in `electron/terminal/agent-viewers.ts` is unaffected. Address FR-012 (constitution: session integrity).
- [X] T026 Manual regression check: enter meeting mode and fleet orchestration with the post-fix code; confirm Arthur's `transfer-session` IPC still works (the `attach` handler's dual-key aliasing at `electron/terminal/server.ts:642` and the `transferSession` handler around line 909 are not touched by this feature, so this is a smoke check, not a code change).
- [X] T027 [P] Update `MeetingMode.md` and `.github/instructions/electron.instructions.md` only if the forensic logs from T004 are referenced as a debugging aid; otherwise leave docs untouched. Reflect any user-visible behavior change (e.g., the new copy-from-terminal contract) in `README.md` if a controls section exists for the terminal.
- [X] T028 [P] Remove (or leave gated) the `DEBUG_COLD_START` constant from T004. If left in place, default it to `false` so production builds are quiet; document its purpose in a short comment above each constant.
- [X] T029 Run the full repo test suite — `npm run test` and `npm run test:e2e` (or `test:e2e` skipped if env-blocked per T024). Confirm no pre-existing tests regress. Capture pass/fail summary in `specs/002-fix-terminal-cold-start/baseline/post-fix-test-run.md`.
- [X] T030 Re-walk `specs/002-fix-terminal-cold-start/quickstart.md` § 2 (Verify) end-to-end on a clean cold start. Tick all four bullet points; if any fails, return to the relevant user-story phase rather than marking this task done.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 → T002, T003 (T002 and T003 are parallel after T001).
- **Foundational (Phase 2)**: Depends on Phase 1. T004 is sequential against T010, T011, T013, T016 (same files). T005, T006 are parallel with T004 and each other.
- **US1 (Phase 3)**: Depends on Phase 2. Tests T007–T009 first (different files, parallel). Implementation T010–T013 in order: T010 (OfficeScene), T011 + T012 (TerminalOverlay — same file, sequential), T013 (server). T010 and T013 are parallel; T011→T012 sequential.
- **US2 (Phase 4)**: Depends on Phase 2. T014, T015 first (same file, sequential). T016 after both.
- **US3 (Phase 5)**: Depends on Phase 2. T017, T018 first (different files, parallel). T019, T020 sequential per file. T021 after T019 + T020.
- **US4 (Phase 6)**: Depends on US1, US2, US3 being functionally complete (the e2e exercises all three). T022, T023, T024 in order.
- **Polish (Phase 7)**: Depends on US1–US4 complete.

### User Story Dependencies

- **US1**: No dependency on other stories.
- **US2**: Independent of US1 implementation-wise, but the recovery branch is most useful when US1 ships first. Can be developed in parallel.
- **US3**: Independent of US1 and US2.
- **US4**: Depends on US1, US2, US3 — the e2e asserts all four invariants.

### Within Each User Story

- Tests first, expected to FAIL on the pre-fix baseline.
- Implementation per file, respecting file-level parallelism markers.
- Validate independently against the story's Independent Test before moving on.

### Parallel Opportunities

- T002 + T003 (Setup)
- T004 + T005 + T006 (Foundational)
- T007 + T008 + T009 (US1 tests)
- T010 + T013 (US1 implementation — different files)
- T014 (US2 test) parallel with T010 if pursued by separate developers
- T017 + T018 (US3 tests)
- T019 (TerminalOverlay) + T020 (SeriousTerminalController) — different files, parallel
- T027 + T028 (Polish, different files)

---

## Parallel Example: User Story 1 tests

```bash
# Launch US1 tests together (different files — safe to run in parallel):
Task: "Write Vitest unit test for distinct cold-start sessionIds in tests/integration/terminal/server-cold-start.test.ts"
Task: "Write Vitest unit test for V3 duplicate-sessionId repair in tests/integration/terminal/server-cold-start.test.ts (second describe block)"
Task: "Extend tests/integration/terminal/TerminalOverlay.test.ts with agent-switch onData routing test"
```

---

## Implementation Strategy

### MVP First (US1 only)

1. Phase 1 (Setup) — confirm baseline, capture pre-fix state.
2. Phase 2 (Foundational) — logging + test harnesses.
3. Phase 3 (US1) — distinct sessions + responsive input.
4. **STOP and VALIDATE** against US1 Independent Test (quickstart § 2).
5. Ship/demo the MVP.

### Incremental Delivery

1. MVP (US1) → demo three responsive terminals with distinct sessions.
2. Add US2 → demo no false "Startup timed out".
3. Add US3 → demo copy-from-terminal.
4. Add US4 (smoke tests) → CI gate against regression.
5. Polish.

### Parallel Team Strategy

After Phase 2 completes:

- Developer A: US1 (OfficeScene + TerminalOverlay + server loader).
- Developer B: US2 (syncAgentStatuses guard).
- Developer C: US3 (clipboard handlers in both controllers).
- Anyone: US4 once A, B, C land.

---

## Notes

- All four invariants (distinct sessions, input echo, accurate startup status, working copy) trace 1:1 to spec FRs and SCs; test descriptions encode the trace per T023.
- The fix touches four production files (`src/scenes/OfficeScene.ts`, `src/ui/TerminalOverlay.ts`, `src/ui/SeriousTerminalController.ts`, `src/main.ts`) plus one defensive load-path tweak in `electron/terminal/server.ts`. No IPC contract changes, no persisted-state shape changes, no new dependencies.
- Commit after each user-story phase completes so partial progress is bisectable.
- Stop at any checkpoint to validate against the corresponding Independent Test in `spec.md` before continuing.
- Avoid: touching `electron/terminal/protocol.ts`, `agent-viewers.ts` `add/removeAgentViewer` helpers, fleet orchestrator, or meeting mode code — all out of scope for this bug fix.
