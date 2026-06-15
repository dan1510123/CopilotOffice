# Feature Specification: Fix Terminal Cold-Start Bugs

**Feature Branch**: `worktree-next-steps-20260603-133614` (work tracked in worktree `CopilotOffice-worktree-next-steps-20260603-133614`)
**Created**: 2026-06-04
**Status**: Draft
**Input**: User description: "Fix terminal session bugs at main-office cold start, plus add smoke tests."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Each agent gets its own working terminal at cold start (Priority: P1)

When the operator launches the app and the default office boots from a clean state, the three default agents (Gene, Dan, Alice) each spin up an independent Copilot CLI session. The operator can open any of the three agent terminals, type, and see their input echoed by that agent's own process, without interference from the other two agents.

**Why this priority**: This is the core product promise — multiple distinct agents that can be talked to independently. The current bug collapses all three agents onto one shared session and locks input on two of them, which makes the default office unusable on cold start. Until this is fixed, every other feature of the default office is blocked.

**Independent Test**: Boot the app from a clean state (no persisted office sessions for the default office), open each of the three agent terminals in turn, type a short distinctive marker into each, and confirm that each terminal echoes its own input and that the three sessions have three distinct session identifiers.

**Acceptance Scenarios**:

1. **Given** the default office has no persisted session state and the app has just launched, **When** the three default agents finish starting, **Then** each agent is associated with a session identifier that is distinct from the other two agents' identifiers.
2. **Given** all three default agents have started and the operator opens each agent's terminal in turn, **When** the operator types a short input into the focused terminal, **Then** that terminal echoes the operator's input and the other two agents' terminals are unaffected.
3. **Given** the operator switches focus between the three agent terminals during a single session, **When** focus moves to a different agent's terminal, **Then** keyboard input is routed to the newly focused terminal and the previously focused terminal stops receiving input.

---

### User Story 2 - Startup status reflects what actually happened (Priority: P1)

When the three default agents start, the status badge for each agent reflects the real state of its underlying process. An agent whose process started successfully reaches the ready state and is never falsely marked as having timed out. An agent whose process truly failed to start within the startup window is marked as timed out with a clear reason.

**Why this priority**: A false "Startup timed out" badge tells the operator that an agent is broken when it is actually fine, which destroys trust in the status system and can prompt unnecessary restarts that compound the underlying bug. Status correctness is required for the operator to reason about the office at all.

**Independent Test**: Boot the default office from a clean state, wait for the startup window to elapse, and confirm that any agent whose CLI process is actually alive and accepting input is shown as ready rather than as timed out.

**Acceptance Scenarios**:

1. **Given** the default office is starting from a clean state, **When** all three agents' underlying CLI processes successfully reach a ready signal within the startup window, **Then** each agent's status badge transitions to ready and none of them show a startup-timeout error.
2. **Given** an agent's underlying CLI process has reached a ready signal, **When** other agents in the same office are still starting or already ready, **Then** the ready signal for the first agent is not lost or attributed to a different agent.

---

### User Story 3 - Copy selected text from an agent terminal (Priority: P2)

The operator can select text in any agent's terminal and copy it to the system clipboard, then paste it elsewhere (another terminal, another app, a chat) and see exactly the text that was selected. This works on every agent terminal in the default office, including immediately after cold start.

**Why this priority**: Today, copy-from-terminal fails — operators cannot move CLI output out of the app, which forces re-typing and breaks the loop of "read agent output → paste into a follow-up message or bug report." Restoring copy is a small UX feature on its own, but it is required for the operator to actually use the multi-agent fixes from User Stories 1 and 2.

**Independent Test**: Open any agent's terminal after cold start, select a visible substring of the agent's output, invoke copy via keyboard shortcut and via context menu, paste into a separate text surface, and confirm that the pasted text matches the selection exactly.

**Acceptance Scenarios**:

1. **Given** an agent terminal is open and displays output, **When** the operator selects a substring and invokes copy via the platform's standard copy shortcut, **Then** the system clipboard contains exactly the selected text and a subsequent paste in another surface reproduces it verbatim.
2. **Given** an agent terminal is open and displays output, **When** the operator selects a substring and invokes copy via the terminal's context menu, **Then** the system clipboard contains exactly the selected text.
3. **Given** the operator has copied text from one agent's terminal, **When** the operator switches focus to a different agent's terminal and pastes, **Then** the pasted text matches what was copied (copy is not silently cleared by the focus change).

---

### User Story 4 - Regression-proof smoke tests for default-office cold start (Priority: P2)

