---

description: "Implementation tasks for fix-sprite-and-serious-bugs (003)"
---

# Tasks: Fix Sprite-Card Stacking and Serious-Mode Open-Flow Bugs

**Input**: Design documents from `/specs/003-fix-sprite-and-serious-bugs/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ui-contracts.md, quickstart.md

**Tests**: The spec explicitly requires smoke tests (FR-010 / User Story 4, SC-004, SC-005). Test tasks are INCLUDED below. The starting harness — `tests/integration/main/serious-mode.test.ts` — already exists on this branch as an untracked file with five passing tests (SM-A..SM-E) plus one `it.fails` (SM-F). US4 EXTENDS this file rather than creating it from scratch.

**Organization**: Tasks are grouped by user story. User stories from spec.md are:

- **US1 (P1)**: One sprite card in game mode, owned by the visible terminal's agent (FR-001..FR-004, SC-001)
- **US2 (P1)**: Serious-mode terminal open flow surfaces synchronous render failures (FR-005..FR-007, SC-002)
- **US3 (P2)**: Serious-mode keystrokes are bound to the agent that owned the terminal at open time (FR-008..FR-009, SC-003)
- **US4 (P2)**: Smoke tests that fail loudly when any of the above regresses (FR-010, SC-004, SC-005)

## Constitution-Driven Task Requirements

- All sprite-card lifecycle changes preserve the Phaser-first principle: the sprite card stays a DOM overlay; no in-canvas renderer changes (US1).
- Scene `shutdown()` hooks own DOM cleanup for the overlays they constructed — no hidden cross-layer event channels added (US1).
- No IPC contract changes (`electron/terminal/protocol.ts`, `electron/terminal/preload.ts`, `electron/terminal/server.ts` are read-only references this feature).
- No `InputManager` changes — Phase C changes the *payload* of `terminalWrite`, not the focus arbitration path.
- Logging additions are forensic-only, gated, and protocol-compatible.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no dependency on incomplete tasks → safe to run in parallel
- **[Story]**: US1, US2, US3, US4 — omitted for Setup, Foundational, Polish

## Path Conventions

Single-project Electron desktop layout. Production code under `src/` (renderer) and `electron/` (main, read-only this feature). Tests under `tests/integration/main/` and `tests/integration/terminal/`. Worktree root: `C:\Users\danielluo\repos\CopilotOffice-worktree-next-steps-20260603-133614`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm baseline and capture pre-fix evidence.

- [ ] T001 Verify `npm install` is clean and `npm run build` succeeds against worktree HEAD on branch `003-fix-sprite-and-serious-bugs` before any code changes. Then run `npm run test` and confirm the baseline: 187 pre-existing tests pass, and `tests/integration/main/serious-mode.test.ts` reports 5 passing (SM-A..SM-E) plus 1 `it.fails` (SM-F) in its expected-failing state. Capture the summary line.
- [ ] T002 [P] Reproduce the three bugs locally by walking through `specs/003-fix-sprite-and-serious-bugs/quickstart.md` § 1: (1) meeting-round-trip sprite-card growth via dev tools `document.querySelectorAll('#sprite-card').length`, (2) serious-mode silent open via monkey-patching `updateSpriteCard` to throw, (3) confirm the SM-F `it.fails` test is the in-repo reproduction of bug #2. Record the exact symptom observed for each in `specs/003-fix-sprite-and-serious-bugs/baseline/repro-notes.md`.
- [ ] T003 [P] Cross-check the spec-002 invariants V5/V6/V7 in `src/ui/TerminalOverlay.ts` (`show()` and `registerOnDataHandler(boundAgentId, boundOfficeId)`) are intact on this branch — they are the design template for US3 and must not be regressed. Capture the function locations in `specs/003-fix-sprite-and-serious-bugs/baseline/repro-notes.md` so reviewers can compare game-mode and serious-mode controllers side-by-side.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Forensic logging hooks and shared test scaffolding every user-story implementation will rely on.

**⚠️ CRITICAL**: Must complete before any of US1–US4 implementation begins.

- [ ] T004 Add the four optional forensic log lines from `specs/003-fix-sprite-and-serious-bugs/contracts/ui-contracts.md` § "Optional additive log lines", each gated behind a single boolean `DEBUG_SPRITE_SERIOUS` constant defined once at the top of `src/ui/TerminalOverlay.ts` (re-exported for reuse by sibling files in the same directory). Concretely: `[TerminalOverlay] createSpriteCard removed stale #sprite-card before append`, `[OfficeScene] shutdown destroying terminalOverlay`, `[MeetingScene] shutdown destroying terminalOverlay`, `[SeriousTerminalController] openAgentTerminal render failure (officeId=<o> agentId=<a>): <message>`, `[SeriousTerminalController] onData rebound officeId=<o> agentId=<a>`. Default `DEBUG_SPRITE_SERIOUS = false` for quiet production builds.
- [ ] T005 [P] Audit `tests/integration/main/serious-mode.test.ts` (already present on this branch, ~237 lines) and its dependency graph (`tests/setup/copilot-bridge-mock.ts`, any `MockTerminal` helpers under `tests/integration/terminal/_helpers/`) to confirm the harness can: (a) construct a `SeriousTerminalController` with an injectable terminal mock, (b) stub `updateSpriteCard` / `updateSessionTitle` / `refitAndResize` to throw on demand, (c) capture `setStatus` calls, (d) capture `terminalStart` / `terminalAttach` invocations from the bridge mock. Document any missing capability in `specs/003-fix-sprite-and-serious-bugs/baseline/harness-gaps.md`; resolve gaps in T006.
- [ ] T006 [P] Resolve any gaps identified by T005 by extending the existing helpers (NOT by creating new top-level files; FR-010 requires extending in place). Likely additions: (1) ensure the bridge mock records `terminalStart` and `terminalAttach` calls with `{ officeId, agentId }` so SM-002 can assert ids; (2) ensure the `MockTerminal` exposes a way to drive `onData` callbacks and verify `dispose()` was called on the previously-returned disposable. If `MockTerminal.onData` already returns `{ dispose: vi.fn() }` from spec 002's harness work, no change needed — record that fact.

