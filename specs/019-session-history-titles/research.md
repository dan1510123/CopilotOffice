# Phase 0 Research: Titled Session History Entries

All spec clarifications were resolved before planning (see spec.md `## Clarifications /
Session 2026-07-27`). No `NEEDS CLARIFICATION` markers remain in Technical Context. This
document records the design decisions that resolve the *technical* unknowns raised by the
locked product decisions, each grounded in the actual codebase.

## Decision 1 — Session-history payload shape: `string[]` → `SessionHistoryEntry[]`

**Decision**: Introduce `interface SessionHistoryEntry { id: string; title?: string }` in
`electron/terminal/protocol.ts` and use `SessionHistoryEntry[]` as the payload for the
`get-session-history` response, the in-memory `sessionHistory` map value, and the persisted
`history` field. `title` is **optional** — absent means "untitled / legacy".

**Rationale**:
- The IDs are the authoritative, copyable identifier (FR-007); modelling each entry as an
  object with an explicit `id` keeps the ID intact and adds the title as a sibling field rather
  than mangling the string.
- Making `title` optional (`title?`) is what makes legacy ID-only data and never-titled
  sessions representable without a sentinel value — the renderer applies the neutral fallback
  when `title` is absent/blank (FR-005).
- Field name `id` (not `sessionId`) matches the locked decision in the task brief and keeps the
  entry compact; the existing `get-all-session-meta` handler already uses `sessionId` for a
  different purpose (current session), so a distinct short name avoids confusion.

**Alternatives considered**:
- *Parallel `Map<agentId, string[]>` for titles alongside the existing ID array*: rejected —
  two arrays kept in index lock-step is exactly the fragile pattern the electron.instructions.md
  "IPC type mismatch" pitfall warns against, and it complicates clear/transfer.
- *Keep `string[]` and pack `"id\ttitle"` into each string*: rejected — violates FR-007 (ID must
  remain an exact, unmodified, copyable value) and FR-010 (literal-text rendering).
- *Add a protocol version field to the JSON file*: rejected as unnecessary — the shape is
  self-describing (string element = legacy, object element = new), matching how
  `loadOfficeSessionFile` already distinguishes the legacy flat `{agentId:sessionId}` format
  from the current `{current,history,metadata}` format.

## Decision 2 — Backward-compatible persistence & in-place migration

**Decision**: On load in `loadOfficeSessionFile()`, coerce each `history` element per-agent:
a `string` element becomes `{ id: string }` (no title); an object element is passed through as
`{ id, title? }`. Persist back in the new object shape. No separate migration pass, no version
bump, no data loss — legacy entries simply surface the fallback until/unless naturally re-archived.

**Rationale**:
- FR-006 requires existing on-disk history to keep loading without the user resetting/clearing.
  Coercion at the read boundary is the smallest, safest upgrade point and mirrors the existing
  legacy-flat-format handling already in `loadOfficeSessionFile` (which rewrites the file after
  upgrading).
- The spec explicitly states **no backfill** of titles for already-archived sessions
  (Assumptions); legacy entries showing the fallback is the accepted behavior (User Story 2).
- Writing back the object shape on the next `saveOfficeSessionFile()` performs the in-place
  upgrade transparently, exactly as the existing V3 duplicate-repair path does.

**Alternatives considered**:
- *Lazy coercion only in the `get-session-history` handler, leaving disk untouched*: viable but
  leaves the in-memory map heterogeneous (`(string | object)[]`), which fights TypeScript strict
  typing. Normalizing once at load keeps the in-memory type clean (`SessionHistoryEntry[]`).

## Decision 3 — Title source is a point-in-time snapshot at archive time

**Decision**: In `archiveSessionId(officeId, agentId)`, read the current title via
`getOfficeSession(officeId).sessionMeta.get(agentId)?.title`, trim it, and store it on the
archived entry (`{ id: oldId, title: snapshot || undefined }`). No new derivation logic.

**Rationale**:
- FR-002/FR-011 require the archived title to be the title the session held at archive time,
  frozen thereafter. `sessionMeta` already holds the auto-derived, ≤80-char title (set in the
  `user.message` handler in server.ts). Snapshotting it at archive is a pure read — it satisfies
  "no new derivation logic" and the immutability requirement (FR-012).
