---
description: "Task list for Teams Remote Agents (011)"
---

# Tasks: Teams Remote Agents

**Input**: Design documents from `/specs/011-teams-remote-agents/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: INCLUDED — the spec's Constitution Alignment → Regression Plan explicitly requires unit/integration tests for handle collision, the filter pipeline, chunking, marker round-trip, store GC, session-id reconnect, and a dispatch non-regression check.

**Organization**: Grouped by user story (US1–US5) for independent implementation/testing.

## Constitution-Driven Task Requirements

- Config-first: global `TeamsSettings` + per-office `OfficeConfig.teamsChannelUrl`; no hardcoded agent ids/channels.
- Session-lifecycle regression tasks (new-session teardown, session-id reconnect) are mandatory (Principle III/IV).
- UI added as DOM overlays only; button mirrored across `TerminalOverlay` + `SeriousTerminalController` (Principle VI); focus via `InputManager` (Principle II).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1–US5; Setup/Foundational/Polish carry no story label
- All paths are repository-relative

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Add `ws` dependency and `@types/ws` devDependency to `package.json`; create `electron/teams/` and `tests/unit/teams/` directories; add `electron/teams/types.ts` with core domain types (`OnlineAgentBinding`, `KnownThread`, `TeamsSettings`, `InboundMessage`, `OnlineAgentStatus`) per data-model.md.
- [X] T002 [P] Add `TEAMS_SETTINGS` layer constant to `src/config/zIndex.ts` (between `SPRITE_CUSTOMIZER` and `SETTINGS`).
- [X] T003 [P] Create `src/config/teamsConfig.ts` — `TeamsSettings` shape + defaults (`enabled:false`, `defaultChannelUrl:''`, `checkInEnabled:false`, `checkInThresholdMs:120000`, `checkInThrottleMs:60000`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ CRITICAL**: No user story work can begin until this phase is complete.

### Pure helpers (parallel — separate files)

- [X] T004 [P] `electron/teams/channelLink.ts` — `parseChannelLink(url)` → `{teamId,channelId,tenantId}|null` (decode `%3A`/`%40`, extract `groupId`/`tenantId`).
- [X] T005 [P] `electron/teams/handleRegistry.ts` — `normalizeHandle(name)` (lowercase, alnum-only) + `assignHandle(base, takenOnline)` (`base`, `base-1`, …); reject empty.
- [X] T006 [P] `electron/teams/marker.ts` — `embedMarker(html)` / `hasMarker(content)` (hidden self-loop marker) per research D9.
- [X] T007 [P] `electron/teams/chunk.ts` — `chunkReply(text, max)` → ordered `(i/N)` chunks (FR-011).
- [X] T008 [P] `electron/teams/channelResolver.ts` — `resolveChannel(office, settings)` (`office.teamsChannelUrl ?? settings.defaultChannelUrl`) + `activeChannelSet(bindings)` + `classifyThread(channelId, rootId, bindings, knownThreads)` → `bound|orphaned|foreign`.

### Infrastructure

- [X] T009 [P] `electron/teams/onlineAgentsStore.ts` — `TeamsOnlineStore` port (file + in-memory impls), `load()`/`save()`, and pure `gcStale(bindings, nowMs, 30d)` helper. Never persist tokens.
- [X] T010 [P] `electron/teams/auth.ts` — `TokenProvider` over `az account get-access-token` for `graph`/`ic3`; JWT `exp` decode, in-memory cache, proactive refresh, graceful reuse on refresh failure (research D4). Secrets never logged.
- [X] T011 [P] `electron/teams/graphClient.ts` — `GraphSender`: `createThread({teamId,channelId,subject,html})` and `replyToThread(...)`; embeds marker; uses `fetch` + graph token (contracts/teams-api.md).
- [X] T012 [P] `electron/teams/chatsvcClient.ts` — receive fallback: poll `GET …/chatsvc/{region}/…/conversations/{channelId}/messages` with `sequenceId` cursor; normalize to `InboundMessage`.
- [X] T013 `electron/teams/trouterClient.ts` — `MessageSource` via `ws`: port the reference handshake (connect → authenticate → `trouter.connected` → register V3+V2 → listen `3:::` → ACK → heartbeat/re-register); emit normalized `InboundMessage`; extract thread root id from `conversationid` `;messageid=` suffix.
- [X] T014 `electron/teams/messageFilter.ts` — pipeline (research D10): dedup → marker-drop → stale → channel-in-active-set → classifyThread → injection-scan → decision (`dispatch|orphaned-notice|ignore`).
- [X] T015 `electron/teams/sessionGateway.ts` — `SessionGateway` adapter over existing terminal protocol (`get-session-id`, `get-session-meta`, `write` = `prompt+'\r'`, `copilot-event`/`copilot-turn-end` subscription, session-changed notifications). Reuse existing `MainToServer`/`ServerToMain`; do NOT touch `activeAgentViewers` directly.
- [X] T016 `electron/teams/teamsService.ts` — orchestrator skeleton: holds store, `TokenProvider`, `GraphSender`, `MessageSource`, `SessionGateway`, `dispatchQueue`; `start()/stop()`, wiring stubs for register/route/reply.
- [X] T017 Add `teams:*` IPC handlers in `electron/terminal/ipc-relay.ts` and bridge surface in `electron/terminal/preload.ts` (`teams:status/register/stop/getSettings/saveSettings`; events `teams:status:changed`, `teams:toast`) per contracts/ipc-channels.md.
- [X] T018 Add optional `teamsChannelUrl` to `OfficeConfig` in `src/office/officeManager.ts` and carry it verbatim through `serializeOffices`/`deserializeOffices` in `src/office/officePersistence.ts` (like `customAgents`).
- [X] T019 Wire `TeamsService` lifecycle in `electron/main.ts` (construct + `start()` on app ready, `stop()` on quit); load persisted bindings.

### Foundational tests

- [X] T020 [P] Unit tests in `tests/unit/teams/` for `channelLink`, `handleRegistry`, `marker`, `chunk`, `channelResolver.classifyThread`, and `onlineAgentsStore.gcStale`.
- [X] T021 [P] Unit test `tests/unit/teams/messageFilter.test.ts` — dedup/marker/stale/channel-set/classify/injection ordering.

**Checkpoint**: Transport, auth, store, helpers, gateway, IPC, and config ready — user stories can begin.

---

## Phase 3: User Story 1 - Bring an agent online with its own channel thread (Priority: P1) 🎯 MVP

**Goal**: Click "Teams remote" → agent starts a titled thread with intro; replying in the thread routes to the agent and the answer posts back.

**Independent Test**: Configure default channel, click Teams remote on Gene, see thread `Gene: <session title>` + intro, reply `what is 2+2` in-thread, get the answer back in-thread and in Gene's terminal.

### Implementation

- [X] T022 [US1] Implement register flow in `electron/teams/teamsService.ts`: resolve channel (office override ?? default), `assignHandle`, create thread with subject `<name>: <sessionTitle>` (fallback `<name>: <handle>`), post intro, bind + persist, start routing (FR-002/004/021).
- [X] T023 [US1] Intro content in `electron/teams/teamsService.ts` (+ `sessionGateway`): include display name, `workingDir`, handle, session title, and best-effort convo summary from recent `assistant.message` events; degrade gracefully if unavailable (FR-021a).
- [X] T024 [US1] Bound-thread dispatch in `electron/teams/teamsService.ts` + `electron/teams/dispatchQueue.ts`: on `bound` message → submit prompt via gateway, accumulate `assistant.message` until turn-end, post reply into the thread with marker (FR-007/008/010/013).
- [X] T025 [US1] Add "Teams remote" button to `src/ui/TerminalOverlay.ts` near New/Close Session (~L908), rendered only when `settings.enabled`; states offline/pending/online; calls `teams:register`/`teams:status` (FR-001/004a).
- [X] T026 [US1] Mirror the "Teams remote" control in `src/ui/SeriousTerminalController.ts` (Principle VI parity).
- [X] T027 [US1] Create `src/ui/TeamsSettingsOverlay.ts`: feature-flag toggle + default channel URL input (+ check-in toggles), `ZIndex.TEAMS_SETTINGS`, `onOpen`/`onClose` wired to `InputManager` via `settings:open`/`settings:close`; save through `teams:saveSettings` with parse validation (FR-004/004a).
- [X] T028 [US1] No-channel guard in `teamsService`/renderer: clicking Teams remote with no resolved channel routes to `TeamsSettingsOverlay` with a clear prompt instead of failing (FR-004).
- [X] T029 [US1] Renderer status wiring in `src/main.ts`: handle `teams:status:changed` (button + status dot) and `teams:toast` (toast surface).

### Tests

- [X] T030 [P] [US1] Integration test `tests/integration/teams-online-roundtrip.test.ts`: register → thread create → bound message → dispatch → reply, with mocked `GraphSender`/`MessageSource`/`SessionGateway`.
- [ ] T031 [US1] Regression test `tests/integration/teams-dispatch-noninterference.test.ts`: remote dispatch into a session leaves the terminal viewer and `activeAgentViewers` dual-key state intact (Principle III).

**Checkpoint**: MVP — one agent online, reply in / reply out.

---

## Phase 4: User Story 2 - Continue a conversation from Teams (Priority: P1)

**Goal**: Follow-ups in the thread continue the same session; rapid messages queue sequentially; long replies chunk.

**Independent Test**: Reply `remember 42`, later reply `what number?` → context retained; burst 3 messages → 3 ordered replies; force a >1-message reply → delivered in order.

### Implementation

- [X] T032 [US2] Finalize per-agent sequential `electron/teams/dispatchQueue.ts`: FIFO per agent, one reply per prompt, next dequeued only after turn-end (FR-009).
- [X] T033 [US2] Continuity in `teamsService`: subsequent bound messages reuse the same session (no new thread/session), preserving context (FR-013).
- [X] T034 [US2] Wire `chunkReply` into the reply path (ordered `(i/N)`, sequential post) in `teamsService` (FR-011).

### Tests

- [X] T035 [P] [US2] Unit test `tests/unit/teams/dispatchQueue.test.ts`: burst ordering, one-reply-per-prompt.
- [X] T036 [P] [US2] Unit test `tests/unit/teams/chunk.test.ts`: chunk ordering + full delivery for ~10k chars.

**Checkpoint**: US1 + US2 both work independently.

---

## Phase 5: User Story 3 - Collisions & multiple agents/channels (Priority: P2)

**Goal**: Unique handles on collision; route correctly across multiple channels (default + per-office overrides).

**Independent Test**: Two agents → `gene` + `gene-1`; two offices on different channels → replies route to the right agent.

### Implementation

- [X] T037 [US3] Wire `assignHandle` collision suffixing into the register flow; reject empty/invalid normalization with a clear error (FR-002/003).
- [X] T038 [US3] Active-channel-set routing in `messageFilter`/`teamsService`: admit only channels with ≥1 online agent; route by `(channelId, threadRootId)` across multiple channels (FR-005/007).
- [X] T039 [US3] Per-office override UI: add the override channel deep-link field next to working directory in the office create/edit dialog (`src/main.ts`/office dialog), persisted on `OfficeConfig`; enforce resolution precedence (FR-004b).

### Tests

- [X] T040 [P] [US3] Unit test `tests/unit/teams/handleRegistry.test.ts`: collision sequence + case-insensitive normalize.
- [X] T041 [P] [US3] Integration test `tests/integration/teams-multichannel.test.ts`: two colliding agents across two channels route correctly.

**Checkpoint**: Multi-agent, multi-channel functional.

---

## Phase 6: User Story 4 - Stop from Teams + orphaned-thread handling (Priority: P2)

**Goal**: `/stop` (or in-app toggle) closes the connection only; orphaned agent threads get a one-time notice; foreign threads ignored; no self-loops.

**Independent Test**: `/stop` in thread → agent offline (session still running) + notice; message an old unbound thread → one "no longer active" notice once; message a foreign thread → nothing.

### Implementation

- [X] T042 [US4] `/stop` handling in `messageFilter`/`teamsService` + in-app toggle in the button: take offline (remove binding, post offline notice with marker) — connection only, session untouched (FR-015/015a).
- [X] T043 [US4] Orphaned/foreign handling in `teamsService`: `orphaned` known-thread → one-time inactive notice (dedupe via `KnownThread.noticePosted`); `foreign`/root → ignore silently (FR-026/027/028).
- [X] T044 [US4] Verify every app post (intro/reply/check-in/offline/inactive notices) embeds the marker and marked inbound is dropped before all processing (FR-007a).

### Tests

- [X] T045 [P] [US4] Unit test `tests/unit/teams/classify-notice.test.ts`: bound/orphaned/foreign classification + one-time notice dedupe.
- [X] T046 [P] [US4] Unit test `tests/unit/teams/marker.test.ts`: marker round-trip; app self-post excluded (no loop, incl. notice-triggers-itself).

**Checkpoint**: Full remote lifecycle control from Teams.

---

## Phase 7: User Story 5 - Long-running check-ins (Priority: P3)

**Goal**: Throttled interim updates posted to the thread during long turns, toggled by settings.

**Independent Test**: Long task → ≥1 interim update before the final reply, throttled; disabled → none.

### Implementation

- [X] T047 [US5] Check-in logic in `teamsService`: when a turn exceeds `checkInThresholdMs`, post throttled updates derived from tool/turn events; gate on `checkInEnabled`; respect `checkInThrottleMs` (FR-016).

### Tests

- [X] T048 [P] [US5] Unit test `tests/unit/teams/checkin.test.ts`: threshold trigger, throttle spacing, disabled no-op.

**Checkpoint**: All user stories independently functional.

---

## Phase 8: Polish & Cross-Cutting Concerns

**Purpose**: Session-lifecycle robustness (high-risk, Principle III/IV), auth hardening, docs, validation.

- [X] T049 New-session teardown in `teamsService` via `sessionGateway.onSessionChanged`: when an agent's session id changes, take Teams offline + remove binding + post offline notice (FR-022).
- [X] T050 Event-driven reconnect in `teamsService`: when a session with a stored id becomes available, reconnect + re-bind to the persisted thread with no duplicate thread (FR-024).
- [X] T051 Startup GC in `teamsService`: drop bindings with `lastConnected` older than 30 days and emit a `teams:toast` summary (FR-024a).
- [X] T052 Reconnect thread-missing fallback in `teamsService`/`graphClient`: if the persisted thread is unresolvable, start a fresh thread + rebind OR flag failed-to-reconnect (FR-025).
- [X] T053 [P] Regression tests `tests/unit/teams/lifecycle.test.ts` + `tests/integration/teams-reconnect.test.ts`: session-id reconnect (SC-010), new-session teardown (SC-009), 30-day GC.
- [X] T054 [P] Auth test `tests/unit/teams/auth.test.ts`: fake-JWT `exp` refresh + assert tokens never logged/persisted.
- [ ] T055 [P] Playwright e2e `tests/integration/teams-ui.e2e.ts`: feature-flag gating + button → online → status (Teams transport mocked).
- [X] T056 [P] Docs: update the Teams Remote Agents section reference in `.github/copilot-instructions.md`; note feature flag + per-office override.
- [ ] T057 Run `npm run test`, then `npm run test:e2e`, then walk `specs/011-teams-remote-agents/quickstart.md` manual matrix (SC-001…010).

---

## Dependencies & Execution Order

- **Setup (Phase 1)** → no deps.
- **Foundational (Phase 2)** → depends on Setup; **blocks all user stories**. Within it: helpers (T004–T008) and infra (T009–T012) are parallel; T013–T016 depend on helpers/types; T017–T019 depend on T016; tests T020–T021 after their targets.
- **US1 (Phase 3)** → after Foundational. MVP.
- **US2 (Phase 4)** → after Foundational; builds on US1 dispatch/reply (T024) but independently testable.
- **US3 (Phase 5)** → after Foundational; extends register (T022) + filter (T014).
- **US4 (Phase 6)** → after Foundational; uses marker (T006) + classify (T008) + gateway (T015).
- **US5 (Phase 7)** → after Foundational; uses gateway events (T015).
- **Polish (Phase 8)** → after the user stories it hardens (esp. US1). T049–T052 depend on `teamsService` + `sessionGateway`.

### Within each story

- Implementation before its tests where the test drives the wired behavior; models/helpers before services before UI.
- Story complete before moving to next priority (or parallelize across developers post-Foundational).

## Parallel Opportunities

- Setup: T002, T003 parallel.
- Foundational helpers T004–T008 all parallel; infra T009–T012 parallel; tests T020–T021 parallel.
- Post-Foundational, US1/US2/US3/US4/US5 can proceed in parallel by different developers (each independently testable).
- Most test tasks marked [P] run in parallel.

## Parallel Example: Foundational helpers

```bash
Task: "channelLink.ts parseChannelLink"        # T004
Task: "handleRegistry.ts normalize/assign"     # T005
Task: "marker.ts embed/detect"                 # T006
Task: "chunk.ts chunkReply"                    # T007
Task: "channelResolver.ts resolve/classify"    # T008
```

## Implementation Strategy

### MVP first
1. Phase 1 Setup → 2. Phase 2 Foundational → 3. Phase 3 US1 → **STOP & validate** (online + reply round trip) → demo.

### Incremental delivery
US1 (MVP) → US2 (continuity/queue/chunking) → US3 (collisions/multi-channel) → US4 (stop/orphaned) → US5 (check-ins) → Polish (lifecycle robustness + e2e). Each adds value without breaking prior stories.

## Notes

- [P] = different files, no dependencies. [Story] label maps to spec user stories.
- Secrets (tokens) never logged, persisted to the JSON store, or shown in UI.
- Mirror the Teams control across `TerminalOverlay` + `SeriousTerminalController` in the same change (Principle VI).
- Commit after each task or logical group.
