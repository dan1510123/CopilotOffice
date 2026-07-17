---
description: "Dependency-ordered, actionable tasks for spec 017 — Office Orchestrator Improvements (US1–US8)"
---

# Tasks: Office Orchestrator Improvements — Top-10 Scenarios, Tooling & Persistent Transcript

**Input**: Design documents from `/specs/017-orchestrator-improvements/`
**Prerequisites**: plan.md, spec.md (US1–US8), research.md, data-model.md,
contracts/{orchestrator-tools-v2.md, orchestrator-ipc-v2.md, transcript-store.md}, quickstart.md

**Tests**: INCLUDED. The plan's Regression Plan (spec Constitution Alignment) explicitly
requires unit coverage for every new tool's success + typed failure paths, transcript
capture/persist/replay (incl. Teams-origin + post-restart), gate/relay parity, and an
extended e2e reopen-shows-history smoke. Existing 204 orchestrator+Teams tests MUST stay green.

**Organization**: Tasks are grouped by user story (US1–US8) in priority order (P1 → P2 → P3).
This is a brownfield Electron + Phaser app; all tasks EXTEND existing seams (no new tree).

## Implementation notes carried from plan.md (must be reflected in the tasks below)

1. **Reuse per-agent session ops for act-on tools.** `answer_agent` / `send_prompt_to_agent`
   deliver text via the same terminal input path the in-world terminals use, after
   `warmAgentSession` (`src/main.ts:1539`) / `window.copilotBridge.terminalStart`
   (`src/main.ts:1568`) ensure the target is online. `stop_agent` / `restart_agent` reuse the
   existing stop / stop+restart session operations. `set_agent_teams_presence` reuses
   `teamsRegister` (`src/main.ts:1972`) / `teams:stop`. Exact renderer entry point is the
   resolver block in `src/main.ts` (~L1878–L1901, alongside `onOrchestratorExecuteRequest`);
   exact main entry point is the matching `requestX`/`respondX` round-trip on
   `electron/orchestrator/orchestratorSessionManager.ts`. Pin these in the relevant tasks.
2. **`get_agent_transcript` is read-only, bounded.** It uses the bounded
   `officeManager.getRecentActions(officeId, agentId)` / task-summary window (read-only),
   NOT live PTY/xterm scraping. No gate, no session mutation.
3. **Keep the spec's descriptive tool names as implementation identifiers**: `get_active_agents`,
   `list_agents_awaiting_input`, `get_agent_transcript`, `answer_agent`, `send_prompt_to_agent`,
   `stop_agent`, `restart_agent`, `set_agent_teams_presence`.

## Constitution-Driven Task Requirements (applied)

- Status/labels derive ONLY from `src/config/agentStatusPresentation.ts` (no hardcoded labels/colors).
- Session-lifecycle-touching tasks (answer/send/stop/restart/teams-presence) include regression
  tasks that validate real Copilot CLI session semantics and the `agent-viewers.ts` dual-key rules
  and MUST NOT mutate `activeAgentViewers` outside sanctioned helpers.
- TUI change is view-only: no new `terminal.onData` typing path; focus stays on the panel
  `onOpen`/`onClose` → `InputManager` contract (Page Up/Down scrollback only).
- No new in-canvas renderer — transcript rendering stays in the existing xterm DOM overlay.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1–US8; Setup/Foundational/Polish tasks have no story label
- Exact file paths included in every task

---

## Phase 1: Setup (Shared Baseline)

**Purpose**: Establish the green regression baseline and confirm reused UI invariants before change.

- [x] T001 Capture the regression baseline: run `npx tsc --noEmit`, `npx vitest run tests/unit/orchestrator`, and `npx vitest run tests/unit/teams` from repo root and record that the existing 204 orchestrator+Teams tests pass (per plan Regression Plan / quickstart).
- [x] T002 [P] Confirm the reused OrchestratorPanel invariants in `src/ui/OrchestratorPanel.ts`: the green "hacker" theme (`background:#001200`, `foreground/cursor:#00ff41`) and `scrollback: 5000` in `createTerminal`, and the existing clipboard selection cascade (Principle VI). Record the scrollback cap value to reuse as the transcript retention `bound` (research R3/R4).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Shared type + IPC + preload + gate scaffolding that ALL user stories depend on.

