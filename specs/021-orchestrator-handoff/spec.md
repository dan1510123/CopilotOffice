# Feature Specification: Orchestrator Session Handoff + Approval/Bring-Online Fixes

**Feature Branch**: `021-orchestrator-handoff`
**Created**: 2026-08-11
**Status**: Draft
**Input**: User description: "I want a new feature to say `handoff`, which should have
orch write a handoff doc for the source session, then spin up a new session, then send a
message to that new session saying 'Pick up from this handoff'." — plus a set of
orchestrator bug fixes observed in a live Teams session (see **Part B**).

## Scope

This spec has two parts:

- **Part A — Handoff feature** (new capability): the `handoff_session` orchestrator tool.
- **Part B — Orchestrator bug fixes** (from a live Teams-remote orchestrator session):
  the approval-timeout retry loop, custom-office reserve `invalid-target`, denial being
  reported as a transient error, and stale status reads. All are orchestrator
  gating / bring-online / status behaviors, so they ride along in this spec.

## Context

Spec 016 shipped the **Office Orchestrator** — a dedicated, always-gated Copilot SDK
session that discovers and brings agents online. Spec 017 added situational-awareness
and act-on tools (`get_agent_transcript`, `send_prompt_to_agent`, `restart_agent`,
`bring_agent_online`, `set_agent_teams_presence`, …), each routed through the
orchestrator's always-on permission gate and backed by `requestX`/`respondX`
round-trips resolved late in the renderer (`src/office/orchestratorActOn.ts`).

A long-running agent session accumulates context that eventually needs to be retired —
the terminal scrollback is bounded, the model context grows stale, or the work should
continue under a fresh session (same identity, or a different agent taking over).
Today the only way to do that is manual: open the source terminal, ask the agent to
summarize, copy the summary, restart or bring up another agent, and paste it in.

This feature adds a single orchestrator capability — **handoff** — that chains the
sanctioned per-agent operations that already exist into one gated action:

1. Ask the **source** agent to author a durable **handoff document** (it uses its own
   file tools, in its own working directory, so the doc captures internal state the
   bounded transcript window would miss).
2. Bring up the **target** session — the orchestrator decides per request whether that
   is a **fresh session for the same agent** (context reset, same identity + working
   directory) or a **different/reserve agent** taking over.
3. Deliver a **"Pick up from this handoff"** prompt to the target, pointing it at the
   handoff document so it resumes the work with full context.

## Clarifications

### Session 2026-08-11

- Q: Who authors the handoff document? → A: The **source agent** writes it, using its
  own file tools, so the doc captures richer internal context than the orchestrator's
  bounded transcript window (`get_agent_transcript`) can see.
- Q: What is the "new session" the handoff spins up? → A: **The orchestrator decides
  per handoff.** It may be a fresh session for the *same* agent (context reset, same
  identity/working directory) or a *different* agent (e.g. a reserve) brought online to
  take over. The tool accepts an explicit target selector and defaults to "same agent".
- Q: How does the target avoid reading a half-written handoff doc? → A: The handoff doc
  is written to a deterministic path derived from the source agent + timestamp. The
  pickup prompt names that path and instructs the target to read it before starting; if
  the file is not present yet, the target briefly waits/retries. The orchestrator does
  not block its own turn waiting on the source agent's asynchronous write.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Hand off a session to a fresh session of the same agent (Priority: P1)

As the person driving the orchestrator, I can say "hand off Darcy's session" and the
orchestrator will (a) tell Darcy to write a handoff document summarizing state,
decisions, and next steps; (b) restart Darcy into a fresh session; and (c) prompt that
fresh session to pick up from the handoff document — all behind a single approval.

**Why this priority**: This is the core reported request and the most common shape of a
handoff — retire a stale/long context without losing the thread, keeping the same agent
identity and working directory.

**Independent Test**: With Darcy online and mid-task, issue a handoff. Confirm a handoff
document is created in Darcy's working directory, Darcy's session is restarted, and the
new session receives a "Pick up from this handoff" prompt naming the document path.

**Acceptance Scenarios**:

