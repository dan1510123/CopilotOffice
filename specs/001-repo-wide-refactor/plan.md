# Implementation Plan: Repository-Wide Refactor Program

**Branch**: `worktree-next-steps-20260603-133614` | **Date**: 2026-06-03 | **Spec**: `specs/001-repo-wide-refactor/spec.md`  
**Input**: Feature specification from `specs/001-repo-wide-refactor/spec.md`

## Summary

Execute a full-repository refactor in bounded slices, allowing replacement of prior design
decisions while preserving current gameplay behavior by default. Any intentional behavior change
is gated on explicit user approval. Delivery order prioritizes high-risk runtime flows first
(scene/input/terminal/session/fleet paths), then supporting domains, with parity checks and
rollback containment per slice.

## Technical Context

**Language/Version**: TypeScript (strict), Node.js runtime for Electron main/PTY services  
**Primary Dependencies**: Phaser 3, Electron 40+, xterm.js, node-pty, ansi-to-html, esbuild  
**Storage**: File-backed local state (for example `.data/copilot-offices.json`) plus in-memory runtime state  
**Testing**: `npm run test` (Vitest), `npm run test:coverage`, `npm run test:e2e` (Playwright), `npm run build`  
**Target Platform**: Desktop application (Windows/macOS/Linux via Electron)  
**Project Type**: Desktop app (Phaser renderer + Electron shell + PTY integration)  
**Performance Goals**: Preserve current interactive responsiveness and frame behavior with no user-visible degradation  
**Constraints**: Behavior parity is mandatory unless explicitly user-approved; no renderer substitution; no hidden cross-layer coupling  
**Reference Implementation Source**: `C:\Users\danielluo\repos\agency-cowork-main` for terminal/PTY lifecycle and preload IPC patterns  
**Scale/Scope**: Repository-wide refactor across `src/`, `electron/`, config/layout/meeting flows, and test surfaces

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Phaser-first constraint respected (no alternate in-canvas renderer introduced)
- [x] Event-driven boundaries preserved (`game.events`/IPC contracts, no hidden cross-layer coupling)
- [x] Input focus transitions routed through `InputManager`
- [x] Session lifecycle integrity maintained for terminal/agent/fleet flows
- [x] Configuration-first approach used for agents/layouts/feature flags
- [x] Regression validation scope defined for touched high-risk flows

## Project Structure

### Documentation (this feature)

```text
specs/001-repo-wide-refactor/
├── plan.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── refactor-slice-contract.md
└── tasks.md              # Created by /speckit.tasks
```

### Source Code (repository root)

```text
src/
├── scenes/
├── entities/
├── ui/
├── input/
├── office/
├── layouts/
├── meeting/
└── config/

electron/
├── main.ts
└── terminal/

tests/
└── e2e/
```

**Structure Decision**: Keep the existing single-project desktop structure and refactor by domain
slice within current directories to minimize migration risk and preserve behavior parity.

## Phase 0: Outline & Research

Research focus:
1. Refactor slicing strategy for bug-heavy codebases while preserving runtime behavior.
2. Behavior parity baselining for interactive desktop game loops and terminal-driven workflows.
3. Approval-gated process for intentional behavior changes during refactor execution.
4. Regression containment/rollback strategy for high-risk session and fleet pathways.
5. Reuse and adapt proven PTY/preload patterns from `agency-cowork-main` where compatible with
   CopilotOffice architecture and constitution constraints.

Output file: `specs/001-repo-wide-refactor/research.md` (all clarifications resolved; no open
NEEDS CLARIFICATION markers).

## Phase 1: Design & Contracts

Design outputs:
1. `data-model.md` defining Refactor Slice, Baseline, Approval Record, and risk tracking entities.
2. `contracts/refactor-slice-contract.md` defining mandatory slice documentation and acceptance contract.
3. `quickstart.md` defining execution order for slice planning, parity checks, approval flow, and release gating.
4. Update agent context markers in `.github/copilot-instructions.md` to point at this plan.

## Post-Design Constitution Re-Check

- [x] Phaser-first invariant maintained in planned scope.
- [x] Event/IPC and input-focus boundaries explicitly preserved in slice acceptance criteria.
- [x] Session lifecycle continuity elevated to P1 parity target.
- [x] Config-first expansion captured as a refactor objective, not hardcoded branching.
- [x] Regression-safe delivery enforced via per-slice parity checks and rollback containment.

## Complexity Tracking

No constitution violations are required by this plan.

## Execution Progress (updated 2026-06-03)

- **Phase 1 (Setup) — complete**: T001–T007. Slice/tracking/baselines/governance directories,
  schema-locked slice template, progress tracker, risk register, approvals log, agency-cowork
  pattern notes, and pre-refactor baseline (`build`=pass, `test`=69/69 pass, `e2e`=env-blocked in
  CLI/headless context) all in place.
- **Phase 2 (Foundational) — complete**: T008–T014. Nine BehaviorBaselines (BL-001…BL-009),
  coverage gap inventory (7 gaps targeted for S2-G), per-slice parity-check mapping,
  100%-coverage surface map, and 12 slice files (S1-A…S1-E, S2-A…S2-G) instantiated.
- **Architectural discovery**: focus contract is gating via `scene.input.keyboard.enabled`, not
  centralized key registration. S1-A acceptance criteria tightened to match the working
  architecture. A full centralization would be `behavior_altering` and require an ApprovalRecord.
- **Phase 3+ — pending**: slice-by-slice execution. Recommended one slice per session for clean
  review/parity boundaries, except S1-C + S1-D which must ship together (shared protocol).

## Session Strategy for Slice Execution

| sequence | slices | session shape |
|----------|--------|---------------|
| 1 | S1-A | one-session-per-slice |
| 2 | S1-B | one-session-per-slice |
| 3 | S1-C + S1-D | paired single session (shared preload/protocol/server change) |
| 4 | S1-E | one-session-per-slice |
| 5 | S2-A, S2-B, S2-C | one-per-session preferred; S2-D + S2-E may batch if light |
| 6 | S2-F | one-session-per-slice |
| 7 | S2-G | one-session-per-slice (coverage close-out) |
| 8 | US3 governance (T069–T075) | one batched session |
| 9 | Polish (T076–T080) | one batched session |

Per-session contract:
1. Open the slice file, set `status: in_progress` in `tracking/progress.md`.
2. Implement only within `scope_in`.
3. Run required `parity_checks` from `baselines/parity-harness.md`.
4. Record `ValidationRun` in the slice file.
5. If parity passes (or approval is recorded for behavior-altering slices), mark slice
   `complete` and the corresponding tasks `[X]` in `tasks.md`.
6. Commit the slice as a single change; end the session.
