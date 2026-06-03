# Slice: S2-D — Sprites and Entities

- **slice_id**: `S2-D` | **domain**: scene | **classification**: parity_preserving | **status**: proposed
- **baseline_id**: BL-001 Player Movement (animation parity).
- **scope_in**: `src/sprites/**`, `src/entities/**`.
- **scope_out**: scene wiring (S1-B), input (S1-A), config (S2-E).
- **parity_checks**: `npm run build`, `npm run test`; animation smoke.

## Acceptance Criteria

- [ ] `SpriteGenerator.ts` and `DirectionalSprite.ts` have clean separation between generation and animation helpers.
- [ ] Procedural-only constraint preserved (no external sprite files added).
- [ ] Player and NPC entities consume sprite helpers through a single API; no duplicated direction logic.
- [ ] 4-direction walk animations remain frame-equivalent (eyeball + existing Vitest pass).

## Dependencies / Rollback

- Depends on: nothing else in P2.
- Rollback: revert `src/sprites/**` and `src/entities/**` to pre-slice commit.
