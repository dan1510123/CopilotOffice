# Feature Specification: Auto-Startup of Known Agents

**Feature Branch**: `009-auto-startup-known-agents`
**Created**: 2026-06-12
**Status**: Draft
**Input**: User description (two rules):
1. "When the app is first launched (cold start), every agent in the currently selected office that has a persisted session with a non-empty title should be automatically started up (its Copilot CLI PTY session spawned and brought to the 'ready' state), without the user having to click each agent individually."
2. "Everyone in any newly selected office that has a non-empty title on their latest session should start up." (Applies to office switches during a running app session, in addition to the cold-launch case from rule #1.)

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Returning user finds their known agents already warm (Priority: P1)

A user who has been working with a few agents in an office closes the app for the day. The next morning they relaunch CopilotOffice. The office they last had selected loads, and every agent they have previously had a real conversation with begins spinning up automatically in the background. By the time the user walks their avatar over to one of those NPCs and presses E, the agent is already (or almost) at the "ready" state and they can begin typing immediately, instead of waiting for a fresh `copilot` CLI cold start.

**Why this priority**: This is the core "warm on launch" value of the feature.

**Independent Test**: With a `.data/{officeId}.sessions.json` containing at least one agent entry whose `metadata.{agentId}.title` is a non-empty string and a corresponding `current.{agentId}` uuid, cold-start the app. Observe that without any user interaction the agent's status badge transitions from `slacking` to `starting` to `ready`, and that opening the terminal for that agent shows the resumed conversation rather than a fresh session.

**Acceptance Scenarios**:

1. **Given** the persisted session file for the currently selected office lists agents A, B, and C, where A and B have non-empty `metadata.*.title` values and C has either no metadata entry or an empty title, **When** the app cold-starts and finishes loading the office, **Then** agents A and B automatically transition `slacking → starting → ready` without user input, and agent C remains `slacking` until the user interacts with it.
2. **Given** agent A's `current[A]` uuid points to an existing prior session, **When** auto-startup spawns A's PTY, **Then** the spawned session resumes that uuid (same path the user gets by pressing E today), not a brand-new session.
3. **Given** auto-startup is in progress for several agents, **When** the user opens the office tab bar, walks their avatar around the Phaser scene, or opens the overview dashboard, **Then** all of those surfaces are interactive and render normally; auto-startup never blocks the UI from appearing or responding.
4. **Given** an agent finishes auto-startup, **When** the user subsequently presses E on that NPC, **Then** no additional spawn occurs — the existing ready session is attached to the terminal overlay.

---

### User Story 2 - User switches office and finds its known agents warming up (Priority: P1)

During a single running app session, the user switches from their current office to a different one (via the office tab bar or any other office-selection surface). Every agent in the newly selected office whose latest persisted session has a non-empty title automatically begins spinning up, just as it would have on cold launch. The user does not need to walk to each NPC individually to "wake them up" — by the time they orient themselves in the new office, the known agents are already coming online.

**Why this priority**: Office switches are a primary workflow (the user defined multiple offices precisely to context-switch between projects). Without rule #2, rule #1 only helps the office that happened to be selected at launch, and every other office still requires manual per-agent activation after switching to it. This makes the warm-on-arrival behavior consistent across all offices the user works in.

**Independent Test**: Launch the app with office X selected (auto-startup runs for X per rule #1). Once X is settled, select office Y from the office tab bar, where `.data/Y.sessions.json` has at least one agent with a non-empty title. Observe that without further user interaction the qualifying agents in Y transition `slacking → starting → ready`, while agents in X retain whatever state they were already in.

**Acceptance Scenarios**:

1. **Given** the user is running the app with office X selected and office Y has not yet been selected this session, **When** the user selects office Y from the office tab bar, **Then** every agent in Y with a non-empty `metadata.*.title` automatically transitions `slacking → starting → ready` without further user input.
2. **Given** the user selects office Y and its qualifying agents begin auto-startup, **When** the user then switches back to office X, **Then** the agents that were already spawned in X retain their existing session state (auto-startup does not re-spawn or disturb them), and any in-flight auto-startup for Y continues to completion in the background.
3. **Given** office Y has been selected once in the current app session and its auto-startup has already run, **When** the user navigates away from Y and later selects Y again, **Then** auto-startup does NOT re-spawn agents that are already started; only agents that are still `slacking` and now qualify get spawned (per FR-006's no-double-spawn rule).
4. **Given** the user rapidly switches between offices X → Y → Z in quick succession, **When** the switches resolve, **Then** each office's qualifying agents are auto-started exactly once per app session and the UI remains responsive throughout (rapid switching MUST NOT cause duplicate spawns or wedged status badges).

---

### Edge Cases

- **No persisted session file for the selected office** (cold-launch or office switch): Auto-startup has nothing to do; every agent stays `slacking`. App must still launch / switch normally.
- **Session file exists but no agent has a non-empty title**: Auto-startup is a no-op for that office; no PTYs are spawned by the trigger.
- **Selected office at boot is empty/invalid**: Once OfficeManager resolves a valid `currentOfficeId` (or falls back to default), cold-launch auto-startup runs against whatever office ends up selected. If no office can be resolved, auto-startup does not run.
- **The persisted `current[agentId]` uuid no longer corresponds to a resumable session on disk**: Auto-startup falls back to the same behavior the user would get pressing E today (start a fresh session for that agent); the agent must not be left wedged in `starting`.
- **PTY spawn fails for an individual agent** (e.g., `copilot` CLI not on PATH, exit during startup): That agent's status reflects the failure through the existing error/badge path; failure of one agent MUST NOT abort auto-startup for the remaining agents in the same office.
- **User presses E on an agent that is currently mid-auto-startup**: The terminal opens against the in-flight session; no duplicate PTY is spawned.
- **User switches to an office whose auto-startup has already run earlier this session**: Auto-startup is NOT re-triggered for agents that are already started; only agents still `slacking` (e.g., title appeared via a new session in another office's flow — unlikely but possible) would be considered, and the no-double-spawn rule (FR-006) still governs.
- **User switches away from an office while its auto-startup is still in flight**: In-flight spawns continue to completion in the original office. Status badges in that office update normally even though the user is now viewing a different office.
- **Rapid office switching (X → Y → Z in quick succession)**: Each office's auto-startup runs at most once per app session. Rapid switching MUST NOT cause duplicate spawns or leave badges wedged.
- **Many qualifying agents in one office**: All of them start in parallel; the system must not serialize them so aggressively that the last agent is still `starting` minutes later. (Throughput target captured in Success Criteria.)

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: After the selected office is resolved and its persisted session metadata is loaded — on either (a) cold launch for the office selected at boot, or (b) any office selection during a running app session for an office whose auto-startup has not yet run this session — the system MUST identify the set of agents in that office for which `metadata[agentId].title` exists and is a non-empty string ("known agents").
- **FR-002**: For each known agent identified by FR-001, the system MUST automatically initiate the same session-resume flow that runs today when the user first interacts with that NPC, using the uuid in `current[agentId]` as the session to resume.
- **FR-003**: Auto-startup MUST run asynchronously and MUST NOT block the Phaser scene, office tab bar, overview dashboard, office switching, or any other UI surface from appearing or becoming interactive.
- **FR-004**: While an agent is being auto-started, its visible status MUST transition through the existing `slacking → starting → ready` badge states so the user sees progress, identical to manual startup today.
- **FR-005**: Agents whose persisted metadata has no entry, has an empty/whitespace-only title, or has no `current[agentId]` uuid MUST remain in `slacking` and MUST NOT have a PTY spawned by auto-startup.
- **FR-006**: If a user manually opens an agent (presses E or clicks its dashboard card) while auto-startup for that same agent is in flight, the system MUST attach to the existing in-flight session rather than spawning a second PTY for that agent.
- **FR-007**: Failure of auto-startup for any single agent (spawn error, resume failure, CLI not found, etc.) MUST be surfaced through the existing per-agent error/status channel and MUST NOT prevent auto-startup from continuing for other qualifying agents.
- **FR-008**: Auto-startup MUST run at most once per office per app session. Selecting an office that has already had its auto-startup run this session MUST NOT re-trigger spawns for agents that are already started.
- **FR-009**: When a known agent's persisted `current[agentId]` uuid cannot be resumed (e.g., the underlying session no longer exists), the system MUST fall back to the same behavior used today when the user manually opens an unresumable agent, so that the agent does not remain stuck in `starting`.
- **FR-010**: Switching away from an office while its auto-startup is still in flight MUST NOT cancel the in-flight spawns; they continue to completion in the original office, and that office's status badges update normally even while the user is viewing a different office.
- **FR-011**: Rapid office switching (e.g., X → Y → Z in quick succession) MUST result in each office's auto-startup running at most once and MUST NOT produce duplicate spawns or leave any agent's badge wedged in an intermediate state.

### Key Entities *(include if feature involves data)*

- **Persisted session metadata file** (`.data/{officeId}.sessions.json`): existing per-office record with `current`, `history`, and `metadata` maps. This feature consumes it read-only at boot to decide which agents qualify.
- **Known agent**: an agent (NPC) in the currently selected office whose persisted metadata has a non-empty `title`. This is the unit the feature targets.
- **Agent session state machine**: existing per-agent lifecycle (`slacking → starting → ready`, plus error states) driven by the terminal server. Auto-startup is an additional trigger into this same machine — no new states are introduced.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a user with N known agents in their selected office, after a cold launch the number of agents requiring a manual "press E to start the CLI" interaction before becoming ready drops from N to 0.
- **SC-002**: The app's main UI (Phaser scene visible, office tabs rendered, avatar movable) becomes interactive within the same time budget as before this feature — auto-startup does not increase perceived launch time by more than a marginal amount (target: no user-noticeable regression in time-to-first-interaction).
- **SC-003**: With up to 8 known agents in the selected office, all of them reach `ready` (or a terminal error state) within a small multiple of the time a single agent takes to start manually today — i.e., parallel rather than strictly serial startup.
- **SC-004**: When a user walks to a known agent and presses E within a few seconds of launch (or office switch), in the typical case the terminal opens onto an already-ready session with no additional waiting.
- **SC-005**: Zero double-spawn incidents: across cold-start runs and office-switch sequences, no agent ends up with more than one PTY because both auto-startup and a manual interaction tried to start it.
- **SC-006**: Switching to an office where auto-startup has not yet run this session MUST visibly initiate the same `slacking → starting → ready` flow for its known agents within a short delay of the switch completing, and switching itself must remain as responsive as it is today (no user-noticeable regression in office-switch time).
- **SC-007**: Across a single app session, for any given office, auto-startup runs exactly once regardless of how many times the user navigates to that office.

## Assumptions

- This spec covers **rules #1 and #2 of a larger agent-startup redesign**. Additional rules (e.g., behavior when the user manually closes an agent, configurability/opt-out, behavior when the title changes mid-session) will be specified separately and are intentionally out of scope here.
- "Currently selected office" at boot is whatever `OfficeManager.loadFromStorage` resolves `currentOfficeId` to, including its fallback to the default office when storage is empty or invalid.
- Office "selection" for rule #2 includes any user-initiated office switch surface (office tab bar today, plus any future equivalent). Programmatic office changes (e.g., the durable-load path that sets `currentOfficeId` after async file load on cold launch) count as the rule-#1 trigger for that office, not a separate rule-#2 trigger.
- The existing manual-startup flow (the path triggered today when the user presses E or clicks a dashboard card) is the canonical "start one agent" primitive. Auto-startup invokes this primitive once per qualifying agent rather than introducing a separate spawn path.
- The "non-empty title" signal is sufficient to mean "this agent had a real conversation worth resuming" because titles are server-generated from the first non-empty user message of a session and persisted in `metadata[agentId].title`.
- "Per app session" in FR-008 / SC-007 means a single Electron main-process lifetime. A renderer reload, if one occurs, is treated as a continuation of the same app session and does not re-trigger auto-startup for any office.
- Manual agent close/reopen and any user-facing toggle to disable auto-startup are **out of scope** for this spec and will be revisited in subsequent rules of this feature family.
- The existing per-agent error/status surfaces (badges, toasts, logs) are adequate for reporting auto-startup failures; no new failure-reporting UI is introduced by this spec.
- Cold start is defined as the Electron app process being newly launched (not a renderer reload or office switch within an already-running app).

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: No new in-canvas rendering is introduced. Status badge transitions (`slacking → starting → ready`) reuse the existing Phaser-driven status display; auto-startup only triggers existing state transitions earlier.
- **Event & Input Boundary**: Auto-startup is wired by reusing the existing "open agent / start session" primitive that is already event-driven through the renderer → preload → main → terminal-server boundary. No new direct cross-layer coupling is introduced, and no input-handling paths change (InputManager is unaffected because auto-startup requires no user input).
- **Session Integrity Impact**: Auto-startup is a new trigger into the existing agent terminal/session lifecycle and MUST preserve resume semantics (session uuid from `current[agentId]` is reused, not replaced). Per FR-006 and SC-005, it MUST NOT cause duplicate PTYs when a manual interaction races with auto-startup. Per FR-009, it MUST NOT leave agents wedged when a stored uuid is no longer resumable.
- **Configuration Impact**: No new configuration surface is introduced in this rule. The qualifying-agent set is derived entirely from the already-persisted `.data/{officeId}.sessions.json` metadata. If future rules in this family require user-facing opt-out, that will be added through typed configuration rather than hardcoded scene logic, consistent with Principle V.
- **Regression Plan**: Targeted verification covers (a) cold start with a session file containing a mix of titled and untitled agents — only titled ones spawn; (b) cold start with no session file — no spawns, app launches normally; (c) manual E-press on an agent that is mid-auto-startup — single PTY, single session resumed; (d) one agent's spawn failure does not block the others; (e) UI surfaces (Phaser scene, office tab bar, overview dashboard) render and respond during auto-startup; (f) switching to a not-yet-warmed office mid-session triggers its auto-startup exactly once and leaves the previous office's sessions undisturbed; (g) switching back to an already-warmed office does NOT respawn its agents; (h) rapid X→Y→Z office switching produces no duplicate spawns or wedged badges; (i) office-switch responsiveness is not noticeably regressed. These mirror the high-risk flows called out in Principle IV (terminal lifecycle, office switching) and Principle III (session continuity).