**Checkpoint**: Logging gates and harness coverage are in place. US1–US4 implementation can begin.

---

## Phase 3: User Story 1 — One sprite card in game mode (Priority: P1) 🎯 MVP

**Goal**: At any moment in game mode, the DOM contains at most one `#sprite-card`. Scene tear-down (office switch, meeting enter/leave, terminal close/reopen) removes the overlay's DOM nodes rather than leaking them. (FR-001..FR-004, SC-001, V8/V9/V10/V11, C6/C7.)

**Independent Test**: Boot the default office → `document.querySelectorAll('#sprite-card').length === 1`. Walk into the meeting room and back out five times. After every transition, the count is `0` or `1` (never ≥2). Re-open a terminal — count returns to `1`, with the card belonging to the visible terminal's agent.

### Tests for User Story 1 ⚠️ Write FIRST, ensure they FAIL before implementation

- [ ] T007 [P] [US1] Extend `tests/integration/main/serious-mode.test.ts` with a new `it()` named `SM-001 single sprite-card across game-mode + meeting round trip`. Drive a full lifecycle through the mocked Phaser game (boot → OfficeScene constructs `TerminalOverlay` → enter MeetingScene → leave MeetingScene → reopen terminal) and at every transition assert `document.querySelectorAll('#sprite-card').length <= 1`. The test MUST fail today (pre-fix) because `MeetingScene.shutdown()` does not destroy the overlay. (Guards V8/V9/V10, C6/C7.)
- [ ] T008 [P] [US1] Add a Vitest unit test to `tests/integration/terminal/TerminalOverlay.test.ts` named `V9: createSpriteCard removes pre-existing #sprite-card before append`. Pre-insert a stub `<div id="sprite-card">stale</div>` into `document.body`, construct a `TerminalOverlay`, call (or trigger the path that calls) `createSpriteCard()`, and assert `document.querySelectorAll('#sprite-card').length === 1` and the surviving element is the new one (not the stub). Also assert calling `createSpriteCard()` twice in a row leaves exactly one node.
- [ ] T009 [P] [US1] Add a Vitest unit test to `tests/integration/terminal/TerminalOverlay.test.ts` named `V11: destroy() is safe on partial construction and removes #sprite-card`. Construct a `TerminalOverlay`, immediately call `destroy()` before any `show(agent)` (partial-construction edge case from spec L80), assert no throw. Then construct, call `createSpriteCard()`, call `destroy()`, assert `document.getElementById('sprite-card')` returns `null`.

