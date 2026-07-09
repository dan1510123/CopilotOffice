# Feature Specification: Agent Status Tracking Revamp

**Feature Branch**: `014-agent-status-revamp`  
**Created**: 2026-07-09  
**Status**: Draft  
**Input**: User description: "Revamp the status tracking of each agent from Ready, Done, Thinking... etc. Focus on improving how the existing states are presented and making status more accurate and reliable so the indicators can be trusted."

## Overview

The office shows each agent's status through a badge over its sprite (emoji + color + pulse) and through the terminal-panel dashboards (text labels). Today the underlying state model — `slacking`, `starting`, `ready`, `waiting`, `thinking`, `error`, and a derived `done` — is sound, but the way those states are *shown* is inconsistent across surfaces and the indicators are not always trustworthy: badges can stay stale after work finishes, states can flicker or show the wrong value during rapid tool events, and labels are often too vague to tell what an agent is doing or how long it has been doing it.

This feature keeps the existing set of states but revamps their **presentation** (clarity, consistency, and richness of what is shown) and their **reliability** (no stale, wrong, or flickering indicators), so a user can glance at any surface and trust exactly what each agent is doing.

**Explicitly out of scope**: redesigning, renaming, adding, or removing the underlying states themselves.

## Clarifications

### Session 2026-07-09

- Q: What counts as "viewing" an agent that clears the finished-unread (Done) state? → A: Any focus on the agent — opening its terminal, selecting its dashboard card, or walking up to / interacting with it in-world.
- Q: How long in the same active state with no progress before signaling a "possible stall"? → A: ~60 seconds (1 minute).
- Q: How should elapsed time in an active state be shown? → A: A live ticking timer (mm:ss) while the agent is active.
- Q: How should the "possible stall" signal look without adding a new state? → A: A distinct visual on the existing state (e.g. the Thinking badge turns amber / pulses differently) — no new underlying state.
- Q: Should status-bearing notifications be in the consistent-presentation scope? → A: Yes — notifications must use the same canonical names, icons, and colors as the badge and dashboards.
- Q: How should the "Thinking" activity detail appear on the dashboard card? → A: The dashboard card label MUST stay a concise "Thinking" (no inline "Thinking: processing…" detail that grows the card). Agent cards MUST keep a stable height regardless of state or detail; any activity detail is shown without changing card height (fixed single-line/truncated, or a non-reflowing secondary surface such as a tooltip).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Trustworthy status that always reflects reality (Priority: P1)

As a user managing several agents, I want every status indicator to always match what the agent is actually doing, so I never have to open a terminal just to confirm whether an agent is really busy, finished, or waiting on me.

**Why this priority**: This is the core complaint ("general lack of trust in the status indicators"). If a status can be stale or wrong, none of the other improvements matter because users will keep double-checking manually.

**Independent Test**: Drive an agent through a full lifecycle (idle → start → working with several tools → asks a question → finishes) and confirm that at every step, within a short, bounded delay, the badge and every dashboard show the same correct state, and that the state returns to a settled value (not stuck on "Thinking") once the agent stops.

**Acceptance Scenarios**:

1. **Given** an agent finishes its turn with no tools still running, **When** the turn completes, **Then** within a bounded delay every surface stops showing "Thinking" and shows the settled completion/ready state — no surface remains stuck on an in-progress state.
2. **Given** an agent is waiting on a user answer (`ask_user`) **and** an unrelated tool completes in the same moment, **When** the events are processed, **Then** the agent continues to show the waiting-for-input state and does not flip to "Thinking" or "Ready".
3. **Given** an agent has completed work that the user has not yet viewed, **When** the user looks at any surface, **Then** it clearly distinguishes "finished, unread" (Done) from "idle and ready" (Ready).
4. **Given** the "finished-unread" (Done) state, **When** the user focuses the agent (opens its terminal, selects its card, or interacts in-world), **Then** the Done marker clears and no focus method leaves it lingering.
5. **Given** an agent's session ends or is closed, **When** it returns to idle, **Then** all surfaces show the idle/slacking state and no residual in-progress indicator remains.

---

### User Story 2 - Consistent status presentation across every surface (Priority: P1)

As a user, I want the badge over the sprite, the agent dashboards, and any notifications to describe the same state using the same names, colors, and icons, so I don't have to mentally translate between "📬" on a sprite and "Done" in a list.

**Why this priority**: Inconsistent presentation is itself a source of distrust. Two surfaces disagreeing (or using different words for the same thing) makes users unsure which to believe. Consistency is a prerequisite for the indicators being trusted.

**Independent Test**: For each state, put an agent into that state and confirm the badge and the dashboard(s) use the same canonical label, color, and icon meaning for that state, with no surface omitting or renaming a state.

**Acceptance Scenarios**:

1. **Given** any agent state, **When** it is shown on the sprite badge and on a dashboard at the same time, **Then** both use the same canonical name and color for that state.
2. **Given** the "Done" (finished-unread) state, **When** it is shown anywhere, **Then** it is visually distinct from both "Ready" and "Thinking" on every surface.
3. **Given** a state uses an icon/emoji on the badge, **When** the same state appears on a dashboard, **Then** the same icon (or its documented text equivalent) is used, so the mapping is unambiguous.

