# Feature Specification: Fix Sprite-Card Stacking and Serious-Mode Open-Flow Bugs

**Feature Branch**: `003-fix-sprite-and-serious-bugs` (work tracked in worktree `CopilotOffice-worktree-next-steps-20260603-133614`)
**Created**: 2026-06-05
**Status**: Draft
**Input**: User description: "In game mode the sprite card stacks duplicates every time a scene tears down and rebuilds; in serious mode the agent-terminal open flow silently aborts when synchronous render code (canvas, sprite data) throws; also harden serious-mode keystroke routing the same way spec 002 hardened TerminalOverlay; add smoke tests."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - One sprite card in game mode, owned by the visible terminal's agent (Priority: P1)

When the operator is in game mode and has a terminal open for a given agent, the bottom-of-screen profile card ("sprite card") shows that agent and only that agent. Switching to a different office, entering and leaving the meeting room, and closing and reopening a terminal never leaves behind additional stacked sprite cards. At any moment the DOM contains at most one element with `id="sprite-card"`.

**Why this priority**: The operator explicitly called this out as wrong: "in the game mode, we should see the profile card at the bottom of only the user whose terminal is open, not all of them. That's what serious mode is for." The current behavior accumulates duplicate sprite-card divs that all share the same id, which both violates the document's id uniqueness contract and visually clutters the screen until the app is restarted. Game mode is unreliable for any session that involves more than one scene transition until this is fixed.

**Independent Test**: Boot the app in game mode, open a terminal in the main office, enter the meeting room, leave the meeting room, and reopen the terminal a second time. Inspect the DOM and confirm that exactly one element with `id="sprite-card"` exists and that it corresponds to the currently-visible terminal's agent.

**Acceptance Scenarios**:

1. **Given** the app has just booted into game mode and the operator opens a terminal for one agent, **When** the DOM is inspected, **Then** exactly one element with `id="sprite-card"` exists and it shows the agent whose terminal is currently visible.
2. **Given** a terminal is open in the main office and the operator transitions into the meeting room and back into the main office at least once, **When** the operator opens a terminal again, **Then** exactly one element with `id="sprite-card"` exists in the DOM and no orphaned sprite-card elements from prior scene instances remain.
3. **Given** the operator closes the currently visible terminal in game mode, **When** the close completes, **Then** either the sprite card is removed or it continues to belong to a single owning terminal — the DOM never contains two or more `id="sprite-card"` elements at the same time.
4. **Given** the operator switches between offices while in game mode, **When** the new office's terminal becomes the visible one, **Then** the sprite card reflects that office's agent and no sprite card from the previous office is left behind in the DOM.

---

### User Story 2 - Serious-mode terminal open flow surfaces synchronous render failures (Priority: P1)

When the operator opens an agent terminal in serious mode, a failure in the synchronous render phase that precedes the PTY attach (sprite-card rendering, canvas operations, sprite data lookup, etc.) does not silently swallow the open. The operator either sees the terminal connect normally or sees a clearly worded error in the terminal status, and the system still attempts to attach the PTY rather than leaving the operator looking at a non-responsive terminal with no diagnostic.

**Why this priority**: Today, the open flow's try/catch only wraps the network attach phase. A throw in the synchronous render code that runs before attach causes the open routine to exit early with no status update, no error log surfaced to the operator, and no PTY attach attempt. From the operator's point of view, clicking an agent card in serious mode does nothing — the terminal appears to open but never connects, and there is no actionable feedback. This is the kind of bug that destroys trust in serious mode as a "headless / no-game" fallback.

**Independent Test**: Force the synchronous render phase of the serious-mode open flow to throw (for example by stubbing the sprite-card render to raise), invoke "open agent terminal" from the dashboard, and confirm that an error is surfaced in the terminal status area and that the PTY attach path is still entered (observable via the attach call or via the operator-visible status transitioning past the render-error state).

**Acceptance Scenarios**:

1. **Given** the serious-mode dashboard is visible and the synchronous render phase of the open flow throws, **When** the operator clicks an agent card, **Then** the terminal status surfaces a human-readable error identifying the failure rather than silently doing nothing.
2. **Given** the synchronous render phase of the open flow throws, **When** the open flow continues, **Then** the PTY attach phase is still attempted, so a render-only failure does not also disable the underlying CLI session.
3. **Given** the synchronous render phase succeeds, **When** the operator opens the agent terminal, **Then** the behavior is unchanged from the pre-fix happy path — the terminal renders and attaches normally with no new error surfaces.

---

