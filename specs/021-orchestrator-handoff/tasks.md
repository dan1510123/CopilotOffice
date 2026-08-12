---
description: "Task list for Orchestrator Session Handoff + Approval/Bring-Online Fixes"
---

# Tasks: Orchestrator Session Handoff + Approval/Bring-Online Fixes

**Input**: Design documents from `/specs/021-orchestrator-handoff/`
**Prerequisites**: plan.md (required), spec.md (required for user stories), contracts/orchestrator-handoff-tool.md

**Tests**: INCLUDED. The feature spec mandates unit coverage (SC-006, SC-B04, "Regression Plan"),
so test tasks are first-class in this list. Existing orchestrator + Teams suites MUST stay green.

**Organization**: Tasks are grouped by user story (Part A) and bug story (Part B) so each can be
implemented, tested, and delivered as an independent increment. Priorities from spec.md:
US1=P1, US2=P2, US3=P2, B1=P1, B2=P1, B3=P2, B4=P3.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: Which user/bug story this task belongs to (US1–US3, B1–B4)
- Include exact file paths in descriptions

## Path Conventions

Brownfield Electron desktop app split by process:
- **Main process**: `electron/orchestrator/`, `electron/teams/`, `electron/terminal/`
- **Renderer**: `src/office/`, `src/main.ts`
- **Tests**: `tests/unit/orchestrator/`, `tests/unit/teams/`

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the environment and existing seams before extending them. No new project
scaffolding is required (brownfield extension of the spec 016/017 orchestrator stack).

- [ ] T001 Verify build + test baseline is green before changes: run `npx tsc --noEmit` and `npm run test`, and note the current orchestrator/Teams unit-test count (the "200+" baseline referenced in SC-B04) so regressions are detectable.
- [ ] T002 [P] Review the existing `ActOnDeps` seam and per-agent ops (`deliverText`, `restartSession`, `bringOnline`) in `src/office/orchestratorActOn.ts` and the mocking pattern in `tests/unit/orchestrator/sendPromptToAgent.test.ts`, `bringOnlineExecute.test.ts`, `stopRestartAgent.test.ts` to confirm the composition points for `performHandoff`.
- [ ] T003 [P] Review the existing gate/relay path (`onPermissionRequestEvent`, `onApprovalTimeout`, `respondPermission`) in `electron/teams/teamsService.ts` and the `PermissionRequestResult` shape to confirm where a timeout-vs-deny disposition can be threaded (Phase 0 research item from plan.md).

**Checkpoint**: Baseline verified; extension points confirmed.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Land the shared types and IPC/gate-disposition scaffolding that BOTH the handoff
feature (Part A) and the deny/timeout bug fixes (Part B) depend on. Corresponds to plan.md
"Phase 1 — Contract + types".

**⚠️ CRITICAL**: No Part A story and no Part B deny/timeout work can begin until this phase is complete.

- [ ] T004 [P] Add `HandoffArgs`, `HandoffTarget`, `HandoffResult`, and `HandoffOutcome` (`'handed-off' | 'denied' | 'not-online' | 'invalid-target' | 'failed'`) types in `electron/orchestrator/types.ts` per contracts/orchestrator-handoff-tool.md (no `any` across the IPC seam).
- [ ] T005 [P] Add the B1/B3 gate-disposition type in `electron/orchestrator/types.ts` — a typed distinction between `user-denied` (explicit deny) and `timeout-lapsed` (no reachable approver) carried on the gate/tool result (FR-B06).
- [ ] T006 Add the `orchestrator:handoff:request` / `orchestrator:handoff:respond` IPC channel definitions (payload `{ requestId, args: HandoffArgs }` → `{ requestId, result: HandoffResult }`) in `electron/orchestrator/orchestratorIpc.ts`, mirroring the spec 017 act-on channels (depends on T004).
- [ ] T007 Expose the handoff invoke/on bridge in `electron/terminal/preload.ts` for the `orchestrator:handoff:*` channel (depends on T006).

