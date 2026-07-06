# Feature Specification: Teams Remote Agents

**Feature Branch**: `011-teams-remote-agents`
**Created**: 2026-07-06
**Status**: Draft
**Input**: User description: "Implement a Teams monitor as a feature in CopilotOffice. (1) Convert the existing Python Teams monitor concept to JS while keeping the same Teams calls and auth. (2) Create a Teams service that runs in a background terminal to monitor chats based on rules — which Team/channel to watch for @agent-name. (3) Add a 'Teams remote' button in an agent's terminal (near new/close session) that brings the agent online in Teams as @agent-name (case-insensitive, dedup to @gene-1 if @gene exists) in a channel that must be specified in settings. (4) Allow continuing any conversation from Teams, and optionally send check-in/update messages from terminal session text for long-running processes."

**Refinement (2026-07-06)**: On bringing an agent online, the agent MUST start a dedicated thread in the configured channel, and that thread is bound to the agent. The binding is persisted in a JSON store of "Teams online agents" (chosen over a database for consistency with existing JSON persistence, tiny dataset, and no relational needs). Once an agent's thread exists, the user does NOT need to @mention the handle — simply replying within that bound thread routes the message to the agent. The Teams connection can be stopped both from an in-app control and via a text command posted inside the thread.

## Clarifications

### Session 2026-07-06