The maintainer can run the existing test command and get a clear pass/fail signal that the default office cold-start path is healthy: three distinct sessions, three responsive terminals, and no false startup-timeout errors. If the bug recurs, the suite fails loudly with a diagnostic that points at the failing invariant.

**Why this priority**: The bugs in User Stories 1, 2, and 3 have either already shipped or already regressed once and were not caught before reaching the operator. Without a regression test, the same shape of bug is likely to return after future refactors of the terminal server, session map, input focus system, or terminal overlay. Tests come after the user-visible fixes only because those fixes have to land first; all are required for the work to be "done."

**Independent Test**: Run the repository's existing unit/integration test command and end-to-end test command. The new tests appear in the suite, exercise the cold-start path, and pass in CI (or are explicitly marked as environment-blocked with a documented rationale, following the same convention used by the existing 001 feature).

**Acceptance Scenarios**:

1. **Given** the maintainer runs the repository's existing test command, **When** the new smoke tests execute, **Then** they assert that three fresh default-office agents are assigned three distinct session identifiers, that each agent's terminal accepts and echoes typed input, that copying selected text from an agent terminal places exactly that text on the system clipboard, and that no agent transitions to a startup-timeout state within the startup window.
2. **Given** a future change reintroduces the shared-session, input-lock, or copy-from-terminal bug, **When** the smoke tests run against that change, **Then** the suite fails with a message that identifies which of the four invariants was violated.

---

### Edge Cases

- A stale persisted session map from a previous run contains entries for the default agents that collide on the same session identifier; the cold-start path must not propagate those collisions into the live session map.
- One of the three agents' processes really does fail to start within the startup window; that agent must be marked as timed out without affecting the status of the other two agents.
- The operator clicks rapidly between the three agent terminals during the startup window; input focus must end up bound to exactly one agent's terminal at a time and must never silently drop input.
- The operator closes and reopens an agent's terminal during the startup window; the agent's session continues against the same underlying process and the same session identifier rather than being assigned a new one or being merged with a sibling agent's session.
- The operator selects text that spans multiple visual lines in an agent terminal and copies it; the clipboard receives the selection without injecting unwanted line wrapping or losing characters at line boundaries.
- The operator's selection in an agent terminal is empty or whitespace-only when copy is invoked; the system handles the operation gracefully (either no-op or copies the empty/whitespace selection) without raising a user-visible error.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST assign each default-office agent a distinct session identifier at cold start, even when no prior session state exists on disk.
- **FR-002**: The system MUST guarantee that the session identifier assigned to one default-office agent is never reused for, nor aliased onto, another agent in the same office during the same app lifetime.
- **FR-003**: The system MUST ignore or repair stale persisted session entries that would otherwise cause two or more default-office agents to share a single session identifier at cold start.
- **FR-004**: When multiple agent terminals are open simultaneously, the system MUST route keyboard input to exactly one terminal — the currently focused one — and MUST make focus changes between agent terminals reliably restore input to the newly focused terminal.
- **FR-005**: The system MUST deliver the per-agent ready signal from the underlying CLI process to the per-agent status tracker, so that an agent whose process is actually ready reaches the ready status and does not falsely transition to startup-timeout.
- **FR-006**: When the underlying CLI process for an agent really does fail to reach a ready signal within the startup window, the system MUST mark that specific agent as timed out without changing the status of other agents in the same office.
- **FR-007**: The system MUST surface, in operator-visible logs, the distinct session identifier assigned to each default-office agent at the moment the session is created, so that cold-start session assignment is auditable after the fact.
- **FR-008**: The system MUST allow the operator to copy a selected range of text from any agent terminal to the system clipboard via the platform's standard copy keyboard shortcut and via the terminal's context menu, such that a subsequent paste in any other surface reproduces the selection verbatim.
- **FR-009**: Copy-from-terminal MUST function on every agent terminal in the default office, including immediately after cold start, and MUST NOT be silently cleared or corrupted by switching focus between agent terminals or by switching offices.
- **FR-010**: The system MUST include automated smoke tests, runnable through the repository's existing test commands, that boot the default office from a clean state, open all three default agent terminals, and assert the invariants in FR-001, FR-004, FR-005, and FR-008.
- **FR-011**: The smoke tests MUST either pass in the project's continuous integration environment or be explicitly marked as environment-blocked with a documented rationale, following the same convention used by the previously delivered feature in this repository.
- **FR-012**: The fix MUST preserve the existing behavior of office switching, meeting mode, and fleet orchestration with respect to terminal session continuity; agents that already had a live session before the cold-start path is touched must continue to behave as they did.

### Key Entities *(include if feature involves data)*