**⚠️ CRITICAL**: No user-story tool/transcript work can begin until this phase is complete.

- [x] T003 Extend `electron/orchestrator/types.ts` (Node/DOM-free shared source of truth) with ALL new types from data-model.md: `TranscriptOrigin`, `TranscriptRole`, `TranscriptTurn`, `OrchestratorTranscript`, `ActiveAgentSnapshot`, `AwaitingAgent`, `AgentRecentOutput`, `ActOnOutcome` (union), and `ActOnResult`. No `any`/unsafe casts across the IPC seam.
- [x] T004 Extend the main-process IPC surface in `electron/orchestrator/orchestratorIpc.ts` to register ALL new `orchestrator:*` request/respond channels from orchestrator-ipc-v2.md: `active-agents`, `awaiting-agents`, `agent-output`, `answer-agent`, `send-prompt`, `stop-agent`, `restart-agent`, `teams-presence` (each `:request`/`:respond`), plus the `orchestrator:transcript:get` invoke handler. Broaden the `orchestrator:permission:request` payload to carry `{ toolName, args:{ agentId?, officeId?, answer?, prompt?, online?, reason? } }` (depends on T003).
- [x] T005 Extend `electron/terminal/preload.ts` `window.copilotBridge` with the new typed invokers (`orchestratorRespondActiveAgents`, `orchestratorRespondAwaitingAgents`, `orchestratorRespondAgentOutput`, `orchestratorRespondAnswerAgent`, `orchestratorRespondSendPrompt`, `orchestratorRespondStopAgent`, `orchestratorRespondRestartAgent`, `orchestratorRespondTeamsPresence`, `orchestratorGetTranscript`) and listeners (`onOrchestratorActiveAgentsRequest`, `onOrchestratorAwaitingAgentsRequest`, `onOrchestratorAgentOutputRequest`, `onOrchestratorAnswerAgentRequest`, `onOrchestratorSendPromptRequest`, `onOrchestratorStopAgentRequest`, `onOrchestratorRestartAgentRequest`, `onOrchestratorTeamsPresenceRequest`), each declared in the `copilotBridge` interface with no `any` (depends on T003).
- [x] T006 In `electron/orchestrator/orchestratorSessionManager.ts`, broaden `permissionHandler` (currently `bring_agent_online`-only) to gate ALL of `answer_agent`, `send_prompt_to_agent`, `stop_agent`, `restart_agent`, `set_agent_teams_presence`; it MUST NOT consult `isYoloEnabled()` (always-on gate, FR-018). Preserve the existing minimized/Teams-only relay rule (deny pending gates only when NOT `teamsRelayActive`, FR-021) and extend `clearPendingRoundTrips` to resolve in-flight new round-trips with typed terminal outcomes (read-only → empty; act-on → `{ outcome:'failed', message:'Orchestrator session ended' }`) (depends on T003).

**Checkpoint**: Shared types, IPC/preload channels, and the broadened non-YOLO gate exist — user stories can now proceed.

---

## Phase 3: User Story 1 - Persistent, fully-rendered transcript (Priority: P1) 🎯 MVP

**Goal**: A durable, retention-bounded orchestrator transcript that survives minimize/close/reopen
and app restart, captures Teams-origin turns, and is replayed into the view-only green TUI on open
without asking the agent to recall it.

**Independent Test**: Drive a few turns (one via Teams while minimized), reopen → full transcript
replayed in order with Teams origin marked; restart app → transcript restored; red ✕ → next open is clean.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL)

- [x] T007 [P] [US1] Unit test `orchestratorTranscriptStore` in `tests/unit/orchestrator/orchestratorTranscriptStore.test.ts`: `serializeTranscript`/`deserializeTranscript` round-trip, monotonic `seq`, `appendTurn` oldest-first trim at `bound` (=5000), origin fidelity (`desktop` vs `teams`), malformed/`null` input → `null` (never throws), and `clearActive`/`closed`-record lifecycle (transcript-store.md behavior contract 1–7).
- [x] T008 [P] [US1] Unit test transcript capture wiring in `tests/unit/orchestrator/orchestratorTranscriptCapture.test.ts`: manager appends a `user` turn on `submitInput` (origin from caller), `orchestrator`/`tool` turns from the session tap, a `tool` turn on permission approve AND deny (FR-023), tags Teams-origin turns `origin:'teams'`, and marks the record `closed` on `endSession` so the next open starts empty (FR-002/FR-005).

