# Feature Specification: Office Orchestrator Agent

**Feature Branch**: `016-office-orchestrator`  
**Created**: 2026-07-14  
**Status**: Draft  
**Input**: User description: "Create an almost new higher layer on top of an office (like an office orchestrator / admin for real) that can help me manage all of the sessions in the office. Bring an agent online for me after I ask in natural language what agent to bring up (not necessarily by name), with a TUI to see the orchestrator agent's chat."

## Clarifications

### Session 2026-07-14

- Q: Should the orchestrator be backed by a real dedicated agent? → A: **Yes** — a
  dedicated persistent Copilot "orchestrator agent" session; the natural-language
  bring-online is handled by chatting with it, shown in its TUI.
- Q: How does the orchestrator agent's decision become a real action? → A: The
  orchestrator agent is given a **real tool** (e.g. `bring_agent_online`, exposed as
  an MCP tool) that it invokes when it decides. The orchestrator agent runs in its
  **own dedicated SDK session** (a real Copilot session via the SDK backend,
  `@github/copilot-sdk`), so its tool calls are gated by the SDK session's
  **`PermissionHandler`**: when the tool is invoked, the app receives a permission
  request, surfaces an approve/deny in the orchestrator chat/TUI, and only an
  approved call proceeds — its handler then signals the app to run the existing
  bring-online path; denial is returned to the agent.