**Checkpoint**: Types + IPC seam exist and compile (`npx tsc --noEmit`). User/bug story implementation can now begin.

---

## Phase 3: User Story 1 - Hand off to a fresh session of the same agent (Priority: P1) 🎯 MVP

**Goal**: A single approved `handoff_session` with target "same agent" tells the source to write
a handoff doc, restarts the source into a fresh session, and delivers a "Pick up from this handoff"
prompt to that fresh session — behind one approval.

**Independent Test**: With an agent online and mid-task, issue a same-agent handoff. Confirm a
handoff document path is produced in the agent's working directory, the session is restarted, and
the fresh session receives a pickup prompt naming the doc path; a denied gate produces zero side
effects; an offline source returns `not-online`.

### Tests for User Story 1 ⚠️ (write first, ensure they FAIL before implementation)

- [ ] T008 [P] [US1] Create `tests/unit/orchestrator/handoffSession.test.ts` covering the same-agent matrix rows from contracts/orchestrator-handoff-tool.md: same-agent restart ⇒ `handed-off` (restartSession called, pickup delivered to fresh source session); source offline ⇒ `not-online` (no deliverText/restart); denied ⇒ `denied` (manager never emits request, zero side effects); orchestrator identity as source ⇒ `invalid-target`; backing op returns false ⇒ `failed`. Reuse the `ActOnDeps` mocking pattern.

### Implementation for User Story 1

- [ ] T009 [US1] Implement `performHandoff()` (same-agent path) in `src/office/orchestratorActOn.ts`: resolve + guard source (`resolveTarget`; unknown/orchestrator identity ⇒ `invalid-target`; offline ⇒ `not-online`), compute deterministic `handoffDocPath` = `./.copilot-handoffs/handoff-<sourceAgentId>-<ISO8601>.md`, deliver the doc-writing prompt via `deliverText` (fail ⇒ `failed`), `restartSession(officeId, sourceAgentId)` (false ⇒ `failed`), deliver the pickup prompt to the fresh session via `deliverText` (false ⇒ `failed`), return typed `HandoffResult`. Must NOT mutate `activeAgentViewers` directly (FR-006/Principle III).
- [ ] T010 [US1] Register the gated `handoff_session` tool in `electron/orchestrator/tools.ts` (omit `skipPermission`; params per contract: `sourceAgentId` required, `officeId?`, `targetAgentId?`, `note?`, `additionalProperties:false`); handler delegates to `requestHandoff(args)` only after gate approval.
- [ ] T011 [US1] Add the `requestHandoff`/`respondHandoff` round-trip in `electron/orchestrator/orchestratorSessionManager.ts`: emit `orchestrator:handoff:request` with a `requestId`, correlate the `respond`, resolve the pending promise, and record the outcome (incl. denials, FR-011) to the orchestrator transcript (depends on T006).
- [ ] T012 [US1] Wire the renderer resolver for the handoff channel in `src/main.ts` so `orchestrator:handoff:request` invokes `performHandoff` and replies on `orchestrator:handoff:respond` (depends on T007, T009).
- [ ] T013 [US1] Run T008 against the implementation and make it green; confirm the denied path emits no request and zero side effects (SC-002).

**Checkpoint**: Same-agent handoff (the reported core request) is fully functional and testable independently — this is the MVP.

---

## Phase 4: User Story 2 - Hand off to a different agent taking over (Priority: P2)

**Goal**: A cross-agent handoff — source writes the doc, the orchestrator brings the target agent
online (idle-seated or reserve scene spawn, waits for ready), and delivers the pickup prompt to the
**target**. `targetAgentId === sourceAgentId` collapses to the US1 same-agent path.

**Independent Test**: With a source online, request a handoff to a named/idle reserve. Confirm the
doc is written by the source, the target is brought online, and the pickup prompt is delivered to
the target (not the source); an unactivatable target returns `invalid-target`/`failed` with no
pickup; `targetAgentId === source` behaves as US1.