1. **Given** Darcy is online with a live session, **When** the user approves a handoff
   with target "same agent", **Then** the source session is asked to write a handoff doc
   at a deterministic path, the agent is restarted, and the fresh session receives a
   pickup prompt referencing that path.
2. **Given** the handoff is requested, **When** the permission gate is **denied**, **Then**
   nothing is written, no session is restarted, and the tool returns `outcome:'denied'`.
3. **Given** the source agent is **not online**, **When** a handoff is requested, **Then**
   the tool returns `outcome:'not-online'` with a message to bring it online first, and
   makes no changes.

### User Story 2 - Hand off to a different agent taking over (Priority: P2)

As the person driving the orchestrator, I can hand off from one agent to another — e.g.
"have Darcy hand off to a reserve" — so a different agent picks up the work. The source
writes the handoff doc; the orchestrator brings the target agent online (idle-seated or
reserve, including the scene spawn) and delivers the pickup prompt to it.

**Why this priority**: Handoffs across agents (load-shedding, specialization, retiring an
agent entirely) are valuable but secondary to the same-agent context reset.

**Independent Test**: With Darcy online, request a handoff to a named/idle reserve.
Confirm the doc is written by Darcy, the target agent is brought online, and the pickup
prompt is delivered to the **target** (not the source).

**Acceptance Scenarios**:

1. **Given** a valid, distinct target agent, **When** a cross-agent handoff is approved,
   **Then** the source writes the doc, the target is brought online, and the pickup prompt
   is delivered to the target session.
2. **Given** a target that cannot be activated (e.g. reserve with no open seat), **When**
   the handoff runs, **Then** the tool returns `outcome:'invalid-target'` (or `failed`)
   and does not deliver a pickup prompt.
3. **Given** the target equals the source, **When** the handoff runs, **Then** it is
   treated as the same-agent (US1) restart path, not a no-op.

### User Story 3 - Handoff document is durable and discoverable (Priority: P2)

