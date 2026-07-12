---
description: "Task list for feature 015 — Resolve ask_user Prompts via Teams Remote"
---

# Tasks: Resolve ask_user Prompts via Teams Remote

**Input**: Design documents from `specs/015-teams-ask-user-resolution/`
**Prerequisites**: plan.md, spec.md (FR-001..FR-016, US1/US2/US3), research.md (spike-verified Decision 1/2), data-model.md, contracts/events-ipc.md, contracts/question-answer-flow.md, quickstart.md

**Tests**: Included. The plan defines targeted Vitest unit/integration suites and each contract enumerates explicit test expectations (constitution "Regression validation scope defined"). Test tasks precede the implementation they cover within each phase; write them to fail first.

**Organization**: Tasks are grouped by phase. Phase 2 (Foundational) carries the spike-verified answer-channel prerequisite and the end-to-end payload relay that ALL user stories depend on; Phases 3–5 map to spec user stories P1/P2/P3.

## CRITICAL context from the verified runtime spike (research.md Decision 1)

- `ask_user` on the SDK/ui-server backend maps to the SDK **user-input interaction**. The SDK emits `user_input.requested { requestId, question, choices: string[], allowFreeform, toolCallId }`; you answer via a registered `onUserInputRequest(request, {sessionId}) => Promise<{answer, wasFreeform}>` handler **or** `session.rpc.ui.handlePendingUserInput({ requestId, ... })`. The handler promise may be resolved **late** (async Teams reply). The agent then emits `user_input.completed { answer, wasFreeform, requestId }`.
- **Prerequisite (T004/T005):** a user-input handler MUST be registered at session create/resume or the model refuses to call `ask_user`. Current `ControlPlaneClient.createOrResumeSession` (`electron/terminal/terminal-backend.ts:754`) and `CopilotSdkBackend.resumeOrCreateSession` (`terminal-backend.ts:534`, `forStdio`) do **not** register it.
- **node-pty backend (fallback):** no SDK session — `ask_user` renders in the real TUI and is answered by keystroke injection (`submitViaKeystrokes`, `server.ts:380`). Structured surfacing there is best-effort/degraded.
- **Unified answer seam:** `RelaySessionGateway.submitAnswer(officeId, agentId, { requestId?, answer, wasFreeform })` — routes to `handlePendingUserInput(requestId)` for SDK/ui-server, keystroke injection for node-pty. `requestId` is the single-resolution key.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1 / US2 / US3 for user-story phases; Setup/Foundational/Polish carry no story label
- All paths are repository-root relative

---

## Phase 1: Setup (Shared Types & Contracts)

**Purpose**: Additive type surfaces every later phase references. No behavior change.

- [ ] T001 [P] Add `AskUserOption { label; text }` and `PendingQuestion { agentId, officeId, binding, toolId, requestId, question, options, freeform, resolved, postedMessageId?, createdAt }` interfaces to `electron/teams/types.ts` (per data-model.md; `requestId` is the SDK single-resolution key). No changes to `TeamsStoreState`/`OnlineAgentBinding`.
- [ ] T002 [P] Extend `AgentEventKind` with `'ask-user'` and add optional `askUser?: { toolId; requestId?; question; options: { text: string }[]; freeform: boolean }` to `AgentEvent` in `electron/teams/sessionGateway.ts:17-22` (additive; existing kinds untouched).
- [ ] T003 [P] Add `SrvCopilotAskUser { type:'copilot-ask-user'; agentId; toolId; requestId; question; options:{text}[]; freeform }` to the server→client union and a `submit-answer` client→server IPC message `{ type:'submit-answer'; officeId; agentId; requestId?; answer; wasFreeform }` in `electron/terminal/protocol.ts` (per contracts/events-ipc.md §1; leave `SrvCopilotToolStart` and `submit-prompt` unchanged).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Make `ask_user` usable on managed SDK sessions and carry the payload + answer end-to-end. **No user story can function until this phase is complete** (without T004/T005 the model refuses `ask_user`; without the relay Teams never sees the question; without `submitAnswer` no answer resolves).

**⚠️ CRITICAL**: Register the user-input handler (T004/T005) before anything else — it is the spike-verified prerequisite.

### Answer channel — session prerequisite (spike Decision 1)