### User Story 3 - Serious-mode keystrokes are bound to the agent that owned the terminal at open time (Priority: P2)

When the operator types into a serious-mode agent terminal, the keystrokes are routed to the agent that was active when that terminal's data handler was registered, not to whichever agent the controller's mutable "active" field happens to point at when the keystroke arrives. Switching agents mid-stream does not cause an in-flight keystroke to be delivered to the wrong agent's session.

**Why this priority**: Spec 002 fixed this exact class of bug in the game-mode `TerminalOverlay` (C3 / V6): the data handler closed over the controller's live "active agent" field instead of capturing the bound agent id at registration time, which allowed a mid-switch keystroke to land on the wrong session. The serious-mode controller currently has the same shape — `terminal.onData(...)` reads `this.activeOfficeId` / `this.activeAgentId` live inside the closure. Today the early-return guard in the close path happens to mask the bug, but the contract is still wrong and a future refactor that removes or reorders the guard would reintroduce the cross-agent input leak. Fixing it now keeps serious mode and game mode on the same hardened pattern.

**Independent Test**: In serious mode, register a terminal data handler bound to agent A, then synchronously transition the controller's active-agent field to agent B without going through the normal close flow, deliver a keystroke through the handler, and confirm that the keystroke is sent to agent A's session (the bound agent) rather than to agent B.

**Acceptance Scenarios**:

1. **Given** a serious-mode terminal is bound to one agent at open time, **When** a keystroke is delivered through that terminal's data handler, **Then** the keystroke is routed to the agent that the handler was bound to at registration, regardless of subsequent changes to the controller's active-agent field.
2. **Given** the operator switches from one agent's terminal to another's via the normal close-and-reopen flow, **When** the new terminal's handler is registered, **Then** that handler is bound to the new agent and is the only handler that routes input to the new agent's session.

---

### User Story 4 - Smoke tests that fail loudly when any of the above regresses (Priority: P2)

The maintainer can run the repository's existing test command and get a clear pass/fail signal for each of the three invariants above: single sprite-card in game mode, resilient serious-mode open, and bound-at-registration serious-mode keystroke routing. If any invariant regresses, the suite fails with a message that identifies which invariant was violated. The work extends the smoke test file already present in this branch as the starting point.

**Why this priority**: All three bugs above are exactly the shape of bug that a future refactor of the scene shutdown path, the serious controller open path, or the terminal data handler is likely to reintroduce. Without a regression test, the same bugs will recur unnoticed until an operator hits them in a real session. The tests come after the user-visible fixes only because the fixes have to land first; all four stories are required for the work to be "done."

**Independent Test**: Run the repository's existing vitest command. The serious-mode smoke test file exercises the open flow and assertions for User Stories 1–3 and passes. Intentionally regressing any of the three invariants in a throwaway change causes a single, named test to fail with a message that points at the violated invariant.

**Acceptance Scenarios**:

1. **Given** the maintainer runs the repository's existing test command, **When** the smoke suite executes, **Then** it asserts that at most one `id="sprite-card"` element exists in the DOM after a scene tear-down and rebuild, that a forced synchronous render failure in serious-mode open surfaces an operator-visible error and still attempts PTY attach, and that a serious-mode terminal's data handler routes input to the agent it was bound to at registration.
2. **Given** a future change reintroduces sprite-card stacking, silent serious-mode open failure, or live closure-over-active-agent in serious mode, **When** the smoke tests run against that change, **Then** the suite fails with a self-describing message naming the violated invariant.

---

### Edge Cases

