# Slice: S2-A — Office State and Persistence

- **slice_id**: `S2-A` | **domain**: office | **classification**: parity_preserving | **status**: proposed
- **baseline_id**: BL-004 Office Switching
- **scope_in**: `src/office/officeManager.ts`; `.data/copilot-offices.json` persistence schema/round-trip.
- **scope_out**: scene rendering (S1-B), layouts (S2-B), UI dashboards (S2-C).
- **parity_checks**: `npm run build`, `npm run test` (office), `npm run test:e2e`; persistence round-trip smoke.

## Acceptance Criteria

- [ ] `officeManager.ts` is a pure data layer with explicit serialization boundaries (no rendering).
- [ ] Existing `.data/copilot-offices.json` round-trips without migration loss.
- [ ] Per-agent status tracking and add/remove/switch operations covered by Vitest.

## Dependencies / Rollback

- Depends on: S1-B (prefer scene clarification first).
- Rollback: revert `src/office/officeManager.ts`; persistence is read-only on rollback (no schema change).