- All three archive call sites route through `archiveSessionId()` (kill ~line 1124, set-session-id
  ~1238, reset-session ~1311), so capturing the snapshot in that one helper covers every path.
- Guard against clobbering: `archiveSessionId` already skips if the ID is already in history
  (`if (!history.includes(oldId))`). The equivalent guard on the entry array (match by `id`)
  preserves the "same session archived twice must not replace a real title with an empty one"
  edge case.

**Alternatives considered**:
- *Snapshot at title-set time into history*: rejected — the session isn't in history until
  archived, and it would require tracking a moving target. Archive-time snapshot is the single
  correct capture point.

## Decision 4 — Literal-text rendering (XSS-safe) in the popovers

**Decision**: Render the title with DOM `textContent` (or an escape helper), never via raw
`innerHTML` string interpolation. The current `TerminalOverlay` history row uses
`entry.innerHTML = \`...${history[i]}...\`` — safe today only because IDs are UUIDs. Titles are
free-form user text, so the row must be rebuilt with `document.createElement` + `textContent`
for the title/ID spans (or escaped via the existing `escapeHtml` pattern used in
`SettingsPanel.ts` / `NotificationSettingsPanel.ts`).

**Rationale**:
- FR-010 and the "unusual characters in a title" edge case require titles to be displayed as
  literal text and never interpreted as markup. `textContent` is the idiomatic, allocation-free
  guarantee and matches the prevailing renderer convention (most rows already use `textContent`;
  `escapeHtml` is only used where `innerHTML` is unavoidable).

**Alternatives considered**:
- *Keep `innerHTML` and escape the title*: acceptable and consistent with `escapeHtml` usage
  elsewhere, but converting the row to element construction is cleaner and removes the standing
  injection foot-gun. Either is compliant; the data-model/contract mandate is only "literal text".

## Decision 5 — Long-title layout: CSS ellipsis + native `title` tooltip

**Decision**: The title span uses single-line ellipsis truncation
(`white-space: nowrap; overflow: hidden; text-overflow: ellipsis;` with a bounded `max-width`
so the popover width is fixed) and sets the DOM `title` attribute to the full untruncated title
for the hover tooltip. The popover keeps its fixed width and never wraps or scrolls horizontally.

**Rationale**:
- Matches the locked clarification ("truncate with ellipsis, full title on hover; popover must
  not widen/wrap/horizontally scroll"). Native `title` attribute is the zero-dependency tooltip
  already implied by the spec; no custom tooltip component is warranted.
- The ID span retains `user-select: all` (as today in `TerminalOverlay`) so the exact ID stays
  copyable regardless of title truncation (FR-007). The tooltip carries the *title*, not the ID.

**Alternatives considered**:
- *Wrap long titles onto multiple lines*: rejected by clarification (no wrapping).
- *Custom hover popover for the full title*: rejected — over-engineered vs. the native `title`
  attribute, which fully satisfies FR-012a.

## Decision 6 — Keep both renderers and the test mock in one change

**Decision**: Update `TerminalOverlay.ts` and `SeriousTerminalController.ts` together, and adjust
`tests/setup/copilot-bridge-mock.ts` in the same change. `SeriousTerminalController` currently
renders `history.join('\n')`, which breaks on objects; it must render `id`/`title` per entry
(same fallback + ellipsis rules).

**Rationale**:
- FR-014 requires all history surfaces to show titles consistently. The constitution's dual-
  surface parity rule (Principle VI, generalized) and the "shape change touches the mock" note in
  the brief make this a single-change requirement.
- The mock's `getSessionHistory: vi.fn().mockResolvedValue([])` stays valid (`[]` is assignable
  to `SessionHistoryEntry[]`); tests that need populated history will provide entry objects.

**Alternatives considered**:
- *Ship server/protocol first, renderers later*: rejected — leaves `SeriousTerminalController`
  rendering `[object Object]` and violates the "keep protocol + preload + server + renderer +
  test-mock consistent in one change" pitfall.

## Open questions

None. All product decisions are locked in the spec's Clarifications section, and all technical
decisions above are grounded in the current codebase. Ready for Phase 1.