- Q: Channel configuration model? → A: Global settings hold a **feature flag** (show/hide the Teams remote control) and a **default channel** deep-link. Each **office** may set an **override** channel deep-link (by its working directory); resolution is office-override → global-default. Consequently the listener supports **multiple channels**: it routes across the set of channels that currently have online agents, via one account-wide Trouter subscription, keyed by (channel id, thread root id).
- Q: How are messages in threads not mapped to any online agent handled, and how do we avoid replying to the app's own posts? → A: If the thread is one the app created but is now unbound (orphaned), post a one-time "This thread is no longer active and will not receive responses." notice and do not dispatch; threads the app did not create are ignored silently. Every message the app itself posts carries a marker and is excluded from all inbound processing to prevent self-loops.
- Q: Who may drive agents by posting in a bound thread? → A: Anyone in the channel — no sender restriction. Consequence: self-loop prevention uses an embedded marker (the agent posts under the app user's own identity), and every inbound message is injection-screened since threads are multi-user and untrusted.
- Q: What is the in-thread stop command, and is all other thread text a prompt? → A: `/stop`. Every other authorized message in a bound thread is a prompt. `/stop` (and the in-app offline toggle) ONLY closes the Teams connection and removes the online-agents JSON entry — it does NOT stop or affect the agent's terminal session, which keeps running.
- Q: How is the monitored channel specified in settings? → A: The user pastes the Teams channel deep-link URL; the system parses channel id + group/team id + tenant id from it.
- Q: On app reopen, if a previously-online agent's session isn't running, should reconnect force-start it? → A: No. Reconnect is event-driven by terminal session id — Teams reconnects when a session with the stored id becomes available. Additionally, on startup, online-agents entries older than 30 days (by last-connected) are cleaned up and reported via a toast notification.

- Q: What Teams surface should agents live in — chat conversations (reference impl) or true channel-inside-a-Team threads? → A: True Teams channel threads (channel inside a Team).
- **Feasibility spike (2026-07-06, VALIDATED against a live test team):** Channel threads are achievable with non-interactive `az` tokens, using a **two-token split**:
  - **Send** (create thread = root message; reply in thread) works via **Microsoft Graph** `POST /teams/{id}/channels/{id}/messages` and `.../messages/{id}/replies` using the Graph token (the CLI's `Directory.AccessAsUser.All` is sufficient — no `ChannelMessage.Send` needed).
  - **Receive/read** works via the internal **chatsvc** API `GET https://teams.cloud.microsoft/api/chatsvc/{region}/v1/users/ME/conversations/{channelId}/messages` using the `ic3.teams.office.com` token (`Teams.AccessAsUser.All`). (Graph *read* is NOT available — it requires `ChannelMessage.Read.All`, which the CLI token lacks — so chatsvc is the receive path.)
  - Channel/team enumeration works via Graph `GET /me/joinedTeams` and `/teams/{id}/channels`. A channel id looks like `19:...@thread.tacv2`.
  - Real-time receive via **Trouter is CONFIRMED for channels** (spike 2026-07-06): a single account-wide Trouter WebSocket subscription pushed live channel-thread messages in real time. The channel push carries the thread root id in the conversation id (`19:...@thread.tacv2;messageid=<rootId>`), which is the routing key to map a reply to its bound agent thread. chatsvc **polling** remains a proven fallback but is not needed. Primary receive mechanism = Trouter subscribe.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Bring an agent online with its own channel thread (Priority: P1)

As a CopilotOffice user, I want to click a "Teams remote" button in an agent's terminal panel so that the agent goes online in the configured Teams channel by starting its own dedicated thread (titled `<agent name>: <session title>`) and posting a greeting. That thread becomes the agent's home: anyone in the channel can talk to the agent simply by replying in the thread — no @mention required — and the agent's replies are posted back into the same thread.

**Why this priority**: This is the core value of the feature — remote reachability of an agent with a clear, dedicated conversation surface. Without it, none of the other stories matter. It is the minimum viable slice: one agent, one auto-created thread, reply in / reply out.

**Independent Test**: Configure a channel in settings, click "Teams remote" on Gene, confirm a new thread appears titled `Gene: <session title>`, whose first post shows Gene's name, working folder, handle, session title, and (if available) a brief summary; reply `what is 2+2` in that thread (no mention), and confirm the answer is posted back in the same thread and appears in Gene's CopilotOffice terminal.

**Acceptance Scenarios**:

1. **Given** a channel is configured in settings and Gene's session is running, **When** the user clicks "Teams remote" on Gene's terminal, **Then** Gene starts a new thread in that channel titled `Gene: <session title>`, posts an introductory message containing Gene's name, working folder, handle, session title, and (best-effort) a short summary of the conversation so far, the button reflects an "online" state, and the agent→thread binding is persisted to the online-agents JSON store.
2. **Given** Gene is online with a bound thread, **When** any channel member posts a message (with no @mention) as a reply in Gene's thread, **Then** the message is routed to Gene's existing terminal session and the response is posted back into the same thread.
3. **Given** Gene is online, **When** the user clicks the button again (now showing "online"), **Then** Gene is taken offline, its binding is removed from the store, the thread is closed out with a final "offline" notice, and further replies in that thread are ignored.
4. **Given** no channel is configured in settings, **When** the user clicks "Teams remote" on any agent, **Then** the action is blocked and the user is prompted to configure a channel first.
5. **Given** the app restarts while Gene was online, **When** Gene's terminal session (matched by session id) next becomes available, **Then** Gene's Teams connection is automatically restored and re-bound to its persisted thread so replies in the existing thread route correctly, with no duplicate thread created.

---

### User Story 2 - Continue a conversation from Teams (Priority: P1)

As a user away from my machine, I want to keep talking to an already-online agent purely from Teams by replying in its bound thread, with each new message continuing the same agent session, so that follow-up prompts retain full context without me returning to the desktop app and without repeating a handle.

**Why this priority**: The persistent-session design is the headline benefit over the original per-prompt approach. Conversation continuity is what makes remote use genuinely useful rather than one-shot.

**Independent Test**: With Gene online, reply `remember the number 42` in its thread, then later reply `what number did I tell you?` in the same thread, and confirm the second reply demonstrates retained context from the same session.

**Acceptance Scenarios**:

1. **Given** Gene is online and has already answered one prompt, **When** the user posts a follow-up reply in Gene's bound thread (no mention needed), **Then** the follow-up is dispatched into the same running session (not a fresh one) and the reply reflects prior context.
2. **Given** the user posts several replies in Gene's thread in rapid succession, **When** the agent is still processing an earlier prompt, **Then** the later prompts are queued and dispatched sequentially in order, one reply each.
3. **Given** a reply exceeds Teams' single-message size limits, **When** it is posted back, **Then** it is split into ordered chunks so the full response is delivered.

---

### User Story 3 - Handle-name collisions and multiple agents (Priority: P2)

As a user who brings several agents online, I want each agent to get a unique, predictable Teams handle (used for its thread title and identity) even when names collide, so that each agent has an unambiguous, correctly bound thread.

**Why this priority**: Multiple concurrent agents are a natural use of the app (Gene, Dan, Alice). Collision handling is required for correctness but is not needed for a single-agent MVP.

**Independent Test**: Bring two agents whose base handle would be `@gene` online in sequence and confirm the second is assigned handle `@gene-1` (shown in its intro post), then confirm replies in each thread route to the correct agent.

**Acceptance Scenarios**:

1. **Given** `@gene` is already online, **When** another agent whose name also normalizes to `gene` is brought online, **Then** it is assigned the next free handle `@gene-1` (and `@gene-2`, etc. thereafter) and its thread is titled accordingly.
2. **Given** handle derivation, **When** an agent named `Gene`, `GENE`, or `gene` is brought online, **Then** the handle normalizes case-insensitively to the same base `gene`.
3. **Given** an agent with handle `@gene-1` is taken offline, **When** a new colliding agent is brought online, **Then** the freed handle may be reused following a deterministic rule.
4. **Given** two agents are online with distinct threads, **When** the user replies in each thread, **Then** each message routes only to the agent bound to that thread.

---

### User Story 4 - Stop an agent from inside Teams (Priority: P2)

As a user interacting only through Teams, I want to stop an agent's Teams connection by posting a command in its thread, so that I can take it offline without returning to the desktop app. I also want the same stop action available as an in-app control.

**Why this priority**: Remote lifecycle control (not just remote prompting) is needed for a self-contained Teams experience, and mirrors the in-app toggle. It is important but secondary to getting agents online and conversing.

**Independent Test**: With Gene online, post the stop command (e.g. `/stop`) in Gene's thread and confirm Gene goes offline, a confirmation is posted, the binding is removed from the store, and subsequent replies in the thread are ignored; separately confirm the in-app control produces the same result.

**Acceptance Scenarios**:

1. **Given** Gene is online, **When** any channel member posts `/stop` in Gene's bound thread, **Then** Gene is taken offline, a confirmation message is posted to the thread, and its binding is removed from the online-agents store — while Gene's terminal session continues running unaffected.
2. **Given** Gene is online, **When** the user clicks the in-app "Teams remote" control to go offline, **Then** the same offline outcome occurs and any thread-based stop remains consistent.
3. **Given** an agent is offline, **When** a stop command is posted in its (now inactive) thread, **Then** the command is safely ignored.
4. **Given** any channel member posts `/stop` in a bound thread, **When** it is received, **Then** it is honored (no sender restriction) — the agent goes offline while its terminal session keeps running.

---

### User Story 5 - Long-running check-ins from the terminal (Priority: P3)

As a user who kicked off a long task remotely, I want the agent to post periodic check-in / progress updates in its thread derived from its terminal activity, so that I know it is still working and roughly where it is, without watching the desktop app.

**Why this priority**: A quality-of-life enhancement that builds on the core routing. Valuable but not required for the feature to deliver its primary promise.

**Independent Test**: Post a prompt that triggers a multi-minute task and confirm at least one interim progress message is posted in the thread before the final reply, without flooding it.

**Acceptance Scenarios**:

1. **Given** a dispatched prompt whose processing exceeds a configured "long-running" threshold, **When** the agent is still working, **Then** an interim progress update is posted to the agent's bound thread.
2. **Given** progress updates are being posted, **When** multiple terminal events occur in quick succession, **Then** updates are throttled to a configured minimum interval so the thread is not flooded.
3. **Given** check-ins are disabled in settings, **When** a long task runs, **Then** no interim messages are posted and only the final reply is delivered.

---

### Edge Cases

- **No agent session running**: user clicks "Teams remote" on an agent whose terminal session is not started — the system must either start/require a session or clearly report why it cannot go online.
- **Auth token expiry mid-session**: the Teams token expires while an agent is online — the service must refresh silently and continue without dropping the agent's registration.
- **Auth unavailable**: the credential source cannot mint a Teams token — going online must fail with a clear, actionable message rather than silently doing nothing.
- **Multi-user channel**: any channel member may drive an agent by posting in its bound thread; there is no sender allow-list. The agent's own posts (under the app user's identity) must still be excluded via a marker so they are not treated as prompts.
- **Orphaned agent thread**: a message arrives in a thread the app created but that is no longer bound to an online agent (post-`/stop`, new session, or 30-day GC) — the app posts a one-time "This thread is no longer active and will not receive responses." notice and does not dispatch.
- **Foreign thread / channel root**: a message arrives in a thread the app did not create — it is ignored silently (no notice, no dispatch).
- **App self-echo**: every message the app itself posts (intro, reply, check-in, notices) pushes back over Trouter — all are excluded via the marker so nothing loops.
- **Prompt injection**: because threads are multi-user, every inbound message is screened for injection-style content and blocked + logged on a hit (no trusted-sender exemption).
- **Duplicate / stale messages**: the transport re-delivers a message or delivers a backlog on reconnect — each prompt must be dispatched at most once and stale backlog must be skipped.
- **Self-loop**: the agent's own posted reply must never be re-interpreted as a new inbound prompt.
- **New session while online**: the user starts a fresh terminal session for an online agent — the agent's Teams connection must be torn down (offline + binding removed + thread notice) so the new session is not silently attached to the old thread.
- **App close/reopen**: an agent online at close is reconnected automatically when its terminal session (matched by session id) next becomes available, re-binding to its persisted thread with no duplicate thread; the app does not force-start sessions just to reconnect.
- **Stale binding cleanup**: online-agents entries older than 30 days (by last-connected timestamp) are removed on startup and reported via a toast notification.
- **Persisted thread missing on reconnect**: a bound thread was deleted/inaccessible while the app was closed — reconnect must start a fresh thread (updating the binding) or clearly flag the agent as failed-to-reconnect.
- **Connection loss**: the real-time Teams connection drops — the service must reconnect with backoff and resume listening without duplicate dispatches.
- **Handle exhaustion / invalid names**: an agent name that normalizes to an empty or invalid handle must be rejected with a clear message.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST provide a per-agent "Teams remote" control in the agent's terminal panel, positioned near the existing new-session and close-session controls, that toggles the agent's Teams online state.
- **FR-002**: When brought online, the system MUST assign the agent a Teams handle derived from its name, normalized case-insensitively (e.g. Gene → `@gene`).
- **FR-003**: When a derived handle is already in use by another online agent, the system MUST assign the next available suffixed handle (`@gene-1`, `@gene-2`, …) using a deterministic rule.
- **FR-004**: Before an agent can be brought online, the system MUST resolve a target Teams channel from a **Teams channel deep-link URL**, using this precedence: (1) the current office's **override** channel deep-link if set, otherwise (2) the **default** channel deep-link in global settings. The URL is parsed into channel id + group/team id + tenant id. If neither an office override nor a global default is configured (or the resolved URL cannot be parsed), the online action MUST be blocked with a clear prompt to configure a channel.
- **FR-004a**: Global settings MUST include a **feature flag** controlling whether the per-agent "Teams remote" control is shown. When the flag is off, the control MUST be hidden and no agent can be brought online; when on, the control is shown subject to FR-004.
- **FR-004b**: Each office MUST support an optional **override Teams channel deep-link** (configured alongside its working directory) so an office can be tied to a different channel than the global default. When unset, the office uses the global default channel.
- **FR-005**: The system MUST run a background Teams monitoring service that maintains a single real-time subscription and receives new messages, routing across the **set of channels that currently have at least one online agent** (the union of the global default and any per-office overrides in use). One account-wide subscription serves all such channels — a separate connection per channel is NOT required.
- **FR-006**: The system MUST authenticate to Teams non-interactively via CLI-acquired bearer tokens (no interactive browser sign-in in the normal path), cached and proactively refreshed before expiry, using a **two-token model validated by spike**: a **Microsoft Graph** token (sufficient with `Directory.AccessAsUser.All`) for sending channel thread/root/reply messages, and an **`ic3.teams.office.com`** token (`Teams.AccessAsUser.All`) for reading/receiving channel messages via the internal chatsvc API.
- **FR-007**: The system MUST filter inbound messages so that only messages that (a) are not duplicates, (b) are not stale backlog, (c) are not the agent's own posts, (d) arrive in a thread bound to an online agent (thread-scoped routing; no @mention required), and (e) originate in a channel that currently has at least one online agent (the active channel set) are dispatched. Routing is keyed by (channel id, thread root id) → bound agent. There is NO sender restriction — any channel member's message qualifies (see FR-007a).
- **FR-007a**: Because the agent posts under the app user's own Teams identity (via Graph), the system MUST embed a marker in **every** message the CopilotOffice app posts to Teams (thread intros, prompt replies, check-in updates, offline notices, and the orphaned-thread "no longer active" notice) and MUST exclude any inbound message carrying that marker from all processing — it is never dispatched, never treated as a prompt, and never triggers another notice. This prevents self-loops (including the notice-triggers-itself case), independent of sender identity.
- **FR-008**: The system MUST route a matched message to the corresponding agent's existing persistent terminal session (resolved via the thread→agent binding) rather than spawning a new one per prompt.
- **FR-009**: The system MUST queue multiple prompts for the same agent and dispatch them sequentially, producing one reply per prompt in order.
- **FR-010**: The system MUST capture the agent's response for a dispatched prompt from the agent session's structured output and post it back into the agent's bound thread.
- **FR-011**: The system MUST split replies that exceed Teams message size limits into ordered chunks so the full response is delivered.
- **FR-012**: Because bound threads are multi-user (any channel member may post), the system MUST screen every inbound prompt for injection-style content and block + notify on a hit (there is no trusted self-chat exemption in this channel context); blocked attempts are logged.
- **FR-013**: The system MUST allow follow-up messages posted in an agent's bound thread to continue the same agent session with retained context.
- **FR-014**: The system MUST provide a visible online/offline status indicator for each agent's Teams registration and reflect connection health (connected / disconnected / error).
- **FR-015**: The system MUST allow taking an agent offline from an in-app control AND via an authorized `/stop` command posted in the agent's bound thread; either path releases the handle, removes the binding from the online-agents store, posts an offline notice to the thread, and ceases dispatch. This MUST only close the Teams connection — it MUST NOT stop, kill, reset, or otherwise affect the agent's terminal session, which keeps running.
- **FR-015a**: Within a bound thread, any message that is not the `/stop` command MUST be treated as a prompt for the bound agent.
- **FR-016**: The system SHOULD optionally post throttled interim progress ("check-in") messages to the agent's bound thread when a dispatched prompt runs longer than a configured threshold, controlled by a settings toggle.
- **FR-017**: The system MUST persist Teams-related settings (configured channel deep-link, check-in preferences) so they survive app restarts.
- **FR-018**: The system MUST reconnect automatically with backoff after a dropped Teams connection and resume listening without duplicate dispatches.
- **FR-019**: The system MUST reuse the existing CopilotOffice agent terminal/session and event-watching infrastructure for dispatch and response capture rather than introducing a separate parallel PTY layer.
- **FR-020**: The system MUST fail safe when Teams auth or connection is unavailable — surfacing a clear error and leaving agents offline — rather than appearing online while non-functional.
- **FR-021**: When an agent is brought online, the system MUST start a new thread in the configured channel whose title has the format `<agent name>: <session title>` (e.g. `Gene: Fixing terminal scroll`), falling back to `<agent name>: <handle>` if the session has no title yet, and MUST persist the agent→thread binding to a JSON store of online agents (`.data/teams-online-agents.json` or equivalent, behind a persistence port).
- **FR-021a**: The introductory message the agent posts when starting its thread MUST include: the agent's display name, its associated working folder/directory, its handle, and the session title. It SHOULD also include a short summary of the conversation so far when one can be produced; if a summary cannot be produced cheaply, the intro MUST still post successfully without it.
- **FR-022**: Starting a NEW terminal session for an agent MUST terminate that agent's Teams connection — taking it offline, removing its binding from the online-agents store, and posting an offline notice to its (now unbound) thread — so a fresh session never remains silently attached to an old thread.
- **FR-023**: On app close, the system MUST retain the persisted set of previously-online agents (and their thread bindings) in the JSON store.
- **FR-024**: Reconnection is **event-driven by terminal session id**. The system MUST NOT force-start agent sessions on app startup; instead, when an agent terminal session becomes available whose session id matches an entry in the online-agents store, the system MUST automatically reconnect Teams for that agent, re-binding it to its persisted thread and resuming listening — without creating a duplicate thread.
- **FR-024a**: On app startup, the system MUST garbage-collect stale online-agents entries whose last-connected timestamp is older than 30 days: remove them from the store and surface a toast notification summarizing what was cleaned up.
- **FR-025**: If, on startup reconnect, an agent's persisted thread can no longer be resolved (deleted/inaccessible), the system MUST either start a fresh thread and update the binding or clearly mark that agent as failed-to-reconnect, rather than leaving an inconsistent state.
- **FR-026**: The system MUST track the set of thread ids it has created for agents (retained even after a binding is removed via `/stop`, new session, or stale-GC), so orphaned agent threads can be recognized.
- **FR-027**: When a message is received in the configured channel within a thread the system created but which is no longer bound to any online agent (orphaned agent thread), the system MUST NOT dispatch it and MUST post a one-time notice `This thread is no longer active and will not receive responses.` to that thread. The notice MUST be posted at most once per orphaned thread (tracked to avoid repeats/loops).
- **FR-028**: Messages received in the configured channel in threads the system did NOT create (e.g. unrelated human conversations, or the channel root) MUST be ignored silently — no dispatch and no notice — to avoid spamming the channel.

### Key Entities *(include if feature involves data)*

- **Agent Teams Registration (Online Agent)**: an entry in the JSON online-agents store binding a CopilotOffice agent to its Teams presence. Attributes: agent id, agent display name, working folder/directory, current terminal session id, session title, normalized handle (+ assigned suffix), configured channel id, **bound thread id**, online state, last-connected timestamp.
- **Teams Monitor Settings**: global user configuration for the feature. Attributes: **feature-flag** (show/hide the Teams remote control), **default channel deep-link URL** (parsed into channel id + team/group id + tenant id), stop-command convention, check-in enabled + threshold + throttle interval. (No sender allow-list — any channel member may drive agents.)
- **Office Teams Override**: an optional per-office **override channel deep-link URL** stored with the office (alongside its working directory). When set, it takes precedence over the global default for agents in that office.
- **Inbound Teams Message**: a received message under evaluation. Attributes: message id, conversation/thread id (channel id + thread root id), sender identity, content, timestamp, matched bound-agent (via thread root id), or classified as orphaned-agent-thread / foreign-thread.
- **Known Created Threads**: the set of thread (root message) ids the system has created for agents, retained beyond binding removal. Used to distinguish orphaned agent threads (post inactive notice once) from foreign human threads (ignore silently), and to dedupe the one-time notice.
- **Dispatch / Prompt Queue Item**: a prompt awaiting or undergoing processing by an agent session. Attributes: target agent, source thread, prompt text, status (queued/processing/done/error), ordering.
- **Auth Token**: a cached Teams access token. Attributes: token value (secret, not logged), resource, expiry, refresh schedule.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can take an agent from offline to answering a Teams message in the monitored channel in under 2 minutes of setup (assuming auth already available), measured from first click of "Teams remote" to first reply received in Teams.
- **SC-002**: For an already-online agent, a follow-up Teams prompt receives its first reply token noticeably faster than a cold start — at least 5× faster than spawning a fresh agent session — because the persistent session is reused.
- **SC-003**: 100% of messages posted in a bound agent thread (from any channel member, excluding the agent's own marked posts) receive exactly one routed reply (no drops, no duplicates) across a test set of at least 20 messages including rapid-fire bursts.
- **SC-004**: 100% of duplicates, stale backlog, and the agent's own marked posts are correctly ignored (zero false dispatches), and 100% of injection-flagged messages are blocked, across the test set.
- **SC-005**: When two agents' names collide, both receive distinct handles/threads and thread routing is correct 100% of the time in a test with at least two colliding agents.
- **SC-006**: Replies longer than a single Teams message are delivered in full, in order, with no lost content, for responses up to at least 10,000 characters.
- **SC-007**: The agent's Teams online/offline status shown in CopilotOffice matches the actual service state within a few seconds of any change, including after a simulated connection drop and recovery.
- **SC-008**: With check-ins enabled, a task exceeding the long-running threshold produces at least one interim update and never exceeds the configured update frequency (no thread flooding).
- **SC-009**: Starting a new session for an online agent takes it offline in Teams 100% of the time (binding removed, no further dispatch from the old thread).
- **SC-010**: After closing and reopening the app, 100% of agents that were online at close are automatically reconnected and re-bound to their existing threads, with zero duplicate threads created, across a test of at least 3 previously-online agents.

## Assumptions

- The target is a **true Teams channel** inside a Team; "thread" means a channel reply chain under a root post. **Feasibility fully validated by spikes (2026-07-06)**: sending (root + replies) via Microsoft Graph, receiving via the internal chatsvc API, AND real-time push of channel messages via a single Trouter WebSocket subscription all work with non-interactive `az` tokens (Graph token for send, ic3 token for receive/Trouter). Receive is **Trouter subscribe** (real-time, account-wide, filtered to the bound channel and routed by thread root id); chatsvc polling is an available fallback but not required.
- The reference Python Teams monitor in the `agency-cowork` repository is the behavioral source of truth for message filtering, sequential dispatch, chunking, and reply formatting; its transport/auth details are a starting reference but may differ because the target here is channels rather than chats.
- Teams access tokens for the Teams resource can be obtained non-interactively from the local credential/CLI environment in the target user's tenant (confirmed for the primary user); the interactive browser fallback is out of scope for v1.
- Any member of the configured channel may drive agents by posting in a bound thread; there is intentionally NO sender allow-list. The signed-in app user's identity is used only for posting (send) and as the basis for the self-loop marker — not to restrict who may prompt.
- The monitored scope is **one or more channels**: the global default channel plus any per-office override channels that have online agents. A single account-wide Trouter subscription covers them all; the service filters/routes by (channel id, thread root id). Watching channels with no online agents is unnecessary.
- CopilotOffice already provides persistent per-agent terminal sessions and a structured event/output watcher; this feature consumes that existing infrastructure and does not build a separate PTY bridge.
- Online-agent state (agent→handle→thread bindings) is persisted as JSON (`.data/teams-online-agents.json` behind a persistence port, mirroring `OfficePersistencePort`) rather than in a database — chosen for consistency with existing persistence, a tiny dataset, and no relational query needs.
- "New session = disconnect, app-restart = reconnect": an explicit user-initiated new session for an agent intentionally drops its Teams connection, whereas closing/reopening the whole app auto-restores connections for agents that were online, driven by the persisted store.
- "Self-chat" (the user's own notes-to-self conversation) is treated as trusted for injection-guard purposes, consistent with the reference implementation.
- Rendering remains Phaser-first; all new Teams UI surfaces are DOM overlays/controls consistent with the existing terminal panel, and all input-focus transitions continue to route through the InputManager.
- Secrets (access tokens) are never written to logs, committed, or displayed in the UI.

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: No new Phaser renderers are introduced. The "Teams remote" control and status indicator are DOM elements within the existing terminal/overview panel; Phaser remains the sole game renderer. Any status reflected on an NPC is driven through existing `game.events` status channels, not by new rendering paths.
- **Event & Input Boundary**: Teams events flow from the Electron main-process service to the renderer via the established IPC/event bus (analogous to existing agent status/tool events). Any modal/overlay added (e.g. Teams settings) exposes `onOpen`/`onClose` and suspends/resumes game input via `InputManager` using the `settings:open`/`settings:close` bus; no direct Phaser keyboard manipulation.
- **Session Integrity Impact**: The feature dispatches into existing agent terminal sessions and reads their structured output through the existing watcher; it must not kill, detach, or fork sessions on office switch, and must respect the `activeAgentViewers` dual-key invariant and fleet-critical event forwarding. Remote dispatch is an additional consumer of a session, not a new session lifecycle.
- **Configuration Impact**: Agent handles and routing MUST NOT be hardcoded; they derive from agent definitions in `src/config/agents.ts` and a persisted Teams settings store. The configured channel deep-link and check-in settings live in configuration/persistence, not inline constants. New DOM overlays use the `ZIndex` registry rather than ad-hoc z-index values.
- **Regression Plan**: Add tests for handle normalization/collision (`@gene` → `@gene-1`, case-insensitive matching), the message filter pipeline (dedup, stale, self-loop, sender, conversation, injection), sequential queue ordering, and reply chunking. Include an integration check that remote dispatch into an agent session does not disturb the existing terminal viewer or session-detach-on-office-switch behavior. Auth token handling is covered by unit tests using a fake token provider so no live secret is required.
