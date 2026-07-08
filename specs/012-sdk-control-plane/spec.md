# Feature Specification: SDK Control Plane for Agent Terminals (Variant 1)

**Feature Branch**: `012-sdk-control-plane`
**Created**: 2026-07-08
**Status**: Draft
**Input**: User description: "Migrate agent terminal control plane to the Copilot SDK over a node-pty-hosted `--ui-server` TUI (Variant 1): the SDK owns send, events, and foreground switching while node-pty keeps rendering the real Copilot TUI. Goal: a more consistent and cohesive terminal experience."

## Overview

Today the app drives each agent through three separate, fragile mechanisms layered over a raw
node-pty process: keystroke injection for programmatic replies (`submitViaKeystrokes`), a
filesystem tail of `events.jsonl` for status/tool/turn detection, and manual scrollback replay
when switching which agent is visible. This feature consolidates the **control plane** onto the
Copilot SDK while **preserving the real Copilot TUI** by hosting it through the CLI's
`--ui-server` mode inside node-pty. The SDK becomes the single, reliable channel for sending
messages, receiving structured events, and switching the foreground agent; node-pty continues to
own only what it is best at — rendering the authentic terminal UI.

This is explicitly **Variant 1** (SDK as control plane + node-pty as render host). Fully headless
rendering (reconstructing the TUI ourselves from events) is a **non-goal**.

## Clarifications

### Session 2026-07-08

- Q: How many agents share one hosted `--ui-server` runtime (and control port)? → A: **One runtime
  per office** — all of an office's agent sessions are multiplexed on that office's single runtime;
  a crash is contained to that office.
- Q: Does the SDK control plane carry only programmatic prompts, or also human input? → A: **Only
  programmatic prompts** (Teams remote, fleet orchestration). Human keyboard input continues to go
  directly to the agent's real TUI via node-pty.
- Q: Given `--ui-server` is undocumented, is the migration a hard cutover or a permanent fallback?
  → A: **Permanent dual-backend** — legacy node-pty is retained as a supported fallback, selected
  by feature flag, with automatic fallback when `--ui-server` is unavailable.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Reliable programmatic agent replies (Priority: P1)

A remote operator replies to an agent from Microsoft Teams (or the fleet orchestrator drives a
sub-agent). The message is delivered to the agent and its response is produced and rendered in the
agent's real TUI, every time, without dropped or half-submitted prompts.

**Why this priority**: This is the single biggest current pain point. Keystroke injection races
the Ink TUI's re-renders and can leave a prompt typed-but-unsubmitted or silently dropped. It is
the core motivation for the migration and delivers immediate, observable value on its own.

**Independent Test**: With one agent online, submit a prompt programmatically (not via human
typing). Confirm (a) exactly one turn is submitted, (b) the assistant response is captured as a
structured event, and (c) the prompt and response are visible in the agent's TUI. Repeat with a
multi-line prompt and with rapid successive prompts to confirm no drops or double-submits.

**Acceptance Scenarios**:

1. **Given** an online agent with no human typing in progress, **When** a programmatic prompt is
   submitted, **Then** the agent produces a response and both the prompt and response appear in the
   agent's TUI.
2. **Given** a multi-line programmatic prompt, **When** it is submitted, **Then** it is delivered
   as a single turn (no premature submit on embedded newlines).
3. **Given** two programmatic prompts sent in quick succession, **When** they are processed,
   **Then** both are delivered in order with no dropped or duplicated turns.
4. **Given** a programmatic prompt whose reply must be posted back to Teams, **When** the turn
   completes, **Then** the reply text is available to the Teams reply path without scraping raw
   terminal bytes.

---

### User Story 2 - Accurate real-time agent status without file polling (Priority: P2)

A user watching the office sees each agent's status badge (starting → ready ↔ thinking/waiting →
done) update promptly and correctly as the agent works, driven by structured events rather than by
tailing a log file on disk.

**Why this priority**: Status accuracy underpins the whole experience (badges, fleet tracking,
notifications). Structured SDK events remove a class of timing bugs (stuck "thinking", missed
turn_end, historical-event replay hazards) inherent to file tailing. Valuable independently even
before switching drives changes.