---

### User Story 3 - Status that says what the agent is doing and for how long (Priority: P2)

As a user, I want an active agent's status to tell me *what* it is currently doing (e.g. which action) and *how long* it has been in that state, so I can judge whether it is progressing normally or appears stuck.

**Why this priority**: Even a correct, consistent "Thinking" badge is low-value if the user can't tell a healthy 3-second action from an agent that has been frozen for two minutes. This adds the richness that makes the status actionable, but depends on the reliability (P1) work landing first.

**Independent Test**: Put an agent into an active state performing a known action and confirm the surfaces show a human-readable description of the current activity and a running indication of elapsed time, and that both update as the activity changes.

**Acceptance Scenarios**:

1. **Given** an agent is actively working, **When** the user views its status, **Then** a short human-readable description of the current activity is available (e.g. via a fixed-height/truncated line or tooltip), while the dashboard card's primary label stays the concise state name (e.g. "Thinking").
2. **Given** an agent has been in an active state for a while, **When** the user views its status, **Then** the status shows a live mm:ss timer of how long it has been in that state.
3. **Given** an agent has been in the same active state for ~60 seconds with no progress, **When** the user views its status, **Then** the active state's badge shows a distinct stall treatment (e.g. amber / altered pulse) so the user can investigate.
4. **Given** an agent transitions between activities, **When** each new activity starts, **Then** the activity description updates to reflect the new action.

---

### Edge Cases

- **Rapid tool churn**: many tool start/complete events arrive in quick succession — status must settle to the correct final state without flickering through intermediate values on the visible surfaces.
- **Out-of-order or duplicate events**: a completion arrives for a tool whose start was missed, or an event is delivered twice — status must not be corrupted or double-counted.
- **Concurrent `ask_user`**: a waiting-for-input state overlaps with other tool activity — waiting-for-input MUST win (never be clobbered by an unrelated tool completing).
- **Agent finishes while the user is not viewing it**: the "finished-unread" (Done) distinction must persist until the user actually views the agent, then clear.
- **Session interruption**: the terminal/session drops, errors, or is force-closed mid-activity — status must resolve to a defined state (error or idle), never remain stuck on an in-progress state.
- **Office switch**: switching offices and returning must show each agent's current true state, not a stale snapshot from before the switch.
- **Unknown/unmapped activity**: a tool or event with no friendly description — status must fall back to a sensible generic label without breaking.
- **Stall detection boundary**: an activity legitimately takes a long time — the "possible stall" signal must be distinguishable from a hard error and must clear if activity resumes.

## Requirements *(mandatory)*

### Functional Requirements

**Reliability & accuracy**

- **FR-001**: The system MUST ensure each agent's displayed status reflects its actual current state within a short, bounded delay after the underlying state changes.
- **FR-002**: The system MUST NOT leave any surface displaying an in-progress state (e.g. "Thinking"/"Starting") after the agent has stopped that activity; every active state MUST resolve to a settled state.
- **FR-003**: When an agent is waiting for user input, the system MUST preserve the waiting state even if unrelated tool events complete concurrently (the existing `ask_user` race-guard behavior MUST be honored on every surface).
- **FR-004**: The system MUST handle rapid, duplicate, or out-of-order status/tool events without producing a wrong final state or visible flicker through incorrect intermediate values.
- **FR-005**: The system MUST resolve status to a defined state (idle or error) when an agent's session ends, errors, or is closed, with no residual in-progress indicator.
- **FR-006**: The system MUST show the correct, current status for every agent after an office switch, with no stale snapshots.

**Consistent presentation**

- **FR-007**: The system MUST present each state using a single canonical name, color, and icon meaning that is shared across the sprite badge, the dashboards, AND status-bearing notifications; notifications MUST use the same canonical names, icons, and colors (no notification-specific wording or coloring for a given state).
- **FR-008**: The system MUST visually distinguish the "finished-unread" (Done) state from both "Ready" (idle-available) and "Thinking" (active) on every surface where status is shown.
- **FR-009**: The system MUST keep the badge icon/emoji and the dashboard label for a given state mapped to each other unambiguously (same icon, or a documented text equivalent).
- **FR-010**: The "finished-unread" (Done) distinction MUST persist until the user focuses the agent — opening its terminal, selecting its dashboard card, or walking up to / interacting with it in-world — and MUST clear once any of those focus actions occurs.

**Richer, actionable status**