### Tests for User Story 2 ⚠️ (write first, ensure they FAIL before implementation)

- [ ] T014 [P] [US2] Extend `tests/unit/orchestrator/handoffSession.test.ts` with the cross-agent matrix rows: distinct valid target ⇒ `handed-off` (bringOnline(target) called; pickup delivered to target); target == source ⇒ `handed-off` via coerced same-agent path; unknown/bogus target ⇒ `invalid-target` (no pickup); orchestrator identity as target ⇒ `invalid-target`.

### Implementation for User Story 2

- [ ] T015 [US2] Extend `performHandoff()` in `src/office/orchestratorActOn.ts` with the cross-agent path: when `targetAgentId` is present and `!== sourceAgentId`, resolve + guard the target (unknown/orchestrator identity ⇒ `invalid-target`), provision via `bringOnline(officeId, targetAgentId)` (false ⇒ `invalid-target`/`failed`), and deliver the pickup prompt to the **target** session; coerce `targetAgentId === sourceAgentId` to the same-agent path (FR-005).
- [ ] T016 [US2] Run T014 against the implementation and make it green; verify the source is left as-is (its doc written) on a cross-agent handoff (SC-004).

**Checkpoint**: Same-agent AND cross-agent handoffs both work independently.

---

## Phase 5: User Story 3 - Handoff document is durable and discoverable (Priority: P2)

**Goal**: After a handoff, the handoff document is at the reported `handoffDocPath` in the source
agent's working directory under a predictable location, and repeated handoffs of the same agent
produce unique (timestamped) paths.

**Independent Test**: Run a handoff, then locate the document at the reported path and confirm it is
a human-readable Markdown summary (state, decisions, open questions, next steps); run two handoffs of
the same agent and confirm distinct paths.

### Tests for User Story 3 ⚠️ (write first, ensure they FAIL before implementation)

- [ ] T017 [P] [US3] Extend `tests/unit/orchestrator/handoffSession.test.ts` with the doc-path uniqueness row: two same-agent handoffs of the same agent produce two distinct `handoffDocPath` values, and assert the returned `HandoffResult.handoffDocPath` matches the path folded into both delivered prompts (FR-004).

### Implementation for User Story 3

- [ ] T018 [US3] In `src/office/orchestratorActOn.ts`, ensure the doc-writing prompt instructs the source to author a Markdown handoff document at `handoffDocPath` covering current state, decisions made, open questions, and next steps (plus any `note`), and ensure the ISO8601 timestamp guarantees per-handoff uniqueness so earlier docs are not overwritten (FR-003/FR-004).
- [ ] T019 [US3] In `src/office/orchestratorActOn.ts`, ensure the pickup prompt instructs the target to read the document at `handoffDocPath` before starting and to wait/retry briefly if it is not yet present (FR-007), without the orchestrator polling for the source's async write (FR-008); confirm `handoffDocPath` is present in the returned `HandoffResult` and in both prompts.
- [ ] T020 [US3] Run T017 against the implementation and make it green (SC-005).

**Checkpoint**: All Part A user stories independently functional; the handoff artifact is durable and discoverable.

---

## Phase 6: Bug Story B1 - Approval timeout must not spawn a retry loop (Priority: P1)

**Goal**: An auto-denied gate due to timeout / no reachable approver is surfaced as a terminal
"not approved — stop and wait for the user" outcome distinct from an explicit deny, so the model
does not re-invoke the tool; a superseding identical `(agentId, toolName)` request replaces the
prior pending gate rather than accumulating parallel gates or resetting a fresh 5-minute wait.

**Independent Test**: Simulate a relayed gate no one answers; confirm the model receives a terminal
"not approved" signal (framed as lapsed, not failed) and does not immediately re-request; confirm a
re-request for the same `(agent, tool)` supersedes the prior pending gate (single pending gate).

