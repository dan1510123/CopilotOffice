---
description: "Task list for feature 020 — Restore a Previous Session from History"
---

# Tasks: Restore a Previous Session from History

**Input**: Design documents from `/specs/020-session-history-restore/`
**Prerequisites**: plan.md ✅, spec.md ✅, research.md ✅, data-model.md ✅, contracts/restore-session.md ✅, quickstart.md ✅

**Tests**: INCLUDED. The spec's Regression Plan and quickstart explicitly require unit tests for
`promoteHistoryEntry()` and renderer `onSelect`/read-only wiring, validated with `npm run test` +
`npx tsc --noEmit` + `npm run build`.

**Organization**: Tasks are grouped by user story (from spec.md) to enable independent
implementation and testing. The new `restore-session` operation MUST be wired across all six
layers in one change (FR-015) — the vertical slice lands in User Story 1.

## Constitution-Driven Task Requirements

- **Session lifecycle touched** → regression tasks validate archive/promote/round-trip/collision/restart durability (T017, T018, T020, T021, T027).
- **Renderer behavior changes** → Phaser-first boundary preserved: affordance lives in existing DOM overlays only; no Phaser scene/sprite added (verified in T028).
- **No new input paths** → confirmation is a scoped `confirm(...)` dialog; no new global key handling, no `InputManager` change.
- **Configuration-first** → new op added to the typed message protocol (no ad hoc channel); persisted `{ current, history, metadata }` shape unchanged.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3 (maps to spec.md user stories). Setup/Foundational/Polish carry no story label.
- Exact file paths are included in every task.

## Path Conventions

Established Electron-desktop layout: Electron main/PTY-server under `electron/terminal/`,
renderer/DOM UI under `src/ui/`, Vitest suites under `tests/`. No new top-level directories.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Confirm the working tree and baseline build/test state before touching cross-layer code.

- [X] T001 Confirm you are on branch `020-session-history-restore` and the tree builds/tests green as a baseline: run `npm run test`, `npx tsc --noEmit`, and `npm run build` at repo root and record the pre-change baseline (worktree note in quickstart.md — verify `dist/` belongs to THIS checkout).
- [X] T002 Re-read the repo contribution rules referenced by quickstart.md: `.github/instructions/electron.instructions.md` and `.github/instructions/src-ui.instructions.md` (TypeScript strict; no `any`/unsafe casts; Phaser-first; all renderer↔main traffic through `preload.ts`).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The protocol type, the pure state-transition helper, and the shared test mock that ALL
user stories depend on. Per FR-015 the protocol type is the compile-time anchor that forces every
other layer to be wired.

**⚠️ CRITICAL**: No user-story wiring (server handler, relay, preload, renderer) can compile until the protocol message and helper exist.

- [X] T003 [P] Add pure helper `promoteHistoryEntry(history: SessionHistoryEntry[], sessionId: string): SessionHistoryEntry | undefined` to `electron/terminal/session-history.ts` — `findIndex(e => e.id === sessionId)`, `splice(idx, 1)[0]`, return `undefined` when absent; mutating, no `server.ts` import (mirrors `pushArchivedEntry`). Ref: contracts/restore-session.md §3, research.md R-004.
- [X] T004 [P] Add unit tests for `promoteHistoryEntry` in `tests/unit/terminal/sessionHistoryPromote.test.ts`: removes exactly ONE matching entry and returns it; returns `undefined` and leaves `history` untouched when the id is absent; all other entries keep their order/number/title/id; exact-string-equality matching (no normalization). Ref: data-model.md Invariants (SC-004), quickstart.md automated verification.
- [X] T005 Add `MsgRestoreSession { type: 'restore-session'; requestId; officeId; agentId; sessionId }` interface to `electron/terminal/protocol.ts` and extend the `MainToServer` discriminated union with `| MsgRestoreSession` (adjacent to `MsgSetSessionId`/`MsgResetSession`). Also add the exported `RestoreSessionResult` response type: `{ success: true; sessionId: string; resumeContextUncertain?: boolean } | { success: false; error: string }`. No `ServerToMain` change. Ref: contracts/restore-session.md §1, data-model.md.
- [X] T006 [P] Add `restoreSession` mock to the shared test bridge in `tests/setup/copilot-bridge-mock.ts`: `restoreSession: vi.fn().mockResolvedValue({ success: true, sessionId: 'session-1' })` (next to `setSessionId`/`resetSession`). Without this, every renderer test that touches the bridge fails to type-check — the silent-no-op class FR-015 guards. Ref: contracts/restore-session.md §8.