### Implementation for User Story 1

- [ ] T010 [US1] In `src/ui/TerminalOverlay.ts` `createSpriteCard()`, before constructing and appending the new `<div id="sprite-card">`, query `document.getElementById('sprite-card')` and, if non-null, call `.remove()` on it. Behind `DEBUG_SPRITE_SERIOUS`, log `[TerminalOverlay] createSpriteCard removed stale #sprite-card before append` when the defensive remove fires. After append, store the reference on the overlay instance (e.g. `this.spriteCardEl`) so `destroy()` (T011) can use it. Addresses V8/V9, C6.
- [ ] T011 [US1] In `src/ui/TerminalOverlay.ts` `destroy()` (or the equivalent existing teardown method — extend it; do not create a new method), remove the sprite-card DOM node: prefer `this.spriteCardEl?.remove()`; as defense in depth, also `document.getElementById('sprite-card')?.remove()`. Wrap each DOM removal in a `try {} catch {}` so a partial-construction call (no `spriteCardEl` yet, or already removed) does NOT throw. Null the field afterwards. Addresses V11, C7's "MUST NOT throw" clause.
- [ ] T012 [P] [US1] In `src/scenes/OfficeScene.ts` `shutdown()`, add `try { this.terminalOverlay?.destroy(); } catch (e) { console.warn('[OfficeScene] shutdown overlay destroy failed', e); }` before super-class shutdown completes. Behind `DEBUG_SPRITE_SERIOUS`, log `[OfficeScene] shutdown destroying terminalOverlay`. Addresses V10, C7. Parallel-safe with T013 (different file).
- [ ] T013 [P] [US1] In `src/scenes/MeetingScene.ts` `shutdown()`, mirror T012: `try { this.terminalOverlay?.destroy(); } catch (e) { console.warn('[MeetingScene] shutdown overlay destroy failed', e); }` before super-class shutdown completes. Behind `DEBUG_SPRITE_SERIOUS`, log `[MeetingScene] shutdown destroying terminalOverlay`. Addresses V10, C7. Parallel-safe with T012.

**Checkpoint**: Tests T007–T009 pass. Quickstart § 2 bullet 1 (meeting round trip × 5 → count stays ≤1) passes by hand in `npm start`. US1 is independently demonstrable.

---

## Phase 4: User Story 2 — Resilient serious-mode open (Priority: P1)

**Goal**: A throw in the synchronous render phase of `SeriousTerminalController.openAgentTerminal` produces a human-readable status update, writes a visible `[render error: ...]` line into the xterm, AND still proceeds to call `terminalStart` / `terminalAttach` for the *requested* office/agent ids. The happy path is byte-for-byte unchanged. (FR-005..FR-007, SC-002, V12/V12.a, C8/C8.a/C10.)

**Independent Test**: Stub `controller.updateSpriteCard` (or `updateSessionTitle`, or `refitAndResize`) to throw `new Error('forced render failure')`. Invoke `openAgentTerminal(officeA, agentA)`. Assert: (1) `setStatus` was called with a message containing `forced render failure`; (2) the xterm received a write whose payload includes `\r\n[render error:`; (3) `terminalStart` was invoked with `officeA.id` and `agentA.id`; (4) `terminalAttach` was invoked with `officeA.id` and `agentA.id`.

### Tests for User Story 2 ⚠️ Write FIRST