### Tests for Bug Story B1 ⚠️ (write first, ensure they FAIL before implementation)

- [ ] T021 [P] [B1] Add/extend approval-relay tests under `tests/unit/teams/` asserting `onApprovalTimeout` produces a terminal `timeout-lapsed` disposition (not a plain `deny`), the relay message frames the request as lapsed, and the model-facing result is terminal; and assert a superseding identical `(agentId, toolName)` request replaces the prior pending gate (supersede-not-duplicate).

### Implementation for Bug Story B1

- [ ] T022 [B1] In `electron/teams/teamsService.ts`, change `onApprovalTimeout` to emit the distinct `timeout-lapsed` disposition (from T005) via `respondPermission` instead of a plain `deny`, and give the timeout relay message + tool guidance a terminal "not approved — wait for the user" framing (FR-B01).
- [ ] T023 [B1] Thread the `timeout-lapsed` disposition through `respondPermission` → the orchestrator gate result in `electron/orchestrator/orchestratorSessionManager.ts` so the tool result is terminal and the model does not auto-re-arm the gate (FR-B01), while preserving the existing supersede path in `onPermissionRequestEvent` (single pending gate per agent) and not resetting a just-lapsed timer into an immediate new 5-minute wait (FR-B02).
- [ ] T024 [B1] Run T021 against the implementation and make it green (SC-B01).

**Checkpoint**: A lapsed relayed gate terminally stops the model; no deny→re-request loop; single pending gate preserved.

---

## Phase 7: Bug Story B2 - Custom-office reserves must not be offered then fail `invalid-target` (Priority: P1)

**Goal**: `computeBringOnlineCandidates` derives idle-seated + reserve candidates from the effective
(custom-aware) office roster so it never offers an agent that cannot be activated there; genuine
seat exhaustion returns a specific "no open reserve seat" message instead of generic `invalid-target`.

**Independent Test**: In a custom office with `customReserveAgents`, list bring-online candidates and
confirm only seatable agents appear and each activates without `invalid-target`; when no seat is
available, confirm the outcome message names the seat-unavailable reason.

### Tests for Bug Story B2 ⚠️ (write first, ensure they FAIL before implementation)

- [ ] T025 [P] [B2] Extend `tests/unit/orchestrator/candidateSelection.test.ts` to assert that in a custom office (`config.customAgents` / `config.customReserveAgents`) `computeBringOnlineCandidates` offers only seatable idle-seated + reserve candidates (no default reserves without a real seat), and add a case asserting `executeBringOnline` returns a specific seat-unavailable message when no reserve seat is open.

### Implementation for Bug Story B2

- [ ] T026 [B2] In `src/office/orchestratorCandidates.ts`, make `computeBringOnlineCandidates` derive idle-seated and reserve candidates from the effective office roster (honor `config.customAgents` / `config.customReserveAgents`, mirroring `isKnownDormantAgent` in `orchestratorActOn.ts`) so it never offers a non-seatable agent (FR-B03).
- [ ] T027 [B2] In `src/office/orchestratorExecute.ts`, add a specific seat-unavailable message (e.g. "no open reserve seat") in `executeBringOnline` instead of a generic `invalid-target` when a reserve seat is genuinely unavailable (FR-B04).
- [ ] T028 [B2] Run T025 against the implementation and make it green (SC-B02).

**Checkpoint**: Custom-office candidate lists only offer activatable agents; seat exhaustion is reported specifically.

---

## Phase 8: Bug Story B3 - A user denial must be reported as a decision, not an error (Priority: P2)

**Goal**: An explicit user deny resolves the tool to a first-class `outcome:'denied'` framed as a
deliberate decision (not an error/interruption), and the gated-tool descriptions instruct the
orchestrator not to auto-retry a user-denied action. Timeout (B1) and deny (B3) stay distinguishable
end-to-end.