**Independent Test**: Run a single agent turn that invokes at least one tool. Observe status
transitions (ready → thinking → tool running → ready/done) derived from SDK events, and confirm
they match the agent's actual activity with no stuck states after the turn ends.

**Acceptance Scenarios**:

1. **Given** an idle agent, **When** it begins a turn, **Then** its status transitions to a
   working state driven by an SDK event.
2. **Given** an agent running a tool, **When** the tool starts and completes, **Then** the tool
   status is reflected and cleared based on SDK events.
3. **Given** a turn that has ended, **When** no further activity occurs, **Then** the agent
   returns to a ready/done state and does not remain stuck in a working state.
4. **Given** an agent whose ask_user prompt is pending, **When** the turn settles, **Then** the
   agent is shown as waiting for input rather than done.

---

### User Story 3 - Seamless agent switching preserves the live TUI (Priority: P3)

A user clicks between agents. The visible terminal switches to the selected agent's real TUI
immediately, showing its true current state, without artifacts from manually replayed scrollback.

**Why this priority**: Improves cohesion and removes a maintenance burden (scrollback capture/
replay), but the app already switches acceptably today, so this is the lowest of the three.

**Independent Test**: With two or more agents active, switch the visible agent back and forth.
Confirm the foreground TUI reflects each agent's real live state on switch, and input goes to the
correct agent, with no duplicated or missing scrollback.

**Acceptance Scenarios**:

1. **Given** two active agents, **When** the user switches from agent A to agent B, **Then** the
   terminal shows agent B's real TUI state and input is routed to agent B.
2. **Given** the user switches back to agent A, **When** A regains foreground, **Then** A's
   current state is shown without stale or duplicated content.
3. **Given** an agent that produced output while not in the foreground, **When** it is brought to
   the foreground, **Then** its latest state is visible.

---

### Edge Cases

- **Runtime crash (per-office crash domain)**: If an office's hosted runtime exits unexpectedly,
  all of that office's agent sessions are affected (other offices are unaffected). Affected agents
  MUST be surfaced via error channels and be recoverable by relaunching the office runtime and
  resuming sessions by GUID.
- **`--ui-server` unavailable**: The installed CLI build does not support the mode (it is
  undocumented/hidden). The system MUST detect this and fall back rather than fail silently.
- **Permission / plan-mode modal collision**: A programmatically driven turn triggers a permission
  or plan dialog on a session a human is also viewing/typing in.
- **Auth boundary**: The control-plane client attaches to an externally launched runtime and
  therefore cannot supply logged-in-user/token options; the hosting runtime must own auth.
- **Office switch**: Switching offices must detach (not kill) sessions and reattach cleanly,
  preserving session continuity (Constitution III, BL-004).
- **Port allocation failure / bind conflict**: The runtime cannot open its local control port.
- **Human input during a programmatic turn (verified 2026-07-08)**: A programmatic SDK prompt and a
  human's keystrokes travel on separate channels (SDK control connection vs TUI stdin) and converge
  as independent, ordered turns. A spike confirmed that sending a programmatic prompt while a human
  has an unsubmitted input line **preserves** the human's line (it is neither cleared nor merged);
  the programmatic prompt runs as its own turn, and the human's line submits as a separate turn only
  when the human presses Enter. `mode: 'enqueue'` preserves submission order without splicing text.
- **Keystrokes during session load (verified 2026-07-08)**: Keystrokes typed before a session has
  finished loading can be dropped. Input (human or programmatic) MUST NOT be routed to a session
  until it signals ready.
- **Session GUID continuity**: A resumed agent must map to the same session identity used for
  persistence and history.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST host each agent's real Copilot TUI through the CLI's `--ui-server`
  (TUI + local control server) mode running inside a node-pty process, preserving authentic
  terminal rendering.
- **FR-002**: The system MUST discover the runtime's local control endpoint after launch and
  attach a Copilot SDK client to that already-running runtime (no second runtime process per
  agent).
