# Quickstart: Restore a Previous Session from History

Practical guide for implementing and validating feature 020. Read the repo
instructions first: `.github/instructions/electron.instructions.md` and
`.github/instructions/src-ui.instructions.md`. TypeScript strict is mandatory
(no `any` / unsafe casts).

---

## The one rule that matters most (FR-015)

Wire the new `restore-session` operation across **all six layers in a single
change**. Missing one layer produces a silent no-op — a documented recurring
pitfall in this codebase. The six layers, in order:

1. `electron/terminal/protocol.ts` — `MsgRestoreSession` + union entry
2. `electron/terminal/session-history.ts` — pure `promoteHistoryEntry()`
3. `electron/terminal/server.ts` — `case 'restore-session'` handler
4. `electron/terminal/ipc-relay.ts` — `ipcMain.handle('terminal-restore-session', …)`
5. `electron/terminal/preload.ts` — `restoreSession(...)` + `Window.copilotBridge` type
6. `src/ui/sessionHistoryRender.ts` + `TerminalOverlay.ts` + `SeriousTerminalController.ts`
   + `tests/setup/copilot-bridge-mock.ts`

Full per-layer code is in [`contracts/restore-session.md`](./contracts/restore-session.md).

---

## Suggested implementation order

1. **Pure helper first (TDD-friendly).** Add `promoteHistoryEntry()` to
   `session-history.ts` and unit-test it in isolation (no server import):
   removes exactly one entry, returns it, `undefined` when absent, no
   duplication/reordering of untouched entries (SC-004).

2. **Protocol type.** Add `MsgRestoreSession` and extend the `MainToServer`
   union. `npx tsc --noEmit` should now flag the missing `server.ts` case in the
   message switch — a helpful compile-time reminder.

3. **Server handler.** Implement `case 'restore-session'` following the 10-step
   algorithm in the contract. Reuse `archiveSessionId`, `promoteHistoryEntry`,
   the collision-guard loop (copied from `set-session-id`), the `kill`-handler
   cleanup sequence, and `saveOfficeSessionFile`. Do the reject checks (steps 1–3)
   BEFORE any mutation so a rejected restore is a true no-op.

4. **Relay + preload.** Add the `terminal-restore-session` `ipcMain.handle` and
   the `restoreSession` bridge method + its `Window.copilotBridge` type entry.

5. **Shared renderer.** Extend `createSessionHistoryRow` / `renderSessionHistoryList`
   with `{ onSelect?, readOnly? }`. Attach the row click to `onSelect`; add
   `stopPropagation()` on the id span (FR-007). Keep title via `textContent`.

6. **Both surfaces.** Wire the identical `onSelect` handler (confirm → bridge →
   refresh) into both `toggleSessionHistory()` methods. Gate on each surface's
   read-only state (FR-017). Mid-turn warning via
   `officeManager.getAgentStatus(...)?.subState === 'thinking'` (FR-016).

7. **Test mock.** Add `restoreSession: vi.fn().mockResolvedValue({ success: true,
   sessionId: 'session-1' })` to `copilot-bridge-mock.ts`.

---

## Manual validation (maps to acceptance scenarios)

**Story 1 — switch back (P1):**
1. Start agent session A, start a new session B (A archived).
2. Open history, click A's row → confirmation dialog appears, terminal NOT yet changed.
3. Confirm → agent's current session becomes A; terminal reflects A.
4. Cancel instead → nothing changes (true no-op).
5. Drag-select A's id text → id selectable, NO confirmation appears.

**Story 2 — nothing lost (P1):**
1. Current B, archived A. Restore A → open history: B now listed, A no longer listed.
2. Restore B again → round-trips back to the original mapping.

**Story 3 — parity (P2):**
1. Trigger restore from the TerminalOverlay popover AND from the
   SeriousTerminalController popover → identical prompt + swap outcome.
2. Open a read-only history view → rows are NOT clickable (no swap).

**Edge cases:**
- Mid-turn current session → dialog warns harder but confirm still proceeds.
- Target id already active for another agent → graceful visible error, no change.
- Resume can't rehydrate context → explicit "context may not be restored" advisory.
- Restart the app after a switch → the new current/history mapping persists.

---

## Automated verification

Run all three before claiming done:

```powershell
npm run test
npx tsc --noEmit
npm run build
```

Expected new/updated tests:
- `tests/unit/terminal/…` — `promoteHistoryEntry()` invariants (SC-004, round-trip).
- Renderer/DOM tests (jsdom) — row `onSelect` fires on row click; id-span
  drag/click does NOT fire `onSelect` (FR-007); `readOnly` renders no affordance
  (FR-017); confirm→bridge call happens once, cancel→no bridge call (FR-004/FR-010);
  both surfaces exercised against the shared mock (FR-011).

> **Worktree note (Constitution VII):** `dist/` bundles are per-worktree build
> artifacts. If validating a running app, confirm you launched the rebuilt bundle
> from THIS checkout (matching `dist/` timestamps + a distinctive new symbol like
> `restoreSession` grep) before concluding the fix works.

---

## Gotchas

- **Do not mutate `proc.sessionId` in place instead of restarting the PTY** —
  `set-session-id` does that and the live CLI keeps running the OLD session.
  Restore must kill + relaunch so `copilot --session-id=<target>` actually runs.
- **Reject before mutate.** Any early return (not-in-history, collision) must not
  have archived/promoted/persisted anything (SC-002).
- **Legacy promoted entry (no title)** must CLEAR the current title (neutral
  fallback), not leave the outgoing session's title showing.
- **Never `innerHTML` a title.** Titles stay `textContent` (XSS-safe, FR-010).
- **Keep both surfaces identical.** Divergence between TerminalOverlay and
  SeriousTerminalController is a recurring shipped-regression class here.
