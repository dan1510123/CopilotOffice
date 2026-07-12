# Implementation Plan: Resolve ask_user Prompts via Teams Remote

**Branch**: `015-teams-ask-user-resolution` | **Date**: 2026-07-11 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/015-teams-ask-user-resolution/spec.md`

## Summary

When an **online** agent raises an `ask_user` interaction, surface the question and its
labeled options in the agent's bound Teams thread as **formatted HTML text** (Option A —
no Adaptive Cards), and let a thread reply resolve the pending selection **matched solely
by selector label** (number/letter). Every `ask_user` from an online agent is forwarded,
whether the turn was Teams- or locally-initiated (FR-013).

Two mechanisms make this work, both grounded in the existing code and **verified by a
runtime spike** against the real CLI + SDK (see [research.md](./research.md) Decision 1):

1. **Payload preservation (FR-015/016)** — on the SDK/ui-server backend (product default)
   `ask_user` is the SDK **user-input interaction**, whose `user_input.requested` event
   carries `{requestId, question, choices, allowFreeform, toolCallId}` **natively** (no
   argument scraping). We relay it as a dedicated, additive `copilot-ask-user` event
   carrying `{toolId, requestId, question, options[], freeform}` alongside the unchanged
   `copilot-tool-start`, server → main (`protocol.ts`, `ipc-relay.ts`, `preload.ts`) →
   `SessionGateway` (new `ask-user` AgentEvent kind) → `TeamsService`. The node-pty
   fallback (no SDK session) normalizes `tool.execution_start` arguments best-effort
   (`requestId` unavailable); its static `'Waiting for your answer'` status is untouched.

2. **Answer submission via the SDK user-input channel (FR-004)** — a **new prerequisite**:
   every managed SDK/ui-server session MUST register an `onUserInputRequest` handler, or
   the model refuses to call `ask_user` (spike-verified). A Teams answer flows through a
   new transport-agnostic seam `RelaySessionGateway.submitAnswer(officeId, agentId,
   {requestId?, answer, wasFreeform}) → server 'submit-answer' IPC`, which resolves the
   pending interaction via `handlePendingUserInput(requestId)` (SDK/ui-server) or keystroke
   injection (node-pty). The handler promise may be resolved **late**, so the agent waits
   for the Teams reply and the resolution appears in the terminal exactly once with no
   forked/duplicated session. A `PendingQuestion` per online agent (keyed by `requestId`,
   held in the Teams service with a `resolved` latch) guarantees at-most-once resolution
   across the Teams/local race and keeps answers ahead of queued follow-ups. Local
   answers are detected via the SDK `user_input.completed` event.

All Teams posting (question, nudges, notices) reuses `safeReply` → `graphClient`
(self-marker, `postedMessageIds`, `chunkReply`); all inbound reuses `messageFilter` and
the per-agent `DispatchQueue`. No bot, no new auth, no renderer/Phaser changes.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Electron 40 main process (Node ~20/22) + Phaser 3 renderer (unaffected)
**Primary Dependencies**: Electron IPC, existing terminal server + `EventsWatcher`, `@github/copilot-sdk` / node-pty backends, Microsoft Graph (send) + Trouter/chatsvc (receive) — all reused from spec 011
**Storage**: None new. `PendingQuestion` state is transient, in-memory, main-process-only. Persisted `TeamsStoreState` unchanged.
**Testing**: Vitest (`npm run test`) unit/integration; Playwright (`npm run test:e2e`) only if a UI-observable path is added (none required)
**Target Platform**: Windows/macOS desktop (Electron); `az` CLI signed in for Teams tokens
**Project Type**: Desktop app (Electron main + Phaser/DOM renderer), single repository
**Performance Goals**: Question post within one Teams round-trip of the `ask_user` event; answer resolves within one reply (SC-002); no added latency to non-ask_user events
**Constraints**: Reuse all spec-011 Teams infra; additive event only (no regression to `copilot-tool-start` or other events — FR-016); answers resolve the pending interaction through the new `submit-answer`/`handlePendingUserInput` seam (SDK) or keystroke injection (node-pty), never forking/duplicating the session (Principle III); **managed SDK sessions must register `onUserInputRequest`** or `ask_user` is unusable; respect the `ask_user` waiting-state race-guard (`src/util/toolStatus.ts`) and agent-status presentation (`src/config/agentStatusPresentation.ts`)
**Scale/Scope**: One pending question per online agent; a handful of agents online concurrently; single signed-in posting identity

### Key resolved decisions (see research.md — spike-verified)

- **Answer-submission mechanism**: register `onUserInputRequest` on every managed SDK
  session (prerequisite — without it the model refuses `ask_user`); resolve a Teams answer
  via a new `gateway.submitAnswer` → `submit-answer` IPC → `handlePendingUserInput(requestId)`
  (SDK/ui-server) or keystroke injection (node-pty). The handler promise resolves **late**
  (async Teams reply). This **replaces** the earlier "reuse `submitPrompt`/enqueue" idea —
  the spike showed `enqueue` does *not* resolve a pending interaction; the dedicated
  user-input channel does. Submit the option's **display text** (labels are Teams-only);
  `requestId` is the single-resolution key; local answers detected via `user_input.completed`.
- **Payload relay**: additive `copilot-ask-user` event carrying `requestId`; on the
  SDK/ui-server backend fields come natively from `user_input.requested`; labels are
  assigned by the consumer (`TeamsService`), not the gateway/server (both stay dumb
  forwarders).
- **Presentation**: formatted HTML text, Option A (no cards — the receive path can't
  observe card `Action.Submit` without a registered bot).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Phaser-first constraint respected** — no in-canvas renderer change. This is
  main-process/Teams + terminal-server event plumbing; the renderer parity bridge
  (`onCopilotAskUser`) is optional and unused by Phaser.
- [x] **Event-driven boundaries preserved** — the payload rides a new documented
  `copilot-ask-user` IPC/event through the existing `ipc-relay.ts`/`preload.ts` boundary
  and a new `ask-user` `AgentEvent` kind; no hidden cross-layer coupling. Additive to
  `copilot-tool-start` (unchanged).
- [x] **Input focus transitions routed through `InputManager`** — N/A (no new UI/input
  surface; no keyboard handling in the renderer).
- [x] **Session lifecycle integrity maintained** — a Teams answer resolves the **pending
  user-input interaction** via the new `submit-answer` → `handlePendingUserInput(requestId)`
  seam (SDK/ui-server) or keystroke injection (node-pty) — a single answer channel that
  never detaches/duplicates/forks the session, and it respects the `ask_user` waiting-state
  race-guard. Registering `onUserInputRequest` on managed sessions enables the tool without
  altering session lifecycle. Payload relay adds a consumer, not a lifecycle.
- [x] **Configuration-first approach** — gated by the existing Teams feature flag +
  channel config; forwarding scope (all `ask_user`, FR-013) follows spec, no hardcoded
  special-case branching beyond the additive event.
- [x] **Regression validation scope defined** — targeted tests for payload relay
  (additive, no `copilot-tool-start` regression), question posting, label/freeform/nudge
  matching, single-resolution race, offline/session-end abandonment, self-loop exclusion,
  dispatch ordering; plus non-regression of ordinary Teams prompt routing and the local
  `ask_user` waiting-state (FR-016).

**Result: PASS** — no violations; Complexity Tracking not required.

*Post-Phase-1 re-check*: design keeps all changes additive (new event kind, new in-memory
entity, answer resolver that bypasses the dispatch enqueue) and introduces no new
renderer/auth/persistence surface. **Still PASS.**

## Project Structure

### Documentation (this feature)

```text
specs/015-teams-ask-user-resolution/
├── plan.md              # This file
├── research.md          # Phase 0 — answer-submission mechanism + payload-relay decisions
├── data-model.md        # Phase 1 — PendingQuestion / Option entities + lifecycle state machine
├── quickstart.md        # Phase 1 — setup + manual verification
├── contracts/           # Phase 1
│   ├── events-ipc.md            # server→main ask_user payload relay (additive copilot-ask-user)
│   └── question-answer-flow.md  # internal TeamsService question/answer/nudge/abandon contract
└── tasks.md             # Phase 2 (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
electron/
├── terminal/
│   ├── terminal-backend.ts # register onUserInputRequest on managed SDK sessions (createOrResumeSession ~L754, forStdio ~L534); add handlePendingUserInput(requestId,{answer,wasFreeform}) resolver
│   ├── events-watcher.ts   # normalize ask_user args for node-pty degraded path; keep formatToolStatus static label (FR-016)
│   ├── server.ts           # emit copilot-ask-user (from user_input.requested / node-pty args); forward user_input.completed viewer-less; + 'submit-answer' handler → handlePendingUserInput | keystrokes (~L971)
│   ├── protocol.ts         # + SrvCopilotAskUser (with requestId) + 'submit-answer' IPC message
│   ├── ipc-relay.ts        # + 'copilot-ask-user' fan-out (agentId,toolId,requestId,question,options,freeform); + mainSubmitAnswer → 'submit-answer'; update doc comment (~L18)
│   └── preload.ts          # + onCopilotAskUser bridge + type + removeAllListeners cleanup (~L138,175,325)
└── teams/
    ├── sessionGateway.ts   # + AgentEventKind 'ask-user' + AgentEvent.askUser (requestId); map copilot-ask-user (NO labels here); + submitAnswer seam
    ├── teamsService.ts     # PendingQuestion map (keyed by requestId); onAskUserEvent (assign labels + post); answer resolver in handleInbound;
    │                       #   nudge; "answered in app" (via user_input.completed) / "no longer answerable" notices; clear on offline/exit
    └── types.ts            # + AskUserOption / PendingQuestion types (with requestId)

src/
├── util/toolStatus.ts                 # (reused as-is — race-guard honored, not modified)
└── config/agentStatusPresentation.ts  # (reused as-is — presentation honored, not modified)

tests/
└── unit|integration/teams/            # payload relay, question posting, matching, race,
                                       #   abandonment, self-loop, ordering, non-regression
```

**Structure Decision**: Single-repo desktop app; all work is **main-process** (terminal
server event plumbing + `electron/teams/*`). The renderer contributes only an optional
parity bridge. This mirrors spec 011's boundary (Teams service in main; renderer talks
via documented IPC) and keeps blast radius minimal — the only cross-cutting change is the
strictly-additive `copilot-ask-user` event.

## Complexity Tracking

> No constitution violations — section intentionally empty.