- [ ] T004 Register `onUserInputRequest(request, {sessionId}) => Promise<{answer, wasFreeform}>` in `ControlPlaneClient.createOrResumeSession` `sharedConfig` (`electron/terminal/terminal-backend.ts:754-790`). Store each pending request in a per-backend `Map<requestId, {resolve, agentId/sessionId, toolCallId}>` and return the handler's promise so it can be resolved **late** by a Teams/local answer. Emit/propagate the `user_input.requested` payload for relay (T007).
- [ ] T005 Register the same `onUserInputRequest` handler in `CopilotSdkBackend.resumeOrCreateSession` `sharedConfig` (`electron/terminal/terminal-backend.ts:534-548`, `forStdio` path) using the shared pending-request map. Both backends MUST expose the handler so the model is told `ask_user` is available (`requestUserInput: true`).
- [ ] T006 Add a backend resolution API `handlePendingUserInput(requestId, { answer, wasFreeform })` in `electron/terminal/terminal-backend.ts` that resolves the stored `onUserInputRequest` promise (falling back to `session.rpc.ui.handlePendingUserInput({ requestId, answer, wasFreeform })` if no stored resolver). No-op + warn if `requestId` unknown/already resolved (idempotent).

### Payload relay: server → main → gateway (contracts/events-ipc.md)

- [ ] T007 In `electron/terminal/server.ts` `user_input.requested` / `tool.execution_start` handling (~`server.ts:763`), when the SDK raises a user-input interaction, emit a new `copilot-ask-user { agentId, toolId, requestId, question, options:{text}[], freeform }` **in addition to** the unchanged `copilot-tool-start` (status stays `'Waiting for your answer'`). Server stays a dumb forwarder — no label assignment, no HTML.
- [ ] T008 In `electron/terminal/server.ts` `watcherCallback` (~L735-845), forward the user-input events (`user_input.requested` and `user_input.completed`) to main for Teams-online agents **even when no viewer is attached** (mirror the existing viewer-less forwarding for tool/turn events); ensure `user_input.completed { answer, wasFreeform, requestId }` is surfaced so local resolution can be detected (FR-008).
- [ ] T009 In `electron/terminal/events-watcher.ts`, normalize `ask_user` arguments to `{ question, options:{text}[], freeform }` regardless of upstream key names (`question`/`prompt`, `options`/`choices` as `string[]` or `{label,value}[]`, freeform flag) for the node-pty/degraded path; **do not** modify `formatToolStatus` (its static `'Waiting for your answer'` label stays byte-for-byte — FR-016).
- [ ] T010 In `electron/terminal/ipc-relay.ts`: add a `case 'copilot-ask-user'` in **both** fan-out switches (`mainEvents.emit('copilot-ask-user', agentId, toolId, requestId, question, options, freeform)` ~L297 and `webContents.send(...)` ~L321), and add `mainSubmitAnswer(officeId, agentId, { requestId?, answer, wasFreeform })` → server `submit-answer` IPC. Update the channel-list doc comment (~L18). Existing `copilot-tool-start` / `submit-prompt` fan-out unchanged.
- [ ] T011 [P] In `electron/terminal/preload.ts`: add `onCopilotAskUser(cb)` bridge + its type (next to `onCopilotToolStart` ~L138/L325) and add cleanup in `removeAllListeners` (~L175). No renderer consumer required (boundary parity only).

### Unified answer seam + server routing (spike Decision 1)

- [ ] T012 In `electron/terminal/server.ts`, add a `case 'submit-answer'` handler (near the `submit-prompt` handler ~L971): for the SDK/ui-server backend route to `handlePendingUserInput(requestId, { answer, wasFreeform })` (T006); for the node-pty backend fall back to `submitViaKeystrokes(backendProc, answer, key)` (idle-gated type + Enter, ~L380). Never re-implement keystrokes/RPC outside this handler.
- [ ] T013 Add `submitAnswer(officeId, agentId, { requestId?, answer, wasFreeform }): Promise<void>` to `SessionGateway` + `RelaySessionGateway` in `electron/teams/sessionGateway.ts` (routes to `relay.mainSubmitAnswer`). Keep the existing `submitPrompt` for ordinary prompts. This is the single transport-agnostic answer seam the Teams service uses.
- [ ] T014 In `RelaySessionGateway.onAgentEvent` (`electron/teams/sessionGateway.ts:86`), subscribe to `mainEvents.on('copilot-ask-user', ...)` and map to a `{ kind:'ask-user', askUser:{ toolId, requestId, question, options, freeform } }` `AgentEvent` (options order preserved, `freeform` coerced boolean, labels NOT assigned here). Add matching `off()` in the returned unsubscribe.