- The operator rapidly enters and leaves the meeting room several times in quick succession; the DOM must never accumulate more than one `id="sprite-card"` element across the whole sequence, and the surviving sprite card must belong to whichever terminal is currently visible.
- A scene is torn down while its terminal overlay's sprite card is still mounted; the shutdown path must remove the sprite-card DOM node rather than relying on garbage collection of the Phaser scene to clean up renderer-owned DOM.
- The serious-mode open flow throws synchronously after the previous terminal has been closed (`await closeView({silent:true})` has already cleared the active agent); the resilience requirement must not cause the controller to attach the new agent's PTY to a stale or null active agent.
- The operator triggers an agent switch while a keystroke is in flight through the previous agent's terminal data handler; the in-flight keystroke must land on the previously bound agent, not on the new one.
- The serious-mode render path throws because of a transient sprite-data corruption that self-heals on the next open; the operator-visible error must not persist past the next successful open and must not prevent that next open from succeeding.
- A scene shutdown runs while the terminal overlay is mid-construction (for example, between sprite-card append and full initialization); the shutdown path must still leave the DOM clean and must not throw on a partially constructed overlay.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST ensure that at any moment in game mode, the DOM contains at most one element with `id="sprite-card"`.
- **FR-002**: Each game-mode scene that constructs a terminal overlay MUST tear that overlay down (including removing its sprite-card DOM node) in the scene's shutdown path, so that scene tear-down and rebuild cycles do not accumulate orphaned sprite-card elements.
- **FR-003**: The single visible sprite card in game mode MUST correspond to the agent whose terminal is currently visible; closing the visible terminal MUST NOT leave a sprite card belonging to no visible terminal.
- **FR-004**: Switching between offices, entering and leaving the meeting room, and closing and reopening terminals in game mode MUST all preserve FR-001 across the entire transition, not only at the end state.
- **FR-005**: The serious-mode "open agent terminal" flow MUST treat synchronous render failures (including but not limited to sprite-card rendering, canvas calls, and sprite-data lookup) as recoverable: it MUST surface a human-readable error in the terminal status and MUST still attempt the PTY attach phase.
- **FR-006**: The serious-mode "open agent terminal" flow MUST NOT exit silently on a render failure — every code path that aborts the open before PTY attach MUST either produce an operator-visible status update or be wrapped in the resilience handler from FR-005.
- **FR-007**: A successful synchronous render in serious-mode open MUST leave the existing happy-path behavior unchanged, so that the resilience handler from FR-005 introduces no new visible error states when nothing is wrong.
- **FR-008**: The serious-mode terminal data handler MUST capture the bound office identifier and agent identifier at the moment the handler is registered, and MUST route input to those captured identifiers rather than re-reading the controller's mutable active-office / active-agent fields on every keystroke.
- **FR-009**: The serious-mode close-and-reopen flow MUST register a fresh data handler bound to the new agent each time a new terminal is opened, so that exactly one handler routes input to any one agent's session at any time.
- **FR-010**: The system MUST include automated smoke tests, runnable through the repository's existing test commands, that assert the invariants in FR-001, FR-005, and FR-008, and that fail with a self-describing message naming the violated invariant when any of them regresses. The smoke tests MUST extend the serious-mode integration test file already created in this branch.
- **FR-011**: The fix MUST preserve the existing behavior of serious-mode agent switching, dashboard card rendering, persisted boot-mode handling, and game-mode office and meeting-room transitions for cases that were already correct before this fix.

### Key Entities *(include if feature involves data)*

- **Sprite Card DOM Element**: Represents the bottom-of-screen profile card in game mode. Key attributes: DOM id (must be unique across the document), owning terminal overlay instance, and the agent identifier whose sprite/profile it displays. Invariant: at any moment in game mode, at most one such element exists in the DOM.
- **Terminal Overlay (Game Mode)**: Represents the per-scene DOM overlay that owns a sprite card. Key attributes: the owning scene, the bound agent identifier, and a lifecycle state (constructed, visible, destroyed). Invariant: the overlay's destroy path is called from the owning scene's shutdown so that the sprite card is removed when the scene tears down.
- **Serious Terminal Controller Open Flow**: Represents the sequence the serious-mode controller runs when opening an agent terminal. Key phases: close-previous, synchronous render, PTY attach. Invariant: a failure in synchronous render produces an operator-visible status update and does not skip the PTY attach phase.
- **Bound Terminal Data Handler (Serious Mode)**: Represents the `terminal.onData` callback registered for a serious-mode terminal. Key attributes: the office identifier and agent identifier captured at registration time. Invariant: input delivered through this handler is routed to the captured identifiers, not to the controller's mutable active fields.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After a sequence of at least five game-mode scene transitions (any mix of office switches, meeting-room enter/leave, and terminal close/reopen), 100% of DOM inspections find exactly zero or one element with `id="sprite-card"` — measured by the smoke suite across the full transition sequence, not only at the end.
- **SC-002**: In serious mode, 100% of forced synchronous render failures during "open agent terminal" produce an operator-visible error in the terminal status and still trigger the PTY attach phase — measured by the smoke suite injecting a render-phase failure and asserting both the status update and the attach call.
- **SC-003**: In serious mode, 100% of keystrokes delivered through a terminal's bound data handler are routed to the agent that handler was bound to at registration, even after the controller's mutable active-agent field has been changed without going through the normal close flow — measured by the smoke suite.
- **SC-004**: The repository's existing vitest command exits with a pass result on this branch with all new smoke assertions enabled (no use of `it.fails` or `it.skip` to hide a known regression of any of FR-001, FR-005, or FR-008).
- **SC-005**: A maintainer who intentionally regresses any one of the three invariants (sprite-card uniqueness, serious-open resilience, bound-at-registration data handler) in a throwaway change sees a single, named smoke test fail with a message that identifies which invariant was violated — verified by performing each of the three regressions in turn.
- **SC-006**: Game-mode and serious-mode happy paths that worked before this fix continue to work after it — measured by the full existing vitest suite (187 tests as of the start of this branch, plus the new assertions) passing.

