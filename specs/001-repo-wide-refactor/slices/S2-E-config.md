# Slice: S2-E — Configuration Surface

- **slice_id**: `S2-E` | **domain**: config | **classification**: parity_preserving | **status**: proposed
- **baseline_id**: BL-002 (agent roster), BL-009 (notifications/status); cross-cutting.
- **scope_in**: `src/config/**` (agents, depths, meetingPrompt, notifications, playerCustomization, responsiveLayout).
- **scope_out**: consumers (touched only to migrate from hardcoded constants).
- **parity_checks**: `npm run build`, `npm run test`.

## Acceptance Criteria

- [ ] Audit identifies any consumer reading constants that should live in config; consumers migrated to read from config (constitution config-first rule).
- [ ] `Depths.*` usage consistent across scenes; `ySortDepth()` used for y-sorted objects.
- [ ] Existing Vitest config tests continue to pass.

## Dependencies / Rollback

- Depends on: nothing.
- Rollback: revert `src/config/**` and any consumer touch-ups to pre-slice commit.