**Checkpoint**: `npx tsc --noEmit` now flags the missing `case 'restore-session'` in the `server.ts` message switch — a helpful compile-time reminder (quickstart step 2). Helper unit tests (T004) pass. User-story work can begin.

---

## Phase 3: User Story 1 - Switch back to a previous session (Priority: P1) 🎯 MVP

**Goal**: Turn a read-only history row into a navigational control — operator clicks a past session,
confirms, and the agent's active session switches to that session (best-effort resume with an
explicit "context may not be restored" advisory when rehydration is uncertain).

**Independent Test**: Start agent session A, start a new session B (A archived), open the history
list, click A's entry, confirm the dialog, and verify the agent's current session becomes A. Cancel
leaves everything unchanged; drag-selecting A's id text does NOT trigger the dialog.

### Implementation for User Story 1

- [X] T007 [US1] Implement `case 'restore-session'` handler in `electron/terminal/server.ts` following the 10-step algorithm in contracts/restore-session.md §2. **Reject-before-mutate** order: (1) target not in `sessionHistory[agentId]` → `{ success:false, error:'target session not in history' }`; (2) target === current `sessionIds[agentId]` → no-op `{ success:true, sessionId:target }`; (3) collision guard reusing the `set-session-id` loop → `{ success:false, error:'…already in use by another agent…' }`. Normalize target with the same `.trim().toLowerCase()` as set-session-id.
- [X] T008 [US1] In the same `server.ts` handler, implement the mutate path AFTER the guards: `archiveSessionId(officeId, agentId)` (title-before-clear, dedupe — 019) → `const promoted = promoteHistoryEntry(history, target)` → `sessionIds.set(agentId, target)` → restore title into `sessionMeta` (`promoted?.title ?? ''`; empty title deletes the meta entry — legacy no-title clears) and emit `session-meta-updated`. Ref: contracts §2 steps 4–7, research.md R-003/R-011.
- [X] T009 [US1] In the same handler, kill + restart the PTY so it relaunches `copilot --session-id=<target>`: reuse the `kill` handler cleanup sequence (`killPtyProcess`, `ptyProcesses.delete`, `agentToTerminal.delete`, `clearForegroundIf`, watcher/ready/turn cleanup) so the normal `start` path relaunches the promoted id — do NOT mutate `proc.sessionId` in place (that keeps the OLD session running). Compute `resumeContextUncertain` (best-effort; FR-013). Then `await saveOfficeSessionFile(officeId)` and respond `{ success:true, sessionId:target, resumeContextUncertain }`. Ref: contracts §2 steps 8–10, research.md R-001/R-002, quickstart Gotchas.
- [X] T010 [US1] Add IPC relay handler in `electron/terminal/ipc-relay.ts` (`registerIpc()`): `ipcMain.handle('terminal-restore-session', (_event, officeId, agentId, sessionId) => this.request({ type:'restore-session', requestId: this.id(), officeId, agentId, sessionId }))`, placed alongside the `set-session-id`/`terminal-reset-session` handlers. Ref: contracts §4.
- [X] T011 [US1] Add the `restoreSession(officeId, agentId, sessionId)` bridge method in `electron/terminal/preload.ts` (next to `setSessionId`/`resetSession`) delegating to `ipcRenderer.invoke('terminal-restore-session', …)`, AND add the matching `restoreSession` signature to the `Window.copilotBridge` type block (~line 472), returning `Promise<{ success: boolean; sessionId?: string; resumeContextUncertain?: boolean; error?: string }>`. Ref: contracts §5.
- [X] T012 [US1] Extend the shared renderer in `src/ui/sessionHistoryRender.ts`: add `SessionHistoryRowOptions { onSelect?: (entry) => void; readOnly?: boolean }` and thread it through `createSessionHistoryRow(entry, displayNumber, options?)` and `renderSessionHistoryList(entries, options?)`. When `onSelect` is set AND `!readOnly`: attach a row click handler calling `onSelect(entry)` + add a pointer/hover affordance. Ref: contracts §6, research.md R-008/R-009.
- [X] T013 [US1] In `src/ui/sessionHistoryRender.ts`, isolate the copyable id: on the `user-select: all` id span call `e.stopPropagation()` for BOTH `mousedown` and `click` so selecting/copying the id never fires `onSelect` (FR-007/FR-012). Keep the title rendered via `textContent` only (never `innerHTML`) — XSS-safe (FR-010). Ref: contracts §6, quickstart Gotchas.
- [X] T014 [US1] Wire the `onSelect` handler into `src/ui/TerminalOverlay.ts` `toggleSessionHistory()` (~1234): call `renderSessionHistoryList(history, { readOnly: isReadOnly, onSelect })`. `onSelect` = return-early if `isReadOnly` (FR-017) or `restoreInFlight` (FR-010 latch); compute mid-turn via `officeManager.getAgentStatus(officeId, agentId)?.subState === 'thinking'`; show the appropriate `confirm(...)` copy (harder warning when mid-turn, FR-016); on cancel return (true no-op); else set `restoreInFlight=true`, `await window.copilotBridge.restoreSession(officeId, agentId, entry.id)`, on `!success` show the error (FR-009), on `resumeContextUncertain` show the "context may not be restored" advisory (FR-013), then refresh the popover + re-render the terminal to reflect the new current session (FR-003); clear `restoreInFlight` in `finally`. Ref: contracts §7, research.md R-007/R-010.
- [X] T015 [P] [US1] Add renderer unit tests for the shared builder in `tests/unit/ui/sessionHistoryRenderSelect.test.ts` (jsdom): clicking a row fires `onSelect(entry)` exactly once; `mousedown`/`click` on the id span does NOT fire `onSelect` (FR-007); `readOnly: true` renders no clickable affordance and never fires `onSelect` (FR-017); title is set via `textContent` (XSS-safe). Ref: quickstart automated verification.
- [X] T016 [P] [US1] Add a TerminalOverlay flow test in `tests/unit/ui/terminalOverlayRestore.test.ts` (jsdom, using the shared `copilot-bridge-mock`): confirm → `restoreSession` called once with `(officeId, agentId, entry.id)`; cancel → bridge NOT called (FR-004); `resumeContextUncertain:true` response surfaces the advisory; a second select while `restoreInFlight` is ignored (FR-010). Ref: contracts §7, spec Regression Plan (b),(h).