### Foundational contract tests (contracts/events-ipc.md)

- [ ] T015 [P] Add `tests/unit/terminal/askUserRelay.test.ts`: synthetic `user_input.requested` (toolName `ask_user`) → server emits both `copilot-tool-start` (status `'Waiting for your answer'`) **and** `copilot-ask-user` with normalized `{question, options:[{text}], freeform, requestId}`; a non-`ask_user` tool emits **no** `copilot-ask-user` and leaves `copilot-tool-start` unchanged (FR-016).
- [ ] T016 [P] Add `tests/unit/teams/sessionGateway.askUser.test.ts`: a `copilot-ask-user` main event yields exactly one `ask-user` `AgentEvent` (options order preserved, `freeform` boolean, `requestId` carried); and `submitAnswer(...)` calls `mainSubmitAnswer` with the exact payload. Extend the existing `tests/unit/teams/sessionGateway.test.ts` patterns.
- [ ] T016b [P] Add `tests/unit/terminal/askUserHandlerRegistration.test.ts` (spike prerequisite — events-ipc §0): assert **both** `ControlPlaneClient.createOrResumeSession` and `CopilotSdkBackend.resumeOrCreateSession` register `onUserInputRequest` (so `requestUserInput: true` and the model is told `ask_user` is available), and that `handlePendingUserInput(requestId, {answer, wasFreeform})` resolves the stored late promise and is an **idempotent no-op** for an unknown/already-resolved `requestId` (guards T004/T005/T006).

**Checkpoint**: `ask_user` is usable on managed SDK sessions, the payload reaches the gateway as an `ask-user` event, and answers can be submitted via `submitAnswer`. User-story work can begin.

---

## Phase 3: User Story 1 — See and answer an ask_user question from Teams (Priority: P1) 🎯 MVP

**Goal**: An online agent's `ask_user` question + labeled options are posted to its bound thread; a label reply resolves it exactly once (Teams or local wins), the agent continues, and the terminal reflects the same choice.

**Independent Test**: Bring an agent online, drive it to an `ask_user` with options; confirm one framed thread message lists the question + `A/B/C` options; reply `B`; confirm the agent proceeds as if option B's text was selected and the terminal shows the choice once. Answer a second question locally → thread posts "answered in app" and a later Teams reply is a no-op.

### Tests for User Story 1 (write first; contracts/question-answer-flow.md)

- [ ] T017 [P] [US1] Add `tests/integration/teams/ask-user-post-and-answer.test.ts`: `ask-user` AgentEvent for an online agent → one marked, "needs your answer"-framed thread post listing **all** labeled options (SC-001); reply `B` → `gateway.submitAnswer` called **once** with `{ requestId, answer: optionB.text, wasFreeform:false }` and the record cleared (SC-003).
- [ ] T018 [P] [US1] Add `tests/integration/teams/ask-user-single-resolution.test.ts`: local resolution via `user_input.completed` (or a non-`ask-user` event while pending) → record cleared + "✅ answered in app" notice posted once; a subsequent Teams reply for the same question is a **no-op** (FR-007/FR-008). Also: `goOffline` / `onSessionExit` while pending → "no longer answerable" notice, later replies dropped (FR-009).

### Implementation for User Story 1