**Independent Test**: Deny a gated action and confirm the tool returns `outcome:'denied'` framed as a
deliberate decision with no auto-retry, and the response does not describe it as an "approval error";
confirm the user-denied vs timeout-lapsed signals remain distinct.

### Tests for Bug Story B3 ⚠️ (write first, ensure they FAIL before implementation)

- [ ] T029 [P] [B3] Add/extend tests under `tests/unit/teams/` (and/or `tests/unit/orchestrator/`) asserting an explicit user deny resolves to `outcome:'denied'` with deliberate-decision framing (not an "approval error"), and that the `user-denied` (B3) vs `timeout-lapsed` (B1) dispositions are preserved end-to-end (FR-B06).

### Implementation for Bug Story B3

- [ ] T030 [B3] In `electron/orchestrator/orchestratorSessionManager.ts` (and `types.ts` if needed), map the explicit user-deny gate result (`denied-interactively-by-user`) to a first-class `outcome:'denied'` with a message framing it as a deliberate user decision, keeping it distinct from the `timeout-lapsed` disposition from T005/T023 (FR-B05/FR-B06).
- [ ] T031 [B3] Update the gated-tool descriptions in `electron/orchestrator/tools.ts` to instruct the orchestrator NOT to auto-retry a user-denied action — acknowledge the denial and ask what to do next (FR-B05).
- [ ] T032 [B3] Run T029 against the implementation and make it green (SC-B03).

**Checkpoint**: User denial is a first-class decision with no auto-retry; deny and timeout are distinguishable end-to-end.

---

## Phase 9: Bug Story B4 - Status reads must reflect real agent state (Priority: P3)

**Goal**: The read-only status tools resolve roster membership through the same custom-aware
effective roster (shared with B2) and the single `agentStatusPresentation` source of truth, so a
status read cannot report agents absent from the office or mislabel their state.

> **Note (FR-B08)**: B4's remaining "wrong read" is P3 and gated on a concrete repro. Do NOT block
> Part A or B1–B3 on it. Land the roster-routing fix (FR-B07) here; file any residual discrepancy as
> a follow-up.

### Tests for Bug Story B4 ⚠️ (write first, ensure they FAIL before implementation)

- [ ] T033 [P] [B4] Extend `tests/unit/orchestrator/candidateSelection.test.ts` (or an adjacent status test) to assert `get_active_agents` / `get_agent_status` / `list_agents_awaiting_input` resolve roster from the effective custom-aware roster and `agentStatusPresentation`, and never report an agent absent from that office (FR-B07).

### Implementation for Bug Story B4

- [ ] T034 [B4] Route the read-only status tools' roster resolution through the shared effective (custom-aware) roster in `src/office/orchestratorCandidates.ts` (shared with T026) and the single `agentStatusPresentation` source of truth (FR-B07).
- [ ] T035 [B4] Run T033 against the implementation and make it green; if a "wrong read" repro remains unexplained by FR-B07, capture it and file a follow-up per FR-B08 (do not block on it).

**Checkpoint**: Status reads reflect the effective office roster; residual repro (if any) is filed, not blocking.

---

## Phase 10: Polish & Cross-Cutting Concerns

**Purpose**: Final verification across all stories and constitution/worktree gates from plan.md
"Phase 3 — Tests + verification".