As the user, after a handoff I can find the handoff document on disk (in the source
agent's working directory, under a predictable location) so I can read what was carried
over, independent of any live session.

**Why this priority**: The document is the artifact that makes a handoff trustworthy and
reviewable; it must outlive both sessions.

**Independent Test**: Run a handoff, then locate the handoff document at the reported
path and confirm it contains a human-readable summary (state, decisions, next steps).

**Acceptance Scenarios**:

1. **Given** a completed handoff, **When** the tool returns, **Then** the result includes
   the absolute/relative `handoffDocPath` that was communicated to both agents.
2. **Given** repeated handoffs of the same agent, **When** each runs, **Then** paths are
   unique (timestamped) so earlier handoff docs are not overwritten.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The orchestrator MUST expose a single gated `handoff_session` tool that
  chains: (1) instruct the source agent to author a handoff document, (2) provision the
  target session, and (3) deliver a "Pick up from this handoff" prompt to the target.
- **FR-002**: The tool MUST be **gated** through the orchestrator's always-on, non-YOLO
  permission gate. A single approval MUST cover the whole chain (mirroring the auto
  bring-online-then-Teams pattern of `set_agent_teams_presence`). Denial ⇒
  `outcome:'denied'` with **zero** side effects.
- **FR-003**: The handoff document MUST be authored by the **source agent** (via a
  delivered prompt using its own file tools), NOT by the orchestrator, so it captures
  internal context beyond the bounded transcript window.
- **FR-004**: The handoff document path MUST be **deterministic and unique per handoff**
  (source agent id + timestamp) under a predictable location in the source agent's
  working directory (e.g. `./.copilot-handoffs/handoff-<agentId>-<ISO8601>.md`). The path
  MUST be included in the tool result and in both delivered prompts.
- **FR-005**: The target session MUST be selectable per handoff: `same` (default — restart
  the source agent into a fresh session, preserving identity + working directory) or a
  specific `targetAgentId` (a different agent brought online, incl. reserve scene spawn).
  A `targetAgentId` equal to the source MUST behave as `same`.
- **FR-006**: For the `same` target, the tool MUST reuse the sanctioned restart path
  (`restartSession`); for a distinct target it MUST reuse the sanctioned bring-online
  path (`bringOnline`, which handles idle-seated and reserve activation and waits for the
  session to be ready). It MUST NOT mutate `activeAgentViewers` directly (Principle III).
- **FR-007**: The pickup prompt MUST be delivered to the **target** session (never the
  source, except in the same-agent case where the target *is* the fresh source session)
  via the sanctioned submit-prompt path (`deliverText`), and MUST instruct the target to
  read the handoff document at the reported path before starting, waiting/retrying briefly
  if it is not yet present.
- **FR-008**: The orchestrator MUST NOT block its own turn waiting on the source agent's
  asynchronous write; ordering is guaranteed by the pickup prompt's read-then-start
  instruction (FR-007), not by orchestrator-side polling.
- **FR-009**: Targets MUST be office-qualified and re-validated at execution time
  (FR-019 pattern from spec 017). The tool MUST refuse the synthetic orchestrator identity
  as either source or target.
- **FR-010**: The tool MUST return a typed `HandoffResult` capturing `sourceAgentId`,
  resolved `targetAgentId`, `officeId`, `handoffDocPath`, and an `outcome`. Outcomes:
  `handed-off` | `denied` | `not-online` (source offline) | `invalid-target` (bad/absent
  target) | `failed`. Failure paths MUST NOT throw silently.
- **FR-011**: Every handoff outcome (including denials) MUST be recorded in the
  orchestrator transcript with source, target, and doc path (spec 017 transcript pattern).
- **FR-012**: The feature MUST NOT introduce a new in-canvas renderer or new keyboard
  capture path; it reuses the orchestrator panel/IPC seams only.

### Key Entities

- **HandoffRequest**: `{ sourceAgentId, officeId?, target: 'same' | { targetAgentId },
  note? }` — `note` is optional extra guidance folded into the source's doc-writing prompt.
- **HandoffResult**: `{ sourceAgentId, targetAgentId, officeId, handoffDocPath, outcome,
  message }`.
- **Handoff document**: a Markdown file authored by the source agent at `handoffDocPath`
  containing state, decisions made, open questions, and next steps.

## Success Criteria *(mandatory)*

- **SC-001**: A single approved handoff produces (a) a handoff document at the reported
  path, (b) a provisioned target session, and (c) a pickup prompt delivered to the target
  — with one approval.
- **SC-002**: A denied handoff produces zero side effects (no doc write prompt sent, no
  restart/bring-online, no pickup prompt) and returns `outcome:'denied'`.
- **SC-003**: Same-agent handoffs preserve the agent's identity and working directory; the
  fresh session is a real restart, not a detach.
- **SC-004**: Cross-agent handoffs deliver the pickup prompt to the target agent, and the
  source agent is left as-is (its doc written) unless separately stopped.
- **SC-005**: Handoff document paths are unique across repeated handoffs of the same agent.
- **SC-006**: All existing orchestrator + Teams unit tests stay green; new unit coverage
  exercises each `HandoffResult` outcome (success, denied, not-online, invalid-target,
  failed) for both same-agent and cross-agent targets.

## Part B: Orchestrator Approval & Bring-Online Bug Fixes *(mandatory)*

These four bugs were observed driving the Office Orchestrator online in a Teams thread.
All are orchestrator gating / bring-online / status behaviors.

### Bug Story B1 - Approval timeout must not spawn a retry loop (Priority: P1)

**Observed**: A gated action (`set_agent_teams_presence` for Darcy/Luna) posted "🔐 needs
your approval", then 5 minutes later "⏱️ No approval within 5 min — denied.", immediately
followed by "⏳ Still working… (running: set_agent_teams_presence)" and a **fresh** approval
prompt for the *same* action — a deny→re-request loop.

**Root cause**: The Teams relay auto-denies an unanswered gate after
`PERMISSION_TIMEOUT_MS` (`teamsService.onApprovalTimeout` → `respondPermission(..,'deny')`).
The orchestrator model treats that denial as a *transient failure* and re-invokes the tool,
which arms a new gate + new timeout — looping every ~5 min until a human happens to answer.

**Required behavior**:

- **FR-B01**: A gate that is auto-denied **due to timeout / no reachable approver** MUST be
  surfaced to the model as a **terminal "not approved — stop and wait for the user"**
  outcome, distinct from an explicit user deny, so the model does NOT automatically
  re-invoke the same tool. The relay message MUST make clear the request lapsed (not that
  the action failed).
- **FR-B02**: The orchestrator MUST NOT silently re-arm the identical gated call after a
  timeout-deny. If the model still attempts it, a **superseding** identical request for the
  same `(agentId, toolName)` MUST replace the prior pending gate (already partially handled
  by `onPermissionRequestEvent`'s supersede path) rather than accumulating parallel gates,
  and MUST NOT reset a just-lapsed timer into an immediate new 5-minute wait without any new
  user signal.

**Acceptance Scenarios**:

1. **Given** a relayed gate that no one answers, **When** it times out, **Then** the model
   receives a terminal "not approved" signal, stops, and does not immediately re-request the
   same action.
2. **Given** the model does re-request the same `(agent, tool)`, **When** a prior gate is
   still pending, **Then** the prior gate is superseded (single pending gate per agent), not
   duplicated.

### Bug Story B2 - Custom-office reserves must not be offered then fail `invalid-target` (Priority: P1)

**Observed**: In the TeamsChannel office, bringing "the next reserve" online proposed
**Miles** then **Ivy**, both of which returned `invalid-target` ("couldn't activate"), while
a later candidate (Luna) succeeded — two consecutive reserve activations failing the same way.

**Root cause**: `computeBringOnlineCandidates` (renderer) builds the reserve candidate list
from the **default** `RESERVE_AGENTS` registry only and ignores the office's
`config.customReserveAgents` / `config.customAgents`. In a custom office (TeamsChannel) it
therefore offers default reserves that have no real seat there, so `executeBringOnline` /
the reserve scene-spawn rejects them as `invalid-target`. (Note `orchestratorActOn`'s
`isKnownDormantAgent` already consults the custom rosters — the two disagree.)

**Required behavior**:

- **FR-B03**: `computeBringOnlineCandidates` MUST derive both idle-seated and reserve
  candidates from the **effective office roster** — honoring `config.customAgents` and
  `config.customReserveAgents` when present (mirroring `isKnownDormantAgent`) — so it never
  offers an agent that cannot be activated in that office.
- **FR-B04**: When an activation still fails because a reserve seat is genuinely
  unavailable, the result message MUST say so specifically (e.g. "no open reserve seat")
  rather than the generic `invalid-target`, so the orchestrator can relay an actionable
  reason instead of blindly trying the next candidate.

**Acceptance Scenarios**:

1. **Given** a custom office with `customReserveAgents`, **When** the orchestrator lists
   bring-online candidates, **Then** only agents actually seatable in that office appear,
   and every listed candidate activates without `invalid-target`.
2. **Given** no reserve seat is available, **When** activation is attempted, **Then** the
   outcome message names the seat-unavailable reason.

### Bug Story B3 - A user denial must be reported as a decision, not an error (Priority: P2)

**Observed**: After the user approved Darcy, the orchestrator replied "That attempt hit an
approval error rather than a clean result — it looks like the request was
declined/interrupted. Let me retry…" — i.e. a denial/interruption was narrated as an error
and auto-retried, even though the action ultimately succeeded on retry.

**Root cause**: The gated-tool denial result (`denied-interactively-by-user`) is surfaced to
the model without a clear, typed "the user chose to deny" signal, so the model interprets it
as a recoverable error and retries.

**Required behavior**:

- **FR-B05**: An explicit user **deny** MUST resolve the tool to a first-class
  `outcome:'denied'` with a message that frames it as a **deliberate user decision** (not an
  error/interruption), and the tool description/guidance MUST instruct the orchestrator NOT
  to automatically retry a user-denied action — instead acknowledge and ask what to do next.
- **FR-B06**: The distinction between **user-denied** (FR-B05) and **timeout-lapsed**
  (FR-B01) MUST be preserved end-to-end so the model can respond appropriately to each.

**Acceptance Scenarios**:

1. **Given** the user denies a gated action, **When** the tool returns, **Then** the
   orchestrator acknowledges a deliberate denial and does not auto-retry.
2. **Given** a denied action, **When** the orchestrator responds, **Then** it does not
   describe the denial as an "approval error".

### Bug Story B4 - Status reads must reflect real agent state (Priority: P3)

**Observed**: The user challenged the orchestrator with "Why was your read wrong?" after a
status/roll-up report that did not match reality.

**Root cause**: Not yet reproduced from logs; candidate causes include reading default vs.
custom roster (same class of bug as B2) or reporting stale status across offices.

**Required behavior**:

- **FR-B07**: The read-only status tools (`get_active_agents`, `get_agent_status`,
  `list_agents_awaiting_input`) MUST derive agent identity and roster membership from the
  **effective office roster** (custom-aware, same fix as FR-B03) and from the single
  `agentStatusPresentation` source of truth, so a status read cannot report agents that do
  not exist in that office or mislabel their state.
- **FR-B08 [NEEDS REPRO]**: Capture a concrete repro of the "wrong read" before finalizing;
  if it is not explained by FR-B07, file the specific discrepancy as a follow-up. This bug
  is P3 and MUST NOT block Part A or B1–B3.

### Success Criteria — Part B

- **SC-B01**: An unanswered relayed gate times out to a terminal "not approved" signal; the
  orchestrator stops and does not re-request the same action without new user input.
- **SC-B02**: In a custom office, every bring-online candidate the orchestrator lists
  activates successfully (no `invalid-target` for offered candidates); genuine seat
  exhaustion returns a specific reason.
- **SC-B03**: A user-denied gated action returns `outcome:'denied'` framed as a decision;
  the orchestrator does not narrate it as an error or auto-retry.
- **SC-B04**: Existing 200+ orchestrator + Teams unit tests stay green; new tests cover the
  timeout-vs-deny distinction, the custom-roster candidate fix, and the deny-no-retry
  guidance.

## Constitution Alignment

- **Phaser-first**: No new in-canvas renderer; reserve activation for a cross-agent target
  reuses the existing `game.events` scene round-trip (`activateReserve`).
- **Event-driven boundaries**: New `handoff_session` tool is backed by an
  `orchestrator:handoff:request/respond` round-trip resolved in the renderer; no hidden
  cross-layer coupling.
- **Input focus**: Unchanged — orchestrator panel keeps its `onOpen`/`onClose` →
  `InputManager` contract.
- **Session lifecycle integrity**: Reuses `restartSession` / `bringOnline` / `deliverText`;
  never touches `activeAgentViewers` outside `agent-viewers.ts` helpers; refuses the
  orchestrator identity.
- **Configuration-first**: No hardcoded agent IDs — source/target resolved via
  `OfficeManager` + `src/config/agents.ts`; status labels via `agentStatusPresentation`.

### Regression Plan

- Unit coverage in `tests/unit/orchestrator/` for the handoff resolver: same-agent restart,
  cross-agent bring-online, target==source coercion, offline source, invalid target,
  denial (no side effects), and doc-path uniqueness.
- Reuse existing `sendPromptToAgent` / `restartAgent` / `bringOnline` seam tests as the
  backing-op contract; assert the handoff composes them in order.
- **Part B**: extend `tests/unit/teams/` (approval relay) for the timeout-vs-deny signal
  distinction (B1/B3) and supersede-not-duplicate (B2's pending-gate behavior); extend
  `tests/unit/orchestrator/candidateSelection.test.ts` for custom-roster candidates (B2);
  keep `permissionGate.test.ts` / `actOnGateParity.test.ts` green.
- `npx tsc --noEmit`, targeted `npm run test`, and the e2e smoke stay green.

## Open Questions

- **OQ-1**: Should a same-agent handoff optionally **stop** the source instead of
  restarting (e.g. for a pure cross-agent retire)? Current design keeps the source alive
  on cross-agent handoffs; a separate `stop_agent` call remains available.
- **OQ-2**: Fixed handoff-doc location (`./.copilot-handoffs/`) vs. configurable per office.
  Default fixed; revisit if users want it elsewhere.
