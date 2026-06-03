# Slice: S2-B — Layouts (Default + Fleet V-Team)

- **slice_id**: `S2-B` | **domain**: layout | **classification**: parity_preserving | **status**: proposed
- **baseline_id**: BL-004 Office Switching (layout-data portion)
- **scope_in**: `src/layouts/**` (index, types, default, fleet).
- **scope_out**: scene wiring (S1-B), office state (S2-A), UI overlays (S2-C).
- **parity_checks**: `npm run build`, `npm run test`, `npm run test:e2e`; layout-switch smoke.

## Acceptance Criteria

- [ ] Each `OfficeLayout` is a fully data-driven contract.
- [ ] Layout-specific branching is removed from `src/scenes/OfficeScene.ts` where feasible.
- [ ] Arthur position parity preserved across both layouts.

## Dependencies / Rollback

- Depends on: S1-B.
- Rollback: revert `src/layouts/**` to pre-slice commit; scene fallback paths preserved.