### Implementation for User Story 1

- [x] T009 [US1] Create `electron/orchestrator/orchestratorTranscriptStore.ts` per transcript-store.md: `OrchestratorTranscriptStore` port + `FileOrchestratorTranscriptStore` (writes pretty JSON to `.data/orchestrator-transcript.json`) + `InMemoryOrchestratorTranscriptStore`, plus pure `serializeTranscript`/`deserializeTranscript`/`appendTurn(t, turn, bound)`. Node-only (`fs`/`path`); tolerate malformed input; never persist secrets; log IO errors without crashing/ blocking turn processing (depends on T003).
- [x] T010 [US1] Wire the store into `electron/orchestrator/orchestratorSessionManager.ts`: hold an `OrchestratorTranscriptStore`, `load()` the bound `sessionId` record on session start (treat a `closed` record as no active conversation → fresh `active`), and `appendTurn` on `submitInput` (role `user`), mapped session-tap events (`orchestrator`/`tool`), permission approve/deny + act-on outcome (`tool` with `{ name, outcome, target }`), trimming to the T002 scrollback bound; `endSession()` marks the record `closed` / `clearActive()` (FR-001/004/005/006/023; depends on T009, T006).
- [x] T011 [US1] Tag Teams-driven turns with `origin:'teams'` at the `electron/teams/orchestratorSessionGateway.ts` boundary so they flow through the manager tap into the transcript (FR-002; depends on T010).
- [x] T012 [US1] Implement the `orchestrator:transcript:get` main handler in `electron/orchestrator/orchestratorIpc.ts`/manager: a pure read of the persisted store returning `{ transcript }` or `null` when the last record was user-closed; MUST NOT create/resume/mutate a session (ipc-v2 invariant 4; depends on T009, T004).
- [x] T013 [US1] In `src/ui/OrchestratorPanel.ts`, on `onOpen` fetch the persisted transcript via `copilotBridge.orchestratorGetTranscript` and replay it into the existing xterm (original order, role/origin attribution, Teams turns visibly marked) BEFORE the "ready" line, de-duping against `streamedMessageIds` so live streaming + restore don't double-render. Keep the TUI view-only (no new `terminal.onData` typing path), Page Up/Down scrollback, and the green theme; leave the `onOpen`/`onClose` → `InputManager` focus contract untouched (FR-003/003a/007; depends on T005, T012).

**Checkpoint**: US1 fully functional — reopen and post-restart show full history; red ✕ starts clean. MVP deliverable.

---

## Phase 4: User Story 2 - See what every active agent is working on (Priority: P1)

**Goal**: One `get_active_agents` call enumerates every session-bearing agent across ALL offices
(incl. `done`/`waiting`/`thinking`) with office, canonical status, activity, and time-in-state.

**Independent Test**: With agents in ≥2 offices in varying states, ask "what's everyone working on?" →
one tool call lists all with office/status/activity/elapsed; labels match in-world badges.

### Tests for User Story 2 ⚠️

- [x] T014 [P] [US2] Unit test in `tests/unit/orchestrator/getActiveAgents.test.ts`: roster spans all offices, includes `done`/idle-online agents (no omission, FR-008), each labeled with `officeId`/`officeName`, and `statusKey`/`statusLabel`/`activity`/`timeInState` derive from `agentStatusPresentation` (FR-009); empty roster ⇒ nobody active.

### Implementation for User Story 2

- [x] T015 [US2] Add the renderer resolver in `src/main.ts` (alongside the existing `onOrchestratorExecuteRequest`/`onOrchestratorOfficesRequest` block ~L1878) — new helper `src/office/orchestratorStatus.ts` `computeActiveAgents()` folding `officeManager.getAllOffices()` + `getSeatedAgents(officeId)` + `getAgentStatus(officeId, agentId)` through `resolveStatusKey`/`presentationFor`/`describeActivity`/`formatElapsedMmSs` into `ActiveAgentSnapshot[]`; respond via `copilotBridge.orchestratorRespondActiveAgents` (FR-008/009/013; depends on T003, T005).
- [x] T016 [US2] Register the read-only `get_active_agents` tool in `electron/orchestrator/tools.ts` (`skipPermission: true`, no params) backed by an `active-agents` request/respond round-trip on `orchestratorSessionManager.ts`; description authored for natural-language "status roll-up" selection (FR-024). Round-trip resolves empty on teardown (depends on T004, T006).