- [ ] T019 [US1] Add `pending: Map<agentId, PendingQuestion>` state to `TeamsService` (`electron/teams/teamsService.ts`) and an `onAskUserEvent(e)` handler wired from **both** the dispatch and ambient `onAgentEvent` branches so `kind==='ask-user'` is handled regardless of Teams- vs locally-initiated turn (FR-013).
- [ ] T020 [US1] In `onAskUserEvent`: resolve the online `binding` (ignore if none); assign stable selector labels `A,B,C…` to options in order; build the `PendingQuestion` (with `requestId`, `toolId`, `resolved:false`, `createdAt`), **superseding** any existing record for that agent (drop stale, keyed by `toolId`/`requestId`) per data-model invariants.
- [ ] T021 [US1] Compose + post the question via existing `safeReply(binding, html)` → `graphClient.replyToThread`: "needs your answer" framing, escaped question, each option as `<b>Label</b> — text`, freeform hint line iff `freeform`; `chunkReply(…, 3500)` for long lists; store returned `postedMessageId` (self-marker + `postedMessageIds` reused — FR-010).
- [ ] T022 [US1] In `handleInbound` (`electron/teams/teamsService.ts`), **before** `queue.enqueue(...)`: if `pending.has(binding.agentId) && !record.resolved`, route the reply to a new answer resolver instead of dispatching it as a prompt (FR-012).
- [ ] T023 [US1] Implement label-only matching in the resolver: normalize reply (trim, first token, strip one trailing `)`/`.`/`:`), case-insensitive compare to `option.label`. On match: atomically set `resolved=true`, clear the record, then `gateway.submitAnswer(officeId, agentId, { requestId, answer: matchedOption.text, wasFreeform:false })` (submit option **text**, never the label — FR-003/FR-004/FR-014). Single-resolution latch is the synchronous check-and-set before `await` (FR-007/SC-004).
- [ ] T024 [US1] Local-resolution detection: on `user_input.completed { requestId }` (or any non-`ask-user` agent event for an agent with a still-pending, unresolved record — see contract §C note), set `resolved=true`, clear the record, and `safeReply` a one-time "✅ Answered in the app." notice (FR-008). A later Teams reply for the cleared record is a no-op (FR-007).
- [ ] T025 [US1] Abandonment: extend `goOffline(officeId, agentId, …)` and `onSessionExit(agentId)` in `electron/teams/teamsService.ts` to clear any `PendingQuestion` and, if one was outstanding, `safeReply` "⚠️ This question is no longer answerable (agent offline)." Reuse the existing offline `queue.clear`; `messageFilter` already drops post-offline replies (FR-009).

**Checkpoint**: US1 fully functional — post, label-answer, local-answer notice, single-resolution, and abandonment all work end-to-end (MVP).

---

## Phase 4: User Story 2 — Handle unrecognized or freeform answers gracefully (Priority: P2)

**Goal**: A no-match reply nudges (choices-only) or is submitted verbatim (freeform-allowed); the race stays at-most-once.

**Independent Test**: With a choices-only question pending, reply `maybe` → nudge re-lists options, question stays open, no submission. With a freeform-allowed question pending, reply arbitrary text → text submitted, agent continues. Fire near-simultaneous Teams + local answers → exactly one applies.

### Tests for User Story 2

- [ ] T026 [P] [US2] Add `tests/integration/teams/ask-user-nudge-and-freeform.test.ts`: choices-only + reply `xyz` → nudge posted, record still PENDING, `submitAnswer` **not** called (SC-005); freeform + reply `xyz` → `submitAnswer` called once with `{ answer:'xyz', wasFreeform:true }` (FR-006); near-simultaneous double reply → exactly one `submitAnswer` (SC-004).

### Implementation for User Story 2

- [ ] T027 [US2] In the resolver (`electron/teams/teamsService.ts`), when the reply is not a valid label **and** `freeform===false`: post a nudge via `safeReply` re-listing options + labels and requesting a valid selector; leave `resolved=false` and the record PENDING (FR-005/SC-005). Do not submit.
- [ ] T028 [US2] When the reply is not a valid label **and** `freeform===true`: atomically set `resolved=true`, clear the record, and `gateway.submitAnswer(officeId, agentId, { requestId, answer: rawReplyText, wasFreeform:true })` (FR-006).
- [ ] T029 [US2] Verify/finish the race guard: the `resolved` check-and-set precedes every `await gateway.submitAnswer` and record-clear so a second near-simultaneous reply (Teams or local) finds `resolved===true`/no record and is a no-op (FR-007/SC-004).

**Checkpoint**: US1 + US2 both work independently — clean labels, nudges, freeform, and the resolution race are all handled.

---

## Phase 5: User Story 3 — Stay informed that a decision is required (Priority: P3)

**Goal**: The pending-decision post is visibly distinct ("needs your answer" framing) from ordinary agent chatter.

**Independent Test**: Trigger an `ask_user` on an online agent and confirm the thread message is clearly marked as requiring an answer, distinct from a normal reply.

### Tests for User Story 3

- [ ] T030 [P] [US3] Add `tests/unit/teams/ask-user-presentation.test.ts`: the composed question HTML contains the distinct "needs your answer" framing marker and each `Label — text` line, and includes the freeform hint only when `freeform===true` (FR-002).

### Implementation for User Story 3

- [ ] T031 [US3] Finalize the attention-getting framing in the question composer (`electron/teams/teamsService.ts`, from T021): a clear header/emphasis distinguishing it from ordinary replies (FR-002), consistent with how the agent already signals it needs input; keep it within chunk limits and self-marked.

**Checkpoint**: All user stories independently functional.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Non-regression guarantees, node-pty degraded-path confirmation, and quickstart validation.

