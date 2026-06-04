---
description: "Task list for Repository-Wide Refactor Program"
---

# Tasks: Repository-Wide Refactor Program

**Input**: Design documents from `/specs/001-repo-wide-refactor/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/refactor-slice-contract.md, quickstart.md

**Tests**: Tests are REQUIRED for any slice that touches runtime behavior — parity checks are the
acceptance gate. Use the existing `npm run test`, `npm run test:coverage`, and `npm run test:e2e`
workflows. Do not invent new test frameworks.

**Organization**: Tasks are grouped by user story so each story can be implemented, validated, and
delivered independently.

## Constitution-Driven Task Requirements

- Any slice touching agent rosters, layouts, or scene wiring MUST add or update config-driven entries
  rather than hardcoding behavior.
- Any slice touching terminal/session/fleet/meeting lifecycle MUST include explicit regression checks
  for office switching, fleet transitions, and session continuity.
- Any slice touching input behavior MUST verify focus transitions through `InputManager` only.
- Any slice touching the renderer MUST keep Phaser as the sole in-canvas renderer.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: User story this task belongs to (US1, US2, US3)
- File paths use repository-root-relative locations

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Stand up the refactor-program scaffolding so all slices share one tracking surface.

- [X] T001 Create `specs/001-repo-wide-refactor/slices/` directory to hold one markdown file per slice contract instance.
- [X] T002 Create `specs/001-repo-wide-refactor/slices/_template.md` from `specs/001-repo-wide-refactor/contracts/refactor-slice-contract.md` so every slice uses the same field schema (slice_id, classification, scope_in/out, parity_checks, rollback_strategy, dependencies, approval_record).
- [X] T003 [P] Create `specs/001-repo-wide-refactor/tracking/progress.md` with a slice-status table seeded from `data-model.md` lifecycle states (proposed/planned/in_progress/blocked/complete/rolled_back).
- [X] T004 [P] Create `specs/001-repo-wide-refactor/tracking/risks.md` with a DependencyRisk register matching the `data-model.md` schema.
- [X] T005 [P] Create `specs/001-repo-wide-refactor/tracking/approvals.md` with an ApprovalRecord log for behavior-altering slices, including pending/approved/rejected states.
- [X] T006 Confirm baseline command health by running `npm run build`, `npm run test`, and `npm run test:e2e` from repo root and capture results in `specs/001-repo-wide-refactor/tracking/progress.md` under a `Baseline` section. *(build=pass, test=pass 69/69, e2e=env-blocked in CLI/headless; result captured in tracking/progress.md.)*
- [X] T007 [P] Capture reusable patterns from `C:\Users\danielluo\repos\agency-cowork-main` (PTY lifecycle, preload IPC, process supervision) into `specs/001-repo-wide-refactor/tracking/agency-cowork-notes.md`, noting which patterns are candidates for adaptation in terminal/session slices.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Establish behavior baselines and parity-check harness that every slice will consume.

**⚠️ CRITICAL**: No slice work in Phase 3+ may begin until this phase is complete.

- [X] T008 Author `specs/001-repo-wide-refactor/baselines/critical-flows.md` listing the BehaviorBaseline entries for: player movement, agent interaction (E key), terminal open/close, office switching, meeting mode entry, fleet orchestration, sub-agent lifecycle, input focus transitions, status badge transitions.
- [X] T009 [P] For each critical flow in T008, document the exact existing observable behavior (inputs → outputs, event sequence, UI state) using current code in `src/` and `electron/` as the source of truth so parity comparisons are unambiguous. *(Folded into critical-flows.md per baseline.)*
- [X] T010 [P] Inventory existing automated coverage by listing every test under `tests/` and any `*.test.ts` in `src/` against the baselines in T008; record gaps in `specs/001-repo-wide-refactor/baselines/coverage-gaps.md`.
- [X] T011 Define the parity-check harness in `specs/001-repo-wide-refactor/baselines/parity-harness.md`: which `npm run test` subsets, which `npm run test:e2e` specs, and which manual smoke steps are required per impacted critical flow.
- [X] T012 [P] Enumerate the full repository surface (`src/**`, `electron/**`, `tests/**`, top-level config) in `specs/001-repo-wide-refactor/slices/_surface-map.md` and assign every file/folder to exactly one prospective slice owner. This enforces SC-001 (100% coverage).
- [X] T013 Produce the initial slice backlog by instantiating one slice file per planned slice in `specs/001-repo-wide-refactor/slices/` using the T002 template; each entry MUST set `classification` and link to its baseline from T008.
- [X] T014 Cross-link slices in `specs/001-repo-wide-refactor/tracking/progress.md` with their dependencies and seed the DependencyRisk register (T004) with any cross-domain coupling flagged during T012/T013.

**Checkpoint**: Backlog, baselines, and parity harness exist. Slice execution can begin.

---

## Phase 3: User Story 1 - Stabilize Core Gameplay and Agent Flows (Priority: P1) 🎯 MVP

**Goal**: Refactor highest-risk runtime pathways (input, scene lifecycle, terminal/session, fleet/meeting)
while preserving current behavior so the rest of the program executes on a stable base.

**Independent Test**: After completing P1 slices, run `npm run test` and `npm run test:e2e` plus the
parity harness for movement, interaction, terminal lifecycle, office switching, and fleet/meeting
transitions. All must pass with no user-visible regression.

### Slice S1-A: Input Focus and Keyboard Routing

- [X] T015 [US1] Author slice file `specs/001-repo-wide-refactor/slices/S1-A-input-focus.md` covering `src/input/**` and any `src/main.ts` focus wiring; classification: `parity_preserving`; baseline: input focus transitions + status badges.
- [X] T016 [US1] Refactor `src/input/` to centralize all focus state transitions, removing any direct Phaser keyboard manipulation found in `src/scenes/**`, `src/ui/**`, and `src/main.ts`; preserve the existing `game` vs `terminal` two-state contract.
- [X] T017 [US1] Update consumers in `src/main.ts`, `src/scenes/OfficeScene.ts`, and `src/ui/**` to route all focus changes through `InputManager` per `.github/instructions/src-input.instructions.md`.
- [X] T018 [US1] Add or extend Vitest coverage under `tests/` (or co-located `*.test.ts`) to verify focus transitions for: open terminal, close terminal (F10/Escape), mini-game open/close, settings overlay open/close, and restoration after overlay dismissal.
- [X] T019 [US1] Run `npm run test` and the input portion of the parity harness; record result in `specs/001-repo-wide-refactor/tracking/progress.md` for S1-A.

### Slice S1-B: Scene Lifecycle and Office Switching

- [X] T020 [US1] Author slice file `specs/001-repo-wide-refactor/slices/S1-B-scene-lifecycle.md` covering `src/scenes/**` and the `office:switch` event chain in `src/main.ts` and `src/office/**`; classification: `parity_preserving`.
- [X] T021 [US1] Refactor `src/scenes/OfficeScene.ts` to remove hardcoded agent IDs from scene/layout logic (per the "Regression-Prone Pitfalls" note in `.github/copilot-instructions.md`); rely on `src/config/agents.ts` and `src/office/officeManager.ts` for rosters.
- [X] T022 [US1] Clarify Boot → Office → Meeting transitions in `src/scenes/**` so each scene's responsibilities are documented in-file and dependencies on DOM overlays are explicit.
- [X] T023 [US1] Verify `office:switch` and tab-driven office changes preserve agent state, sprite metadata, and dashboard cards across both `default` and `fleet-vteam` layouts; add a Playwright spec under `tests/e2e/` if a gap was identified in T010.
- [X] T024 [US1] Run `npm run test`, `npm run test:e2e`, and the scene/office portion of the parity harness; record result for S1-B.

### Slice S1-C: Terminal/Session Lifecycle (Renderer Side)

- [X] T025 [US1] Author slice file `specs/001-repo-wide-refactor/slices/S1-C-terminal-renderer.md` covering `src/ui/**` terminal components, `src/main.ts` terminal wiring, and renderer-side session state; classification: `parity_preserving`; reference patterns from T007.
- [X] T026 [US1] Refactor renderer terminal lifecycle so open/attach/detach/close flows are encapsulated behind a single module; remove ad-hoc DOM manipulation scattered across `src/main.ts`.
- [X] T027 [US1] Guard status transitions against concurrent tool events in `src/main.ts` per the existing pitfall note: treat `ask_user` as a waiting-state signal even when other tools complete in the same tick.
- [X] T028 [US1] Add Vitest coverage for terminal lifecycle state machine (open → attach → ready → waiting/thinking → detach → close) and for status-badge transitions including the `ask_user` race.
- [X] T029 [US1] Run terminal-lifecycle portion of parity harness and record result for S1-C.

### Slice S1-D: PTY Server and Preload Bridge (Electron Side)

- [X] T030 [US1] Author slice file `specs/001-repo-wide-refactor/slices/S1-D-pty-server.md` covering `electron/terminal/**` and `electron/main.ts` IPC handlers; classification: `parity_preserving`; reference adapted patterns from `agency-cowork-main` per T007.
- [X] T031 [US1] Refactor `electron/terminal/server.ts` so sub-agent lifecycle forwarding does NOT depend on active terminal viewers (per pitfall note); ensure `copilot-event` propagation continues through scene transitions and detaches.
- [X] T032 [US1] Preserve the existing `activeAgentViewers` dual-key fix for fleet session transfer (original key + new fleet key on attach, both cleaned up on detach); document the invariant in a code comment and in the slice file.
- [X] T033 [US1] Validate preload contract in `electron/terminal/preload.ts` and protocol types stay in lockstep with `electron/main.ts` and renderer consumers; keep path resolution and PATH sanitization intact.
- [X] T034 [US1] Run `npm run test:e2e` focused on terminal lifecycle and fleet session transfer; record result for S1-D.

### Slice S1-E: Meeting Mode and Fleet Orchestration

- [X] T035 [US1] Author slice file `specs/001-repo-wide-refactor/slices/S1-E-meeting-fleet.md` covering `src/meeting/**` and the fleet visualizer/tracker pair; classification: `parity_preserving`; read `MeetingMode.md` before editing.
- [X] T036 [US1] Refactor `src/meeting/fleetOrchestrator.ts`, `fleetTracker.ts`, and `fleetVisualizer.ts` to clarify the spawn → track → visualize → teardown contract; keep FleetTracker's `sourceOfficeId` attach (belt-and-suspenders) intact unless replaced by an equivalent server-side guarantee.
- [X] T037 [US1] Verify plan parsing and approval UI in `src/meeting/planParser.ts` and `planApproval.ts` against existing fixtures; preserve current approval flow behavior.
- [X] T038 [US1] Add Vitest coverage for plan parsing edge cases and a Playwright spec for meeting entry → plan approval → fleet spawn → fleet office terminal visibility.
- [X] T039 [US1] Run full parity harness for meeting/fleet flows and record result for S1-E.

**Checkpoint**: P1 complete. All high-risk runtime pathways are refactored with parity preserved.
MVP refactor is shippable.

---

## Phase 4: User Story 2 - Refactor Supporting Systems by Domain (Priority: P2)

**Goal**: Deliver remaining domains as independent slices so each can be reviewed and merged with
bounded blast radius.

**Independent Test**: Each P2 slice runs its own parity-check subset; unrelated domains remain stable.

### Slice S2-A: Office State and Persistence

- [X] T040 [US2] Author slice file `specs/001-repo-wide-refactor/slices/S2-A-office-state.md` covering `src/office/**` (no rendering) and `.data/copilot-offices.json` persistence; classification: `parity_preserving`.
- [X] T041 [P] [US2] Refactor `src/office/officeManager.ts` to make office add/remove/switch and per-agent status tracking a pure data layer with explicit serialization boundaries.
- [X] T042 [US2] Verify persistence round-trip and migration of any existing `.data/copilot-offices.json` files; add Vitest coverage for serializer.
- [X] T043 [US2] Run office portion of parity harness and record result.

### Slice S2-B: Layouts (Default + Fleet V-Team)

- [X] T044 [US2] Author slice file `specs/001-repo-wide-refactor/slices/S2-B-layouts.md` covering `src/layouts/**` and any scene calls into layout factories; classification: `parity_preserving`.
- [X] T045 [P] [US2] Refactor `src/layouts/` so each `OfficeLayout` is a fully data-driven contract; remove layout-specific branches from `src/scenes/OfficeScene.ts` when feasible.
- [X] T046 [US2] Verify Arthur's default position and fleet placement match current behavior across both layouts; add visual or DOM-level Playwright check if a gap was identified in T010.
- [X] T047 [US2] Run layout portion of parity harness and record result.

### Slice S2-C: UI Overlays (Terminal Panel, Dashboards, Mini-Games)

- [ ] T048 [US2] Author slice file `specs/001-repo-wide-refactor/slices/S2-C-ui-overlays.md` covering `src/ui/**` (excluding terminal lifecycle already refactored in S1-C); classification: `parity_preserving`.
- [ ] T049 [P] [US2] Refactor agent Overview Dashboard, status bar, settings popover, and notification surfaces to honor the documented DOM z-index layering (status bar 100, terminal overlay 10000, sprite card 10001).
- [ ] T050 [US2] Preserve and restore focus around overlays/popovers per pitfall note: keep `InputManager` and DOM focus in sync on open/close.
- [ ] T051 [US2] Add Vitest coverage for overlay open/close focus contract; add a Playwright spec for dashboard ↔ terminal panel switching parity.
- [ ] T052 [US2] Run UI overlay portion of parity harness and record result.

### Slice S2-D: Sprites and Entities

- [ ] T053 [US2] Author slice file `specs/001-repo-wide-refactor/slices/S2-D-sprites-entities.md` covering `src/sprites/**` and `src/entities/**`; classification: `parity_preserving`.
- [ ] T054 [P] [US2] Refactor `src/sprites/SpriteGenerator.ts` and `DirectionalSprite` so procedural generation and animation helpers have clear separation; keep procedural-only constraint (no external sprite files).
- [ ] T055 [US2] Refactor `src/entities/` (Player, NPC) to consume sprite helpers via a single API; remove duplicated direction-handling logic if present.
- [ ] T056 [US2] Verify 4-direction walk animations and reserve-agent sprite activation still work; add Vitest coverage where reasonable.
- [ ] T057 [US2] Run sprite/entity portion of parity harness and record result.

### Slice S2-E: Configuration Surface

- [ ] T058 [US2] Author slice file `specs/001-repo-wide-refactor/slices/S2-E-config.md` covering `src/config/**` (agents, depths, notifications, player customization); classification: `parity_preserving`.
- [ ] T059 [P] [US2] Audit `src/config/` for fields consumed via hardcoded constants elsewhere; migrate those callers to read from config (constitution requirement).
- [ ] T060 [US2] Verify `Depths.*` usage in `src/config/depths.ts` and y-sorted objects using `ySortDepth()` remain consistent across scenes.
- [ ] T061 [US2] Run config-impact portion of parity harness and record result.

### Slice S2-F: Electron Main Process (Non-Terminal)

- [ ] T062 [US2] Author slice file `specs/001-repo-wide-refactor/slices/S2-F-electron-main.md` covering `electron/main.ts` window/IPC/hot-reload concerns excluding terminal lifecycle; classification: `parity_preserving`.
- [ ] T063 [US2] Refactor IPC handler registration so contracts are colocated with their renderer consumers via the preload bridge; keep `window.copilotBridge` shape stable.
- [ ] T064 [US2] Verify hot-reload, window lifecycle, and dev/prod startup parity using `npm run dev` and `npm start`.
- [ ] T065 [US2] Run electron-main portion of parity harness and record result.

### Slice S2-G: Test Harness Hygiene

- [ ] T066 [US2] Author slice file `specs/001-repo-wide-refactor/slices/S2-G-tests.md` covering `tests/**` and any co-located `*.test.ts`; classification: `parity_preserving`.
- [ ] T067 [US2] Close coverage gaps identified in T010 by adding tests for previously uncovered critical flows; do NOT add a new framework — use Vitest + Playwright.
- [ ] T068 [US2] Run `npm run test:coverage` and document coverage delta in `specs/001-repo-wide-refactor/tracking/progress.md`.

**Checkpoint**: P2 complete. All supporting domains are refactored independently with parity
preserved.

---

## Phase 5: User Story 3 - Institutionalize Sustainable Code Health (Priority: P3)

**Goal**: Lock in boundaries with governance documentation so future changes do not reintroduce
architectural drift.

**Independent Test**: Apply the new rules to a hypothetical follow-up change and confirm a
maintainer can identify required boundaries, validations, and documentation updates from the rules
alone.

- [ ] T069 [US3] Update `.github/instructions/*.instructions.md` to reflect any boundary or convention changes introduced by P1/P2 slices; keep the `applyTo` frontmatter scopes accurate.
- [ ] T070 [US3] Update `.github/copilot-instructions.md` "Regression-Prone Pitfalls" and "Known Limitations" sections to remove resolved items and add any new invariants discovered during refactor.
- [ ] T071 [US3] Update `MeetingMode.md` so it matches the post-S1-E meeting/fleet contract.
- [ ] T072 [US3] Create `specs/001-repo-wide-refactor/governance/handoff.md` defining: review gates, mandatory parity checks for future PRs touching critical flows, and the change-classification (parity_preserving vs behavior_altering) rule.
- [ ] T073 [P] [US3] Create `specs/001-repo-wide-refactor/governance/boundaries.md` capturing the final ownership boundaries for scene/input/UI/terminal/office/layout/meeting/config domains.
- [ ] T074 [P] [US3] Update `.specify/memory/constitution.md` only if refactor outcomes ratify additional invariants; otherwise leave untouched and note "no constitution amendments required" in `handoff.md`.
- [ ] T075 [US3] Walk through `specs/001-repo-wide-refactor/quickstart.md` end-to-end against the final state to confirm the playbook is accurate.

**Checkpoint**: P3 complete. Governance handoff is documented and ready for future feature work.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [ ] T076 [P] Run full `npm run build`, `npm run test`, `npm run test:coverage`, and `npm run test:e2e` from a clean checkout and record the final results in `specs/001-repo-wide-refactor/tracking/progress.md` under a `Final Validation` section.
- [ ] T077 [P] Audit `specs/001-repo-wide-refactor/slices/` to confirm every slice is `complete` or `rolled_back`; no `in_progress` or `blocked` entries remain.
- [ ] T078 Reconcile `specs/001-repo-wide-refactor/tracking/approvals.md`: every `behavior_altering` slice has an `approved` record; otherwise flip the slice classification or revert.
- [ ] T079 Close any open entries in `specs/001-repo-wide-refactor/tracking/risks.md`; document accepted residual risks.
- [ ] T080 Produce a refactor retrospective `specs/001-repo-wide-refactor/governance/retrospective.md` covering what worked, what to repeat, and what to avoid.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately.
- **Phase 2 (Foundational)**: Depends on Phase 1. BLOCKS all user-story phases.
- **Phase 3 (US1)**: Depends on Phase 2.
- **Phase 4 (US2)**: Depends on Phase 2; benefits from S1 stability but slices are independent.
- **Phase 5 (US3)**: Depends on substantive completion of P1/P2 so governance reflects reality.
- **Phase 6 (Polish)**: Depends on all desired user stories being complete.

### Slice Dependencies (within US1)

- S1-A (input) → S1-B (scene), S1-C (terminal renderer): scene and renderer slices benefit from a
  stabilized InputManager contract first.
- S1-C (terminal renderer) and S1-D (PTY server) MUST be coordinated: protocol + preload + server
  changes ship in the same change per the existing pitfall note.
- S1-E (meeting/fleet) depends on S1-C + S1-D to avoid revisiting terminal lifecycle work.

### Slice Dependencies (within US2)

- S2 slices are largely independent; S2-G (tests) should land after each domain slice or alongside.

### Parallel Opportunities

- T003, T004, T005, T007 in Phase 1 can run in parallel after T001/T002.
- T009, T010, T012 in Phase 2 can run in parallel after T008.
- Within US2: T041, T045, T049, T054, T059 are different files/domains and can run in parallel by
  different developers.
- T073 and T074 in Phase 5 are independent.

---

## Parallel Example: User Story 2

```bash
# After Phase 2 checkpoint, US2 slices can be staffed in parallel:
Task: "Refactor src/office/officeManager.ts (S2-A)"
Task: "Refactor src/layouts/** (S2-B)"
Task: "Refactor src/ui/** overlays (S2-C)"
Task: "Refactor src/sprites/** and src/entities/** (S2-D)"
Task: "Audit src/config/** for hardcoded constants (S2-E)"
```

---

## Implementation Strategy

### MVP First (User Story 1 Only)

1. Complete Phase 1 (Setup).
2. Complete Phase 2 (Foundational) — baselines and parity harness.
3. Complete Phase 3 (US1) — input → scene → terminal renderer → PTY server → meeting/fleet.
4. STOP and VALIDATE: run full parity harness; demo internally.
5. Ship MVP refactor.

### Incremental Delivery

1. Setup + Foundational → tracking surface ready.
2. US1 slices ship one at a time (S1-A → S1-E) with parity validation at each checkpoint.
3. US2 slices ship in parallel where staffing allows.
4. US3 governance lands once boundaries stabilize.
5. Polish closes out validation and retrospective.

### Approval Gate Reminder

- Any slice that surfaces a desirable behavior change MUST flip classification to
  `behavior_altering`, log an ApprovalRecord, and wait for explicit user approval before completion
  (FR-011, FR-012). The default is parity preservation.

---

## Notes

- [P] tasks operate on different files with no shared dependency.
- Each slice file in `specs/001-repo-wide-refactor/slices/` is the durable record for that slice;
  this `tasks.md` is the program-level execution plan.
- Use existing `npm` scripts only — do NOT introduce new test or build tooling.
- Always read `MeetingMode.md` before editing `src/meeting/**`.
- Always cross-reference `C:\Users\danielluo\repos\agency-cowork-main` for terminal/session slices
  (S1-C, S1-D) per Decision 6 in `research.md`.
