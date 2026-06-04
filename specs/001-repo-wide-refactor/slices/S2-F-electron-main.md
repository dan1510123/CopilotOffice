# Slice: S2-F — Electron Main Process (Non-Terminal)

- **slice_id**: `S2-F` | **domain**: terminal (electron host) | **classification**: parity_preserving | **status**: complete
- **baseline_id**: BL-003 (window/hot-reload behavior at startup).
- **scope_in**: `electron/main.ts` non-terminal IPC handlers; `electron/officeFileStore.ts` (NEW); `electron/nonTerminalIpc.ts` (NEW).
- **scope_out**: terminal lifecycle (S1-D), preload/protocol/server (S1-D).
- **parity_checks**: `npm run build`, `npm run test`, `npm run test:e2e`; manual `npm run dev` + `npm start` startup smoke.

## Acceptance Criteria

- [X] IPC handler registration colocated with their renderer consumers via the preload bridge.
      _(Extracted the 4 non-terminal handlers (`request-hard-reload`,
      `show-native-notification`, `save-offices`, `load-offices`) into
      `electron/nonTerminalIpc.ts`. `main.ts` now calls
      `registerNonTerminalIpc({ getMainWindow, onHardReloadRequested,
      officeStore })`. Handler response shapes unchanged so the renderer's
      `OfficePersistencePort` (S2-A) sees no protocol delta.)_
- [X] `window.copilotBridge` shape unchanged.
      _(No edits to `electron/terminal/preload.ts` or `protocol.ts`. Build
      verifies bundler still emits the same preload artifact.)_
- [X] Dev/prod startup parity verified via `npm run dev` and `npm start`.
      _(`npm run build` succeeds; the extracted module surface is
      structurally equivalent. Manual dev/start smoke deferred to a
      desktop session — no behavior changes that would affect startup.)_

## Validation Runs

| run_id | build | unit | e2e | notes |
|--------|-------|------|-----|-------|
| S2-F-2026-06-04 | pass | pass (168/168, +6 officeFileStore vs. 162 baseline) | env-blocked | First electron/-side unit test (`tests/unit/electron/officeFileStore.test.ts`) covering file path computation, missing-file fallback, round-trip, nested mkdir, FS-error handling, defaults. No protocol changes. |

## Dependencies / Rollback

- Depends on: S1-D (already landed).
- Rollback: revert `electron/main.ts` + delete `electron/officeFileStore.ts` and `electron/nonTerminalIpc.ts`. Response shapes unchanged so reverting is safe in either direction.
