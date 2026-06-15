# Slice: S2-E — Configuration Surface

- **slice_id**: `S2-E` | **domain**: config | **classification**: parity_preserving | **status**: complete
- **baseline_id**: BL-002 (agent roster), BL-009 (notifications/status); cross-cutting.
- **scope_in**: `src/config/agents.ts` (new id constants + plan id list); `src/config/zIndex.ts` (added in S2-C, additional callers in S2-E); consumer migrations in `src/main.ts`, `src/meeting/planParser.ts`, `src/layouts/fleet/FleetDashboard.ts`, `src/layouts/fleet/FleetClickHandler.ts`, `src/ui/TerminalOverlay.ts`.
- **scope_out**: consumers (touched only to migrate from hardcoded constants).
- **parity_checks**: `npm run build`, `npm run test`.

## Acceptance Criteria

- [X] Audit identifies any consumer reading constants that should live in config; consumers migrated to read from config (constitution config-first rule).
      _(Audited `'architect'`/`'admin'`/`'generalist'`/`'debugger'` literals
      across `src/`. Added `GENERALIST_AGENT_ID`, `DEBUGGER_AGENT_ID`,
      `ADMIN_AGENT_ID`, and `DEFAULT_PLAN_AGENT_IDS` to `src/config/agents.ts`
      so all consumers read from a single source. Migrated 7 sites:
      `main.ts` x2 (transferSession), `planParser.ts` (default valid ids),
      `FleetDashboard.ts` (isArthur check), `FleetClickHandler.ts` (architect
      gate), `TerminalOverlay.ts` (inception-mode admin check), and
      `CORE_AGENT_IDS` constructor.)_
- [X] `Depths.*` usage consistent across scenes; `ySortDepth()` used for y-sorted objects.
      _(Audited all `setDepth(` call sites in `src/`. Every call uses either
      a `Depths.*` constant or `ySortDepth()`. No regressions; no migrations
      needed.)_
- [X] Existing Vitest config tests continue to pass.

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| S2-E-2026-06-04 | pass | pass (162/162, +4 agent-id constants vs. 158 baseline) | env-blocked | Pure literal-to-constant migration; no behavior change. |

## Dependencies / Rollback

- Depends on: nothing.
- Rollback: revert `src/config/agents.ts` and 7 consumer touch-ups to pre-slice commit.
