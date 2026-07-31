# Tasks: Titled Session History Entries

**Input**: Design documents from `/specs/019-session-history-titles/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/session-history-protocol.md, quickstart.md

**Tests**: Test tasks ARE included — the spec's Regression Plan and quickstart.md explicitly
request Vitest unit coverage (archive snapshot, dedupe, legacy coercion/backward-compat load,
renderer fallback/escaping/truncation). Validate with `npm run test`.

**Organization**: Tasks are grouped by user story to enable independent implementation and testing.

## Constitution-Driven Task Requirements

- Terminal/session lifecycle is touched → US3 includes regression tasks for archive/persistence,
  transfer-between-offices, and clear-history flows.
- Renderer behavior changes → renderer tasks stay within the existing DOM history popover; no
  Phaser scene/sprite/game-object path is added (Phaser-first boundary intact). No input/focus
  behavior changes, so no `InputManager` transition tasks are needed.
- Both history surfaces (`TerminalOverlay` + `SeriousTerminalController`) are updated in the same
  change and exercised against the shared test bridge mock (FR-014, dual-surface parity).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies on incomplete tasks)
- **[Story]**: US1, US2, US3 — maps to the user stories in spec.md
- Every task includes an exact file path.

## Path Conventions

Single Electron desktop repo (no frontend/backend split). Terminal pipeline:
`electron/terminal/protocol.ts` → `server.ts` → `ipc-relay.ts` → `preload.ts` → `src/ui/*`, with
`tests/setup/copilot-bridge-mock.ts` mirroring the bridge contract.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Establish a green baseline before changing the shared payload shape.

- [X] T001 Confirm a clean baseline: run `npm run test` from repo root and record that the suite is green before any changes (no new files created).
- [X] T002 Review the wire contract in `specs/019-session-history-titles/contracts/session-history-protocol.md` and the coercion/snapshot rules in `specs/019-session-history-titles/data-model.md` so the shape change is applied consistently across all five pipeline files plus the test mock.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Introduce the shared `SessionHistoryEntry` type and thread the new `SessionHistoryEntry[]` shape through the type-only layers of the pipeline. This is the "IPC types stay in sync" foundation that ALL user stories build on.

**⚠️ CRITICAL**: No user story work can begin until this phase is complete — a partial shape change breaks `tsc` across the pipeline.

- [X] T003 [P] Add `export interface SessionHistoryEntry { id: string; title?: string }` (with doc comments per data-model.md) to `electron/terminal/protocol.ts`, and change the documented `get-session-history` response payload type from `string[]` to `SessionHistoryEntry[]` near the `MsgGetSessionHistory` definition (`electron/terminal/protocol.ts:160`).
- [X] T004 Change `OfficeSessionData.sessionHistory` value type from `Map<string, string[]>` to `Map<string, SessionHistoryEntry[]>` in `electron/terminal/server.ts:138`, importing `SessionHistoryEntry` from `./protocol` (depends on T003).
- [X] T005 Add exported pure helpers `normalizeTitle(t: unknown): string | undefined` (trim; empty/whitespace → `undefined`) and `coerceHistory(raw: unknown): SessionHistoryEntry[]` (map bare strings → `{ id }`, objects → `{ id: String(id), title: normalizeTitle(title) }`, drop empty ids) to `electron/terminal/server.ts` per data-model.md, so they are unit-testable without Electron (depends on T004).
- [X] T006 [P] Update the preload bridge return type in `electron/terminal/preload.ts`: `getSessionHistory(...)` impl signature (`electron/terminal/preload.ts:81`) and the `Window.copilotBridge` type declaration (`electron/terminal/preload.ts:490`) from `Promise<string[]>` to `Promise<SessionHistoryEntry[]>`, importing/using the `SessionHistoryEntry` type (depends on T003).
- [X] T007 [P] Update `electron/terminal/ipc-relay.ts` so the forwarded `terminal-get-session-history` result is typed `SessionHistoryEntry[]` (type-only change, no logic change) (depends on T003).
- [X] T008 [P] Update `tests/setup/copilot-bridge-mock.ts` so the `getSessionHistory` mock's type matches `SessionHistoryEntry[]` (default resolved value stays `[]`; add a comment documenting that populated-history tests pass entry objects like `[{ id: 'u1', title: 'T' }, { id: 'u2' }]`) (depends on T003).

**Checkpoint**: `tsc`/`npm run build` type-checks across the pipeline; the payload is now `SessionHistoryEntry[]` end-to-end. User stories can begin.

---

## Phase 3: User Story 1 - Recognize a past session at a glance (Priority: P1) 🎯 MVP

**Goal**: Every archived session shows its human-readable title next to the session ID in both history surfaces, with the ID still exact and copyable.

**Independent Test**: Start an agent session, send a message that produces a title, start a new session for the same agent (archiving the previous), open the session history list, and confirm the archived entry shows the title alongside its (copyable) ID.

### Implementation for User Story 1

- [X] T009 [US1] In `electron/terminal/server.ts` `archiveSessionId()` (`electron/terminal/server.ts:271`), snapshot the current title via `normalizeTitle(data.sessionMeta.get(agentId)?.title)` at archive time, dedupe by `id` (`if (history.some(e => e.id === oldId)) return;`), and push `title ? { id: oldId, title } : { id: oldId }` (depends on T005).
- [X] T010 [US1] Update the `get-session-history` handler in `electron/terminal/server.ts:1320-1322` to return the coerced in-memory `SessionHistoryEntry[]` (`officeData.sessionHistory.get(msg.agentId) || []`) unchanged as the `result` (depends on T004).
- [X] T011 [P] [US1] In `src/ui/TerminalOverlay.ts` (~line 1276) render each history row from a `SessionHistoryEntry`: a title span (set via `textContent` for XSS-safe literal text — FR-010) followed by the exact `id` span (`user-select: all`, verbatim, copyable — FR-007), single-line CSS ellipsis with the full title on the DOM `title` attribute (hover tooltip) and NO widening/wrapping/horizontal-scroll of the popover (FR-012a), preserving `#N` numbering and most-recent-first order (FR-013) (depends on T003).
- [X] T012 [P] [US1] In `src/ui/SeriousTerminalController.ts` history rendering (~lines 760/796), replace the `history.join('\n')` string rendering with per-entry rendering of `SessionHistoryEntry[]` mirroring TerminalOverlay: literal-text title + exact copyable id + ellipsis/tooltip + preserved numbering/order (FR-014 dual-surface parity) (depends on T003).

### Tests for User Story 1

- [X] T013 [P] [US1] Add `tests/unit/terminal/sessionHistoryArchive.test.ts`: assert `archiveSessionId` snapshots the current `sessionMeta` title into the pushed entry `{ id, title }`, and that re-archiving an `id` already present does NOT append a duplicate and does NOT overwrite an existing real title with an empty one (dedupe — quickstart cases 1 & 6).
- [X] T014 [P] [US1] Add `tests/unit/ui/terminalHistoryRender.test.ts` (jsdom): given `[{ id, title }]`, assert both surfaces render the title text and the exact id (id span carries `user-select: all`) and preserve `#N` most-recent-first ordering (quickstart cases 9 & 13, FR-013).

**Checkpoint**: MVP — titled archived sessions are visible with their IDs in both popovers, IDs still copyable.

---

## Phase 4: User Story 2 - History remains usable for untitled and legacy sessions (Priority: P1)

**Goal**: Legacy (pre-019 bare-string) history and untitled sessions load without loss and render with a neutral `Untitled session` fallback — no blank/`undefined`/error rows.

**Independent Test**: Point the app at existing session history data with no stored titles (bare-string `history[agentId]`), open the history list, and confirm every legacy entry renders with its ID plus `Untitled session` and no error.

### Implementation for User Story 2

- [X] T015 [US2] In `loadOfficeSessionFile()` (`electron/terminal/server.ts:204`, object-shape branch ~line 214) build `data.sessionHistory` by passing each agent's raw `history` array through `coerceHistory(...)` so bare-string legacy entries become `{ id }` (no title) and empty/whitespace titles normalize to absent, with no entry dropped (FR-006, SC-004) (depends on T005).
- [X] T016 [P] [US2] In `src/ui/TerminalOverlay.ts` (~line 1276) render the literal fallback text `Untitled session` when `entry.title` is absent/empty, so no row shows blank/`undefined` (FR-005) — same edit region as T011 (depends on T011).
- [X] T017 [P] [US2] In `src/ui/SeriousTerminalController.ts` (~lines 760/796) render the same `Untitled session` fallback for entries without a title (FR-005, FR-014) — same edit region as T012 (depends on T012).

### Tests for User Story 2

- [X] T018 [P] [US2] Add to `tests/unit/terminal/sessionHistoryCoerce.test.ts`: `coerceHistory` turns a bare-string `history` into `{ id }[]` with zero entries lost; a persisted `{ id, title: "   " }` normalizes to `title` undefined; and archiving an untitled session yields `{ id }` (quickstart cases 2, 4, 5; FR-006).
- [X] T019 [P] [US2] Extend `tests/unit/ui/terminalHistoryRender.test.ts`: given `[{ id }]` both surfaces render `Untitled session` (no `undefined`/blank/error); and a title containing `<img src=x onerror=...>`/markup is rendered as literal text with no injected DOM element created (quickstart cases 10 & 11; FR-005, FR-010, SC-002).

**Checkpoint**: US1 + US2 both work — titled and legacy/untitled entries render cleanly side by side.

---

## Phase 5: User Story 3 - Titles survive restart and follow the session (Priority: P2)

**Goal**: Archived titles are point-in-time snapshots that persist across restart, travel on office transfer, and are removed by clear-history.

**Independent Test**: Archive a titled session, fully restart the app, reopen the history list, and confirm the same title/ID pairing is present.

### Implementation for User Story 3

- [X] T020 [US3] Verify `saveOfficeSessionFile()` (`electron/terminal/server.ts:246`, `history: Object.fromEntries(data.sessionHistory)`) writes the object-shaped entries `{ id, title? }` so the next save performs the in-place legacy→019 upgrade transparently; adjust only if serialization does not emit the entry objects (FR-003, depends on T004/T015).
- [X] T021 [US3] Confirm the `transfer-session` path (`electron/terminal/server.ts:1506-1507`, `toData.sessionHistory.set(agentId, [...history])`) carries entry objects (with titles) into the destination office; entries are immutable snapshots so the shallow copy is sufficient (FR-009, depends on T004).
- [X] T022 [US3] Confirm the `clear-session-history` path (`electron/terminal/server.ts:1327-1329`, `sessionHistory.delete(agentId)`) removes titles along with IDs (titles live inside the entries → no residual data), requiring no logic change beyond the type (FR-008, depends on T004).

### Tests for User Story 3

- [X] T023 [P] [US3] Add `tests/unit/terminal/sessionHistoryPersistence.test.ts`: title immutability — archive a titled session, then change the current `sessionMeta` title, and assert the archived entry's title is unchanged (FR-002, quickstart case 3); and a coerced legacy array re-serializes to the object shape (quickstart case 4).
- [X] T024 [P] [US3] Add `tests/unit/terminal/sessionHistoryTransferClear.test.ts`: transfer copies entries with titles intact into the destination office (FR-009, quickstart case 8); clear-history deletes the agent's entries entirely with no residual title data (FR-008, quickstart case 7).

**Checkpoint**: All user stories independently functional — titles persist, transfer, and clear correctly.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Cross-cutting validation and the worktree-aware build check.

- [X] T025 [P] Extend `tests/unit/ui/terminalHistoryRender.test.ts` with a long-title layout case: an over-long title sets the DOM `title` (tooltip) attribute to the full string and uses ellipsis styling; the popover width/geometry does not change (FR-012a, quickstart case 12).
- [X] T026 Run `npm run test` from repo root and confirm the full Vitest suite (new + existing) is green.
- [X] T027 Run `npm run build` and, per Constitution Principle VII, verify the rebuilt `dist/` is the one launched — grep the built bundle for the distinctive `Untitled session` fallback marker and match `dist/` timestamps before any manual verification.
- [ ] T028 Execute the manual verification recipe in `specs/019-session-history-titles/quickstart.md` (US1 recognize-at-a-glance + ID copy, US2 legacy/untitled, US3 persistence/transfer/clear, long-title tooltip, both-surfaces parity). <!-- Requires launching the Electron GUI; not runnable in the headless implementation environment. Automated proxies done: full Vitest suite green (T026), dist/ rebuilt with the `Untitled session` marker verified (T027). -->

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: No dependencies — start immediately.
- **Foundational (Phase 2)**: Depends on Setup — BLOCKS all user stories (shared type/shape change).
- **User Stories (Phase 3–5)**: All depend on Foundational completion.
  - US1 (P1) and US2 (P1) are co-critical; US2's renderer fallback tasks (T016/T017) extend US1's renderer edits (T011/T012), so within one developer US1's renderer tasks land first.
  - US3 (P2) depends only on the Foundational type change; independently testable.
- **Polish (Phase 6)**: Depends on the user stories being complete.

### Key Task Dependencies

- T004 → T003; T005 → T004; T006/T007/T008 → T003.
- T009/T010 → T005/T004; T015 → T005.
- T011/T012 → T003; T016 → T011; T017 → T012.
- T020/T021/T022 → T004 (T020 also → T015).
- Test tasks depend on their corresponding implementation tasks.

### Parallel Opportunities

- Foundational: T006, T007, T008 run in parallel (different files) after T003; T003 itself is [P].
- US1: T011 and T012 (different renderer files) run in parallel; tests T013 and T014 run in parallel.
- US2: T016 and T017 in parallel; tests T018 and T019 in parallel.
- US3: T023 and T024 in parallel (different new test files).
- Once Foundational is done, US1/US2/US3 implementation can proceed in parallel across developers (mind the T011↔T016 / T012↔T017 same-file coupling within the renderer files).

---

## Parallel Example: Foundational Phase

```bash
# After T003 (protocol type) lands, run the type-sync tasks together:
Task: "Update getSessionHistory return type in electron/terminal/preload.ts"      # T006
Task: "Type forwarded result as SessionHistoryEntry[] in electron/terminal/ipc-relay.ts"  # T007
Task: "Sync getSessionHistory mock type in tests/setup/copilot-bridge-mock.ts"    # T008
```

## Parallel Example: User Story 1

```bash
# Renderer edits in different files, in parallel:
Task: "Render title+id row in src/ui/TerminalOverlay.ts (~1276)"                  # T011
Task: "Render entries in src/ui/SeriousTerminalController.ts (~760/796)"          # T012

# Tests in parallel:
Task: "Archive snapshot + dedupe tests in tests/unit/terminal/sessionHistoryArchive.test.ts"  # T013
Task: "Titled render tests in tests/unit/ui/terminalHistoryRender.test.ts"        # T014
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1 (Setup) and Phase 2 (Foundational — shared type/shape).
2. Complete Phase 3 (US1): archive snapshot + both-surface title rendering.
3. **STOP and VALIDATE**: titled archived sessions show title + copyable ID in both popovers.

> Note: because every existing user has untitled history on disk, US2 (P1) should ship together
> with US1 in the first real release to avoid visibly broken legacy rows on first launch.

### Incremental Delivery

1. Setup + Foundational → shape threaded end-to-end.
2. US1 + US2 (both P1) → titled + legacy/untitled render cleanly → MVP.
3. US3 (P2) → persistence, transfer, clear regression-covered.
4. Polish → long-title layout test, full suite, worktree build check, manual quickstart.

### Parallel Team Strategy

After Foundational:
- Developer A: US1 (archive + renderers).
- Developer B: US2 (load coercion + fallback) — coordinates on the shared renderer files with A.
- Developer C: US3 (persistence/transfer/clear + tests).

---

## Notes

- [P] = different files, no incomplete dependencies. Renderer fallback tasks (T016/T017) share
  files with T011/T012, so they are sequenced, not parallel, within each renderer file.
- Titles are rendered via `textContent` (literal text) — never `innerHTML` (FR-010).
- The session ID stays the sole identifier and remains exact/copyable everywhere (FR-007).
- No version field is added to the persisted file — the shape is self-describing (string = legacy,
  object = 019).
- Commit after each task or logical group; validate each story at its checkpoint.
