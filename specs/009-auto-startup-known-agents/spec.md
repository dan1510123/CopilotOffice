# Feature Specification: Auto-Startup of Known Agents

**Feature Branch**: `009-auto-startup-known-agents`
**Created**: 2026-06-12
**Status**: Draft
**Input**: User description (rules):
1. "When the app is first launched (cold start), every agent in the currently selected office that has a persisted session with a non-empty title should be automatically started up (its Copilot CLI PTY session spawned and brought to the 'ready' state), without the user having to click each agent individually."
2. "Everyone in any newly selected office that has a non-empty title on their latest session should start up." (Applies to office switches during a running app session, in addition to the cold-launch case from rule #1.)
3. "When the user clicks 'New Session' on an agent, the current session is auto-closed and a fresh session is auto-started immediately afterward (so the agent ends back in the `ready` state on the new session without any further user input). When the user clicks 'Close Session', the session closes and nothing else happens (the agent goes back to `slacking` and stays there)."
4. "Auto-startup is governed by a user-facing Settings toggle (default ON). When the toggle is OFF, NO agents start automatically — including the pre-existing roster pre-start behavior that previously warmed every agent on cold-launch regardless of whether they had a saved session. Setting=OFF MUST deliver a truly manual-only experience: every agent stays `slacking` until the user clicks it (or presses E)."

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

### User Story 3 - "New Session" returns the agent straight to ready (Priority: P2)

The user is working with an agent that has an active session. They click the "New Session" control to start a fresh conversation. Today this leaves the agent in `slacking` until they press E or click the dashboard card again. With this rule, the system closes the current session and immediately auto-starts a new one in its place, so the agent transitions `ready → (closing) → starting → ready` on a brand-new session without any further user input. The "Close Session" control, by contrast, only closes — it never auto-restarts. The user can use Close Session deliberately when they want the agent quiet (back in `slacking`).

**Why this priority**: "New Session" is overwhelmingly used as "I'm done with this conversation, give me a fresh one" — leaving the agent dead afterward is friction. Keeping Close Session as a deliberate "go quiet" action preserves the user's ability to silence an agent.

**Independent Test**: With an agent in the `ready` state on session uuid U1, click "New Session". Observe that the badge transitions through `closing → starting → ready` automatically, the new session uuid U2 differs from U1, and no manual interaction was required to reach the final `ready` state. Then, with the same agent in `ready`, click "Close Session". Observe that the badge transitions to `slacking` and stays there.

**Acceptance Scenarios**:

1. **Given** an agent is in the `ready` state on session U1, **When** the user clicks "New Session", **Then** session U1 is closed and a fresh session U2 (≠ U1) is automatically started and brought to `ready` without further user input.
2. **Given** an agent is in the `ready` state on session U1, **When** the user clicks "Close Session", **Then** session U1 is closed, the agent returns to `slacking`, and NO new session is started automatically.
3. **Given** the user clicks "New Session" while an auto-restart from a previous "New Session" click is still in flight, **Then** the system MUST NOT spawn multiple concurrent replacement sessions for the same agent — only one fresh session ends up in `current[agentId]`.
4. **Given** "New Session" was clicked and the close step succeeds but the subsequent auto-start fails (e.g., spawn error), **Then** the agent surfaces the failure through the existing error path and ends in `slacking` (or the appropriate error state), exactly as if the user had clicked "Close Session" then manually pressed E and had that fail.

---

### User Story 4 - User can disable auto-startup from Settings (Priority: P2)

A user on a constrained machine, or one who prefers manual control over which agents are warm, opens Settings and toggles "Auto-start known agents" OFF. From that point forward — including future cold launches and office switches — no auto-startup trigger fires. All agents stay `slacking` until the user opens them manually, exactly as they did before this feature shipped. Toggling the setting back ON restores the auto-startup behavior on the next applicable trigger (next cold launch or next office selection of an office not yet warmed this session).

**Why this priority**: The auto-startup feature trades resource use (PTYs, CPU, memory) for convenience. Users on lower-spec machines, or users who prefer deliberate control, need an escape hatch. The setting is also the right surface to address the "what if I have 40 known agents across 5 offices?" concern: lazy per-office warming already bounds the worst case to one office's agents at a time, but the toggle lets the user opt out entirely.

**Independent Test**: With the setting ON (default), cold-start the app with a populated session file; observe known agents auto-start. Quit, set the setting to OFF, cold-start again with the same data; observe NO auto-startup occurs (every agent stays `slacking`). Switch offices to a different populated office; observe NO auto-startup occurs there either. Re-enable the setting from Settings; switch to a not-yet-warmed office; observe auto-startup runs for that office's known agents.

**Acceptance Scenarios**:

1. **Given** the "Auto-start known agents" setting is OFF, **When** the app cold-starts with a populated session file, **Then** no PTYs are spawned by auto-startup and every agent remains `slacking` until manual interaction.
2. **Given** the setting is OFF, **When** the user switches to an office whose `.data/{officeId}.sessions.json` has known agents, **Then** no auto-startup runs for that office and every agent stays `slacking`.
3. **Given** the setting is OFF, **When** the user clicks "New Session" on a `ready` agent, **Then** the current session is closed but NO replacement session is auto-started (rule #3's auto-restart is also gated by this toggle).
4. **Given** the setting was OFF and the user toggles it ON, **When** the user subsequently cold-launches or selects a not-yet-warmed office, **Then** auto-startup runs normally for that office's known agents. Offices already visited under OFF this session are not retroactively warmed until next cold launch.
5. **Given** the setting is at its default after a fresh install, **When** the user has never opened Settings, **Then** the setting is ON and the feature is active.

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
- **Total known agents across all offices is large (e.g., 40+)**: At any given moment, only the currently selected office's known agents are warmed (per-office lazy warming per rule #2). The system MUST NOT pre-warm offices the user has not selected this session, so resource usage scales with offices-visited, not total-offices-defined.
- **"New Session" clicked on an agent that is not in `ready`** (e.g., still `starting`, or in an error state): The system MUST handle this gracefully — either queue the new-session request to fire once the close completes, or short-circuit with the same behavior as a manual close + manual press-E. The agent MUST NOT end up wedged.
- **"New Session" clicked rapidly (double-click or in quick succession)**: The agent MUST end up with exactly one fresh session in `current[agentId]`, not multiple concurrent replacements.
- **"Close Session" clicked**: Session is closed, agent returns to `slacking`, and NO auto-restart fires. This applies regardless of the auto-startup setting.
- **Auto-startup setting toggled OFF mid-session**: In-flight auto-startup spawns that have already begun MUST complete normally (the toggle gates trigger evaluation, not in-flight work). Offices not yet warmed this session will not be warmed while the setting is OFF.
- **Fleet sub-agents** (fleet-vteam offices): Out of scope for this spec. Auto-startup MUST NOT spawn fleet sub-agent PTYs even if their parent fleet office is selected. Only canonical NPC agents (the ones defined in `customAgents` / standard office rosters) are considered.

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
- **FR-012**: When the user invokes the "New Session" control on an agent, the system MUST close the agent's current session and then automatically start a fresh session for that agent, leaving it in the `ready` state without further user input (transition: `ready → closing → starting → ready` on a new uuid).
- **FR-013**: When the user invokes the "Close Session" control on an agent, the system MUST close the agent's current session and leave the agent in `slacking`. It MUST NOT automatically start any replacement session.
- **FR-014**: Rapid or repeated "New Session" clicks on the same agent MUST result in exactly one fresh session in `current[agentId]` — the system MUST coalesce or sequence the requests to prevent multiple concurrent replacement spawns.
- **FR-015**: If the close portion of a "New Session" sequence succeeds but the subsequent auto-start fails, the failure MUST be surfaced through the existing per-agent error/status channel and the agent MUST NOT be left wedged in an intermediate state (it ends in `slacking` or an explicit error state).
- **FR-016**: A user-facing setting (located in the Settings surface) labeled "Auto-start known agents" (or equivalent) MUST gate every auto-startup trigger defined by this spec (cold-launch per FR-001(a), office-switch per FR-001(b), and post-"New Session" auto-restart per FR-012). Default value: ON.
- **FR-017**: When the setting is OFF, NO agent-startup behavior whatsoever MUST fire automatically. This explicitly includes (a) all spec-009 triggers (cold-launch warm, office-switch warm, post-"New Session" auto-restart) AND (b) the pre-existing roster pre-start path (`OfficeScene.preStartAgentSessions`, originally introduced by spec 002) that would otherwise warm every agent in the current office on cold-launch / office-switch regardless of whether they had a saved session. Under setting=OFF, every agent MUST stay `slacking` until the user explicitly interacts with it (presses E or clicks the dashboard card). "New Session" under setting=OFF behaves as a plain close (equivalent to "Close Session"). "Close Session" behavior is unaffected by the setting.
- **FR-018**: Toggling the setting MUST take effect on the next applicable trigger (cold launch, office switch to a not-yet-warmed office, or next "New Session" click). In-flight auto-startup spawns at the moment of toggling MUST complete normally — the toggle gates trigger evaluation, not in-flight work.
- **FR-019**: The setting value MUST persist across app restarts via the same configuration mechanism used by other Settings entries.
- **FR-020**: Auto-startup MUST only consider canonical NPC agents (the ones defined in the office's agent roster, including `customAgents`). Fleet sub-agent PTYs (dynamic children spawned by fleet-vteam orchestration) MUST NOT be auto-started by this feature.

### Key Entities *(include if feature involves data)*

- **Persisted session metadata file** (`.data/{officeId}.sessions.json`): existing per-office record with `current`, `history`, and `metadata` maps. This feature consumes it read-only to decide which agents qualify for auto-startup, and writes to it (via the existing session-lifecycle path) when "New Session" replaces `current[agentId]`.
- **Known agent**: an agent (NPC) in a given office whose persisted metadata has a non-empty `title`. This is the unit auto-startup targets.
- **Agent session state machine**: existing per-agent lifecycle (`slacking → starting → ready → closing → slacking`, plus error states) driven by the terminal server. Auto-startup, "New Session" auto-restart, and the Settings gate are additional triggers/conditions on this same machine — no new states are introduced.
- **Auto-start setting**: a single boolean configuration value, default ON, surfaced in Settings and persisted across app restarts. Gates every auto-startup trigger in this spec.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For a user with N known agents in their selected office, after a cold launch the number of agents requiring a manual "press E to start the CLI" interaction before becoming ready drops from N to 0.
- **SC-002**: The app's main UI (Phaser scene visible, office tabs rendered, avatar movable) becomes interactive within the same time budget as before this feature — auto-startup does not increase perceived launch time by more than a marginal amount (target: no user-noticeable regression in time-to-first-interaction).
- **SC-003**: With up to 8 known agents in the selected office, all of them reach `ready` (or a terminal error state) within a small multiple of the time a single agent takes to start manually today — i.e., parallel rather than strictly serial startup.
- **SC-004**: When a user walks to a known agent and presses E within a few seconds of launch (or office switch), in the typical case the terminal opens onto an already-ready session with no additional waiting.
- **SC-005**: Zero double-spawn incidents: across cold-start runs and office-switch sequences, no agent ends up with more than one PTY because both auto-startup and a manual interaction tried to start it.
- **SC-006**: Switching to an office where auto-startup has not yet run this session MUST visibly initiate the same `slacking → starting → ready` flow for its known agents within a short delay of the switch completing, and switching itself must remain as responsive as it is today (no user-noticeable regression in office-switch time).
- **SC-007**: Across a single app session, for any given office, auto-startup runs exactly once regardless of how many times the user navigates to that office.
- **SC-008**: After clicking "New Session" on a `ready` agent, the agent reaches `ready` again on a different session uuid within the time budget of one manual session start, with zero additional user interactions required.
- **SC-009**: After clicking "Close Session" on a `ready` agent, the agent reaches `slacking` and stays there indefinitely (no spurious restart fires within at least the next 60 seconds of idle time).
- **SC-010**: With the "Auto-start known agents" setting OFF, zero auto-startup PTYs are spawned across cold launch + 3 office switches + 1 "New Session" click on a previously-ready agent. The user can still manually start every agent exactly as before this feature shipped.
- **SC-011**: Resource scaling: in the worst case where the user has K offices defined with N known agents each, the maximum number of PTYs warmed by auto-startup at any one time is bounded by the agents in offices the user has actually selected this session (not K×N).

## Assumptions

- This spec covers **rules #1–#4 of the agent-startup redesign**. Additional refinements (e.g., per-office or per-agent opt-out granularity beyond the single global toggle, smarter title-change handling) may be specified separately and are out of scope here.
- "Currently selected office" at boot is whatever `OfficeManager.loadFromStorage` resolves `currentOfficeId` to, including its fallback to the default office when storage is empty or invalid.
- Office "selection" for rule #2 includes any user-initiated office switch surface (office tab bar today, plus any future equivalent). Programmatic office changes (e.g., the durable-load path that sets `currentOfficeId` after async file load on cold launch) count as the rule-#1 trigger for that office, not a separate rule-#2 trigger.
- The existing manual-startup flow (the path triggered today when the user presses E or clicks a dashboard card) is the canonical "start one agent" primitive. Auto-startup invokes this primitive once per qualifying agent rather than introducing a separate spawn path.
- The "non-empty title" signal is sufficient to mean "this agent had a real conversation worth resuming" because titles are server-generated from the first non-empty user message of a session and persisted in `metadata[agentId].title`.
- "Per app session" (FR-008, SC-007) means a single Electron main-process lifetime. A renderer reload, if one occurs, is treated as a continuation of the same app session and does not re-trigger auto-startup for any office.
- Title can flip from empty → non-empty as the user types their first message into a freshly-started agent. Per FR-008 that office's auto-startup has already run, so the agent is not retroactively "auto-started" — but it is already started by virtue of the user interacting with it, so this is fine in practice and explicitly not treated as a separate trigger.
- An agent's prior session ending in an error or crash does NOT disqualify it from auto-startup; failures are usually transient (network, CLI launch race) and the user benefits from another attempt. If the second attempt also fails, FR-007/FR-009 ensure it surfaces and does not wedge.
- Resource scaling is handled by per-office laziness (rule #2 only warms the office the user actually selects) plus the global Settings toggle (rule #4) as the escape hatch. No additional per-agent or per-office concurrency cap is introduced by this spec.
- "Settings" refers to the existing user-facing settings surface in the app; integration follows the existing pattern for boolean toggles there.
- Fleet sub-agent PTYs (children spawned by fleet-vteam orchestration) are explicitly out of scope. Only canonical NPCs (office roster + `customAgents`) are eligible for auto-startup.
- The existing per-agent error/status surfaces (badges, toasts, logs) are adequate for reporting auto-startup and auto-restart failures; no new failure-reporting UI is introduced by this spec.
- Cold start is defined as the Electron app process being newly launched (not a renderer reload or office switch within an already-running app).

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: No new in-canvas rendering is introduced. Status badge transitions reuse the existing Phaser-driven status display; auto-startup and "New Session" auto-restart only trigger existing state transitions earlier. The Settings toggle reuses the existing DOM-based Settings UI (no new Phaser surfaces).
- **Event & Input Boundary**: Auto-startup and the post-"New Session" auto-restart are wired by reusing the existing "open agent / start session" and "close session" primitives that already cross renderer → preload → main → terminal-server through the established event boundary. No new direct cross-layer coupling is introduced. The Settings toggle is read via the existing typed configuration channel. InputManager is unaffected because auto-startup requires no user input and "New Session" / "Close Session" already route through their current handlers.
- **Session Integrity Impact**: Auto-startup and auto-restart are new triggers into the existing agent terminal/session lifecycle and MUST preserve resume semantics for rules #1/#2 (session uuid from `current[agentId]` is reused, not replaced). For rule #3, "New Session" intentionally replaces `current[agentId]` with a fresh uuid — this is the existing close+spawn-new path, just chained automatically. FR-006/FR-014 and SC-005 protect against duplicate PTYs across all triggers (auto-startup racing manual interaction, rapid "New Session" double-clicks). FR-009/FR-015 ensure failure paths do not leave agents wedged. FR-020 explicitly excludes fleet sub-agents so the long-standing fleet PTY/key handling (see CopilotOffice known limitations) is not disturbed.
- **Configuration Impact**: One new typed configuration value is introduced — the "Auto-start known agents" boolean (default ON), surfaced in the existing Settings UI and persisted through the existing settings storage mechanism (FR-016/FR-019). No hardcoded scene logic; the toggle is read at trigger evaluation time so changes take effect on the next applicable trigger (FR-018). Consistent with Principle V.
- **Regression Plan**: Targeted verification covers (a) cold start with a session file containing a mix of titled and untitled agents — only titled ones spawn; (b) cold start with no session file — no spawns, app launches normally; (c) manual E-press on an agent that is mid-auto-startup — single PTY, single session resumed; (d) one agent's spawn failure does not block the others; (e) UI surfaces (Phaser scene, office tab bar, overview dashboard, Settings) render and respond during auto-startup; (f) switching to a not-yet-warmed office mid-session triggers its auto-startup exactly once and leaves the previous office's sessions undisturbed; (g) switching back to an already-warmed office does NOT respawn its agents; (h) rapid X→Y→Z office switching produces no duplicate spawns or wedged badges; (i) office-switch responsiveness is not noticeably regressed; (j) "New Session" on a `ready` agent results in exactly one fresh `ready` session with no manual interaction; (k) rapid double-clicks of "New Session" produce exactly one replacement session; (l) "Close Session" leaves the agent in `slacking` indefinitely with no auto-restart; (m) close-succeeds-but-spawn-fails path leaves the agent in a clean error/`slacking` state, not wedged; (n) Settings toggle OFF gates all three triggers (cold-launch, office-switch, post-New-Session) and toggling back ON re-enables on next applicable trigger; (o) fleet sub-agent PTYs are not auto-started even when their parent fleet office is selected. These mirror the high-risk flows called out in Principle IV (terminal lifecycle, office switching, settings/overlay focus) and Principle III (session continuity).
