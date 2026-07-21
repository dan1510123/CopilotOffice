# Feature Specification: Office Orchestrator Improvements — Top-10 Scenarios, Tooling & Persistent Transcript

**Feature Branch**: `016-office-orchestrator` (continuation — no new branch)
**Created**: 2026-07-17
**Status**: Draft
**Input**: User description: "Office-orchestrator improvements: more tooling, and a
better-rendered TUI for the orchestrator agent so I can see chat history from turns
that happened over Teams. It could not show me request history from the same session
without me asking. Go through the top 10 scenarios for using the orchestrator and make
sure we build all the tooling around them — including bringing an agent online in Teams
(activating their Teams remote / connection). History should persist across app restarts."

## Context

Spec 016 shipped the **Office Orchestrator Agent**: a dedicated, persistent Copilot
SDK session opened from a focused panel/overlay, driven in natural language, with a
single gated mutation (`bring_agent_online`) plus office discovery/navigation
(`list_office_agents`, `list_offices`, `switch_office`) and a Teams-remote presence for
the orchestrator itself. A recent change added minimize (keep running in the
background) vs. close (end session) semantics so the orchestrator can keep answering in
a Teams thread while its overlay is hidden.

Two gaps motivate this feature:

1. **The orchestrator is blind to what agents are *doing*.** Its only tools discover
   *dormant* candidates and bring one online. It cannot report which agents are active,
   what they are working on, who is stuck waiting for input, nor act on an already-online
   agent (answer it, send it a follow-up, stop/restart it, peek its output, or put it on
   Teams). Users must walk to each NPC terminal to do any of this — the exact
   one-at-a-time problem the orchestrator was meant to remove.

2. **The orchestrator's own chat history is not durable or fully rendered.** When the
   panel is minimized/closed and reopened — or when turns arrive via the Teams thread
   while the overlay is hidden — the reopened TUI shows a blank slate. The session
   (main-process) still holds context, but the panel cannot *show* it: the user had to
   literally ask "what did I just ask?" to recover history that should simply be on
   screen. History is also lost entirely when the app restarts.

This feature closes both gaps by enumerating the **top-10 orchestrator scenarios** and
delivering the tooling and transcript behavior each one needs.

## The Top-10 Scenarios (traceability map)

| #  | Scenario ("I want to…")                                              | Capability / tooling                         | Status in 016 |
|----|----------------------------------------------------------------------|----------------------------------------------|---------------|
| 1  | Bring an agent online by capability, not by name                     | `list_office_agents` + `bring_agent_online`  | ✅ Delivered  |
| 2  | Find/bring the right agent when it lives in another office            | `list_offices` + `switch_office`             | ✅ Delivered  |
| 3  | See what every active agent is working on right now                  | `get_active_agents` (US2)                    | 🆕 This spec  |
| 4  | Know who is stuck / waiting on me                                    | `list_agents_awaiting_input` (US3)           | 🆕 This spec  |
| 5  | Unblock a waiting agent by answering its question                   | `answer_agent` (gated) (US4)                 | 🆕 This spec  |
| 6  | Send a follow-up prompt/task to an already-online agent             | `send_prompt_to_agent` (gated) (US5)         | 🆕 This spec  |
| 7  | Stop / restart / take an agent offline                              | `stop_agent` / `restart_agent` (gated) (US6) | 🆕 This spec  |
| 8  | Peek what an agent recently did (its latest output)                 | `get_agent_transcript` (US7)                 | 🆕 This spec  |
| 9  | Bring an agent online in Teams (activate its Teams remote)          | `set_agent_teams_presence` (gated) (US8)     | 🆕 This spec  |
| 10 | Re-open the orchestrator and see full history, incl. Teams turns    | Persistent transcript + TUI replay (US1)     | 🆕 This spec  |

Scenarios 1–2 are retained as the baseline and are **not** re-implemented here; they are
listed so the top-10 map is complete. This spec delivers scenarios 3–10 as User
Stories US1–US8 below.