**Checkpoint**: User Story 1 is fully functional end-to-end on the primary surface — the MVP. `npm run test` + `npx tsc --noEmit` + `npm run build` all green.

---

## Phase 4: User Story 2 - Neither session is lost when switching (Priority: P1)

**Goal**: The switch is a reversible SWAP — the session current at confirmation is archived into
history (carrying its 019 title snapshot) and only the promoted entry is removed, so no entry is
lost, duplicated, or corrupted and the operator can always switch back.

**Independent Test**: With current session B and archived session A, restore A, then open history and
confirm B now appears and A no longer does; then restore B again and confirm the round-trip returns
to the original mapping.

### Implementation for User Story 2

- [X] T017 [US2] Verify/confirm the swap semantics of the T008 mutate path preserve no-loss/no-dup: `archiveSessionId` snapshots the outgoing title BEFORE any meta clear and dedupes by id, and `promoteHistoryEntry` removes ONLY the promoted entry — audit the handler in `electron/terminal/server.ts` against FR-005/FR-006/FR-014 (no double-archive, no orphaned entry). Ref: data-model.md state-transition diagram, research.md R-003.
- [X] T018 [P] [US2] Add round-trip + no-loss unit tests in `tests/unit/terminal/sessionHistoryPromote.test.ts` (extend T004) or a sibling file: simulate archive-current → promote-target → set-current across repeated switches and assert the round-trip `restore(B)` returns to the original `{ current, history }` mapping and that entry count/title/id pairings of untouched entries are stable (SC-003/SC-004). Ref: data-model.md Round-trip note.
- [X] T019 [P] [US2] Add a server-level swap test (if a server-testable seam exists; otherwise assert via the pure helper + archive helper composition) confirming target-equals-current is a no-op success that does not duplicate history and target-not-in-history rejects with no state change (FR-014 edge cases). Place in `tests/unit/terminal/sessionHistoryPromote.test.ts`. Ref: data-model.md edge-case matrix.

**Checkpoint**: User Stories 1 AND 2 both work — swap is safe, reversible, and lossless.

---

## Phase 5: User Story 3 - Consistent behavior across all history surfaces (Priority: P2)