- **FR-011**: For an active agent, the system MUST make a short human-readable description of the current activity available (falling back to a sensible generic label when none is available). On the dashboard card, the primary state label MUST stay concise (e.g. "Thinking", not "Thinking: processing…"); the activity detail MUST be presented in a way that does not change the card's height (e.g. fixed single-line/truncated text or a non-reflowing secondary surface such as a tooltip).
- **FR-012**: For an agent in an active state, the system MUST show a live elapsed-time indication of how long it has been in that state as a ticking timer in mm:ss form, updating while the agent remains active.
- **FR-013**: The system MUST signal a possible stall when an agent remains in the same active state for approximately 60 seconds without progress. The stall signal MUST be a distinct visual treatment applied to the existing active state (e.g. the Thinking badge turning amber / pulsing differently) rather than a new underlying state, MUST be distinguishable from a hard error, and MUST clear when activity resumes.
- **FR-014**: The status presentation MUST remain legible and non-disruptive (e.g. no distracting churn) during normal operation across all surfaces.
- **FR-015**: Dashboard agent cards MUST maintain a stable, consistent height regardless of the agent's state or the length of any activity detail. State or detail changes MUST NOT cause the card to grow/shrink or reflow the surrounding dashboard layout.

### Key Entities *(include if feature involves data)*

- **Agent Status**: The current condition of a single agent, comprising the settled/active state, an optional human-readable current-activity description, the time the current state began (for elapsed-time and stall detection), and a "finished-unread" marker distinguishing Done from Ready.
- **Status Presentation Mapping**: The single shared definition that maps each state to its canonical name, color, and icon, consumed by every surface (badge, dashboards, notifications) so presentation cannot drift between surfaces.
- **Activity Description**: The human-readable text describing what an active agent is currently doing, derived from the current tool/action, with a defined fallback for unmapped actions.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In 100% of full agent lifecycles exercised (idle → active → waiting → done → idle), every surface reaches the correct final state and no surface remains stuck on an in-progress state.
- **SC-002**: A user can correctly identify an agent's true state from a glance at any single surface in under 3 seconds, without opening the terminal, in at least 95% of cases.
- **SC-003**: For every state, the sprite badge and the dashboards agree on name, color, and icon meaning — zero disagreements across surfaces in review.
- **SC-004**: Concurrent `ask_user` + unrelated-tool-completion scenarios preserve the waiting state in 100% of trials (no clobbering).
- **SC-005**: Displayed status reflects an underlying state change within a bounded delay (target: under ~1 second) in normal operation.
- **SC-006**: For an active agent, the current-activity description and elapsed-time indication are present and update as activity changes, verified across the common tool/action types.
- **SC-007**: An agent that stops making progress past the stall threshold is flagged as a possible stall (distinct from error) in 100% of trials, and the flag clears when activity resumes.
- **SC-008**: Reduction in user need to open a terminal solely to confirm an agent's status, as reflected by the indicators being sufficient for status checks in day-to-day use.
- **SC-009**: Dashboard agent card height stays constant across all states and activity-detail lengths — zero card-height changes or dashboard reflow observed as an agent moves through its lifecycle.

## Assumptions

- The existing state set (`slacking`/idle, `starting`, `ready`, `waiting`, `thinking`, `error`, plus the derived `done`) is retained; this feature changes presentation and reliability only, not the state model.
- The current surfaces that show status are the sprite badge, the Default and Fleet dashboards, and status-bearing notifications; these are the surfaces that must stay consistent.
- The system already emits the underlying tool/turn/status events needed to derive state; this feature consumes and presents them more reliably rather than introducing new event sources.
- "Bounded delay" is tuned to normal single-user desktop operation; the stall threshold is fixed at ~60 seconds (per clarification) and the bounded delay target is ~1 second, validated against the success criteria.
- Elapsed-time is shown as a live ticking mm:ss timer while the agent is active (per clarification).
- No change to how agents are spawned, how sessions are managed, or how work is actually performed is required.

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: Phaser remains the sole renderer for the in-world sprite badge; DOM surfaces (dashboards, notifications) continue to render outside Phaser as today. This feature does not move rendering responsibilities across that boundary.
- **Event & Input Boundary**: Status continues to flow via existing `game.events` / IPC event channels (`agent:status:changed`, `agent:tool:start`, tool/turn events); no new direct Phaser keyboard manipulation and no bypass of `InputManager`. Any focus interactions (e.g. viewing an agent to clear "unread") route through existing event/input paths.
- **Session Integrity Impact**: None intended — agent terminal/session lifecycle is not modified. Status derivation must not gate or alter fleet-critical event forwarding, and viewing-to-clear-unread must not detach or kill sessions.
- **Configuration Impact**: The canonical state→name/color/icon mapping and thresholds (bounded delay, stall threshold) should live in shared configuration/constants rather than being duplicated per surface; agent identity must use the named constants in `src/config/agents.ts` (no hardcoded agent IDs) and layout behavior via `getLayout(...).behaviors` (no raw layout id compares).
- **Regression Plan**: Extend/keep unit coverage for the status reducer (`src/util/toolStatus.ts` — `nextSubStateAfterToolComplete`, `ask_user` race-guard), transition validation in `officeManager.ts`, and badge/dashboard mapping; add tests for staleness resolution, out-of-order/duplicate events, office-switch freshness, and stall signaling. Run `npm run test` for logic and `npm run test:e2e` for the boot/switch/badge parity flows.
