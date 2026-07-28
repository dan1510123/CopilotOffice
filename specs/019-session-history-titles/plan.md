# Implementation Plan: Titled Session History Entries

**Branch**: `019-session-history-titles` | **Date**: 2026-07-27 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/019-session-history-titles/spec.md`

## Summary

Session history today stores only opaque session IDs (`sessionHistory: Map<agentId, string[]>`)
and renders them as a wall of UUIDs. This feature attaches the **already-existing per-agent
session title** (the auto-derived, 80-char-truncated label held in `sessionMeta`) to each
archived entry, captured as a point-in-time snapshot at the moment of archiving, and displays it
next to the ID in both history surfaces.

Technical approach: evolve the session-history payload from `string[]` to
`SessionHistoryEntry[]` (`{ id: string; title?: string }`) end-to-end — persisted shape,
protocol type, preload bridge, server handlers, and both renderers — in a single change, with
**backward-compatible loading** of legacy ID-only records (a bare string coerces to
`{ id }` with no title, rendered as a neutral fallback). No new title-derivation logic is
introduced; `archiveSessionId()` simply snapshots `sessionMeta.get(agentId)?.title` at archive
time. Renaming archived titles is explicitly out of scope (titles are immutable once recorded).

## Technical Context

**Language/Version**: TypeScript (strict mode), Node.js (Electron main + forked terminal server), DOM renderer
**Primary Dependencies**: Electron, node-pty, xterm.js, Phaser 3 (unaffected here), Vitest (unit/integration), Playwright (e2e, not required for this change)
**Storage**: Per-office JSON session files at `.data/{officeId}.sessions.json` with shape `{ current, history, metadata }`; in-memory `OfficeSessionData` maps in `electron/terminal/server.ts`
**Testing**: Vitest via `npm run test`; test bridge mock at `tests/setup/copilot-bridge-mock.ts`
**Target Platform**: Electron desktop app (Windows primary)
**Project Type**: Desktop app — Electron main/preload/terminal-server + DOM/Phaser renderer (single repo, no frontend/backend split)
**Performance Goals**: History popover render is O(history length) DOM work; no new IPC round-trips (title travels inside the existing `get-session-history` response). No frame-rate impact (DOM overlay only).
**Constraints**: Popover MUST NOT widen, wrap, or horizontally scroll for long titles (CSS ellipsis + `title` tooltip); titles rendered as literal text (no HTML injection); backward-compatible load of legacy on-disk data is a hard requirement (FR-006).
**Scale/Scope**: Small blast radius — 6 source files + 1 test-mock + new/updated unit tests. History lists are short (per-agent, per-office, retention unchanged).

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Phaser-first constraint respected (no alternate in-canvas renderer introduced) — change is confined to the existing DOM history popover; no Phaser scene/sprite/game-object path touched.
- [x] Event-driven boundaries preserved (`game.events`/IPC contracts, no hidden cross-layer coupling) — data continues to flow over the existing `get-session-history` request/response through the preload bridge; only the payload *shape* changes. No new direct renderer↔backend coupling.
- [x] Input focus transitions routed through `InputManager` — no input/focus behavior changes; popover open/close and `InputManager` coordination are untouched.
- [x] Session lifecycle integrity maintained for terminal/agent/fleet flows — archiving triggers, session creation, resume semantics, and the session ID as sole identifier are unchanged. Title is additive display metadata captured at archive time. Backward-compatible on-disk load is preserved (FR-006, Principle III).
- [x] Configuration-first approach used for agents/layouts/feature flags — no hardcoded per-agent/per-office special cases; the persisted record simply gains an optional `title` field per entry that remains readable when absent.
- [x] Regression validation scope defined for touched high-risk flows — see Regression Plan below and quickstart.md. Both history renderers (`TerminalOverlay` + `SeriousTerminalController`) are updated in the same change, and the change is exercised against the shared test bridge mock (FR-014, mirrors Principle VI's dual-surface discipline).

**Applicable non-clipboard principles**: This is a terminal/session change, so Principle III
(Real-Agent Session Integrity) and Principle IV (Regression-Safe Delivery) are the primary
gates. Principle VI (clipboard) is not directly triggered, but its **dual-surface parity rule**
is honored: any behavior touching both `TerminalOverlay` and `SeriousTerminalController` must be
mirrored in one change. Principle VII (worktree-aware verification) applies at implementation/
verification time — confirm the rebuilt `dist/` is what the user launches before declaring done.

**Result**: PASS — no violations. Complexity Tracking table intentionally empty.

## Project Structure

### Documentation (this feature)

```text
specs/019-session-history-titles/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output — shape/migration/XSS/tooltip decisions
├── data-model.md        # Phase 1 output — SessionHistoryEntry + persisted shape + migration
├── quickstart.md        # Phase 1 output — manual + automated verification recipe
├── contracts/
│   └── session-history-protocol.md  # Phase 1 output — wire contract for get-session-history
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created by /speckit.plan)
```

### Source Code (repository root)

The change touches the terminal session pipeline end-to-end. Files, in dependency order:

```text
electron/terminal/
├── protocol.ts          # + export interface SessionHistoryEntry { id: string; title?: string }
│                        #   type get-session-history response as SessionHistoryEntry[]
├── server.ts            # OfficeSessionData.sessionHistory: Map<string, SessionHistoryEntry[]>
│                        #   loadOfficeSessionFile(): coerce legacy string[] -> entry[] on read
│                        #   archiveSessionId(): snapshot sessionMeta title at archive time
│                        #   get-session-history handler returns entries
│                        #   clear-session-history + transfer-session already deep-copy arrays
├── preload.ts           # getSessionHistory: Promise<SessionHistoryEntry[]> (impl + Window type)
└── ipc-relay.ts         # terminal-get-session-history handler forwards entries (type only)

src/ui/
├── TerminalOverlay.ts        # ~line 1276: render title span (textContent) + id span; ellipsis + title-attr
└── SeriousTerminalController.ts  # ~line 760/796: render entries instead of history.join('\n')

tests/
├── setup/copilot-bridge-mock.ts  # getSessionHistory mock stays [] (assignable to entry[])
├── unit/terminal/                # NEW/updated: archive-snapshot + legacy-coercion unit tests
└── unit/ui/ (or integration)     # NEW: renderer entry rendering + fallback + escaping
```

**Structure Decision**: Single Electron desktop repository (no frontend/backend split). The
work follows the established terminal message pipeline: `protocol.ts` (types) →
`server.ts` (owns persistence + handler) → `ipc-relay.ts` (main relay) → `preload.ts` (context
bridge) → `src/ui/*` (renderers), with `tests/setup/copilot-bridge-mock.ts` mirroring the
bridge contract. Per the electron.instructions.md **"IPC type mismatches"** pitfall, all five
pipeline files plus the test mock are changed together so protocol types stay in sync with both
`server.ts` and `ipc-relay.ts`.

## Complexity Tracking

> No constitution violations. No entries required.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | —          | —                                    |
