# Spec 002 — Post-Fix Test Run

**Date**: 2026-06-04
**Branch**: `002-fix-terminal-cold-start`
**Worktree**: `C:\Users\danielluo\repos\CopilotOffice-worktree-next-steps-20260603-133614`

## `npm run test` (vitest)

```
Test Files  31 passed (31)
Tests       187 passed (187)
Duration    ~12s
```

### New tests added (feature 002)

- `tests/integration/terminal/server-cold-start.test.ts` — 4 tests
  - US1 V1: three cold-start opens produce three distinct sessionIds (positive path)
  - US1 V3: persisted duplicate sessionIds repaired on load (first wins)
  - US1 V3: returns false + no warnings when sessionIds are already distinct
  - US1 V3: three-way collisions repaired with two fresh ids
- `tests/integration/terminal/sync-agent-statuses.test.ts` — 7 tests
  - US2 V4: starting + past timeout + alive → recover-to-ready
  - US2 V4: starting + past timeout + not alive → Startup timed out
  - US2 V4: starting + past timeout + alive undefined → Startup timed out
  - US2 V4: starting + within timeout (alive=true) → no-transition
  - US2 V4: starting + within timeout (alive=false) → no-transition
  - US2 V4: non-starting subState past timeout → no-transition
  - US2 V4: starting without activityStartTime → no-transition
- `tests/integration/terminal/TerminalOverlay.test.ts` (extended)
  - US1 V6: routes keystrokes to the freshly-bound agent after show() switches
  - US3 C5: Ctrl+C with non-empty selection writes to clipboard and suppresses SIGINT (rewrite of the prior "uses native copy path" test for the new C5 contract)
- `tests/integration/terminal/SeriousTerminalController.test.ts` (extended)
  - US3 C5: Ctrl+C with non-empty selection writes to clipboard and suppresses SIGINT (parity with TerminalOverlay)

### Existing tests

All 9 pre-existing tests in `TerminalOverlay.test.ts` (Ctrl+V paste, /new command, fullscreen, refresh-focus, etc.) still pass after the show()/onData refactor.

## `npx playwright test default-office-cold-start`

```
Error: Process failed to launch!
```

Pre-existing env limitation — `electron-smoke.e2e.ts` and `meeting-fleet.e2e.ts` produce the same baseline failure on this CLI/headless runner ("Process failed to launch!"). The new `default-office-cold-start.e2e.ts` follows the same convention and uses the same `_electron.launch` API; it will execute on a desktop session with display and clipboard permissions. The `skipIfEnvBlocked()` helper (driven by `CI_E2E_BLOCKED=1`) lets CI opt into a clean skip.

## Build

```
> npm run build
dist\game.bundle.js         7.6mb
dist\electron\terminal\server.js   233.8kb
dist\electron\main.js              19.8kb
... (5 other outputs)
```

Build is clean. No new external dependencies added.

## Files touched

Production (5):
- `electron/terminal/server.ts` — DEBUG_COLD_START gate; V3 repair on load
- `electron/terminal/session-repair.ts` — NEW pure helper for V3 invariant
- `src/scenes/OfficeScene.ts` — preStart iterates full roster + Promise.allSettled + forensic log
- `src/ui/TerminalOverlay.ts` — show() serialize detach→attach; per-show onData closure capture; Ctrl+C clipboard handler; floating Copy button
- `src/ui/SeriousTerminalController.ts` — parity Ctrl+C clipboard handler + floating Copy button
- `src/main.ts` — syncAgentStatuses uses decideStartupTimeoutTransition guard
- `src/util/startupTimeoutGuard.ts` — NEW pure helper

Tests (4 new/extended):
- `tests/integration/terminal/_helpers/coldStartHarness.ts` — NEW
- `tests/integration/terminal/server-cold-start.test.ts` — NEW
- `tests/integration/terminal/sync-agent-statuses.test.ts` — NEW
- `tests/integration/terminal/TerminalOverlay.test.ts` — extended (US1 V6, US3 C5)
- `tests/integration/terminal/SeriousTerminalController.test.ts` — extended (US3 C5)
- `tests/setup/xterm-mock.ts` — onData returns disposable; onSelectionChange added
- `tests/e2e/_helpers/electron-cold-start.ts` — NEW
- `tests/e2e/default-office-cold-start.e2e.ts` — NEW

Docs (1):
- `.github/instructions/electron.instructions.md` — DEBUG_COLD_START + session-repair sections
