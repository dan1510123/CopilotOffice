# Implementation Plan: Fix Sprite-Card Stacking and Serious-Mode Open-Flow Bugs

**Branch**: `003-fix-sprite-and-serious-bugs` (worktree `CopilotOffice-worktree-next-steps-20260603-133614`) | **Date**: 2026-06-05 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/003-fix-sprite-and-serious-bugs/spec.md`

## Summary

Three correlated bugs span game mode and serious mode, plus a regression-test extension:

1. **Game-mode sprite-card stacking** — `TerminalOverlay.createSpriteCard()` appends a fresh `<div id="sprite-card">` on every scene construction, but Phaser scenes do not call `TerminalOverlay.destroy()` in their `shutdown()` hooks. Every meeting-room enter/leave and every office switch leaves an orphaned `id="sprite-card"` element behind, violating DOM id uniqueness and visually stacking profile cards. Spec FR-001..FR-004 / SC-001.
2. **Serious-mode open-flow silent abort** — `SeriousTerminalController.openAgentTerminal` wraps only the PTY attach phase in `try/catch`. Any throw in the synchronous render phase (`updateSpriteCard`, `updateSessionTitle`, `refitAndResize`, or any DOM/canvas call they reach) escapes the open method silently: no status update, no xterm warning, no attach attempt. Operator clicks an agent card and nothing happens. Spec FR-005..FR-007 / SC-002.
3. **Serious-mode `onData` closes over live `activeAgentId`** — `terminal.onData(...)` in `SeriousTerminalController` reads `this.activeOfficeId` / `this.activeAgentId` live inside the closure. This is the exact bug that spec 002 (V6 / C3) fixed in `TerminalOverlay` by capturing bound ids at registration. Today an early-return guard in the close path masks the bug, but the contract is wrong and a future refactor will reintroduce cross-agent input leak. Spec FR-008..FR-009 / SC-003.

A fourth concern is regression coverage: extend the existing `tests/integration/main/serious-mode.test.ts` (already on this branch) with assertions for #1, #2, and #3, and convert the existing `it.fails` SM-F to a passing test once #2 lands. Spec FR-010 / SC-004 / SC-005.

### Approach

- **Phase A — Sprite-card lifecycle (US1)**: Choose **Option A (minimal)** from the user's framing. Make `TerminalOverlay.createSpriteCard()` idempotent by querying and removing any pre-existing `#sprite-card` before appending. Add `this.terminalOverlay?.destroy()` to `OfficeScene.shutdown()` and `MeetingScene.shutdown()` so the DOM node is removed on scene tear-down rather than relying on Phaser GC. Option B (singleton owned by `main.ts`) is rejected as out-of-scope refactor — see Research R1.
- **Phase B — Serious-mode resilient open (US2)**: Wrap the **entire** body of `SeriousTerminalController.openAgentTerminal` (including `updateSpriteCard`, `updateSessionTitle`, `refitAndResize`, and any other pre-attach sync work) in a top-level `try/catch`. On catch: surface a human-readable error via `this.setStatus(...)`, write a `\r\n[render error: <message>]\r\n` line into the xterm, and STILL attempt `terminalStart` / `terminalAttach` so the operator can recover. Mirror the same defensive `try`-around-render pattern in `closeView` if it also performs unguarded synchronous DOM rendering before its IPC call.
- **Phase C — Bound-at-registration `onData` (US3)**: Apply spec 002's V6 / C3 pattern (already in `src/ui/TerminalOverlay.ts` `registerOnDataHandler(boundAgentId, boundOfficeId)`) verbatim to `SeriousTerminalController`. Re-register per `openAgentTerminal` call with the newly-bound ids. Dispose the previous `onData` disposable before re-registering. The test mock `MockTerminal.onData` already returns `{ dispose: vi.fn() }` from spec 002, so no harness change is required.
- **Phase D — Smoke tests (US4)**: Extend `tests/integration/main/serious-mode.test.ts` with three new test cases — one for sprite-card uniqueness across a full meeting-scene round trip, one for the resilient open flow (forced render throw → status update + attach still called), and one for bound-at-registration `onData` routing. Convert the existing `it.fails` (SM-F) to `it(...)` once Phase B lands. Add a thin regression test in `tests/integration/terminal/SeriousTerminalController.test.ts` for the `onData` capture contract.

## Technical Context