**Checkpoint**: US2 works independently — full status roll-up in one call.

---

## Phase 5: User Story 3 - Know who is stuck / waiting on me (Priority: P2)

**Goal**: `list_agents_awaiting_input` returns only `waiting` agents across all offices, longest-first,
with pending question + time-in-state.

**Independent Test**: One agent waiting, others working → "who's stuck?" lists only the waiting agent(s).

### Tests for User Story 3 ⚠️

- [x] T017 [P] [US3] Unit test in `tests/unit/orchestrator/listAgentsAwaitingInput.test.ts`: only `statusKey==='waiting'` agents returned, ordered longest-waiting first, each with required `pendingQuestion` + `officeId`; empty ⇒ nobody needs attention (FR-010).

### Implementation for User Story 3

- [x] T018 [US3] Add `computeAwaitingAgents()` to `src/office/orchestratorStatus.ts` (reusing US2's snapshot builder, filtered to `awaitingInput` and sorted by `timeInState` desc) and the `src/main.ts` resolver responding via `copilotBridge.orchestratorRespondAwaitingAgents` (depends on T015).
- [x] T019 [US3] Register the read-only `list_agents_awaiting_input` tool in `electron/orchestrator/tools.ts` (`skipPermission: true`) backed by an `awaiting-agents` round-trip on the manager; description authored for "who needs me / is anyone stuck?" (FR-024; depends on T016).

**Checkpoint**: US3 works independently — focused "needs you" list.

---

## Phase 6: User Story 7 - Peek what an agent recently did (Priority: P2)

**Goal**: `get_agent_transcript` returns a bounded, read-only recent-output window for one
office-qualified agent (from `getRecentActions`/task summary), ungated, no session mutation.

**Independent Test**: Agent with recent activity → bounded output returned; no recent output → "nothing recent"; no gate; session unchanged.

### Tests for User Story 7 ⚠️

- [x] T020 [P] [US7] Unit test in `tests/unit/orchestrator/getAgentTranscript.test.ts`: bounded `lines` sourced from `getRecentActions`/task summary (NOT PTY scrape), `hasOutput:false` ⇒ "nothing recent", unknown/ambiguous target ⇒ `hasOutput:false` with a clear message, and NO session mutation (FR-011/012, implementation note 2).

### Implementation for User Story 7

- [x] T021 [US7] Add `computeAgentRecentOutput(agentId, officeId?)` to a new `src/office/orchestratorPeek.ts` using `officeManager.getRecentActions(officeId, agentId)` / task summary as a bounded read-only window (disambiguate via current office then all offices when `officeId` omitted) → `AgentRecentOutput`; wire the `src/main.ts` resolver responding via `copilotBridge.orchestratorRespondAgentOutput` (depends on T003, T005).
- [x] T022 [US7] Register the read-only `get_agent_transcript` tool in `electron/orchestrator/tools.ts` (`skipPermission: true`, params `{ agentId, officeId? }`) backed by an `agent-output` round-trip on the manager; description for "what did X just do?" (FR-024; depends on T016).

**Checkpoint**: US7 works independently — read-only peek/relay.

---

## Phase 7: User Story 4 - Unblock a waiting agent (Priority: P2)

**Goal**: Gated `answer_agent` delivers a user-supplied answer into a waiting agent's session,
returning a typed `ActOnResult`; every outcome (incl. denial) recorded to the transcript.

**Independent Test**: Waiting agent → approve → answer reaches it and it resumes; deny → nothing sent; not-waiting target → `not-waiting`.

### Tests for User Story 4 ⚠️

- [x] T023 [P] [US4] Unit test in `tests/unit/orchestrator/answerAgent.test.ts`: outcomes `delivered`/`not-waiting`/`not-online`/`invalid-target`/`denied`/`failed`; target re-validated at execution time; orchestrator-identity target rejected via `orchestratorIdentity` (FR-019/020); denial ⇒ zero change (SC-007); outcome recorded to transcript with target (FR-023).

### Implementation for User Story 4

- [x] T024 [US4] Add the `answer_agent` renderer resolver in `src/main.ts` — new helper `src/office/orchestratorActOn.ts` `answerAgent({agentId, officeId?, answer})` that re-validates the office-qualified target (reject orchestrator identity), ensures online via `warmAgentSession` (`src/main.ts:1539`), and delivers `answer` through the same terminal input path the in-world terminals use; return typed `ActOnResult`; respond via `copilotBridge.orchestratorRespondAnswerAgent` (FR-014/019/020; depends on T003, T005).
- [x] T025 [US4] Register the gated `answer_agent` tool in `electron/orchestrator/tools.ts` (no `skipPermission`, params `{ agentId, officeId?, answer }`) backed by an `answer-agent` round-trip on the manager emitted ONLY after gate approval (denial ⇒ `outcome:'denied'`); ensure the outcome is fed to the transcript (T010) and description authored for natural-language "answer the waiting agent" (FR-024; depends on T006, T010).

**Checkpoint**: US4 works independently — gated unblock.

---

## Phase 8: User Story 5 - Send a follow-up prompt to an online agent (Priority: P2)

**Goal**: Gated `send_prompt_to_agent` delivers a follow-up prompt into an already-online agent's session.

**Independent Test**: Online agent → approve → agent starts on it; offline target → `not-online`; deny → nothing sent.

### Tests for User Story 5 ⚠️

- [x] T026 [P] [US5] Unit test in `tests/unit/orchestrator/sendPromptToAgent.test.ts`: outcomes `sent`/`not-online`/`invalid-target`/`denied`/`failed`; re-validation + identity guard; denial ⇒ zero change; outcome recorded to transcript (FR-015/018/019/023).

### Implementation for User Story 5

- [x] T027 [US5] Add `sendPromptToAgent({agentId, officeId?, prompt})` to `src/office/orchestratorActOn.ts` (reuse the T024 validation/identity guard + terminal input path; `not-online` when the target has no live session) and the `src/main.ts` resolver responding via `copilotBridge.orchestratorRespondSendPrompt` (depends on T024).
- [x] T028 [US5] Register the gated `send_prompt_to_agent` tool in `electron/orchestrator/tools.ts` (params `{ agentId, officeId?, prompt }`) backed by a `send-prompt` round-trip emitted only after approval; feed outcome to transcript; description for "delegate a follow-up task" (FR-015/024; depends on T025).

**Checkpoint**: US5 works independently — gated delegate.

---

## Phase 9: User Story 8 - Bring an agent online in Teams (Priority: P2)

**Goal**: Gated `set_agent_teams_presence` activates/deactivates a specified agent's Teams remote,
reusing `teamsRegister`/`teams:stop`; reports `unavailable` when Teams is disabled; posts closing notice on offline.

**Independent Test**: Teams enabled → approve → remote activates + thread link reported; take offline → closing notice; Teams disabled → `unavailable`; deny → no change.

### Tests for User Story 8 ⚠️

- [x] T029 [P] [US8] Unit test in `tests/unit/teams/setAgentTeamsPresence.test.ts`: outcomes `online-in-teams` (with `threadWebUrl`)/`taken-offline` (posts closing notice)/`unavailable` (Teams flag off via `teams:getSettings`)/`invalid-target`/`denied`/`failed`; identity guard; denial ⇒ no presence change (FR-017/022; US8 scenarios 1–4).

### Implementation for User Story 8

- [x] T030 [US8] Add `setAgentTeamsPresence({agentId, officeId?, online})` to `src/office/orchestratorActOn.ts`: check the Teams feature flag (`teams:getSettings`) → `unavailable` when off; `online:true` → `teamsRegister` (`src/main.ts:1972`) returning `threadWebUrl`; `online:false` → `teams:stop` path (posts the established closing notice); re-validate target + identity guard; wire the `src/main.ts` resolver responding via `copilotBridge.orchestratorRespondTeamsPresence` (FR-017/022; depends on T024).
- [x] T031 [US8] Register the gated `set_agent_teams_presence` tool in `electron/orchestrator/tools.ts` (params `{ agentId, officeId?, online }`) backed by a `teams-presence` round-trip emitted only after approval; feed outcome to transcript; description for "bring agent online in Teams / take it offline" (FR-017/024; depends on T025).

**Checkpoint**: US8 works independently — gated agent Teams presence.

---

## Phase 10: User Story 6 - Stop / restart / take an agent offline (Priority: P3)

**Goal**: Gated `stop_agent` / `restart_agent` perform the lifecycle change via the existing
stop / stop+restart session ops, returning a typed outcome; most destructive, ships last.

**Independent Test**: Online agent → approve stop → offline & reported; approve restart → restarted & ready; deny → no change; already-offline/invalid → typed outcome.

### Tests for User Story 6 ⚠️

- [x] T032 [P] [US6] Unit test in `tests/unit/orchestrator/stopRestartAgent.test.ts`: `stop_agent` outcomes `stopped`/`taken-offline`/`not-online`/`invalid-target`/`denied`/`failed`; `restart_agent` outcomes `restarted`/`not-online`/`invalid-target`/`denied`/`failed`; re-validation + identity guard; denial ⇒ zero change; MUST NOT mutate `activeAgentViewers` outside sanctioned helpers / kill the wrong session (FR-016/019/020, Principle III).

### Implementation for User Story 6

- [x] T033 [US6] Add `stopAgent({agentId, officeId?})` and `restartAgent({agentId, officeId?})` to `src/office/orchestratorActOn.ts` reusing the existing per-agent stop / stop+restart session operations (preserving `agent-viewers.ts` dual-key invariants), plus the two `src/main.ts` resolvers responding via `copilotBridge.orchestratorRespondStopAgent` / `orchestratorRespondRestartAgent` (FR-016/019/020; depends on T024).
- [x] T034 [US6] Register the gated `stop_agent` and `restart_agent` tools in `electron/orchestrator/tools.ts` (params `{ agentId, officeId? }`) backed by `stop-agent` / `restart-agent` round-trips emitted only after approval; feed outcomes to transcript; descriptions for "stop / take offline" and "restart" (FR-016/024; depends on T025).

**Checkpoint**: US6 works independently — gated lifecycle control. All 8 stories complete.

---

## Phase 11: Polish & Cross-Cutting Concerns

**Purpose**: System-prompt selection, e2e, and full regression across all stories.

- [x] T035 Extend `ORCHESTRATOR_SYSTEM_PROMPT` (in `electron/orchestrator/tools.ts` / system-prompt source) so the agent selects each new tool from natural language without the user naming the tool or exact agent: status roll-up → `get_active_agents`; "who's stuck" → `list_agents_awaiting_input`; "what did X do" → `get_agent_transcript`; answer/delegate/stop/restart/teams → the matching gated tool; never invent an `agentId`/`officeId` (FR-024, SC-009).
- [x] T036 [P] Extend the e2e reopen-shows-history smoke under `tests/e2e/` to cover US1: drive turns → minimize → reopen shows full transcript; restart → restored (SC-001/002).
- [x] T037 [P] Add/verify permission-gate + minimized/Teams-relay parity coverage for all gated tools in `tests/unit/orchestrator/` (non-YOLO gate; pending gate denied only when NOT `teamsRelayActive`) (FR-018/021, SC-007). Also assert FR-025: every act-on tool's error/`failed` path surfaces a typed `ActOnResult` (or `orchestrator:exit`) — never a silent no-op — for the store-IO-error and unexpected-throw cases.
- [x] T038 Full verification: `npx tsc --noEmit`, `npm run build`, `npx vitest run tests/unit/orchestrator`, `npx vitest run tests/unit/teams` all green (existing baseline + new), then Principle VII worktree check — grep the **main-process** bundle for the new tool marker (`Select-String -Path dist\electron\main.js -Pattern 'get_active_agents'`, since orchestrator tools bundle to `dist/electron/main.js`, NOT the renderer bundle) AND grep the **renderer** bundle for a new transcript-replay marker (`Select-String -Path dist\game.bundle.js -Pattern '<distinctive OrchestratorPanel transcript-replay string>'`); confirm both match and `dist/` timestamps are fresh.
- [ ] T039 Run the quickstart.md manual validation pass (US1–US8) to confirm SC-001..SC-009 are demonstrable end-to-end.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies.
- **Foundational (Phase 2, T003–T006)**: depends on Setup; **BLOCKS all user stories**. T003 (types) blocks T004/T005/T006 and every story.
- **User Stories (Phases 3–10)**: all depend on Foundational.
  - P1: US1 (T007–T013), US2 (T014–T016).
  - P2: US3 (T017–T019), US7 (T020–T022), US4 (T023–T025), US5 (T026–T028), US8 (T029–T031).
  - P3: US6 (T032–T034).
- **Polish (Phase 11)**: depends on all targeted stories complete.

### Notable cross-task dependencies (same-file / reuse chains — NOT parallel with each other)

- **`electron/orchestrator/tools.ts`** is edited by T016, T019, T022, T025, T028, T031, T034, T035 → serialize these (one story's tool registration at a time).
- **`electron/orchestrator/orchestratorSessionManager.ts`** is edited by T006, T010, and every gated round-trip (T025/T028/T031/T034) → serialize.
- **`src/main.ts`** resolver block is edited by T015, T018, T021, T024, T027, T030, T033 → serialize.
- **`src/office/orchestratorActOn.ts`** is created by T024 then extended by T027, T030, T033 → T024 first, others after.
- **`src/office/orchestratorStatus.ts`** created by T015, extended by T018 → T015 first.
- Transcript feed (T010) must exist before gated-tool outcome recording is meaningful (T025/T028/T031/T034 note "feed outcome to transcript").

### Within Each User Story

- Tests (T007/T008, T014, T017, T020, T023, T026, T029, T032) are written FIRST and must FAIL before implementation.
- Store/helper before manager wiring before tool registration before panel/system-prompt.

### Parallel Opportunities

- **[P] test tasks** across stories (T007, T008, T014, T017, T020, T023, T026, T029, T032) touch distinct new test files → parallelizable once Foundational is done.
- **Read-only stories US2/US3/US7** (status/awaiting/peek) are independent of the gated act-on stories and can proceed in parallel with US4/US5/US6/US8 by different developers, subject to the shared-file serialization above.
- T036 and T037 (polish) are [P] with each other (different files).

---

## Parallel Example: kick off tests after Foundational

```text
# Once T003–T006 are done, launch these test-authoring tasks together:
Task: T014 [US2] getActiveAgents.test.ts
Task: T017 [US3] listAgentsAwaitingInput.test.ts
Task: T020 [US7] getAgentTranscript.test.ts
Task: T023 [US4] answerAgent.test.ts
Task: T026 [US5] sendPromptToAgent.test.ts
Task: T029 [US8] setAgentTeamsPresence.test.ts
Task: T032 [US6] stopRestartAgent.test.ts
```

---

## Implementation Strategy

### MVP First (US1 + US2, both P1)

1. Complete Phase 1 (Setup) + Phase 2 (Foundational).
2. Complete Phase 3 (US1 — persistent transcript) → the concrete reported pain; STOP and validate reopen/restart/close.
3. Complete Phase 4 (US2 — status roll-up) → foundation for all act-on scenarios.
4. Demo the MVP (transcript restore + all-office status).

### Incremental Delivery

1. Setup + Foundational → foundation ready.
2. US1 → validate → demo (MVP).
3. US2 → validate → demo.
4. Read-only US3, US7 → validate → demo (full situational awareness).
5. Gated US4, US5, US8 → validate → demo (act-on).
6. Gated US6 (stop/restart) last → validate → demo (full lifecycle control).
7. Polish (system prompt, e2e, regression, quickstart).

---

## Notes

- [P] = different files, no dependencies on incomplete tasks.
- Every act-on outcome (incl. `denied`) is recorded in the transcript with the target identified (FR-023) — the transcript feed (T010) is a hard prerequisite for the gated stories.
- Status labels/keys come ONLY from `agentStatusPresentation` (no divergent labels); targets are office-qualified and never the synthetic orchestrator identity.
- Keep the existing 204 orchestrator+Teams tests green throughout; commit after each task or logical group.