- **Agent Session**: Represents one running Copilot CLI process owned by a single agent. Key attributes: the owning agent's identifier, the office the agent currently lives in, a session identifier that is unique within the app lifetime, and a lifecycle state (starting, ready, waiting, error).
- **Per-Office Session Map**: Represents the mapping from agent identifier to session identifier within a single office, as persisted between app runs. Key attributes: office identifier, agent identifier, session identifier, and last-updated timestamp. Invariant: within one office, no two agent identifiers may map to the same session identifier.
- **Agent Status Badge**: Represents the operator-visible startup state of one agent. Key attributes: agent identifier, current status (slacking, starting, ready, waiting, thinking, error), and, when in the error state, a human-readable reason.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On a cold start of the default office, 100% of runs assign three distinct session identifiers to the three default agents — measured across at least 20 consecutive automated cold-start runs of the smoke suite with no shared identifiers observed.
- **SC-002**: On a cold start of the default office, 100% of the three default agents accept and echo typed input in their own terminals — measured by the smoke suite typing a distinct marker into each agent and observing the matching echo in that agent's terminal and only that terminal.
- **SC-003**: On a cold start of the default office where all three underlying CLI processes are alive, 0% of agents reach a startup-timeout state within the startup window — measured across the same 20 consecutive automated cold-start runs.
- **SC-004**: The mean time from app launch to all three default agents reporting a ready status, on cold start with no persisted office sessions, is no worse than the time observed before the fix — measured by the smoke suite or an equivalent timed run, so that fixing the bug does not regress perceived startup speed.
- **SC-005**: On a cold start of the default office, 100% of copy-from-terminal attempts (selection plus standard copy shortcut, and selection plus context-menu copy) place exactly the selected text on the system clipboard — measured across all three default agents in the smoke suite, on every supported platform the suite runs on.
- **SC-006**: A maintainer who runs the repository's existing test commands sees a clear pass/fail signal for the default-office cold-start invariants, with a failure message that names which invariant (distinct sessions, responsive input, no false timeout, working copy-from-terminal) was violated — verified by intentionally regressing each invariant in a throwaway change and confirming a distinct, actionable failure.

## Assumptions

- The default office continues to host exactly three agents (Gene, Dan, Alice) for the purposes of these tests; the fix itself must not assume that count, but the smoke tests target the current default roster.
- The existing startup window of approximately one minute remains the contract for "startup timed out"; the fix is to make the ready signal arrive correctly within that window, not to extend the window.
- The repository's existing unit/integration test harness and end-to-end test harness are the correct places to add the new smoke tests; no new test framework is introduced.
- Behavior changes are expected and required, because this is a bug-fix specification rather than a parity-preserving one. Existing behavior is correct only where it does not contradict the requirements above.
- Operator-visible session-creation log lines already exist in some form and can be relied on as the audit surface for FR-007; if they do not exist in a usable form, adding them is in scope as part of this fix.
- The reference repository `agency-cowork-main` is consulted for prior art on multi-session orchestration and on terminal clipboard integration, but its code is not copied; only patterns and conventions that are applicable to this codebase are adopted.
- "Platform's standard copy keyboard shortcut" means the conventional shortcut for the host operating system (for example, Ctrl+C on Windows/Linux where it does not conflict with terminal interrupt, Cmd+C on macOS). The exact key binding and any disambiguation with terminal interrupt is left to the implementation as long as the operator-visible behavior in User Story 3 holds.

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: Phaser remains the sole in-canvas renderer. All changes happen in the terminal server, the per-office session state, the DOM terminal overlay, the input focus manager, and the test harness; no new in-canvas rendering paths are introduced.
- **Event & Input Boundary**: Renderer-to-main coordination continues to flow through the existing event and IPC channels. Input focus changes between agent terminals must continue to pass through the input focus manager rather than directly manipulating keyboard handlers, which is the root invariant being repaired in User Story 1.
- **Session Integrity Impact**: This work directly targets the agent session lifecycle (open, attach, persistence, ready signal). It must preserve session continuity across office switches and across meeting/fleet transitions, as called out in FR-010.
- **Configuration Impact**: No new configuration is introduced. Agent rosters, layouts, and feature flags remain config-driven; the fix lives in the cold-start and input-routing code paths, not in special-case scene logic.
- **Regression Plan**: The smoke tests in User Story 4 are the regression plan: three distinct session identifiers, three responsive terminals, working copy-from-terminal on every agent, and no false startup-timeout, runnable through the repository's existing test commands, with explicit environment-blocked marking allowed only with documented rationale matching the prior-feature convention.
