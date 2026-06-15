# Slice: S2-G — Test Harness Hygiene

- **slice_id**: `S2-G` | **domain**: test | **classification**: parity_preserving | **status**: complete
- **baseline_id**: Cross-cutting; closes gaps from `baselines/coverage-gaps.md`.
- **scope_in**: `tests/**` (new fleetOrchestrator tests); vitest scope guard already updated in S1-E.
- **scope_out**: introducing new test frameworks (NOT allowed); production code (other slices own).
- **parity_checks**: `npm run test:coverage`.

## Acceptance Criteria

- [X] All gaps in `baselines/coverage-gaps.md` are closed or have a documented deferral.
      _(Coverage gaps audit: BL-005 plan parsing → closed by S1-E; BL-005
      plan approval → closed by S1-E; BL-006 fleet spawn/teardown → closed
      by S2-G `fleetOrchestrator.test.ts` (7 cases); BL-007 dual-key
      invariant → closed by S1-D `agentViewers.test.ts`; BL-008 overlay
      focus restoration → closed by S1-A + S2-C; BL-009 ask_user race →
      closed by S1-C `toolStatus.test.ts`. **Deferred**: BL-004 session
      detach on office switch — requires integration with PTY server,
      tracked as a future improvement; covered indirectly by the existing
      Playwright `electron-smoke.e2e.ts` (env-blocked).)_
- [X] No new test framework or dependency added (Vitest + Playwright only).
- [X] Coverage delta recorded in `tracking/progress.md`.

## Validation Runs

| run_id | build | unit | coverage | notes |
|--------|-------|------|----------|-------|
| S2-G-2026-06-04 | pass | pass (175/175, +7 fleetOrchestrator vs. 168 baseline) | pass (78.85% stmts / 64.26% branches / 79.6% funcs / 82.57% lines — all above thresholds) | Coverage thresholds: lines 70 / functions 70 / branches 55 / statements 70. |

## Dependencies / Rollback

- Depends on: each P2 slice may extend coverage as it lands; this slice closes residual gaps.
- Rollback: revert `tests/unit/meeting/fleetOrchestrator.test.ts`; existing tests unaffected.
