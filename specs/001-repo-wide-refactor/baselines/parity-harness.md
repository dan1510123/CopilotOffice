# Parity-Check Harness

Defines the validation surface every slice must run against the impacted baseline(s).

## Command Surface

| command | scope | required for |
|---------|-------|--------------|
| `npm run build` | esbuild compile of game + electron bundles | every slice |
| `npm run test` | full Vitest suite | every slice |
| `npm run test:coverage` | Vitest with coverage delta | T068 (S2-G) and T076 (final) |
| `npm run test:e2e` | Playwright Electron smoke | every slice touching scene/terminal/office; env-blocked outside desktop sessions |

## Per-Baseline Check Mapping

| baseline_id | required automated checks | manual smoke (only if e2e env-blocked) |
|-------------|---------------------------|----------------------------------------|
| BL-001 Player Movement | `tests/unit/entities/Player.test.ts`; e2e smoke | Boot app, WASD around, verify sprint with Shift |
| BL-002 Agent Interaction | `tests/unit/entities/NPC.test.ts`, `tests/integration/main/main.test.ts`; e2e smoke | Approach NPC, press E, confirm terminal opens |
| BL-003 Terminal Lifecycle | `tests/integration/terminal/TerminalOverlay.test.ts`, `SeriousTerminalController.test.ts`; e2e smoke | Open/close terminal with F10 and Escape, verify session persists across detach |
| BL-004 Office Switching | `tests/integration/main/main.test.ts`, `tests/unit/office/officeManager.test.ts`; e2e smoke | Switch offices, verify roster + sessions |
| BL-005 Meeting Mode Entry | _(new) S2-G additions for parser + approval_ | Trigger meeting, approve plan |
| BL-006 Fleet Orchestration | _(new) S2-G additions for orchestrator/tracker_; e2e smoke if possible | Approve fleet plan, observe sub-agents spawn |
| BL-007 Sub-Agent Lifecycle Forwarding | _(new) S2-G dual-key invariant test_; e2e if possible | Open fleet office and confirm sub-agent events still arrive |
| BL-008 Input Focus | `tests/unit/input/*.test.ts`; _(new) overlay focus restore tests_ | Open overlay, close, verify focus returns to game |
| BL-009 Status Badge | _(new) ask_user race test in `tests/integration/main/main.test.ts`_ | Force `ask_user`, verify badge stays in waiting |

## Slice → Required Harness Subset

| slice_id | minimum required | optional extras |
|----------|------------------|-----------------|
| S1-A (input) | `npm run build`, `npm run test` (input + integration); manual focus smoke | `npm run test:e2e` |
| S1-B (scene) | `npm run build`, `npm run test`; `npm run test:e2e` | manual office switch parity smoke |
| S1-C (terminal renderer) | `npm run build`, `npm run test` (terminal integration); `npm run test:e2e` | manual `ask_user` race smoke |
| S1-D (PTY server) | `npm run build`, `npm run test`; `npm run test:e2e` (terminal smoke) | manual fleet session transfer smoke |
| S1-E (meeting/fleet) | `npm run build`, `npm run test` (incl. new parser/approval tests) | `npm run test:e2e` |
| S2-A (office state) | `npm run build`, `npm run test`; `npm run test:e2e` | persistence round-trip smoke |
| S2-B (layouts) | `npm run build`, `npm run test`; `npm run test:e2e` | layout-switch smoke |
| S2-C (UI overlays) | `npm run build`, `npm run test`; manual overlay focus smoke | `npm run test:e2e` |
| S2-D (sprites/entities) | `npm run build`, `npm run test` | animation smoke |
| S2-E (config) | `npm run build`, `npm run test` | n/a |
| S2-F (electron main) | `npm run build`, `npm run test`; `npm run test:e2e` | dev/prod startup smoke |
| S2-G (tests) | `npm run test:coverage` | coverage delta review |

## Pass Criteria

- **Pass**: all required automated checks pass and any required manual smoke is documented.
- **Partial**: automated pass but a manual smoke is deferred — slice may NOT close as `complete`
  until manual smoke is recorded.
- **Fail**: any required check fails — apply rollback strategy or block the slice.

## Recording Results

- Add a row to the slice file's `Validation Runs` table.
- Update `tracking/progress.md` slice-status row with the new state.
- For failed runs, open a `tracking/risks.md` entry if root cause is cross-domain coupling.