- [ ] T036 Run `npx tsc --noEmit` across the whole tree and confirm no `any` was introduced across the IPC seam (strictness preserved).
- [ ] T037 Run `npm run test` and confirm all new tests pass and the full existing orchestrator + Teams suite (the 200+ baseline) stays green (SC-006, SC-B04).
- [ ] T038 Run the e2e smoke and the worktree bundle-marker check: build `dist/electron/*.js` + `dist/game.bundle.js` and confirm the launched bundle contains the new `handoff_session` tool name (Principle VII).
- [ ] T039 [P] Confirm every handoff outcome (including denials) and B1/B3 dispositions are recorded to the orchestrator transcript (FR-011) with source, target, and doc path.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup. BLOCKS Part A (US1–US3) and the deny/timeout fixes (B1, B3).
- **User Stories (Phases 3–5)**: Depend on Foundational. US1 (P1) first; US2 and US3 depend on US1's `performHandoff` core.
- **Bug Stories (Phases 6–9)**: B1 and B3 depend on the shared gate-disposition type (T005). B2 and B4 are independent of Part A and can start right after Setup (B4 shares B2's roster helper).
- **Polish (Phase 10)**: Depends on all targeted stories being complete.

### Story Dependencies

- **US1 (P1)**: After Foundational. Delivers `performHandoff` core, tool registration, IPC round-trip — the MVP.
- **US2 (P2)**: Extends US1's `performHandoff` (cross-agent path) — depends on T009.
- **US3 (P2)**: Refines US1's doc/pickup prompts + asserts uniqueness — depends on T009.
- **B1 (P1)**: Depends on T005 (gate-disposition type). Independent of Part A.
- **B2 (P1)**: Independent — renderer candidate/roster fix. Can run in parallel with Part A.
- **B3 (P2)**: Depends on T005; interacts with B1 (must stay distinguishable). Independent of Part A.
- **B4 (P3)**: Shares B2's roster helper (T026); gated on repro (FR-B08) — do not block others.

### Within Each Story

- Tests are written first and MUST FAIL before implementation.
- Types/IPC before resolver; resolver before tool registration/wiring; core (US1) before extensions (US2/US3).

### Parallel Opportunities

- Setup: T002, T003 in parallel.
- Foundational: T004, T005 in parallel (same file `types.ts` — coordinate edits; both may be batched).
- After Foundational: Part A (US1→US2/US3) and Part B (B2 immediately; B1/B3 after T005) can proceed on separate tracks.
- Test-authoring tasks marked [P] (T008 for US1; T014, T017 extend the same file so serialize those; T021, T025, T029, T033) can be drafted in parallel across different files.

---

## Parallel Example: Part A vs Part B tracks

```bash
# Track 1 (Part A — handoff feature), after Phase 2:
Task: "US1 performHandoff same-agent path in src/office/orchestratorActOn.ts"
Task: "US1 register handoff_session in electron/orchestrator/tools.ts"

# Track 2 (Part B — bring-online/status), can start right after Phase 1:
Task: "B2 custom-aware computeBringOnlineCandidates in src/office/orchestratorCandidates.ts"
Task: "B2 seat-unavailable message in src/office/orchestratorExecute.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 + B1/B2 P1 fixes)

1. Phase 1: Setup (baseline green).
2. Phase 2: Foundational (types + IPC) — CRITICAL, blocks Part A + deny/timeout.
3. Phase 3: User Story 1 (same-agent handoff) — the core reported request.
4. **STOP and VALIDATE**: Test US1 independently (handed-off / denied / not-online).
5. Land the P1 bug fixes B1 (Phase 6) and B2 (Phase 7) alongside/after US1.

### Incremental Delivery

1. Setup + Foundational → seam ready.
2. US1 → test independently → demo (MVP: same-agent handoff).
3. US2 → cross-agent handoff → test independently.
4. US3 → durable/unique doc → test independently.
5. B1, B2 (P1) → B3 (P2) → B4 (P3, repro-gated).
6. Phase 10 → full tsc/test/e2e/bundle-marker verification.

---

## Notes

- [P] tasks = different files, no dependencies on incomplete tasks.
- [Story] label maps each task to its user/bug story for traceability.
- Verify tests FAIL before implementing (SC-006 / SC-B04 mandate the coverage).
- Never mutate `activeAgentViewers` outside `agent-viewers.ts` helpers (Principle III / FR-006).
- The orchestrator session is ALWAYS gated; never consults `isYoloEnabled()`.
- Keep `timeout-lapsed` (B1) and `user-denied` (B3) dispositions distinguishable end-to-end (FR-B06).
- Commit after each task or logical group; stop at any checkpoint to validate a story independently.
