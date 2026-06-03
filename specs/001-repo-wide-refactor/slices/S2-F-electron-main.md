# Slice: S2-F — Electron Main Process (Non-Terminal)

- **slice_id**: `S2-F` | **domain**: terminal (electron host) | **classification**: parity_preserving | **status**: proposed
- **baseline_id**: BL-003 (window/hot-reload behavior at startup).
- **scope_in**: `electron/main.ts` window/IPC/hot-reload handlers EXCLUDING terminal lifecycle handlers (those belong to S1-D); `electron/cli-bridge.ts`.
- **scope_out**: terminal lifecycle (S1-D), preload/protocol/server (S1-D).
- **parity_checks**: `npm run build`, `npm run test`, `npm run test:e2e`; manual `npm run dev` + `npm start` startup smoke.

## Acceptance Criteria

- [ ] IPC handler registration colocated with their renderer consumers via the preload bridge.
- [ ] `window.copilotBridge` shape unchanged.
- [ ] Dev/prod startup parity verified via `npm run dev` and `npm start`.

## Dependencies / Rollback

- Depends on: S1-D (must land first to avoid double-touch on `electron/main.ts`).
- Rollback: revert non-terminal sections of `electron/main.ts` and `electron/cli-bridge.ts`.