**Goal**: Dual-surface parity — the clickable restore + confirmation behave identically on the
TerminalOverlay popover and the SeriousTerminalController popover, and restore is disabled in
read-only views.

**Independent Test**: Trigger a restore from each surface and confirm the same confirmation prompt
and swap outcome; open a read-only history view and confirm rows are NOT clickable (no swap).

### Implementation for User Story 3

- [X] T020 [US3] Wire the identical `onSelect` handler into `src/ui/SeriousTerminalController.ts` `toggleSessionHistory()` (~754): call `renderSessionHistoryList(history, { readOnly, onSelect })` with the SAME confirm → `window.copilotBridge.restoreSession` → refresh flow as TerminalOverlay (T014), gating on this surface's read-only/open-option state (FR-017) and using the same `restoreInFlight` latch (FR-010) and mid-turn warning (FR-016). Keep the two surfaces byte-for-byte equivalent in behavior. Ref: contracts §7, research.md R-009, quickstart Gotchas ("keep both surfaces identical").
- [X] T021 [P] [US3] Add a parity + read-only test in `tests/unit/ui/seriousTerminalRestore.test.ts` (jsdom, shared mock): SeriousTerminalController produces the same confirm prompt and calls `restoreSession` once with the same args as TerminalOverlay; a read-only surface renders non-clickable rows and never calls the bridge (FR-011/FR-017/SC-007). Ref: spec Regression Plan (i), contracts verification checklist row i.

**Checkpoint**: All three user stories are independently functional; both surfaces are at parity.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Full-suite validation, manual GUI verification of the best-effort resume behavior, and boundary checks.

- [X] T022 [P] Run the full automated gate at repo root and fix any fallout: `npm run test`, `npx tsc --noEmit`, `npm run build` (all three must pass — quickstart "Automated verification").
- [X] T023 [P] Confirm the `restore-session` operation is present and consistent in ALL six layers (FR-015 end-to-end grep): `protocol.ts`, `session-history.ts`, `server.ts`, `ipc-relay.ts`, `preload.ts` (+ `Window` type), both renderer surfaces, and `tests/setup/copilot-bridge-mock.ts` — no layer silently no-ops. Ref: contracts verification checklist row j.
- [X] T024 [P] Confirm Phaser-first boundary intact: the clickable affordance + confirmation live entirely in the DOM overlays (`sessionHistoryRender.ts`, `TerminalOverlay.ts`, `SeriousTerminalController.ts`); no Phaser scene/sprite/in-canvas path added (Constitution Rendering Boundary). No `InputManager` change (confirmation is a scoped, ephemeral UI interaction).
- [ ] T025 **Manual GUI verification — Story 1/2 happy path**: Launch the rebuilt bundle from THIS checkout (verify `dist/` timestamp + grep a distinctive new symbol like `restoreSession`). Start session A, start session B (A archived), click A → confirm → verify current becomes A and the terminal reflects A; cancel leaves a true no-op; drag-select A's id → no dialog. Restore A then B → verify B is now in history / A is not, and the round-trip works. Ref: quickstart Manual validation Story 1/2.
- [ ] T026 **Manual GUI verification — best-effort resume + advisory (FR-013)**: After restoring an OLD/stale archived session, verify the actual resume-with-context behavior (best-effort) and that when prior context cannot be confirmed restored the operator sees the explicit "context may not be restored" advisory — never a silent blank session presented as success (SC-006). Ref: spec Edge Cases "Target session cannot be resumed", research.md R-002.
- [ ] T027 **Manual GUI verification — mid-turn, collision, restart durability, dual-surface**: mid-turn current session → dialog warns harder but confirm still proceeds (FR-016); target id already active for another agent → graceful visible error with no state change (FR-009); restart the app after a switch → new `{ current, history, metadata }` mapping persists (SC-005); trigger restore from BOTH the TerminalOverlay and SeriousTerminalController popovers → identical prompt + outcome (FR-011/SC-007). Ref: quickstart Manual validation Story 3 + Edge cases.
> **Note (T025–T027)**: Left unchecked — these are manual GUI verifications that require a
> live windowed Electron session and cannot run headless in this automation environment. The
> underlying behavior is covered by automated gates (all green): the swap/no-loss/round-trip
> logic (`sessionHistoryPromote.test.ts`), clickable-row + read-only + id-stopPropagation
> wiring (`sessionHistoryRenderSelect.test.ts`), the confirm/cancel/advisory/latch flow on both
> surfaces (`terminalOverlayRestore.test.ts`, `seriousTerminalRestore.test.ts`), plus
> `npx tsc --noEmit` and `npm run build`. `dist/` was rebuilt from this checkout (contains the
> new `restoreSession` symbol).

