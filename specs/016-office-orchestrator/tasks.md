---
description: "Task list for Office Orchestrator Agent implementation"
---

# Tasks: Office Orchestrator Agent

**Input**: Design documents from `/specs/016-office-orchestrator/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The touched area (real Copilot SDK session + tool/permission
pipeline) is high-risk per Constitution Principle IV, and the plan/quickstart define
concrete regression suites. Test tasks are therefore in scope.

**Organization**: Only **User Story 1 (the Orchestrator Agent)** is in scope for this
build. US2 (board), US3 (direct control), and US4 (task board) are deferred in the spec
and have **no tasks** here.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: `US1` for the in-scope story; setup/foundational/polish carry no story label
- Exact file paths are included in each task

## Path Conventions

Electron desktop app (per plan.md): main-process code under `electron/`, renderer under
`src/`, tests under `tests/`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Scaffold the new module namespaces and shared types so main + renderer can
be built independently.

- [X] T001 Create the main-process orchestrator module directory with placeholder exports: `electron/orchestrator/orchestratorSessionManager.ts`, `electron/orchestrator/tools.ts`, `electron/orchestrator/orchestratorIpc.ts` (empty typed stubs that compile).
- [X] T002 Add `electron/orchestrator/orchestratorIpc.ts` (and any new orchestrator entry) to the `build:electron` esbuild entry list in `package.json`, or import the module from an existing entry (`electron/main.ts`) so it is bundled; run `npm run build:electron` to confirm it compiles.
- [X] T003 [P] Add the `ORCHESTRATOR_PANEL` layer constant to `src/config/zIndex.ts` (choose a value above `SERIOUS_TERMINAL` and below `SETTINGS`, per the registry ordering; do not pick a magic number outside the registry).
- [X] T004 [P] Create `electron/orchestrator/types.ts` with the shared message/entity interfaces from data-model.md (`OrchestratorSessionInfo`, `BringOnlineCandidate`, `BringOnlineToolCall`, `PermissionDecision`, `BringOnlineResult`) so both processes import one source of truth.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Stand up the orchestrator SDK session, its tools, the non-YOLO permission
gate, and the IPC surface — everything US1 behavior sits on. **No US1 acceptance
behavior can be wired until this phase is complete.**

**⚠️ CRITICAL**: Blocks all of Phase 3.

- [X] T005 Implement `OrchestratorSessionManager` in `electron/orchestrator/orchestratorSessionManager.ts`: create a single SDK session via `new CopilotClient({ useLoggedInUser: true, connection: RuntimeConnection.forStdio(...) })` and `createSession({ workingDirectory, streaming: true, tools, onPermissionRequest, onUserInputRequest })`, reusing the client/config helpers in `electron/terminal/terminal-backend.ts`. Expose `open()` (start-or-reattach, idempotent — returns existing `sessionId` on second call), `submitInput(text)` (`session.send({ prompt: text })` — default mode, no `enqueue`/interrupt override), and `close()` (detach stream only, **never** kill the session). Track lifecycle `idle→starting→ready→error` (manager-local, not an office `AgentStatus`).
- [X] T006 Wire the SDK event stream in `orchestratorSessionManager.ts`: subscribe via `session.on(evt => …)`, normalize with `mapSdkEventToCopilotEvent` from `electron/terminal/event-source.ts`, and forward each event to the renderer over `orchestrator:event`. Emit `orchestrator:exit` on session end/error.
- [X] T007 Implement the non-YOLO permission gate in `orchestratorSessionManager.ts` (`onPermissionRequest: PermissionHandler`) per `contracts/orchestrator-tools.md`: for `request.kind === 'custom-tool' && toolName === 'bring_agent_online'`, emit `orchestrator:permission:request` (with `toolCallId`, `args.agentId`, `args.reason`) and await a decision held in a per-`toolCallId` pending map; resolve `approve → { kind: 'approved' }`, `deny → { kind: 'denied-interactively-by-user' }`. **MUST NOT** call `isYoloEnabled()`; any other kind denies by default. Add `respondToPermission(toolCallId, decision)` and a "resolve all pending as deny" path for session close/dismiss.
- [X] T008 Implement the two SDK tools in `electron/orchestrator/tools.ts` using `defineTool` per `contracts/orchestrator-tools.md`: `list_office_agents` (`skipPermission: true`, no args) whose handler round-trips to the renderer via `orchestrator:candidates:request`/`:respond` and returns `{ officeId, candidates }`; and `bring_agent_online({ agentId, reason })` (gated) whose handler round-trips via `orchestrator:execute:request`/`:respond` and returns the `BringOnlineResult`. Correlate both round-trips by a generated `requestId` with a pending-map late-resolve.
- [X] T009 Implement the IPC surface in `electron/orchestrator/orchestratorIpc.ts` per `contracts/orchestrator-ipc.md`: `ipcMain.handle` for `orchestrator:open`, `orchestrator:input`, `orchestrator:permission:respond`, `orchestrator:close`, `orchestrator:candidates:respond`, `orchestrator:execute:respond`; and `webContents.send` emitters for `orchestrator:event`, `orchestrator:permission:request`, `orchestrator:candidates:request`, `orchestrator:execute:request`, `orchestrator:exit`. Model the registration shape on `electron/teams/teamsIpc.ts`.
- [X] T010 Register the orchestrator IPC in `electron/main.ts` (call the `orchestratorIpc` registrar alongside the existing terminal/teams IPC setup), passing the `OrchestratorSessionManager` and the active `webContents`. Ensure teardown on window close does **not** kill office sessions.
- [X] T011 Extend the preload bridge in `electron/terminal/preload.ts`: add `window.copilotBridge` methods `orchestratorOpen`, `orchestratorInput`, `orchestratorRespondPermission`, `orchestratorClose`, `orchestratorRespondCandidates`, `orchestratorRespondExecute`, plus listener registrars `onOrchestratorEvent`, `onOrchestratorPermissionRequest`, `onOrchestratorCandidatesRequest`, `onOrchestratorExecuteRequest`, `onOrchestratorExit`. Update the `declare global` `Window['copilotBridge']` type declarations to match.

**Checkpoint**: The orchestrator session can start, stream, register both tools, and
gate `bring_agent_online` through IPC — with no renderer UI yet.

---

## Phase 3: User Story 1 - Bring the right agent online by describing what you need (Priority: P1) 🎯 MVP

**Goal**: A hotkey/button opens a focused panel with the orchestrator agent's chat TUI;
the user describes a need in natural language, the agent proposes a candidate and raises
an approve/deny prompt, and approval brings that agent online via the existing
start/reserve paths — always gated, regardless of global YOLO.

**Independent Test**: With a roster containing an idle-seated agent and (in a
reserve-supporting office) an activatable reserve, open the panel, describe a need,
approve → chosen agent starts; repeat and deny → nothing mutated; repeat with global
YOLO ON → prompt still raised.

### Tests for User Story 1 ⚠️ (write first; ensure they FAIL before implementation)

- [X] T012 [P] [US1] `tests/unit/orchestrator/permissionGate.test.ts`: assert the gate never consults `isYoloEnabled()` (mock it to `true` and confirm a prompt is still raised); `approve → { kind: 'approved' }`, `deny → { kind: 'denied-interactively-by-user' }`, dismiss-while-pending resolves as deny; non-`bring_agent_online` kinds deny by default.
- [X] T013 [P] [US1] `tests/unit/orchestrator/candidateSelection.test.ts`: from a mocked `OfficeManager` + `agents.ts`, assert candidates = idle-seated (`state === 'slacking'`) + activatable reserves (`unassigned-*` desks mapped in `RESERVE_AGENTS`) only when the layout has `supportsReserveAgents`; active agents excluded; empty set yields the "nothing to bring online" case.
- [X] T014 [P] [US1] `tests/unit/orchestrator/bringOnlineExecute.test.ts`: assert outcomes — `started` for an idle-seated agent (`setAgentStarting` + `terminalStart`), `started` for a reserve (`spawnReserveAgent` → `addSeatedAgent` → `setAgentStarting` → `terminalStart`), `already-active` no-op when target is starting/active, `invalid-target` for unknown id / no open seat / no reserves, and `failed` surfaced (never silent).

### Implementation for User Story 1

- [X] T015 [US1] Implement candidate computation in the renderer (e.g. `src/office/orchestratorCandidates.ts`): read `officeManager.currentOfficeId`, `currentOffice.agents` (idle = `state === 'slacking'`), and — when `getLayout(getCurrentLayout()).behaviors.supportsReserveAgents` — the `unassigned-*` desks mapped through `RESERVE_AGENTS`/`RESERVE_AGENT_DESK`. Return `BringOnlineCandidate[]` with `agentId/name/skill/description/source/deskId/officeId`, using named ID constants (no hardcoded ids). Make this the function under test in T013.
- [X] T016 [US1] Implement bring-online execution in the renderer (e.g. `src/office/orchestratorExecute.ts`): given an approved `agentId`, resolve it against the current candidate set and perform — **idle-seated** (owned by this module, which has `OfficeManager` in scope): `officeManager.setAgentStarting(officeId, agentId)` + `window.copilotBridge.terminalStart(officeId, agentId, workingDir)`. **Reserve activation MUST route through `OfficeScene`**, because `spawnReserveAgent(deskId)` is a `private` scene method that creates the NPC, physics collider, and walk-in animation (`src/scenes/OfficeScene.ts:1678`) and cannot run from an `OfficeManager`-owned module: emit a new `game.events` event (e.g. `orchestrator:activate-reserve` with `{ deskId }`) that `OfficeScene` subscribes to and forwards to `spawnReserveAgent`. Reuse the scene method's existing `animating` / already-spawned guards as part of the `already-active` semantics. Return `BringOnlineResult` covering `started/already-active/invalid-target/failed`. This is the function under test in T014.
- [X] T016a [US1] In `src/scenes/OfficeScene.ts`, subscribe to the new `orchestrator:activate-reserve` event and route it to the existing `spawnReserveAgent(deskId)` path (do not duplicate its logic); report the spawn outcome back so T016 can resolve `started` vs `already-active`/`invalid-target`.
- [X] T017 [US1] Create `src/ui/OrchestratorPanel.ts`: a focused DOM overlay (dims game) layered at `ZIndex.ORCHESTRATOR_PANEL`, hosting an `@xterm/xterm` + `FitAddon` chat TUI (mirror the host pattern in `src/ui/TerminalOverlay.ts`). On open: call `copilotBridge.orchestratorOpen(...)`, render `onOrchestratorEvent` stream into the terminal, and route the input box / xterm `onData` to `copilotBridge.orchestratorInput(...)`. Expose `show()`/`hide()`.
- [X] T018 [US1] Wire focus + lifecycle in `OrchestratorPanel.ts`: on open emit `settings:open` (→ `InputManager.suspendGameInput`) and `switchToTerminal`; on close emit `settings:close` (→ `resumeGameInput`), call `copilotBridge.orchestratorClose(...)`, and return focus to the game — **without** killing the session (reopen reattaches). Provide `onOpen`/`onClose` hooks consistent with other overlays.
- [X] T019 [US1] Implement the approve/deny UI in `OrchestratorPanel.ts`: on `onOrchestratorPermissionRequest`, render a prompt **naming the target agent** (resolve `agentId`→name) and the `reason`; approve/deny call `copilotBridge.orchestratorRespondPermission(...)`. If the panel is dismissed while a request is pending, send `deny`. If the panel renders any agent **status** (label/color/icon) for a candidate or target, it MUST derive it from `src/config/agentStatusPresentation.ts` (FR-022) — never a hardcoded label/hex/emoji.
- [X] T020 [US1] Wire the renderer round-trip handlers: register `onOrchestratorCandidatesRequest` → call T015 → `orchestratorRespondCandidates`; and `onOrchestratorExecuteRequest` → call T016 → `orchestratorRespondExecute`. Place this wiring where `OfficeManager` is in scope (e.g. `src/main.ts` or a small `src/office/orchestratorBridge.ts`).
- [X] T021 [US1] Add the launch affordance in `src/main.ts`: a toolbar button and/or hotkey that constructs (once) and toggles `OrchestratorPanel`, following the existing `settings-btn` / `sprite-customizer-btn` wiring. Ensure repeated open is idempotent (reattaches).
- [X] T022 [US1] Author the orchestrator system prompt / instructions (in `orchestratorSessionManager.ts` session config `systemMessage`, or a co-located constant): instruct the agent to call `list_office_agents`, rank by `skill`/`description` against the user's NL request, call `bring_agent_online` with a concrete `agentId` + `reason`, and — on no good fit or empty candidates — say so and suggest manual selection (spec FR-003, AS-5, edge cases).
- [X] T023 [US1] Surface failure/exit states in `OrchestratorPanel.ts`: on `onOrchestratorExit` (session failed/crashed) show a visible message and keep the panel usable for manual selection; ensure denied/failed/invalid `BringOnlineResult` outcomes are shown (no silent failures, per SC-005).
- [X] T023a [US1] Satisfy Constitution Principle VI (xterm clipboard discipline) for the new TUI in `OrchestratorPanel.ts`: implement the mandated copy path — selection cascade `cachedSelection → terminal.getSelection() → window.getSelection()` scoped to the panel container, populate `event.clipboardData.setData('text/plain', …)` before any `preventDefault()`, and emit an instance-tagged diagnostic toast (e.g. `[ORC0]`) on success/empty/verify-fail/bridge-error. If copy is intentionally not supported in this panel, instead record that decision explicitly in the panel file header and in `research.md`, with rationale. Do not ship a bare `preventDefault()`.

**Checkpoint**: US1 is fully functional and independently testable against all eight
acceptance scenarios.

---

## Phase 4: Polish & Cross-Cutting Concerns

**Purpose**: Regression coverage for the touched high-risk flows and doc/verification.

- [X] T024 [P] Add an IPC/integration test `tests/unit/orchestrator/ipcSurface.test.ts` (or integration equivalent) asserting `orchestrator:open` is idempotent (one session on repeat), `orchestrator:close` does **not** kill the session or mutate `activeAgentViewers`, and a pending permission request resolves as deny on close.
- [X] T025 [P] Extend `tests/e2e/electron-smoke.e2e.ts`: boot the app, open the orchestrator panel via the button/hotkey, assert the panel renders and the session reaches an interactive state (smoke only; no real bring-online).
- [X] T026 [P] Session-integrity regression check: add/extend a test asserting that opening/closing the orchestrator panel leaves all office agent sessions attached (not killed/detached) — guards Constitution Principle III and BL-004-adjacent behavior.
- [X] T027 [P] Update documentation: add an "Office Orchestrator Agent" section to `README`/relevant docs and a Controls entry for the new hotkey; note the orchestrator's non-YOLO always-gated behavior.
- [X] T028 Run `npm run test` (targeted orchestrator suites), then the full Vitest suite for impacted areas, and `npm run test:e2e` smoke; fix regressions. Then execute the `quickstart.md` verification checklist end-to-end (including the explicit YOLO-ON gate check).

---

## Phase 5: Extensions — office navigation tools + Teams-remote orchestrator

**Purpose**: Post-MVP extensions folded into spec 016 (not a new spec). See
`plan.md` "Workstream A / B" in the session plan for full design. Workstream A gives
the orchestrator cross-office orientation; Workstream B brings it online in Teams with
its always-on approval gate relayed into the thread.

### Workstream A — office navigation tools

- [X] TA1 Add `OfficeSummary` + `SwitchOfficeResult`/`SwitchOfficeOutcome` types (`electron/orchestrator/types.ts`).
- [X] TA2 Manager round-trips `requestOffices`/`respondOffices` + `requestSwitch`/`respondSwitch`; pass into `buildOrchestratorTools`; extend system prompt with cross-office guidance.
- [X] TA3 Add `list_offices` (read-only) + `switch_office` (ungated) tools with `skipPermission` (`tools.ts`).
- [X] TA4 IPC emitters + `orchestrator:offices:respond`/`orchestrator:switch:respond` handlers (`orchestratorIpc.ts`).
- [X] TA5 Preload invoke/listeners + Window types (`electron/terminal/preload.ts`).
- [X] TA6 Renderer helper `src/office/orchestratorOffices.ts` + wiring in `src/main.ts` (build summaries from `OfficeManager`, resolve switch via `switchToOffice`).
- [X] TA7 Tests: `officeNavigation.test.ts` + extend `ipcSurface.test.ts` round-trips.
- [X] TA8 Docs: README + `contracts/orchestrator-tools.md`.

### Workstream B — Teams-remote orchestrator

- [X] TB1 Synthetic identity constants + `isOrchestratorKey` (`electron/orchestrator/orchestratorIdentity.ts`).
- [X] TB2 `OrchestratorSessionGateway` implementing `SessionGateway` over the manager (`electron/teams/orchestratorSessionGateway.ts`).
- [X] TB3 Permission-relay seam: `AgentEvent` kind `permission-request` + `gateway.respondPermission(...)`; manager tap listeners (`onSessionEvent`/`onPermissionRequested`/`onSessionExit`).
- [X] TB4 `CompositeSessionGateway` — key-based routing + event/exit fan-in (`electron/teams/compositeSessionGateway.ts`).
- [X] TB5 TeamsService permission relay: post Approve/Deny prompt, route in-thread reply → `respondPermission`, 5-min timeout → auto-deny, supersede + goOffline cleanup.
- [X] TB6 "Bring online in Teams" toggle in `OrchestratorPanel` + `teams:registerOrchestrator`/`teams:stopOrchestrator` IPC + preload bridge + main-process composite wiring.
- [X] TB7 Lifecycle/reconnect/GC verified: synthetic key `getSessionId` null until manager reopened; `goOffline` detaches without killing; 30-day GC applies unchanged.
- [X] TB8/TB10 Docs: README Teams-remote-orchestrator subsection (non-YOLO relay, desktop-switch side effect) + this task list.
- [X] TB9 Tests: `tests/unit/orchestrator/teamsGateway.test.ts` (gateway + composite) and `tests/unit/teams/orchestratorPermissionRelay.test.ts` (post → reply → respondPermission; timeout → deny; unrecognized → pending).

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies — start immediately.
- **Foundational (Phase 2)**: depends on Setup — **blocks Phase 3**.
- **User Story 1 (Phase 3)**: depends on Foundational.
- **Polish (Phase 4)**: depends on US1 implementation.

### Key ordering within the build

- T001–T004 (scaffold/types/zIndex) before everything.
- T005 → T006/T007 (session before stream + gate); T008 tools depend on the IPC round-trip channels defined in T009; T009 → T010 → T011 (IPC before main registration before preload).
- Tests T012–T014 authored before their implementations T015/T016 (and the gate T007) — write-fail-first.
- T015/T016 (renderer compute/execute) before T020 (round-trip wiring). T017 (panel) before T018/T019/T023. T020/T021 after the panel and preload exist.
- T022 (system prompt) can land any time after T005; recommended before manual verification.
- T024–T028 last.

### Within User Story 1

- Tests (T012–T014) → renderer logic (T015, T016) → panel + focus (T017, T018) → approval UI (T019) → round-trip wiring (T020) → launch (T021) → prompt (T022) → failure surfacing (T023).

### Parallel Opportunities

- **Setup**: T003 and T004 are `[P]` (different files) alongside T001.
- **US1 tests**: T012, T013, T014 are `[P]` (separate test files).
- **Polish**: T024, T025, T026, T027 are `[P]` (different files); T028 runs last.
- Foundational tasks are mostly sequential (shared files / dependency chain) and are **not** marked `[P]`.

---

## Parallel Example: User Story 1 tests

```bash
# Author these three failing tests together first:
Task: "permissionGate.test.ts — non-YOLO always-gate + approve/deny/dismiss mapping"
Task: "candidateSelection.test.ts — idle-seated + activatable-reserve computation"
Task: "bringOnlineExecute.test.ts — started/already-active/invalid-target/failed"
```

---

## Implementation Strategy

### MVP (this build = User Story 1 only)

1. Phase 1 Setup → 2. Phase 2 Foundational (session + tools + gate + IPC) →
3. Phase 3 US1 (panel + compute/execute + approval + launch) →
4. **STOP and VALIDATE** against the eight acceptance scenarios and the quickstart
   checklist (including YOLO-ON gate) → 5. Phase 4 Polish/regression.

### Deferred (not in this build)

US2 (awareness board), US3 (direct control), and US4 (task board) are specified in
`spec.md` as roadmap only — no tasks here. They extend the same orchestrator + gated-tool
substrate later.

---

## Notes

- `[P]` = different files, no dependency; unmarked foundational tasks share files or a
  dependency chain and must be sequential.
- Do **not** route the orchestrator through `electron/terminal/server.ts` sessions or
  `activeAgentViewers` — it is a separate SDK session (plan Complexity Tracking).
- No hardcoded agent IDs (use `agents.ts` constants) or status strings/colors
  (`agentStatusPresentation.ts`); overlay layering via `ZIndex`; focus via
  `InputManager`; sessions detached-not-killed.
- Commit after each task or logical group.