**Language/Version**: TypeScript strict mode, Node 20+ (Electron 40).
**Primary Dependencies**: Electron, Phaser 3, xterm.js (`@xterm/xterm`, `@xterm/addon-fit`), node-pty, Vitest, Playwright.
**Storage**: No persisted state changes. JSON files under `.data/` are read-only references for this feature.
**Testing**: Vitest unit/integration (`npm run test`). No new Playwright suites required — smoke tests live in the renderer integration layer already exercised by spec 002.
**Target Platform**: Electron desktop app on Windows / macOS / Linux. Tests run in jsdom.
**Project Type**: Desktop app (renderer + Electron main + terminal server child process).
**Performance Goals**: No new hot paths. Idempotent sprite-card creation is O(1) per scene construction (one `getElementById` lookup, one optional `remove()`).
**Constraints**: 187 existing Vitest tests on this branch MUST continue to pass (SC-006). No Phaser canvas changes. No IPC contract changes. No terminal server changes. Must not regress spec 002's V1–V7 invariants.
**Scale/Scope**: Fix surface = 4 production files (`TerminalOverlay.ts`, `OfficeScene.ts`, `MeetingScene.ts`, `SeriousTerminalController.ts`) + 2 test files (extended).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Phaser-first constraint respected**: no new in-canvas renderer; all changes are DOM-overlay lifecycle and DOM-controller error-handling. The sprite card is and remains a DOM element layered over the Phaser canvas.
- [x] **Event-driven boundaries preserved**: no new cross-layer coupling. `OfficeScene.shutdown()` and `MeetingScene.shutdown()` already exist as Phaser-owned hooks; calling `terminalOverlay.destroy()` from inside them is the scene owning its DOM child, not a hidden event channel. Existing `game.events` and IPC channels are unchanged.
- [x] **Input focus transitions routed through `InputManager`**: untouched. The `onData` bound-id refactor changes the *payload* of `terminalWrite`, not the focus arbitration path.
- [x] **Session lifecycle integrity maintained**: Phase B's "still attempt PTY attach even on render failure" REINFORCES session integrity — a cosmetic render bug must not also kill the underlying CLI session. Phase C's bound-id capture prevents cross-agent input leak, which is a session integrity invariant lifted directly from spec 002 V6.
- [x] **Configuration-first approach used for agents/layouts/feature flags**: no config schema changes. Agent roster, layouts, mode selection, and feature flags continue to come from `src/config/`.
- [x] **Regression validation scope defined**: Phase D extends the spec-002-era smoke harness with three named assertions (one per US1/US2/US3 invariant) and converts SM-F off `it.fails`. SC-005 requires that an intentional regression in each of the three invariants produces a single named failure — the test names are spelled out in the contracts doc.

No violations to track in Complexity Tracking.

## Project Structure

### Documentation (this feature)

```text
specs/003-fix-sprite-and-serious-bugs/
├── plan.md              # This file
├── spec.md              # Feature spec (already written)
├── research.md          # Phase 0 — option analysis + design template reuse
├── data-model.md        # Phase 1 — DOM lifecycle entities, bound-handler invariants
├── quickstart.md        # Phase 1 — how to repro + verify + run smoke tests
├── contracts/
│   └── ui-contracts.md  # Phase 1 — observational contracts on overlay + serious controller
└── tasks.md             # Phase 2 — created later by /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── scenes/
│   ├── OfficeScene.ts                   # Phase A: shutdown() calls terminalOverlay.destroy()
│   └── MeetingScene.ts                  # Phase A: shutdown() calls terminalOverlay.destroy()
└── ui/
    ├── TerminalOverlay.ts               # Phase A: createSpriteCard() removes any pre-existing #sprite-card
    └── SeriousTerminalController.ts     # Phase B: try/catch around full openAgentTerminal body; Phase C: onData bound-id capture

tests/
└── integration/
    ├── main/
    │   └── serious-mode.test.ts         # Phase D: +3 tests (sprite-card uniqueness, resilient open, bound onData); convert SM-F off it.fails
    └── terminal/
        └── SeriousTerminalController.test.ts  # Phase D: +1 regression test for bound-onData capture
```

**Structure Decision**: Single-project Electron desktop layout already in place from specs 001/002. This feature touches four production files and two test files. No new modules or packages. No `electron/` or `electron/terminal/` changes — terminal server and IPC contracts are read-only references.

## Complexity Tracking

No constitution violations — section intentionally empty.