- **FR-003**: The system MUST create and resume agent sessions through the SDK against the hosted
  runtime, preserving the existing per-agent session identity used for persistence and history.
- **FR-004**: The system MUST submit programmatic prompts (e.g., Teams remote, fleet
  orchestration) through the SDK as atomic turns, replacing keystroke injection. Multi-line
  prompts MUST be delivered as a single turn.
- **FR-005**: The system MUST expose the assistant's response for a programmatic turn as
  structured data to downstream consumers (e.g., the Teams reply path) without scraping raw
  terminal bytes.
- **FR-006**: The system MUST derive agent status/tool/turn transitions from structured SDK events
  for SDK-hosted agents, rather than tailing `events.jsonl`.
- **FR-007**: The system MUST switch the visible agent by changing the hosted runtime's foreground
  session, so the real TUI reflects the selected agent's live state.
- **FR-008**: Human keyboard input to the visible agent MUST continue to reach that agent's TUI
  and MUST route through `InputManager` focus transitions (no ad hoc keyboard handling).
- **FR-009**: The system MUST map the app's existing permission posture (yolo / additional
  parameters) onto the SDK/runtime so tool-permission behavior matches today's behavior.
- **FR-010**: The system MUST detect whether the installed CLI supports `--ui-server` and, when it
  does not, fall back to the existing node-pty backend without user-facing failure.
- **FR-011**: Backend selection (SDK control plane vs legacy node-pty) MUST be driven by typed
  configuration / feature flag, not hardcoded scene logic (Constitution V).
- **FR-012**: The system MUST preserve session continuity across office switches: switching offices
  detaches viewers without killing sessions, and returning reattaches cleanly (Constitution III).
- **FR-013**: The system MUST preserve fleet-critical event forwarding (sub-agent lifecycle,
  system notifications, task tool start) even when no viewer is attached, matching today's
  guarantees.
- **FR-014**: The system MUST surface control-plane failures (attach failure, send failure,
  runtime exit) through established error channels with structured lifecycle logging; silent
  failure is not acceptable.
- **FR-015**: The system MUST NOT regress terminal selection/clipboard behavior across both
  terminal surfaces (Constitution VI).
- **FR-016**: The system MUST host one runtime per office: all agent sessions belonging to an
  office share that office's single `--ui-server` runtime and control port. A runtime crash is
  contained to its office; other offices' agents are unaffected. (Clarified 2026-07-08.)
- **FR-017**: The SDK control plane MUST carry only programmatic prompts (e.g., Teams remote,
  fleet orchestration). Human keyboard input MUST continue to go directly to the agent's real TUI
  via node-pty, preserving native slash commands, autocomplete, and interactive modals.
  (Clarified 2026-07-08.)
- **FR-018**: The legacy node-pty backend MUST be retained as a permanent, supported fallback. The
  SDK control plane and legacy backend coexist (dual-backend), selected by config/feature flag
  (FR-011), with automatic fallback to legacy when `--ui-server` is unavailable (FR-010). This is a
  deliberate hedge because `--ui-server` is currently undocumented. (Clarified 2026-07-08.)
- **FR-019**: When a programmatic prompt is submitted while a human has an unsubmitted input line on
  the same session, the system MUST preserve the human's unsubmitted text and deliver both as
  independent, ordered turns (no merge, no loss). (Verified behavior, 2026-07-08.)
- **FR-020**: The system MUST NOT route human keystrokes or deliver programmatic prompts to a
  session until that session has signaled ready, to avoid input dropped during session load.
- **FR-021**: When a programmatic turn triggers an interactive modal (permission / ask_user /
  plan-mode) on a session a human is also viewing, the system MUST resolve the collision without
  losing the human's unsubmitted input, and this case MUST be covered by an explicit test in the
  plan. (Residual risk flagged 2026-07-08 — not yet verified.)

### Key Entities *(include if feature involves data)*

- **Hosted Runtime**: A Copilot CLI process launched in `--ui-server` mode inside node-pty,
  exposing a local control endpoint and rendering the foreground session's TUI. Owns
  authentication.