- Q: How does the gate behave under YOLO mode? → A: The orchestrator agent is
  brought up in its **own SDK session that is NOT in YOLO mode**, independent of the
  global YOLO toggle (which drives the node-pty office terminals' `--yolo` launch).
  Its `bring_agent_online` tool is therefore **always gated** — the permission
  handler always prompts. The global YOLO setting does not auto-approve the
  orchestrator agent's tools.
- Q: How should the NL "bring up whoever can do X" flow act on its pick? → A: The
  orchestrator agent ranks candidates and **requires user approval** (via the gate)
  before starting. If the description doesn't clearly match any available agent, it
  **reports "no good match"** and the user can pick manually from the full roster.
- Q: Which agents should "bring online" be able to start? → A: **Both** — start an
  idle/slacking agent already seated in an office, AND activate a reserve agent
  into an open seat and then start it (scoped to the currently viewed office).

### Session 2026-07-15

- Q: What is the FIRST (and only) in-scope build? → A: **The Orchestrator Agent
  only.** The earlier situational-awareness board is **out of scope** and moved to
  the deferred roadmap; the initial build ships the conversational, gated
  bring-online agent and nothing else.
- Q: With the full-screen board gone, how is the orchestrator agent's chat TUI
  surfaced? → A: **A hotkey/button opens a focused panel/overlay containing just the
  orchestrator chat TUI** (dimming the game behind it). There is no board.

> **Initial build scope (this implementation)**: **User Story 1 (the Orchestrator
> Agent) only.** The situational-awareness board (US2), direct control (US3), and
> task board / orchestration (US4) are **specified but deferred** — they remain in
> this document as the roadmap for later phases and are out of scope for the initial
> build.

## Overview

Today the user manages agents one at a time: they walk the player sprite to a
specific NPC and open that NPC's terminal, and they must already know which agent
they want. This does not scale once there are many agents across many offices
(reserves, fleet agents, multiple offices) and it assumes the user knows the exact
agent to summon.

The **Office Orchestrator Agent** is a higher-level control plane whose unit of work
is the **session/agent**, not the NPC. Its first and only in-scope capability is a
dedicated, conversational **orchestrator agent**: the user opens a focused panel and,
in natural language, asks for the kind of help they need ("someone to review
security", "help me debug this") without naming an agent. The orchestrator agent
reasons over the available roster, decides who fits, and invokes a **real, gated
tool** to bring that agent online — with the user approving the action inline.

The broader control-plane vision (a cross-office awareness board, direct control of
any session, and a self-running task backlog) is preserved below as a **deferred
roadmap** that this agent-with-gated-tools substrate is designed to extend.

- **In scope — Orchestrator Agent (conversational bring-online)**: a hotkey/button
  opens a focused panel/overlay containing a **dedicated orchestrator agent** — a
  real, persistent Copilot session running in its **own SDK session**, with its own
  interactive chat TUI. You chat with it in natural language to bring an agent
  online; it decides and invokes a **real tool** to do it, gated by the SDK session's
  **permission handler** (approve/deny surfaced in the orchestrator chat). Its SDK
  session is **not in YOLO mode**, so bring-online is always gated regardless of the
  global YOLO toggle.
- **Deferred — Situational awareness board**: a surface showing every active agent
  across all offices (pinned "needs your attention" section, grouped by office with
  roll-ups, live timers).
- **Deferred — Direct control**: answer a waiting agent, start/stop/restart,
  broadcast a prompt, and jump-to an agent.
- **Deferred — Orchestration**: a task backlog with auto-assignment to idle agents,
  dependency chains, and automation policies.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bring the right agent online by describing what you need (Priority: P1 — initial build)

The user presses a hotkey (or clicks a button) and a **focused panel/overlay** opens
containing just the **orchestrator agent's chat TUI** (dimming the game behind it).
The panel hosts a dedicated **orchestrator agent** — a real, persistent Copilot
session running in its **own SDK session** — whose chat is rendered from the SDK
session's events.

The user **chats with the orchestrator agent in natural language** ("someone to
review security", "help me debug this") rather than picking an agent by name, and
watches its reasoning in the TUI. The orchestrator agent is equipped with a **real
tool** (for example `bring_agent_online`, exposed as an MCP tool); when it decides
who fits — ranking available candidates (idle seated agents + activatable reserves in
the current office) by how well their configured skill/description matches the
request — it **invokes that tool**.

Because the orchestrator agent runs in its own SDK session, the tool call is gated by
that session's **permission handler**: the app receives the permission request and
surfaces an **approve/deny** in the orchestrator chat, naming the target agent, and
the user decides right there. Approval lets the tool complete — its handler signals
the app to run the bring-online (start an idle seated agent, or activate a reserve
into an open seat and start it); denial is returned to the agent so it can adjust or
propose another candidate. The orchestrator's SDK session is **not in YOLO mode**, so
this gate always applies regardless of the global YOLO toggle (which only affects the
node-pty office terminals). If the agent finds no good fit, it says so in chat and the
user can pick manually from the full roster. No session mutation ever occurs on an
un-approved tool call.

**Why this priority**: This is the highest-ROI, self-contained slice and establishes
the agent-with-gated-tools substrate that every deferred phase extends. It solves a
concrete pain — getting the right agent working without knowing its name and without
walking office-by-office — while staying small: one real orchestrator-agent session,
one gated tool, and reuse of the existing start-session / reserve-activation path. It
is a viable MVP on its own.

**Independent Test**: With a roster that includes at least one idle/slacking seated
agent and (in a reserve-supporting office) at least one activatable reserve, open the
orchestrator panel, describe a need in natural language, watch the agent propose a
candidate and raise an approve/deny prompt, approve it, and confirm the chosen agent
begins starting up. Repeat and **deny** the prompt; confirm nothing is mutated. Repeat
with the global YOLO toggle ON and confirm the prompt is still raised.

**Acceptance Scenarios**:

1. **Given** the orchestrator panel is opened for the first time, **When** it opens,
   **Then** the orchestrator agent starts (or reattaches to) its own persistent SDK
   session with its bring-online tool available and its permission handler
   registered, and its chat TUI is interactive.
2. **Given** the orchestrator panel is open, **When** the user describes the agent
   they need in natural language, **Then** the orchestrator agent invokes its
   bring-online tool, the SDK session's permission handler raises an approve/deny
   request that the app surfaces in the orchestrator chat naming the target agent,
   and the app performs the bring-online only if the user approves.
3. **Given** the orchestrator agent proposes a tool call, **When** the user approves
   it, **Then** the target agent is brought online — an idle/slacking seated agent is
   started, or a reserve is activated into an open seat and started (slacking →
   starting → ready).
4. **Given** the orchestrator agent proposes a tool call, **When** the user denies
   it, **Then** no session is mutated and the denial is returned to the agent so it
   can adjust or pick another candidate.
5. **Given** the user's description doesn't clearly match any available agent,
   **When** the orchestrator agent evaluates candidates, **Then** it reports "no good
   match" in chat and the user can pick manually from the full roster.
6. **Given** the global YOLO toggle is ON (auto-approving the node-pty office
   terminals), **When** the orchestrator agent invokes its bring-online tool, **Then**
   the tool is still gated — the orchestrator's SDK session is not in YOLO mode, so
   the approve/deny request is always raised.
7. **Given** the orchestrator agent invokes its tool with an invalid/unknown target
   (nonexistent agent, or an office with no open seat / no reserves), **When** the
   tool handler runs, **Then** it refuses and returns the problem to the agent rather
   than mutating anything.
8. **Given** the orchestrator panel is open, **When** the user closes it, **Then**
   input focus returns to the game via the input manager and no session (including
   the orchestrator agent's) is killed; reopening reattaches the same session.

---

### User Story 2 - See every active session, never miss a blocker (Priority: P2 — deferred)

> **Deferred**: Specified for the roadmap; NOT part of the initial build.

The user opens a board (as a full-screen overlay) and immediately sees every
**active** agent across all offices with its current status, how long it has been in
that status, what it is doing, and its unread count. A dedicated "Attention" section
is pinned at the top and surfaces any agent that is waiting for input, has errored, or
appears stalled; below it, agents are grouped by office with a per-office roll-up.
Idle reserves are not shown as status cards. Live elapsed timers keep ticking while
the board is open.

**Why this priority**: Awareness across offices is high value but is a larger
presentation surface than the initial build; it can layer on top of the orchestrator
agent (which already knows the roster) once shipped.

**Independent Test**: With several active agents running across two offices (at least
one waiting for input, one thinking, one errored), open the board and confirm it lists
all active agents with correct status/timer/detail, that waiting/errored/stalled
agents appear in the pinned Attention section, and that per-office roll-ups are
correct.

**Acceptance Scenarios**:

1. **Given** active agents exist in more than one office, **When** the user opens the
   board, **Then** it lists every **active** agent from every office (not only the
   current office) with its status label, live elapsed timer, activity detail, and
   unread count.
2. **Given** an agent transitions to waiting-for-input, **When** the board is
   visible, **Then** that agent appears in the pinned Attention section within the
   system's bounded status-delay target.
3. **Given** an agent has been in the same active state past the stall threshold,
   **When** the board is visible, **Then** that agent is visually flagged as a
   possible stall in the Attention section.
4. **Given** each office, **When** the board is visible, **Then** a per-office
   roll-up shows how many of its active agents are waiting, thinking, and errored.
5. **Given** an agent goes idle or another is brought online, **When** the board is
   open, **Then** it updates (card removed / added) without a manual refresh.

---

### User Story 3 - Act on any session without walking to it (Priority: P3 — deferred)

> **Deferred**: Specified for the roadmap; NOT part of the initial build.

From the board, the user can drive any session directly: type an answer to an agent
that is waiting for input, start / stop / restart a session, send the same prompt to a
selected group of agents at once, and "jump to" an agent (switch to its office and
open its terminal) when they want the full terminal view.

**Why this priority**: Awareness without action still forces the user to walk to each
agent to respond. Direct control turns the board into a true cockpit. It builds on
existing session-routing plumbing.

**Independent Test**: With one agent waiting for input, answer it from the board and
confirm the agent resumes. Select two idle agents, broadcast a prompt, and confirm
both receive it. Click jump-to on a third agent and confirm the app switches to its
office with its terminal open.

**Acceptance Scenarios**:

1. **Given** an agent is waiting for input, **When** the user submits an answer from
   the board, **Then** the answer is delivered to that agent's session and the agent
   leaves the waiting state.
2. **Given** any agent, **When** the user triggers start / stop / restart from the
   board, **Then** the session lifecycle action is applied and the agent's status
   reflects the change.
3. **Given** the user selects multiple agents and enters a broadcast prompt, **When**
   they confirm, **Then** each selected agent receives that prompt as a new turn and
   a per-agent delivery result (sent / failed) is shown.
4. **Given** any agent, **When** the user triggers jump-to, **Then** the app switches
   to that agent's office and opens that agent's terminal with focus routed through
   the input manager.
5. **Given** a lifecycle or delivery action fails, **When** it fails, **Then** the
   failure is surfaced to the user (not silent) and the board state stays consistent
   with the actual session state.

---

### User Story 4 - Queue work and let the office run itself (Priority: P4 — deferred)

> **Deferred**: Specified for the roadmap; NOT part of the initial build.

The user adds tasks to a backlog instead of hand-assigning each one. The Orchestrator
assigns queued tasks to idle agents automatically (respecting a concurrency cap), lets
the user chain tasks so one starts only after its prerequisite completes, and applies
simple automation policies (for example, auto-nudge a stalled agent, or auto-restart
on error) so the office keeps moving while the user is away.

**Why this priority**: This is the most powerful but highest-complexity slice, and it
depends on earlier slices (status truth and control actions) being in place. It
generalizes the existing plan-driven fleet execution into user-authored,
always-available orchestration. Shipping it last keeps earlier slices unblocked.

**Independent Test**: Add three tasks to the backlog with two idle agents and a
concurrency cap of two; confirm two tasks start immediately and the third starts when
an agent frees up. Chain task B after task A and confirm B does not start until A
completes. Enable auto-nudge and confirm a stalled agent is nudged.

**Acceptance Scenarios**:

1. **Given** queued tasks and idle agents, **When** an agent is idle and the
   concurrency cap is not exceeded, **Then** the Orchestrator assigns the next
   eligible task to that agent and moves it to in-progress.
2. **Given** a task chained to depend on another, **When** the prerequisite has not
   completed, **Then** the dependent task remains queued and is not assigned.
3. **Given** a prerequisite task completes, **When** capacity is available, **Then**
   its dependent task becomes eligible and is assigned.
4. **Given** an auto-nudge policy is enabled, **When** an assigned agent is flagged as
   stalled past threshold, **Then** the Orchestrator applies the configured nudge and
   records that it did so.
5. **Given** the concurrency cap is reached, **When** more tasks are queued, **Then**
   no additional tasks are assigned until an in-progress task finishes.

---

### Edge Cases

**Initial build (Orchestrator Agent)**

- **Orchestrator agent fails to start / crashes**: the panel surfaces the failure and
  remains usable; the user can still bring agents online via manual selection from the
  roster.
- **Orchestrator agent invokes a tool with an invalid/unknown target** (e.g. an agent
  id that doesn't exist, or an office with no open seat / no reserves): the tool
  handler refuses and returns the problem to the agent rather than acting on it.
- **Bring-online while the target agent is already starting/active**: must be a no-op
  (no duplicate session start).
- **NL request matches multiple candidates equally**: the agent surfaces the top
  candidates for the user to disambiguate rather than making an arbitrary pick.
- **NL request while every candidate is already active**: the agent reports there is
  nothing to bring online rather than a false match.
- **Bringing an agent online fails to start its session**: the failure is surfaced to
  the user (not silent) and the agent's state stays consistent with reality.
- **User dismisses the panel while a permission request is pending**: the pending tool
  call is treated as denied (not silently approved) and returned to the agent.
- **Global YOLO is toggled while the orchestrator agent session is running**: it has
  no effect on the orchestrator agent — its SDK session is always non-YOLO, so the
  gate still applies.
- **Focus handoff between the panel/TUI, the approve/deny prompt, and the game**:
  typing in the TUI must not leak to game controls; all focus transitions route
  through the input manager.
- **Panel open during an office switch or roster change**: the candidate roster the
  agent reasons over reflects the new state and no session is killed.

**Deferred (board / direct control / task board)**

- **Agent status changes while a control action is in flight**: the action must
  reconcile against the real session state and not corrupt the board.
- **Jump-to during an office switch or fleet transition**: must preserve session
  continuity (attach/detach, not kill) and not break event forwarding.
- **Broadcast that partially fails**: some recipients succeed, some fail — each result
  is reported individually.
- **Duplicate answer submission** to a waiting agent (double-click / stale card): must
  not deliver the same answer twice.
- **Task assigned to an agent that dies or errors mid-task**: the task returns to an
  actionable state (re-queued or flagged) rather than being silently lost.
- **Dependency cycle authored by the user** (A depends on B depends on A): must be
  detected and rejected/flagged rather than deadlocking the queue.
- **Concurrency cap changed while tasks are running**: newly lowered caps must not
  kill running work; they gate only future assignment.

## Requirements *(mandatory)*

### Functional Requirements

**Orchestrator Agent (initial build)**

- **FR-001**: The system MUST provide a hotkey/button that opens a **focused
  panel/overlay** containing the orchestrator agent's chat TUI (dimming the game
  behind it). There is no situational-awareness board in the initial build.
- **FR-002**: The panel MUST host a dedicated **orchestrator agent** — a real,
  persistent Copilot session running in its **own SDK session** (`@github/copilot-sdk`
  backend) — with its own interactive chat TUI rendered from the SDK session's events.
  The session MUST start (or reattach) when the panel is first opened and MUST persist
  across panel open/close without being killed, consistent with real-session
  integrity.
- **FR-003**: The orchestrator agent MUST be equipped with a real **bring-online
  tool** (exposed as an MCP tool to its SDK session) it can invoke to request starting
  a described agent, and MUST be able to interpret a natural-language description (not
  requiring an exact name), ranking available candidate agents (idle seated +
  activatable reserves in the current office) by how well their configured
  skill/description fits the request. If the agent finds no good fit, it MUST say so in
  chat and the user can pick manually from the full roster.
- **FR-004**: When the orchestrator agent invokes the bring-online tool, the SDK
  session's **permission handler** MUST raise an approve/deny request that the app
  surfaces in the orchestrator chat (identifying the target agent). On approval the
  tool completes and its handler signals the app to run the existing bring-online path;
  on denial the call is returned to the agent. No session mutation MUST occur on an
  un-approved tool call.
- **FR-005**: The orchestrator agent's SDK session MUST run with a permission posture
  that is **not YOLO/auto-approve**, independent of the global YOLO toggle; every
  bring-online tool invocation MUST therefore be gated by user approval, and the app
  MUST surface tool-call outcomes (approved/denied/failed) rather than failing
  silently. The permission flow MUST preserve real session/event-forwarding semantics
  and MUST NOT corrupt the agent's session on approve, deny, or error.
- **FR-006**: On an approved tool call, the app MUST perform "bring an agent online" —
  able to (a) start an idle/slacking agent already seated in the currently viewed
  office and (b) activate a reserve agent into an open seat in the currently viewed
  office (when the office's layout supports reserves) and then start it. Started agents
  transition slacking → starting → ready. The tool handler MUST refuse invalid targets
  (nonexistent agent, no open seat, no reserves) and MUST be a no-op if the target is
  already starting/active.
- **FR-007**: Opening and closing the panel MUST route input focus through the input
  manager (suspend game input on open, resume on close), and focus transitions between
  the game and the orchestrator agent TUI (where the approve/deny prompt is answered
  inline) MUST also go through the input manager so terminal keystrokes never leak to
  game controls. Opening/closing the panel MUST NOT kill any existing agent session
  (including the orchestrator agent's). The panel MUST layer via the shared `ZIndex`
  registry.

**Situational awareness board (deferred, not in initial build)**

- **FR-008**: The system MUST provide a board that lists every **active** agent across
  all offices (not only the current office); idle/slacking agents MUST NOT appear as
  status cards.
- **FR-009**: For each active agent, the board MUST display its canonical status
  label, a live elapsed timer for active states, an activity detail line, and its
  unread count, all derived from the single agent-status presentation source of truth.
- **FR-010**: The board MUST present an "Attention" section, pinned at the top, that
  surfaces agents that are waiting for input, in an error state, or flagged as stalled
  (using the existing stall threshold, without inventing a new agent state), ordered so
  the most user-blocking items appear first.
- **FR-011**: Below the Attention section, the board MUST group active agents by office
  with a per-office roll-up summarizing how many of that office's active agents are
  waiting, thinking, and errored, and MUST update automatically as agents change,
  appear, or go idle.

**Direct control (deferred, not in initial build)**

- **FR-012**: Users MUST be able to submit an answer to an agent that is waiting for
  input directly from the board, delivered into that agent's session.
- **FR-013**: Users MUST be able to start, stop, and restart an agent's session from
  the board, with the board reflecting the resulting status.
- **FR-014**: Users MUST be able to select multiple agents and broadcast a single
  prompt to all of them, receiving a per-agent delivery result.
- **FR-015**: Users MUST be able to "jump to" an agent, which switches to that agent's
  office and opens its terminal with input focus routed through the input manager.
- **FR-016**: The system MUST surface every control-action failure to the user and
  MUST NOT deliver a duplicate answer/prompt when the same action is triggered more
  than once for the same pending request.

**Orchestration (deferred, not in initial build)**

- **FR-017**: The system MUST let users add tasks to a backlog, where each task carries
  the instruction/prompt and optional targeting or dependency metadata.
- **FR-018**: The system MUST automatically assign eligible queued tasks to idle
  agents, respecting a configurable concurrency cap.
- **FR-019**: Users MUST be able to declare that one task depends on another, and the
  system MUST NOT assign a dependent task until its prerequisite completes; dependency
  cycles MUST be detected and rejected/flagged rather than deadlocking the queue.
- **FR-020**: The system MUST support at least the automation policies "auto-nudge on
  stall" and "auto-restart on error," each independently toggleable, and MUST record
  when a policy action was applied.
- **FR-021**: When an in-progress task's agent dies or errors, the system MUST return
  that task to an actionable state rather than losing it silently.

**Cross-cutting**

- **FR-022**: The Orchestrator MUST derive all status labels, colors, and icons from
  the shared agent-status presentation configuration and MUST NOT hardcode per-surface
  status labels, colors, or icons. *(Applies to the in-scope build only if the
  orchestrator panel renders agent status for a candidate/target; otherwise this is a
  deferred-board concern. See T019, T017.)*
- **FR-023**: The Orchestrator MUST reference agents and offices by their configured
  identifiers/registries and MUST NOT hardcode agent IDs in its logic.
- **FR-024**: All Orchestrator actions MUST preserve real Copilot session semantics
  end-to-end, including attach/detach continuity across office switches (sessions are
  detached, never killed, on switch).
- **FR-025**: The Orchestrator's state model MUST be pure data, separate from
  rendering, consistent with the existing multi-office state boundary.
- **FR-026** *(deferred — task-board phase)*: Deferred-phase settings that should survive a restart (concurrency cap,
  enabled policies) and the task backlog MUST be persisted through the established
  persistence boundary. On restart, persisted queued tasks MUST be restored, but
  in-flight assignment state MUST NOT be resumed: any task in-progress at shutdown is
  returned to the queued state so it can be re-assigned cleanly.

### Key Entities *(include if feature involves data)*

- **Orchestrator Agent**: A dedicated, persistent Copilot session running in its own
  **SDK session** that powers the natural-language bring-online flow. It converses with
  the user in its chat TUI and is equipped with a real (MCP) bring-online tool; its SDK
  session is non-YOLO, so tool calls are always gated by the session's permission
  handler. It has its own lifecycle/status like other agents but is a meta-agent scoped
  to the panel rather than seated in an office layout.
- **Bring-Online Tool + Permission Gate**: The real MCP tool the orchestrator agent
  invokes to request a bring-online, plus the SDK session's permission handler applied
  to it (approve → tool completes and the handler signals the app to execute; deny →
  returned to the agent). Always active because the orchestrator's SDK session is
  non-YOLO. This is the extensible substrate the deferred phases grow with more gated
  agent tools.
- **Bring-Online Request**: The action to start a dormant agent, triggered by an
  **approved** orchestrator-agent tool call (or, on "no good match", by explicit manual
  selection). Carries the target agent, the rationale (when agent-initiated), the
  approval decision, and a result (started / denied / failure).
- **Orchestrator View State** *(deferred)*: The aggregated, cross-office snapshot the
  board renders — the set of agents with their presentation-resolved status, timers,
  activity details, unread counts, per-office roll-ups, and the derived Attention
  ordering. Read-only projection over existing office/agent state.
- **Control Action** *(deferred)*: A user-initiated operation targeting one or more
  agents — answer, start, stop, restart, broadcast, jump-to — with a result (success or
  a surfaced failure reason) per targeted agent.
- **Backlog Task** *(deferred)*: A unit of queued work with an instruction, optional
  agent targeting, optional dependency on another task, and a lifecycle state
  (queued → assigned/in-progress → completed / failed / re-queued).
- **Orchestration Policy** *(deferred)*: A toggleable automation rule (for example,
  auto-nudge on stall, auto-restart on error) plus a record of when it last acted.
- **Orchestrator Settings** *(deferred)*: Persisted configuration — concurrency cap,
  enabled policies, and the task backlog. In-flight assignments are not persisted;
  tasks in-progress at shutdown are restored as queued.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can bring the right agent online by describing the need in natural
  language to the orchestrator agent (without knowing the agent's name), watching its
  reasoning in the TUI, and approving the tool call via the SDK session's approve/deny
  prompt; denying mutates nothing. *(initial build)*
- **SC-002**: Because the orchestrator's SDK session is non-YOLO, no bring-online tool
  call ever completes without user approval — regardless of the global YOLO setting —
  verified with YOLO both off and on. *(initial build)*
- **SC-003**: From an approved request, a user can bring an idle seated agent online,
  and activate a reserve into an open seat, in a single approval each, and the newly
  started agent reaches an active state. *(initial build)*
- **SC-004**: The orchestrator agent runs as a real persistent session that survives
  panel open/close and is interactive in its TUI; its presence never kills or detaches
  office agent sessions, and closing the panel returns focus to the game via the input
  manager. *(initial build)*
- **SC-005**: No bring-online failure is silent: 100% of failed or denied bring-online
  requests produce a user-visible outcome. *(initial build)*
- **SC-006**: From a cold open of the board, the user can identify every agent that
  currently needs their input in one glance, without switching offices, in under 5
  seconds. *(deferred)*
- **SC-007**: The board reflects an agent status change within the system's bounded
  status-delay target for 100% of observed transitions. *(deferred)*
- **SC-008**: A user can respond to a waiting agent from the board in fewer
  interactions than the walk-to-NPC flow requires, reducing steps by at least half.
  *(deferred)*
- **SC-009**: With N idle agents and a concurrency cap of C, the Orchestrator keeps
  exactly min(N, C, queued-eligible-tasks) tasks running at steady state, verified
  across at least three queue/cap combinations. *(deferred)*

## Assumptions

- The orchestrator agent runs in its **own SDK session that is not in YOLO mode**,
  separate from the node-pty office terminals that honor the global YOLO `--yolo` flag
  (`src/config/yoloMode.ts`). Its bring-online tool is therefore always gated,
  independent of the global YOLO toggle.
- The gate reuses the **SDK session's permission handler** (`PermissionHandler`,
  already used by the SDK/ui-server backend); the tool is exposed to the session as an
  MCP tool whose handler signals the app to run the existing bring-online path on
  approval.
- The orchestrator agent's chat TUI is rendered from the SDK session's events
  (`session.on(...)`) via the existing SDK/ui-server terminal surface, not a new
  terminal implementation; its session is a real Copilot session like other agents.
- The orchestrator panel is a focused DOM overlay within the existing split-layout
  model (launched by a hotkey/button, dimming the game behind it); in-canvas gameplay
  remains Phaser-rendered and the panel's chrome is DOM, consistent with the current
  overlay model. It layers via the shared `ZIndex` registry and wires open/close to
  `InputManager.suspendGameInput()` / `resumeGameInput()`.
- Natural-language agent matching is performed by the orchestrator agent reasoning over
  the candidates' existing configured `skill`/`description` metadata, which it acts on
  by invoking its bring-online tool.
- "Bring an agent online" reuses the existing start-session and reserve-activation
  paths (respecting each layout's `supportsReserveAgents` behavior); it is scoped to
  the currently viewed office in the initial build.
- "Stall" and "waiting/error/thinking/ready" semantics are exactly those already
  defined by the status-presentation module; the Orchestrator adds no new agent states.
- Deferred phases read exclusively from existing multi-office agent state and the
  shared status-presentation module; they introduce no parallel status model. Their
  session control actions reuse the existing session plumbing and event forwarding
  rather than a new transport, and auto-assignment (task board) generalizes the
  existing plan-driven fleet execution rather than adding a separate execution engine.

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: The orchestrator panel is a DOM overlay surface within the
  existing split-layout model; all in-canvas gameplay stays Phaser-rendered. No new
  in-canvas renderer is introduced. Overlay layering uses the shared `ZIndex` registry,
  not ad hoc values.
- **Event & Input Boundary**: All coordination between the Orchestrator and the rest of
  the app flows through the established event bus and documented IPC channels; focus
  transitions between the game, the approve/deny prompt, and the orchestrator agent TUI
  route through `InputManager` so terminal keystrokes never leak to game controls. No
  direct cross-layer coupling or ad hoc keyboard handling.
- **Session Integrity Impact**: The initial build adds a real persistent
  orchestrator-agent session running in its **own SDK session** (its chat TUI renders
  from `session.on(...)` events) that MUST start/reattach and survive panel open/close
  without being killed, and MUST NOT kill or detach office agent sessions. The
  orchestrator agent is given a real **bring-online tool** (an MCP tool) gated by the
  SDK session's **permission handler**; the tool handler signals the app to run the
  existing start-session / reserve-activation path on approval. The orchestrator SDK
  session is non-YOLO (independent of the global toggle), so bring-online is always
  gated. This touches the terminal/SDK session and tool pipeline (a high-risk,
  regression-prone area per repo guidance) and MUST preserve event forwarding and
  session continuity on approve, deny, and error. (Deferred jump-to detach/reattach
  relates to BL-004.)
- **Configuration Impact**: Status presentation is sourced from
  `agentStatusPresentation.ts`; agent/office identity from the config registries and
  named constants; deferred concurrency cap and policies live in typed, persisted
  configuration — no hardcoded status strings, colors, icons, or agent IDs.
- **Regression Plan**: For the initial build cover (a) the orchestrator agent's
  bring-online **tool call gated by the SDK session's permission handler** — approve
  executes via the tool handler, deny returns to the agent without mutation, invalid
  target is refused, already-active target is a no-op, a dismissed panel treats a
  pending request as denied, and the orchestrator's non-YOLO session stays gated even
  when global YOLO is on — with no un-approved tool call ever completing; (b)
  bring-online reusing the start-session / reserve-activation path (idle seated +
  reserve into open seat); and (c) orchestrator-agent session persistence across panel
  open/close without disturbing office sessions, plus focus routing through
  `InputManager`. Deferred slices additionally cover cross-office aggregation and
  Attention ordering, control-action success/failure surfacing + duplicate-answer
  guard, jump-to detach/reattach continuity, and task-board assignment respecting
  concurrency cap and dependency gating including cycle rejection. Run the existing
  Vitest suite for impacted areas and the Playwright smoke path for boot/switch.

---

## Extensions (implemented, folded into this spec)

### Office navigation tools (Workstream A)

Two additional orchestrator SDK tools give it cross-office orientation: **list_offices**
(read-only) returns every office (id, name, layout, isCurrent, agent counts), and
**switch_office** (ungated — non-destructive/reversible) changes the currently open
office. Both follow the existing renderer round-trip pattern and are documented in
contracts/orchestrator-tools.md.

### Teams-remote orchestrator (Workstream B)

The orchestrator can be brought online as a Microsoft Teams remote agent (reusing the
spec-011 register/route/reply machinery) so a user can drive it by replying in its
channel thread. Because the orchestrator is a main-process SDK session (not an office
terminal session), this uses an alternate OrchestratorSessionGateway selected by a
CompositeSessionGateway on the synthetic `(__orchestrator__, orchestrator)` key.

**Non-YOLO invariant preserved via a permission relay.** The orchestrator registers
only onPermissionRequest (no ask_user path), so its always-on approval gate is
relayed into the thread as a distinct permission-request AgentEvent → Approve/Deny
prompt. An in-thread `approve`/`A` or `deny`/`D` reply routes to
gateway.respondPermission(...) (not submitAnswer). Unanswered gates auto-deny after
5 minutes; a superseding request auto-denies the prior one; goOffline detaches
without killing the orchestrator session. A remote switch_office also changes the
on-screen desktop office (accepted + documented).
