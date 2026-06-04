# Refactor Program — Progress Tracker

Seeded from `data-model.md` lifecycle states. Update as slices move through phases.

## Architectural Discovery Log

- **2026-06-03 S1-A scoping**: audited `src/scenes/**`, `src/entities/**`, `src/ui/**` for direct
  Phaser keyboard usage. Found that the actual focus contract is **gating via
  `scene.input.keyboard.enabled`**, not centralized key registration. The pitfall note in
  `.github/copilot-instructions.md` ("never manipulate Phaser keyboard directly") was interpreted
  as banning all key registrations outside `src/input/**`, but the working architecture allows
  consumers (Player, OfficeScene E/F, mini-games ESC/SPACE, DialogBox) to register their own keys
  against the shared gated keyboard. Updated `slices/S1-A-input-focus.md` acceptance criteria to
  match. A wholesale centralization would be `behavior_altering` and require an ApprovalRecord —
  it is NOT proposed by default.
- **2026-06-03 cowork pattern #5 adoption**: post-S1-C+S1-D follow-up adopted
  `agency-cowork-notes.md` pattern #5 (structured lifecycle telemetry) without breaking
  existing behavior. Added `src/util/lifecycleLog.ts` with subscriber registry and
  greppable `[lifecycle] agent=… office=… from→to reason=… detail=…` log lines; wired
  emission into every `OfficeManager.setAgent*` mutation. Reason strings (`ask_user`,
  `ask_user_race_guard`, `tool_start`, `tool_complete`, `turn_end`, `preload_ready`,
  `preload_failed`, `session_closed`) are passed at the high-signal call sites in
  `src/main.ts`. Existing ad-hoc `[Office] Status: …` logs left intact. Additive
  only — no signature breakage; all new params optional. Covered by 6 new tests in
  `tests/unit/util/lifecycleLog.test.ts` (subscriber fan-out, self-transition
  suppression, error isolation, integration with `OfficeManager.setAgent*`).

## Slice Status Table

| slice_id | name | domain | classification | status | notes |
|----------|------|--------|----------------|--------|-------|
| S1-A | Input Focus and Keyboard Routing | input | parity_preserving | complete | Phase 3 P1; build+test pass 74/74 (2026-06-03), e2e env-blocked, +5 overlay save/restore tests |
| S1-B | Scene Lifecycle and Office Switching | scene | parity_preserving | complete | Phase 3 P1; build+test pass 74/74 (2026-06-03), e2e env-blocked; removed all hardcoded agent IDs from scenes via `ARCHITECT_AGENT_ID` constant |
| S1-C | Terminal/Session Lifecycle (Renderer Side) | terminal | parity_preserving | complete | Phase 3 P1; paired with S1-D; build+test pass 94/94 (2026-06-03), e2e env-blocked; extracted `src/util/toolStatus.ts` (ask_user race-guard reducer) + 11 new unit tests; verified existing TerminalOverlay/SeriousTerminalController encapsulate renderer terminal lifecycle |
| S1-D | PTY Server and Preload Bridge (Electron Side) | terminal | parity_preserving | complete | Phase 3 P1; paired with S1-C; build+test pass 94/94 (2026-06-03), e2e env-blocked; extracted `electron/terminal/agent-viewers.ts` documenting the dual-key invariant + 9 new unit tests; confirmed `isFleetCriticalEvent` branch in server.ts forwards subagent.* / system.notification / task tool-start regardless of viewers; preload contract + `window.copilotBridge` shape unchanged |
| S1-E | Meeting Mode and Fleet Orchestration | meeting | parity_preserving | complete | Phase 3 P1; build+test pass 125/125 (2026-06-03), e2e env-blocked; documented spawn→track→visualize→teardown contract in `fleetOrchestrator.ts`/`fleetTracker.ts`/`fleetVisualizer.ts`; added 18 planParser + 7 planApproval Vitest cases; preserved FleetTracker silent attach as defense in depth alongside S1-D's server-side dual-key invariant; authored `tests/e2e/meeting-fleet.e2e.ts` Playwright spec (env-blocked); extended vitest meeting-scope-guard to allow `tests/{unit,integration}/meeting/**` |
| S2-A | Office State and Persistence | office | parity_preserving | complete | Phase 4 P2; build+test pass 138/138 (2026-06-04), e2e env-blocked; extracted `src/office/officePersistence.ts` (pure serializer + `OfficePersistencePort`); OfficeManager constructor now port-injectable; schema unchanged; +13 round-trip tests |
| S2-B | Layouts (Default + Fleet V-Team) | layout | parity_preserving | complete | Phase 4 P2; build+test pass 144/144 (2026-06-04), e2e env-blocked; added `LayoutBehaviors` capability flags + migrated 3 scene branches; +6 layout tests |
| S2-C | UI Overlays (Terminal Panel, Dashboards, Mini-Games) | ui | parity_preserving | complete | Phase 4 P2; build+test pass 153/153 (2026-06-04), e2e env-blocked; centralized `src/config/zIndex.ts` registry (11 layers, 12 migrated sites); NotificationSettingsPanel gained onOpen/onClose hooks; R-005 mitigation; +9 tests (7 zIndex + 2 hooks) |
| S2-D | Sprites and Entities | scene | parity_preserving | complete | Phase 4 P2; build+test pass 158/158 (2026-06-04), e2e env-blocked; extracted `nextWalkAction` pure reducer; Player consumes it; NPC tween-walk left as-is (no duplication); +5 reducer tests |
| S2-E | Configuration Surface | config | parity_preserving | proposed | Phase 4 P2 |
| S2-F | Electron Main Process (Non-Terminal) | terminal | parity_preserving | proposed | Phase 4 P2 |
| S2-G | Test Harness Hygiene | test | parity_preserving | proposed | Phase 4 P2 |

## Lifecycle States (from data-model.md)

`proposed -> planned -> in_progress -> complete`
`in_progress -> blocked -> in_progress`
`in_progress -> rolled_back`

Guard conditions:
- `complete` for parity_preserving requires parity pass.
- `complete` for behavior_altering requires `approved` ApprovalRecord.

## Baseline

> Populated by T006: results of `npm run build`, `npm run test`, and `npm run test:e2e` against the
> pre-refactor codebase. Date and exit codes will be recorded here once captured.

| command | result | date | notes |
|---------|--------|------|-------|
| `npm run build` | pass | 2026-06-03 | game bundle 7.6mb, electron outputs generated |
| `npm run test` | pass | 2026-06-03 | 18 files / 69 tests passed in ~6.3s |
| `npm run test:e2e` | env-blocked | 2026-06-03 | `Process failed to launch!` on Electron — environment-level restriction in current CLI/headless context, not a code regression. Re-run locally on a normal desktop session. |

## Final Validation

> Populated by T076 after all slices complete.

| command | result | date | notes |
|---------|--------|------|-------|
| `npm run build` | pending | — | — |
| `npm run test` | pending | — | — |
| `npm run test:coverage` | pending | — | — |
| `npm run test:e2e` | pending | — | — |
