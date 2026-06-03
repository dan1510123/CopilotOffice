# Slice: S2-C — UI Overlays (Dashboards, Mini-Games, Settings, Notifications)

- **slice_id**: `S2-C` | **domain**: ui | **classification**: parity_preserving | **status**: proposed
- **baseline_id**: BL-008 Input Focus (overlay restoration); BL-002 (dashboard ↔ terminal switching).
- **scope_in**: `src/ui/**` EXCLUDING `TerminalOverlay.ts` and `SeriousTerminalController.ts`
  (those belong to S1-C).
- **scope_out**: terminal lifecycle (S1-C), config (S2-E), sprites (S2-D).
- **parity_checks**: `npm run build`, `npm run test`; manual overlay focus smoke; optional `npm run test:e2e`.

## Acceptance Criteria

- [ ] DOM z-index layering honored: status bar 100, terminal overlay 10000, sprite card 10001.
- [ ] Overlay open/close keeps `InputManager` and DOM focus in sync (pitfall guard).
- [ ] Vitest coverage added for overlay focus contract per overlay surface (settings, mini-games).
- [ ] Dashboard ↔ terminal panel switching parity verified.

## Dependencies / Rollback

- Depends on: S1-A (focus contract).
- Rollback: revert `src/ui/**` files (excluding S1-C scope) to pre-slice commit.
