# Test Coverage Gaps

Cross-references existing tests against `baselines/critical-flows.md`. A "gap" means a baseline
has no automated coverage, partial coverage, or coverage that does not exercise the documented
observable behavior end-to-end.

## Existing Coverage Inventory

| baseline_id | covering tests | depth |
|-------------|----------------|-------|
| BL-001 Player Movement | `tests/unit/entities/Player.test.ts` | unit-only; no integration with input |
| BL-002 Agent Interaction | `tests/unit/entities/NPC.test.ts`, `tests/integration/main/main.test.ts` (bootstrap/wiring) | unit + integration of wiring, not the E-key → terminal contract |
| BL-003 Terminal Lifecycle | `tests/integration/terminal/TerminalOverlay.test.ts`, `tests/integration/terminal/SeriousTerminalController.test.ts` | strong integration; e2e relies on `tests/e2e/electron-smoke.e2e.ts` |
| BL-004 Office Switching | `tests/integration/main/main.test.ts` (creates/switches office), `tests/unit/office/officeManager.test.ts` | integration covers happy path; no parity check for session-detach-on-switch |
| BL-005 Meeting Mode Entry | _(none direct)_ | gap — no automated coverage of plan parsing or approval flow |
| BL-006 Fleet Orchestration | _(none direct)_ | gap — no test for spawn/teardown or visualizer |
| BL-007 Sub-Agent Lifecycle Forwarding | _(none direct)_ | gap — dual-key invariant is only documented, not tested |
| BL-008 Input Focus | `tests/unit/input/InputManager.test.ts`, `GlobalInputListener.test.ts`, `TerminalInputListener.test.ts` | unit-only; no integration around overlay focus save/restore |
| BL-009 Status Badge | _(indirect via `main.test.ts` preload-ready routing)_ | gap — no test for `ask_user` race or full state-machine traversal |

## Identified Gaps (target for S2-G test hygiene slice)

1. **BL-005 meeting plan parsing** — add Vitest coverage for `src/meeting/planParser.ts` happy
   path and malformed-plan cases.
2. **BL-005 plan approval UI** — add Vitest coverage for `planApproval.ts` accept/reject paths.
3. **BL-006 fleet spawn/teardown** — add Vitest coverage for `fleetOrchestrator.ts` and
   `fleetTracker.ts` state transitions.
4. **BL-007 dual-key invariant** — add Vitest coverage (or e2e if necessary) verifying that
   sub-agent lifecycle events still flow after session transfer to a fleet office.
5. **BL-008 overlay focus restoration** — add Vitest coverage for: terminal open/close,
   settings panel open/close, mini-game open/close — verifying `InputManager` save/restore.
6. **BL-009 ask_user race** — add Vitest coverage in `tests/integration/main/main.test.ts` (or a
   sibling) that simulates `ask_user` and another tool completion in the same tick and asserts
   the badge stays in `waiting`.
7. **BL-004 session detach on office switch** — add an integration test that switches offices
   and verifies the prior office's session is detached (not killed) and reattaches cleanly.

## E2E Status

- `tests/e2e/electron-smoke.e2e.ts` covers boot + office create/switch. In CI/local desktop
  sessions it should pass; in the current CLI/headless environment it is environment-blocked
  (`Process failed to launch!`). Document as known environment limitation; do not treat as a
  code regression.
