# Slice: S2-G — Test Harness Hygiene

- **slice_id**: `S2-G` | **domain**: test | **classification**: parity_preserving | **status**: proposed
- **baseline_id**: Cross-cutting; closes gaps from `baselines/coverage-gaps.md`.
- **scope_in**: `tests/**` (factories, setup, unit, integration, e2e); `vitest.config.ts` / `playwright.config.ts` only if minimal config tweaks are required.
- **scope_out**: introducing new test frameworks (NOT allowed); production code (other slices own).
- **parity_checks**: `npm run test:coverage`.

## Acceptance Criteria

- [ ] All gaps in `baselines/coverage-gaps.md` are closed or have a documented deferral.
- [ ] No new test framework or dependency added (Vitest + Playwright only).
- [ ] Coverage delta recorded in `tracking/progress.md`.

## Dependencies / Rollback

- Depends on: each P2 slice may extend coverage as it lands; this slice closes residual gaps.
- Rollback: revert added test files; existing tests unaffected.
