# Slice: S2-D — Sprites and Entities

- **slice_id**: `S2-D` | **domain**: scene | **classification**: parity_preserving | **status**: complete
- **baseline_id**: BL-001 Player Movement (animation parity).
- **scope_in**: `src/sprites/DirectionalSprite.ts` (new `nextWalkAction` reducer); `src/entities/Player.ts` (consumes reducer).
- **scope_out**: scene wiring (S1-B), input (S1-A), config (S2-E), SpriteGenerator (no changes needed — separation already clean).
- **parity_checks**: `npm run build`, `npm run test`; animation smoke.

## Acceptance Criteria

- [X] `SpriteGenerator.ts` and `DirectionalSprite.ts` have clean separation between generation and animation helpers.
      _(Pre-existing separation verified: SpriteGenerator owns DrawCtx +
      procedural generation; DirectionalSprite owns frame indices + anim
      registration + walk-state reducer. No cross-cutting changes needed.)_
- [X] Procedural-only constraint preserved (no external sprite files added).
- [X] Player and NPC entities consume sprite helpers through a single API; no duplicated direction logic.
      _(Extracted `nextWalkAction` pure reducer to DirectionalSprite. Player's
      update loop now delegates the velocity → walk-state branching to the
      reducer; the entity stays focused on physics + intent. NPC's tween-based
      `walkTo` is structurally different (one-shot scripted walk, not
      continuous velocity loop) — kept as-is; no duplication to remove.)_
- [X] 4-direction walk animations remain frame-equivalent (eyeball + existing Vitest pass).
      _(5 new Vitest cases assert reducer output: idle vs. play, direction
      change detection, dominant-axis tie-breaker, sprite-key parameterization.)_

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| S2-D-2026-06-04 | pass | pass (158/158, +5 nextWalkAction vs. 153 baseline) | env-blocked | Pure reducer extracted from Player.update; Player consumes it; existing Player + DirectionalSprite tests still green. |

## Dependencies / Rollback

- Depends on: nothing else in P2.
- Rollback: revert `src/sprites/DirectionalSprite.ts` + `src/entities/Player.ts` to pre-slice commit.