- [ ] T032 [P] Add `tests/integration/teams/ask-user-non-regression.test.ts`: ordinary Teams prompt routing, generic tool-start, turn-start/end, and user-message coverage are unchanged; `copilot-tool-start` for `ask_user` still fires its static status; no `copilot-ask-user` for non-`ask_user` tools (FR-016).
- [ ] T033 [P] Add a node-pty degraded-path test (`tests/unit/terminal/askUserKeystrokeFallback.test.ts`): `submit-answer` on a node-pty backend routes to `submitViaKeystrokes` (idle-gated type + Enter) rather than `handlePendingUserInput`; document that structured surfacing is best-effort on node-pty (research.md summary).
- [ ] T034 [P] Update `electron/terminal/ipc-relay.ts` doc comment and any channel inventory/docs to list `copilot-ask-user` and `submit-answer`; note the `onUserInputRequest` prerequisite near `createOrResumeSession` in `electron/terminal/terminal-backend.ts`.
- [ ] T035 Run `npm run build` then execute quickstart.md manual verification (scenarios 1–8: post, label answer, local-answer notice, nudge, freeform, race, abandonment, non-regression); confirm the rebuilt `dist/` contains the `copilot-ask-user` marker (constitution VII worktree check).
- [ ] T036 Run `npm run test` (full Vitest suite) and confirm all new + existing unit/integration suites pass with no regressions.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately (T001–T003 all [P]).
- **Foundational (Phase 2)**: depends on Phase 1 types. **Blocks all user stories.** Within it: T004/T005 (handler registration) → T006 (resolve API) → T012 (server routing); T007–T009 (server relay) → T010 (ipc-relay) → T011 (preload) / T014 (gateway map); T013 (submitAnswer) depends on T010. Tests T015/T016/T016b after their targets.
- **User Story 1 (Phase 3, P1)**: depends on Phase 2 (needs `ask-user` event + `submitAnswer` + user-input handler). MVP.
- **User Story 2 (Phase 4, P2)**: depends on Phase 2 and the resolver seam from US1 (T022/T023); otherwise independently testable.
- **User Story 3 (Phase 5, P3)**: depends on the question composer from US1 (T021); presentation-only.
- **Polish (Phase 6)**: depends on all desired user stories.

### Within Each User Story

- Tests written first (fail), then implementation.
- Types/state before posting; posting before resolving; resolver before local/abandonment edges.

### Parallel Opportunities

- Phase 1: T001, T002, T003 in parallel (different files).
- Phase 2: T011 (preload) parallel with server work once protocol (T003) lands; foundational tests T015/T016/T016b parallel with each other.
- US1 tests T017/T018 in parallel; US2 test T026 and US3 test T030 in parallel with their sibling stories once Phase 2 is done.
- Phase 6: T032, T033, T034 in parallel.
- With capacity, US2 and US3 can proceed in parallel after US1's shared seam (T021–T023) exists.

---

## Parallel Example: Phase 2 Foundational

```bash
# After protocol (T003) is merged, these touch different files:
Task: "preload onCopilotAskUser bridge in electron/terminal/preload.ts"      # T011
Task: "server extractor relay test in tests/unit/terminal/askUserRelay.test.ts"   # T015
Task: "gateway ask-user mapping test in tests/unit/teams/sessionGateway.askUser.test.ts"  # T016
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Phase 1 Setup (T001–T003).
2. Phase 2 Foundational (T004–T016b) — **critical**: without the user-input handler the model refuses `ask_user`.
3. Phase 3 US1 (T017–T025).
4. **STOP and VALIDATE** US1 independently (quickstart scenarios 1–3, plus local-answer + abandonment).
5. Demo the MVP.

### Incremental Delivery

- Foundation → US1 (MVP: see + answer + single-resolution) → US2 (nudge/freeform/race) → US3 (framing) → Polish. Each story is independently testable and adds value without breaking prior stories.

---

## Notes

- **Constitution**: all changes are main-process/terminal-server + `electron/teams/*`; the `copilot-ask-user` event and `onUserInputRequest` handler are strictly additive (FR-016). No Phaser/renderer, auth, or persistence surface changes. Answers flow only through the `submitAnswer` gateway seam (Real-Agent Session Integrity).
- **Single-resolution** lives in one place: the synchronous `resolved` check-and-set in the resolver, keyed by `requestId`.
- `[P]` = different files, no incomplete dependency. Commit after each task or logical group. Verify tests fail before implementing.
