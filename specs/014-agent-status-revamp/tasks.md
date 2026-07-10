---
description: "Task list for Agent Status Tracking Revamp"
---

# Tasks: Agent Status Tracking Revamp

**Input**: Design documents from `specs/014-agent-status-revamp/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/status-presentation.md

**Tests**: INCLUDED — the spec's Regression Plan and Success Criteria explicitly require unit + e2e coverage.

**Worktree**: All work happens in `C:\Users\danielluo\repos\CopilotOffice-014-agent-status-revamp` (branch `014-agent-status-revamp`). Run every `npm`/`git` command from that directory (Constitution Principle VII — its `dist/` is the one that matters).

**Organization**: Grouped by user story. US1 (reliability) and US2 (consistency) are both P1; US2's shared-mapping foundation unblocks US1's surface work, so the config module is done in the Foundational phase.

## Constitution-Driven Task Requirements

- New canonical mapping is config (`src/config/agentStatusPresentation.ts`) — no hardcoded per-surface tables (Principle V).
- No terminal/session lifecycle changes; Done-clear + stall detection are read-only over status (Principle III).
- Focus-to-clear-Done reuses existing interaction/selection/terminal-open events, not ad hoc keyboard handling (Principle II).
- Phaser badge stays the sole in-canvas renderer; dashboards/notifications stay DOM (Principle I).
- Default + Fleet dashboard parity is mandatory in the same change (delivery gate).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: US1 (reliability), US2 (consistency), US3 (rich/actionable), or FND/SETUP/POLISH

## Path Conventions

Single project, renderer-only. Paths are relative to the worktree root.

---

## Phase 1: Setup

- [x] T001 [SETUP] Confirm worktree is ready: `node_modules` installed, `npm run test` and `npm run build` both green on the untouched `014-agent-status-revamp` HEAD (baseline before changes).

---

## Phase 2: Foundational (Blocking Prerequisites) 🎯

**Purpose**: The shared canonical presentation module. EVERY surface (US1 + US2 + US3) depends on it — nothing else can start until this exists and its tests pass.

**⚠️ CRITICAL**: Blocks all user-story phases.

- [x] T002 [FND] Create `src/config/agentStatusPresentation.ts` implementing the contract in `contracts/status-presentation.md`: `StatusKey` type, `StatusPresentation` interface, `STATUS_PRESENTATION` record (canonical table incl. 🧠 for `thinking`, 📬/blue for `done`), `STALL_THRESHOLD_MS = 60_000`, and functions `resolveStatusKey`, `computeStall`, `describeActivity`, `formatElapsedMmSs`. Import `AgentStatus` from `src/office/officeManager.ts`. No DOM/Phaser deps (pure module).
- [x] T003 [P] [FND] Unit tests `tests/unit/config/agentStatusPresentation.test.ts`: mapping completeness (record for every `StatusKey`), `resolveStatusKey` folds `ready+completionPendingAck`→`done` and `ready`→`ready`, slacking/null handling, `computeStall` flips at exactly `STALL_THRESHOLD_MS` and clears when inactive, `formatElapsedMmSs` boundaries (0:07, 0:59, 1:00, 12:05). Must pass.

**Checkpoint**: Shared mapping exists and is unit-verified — surface migration can begin.

---

## Phase 3: User Story 2 — Consistent presentation across surfaces (Priority: P1)

**Goal**: Badge, both dashboards, and notifications all render each state from `STATUS_PRESENTATION` — same name/color/icon. Fixes the 🧠-vs-⚡ drift.

**Independent Test**: Put an agent in each state; badge and dashboards agree on name/color/icon on every surface.

- [x] T004 [US2] Migrate `src/entities/NPC.ts` to derive badge color/stroke/icon/animation from `STATUS_PRESENTATION[resolveStatusKey(status)]`; delete local `BADGE_COLORS` map and inline icon map. Preserve slacking hide behavior and pulse-tween stop/null discipline.
- [x] T005 [US2] Migrate `src/layouts/default/DefaultDashboard.ts`: replace the inline `switch` with `STATUS_PRESENTATION`/`resolveStatusKey` for dot color, label, icon. Label = canonical `label` only (no `Thinking: <detail>`).
- [x] T006 [US2] Apply the identical migration to `src/layouts/fleet/FleetDashboard.ts` (parity gate) — same helper calls, no divergence from T005.
- [x] T007 [US2] Update `src/ui/NotificationService.ts` status-derived notifications to use `STATUS_PRESENTATION[key].label`/`.icon` (and color where colored) — no bespoke per-state wording/coloring.
- [x] T008 [P] [US2] Add a guard test (or extend an existing dashboard test) asserting Default and Fleet dashboards produce the same label/icon/color for a given status, and that no status literal (hex/label/emoji) remains in the four surfaces outside the config module.

**Checkpoint**: All surfaces consistent; 🧠/⚡ mismatch gone.

---

## Phase 4: User Story 1 — Trustworthy status that reflects reality (Priority: P1)

**Goal**: No stale, wrong, or flickering status. Settle on turn-end; honor ask_user race everywhere; dedup/out-of-order safe; office-switch fresh; Done clears on any focus.

**Independent Test**: Drive a full lifecycle (idle→active→waiting→done→idle) and confirm every surface reaches the correct final state within ~1s with no stuck in-progress state.

- [x] T009 [US1] In `src/main.ts` status-update path, ensure turn-end with no remaining tools settles off `thinking`/`starting` (uses `nextSubStateAfterToolComplete`); confirm no code path leaves an in-progress state stuck (FR-002).
- [x] T010 [US1] Harden the tool-event handling in `src/main.ts`: ignore completions for unknown `toolId`; make the tool set idempotent so duplicate/out-of-order completions can't corrupt the resolved key (FR-004).
- [x] T011 [P] [US1] Extend `tests/unit/util/toolStatus.test.ts`: (a) ask_user waiting preserved when an unrelated tool completes concurrently, (b) duplicate completion is idempotent, (c) out-of-order completion for unknown toolId is a no-op (FR-003/004, SC-004).
- [x] T012 [US1] Add `clearCompletionAck(agentId)` as the single Done-clear entry point in `src/main.ts` and wire it to ALL focus paths: terminal open, dashboard card select, and in-world interact (E). Ensure it does not detach/kill the session (Principle III) (FR-010).
- [x] T013 [P] [US1] Regression test for office-switch freshness: after switching offices and back, each agent shows its current status (no stale snapshot) — assert around `reconnectAgentStatuses()` (FR-006). Prefer unit/integration; escalate to e2e only if state isn't reachable otherwise.
- [x] T013a [P] [US1] Regression test for session interruption: an active agent whose session is closed or errors resolves to `slacking`/`error` with no residual in-progress badge on any surface — assert around `setAgentSlacking`/`setAgentError` in `src/main.ts` (FR-005, "Session interruption" edge case).

**Checkpoint**: Status is trustworthy across the full lifecycle.

---

## Phase 5: User Story 3 — Says what it's doing and for how long (Priority: P2)

**Goal**: Live mm:ss timer for active agents; concise "Thinking" label with detail off the primary line (fixed card height); ~60s stall visual on the existing state.

**Independent Test**: Active agent shows a ticking m:ss timer + activity detail without card growth; after ~60s idle-in-state it shows the amber stall treatment (distinct from error) and clears on resume.

- [x] T014 [US3] Change `formatElapsed` in `src/main.ts` to mm:ss via `formatElapsedMmSs`; ensure the existing `ELAPSED_TICK_MS` (1s) updater drives the live timer for active states (FR-012).
- [x] T015 [US3] In `src/layouts/default/DefaultDashboard.ts`, give the agent card a fixed `min-height` and render `describeActivity(status)` on a fixed-height/truncated line or `title` tooltip — never concatenated into the label, never changing card height (FR-011/FR-015). Reserve the detail slot so empty/long detail don't reflow.
- [x] T016 [US3] Mirror the fixed-height + truncated-detail treatment in `src/layouts/fleet/FleetDashboard.ts` (parity).
- [x] T017 [US3] Implement the stall visual: in the `ELAPSED_TICK_MS` tick (`src/main.ts`), toggle a stall class when `computeStall(status).isStalled`; in `src/entities/NPC.ts` apply the amber tint + altered pulse (distinct from normal pulse and from error) when stalled, and clear it when activity resumes (FR-013, SC-007).
- [x] T018 [P] [US3] Unit-test `computeStall` integration expectations already covered in T003; add a focused test that the dashboard renders the stall class/label past threshold and clears it, and that card height is unchanged across states (SC-009).

**Checkpoint**: Status is actionable — activity, elapsed time, and stall signal all present without layout churn.

---

## Phase 6: Polish & Validation

- [x] T019 [POLISH] Grep the four surfaces (`NPC.ts`, `DefaultDashboard.ts`, `FleetDashboard.ts`, `NotificationService.ts`) to confirm zero status color/label/icon literals remain outside `agentStatusPresentation.ts`.
- [x] T020 [POLISH] Run `npm run test` (full) — all unit/integration green.
- [x] T021 [POLISH] Run `npm run build` then `npm run test:e2e` — boot + office switch + badge parity flow green.
- [x] T022 [POLISH] Manual pass of `quickstart.md` checklist in BOTH default and fleet offices; confirm SC-001..SC-009.
- [x] T023 [POLISH] Update docs if any operator-visible behavior changed (status legend / controls), per Constitution delivery gate.

---

## Dependencies & Execution Order

### Phase dependencies

- **Setup (P1)** → no deps.
- **Foundational (P2: T002–T003)** → blocks everything. The config module is the single source of truth all surfaces import.
- **US2 (P3)** → after Foundational. Surface migration.
- **US1 (P4)** → after Foundational; independent of US2 file-wise except `main.ts`/`NPC.ts` overlap (sequence those).
- **US3 (P5)** → after Foundational; builds on the fixed-height cards and timer; touches `main.ts`, both dashboards, `NPC.ts`.
- **Polish (P6)** → after all stories.

### Key sequencing (same-file conflicts — NOT parallel)

- `src/main.ts`: T009 → T010 → T012 → T014 → T017 (sequential).
- `src/entities/NPC.ts`: T004 → T017 (stall visual after migration).
- `src/layouts/default/DefaultDashboard.ts`: T005 → T015.
- `src/layouts/fleet/FleetDashboard.ts`: T006 → T016.

### Parallel opportunities

- T003 [P] runs alongside other Foundational review.
- Test tasks T008, T011, T013, T018 are [P] (distinct test files) once their subjects exist.
- US2 surface migrations touch distinct files (T004 NPC, T005 default, T006 fleet, T007 notifications) — parallelizable **until** US3 reintroduces same-file edits.

---

## Implementation Strategy

### MVP path

1. Setup (T001) → Foundational (T002–T003).
2. **US2 (T004–T008)** — consistency across surfaces = immediate visible win (fixes 🧠/⚡). Validate.
3. **US1 (T009–T013)** — reliability hardening. Validate full lifecycle.
4. **US3 (T014–T018)** — timer, fixed-height cards, stall. Validate no reflow.
5. Polish (T019–T023).

### Notes

- Commit after each task or logical group.
- Verify new tests fail before implementing the behavior they cover.
- Keep Default/Fleet dashboard edits mirrored in the same change.
- No terminal/session lifecycle changes — if a task seems to require one, stop and re-scope.


---

## Validation Notes

- **Unit/integration (T020):** 586/586 pass (
pm run test). Build clean (
pm run build).
- **E2E (T021):** The Playwright/Electron suite is order-dependent and shares .data/ state; it fails ~11/17 at the pre-change baseline (65ef2ff) independent of this feature (see BL-004). Every flow touched by 014 — boot, office-switch (electron-smoke), meeting-fleet, default-office-cold-start — passes in isolation on the feature HEAD. No regression attributable to this change.
- **Manual quickstart (T022):** Requires a human UI pass; covered indirectly by the isolation e2e + unit suites.
