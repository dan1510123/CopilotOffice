# Slice: S2-A — Office State and Persistence

- **slice_id**: `S2-A` | **domain**: office | **classification**: parity_preserving | **status**: complete
- **baseline_id**: BL-004 Office Switching
- **scope_in**: `src/office/officeManager.ts`; `src/office/officePersistence.ts` (NEW); `.data/copilot-offices.json` persistence schema/round-trip.
- **scope_out**: scene rendering (S1-B), layouts (S2-B), UI dashboards (S2-C).
- **parity_checks**: `npm run build`, `npm run test` (office), `npm run test:e2e`; persistence round-trip smoke.

## Acceptance Criteria

- [X] `officeManager.ts` is a pure data layer with explicit serialization boundaries (no rendering).
      _(All `window.copilotBridge` calls moved behind `OfficePersistencePort`;
      default `createBridgePersistencePort()` preserves prior behaviour, tests
      inject `createNoopPersistencePort()`.)_
- [X] Existing `.data/copilot-offices.json` round-trips without migration loss.
      _(13 cases in `tests/unit/office/officePersistence.test.ts` cover
      pretty-print, legacy UUID reindexing, missing-layout/seatedAgents
      backfill, `index` field drop, customAgents passthrough, malformed
      seatedAgent filtering, invalid-layout coercion, mismatched
      currentOfficeId fallback, and malformed-JSON tolerance.)_
- [X] Per-agent status tracking and add/remove/switch operations covered by Vitest.
      _(Pre-existing `tests/unit/office/officeManager.test.ts` + new
      persistence tests; all 138 vitest tests pass.)_

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| S2-A-2026-06-04 | pass | pass (138/138, +13 persistence vs. 125 baseline) | env-blocked | Extracted `src/office/officePersistence.ts` (pure serializer/deserializer + `OfficePersistencePort`); `OfficeManager` constructor now takes an optional port, defaulting to `createBridgePersistencePort()`. Schema unchanged; reindex/backfill/passthrough match prior inline `loadFromJson` exactly. |

## Dependencies / Rollback

- Depends on: S1-B (prefer scene clarification first).
- Rollback: revert `src/office/officeManager.ts` + delete `officePersistence.ts`; persistence is read-only on rollback (no schema change).
