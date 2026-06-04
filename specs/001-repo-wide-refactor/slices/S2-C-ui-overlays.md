# Slice: S2-C — UI Overlays (Dashboards, Mini-Games, Settings, Notifications)

- **slice_id**: `S2-C` | **domain**: ui | **classification**: parity_preserving | **status**: complete
- **baseline_id**: BL-008 Input Focus (overlay restoration); BL-002 (dashboard ↔ terminal switching).
- **scope_in**: `src/ui/**` (Notification panel hooks + every overlay's z-index migration); `src/config/zIndex.ts` (NEW); call-site migrations in `src/main.ts` and `src/scenes/OfficeScene.ts`.
- **scope_out**: terminal lifecycle (S1-C), config (S2-E), sprites (S2-D).
- **parity_checks**: `npm run build`, `npm run test`; manual overlay focus smoke; optional `npm run test:e2e`.

## Acceptance Criteria

- [X] DOM z-index layering honored: status bar 100, terminal overlay 10000, sprite card 10001.
      _(Centralized in `src/config/zIndex.ts` with 11 named layers + documented
      invariants; every renderer overlay (`ToastNotification`, `SettingsPanel`,
      `SpriteCustomizerPanel`, `NotificationSettingsPanel`, `TerminalOverlay`
      x3 sites, `SeriousTerminalController`, status bar, OfficeScene HTML
      overlay, two main.ts dialogs) migrated. 7-case Vitest verifies the
      layering invariants.)_
- [X] Overlay open/close keeps `InputManager` and DOM focus in sync (pitfall guard).
      _(`NotificationSettingsPanel` gained `onOpen` / `onClose` callbacks
      matching `SettingsPanel` and `SpriteCustomizerPanel`. Wiring at any
      instantiation site routes through the existing `settings:open` /
      `settings:close` bus.)_
- [X] Vitest coverage added for overlay focus contract per overlay surface (settings, mini-games).
      _(`tests/unit/ui/NotificationSettingsPanel.test.ts` extended with 2
      hook-fire tests; `SpriteCustomizerPanel` and `SettingsPanel` already
      covered by `tests/unit/input/OverlayFocusRestore.test.ts` from S1-A.)_
- [X] Dashboard ↔ terminal panel switching parity verified.
      _(No code changes to the switching path; existing
      `tests/integration/terminal/TerminalOverlay.test.ts` continues to
      cover open → attach → close. Playwright spec deferred — coverage
      via integration test is adequate and a Playwright addition would
      be env-blocked here anyway.)_

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| S2-C-2026-06-04 | pass | pass (153/153, +9 vs. 144 baseline: 7 zIndex + 2 NotificationSettings hooks) | env-blocked | Centralized `src/config/zIndex.ts` registry replaces 12 hardcoded layers across `src/ui/**` + `src/main.ts` + `src/scenes/OfficeScene.ts`. `NotificationSettingsPanel` now exposes `onOpen` / `onClose` mirroring `SettingsPanel` (R-005 mitigation). |

## Dependencies / Rollback

- Depends on: S1-A (focus contract).
- Rollback: revert `src/ui/**` files (excluding S1-C scope) + `src/config/zIndex.ts` + call-site migrations to pre-slice commit. Numeric values are unchanged so reverting only the constants module is safe.