- **Control-Plane Client**: An SDK client attached to a hosted runtime that creates/resumes
  sessions, sends prompts, subscribes to events, and switches the foreground session.
- **Agent Session**: A persistent conversation identity (existing session GUID) mapped 1:1 to an
  agent within an office, resumable across restarts and office switches.
- **Foreground Selection**: The single session currently rendered by a hosted runtime's TUI.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: 100% of programmatic prompts delivered under normal operation result in exactly one
  submitted turn (no dropped, duplicated, or half-submitted prompts) across a repeated test batch.
- **SC-002**: Programmatic replies are delivered without the keystroke-injection retry loop; the
  legacy inject-and-poll path is no longer exercised for SDK-hosted agents.
- **SC-003**: Agent status badges reflect the agent's true state within a small, consistent delay
  after each transition, with zero stuck "thinking" states after a turn ends across the test
  suite.
- **SC-004**: Switching the visible agent shows the selected agent's live TUI state on every
  switch, with no scrollback duplication or loss.
- **SC-005**: When `--ui-server` is unavailable, the app starts and operates via the legacy
  backend with no user-facing error.
- **SC-006**: No regression in terminal copy/paste, office switching, or fleet/meeting flows, as
  verified by existing repository test scripts for the impacted areas.
- **SC-007**: Concurrent human typing and programmatic sends never lose or merge input: a human's
  unsubmitted line is preserved across a programmatic turn in 100% of a repeated test batch.

## Assumptions

- Node-pty remains the render host; this feature does **not** attempt headless self-rendering of
  the TUI (Variant 2 is out of scope).
- The installed CLI exposes `--ui-server` as a hidden but functional flag (empirically verified on
  the current build); because it is undocumented, a capability probe and fallback are required.
- The control-plane SDK client attaches to an externally launched runtime and therefore does not
  pass logged-in-user/token options; the hosted runtime process owns auth (e.g., via the app's
  existing environment/login).
- Only one agent's TUI is visible at a time (already true today — the app reuses a single terminal
  widget), so a foreground-switch model is behavior-compatible with the current UX.
- Session identity continues to be the existing per-agent session GUID stored in office session
  files.
- The SDK version will be upgraded to the current stable release as a prerequisite; API surface
  for send/resume/events is stable across that upgrade.
- Each office hosts its own runtime; an office's agent sessions are multiplexed on that runtime and
  the foreground TUI shows one of them at a time (per FR-016).
- Human input remains native to the real TUI; only programmatic prompts use the SDK (per FR-017).
- The legacy node-pty backend is retained permanently as a supported fallback (per FR-018).

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: Phaser remains the sole in-canvas renderer. This feature touches only the
  DOM terminal overlay and the Electron/terminal control plane; the real Copilot TUI continues to
  render into xterm.js via node-pty. No gameplay rendering moves to the DOM.
- **Event & Input Boundary**: New coordination flows through documented events/IPC channels
  (`terminal:*`, `agent:*`, `teams:*`) and the terminal-server protocol. Human input focus
  transitions continue through `InputManager`; no direct Phaser keyboard manipulation is added.
- **Session Integrity Impact**: This directly affects the terminal/session lifecycle
  (renderer → preload → main → terminal server → runtime). The design MUST preserve event
  forwarding and session continuity across office switches and meeting/fleet transitions
  (Principle III, BL-004). Session GUID identity and detach-not-kill semantics are preserved.
- **Configuration Impact**: Backend selection is a typed feature flag / config value, not hardcoded
  scene logic (Principle V). No agent IDs or layout behaviors are hardcoded; existing named
  constants and layout behavior flags are used.
- **Regression Plan**: Impacted high-risk flows — terminal lifecycle, programmatic reply
  (Teams), fleet event forwarding, office switching, and clipboard/selection — MUST be covered by
  existing repository test scripts plus targeted tests. Clipboard plumbing changes (if any) MUST
  mirror across `TerminalOverlay` and `SeriousTerminalController` (Principle VI). Because work
  happens in a worktree, verification MUST confirm the rebuilt bundle is the one under test
  (Principle VII).