- [ ] T014 [P] [US2] Extend `tests/integration/main/serious-mode.test.ts` with a new `it()` named `SM-002 serious-mode open surfaces synchronous render failures and still attaches`. Construct a `SeriousTerminalController` via the existing harness, stub `controller.updateSpriteCard = () => { throw new Error('forced render failure'); }`, await `controller.openAgentTerminal(officeA, agentA)`. Assert all four conditions from the Independent Test above. The test MUST fail on the pre-fix baseline (the throw escapes silently). Guards V12, C8.
- [ ] T015 [P] [US2] In the same file, add a sibling `it()` named `SM-002.a serious-mode open happy path is unchanged by the resilience handler`. With no render throw, invoke `openAgentTerminal(officeA, agentA)` and assert `setStatus` was NOT called with any `[render error:` substring, the xterm received no `[render error:` write, and the call sequence matches the pre-fix happy-path behavior (status updates, `terminalStart`, `terminalAttach` in the original order). Guards V12.a, C8.a.
- [ ] T016 [US2] Convert the existing `it.fails(...)` test labeled `SM-F BUG: openAgentTerminal should not silently fail when sprite rendering throws` (currently `tests/integration/main/serious-mode.test.ts` line ~244) into a normal `it(...)`. The assertions inside SM-F already exercise the bug; once T017 lands, SM-F will pass naturally and the `it.fails` marker MUST be removed (spec assumption: no expected-failure markers remain on these invariants). Required by SC-004.

### Implementation for User Story 2

- [ ] T017 [US2] In `src/ui/SeriousTerminalController.ts` `openAgentTerminal(office, agent)`, wrap the body between `await this.closeView({ silent: true })` and the first `await terminalStart(...)` (i.e. the synchronous render phase: `updateSpriteCard`, `updateSessionTitle`, `refitAndResize`, and any other sync work) in a top-level `try/catch`. On catch: (1) compose `const message = `serious-mode open failed during render: ${(err as Error).message}`;`; (2) call `this.setStatus(message)`; (3) write `\r\n[render error: ${message}]\r\n` to `this.terminal`; (4) STILL invoke `terminalStart(office.id, agent.id, ...)` and `terminalAttach(office.id, agent.id)` using the **requested** ids (NOT `this.activeOfficeId` / `this.activeAgentId`, which the earlier `closeView` may have cleared — see spec L77 edge case); (5) behind `DEBUG_SPRITE_SERIOUS`, log `[SeriousTerminalController] openAgentTerminal render failure (officeId=<o> agentId=<a>): <message>`. Existing attach-phase error handling further down stays as-is. Addresses V12, C8, FR-005/FR-006.
- [ ] T018 [US2] Audit `src/ui/SeriousTerminalController.ts` `closeView` (and any sibling sync-render path called from the operator click handler) per C10. If it performs unguarded synchronous DOM rendering before its IPC call, wrap that render in the same `try`-around-render pattern as T017 (status update + visible warning, then proceed with the IPC call). If `closeView` is already IPC-only or already wrapped, document the result inline as a one-line comment (`// C10: closeView audited <date> — no unguarded render`) and move on. Addresses C10.

**Checkpoint**: SM-002, SM-002.a pass; the old `it.fails` SM-F (now `it`) passes. Quickstart § 2 bullet 2 reproduces by hand: dev-tools forced throw → status update + `[render error:` line in xterm + PTY attach still fires (visible in main-process logs).

---

## Phase 5: User Story 3 — Bound-at-registration `onData` in serious mode (Priority: P2)

**Goal**: The `onData` callback registered on the serious-mode terminal routes keystrokes to the office/agent ids captured at registration time, regardless of subsequent mutations to `this.activeOfficeId` / `this.activeAgentId`. The previous disposable is disposed before a new handler is registered, so exactly one live `onData` routes input to any one agent at any time. (FR-008..FR-009, SC-003, V13/V14, C9.)

**Independent Test**: Open serious-mode terminal for `agentA`. Without going through `closeView`, set `controller.activeAgentId = 'agentB'`. Trigger the xterm's `onData` callback with `"x"`. Assert `bridge.terminalWrite` was called with `{ officeId: officeA.id, agentId: 'agentA', data: 'x' }` — NOT `agentB`. Then open serious-mode terminal for `agentB` normally; assert the previous `onData` disposable's `dispose()` was called, and the new write goes to `agentB`.

### Tests for User Story 3 ⚠️ Write FIRST