- [X] T028 [P] Update any developer docs/notes if the repo tracks a feature-wiring index (e.g. a session-lifecycle or protocol-message doc under `docs/`); otherwise no-op. Keep changes doc-only.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — can start immediately.
- **Foundational (Phase 2)**: Depends on Setup. **BLOCKS all user stories** — the protocol message (T005) and pure helper (T003) are prerequisites for the server handler and every wiring task.
- **User Story 1 (Phase 3)**: Depends on Foundational. Delivers the full vertical slice + MVP.
- **User Story 2 (Phase 4)**: Depends on the T008 mutate path from US1; its tasks are verification/tests of the swap semantics already implemented in US1's server handler.
- **User Story 3 (Phase 5)**: Depends on US1's shared `onSelect` handler + renderer options (T012–T014); mirrors it onto the second surface.
- **Polish (Phase 6)**: Depends on all desired user stories being complete.

### User Story Dependencies

- **US1 (P1)**: Independent — start after Foundational. Vertical slice (server→relay→preload→shared renderer→TerminalOverlay→tests).
- **US2 (P1)**: Builds on US1's server mutate path (T008); adds no-loss/round-trip tests + an audit. Independently testable via the pure helper.
- **US3 (P2)**: Builds on US1's shared renderer; adds the second surface + parity/read-only tests. Independently testable per surface.

### Within Each User Story

- Foundational helper + protocol type before any handler/wiring.
- Server handler (T007–T009) before relay/preload (T010–T011) before renderer wiring (T012–T014).
- Shared renderer builder (T012–T013) before both surface wirings (T014, T020).
- Tests marked [P] can run alongside their implementation once the target file exists.

### Parallel Opportunities

- **Foundational**: T003 (helper) ‖ T005 (protocol) ‖ T006 (test mock) — different files. T004 (helper tests) follows T003.
- **US1**: T015 ‖ T016 (test files) can be written in parallel once T012–T014 land. Server (T007–T009) is one file (sequential).
- **US2**: T018 ‖ T019 (test files).
- **US3**: T021 test parallel to T020 once the surface wiring exists.
- **Polish**: T022 ‖ T023 ‖ T024 ‖ T028 (independent checks/docs).

---

## Parallel Example: Foundational (Phase 2)

```bash
# Different files — launch together:
Task: "Add promoteHistoryEntry() to electron/terminal/session-history.ts"
Task: "Add MsgRestoreSession + MainToServer union entry to electron/terminal/protocol.ts"
Task: "Add restoreSession mock to tests/setup/copilot-bridge-mock.ts"
```

## Parallel Example: User Story 1 tests

```bash
# After T012–T014 land, write both test files in parallel:
Task: "Renderer builder tests in tests/unit/ui/sessionHistoryRenderSelect.test.ts"
Task: "TerminalOverlay flow tests in tests/unit/ui/terminalOverlayRestore.test.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1 (Setup) + Phase 2 (Foundational — protocol + helper + mock).
2. Complete Phase 3 (US1): the full six-layer vertical slice on the primary surface.
3. **STOP and VALIDATE**: run the three automated gates + Story-1 manual test.
4. Demo: click a past session → confirm → switch. This is the whole feature's core value.

### Incremental Delivery

1. Setup + Foundational → protocol/helper/mock ready.
2. US1 → end-to-end restore on TerminalOverlay → test → demo (MVP).
3. US2 → prove/lock the reversible-swap no-loss guarantees → test.
4. US3 → mirror onto SeriousTerminalController + read-only gating → test → parity demo.
5. Polish → full suite + manual GUI verification (best-effort resume advisory, restart durability).

### Notes

- [P] = different files, no dependencies.
- Follow the suggested implementation order in quickstart.md (helper first for TDD; protocol next as the compile-time anchor).
- Keep both terminal surfaces identical — divergence is a documented recurring regression class.
- Reject-before-mutate: any early return must not have archived/promoted/persisted anything.
- Never `innerHTML` a title; titles stay `textContent` (XSS-safe).