## Assumptions

- Game mode continues to be implemented as Phaser scenes that each own a DOM terminal overlay; the fix lives in the scene shutdown path and the terminal overlay destroy path, not in a redesign of how scenes own DOM.
- The serious-mode controller continues to follow the close-previous → synchronous render → PTY attach sequence; the fix wraps the synchronous render phase in the same resilience contract that already protects the attach phase, rather than reordering the phases.
- The bound-at-registration pattern delivered by spec 002 for the game-mode terminal overlay (capture office id and agent id in the `onData` closure at registration time) is the correct template for the serious-mode controller and is reused directly.
- The repository's existing vitest harness and the serious-mode integration test file already present in this branch are the correct place to land the smoke tests; no new test framework is introduced and no new top-level test file is required.
- The user's framing — "the profile card at the bottom of only the user whose terminal is open, not all of them. That's what serious mode is for" — is taken as authoritative: in game mode the sprite card is scoped to the visible terminal's agent, and the multi-agent profile surface is a serious-mode concern, not a game-mode one.
- The smoke test currently marked as expected-to-fail in the serious-mode integration file is the concrete reproduction of FR-005 and is converted into a normal passing test as part of this fix; no expected-failure marker remains in the suite after the fix lands.
- Changes are scoped to the renderer side (Phaser scenes' shutdown paths, the terminal overlay, the serious terminal controller, and the smoke test file). The terminal server and the IPC protocol are not modified.

## Dependencies

- **Depends on spec 002 (`002-fix-terminal-cold-start`, commit d82341b on parent branch)**: User Story 3 of this spec is the direct generalization of spec 002's C3 / V6 bound-at-registration fix from the game-mode `TerminalOverlay` to the serious-mode controller. The pattern, the rationale, and the test shape are reused; this spec assumes spec 002's fix is already present on the parent branch and uses it as the design template.
- **Depends on the existing renderer-side test harness** introduced and stabilized through specs 001 and 002 (jsdom bootstrap of `src/main.ts`, mocked canvas API, integration tests under `tests/integration/main/`). This spec extends that harness rather than introducing a new one.

## Out of Scope

- Any change to Phaser canvas rendering or in-canvas game visuals; the sprite-card fix is a DOM-overlay lifecycle fix, not a renderer change.
- Any change to the IPC protocol between renderer and main.
- Any change to the terminal server (`electron/terminal/server.ts`) or to how PTY sessions are spawned and persisted.
- Any change to fleet orchestration, meeting plan generation, or meeting approval logic.
- A full UX redesign of either game mode or serious mode; this spec fixes specific bugs and adds defensive contracts, it does not redefine either mode's information architecture.

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: Phaser remains the sole in-canvas renderer. All changes happen in scene shutdown paths, in the DOM terminal overlay's destroy path, in the serious terminal controller's open and data-handler paths, and in the test harness; no new in-canvas rendering paths are introduced.
- **Event & Input Boundary**: Renderer-to-main coordination continues to flow through the existing event and IPC channels. The bound-at-registration fix for the serious-mode data handler tightens the input boundary by ensuring keystrokes are routed to the agent the handler was bound to, not to whichever agent the controller most recently pointed at.
- **Session Integrity Impact**: This work preserves agent session continuity. The serious-mode open-flow resilience explicitly requires that a render-phase failure still attempts PTY attach, so a cosmetic failure cannot also kill the underlying CLI session. Game-mode scene tear-down only removes the sprite-card DOM, it does not touch session state.
- **Configuration Impact**: No new configuration is introduced. Agent rosters, layouts, and mode selection remain config-driven and persisted-state-driven; the fix lives in the lifecycle and error-handling code paths.
- **Regression Plan**: The smoke tests in User Story 4, extending the serious-mode integration test file already present in this branch, are the regression plan: sprite-card uniqueness in game mode, resilient serious-mode open, and bound-at-registration serious-mode keystroke routing, runnable through the repository's existing vitest command, with no use of `it.fails` or `it.skip` to mask a known regression of those invariants.