- [ ] T019 [P] [US3] Extend `tests/integration/main/serious-mode.test.ts` with a new `it()` named `SM-003 serious-mode onData routes to the agent bound at registration`. Drive the scenario from the Independent Test above against a real `SeriousTerminalController` constructed via the harness. Assert agent routing matches binding (not active-field). The test MUST fail on the pre-fix baseline (the callback reads `this.activeAgentId` live). Guards V13/V14, C9.
- [ ] T020 [P] [US3] Add a Vitest unit-style regression test to `tests/integration/terminal/SeriousTerminalController.test.ts` named `routes onData to bound agent after activeAgentId mutation` (cheap fast-feedback test mirroring spec 002's controller-unit coverage pattern). Stub `terminal.onData(cb) → { dispose: vi.fn() }`, capture `cb`, invoke `controller.openAgentTerminal(officeA, agentA)`, mutate `controller.activeAgentId = 'agentB'`, call `cb('x')`, assert `bridge.terminalWrite` received `agentA`. Then call `openAgentTerminal(officeB, agentB)`, assert the first call's returned `dispose` was invoked exactly once, and subsequent `cb` from the second registration routes to `agentB`. Guards V13/V14.

### Implementation for User Story 3

- [ ] T021 [US3] In `src/ui/SeriousTerminalController.ts`, add `private onDataDisposable: { dispose(): void } | null = null;` as a class field. In `openAgentTerminal(office, agent)`, after the terminal panel is ready and BEFORE `await terminalStart(...)`: (1) `this.onDataDisposable?.dispose();` (drop previous binding); (2) `const boundOfficeId = office.id; const boundAgentId = agent.id;` (locals captured into closure); (3) `this.onDataDisposable = this.terminal.onData((data) => { window.copilotBridge.terminalWrite({ officeId: boundOfficeId, agentId: boundAgentId, data }); });`. The callback MUST NOT read `this.activeOfficeId` / `this.activeAgentId`. Behind `DEBUG_SPRITE_SERIOUS`, log `[SeriousTerminalController] onData rebound officeId=<o> agentId=<a>`. Addresses V13/V14, C9. Pattern lifted verbatim from `src/ui/TerminalOverlay.ts` `registerOnDataHandler(boundAgentId, boundOfficeId)` per spec 002 V6.
- [ ] T022 [US3] In `src/ui/SeriousTerminalController.ts` `closeView` (and any other tear-down path that disposes terminal resources), add `this.onDataDisposable?.dispose(); this.onDataDisposable = null;` so a close-without-reopen leaves no live handler bound to a stale agent. Addresses V14.
- [ ] T023 [US3] Remove the early-return guard in the close path that today masks the live-read bug (the user identified that an early-return in `closeView` papered over the V13 violation). Removing it MUST NOT regress existing behavior because T021 fixes the contract at the binding site. If the guard has other responsibilities, leave them intact and only remove the portion specifically defending against cross-agent input leak; document the removal with a one-line comment referencing this task and spec 003 V13.

**Checkpoint**: SM-003 and the `tests/integration/terminal/SeriousTerminalController.test.ts` regression test pass. Manual verification per quickstart § 2 bullet 3 (smoke test asserts bound agent receives the keystroke after `activeAgentId` mutation) passes.

---

## Phase 6: User Story 4 — Smoke tests that fail loudly (Priority: P2)

**Goal**: A repeatable test suite asserting the three invariants (sprite-card uniqueness, serious-open resilience, bound-at-registration `onData`), runnable via `npm run test`, with each regression producing a single, named failure. (FR-010, SC-004, SC-005.)

**Independent Test**: Run `npm run test -- tests/integration/main/serious-mode.test.ts tests/integration/terminal/SeriousTerminalController.test.ts` — all named tests (SM-001, SM-002, SM-002.a, SM-003, and the controller-unit regression) pass with no `it.fails` / `it.skip` markers on the three invariants. Then intentionally regress each invariant in turn (see quickstart § 4) and confirm exactly one named test fails per regression.

### Implementation for User Story 4

- [ ] T024 [US4] Audit the final state of `tests/integration/main/serious-mode.test.ts` after T007/T014/T015/T016/T019: confirm the file now contains the original SM-A..SM-E (5 tests, unchanged), the converted SM-F (was `it.fails`, now `it`), plus SM-001, SM-002, SM-002.a, SM-003 — total 10 named tests. Confirm zero `it.fails` and zero `it.skip` calls remain in the file. Confirm each test name begins with its `SM-` identifier so failure output names the violated invariant directly (SC-005). If any of these conditions fail, fix them here.
- [ ] T025 [US4] In every new/extended test from T007/T008/T009/T014/T015/T019/T020, prefix the assertion failure messages (or use Vitest `expect(...).withContext(...)` equivalent — explicit `expect(..., 'message')` second arg) so a regression produces a self-describing line: e.g. `expect(spriteCardCount, 'V8 violated: sprite-card stacked').toBeLessThanOrEqual(1)`, `expect(setStatusCalls, 'V12 violated: render failure not surfaced via setStatus').toContainEqual(...)`, `expect(writeCalls[0].agentId, 'V13 violated: onData routed to live activeAgentId instead of bound agent').toBe('agentA')`. Required by SC-005.
- [ ] T026 [US4] Perform the SC-005 verification ritual from quickstart § 4 — for each invariant, intentionally regress the implementation in a throwaway local change and confirm exactly one named test fails with the V-numbered message:
  - Comment out the `getElementById('sprite-card')?.remove()` line in `TerminalOverlay.createSpriteCard()` → expect `SM-001` (and `V9` unit test) to fail.
  - Remove the top-level `try/catch` from `SeriousTerminalController.openAgentTerminal` → expect `SM-002` to fail.
  - Replace `boundAgentId` with `this.activeAgentId` inside the `onData` closure → expect `SM-003` and the controller-unit regression to fail.
  Revert each regression after observing the failure. Record outcomes in `specs/003-fix-sprite-and-serious-bugs/baseline/sc-005-verification.md`.

**Checkpoint**: All three invariants protected by automated tests with self-describing failures. SC-005 verified in writing.

---

## Phase 7: Polish & Cross-Cutting Concerns

**Purpose**: Verify the fix doesn't regress neighboring flows; clean up gates; close out.

- [ ] T027 Manual regression check: in `npm start`, switch between offices, enter/leave meeting room repeatedly, open/close terminals for multiple agents — confirm no visible regression of spec 002's V1–V7 invariants (distinct sessions, responsive input, no false timeout, copy-from-terminal). Address FR-011 (preserve existing correct behavior).
- [ ] T028 Manual regression check: toggle serious ↔ game mode several times, open multiple agent terminals in serious mode in sequence, confirm dashboard card rendering, persisted boot-mode handling, and serious-mode agent switching all still work. Address FR-011 / SC-006.
- [ ] T029 [P] Leave `DEBUG_SPRITE_SERIOUS` (T004) gated and defaulting to `false` for quiet production builds; document its purpose in a short comment above the constant declaration in `src/ui/TerminalOverlay.ts`. Do NOT delete — these are the forensic log lines listed in `specs/003-fix-sprite-and-serious-bugs/contracts/ui-contracts.md` § "Optional additive log lines" and are explicitly designed to make future bisects cheap.
- [ ] T030 [P] If any user-visible behavior changed (e.g., a render-failure error now appears in the terminal status bar), reflect it in `README.md` or the closest existing operator-facing doc. Otherwise leave docs untouched. Do NOT touch `MeetingMode.md` or `.github/instructions/*` unless directly relevant.
- [ ] T031 Run the full repo test suite — `npm run test` — and confirm 187 pre-existing tests still pass plus the new assertions from T007/T008/T009/T014/T015/T016/T019/T020. Capture pass/fail summary in `specs/003-fix-sprite-and-serious-bugs/baseline/post-fix-test-run.md`. SC-006 gate.
- [ ] T032 Re-walk `specs/003-fix-sprite-and-serious-bugs/quickstart.md` § 2 (Verify) end-to-end on a fresh `npm start`. Tick all three verification bullets (Bug 1 meeting round trip × 5, Bug 2 forced render throw, Bug 3 covered by smoke test). If any fails, return to the relevant user-story phase rather than marking this task done.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 first. T002 and T003 parallel after T001.
- **Foundational (Phase 2)**: Depends on Phase 1. T004 is sequential against T010 / T011 / T017 / T021 (same file ownership). T005 and T006 parallel with T004 and each other.
- **US1 (Phase 3)**: Depends on Phase 2. Tests T007 / T008 / T009 first (different test files / different `it` blocks, parallel). Implementation: T010 → T011 (same file `TerminalOverlay.ts`, sequential). T012 and T013 parallel with each other and with T010/T011 (different files).
- **US2 (Phase 4)**: Depends on Phase 2. T014 / T015 first (same file, can be added in one edit pass, treat as sequential against the file but content-independent). T016 is a one-line marker conversion. Implementation: T017 → T018 (same file, sequential).
- **US3 (Phase 5)**: Depends on Phase 2. T019 / T020 first (different files, parallel). T021 → T022 → T023 (same file `SeriousTerminalController.ts`, sequential).
- **US4 (Phase 6)**: Depends on US1, US2, US3 being functionally complete (T024 audits the post-test-edit state of the file; T026 needs working implementations to regress). T024 → T025 → T026.
- **Polish (Phase 7)**: Depends on US1–US4 complete.

### User Story Dependencies

- **US1**: No dependency on other stories. Pure DOM-lifecycle fix.
- **US2**: Independent of US1 implementation-wise. Can be developed in parallel by a second contributor. SM-F → `it` conversion (T016) only succeeds after T017 lands.
- **US3**: Independent of US1 and US2. The `SeriousTerminalController.ts` changes in T021–T023 do not collide with T017/T018 textually but DO share the same file — coordinate file edits (Phase 4 and Phase 5 implementation tasks against `SeriousTerminalController.ts` are sequential against each other if pursued by one developer; safe to interleave if pursued by two).
- **US4**: Depends on US1, US2, US3. T024–T026 audit and validate the final state.

### Within Each User Story

- Tests first, expected to FAIL on the pre-fix baseline (T007 / T008 / T009 / T014 / T015 / T019 / T020).
- Implementation per file, respecting file-level parallelism markers.
- Validate independently against the story's Independent Test before moving on.

### Parallel Opportunities

- T002 + T003 (Setup)
- T005 + T006 (Foundational)
- T007 + T008 + T009 (US1 tests, different files / independent describe blocks)
- T012 (OfficeScene) + T013 (MeetingScene) — different files, parallel
- T014 + T015 (US2 tests) parallel with US1 implementation if pursued by separate developers
- T019 (extends serious-mode.test.ts) + T020 (extends SeriousTerminalController.test.ts) — different files, parallel
- T029 + T030 (Polish, different files)

---

## Parallel Example: User Story 1 implementation

```bash
# Launch US1 scene edits together (different files — safe to run in parallel):
Task: "Add try/catch terminalOverlay.destroy() to OfficeScene.shutdown() in src/scenes/OfficeScene.ts (T012)"
Task: "Add try/catch terminalOverlay.destroy() to MeetingScene.shutdown() in src/scenes/MeetingScene.ts (T013)"

# Meanwhile, sequentially in src/ui/TerminalOverlay.ts:
T010 → T011  (createSpriteCard idempotency, then destroy() cleanup)
```

---

## MVP-First Delivery Strategy

1. **MVP = US1 alone** (Phase 1 → Phase 2 → Phase 3 → smoke verify SM-001 + V9/V11 unit tests). Sprite-card stacking is the most user-visible bug (visible profile cards stacking on every meeting trip) and ships independently with no serious-mode coupling. After MVP, the renderer's DOM is clean and spec 002's invariants are preserved.
2. **Increment 2 = US2** (Phase 4 + SM-F conversion). Operator-facing: silent failures in serious mode become visible. Independently shippable once MVP lands.
3. **Increment 3 = US3** (Phase 5). Contract-hardening: prevents future cross-agent input leak in serious mode. Independently shippable.
4. **Increment 4 = US4** (Phase 6). Closes the regression gate — SC-005 verified, no `it.fails` markers remain.
5. **Close-out = Phase 7**. Full-suite regression run, docs, cleanup.

Each increment is independently demonstrable via its Independent Test. Shipping the MVP alone produces a measurably better state (no DOM leak) without requiring the other two fixes to be ready.
