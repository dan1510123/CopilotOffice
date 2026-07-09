---
description: "Task list for SDK Control Plane (Variant 1) implementation"
---

# Tasks: SDK Control Plane for Agent Terminals (Variant 1)

**Input**: Design documents from `/specs/013-sdk-control-plane/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/ (all present)

**Tests**: INCLUDED. Not explicitly requested in the spec, but Constitution IV (Regression-Safe
Delivery) mandates tests for terminal/session/fleet flows, and FR-019/FR-020/FR-021 + SC-007 name
specific behaviors that require verification.

**Organization**: Grouped by user story (US1 P1, US2 P2, US3 P3) for independent implementation and
testing. US1 is the MVP.

## Constitution-Driven Task Requirements

- Backend selection is typed config, not hardcoded (Principle V) — T007, T008.
- Terminal/session lifecycle + office switching regression tasks — T031, T032, T033.
- Input focus via `InputManager` verified — T034.
- Phaser-first boundary unaffected (control plane is main-process only) — verified in T033.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 / US2 / US3, or SETUP / FOUND / POLISH

## Path Conventions

Desktop app: Electron main + terminal server (`electron/terminal/*`, `electron/teams/*`), renderer
(`src/*`), tests (`tests/*`). Paths from plan.md "Source Code" section.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: SDK upgrade prerequisite and capability probing groundwork.

- [x] T001 [SETUP] Upgrade `@github/copilot-sdk` to exact `1.0.5` (GA) in `package.json` +
  `package-lock.json`; do NOT use caret/`@latest` (resolves to prerelease `1.0.6-preview.1`).
  *(Already done — commit `72ada47`; validated send round-trip + API surface.)*
- [ ] T002 [SETUP] Verify baseline build/tests green on `1.0.5`: `npm run build` then `npm run test`.
  Record any pre-existing failures as baseline (Anvil discipline) before changing backend code.
- [ ] T003 [P] [SETUP] Add a `--ui-server` capability probe helper in
  `electron/terminal/terminal-backend.ts` (strict-parser accept-vs-error check per research.md;
  cache the result). Pure function, unit-testable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Core control-plane infrastructure every user story depends on. **No US work starts
until this phase is complete.**

- [ ] T004 [FOUND] Migrate the existing `CopilotSdkBackend` `CopilotClient` usage in
  `electron/terminal/terminal-backend.ts` to the 1.x `RuntimeConnection` API
  (`forStdio({ path, args })`; drop `cliPath`/`cliArgs`/`autoStart`; use exported `approveAll`).
  Keep the legacy headless `sdk` backend working (no behavior change) — proves the API migration in
  isolation.
- [ ] T005 [FOUND] Implement `UiServerHostRuntime` (per-office) in
  `electron/terminal/terminal-backend.ts`: launch `copilot --ui-server --port 0` inside node-pty
  with sanitized PATH + auth env; discover control port via `/listening on port (\d+)/i`; expose
  `status` (launching→listening→ready→crashed→stopped). Per contracts/ui-server-backend.md §2.
- [ ] T006 [FOUND] Implement per-office `ControlPlaneClient` attach: SDK client via
  `RuntimeConnection.forUri('localhost:<port>')` WITHOUT `useLoggedInUser`/`gitHubToken`; lifecycle
  create/resume/list/foreground; one client per office runtime (data-model.md).
- [ ] T007 [FOUND] Add typed backend-selection config value (`node-pty` | `ui-server` | `sdk`,
  default `node-pty`) in `src/config/` and thread it to the terminal server (via
  `COPILOT_TERMINAL_BACKEND` / setting). No hardcoding (Principle V).
- [ ] T008 [FOUND] Wire backend selection + auto-fallback in `electron/terminal/server.ts`
  bootstrap (`main()` around line 1212): when `ui-server` selected, gate on T003 probe; on failure
  fall back to `node-pty` with a structured `[lifecycle]` log; never user-facing error (FR-010).
- [ ] T009 [FOUND] Implement `UiServerBackend implements TerminalBackend` (`name: 'ui-server'`,
  `isAvailable()` from probe, `start()`), returning a `UiServerProcess implements TerminalProcess`
  bound to an agent session (synthetic PID; never force-killed). Per contracts/ui-server-backend.md.
- [ ] T010 [FOUND] Implement `SdkEventSource implements CopilotEventSource` in
  `electron/terminal/event-source.ts` (`start(onEvent)`/`stop()`/`getSessionId()`) subscribing via
  `session.on(...)`; normalize to the existing `CopilotEvent` shape per contracts/event-mapping.md.
- [ ] T011 [FOUND] Select `SdkEventSource` vs `FileWatcherEventSource` by active backend in
  `server.ts` (factory seam); ensure fleet-critical forwarding (`subagent.*`,
  `system.notification`, task `tool.execution_start`) and Teams `mainOnly` mirroring are preserved
  (event-mapping.md §2–3).

**Checkpoint**: Control plane can host a per-office runtime, attach, create/resume sessions, and
emit normalized events. User stories can now begin.

---

## Phase 3: User Story 1 - Reliable programmatic agent replies (Priority: P1) 🎯 MVP

**Goal**: Programmatic prompts (Teams/fleet) are delivered as atomic SDK turns and rendered in the
real TUI, replacing keystroke injection.

**Independent Test**: Send a programmatic prompt to one online agent; confirm exactly one turn, a
structured `assistant.message`, and the prompt+reply visible in the TUI; repeat multi-line + rapid.

### Tests for User Story 1 ⚠️ (write first, ensure they fail)

- [ ] T012 [P] [US1] Unit test: `submitPrompt` calls `session.send({ prompt, mode:'enqueue' })`
  atomically for multi-line input in `tests/unit/terminal/uiServerSubmit.test.ts`.
- [ ] T013 [P] [US1] Integration test: programmatic reply via SDK reaches Teams path
  (`assistant.message` captured) in `tests/integration/teams/uiServerReply.test.ts`.

### Implementation for User Story 1

- [ ] T014 [US1] Implement `UiServerProcess.submitPrompt(text, label?)` → SDK
  `session.send({ prompt, mode:'enqueue' })`; `label` display-only (never sent). Multi-line safe.
  (contracts/ui-server-backend.md §3; FR-004/005.)
- [ ] T015 [US1] Route the terminal server `submit-prompt` message to `submitPrompt` for the
  `ui-server` backend in `server.ts` (bypass `submitViaKeystrokes` for this backend); keep
  keystroke path for `node-pty`.
- [ ] T016 [US1] Ensure `assistant.message` for a programmatic turn is captured and exposed to
  `electron/teams/sessionGateway.ts` (verify capture intact; no raw-byte scraping) — FR-005.
- [ ] T017 [US1] Add `[lifecycle]`/structured logging + error surfacing for send failures
  (FR-014); no silent failure.

**Checkpoint**: US1 fully functional — reliable programmatic replies via SDK, MVP deliverable.

---

## Phase 4: User Story 2 - Accurate real-time status without file polling (Priority: P2)

**Goal**: Status/tool/turn transitions for `ui-server` agents derive from SDK events, not
`events.jsonl`.

**Independent Test**: Run a single agent turn invoking a tool; observe ready→thinking→tool→ready
from SDK events with no stuck states after turn end.

### Tests for User Story 2 ⚠️

- [ ] T018 [P] [US2] Unit test: SDK event → `CopilotEvent` mapping table
  (tool start/complete, turn start/end, user.message, subagent.*, assistant.message) in
  `tests/unit/terminal/sdkEventMapping.test.ts` (event-mapping.md).
- [ ] T019 [P] [US2] Unit test: ready detection uses `session.idle`/first `turn_end`, guarding
  historical events from invalid `starting→thinking` transitions, in
  `tests/unit/terminal/uiServerReady.test.ts`.

### Implementation for User Story 2

- [ ] T020 [US2] Emit normalized events through existing server paths (`copilot-tool-start/complete`,
  `copilot-turn-start/end`, `copilot-user-message`, `copilot-event`) from `SdkEventSource`
  consumption in `server.ts` — downstream reducers unchanged (event-mapping.md §1).
- [ ] T021 [US2] Preserve status routing through `src/util/toolStatus.ts`
  (`nextSubStateAfterToolComplete`) — do not reimplement the ask_user race guard (event-mapping.md §6).
- [ ] T022 [US2] Maintain `user.message` seq/text parity used by status/notification logic under the
  SDK source (event-mapping.md).

**Checkpoint**: US1 + US2 both work independently; status is SDK-driven for `ui-server` agents.

---

## Phase 5: User Story 3 - Seamless agent switching preserves the live TUI (Priority: P3)

**Goal**: Switching the visible agent flips the hosted runtime's foreground session so the real TUI
shows the selected agent live.

**Independent Test**: With 2+ agents in one office, switch back and forth; foreground TUI reflects
each agent's live state; input routes to the correct agent; no scrollback duplication/loss.

### Tests for User Story 3 ⚠️

- [ ] T023 [P] [US3] Integration test: agent switch → `setForegroundSessionId(guid)`; two sessions
  share one port (`listSessions` returns both) in `tests/integration/uiServerForeground.test.ts`.

### Implementation for User Story 3

- [ ] T024 [US3] Map the renderer agent-switch to a foreground switch: on visible-agent change in
  the same office, call `ControlPlaneClient.setForegroundSessionId(guid)` (server.ts + any new
  `protocol.ts` message) — contracts/ui-server-backend.md §7.
- [ ] T025 [US3] Verify `src/ui/TerminalOverlay.ts` agent switch under `ui-server` shows live state
  without the scrollback-replay path causing duplication/loss (parity with node-pty).
- [ ] T026 [US3] Ensure background (non-foreground) agents remain live sessions producing events but
  not TUI bytes (data-model.md invariants).

**Checkpoint**: All three user stories independently functional.

---

## Phase 6: Cross-Cutting Concurrency & Lifecycle (FR-019/020/021, Session Integrity)

**Purpose**: The verified/residual concurrency + lifecycle behaviors that span stories.

- [ ] T027 [P] Integration test: SDK send while human has an unsubmitted line preserves the human
  line and produces ordered turns (programmatic first, human second) — FR-019/SC-007 — in
  `tests/integration/uiServerSendWhileTyping.test.ts` (mirrors spike E3).
- [ ] T028 Implement readiness gating (FR-020): do not deliver human keystrokes or programmatic
  prompts to a session until it signals ready; queue or reject-with-log before then (server.ts).
- [x] T029 [P] Test + handling for modal collision (FR-021): VERIFIED 2026-07-09 via end-to-end
  ui-server spike (`spike-e2e.mjs`). A yolo-off session's `{kind:'no-result'}` deferral surfaced a
  live permission request without crashing the control plane, which stayed responsive
  (`listSessions()` ok after). Documented in research.md ("End-to-end ui-server spike" + T029
  residual). Also surfaced a production hardening item: the once-per-day CLI install-promo modal
  blocks `--ui-server` startup until dismissed.
- [ ] T030 Map permission posture (yolo / additional-params → SDK `onPermissionRequest`/
  `SessionHooks`) so `ui-server` tool-permission behavior matches today (FR-009).

---

## Phase 7: Regression & Polish

- [ ] T031 Office-switch continuity (Constitution III, FR-012, BL-004): detach-not-kill + reattach;
  session-GUID continuity across switch under `ui-server` — extend/verify existing terminal tests.
- [ ] T032 Runtime crash handling (per-office blast radius): surface via error channel; relaunch
  office runtime; resume sessions by GUID — `tests/integration/uiServerRuntimeCrash.test.ts`.
- [ ] T033 Parity + Phaser-boundary check: default office and fleet/meeting modes work under
  `ui-server`; confirm no Phaser/scene changes were needed (Principle I).
- [ ] T034 InputManager focus check: human input focus transitions still route through
  `InputManager` under `ui-server` (Principle II).
- [ ] T035 [P] Clipboard/selection non-regression (Constitution VI): if any overlay code touched,
  mirror across `TerminalOverlay` + `SeriousTerminalController`; run copy/paste specs. If untouched,
  assert no diff.
- [ ] T036 [P] Docs: update `.github/copilot-instructions.md` architecture notes + a short backend
  section; ensure `MeetingMode.md`/specs cross-links accurate.
- [ ] T037 Run `quickstart.md` manual validation (capability probe, round-trip, shared-port,
  resume, send-while-typing, fallback) against this worktree's rebuilt `dist/` (Constitution VII).
- [ ] T038 Full gate: `npm run build` + `npm run test` + `npm run test:e2e` green; record results.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (P1)**: T001 done; T002 before backend edits; T003 independent [P].
- **Foundational (P2)**: depends on Setup. T004 (API migration) → T005 (host runtime) → T006
  (attach) → T009 (backend) ; T007 → T008 (selection/fallback); T010 → T011 (event source). BLOCKS
  all user stories.
- **US1 (P3)**: after Foundational. MVP.
- **US2 (P4)**, **US3 (P5)**: after Foundational; independent of US1 (integrate but independently
  testable).
- **Phase 6**: after the backend exists (T009) and event source (T011); spans stories.
- **Phase 7**: after desired stories complete.

### Within Each User Story

- Tests written first and failing before implementation.
- Backend/host/client before event mapping before foreground switch.

### Parallel Opportunities

- T003 [P] during setup.
- T010/T011 event-source work can proceed alongside T005/T006 host/attach (different concerns) once
  T004 lands.
- Test tasks marked [P] (T012/T013, T018/T019, T023, T027, T029, T035, T036) run in parallel within
  their phase.
- After Foundational, US1/US2/US3 can be staffed in parallel.

---

## Implementation Strategy

### MVP First (US1)

1. Phase 1 Setup → 2. Phase 2 Foundational (critical) → 3. Phase 3 US1 →
4. **STOP & VALIDATE**: reliable programmatic replies via SDK (Teams) → demo.

### Incremental Delivery

Foundational → US1 (MVP) → US2 (SDK-driven status) → US3 (foreground switch) → Phase 6 concurrency →
Phase 7 regression. Each increment independently testable; default backend stays `node-pty` until
`ui-server` passes Phase 7.

---

## Notes

- [P] = different files, no dependencies. [Story] label maps to US1/US2/US3.
- Backend stays behind config (`node-pty` default) until validated — safe incremental rollout.
- `--ui-server` is undocumented → probe + fallback are first-class (T003/T008).
- Verify against the worktree's rebuilt `dist/` (Constitution VII) before claiming any fix works.
- Commit after each task or logical group.