## Clarifications

### Session 2026-07-17

- Q: Multi-office scope of the status/act-on tools — current office only, or all offices? → A: All offices (tools span every office); each agent returned MUST include its office in the response for context.
- Q: How should the persistent orchestrator TUI look/behave for rendering and input? → A: Mirror the agent TUI structure, bound to the orchestrator's session id, scrollable via Page Up / Page Down; the only difference is input is accepted **solely** through the textbox — the TUI itself is view-only (visual, not directly typeable like agent terminals), making it mostly-visual/partially-functional.
- Q: Should the orchestrator TUI be visually distinguished from agent terminals? → A: Yes — the orchestrator's xterm uses a distinct green "hacker" terminal theme (near-black background, bright phosphor-green foreground/cursor) to set it apart. This styling is orchestrator-only; agent terminals keep their existing theme.
- Q: What is the transcript retention bound (FR-006)? → A: Mirror how agent TUIs work today — a bounded xterm scrollback window per session (the existing scrollback-line cap, e.g. the orchestrator panel's current 5000 lines), which resets on a new session; persistence stores that same bounded window for restart-restore. No separate unbounded transcript log.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Persistent, fully-rendered orchestrator transcript (Priority: P1)

As the person driving the orchestrator, when I reopen the panel — after minimizing,
after closing and reopening, after turns arrived over Teams while it was hidden, or even
after restarting the app — I see the full prior conversation (my prompts, the
orchestrator's replies, tool approvals/denials, and Teams-originated turns) already
rendered in the TUI, without having to ask the orchestrator to recall it.

**Why this priority**: This is the concrete, reported pain (screenshot: the orchestrator
could not show request history from the same session without being asked). It undermines
trust in the whole surface — a control plane you cannot review is not a control plane.
It is independently valuable even if no new tools ship.

**Independent Test**: Drive a few turns (including one via the Teams thread while the
overlay is minimized), reopen the panel, and confirm every turn — in order, correctly
attributed to desktop vs. Teams origin — is visible without prompting the agent. Restart
the app and confirm the transcript is still present on next open.

**Acceptance Scenarios**:

1. **Given** an orchestrator session with several prior turns, **When** I minimize and
   reopen the panel, **Then** the full transcript is replayed in the TUI in original
   order and I can scroll back through all of it.
2. **Given** the orchestrator is online in a Teams thread and the overlay is minimized,
   **When** someone drives a turn from the thread, **Then** on reopen that turn appears in
   the desktop TUI, visibly marked as originating from Teams.
3. **Given** a prior orchestrator session, **When** I quit and relaunch the app and open
   the panel, **Then** the previous conversation is restored and rendered.
4. **Given** I explicitly close the session (red ✕), **When** I later open the panel,
   **Then** a new session starts with a clean transcript and the closed session's history
   is no longer shown as the active conversation.
5. **Given** a long transcript, **When** it is replayed, **Then** rendering stays readable
   and responsive (no visual corruption, correct role/attribution styling, working
   scrollback).

---

### User Story 2 - See what every active agent is working on (Priority: P1)

As the person driving the orchestrator, I ask in natural language "what's everyone
working on?" / "give me a status roll-up" and the orchestrator reports, in a single tool
call, every agent that has a live session across the relevant office(s): who they are,
their status — explicitly including `done` (finished/awaiting ack), `waiting` (blocked on
input), and `thinking`/working — a short description of their current activity, and how
long they have been in that state.

**Why this priority**: This is the second reported scenario (the screenshot conversation
was a status question the orchestrator could not answer from tools). Situational
awareness is the foundation for every act-on-an-agent scenario (US3–US8).

**Independent Test**: With two or more agents active in different states, ask the
orchestrator for a status roll-up and confirm it returns each agent's identity, status,
current activity, and elapsed time — matching what the in-world badges/dashboards show.

**Acceptance Scenarios**:

1. **Given** multiple agents in varying states (including at least one `done`, one
   `waiting`, and one `thinking`), **When** I ask "what's everyone working on?", **Then** a
   single tool call lists every one of them with status, activity summary, and
   time-in-state — no state category is omitted.
2. **Given** no agents are active, **When** I ask for a status roll-up, **Then** the
   orchestrator clearly reports that nobody is currently active.
3. **Given** agents span more than one office, **When** I ask for status, **Then** the
   orchestrator's report indicates which office each agent belongs to.
4. **Given** an agent's status is derived data, **When** the orchestrator reports it,
   **Then** the reported status/label matches the single agent-status presentation source
   of truth (no divergent labels).

---

### User Story 3 - Know who is stuck / waiting on me (Priority: P2)

As the person driving the orchestrator, I ask "who needs my attention?" / "is anyone
stuck?" and the orchestrator lists only the agents that are blocked waiting for user
input (or otherwise flagged as needing attention), so I can triage without scanning
every terminal.

**Why this priority**: A focused "needs you" list is the highest-signal slice of
situational awareness and the natural entry point to the unblock action (US4). Depends on
the same status substrate as US2.

**Independent Test**: Put one agent into a waiting-for-input state and leave others
working; ask "who needs my attention?" and confirm only the waiting agent is returned,
with enough context (which agent, what it is waiting on) to act.

**Acceptance Scenarios**:

1. **Given** one agent waiting for input and others working, **When** I ask who needs
   attention, **Then** only the waiting agent is listed, with its pending question/context.
2. **Given** nobody is waiting, **When** I ask, **Then** the orchestrator reports that no
   agent currently needs attention.
3. **Given** several agents are waiting, **When** I ask, **Then** all are listed and
   ordered by how long they have been waiting (longest first).

---

### User Story 4 - Unblock a waiting agent (Priority: P2)

As the person driving the orchestrator, when an agent is waiting on a question, I tell
the orchestrator my answer in natural language and — after I approve the gated action —
it delivers that answer into the waiting agent's session, unblocking it.

**Why this priority**: Turns awareness (US3) into action; answering blocked agents is one
of the most frequent manual chores. Gated because it writes into another agent's session.

**Independent Test**: With an agent blocked on a question, have the orchestrator answer it
via the gated tool; confirm the agent receives the answer and resumes, and that the
action required explicit approval.

**Acceptance Scenarios**:

1. **Given** an agent waiting for input, **When** I have the orchestrator answer it and I
   approve the gate, **Then** the answer reaches that agent's session and it resumes.
2. **Given** the same flow, **When** I deny the gate, **Then** nothing is sent and the
   agent remains waiting.
3. **Given** a target agent that is not actually waiting for input, **When** the
   orchestrator attempts to answer it, **Then** the tool reports the target is not
   awaiting an answer rather than silently doing nothing.
4. **Given** an answer is delivered, **When** it completes, **Then** the orchestrator's
   transcript records that the answer was sent and to which agent.

---

### User Story 5 - Send a follow-up prompt/task to an online agent (Priority: P2)

As the person driving the orchestrator, I ask it to hand a new instruction or follow-up
task to a specific already-online agent (by capability or by name), and — after I approve
the gated action — that prompt is delivered into the agent's session.

**Why this priority**: The general "delegate more work to a running agent" action; the
main way the orchestrator drives ongoing work without me opening each terminal.

**Independent Test**: With an online, idle-or-ready agent, have the orchestrator send it a
prompt via the gated tool; confirm the agent begins working on it and the action was
gated.

**Acceptance Scenarios**:

1. **Given** an online agent, **When** I ask the orchestrator to send it a follow-up
   prompt and I approve, **Then** the prompt is delivered and the agent starts on it.
2. **Given** the target agent is not online, **When** the orchestrator tries to send a
   prompt, **Then** the tool reports the agent is not online (optionally offering to bring
   it online first) rather than failing silently.
3. **Given** I deny the gate, **When** the flow ends, **Then** no prompt is sent.

---

### User Story 6 - Stop / restart / take an agent offline (Priority: P3)

As the person driving the orchestrator, I ask it to stop, restart, or take offline a
specific agent, and — after I approve the gated action — the orchestrator performs that
lifecycle change, reporting the outcome.

**Why this priority**: Completes lifecycle control but is the most destructive and least
frequent, so it ships last. Strongly gated.

**Independent Test**: With an online agent, have the orchestrator stop it (and separately
restart it) via the gated tool; confirm the lifecycle change happens, is gated, and the
outcome is reported.

**Acceptance Scenarios**:

1. **Given** an online agent, **When** I have the orchestrator stop it and I approve,
   **Then** the agent is taken offline and the outcome is reported.
2. **Given** an online agent, **When** I have the orchestrator restart it and I approve,
   **Then** the agent's session is restarted and reported ready.
3. **Given** any lifecycle action, **When** I deny the gate, **Then** no change occurs.
4. **Given** a stop/restart target that is already offline or invalid, **When** the action
   is attempted, **Then** the tool reports the invalid target instead of erroring opaquely.

---

### User Story 7 - Peek what an agent recently did (Priority: P2)

As the person driving the orchestrator, I ask "what did agent X just do?" / "summarize
what the debugger found" and the orchestrator retrieves that agent's recent output so it
can summarize or relay it to me — without me opening that agent's terminal.

**Why this priority**: Read-only visibility into another agent's work; high value for
triage and for the orchestrator to reason before delegating (US5) or unblocking (US4).

**Independent Test**: With an agent that has produced output, have the orchestrator fetch
that agent's recent transcript and confirm it can report on the content.

**Acceptance Scenarios**:

1. **Given** an agent with recent activity, **When** I ask what it did, **Then** the
   orchestrator retrieves that agent's recent output and summarizes/relays it.
2. **Given** an agent with no recent output, **When** I ask, **Then** the orchestrator
   reports there is nothing recent for that agent.
3. **Given** the retrieval is read-only, **When** it runs, **Then** it does not require a
   gate and does not alter the target agent's session.

---

### User Story 8 - Bring an agent online in Teams (Priority: P2)

As the person driving the orchestrator, I ask it to bring a specific agent "online in
Teams" (activate that agent's Teams remote / connection) — or to take it offline again —
and, after I approve the gated action, the orchestrator activates/deactivates that
agent's Teams presence, reporting the thread link or outcome.

**Why this priority**: Extends the orchestrator's existing self-Teams capability to *any*
office agent, letting the user stand up remotely-drivable agents conversationally. Gated
because it exposes an agent to an external channel.

**Independent Test**: With the Teams feature enabled, have the orchestrator bring a named
agent online in Teams via the gated tool; confirm the agent's Teams remote activates and
the outcome (e.g., thread link) is reported, and that taking it offline works too.

**Acceptance Scenarios**:

1. **Given** the Teams feature is enabled and an eligible agent, **When** I ask the
   orchestrator to bring that agent online in Teams and I approve, **Then** the agent's
   Teams remote is activated and the orchestrator reports the outcome/thread link.
2. **Given** an agent already online in Teams, **When** I ask the orchestrator to take it
   offline and I approve, **Then** its Teams remote is deactivated and a closing notice is
   posted to the thread.
3. **Given** the Teams feature is disabled or unconfigured, **When** I ask to bring an
   agent online in Teams, **Then** the orchestrator reports Teams is unavailable rather
   than failing silently.
4. **Given** any Teams-presence change, **When** I deny the gate, **Then** no presence
   change occurs.

---

### Edge Cases

- **Transcript vs. active session divergence**: What happens if the persisted transcript
  references a session that no longer exists on restart? The transcript is shown as prior
  history and a fresh live session is created for new input; old history is clearly
  distinguished from the active session.
- **Concurrent drivers (desktop + Teams)**: If a turn arrives from Teams while the user is
  typing in the desktop TUI, both turns must be captured in the transcript in the order
  they were processed, each attributed to its origin.
- **Acting on a stale target**: An agent named in a status roll-up may go offline before
  the user asks the orchestrator to act on it. Act-on tools must re-validate the target at
  execution time and report an invalid/offline target rather than acting on the wrong one.
- **Orchestrator acting on itself / on the orchestrator identity**: Act-on tools must not
  target the synthetic orchestrator identity.
- **Approval while minimized / Teams-only**: A gated act-on request raised while the
  overlay is minimized must follow the same relay/approval rules already established for
  `bring_agent_online` (approvable from Teams when online; not silently auto-denied by a
  background/minimized panel when a remote approver exists).
- **Transcript growth**: A very long-lived session must not grow the persisted transcript
  unbounded to the point of degrading open/replay; there must be a defined retention bound.
- **Multi-office scope of status/act-on tools**: Situational-awareness (read-only) tools
  span **all offices** and MUST label each returned agent with its office; gated act-on
  tools identify their target unambiguously (including office) so they never act on a
  same-named agent in the wrong office.
- **Privacy of another agent's transcript**: `get_agent_transcript` should return a bounded
  recent window, not unbounded scrollback, to keep responses focused.

## Requirements *(mandatory)*

### Functional Requirements

#### Persistent transcript & TUI rendering (US1)

- **FR-001**: The system MUST maintain a durable transcript of the orchestrator session
  capturing, in order, user prompts, orchestrator replies, and tool
  approvals/denials/outcomes.
- **FR-002**: The transcript MUST capture turns regardless of origin (desktop TUI or Teams
  thread) and MUST record each turn's origin.
- **FR-003**: On opening (or reopening) the panel, the system MUST render the existing
  transcript in the TUI in original order, with role/origin attribution, before/without
  requiring the user to prompt the agent for it. The transcript view MUST mirror the agent
  TUI's structure, be bound to the orchestrator's session id, and be scrollable via Page Up
  / Page Down.
- **FR-003a**: The orchestrator transcript TUI is **view-only**: user input MUST be accepted
  solely through the dedicated textbox, not by typing directly into the TUI (unlike agent
  terminals). The TUI is primarily visual and only partially interactive (scrollback only).
  The orchestrator TUI is styled with a distinct green "hacker" terminal theme to set it
  apart visually; this styling is orchestrator-only and does not change agent terminals.
- **FR-004**: The transcript MUST persist across app restarts and be restored on the next
  panel open for the same logical orchestrator conversation.
- **FR-005**: Explicitly closing the session (red ✕) MUST end the active conversation such
  that the next open starts a fresh transcript; the system MUST NOT resurrect a
  user-closed conversation as the active session.
- **FR-006**: The transcript's retention bound MUST mirror the existing agent-TUI model: a
  bounded scrollback window per orchestrator session (the current xterm scrollback-line cap),
  reset on a new session. Persistence stores that same bounded window (not an unbounded log),
  so a long-lived session cannot degrade open/replay performance.
- **FR-007**: Rendering a restored/long transcript MUST remain readable and responsive
  (correct styling, intact scrollback, no visual corruption).

#### Situational awareness tools (US2, US3, US7)

- **FR-008**: The orchestrator MUST have a read-only tool that, in a single call, enumerates
  every agent that currently has a live session — regardless of state, explicitly including
  agents that are `done` (finished, awaiting acknowledgement), `waiting` (blocked on input),
  and `thinking`/working — returning for each: identity (agent + office), status, a short
  current-activity description, and time-in-state. The tool MUST NOT silently omit `done` or
  otherwise idle-but-online agents; a caller asking for "all statuses" receives the complete
  roster in one round-trip.
- **FR-009**: Reported agent status/labels MUST derive from the single agent-status
  presentation source of truth, so orchestrator output does not diverge from in-world
  badges/dashboards.
- **FR-010**: The orchestrator MUST have a read-only tool to enumerate only agents that are
  waiting for user input / flagged as needing attention, including the pending
  question/context and time-in-state, ordered longest-waiting first.
- **FR-011**: The orchestrator MUST have a read-only tool to retrieve a bounded recent
  window of a specified agent's output so it can summarize/relay that agent's recent work.
- **FR-012**: Read-only situational-awareness tools MUST NOT require a permission gate and
  MUST NOT alter any target session.
- **FR-013**: Situational-awareness tools operate across **all offices** (not limited to
  the currently-viewed office), and their output MUST indicate each agent's office so the
  orchestrator can attribute and act on the right target.

#### Act-on-agent tools (US4, US5, US6, US8)

- **FR-014**: The orchestrator MUST have a gated tool to deliver a user-supplied answer to
  an agent that is waiting for input.
- **FR-015**: The orchestrator MUST have a gated tool to send a follow-up prompt/task to a
  specified already-online agent.
- **FR-016**: The orchestrator MUST have gated tool(s) to stop, restart, and take offline a
  specified agent.
- **FR-017**: The orchestrator MUST have a gated tool to activate or deactivate a specified
  agent's Teams remote presence.
- **FR-018**: Every act-on-agent tool MUST be gated by the orchestrator's always-on
  permission handler, independent of the global YOLO setting, consistent with
  `bring_agent_online`; a denied gate MUST result in no change.
- **FR-019**: Every act-on-agent tool MUST re-validate its target at execution time and
  return a clear, typed outcome for invalid/offline/not-waiting/unavailable targets rather
  than failing silently or acting on the wrong target.
- **FR-020**: Act-on-agent tools MUST NOT target the synthetic orchestrator identity.
- **FR-021**: Gated act-on requests raised while the overlay is minimized/Teams-only MUST
  follow the established relay/approval semantics (approvable from Teams when online; not
  auto-denied by a backgrounded panel when a remote approver exists).
- **FR-022**: The Teams-presence tool MUST report clearly when the Teams feature is
  disabled/unconfigured instead of failing opaquely, and taking an agent offline MUST post
  the established closing notice to its thread.
- **FR-023**: Every act-on-agent outcome (including denials) MUST be recorded in the
  orchestrator transcript with the target agent identified.

#### Cross-cutting

- **FR-024**: New tools MUST be described to the orchestrator agent clearly enough that it
  selects the right tool from a natural-language request without the user naming the tool
  or, for capability-based requests, the exact agent.
- **FR-025**: All new tool actions and their outcomes MUST surface failures through
  established channels (no silent failure paths).

### Key Entities *(include if feature involves data)*

- **Orchestrator Transcript**: The durable, ordered record of one orchestrator
  conversation. Attributes: ordered turns; per-turn role (user / orchestrator / tool /
  system); per-turn origin (desktop / Teams); tool action + outcome for tool turns;
  timestamps; a lifecycle marker distinguishing the active conversation from a
  user-closed one. Retention-bounded. Persisted across restarts.
- **Active Agent Snapshot**: A read-only view of one session-bearing agent for status
  tools, valid for any state (including `done`/`waiting`/`thinking`). Attributes: agent
  identity, office, status (from the canonical status presentation),
  current-activity description, time-in-state, and whether it is awaiting user input
  (with the pending question/context when applicable).
- **Agent Recent-Output Window**: A bounded, read-only slice of a target agent's recent
  output returned by the peek tool.
- **Act-On Result**: The typed outcome returned by each gated act-on tool (e.g.,
  delivered / sent / stopped / restarted / taken-offline / online-in-teams, plus
  not-online / not-waiting / invalid-target / unavailable / denied / failed) with a
  human-readable message.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After minimizing/closing and reopening the panel, 100% of prior turns
  (including Teams-originated turns) are visible in the TUI without the user prompting the
  agent to recall them.
- **SC-002**: After an app restart, the previous orchestrator conversation is restored and
  rendered on the next panel open.
- **SC-003**: A user can get an accurate "what's everyone working on" roll-up covering
  every session-bearing agent — including `done`, `waiting`, and `thinking` agents — in a
  single natural-language request (one tool call), with status matching the in-world
  badges/dashboards.
- **SC-004**: A user can identify every agent currently waiting on them in a single
  natural-language request.
- **SC-005**: A user can unblock a waiting agent, send a follow-up prompt to an online
  agent, and bring an agent online in Teams — each entirely through the orchestrator,
  without opening that agent's terminal, and each behind an explicit approval.
- **SC-006**: A user can stop and restart an agent entirely through the orchestrator,
  behind an explicit approval.
- **SC-007**: Every gated act-on request can be approved or denied, and a denial results in
  zero change to the target agent 100% of the time.
- **SC-008**: For invalid/offline/not-waiting/unavailable targets, the orchestrator returns
  a clear typed outcome rather than a silent no-op or opaque error, in 100% of such cases.
- **SC-009**: Each of the top-10 scenarios can be completed from natural language without
  the user naming the underlying tool.

## Assumptions

- The orchestrator remains a single dedicated SDK session opened from the focused panel
  (spec 016); this feature extends its tools and transcript, not its fundamental shape.
- "Active agents" and their status/waiting state are already tracked in the app (badges,
  dashboards, agent-status presentation module) and can be surfaced to the orchestrator as
  read-only snapshots; this feature exposes existing state rather than inventing new
  status semantics.
- Delivering answers/prompts and stop/restart map onto existing per-agent session
  operations already used by the in-world terminals; the orchestrator reuses those paths.
- Activating an agent's Teams remote reuses the existing Teams remote-agent machinery
  (spec 011) already used for the orchestrator's own Teams presence.
- The orchestrator's situational-awareness tools operate across all offices and label each
  agent with its office; gated act-on tools still target a specific, office-qualified agent
  (the orchestrator may `switch_office` to bring the desired office into view for follow-up).
- Read-only peeks return a bounded recent window, not full unbounded scrollback.
- Transcript persistence uses the app's existing per-app data storage location
  (e.g., the `.data/` convention); the retention bound is the existing agent-TUI scrollback
  window per session (reset on a new session), not a separate unbounded log.
- Teams-dependent scenarios require the Teams feature to be enabled/configured.

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: No change to the Phaser-first rule. The orchestrator TUI and its
  transcript rendering are DOM overlays (xterm.js), consistent with spec 016; Phaser
  remains the sole in-canvas renderer and no gameplay visuals move into the DOM.
- **Event & Input Boundary**: The panel continues to coordinate via the established event
  bus and preserves the focus contract (host `onOpen`/`onClose` → `InputManager`
  suspend/resume). New tool round-trips continue to flow over the existing
  `orchestrator:*` IPC seam and manager request helpers; no ad hoc keyboard handling and
  no direct Phaser keyboard manipulation are introduced.
- **Session Integrity Impact**: Act-on-agent tools MUST preserve real Copilot CLI session
  semantics end-to-end and reuse the existing per-agent session operations and viewer
  invariants (e.g., `agent-viewers.ts` dual-key rules); they must not detach or kill the
  wrong session, and must not mutate `activeAgentViewers` outside the sanctioned helpers.
  The orchestrator's own minimize-vs-close/background-Teams semantics established
  previously must be preserved. Transcript persistence must not alter live session
  lifecycle.
- **Configuration Impact**: New agent-status/label output MUST read from the single
  agent-status presentation source of truth (no per-surface hardcoded labels/colors).
  New tool definitions are added through the existing typed orchestrator tool registry;
  no hardcoded agent IDs — use the named constants in `src/config/agents.ts`.
- **Regression Plan**: Add unit coverage for each new tool's outcomes (success + typed
  invalid/offline/not-waiting/unavailable/denied paths) and for transcript
  capture/persistence/replay (including Teams-origin turns and post-restart restore).
  Keep the existing 204 orchestrator + Teams unit tests green. Verify approval-relay parity
  for the new gated tools across desktop, minimized, and Teams-online states. Run
  `npx tsc --noEmit`, `npm run build`, and the orchestrator/Teams vitest suites; extend the
  e2e smoke where practical for reopen-shows-history.
