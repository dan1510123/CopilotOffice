# Contract: `get-session-history` wire protocol (spec 019)

This is the only protocol contract touched by the feature. It documents the shape change from
`string[]` to `SessionHistoryEntry[]` across the full terminal message pipeline, and the
backward-compatibility guarantee for legacy on-disk data. Per electron.instructions.md, protocol
types in `protocol.ts` MUST stay in sync with handlers in both `server.ts` and `ipc-relay.ts`
(and, for this repo, the preload bridge and the test mock).

## Shared type (`electron/terminal/protocol.ts`)

```ts
export interface SessionHistoryEntry {
  id: string;        // opaque session identifier, always present, exact & copyable
  title?: string;    // snapshot at archive time; absent for legacy/untitled entries
}
```

The request message `MsgGetSessionHistory` is unchanged:

```ts
export interface MsgGetSessionHistory {
  type: 'get-session-history';
  requestId: string;
  officeId: string;
  agentId: string;
}
```

Only the **response payload** changes: previously `string[]`, now `SessionHistoryEntry[]`.

## Pipeline contract (request → response)

| Layer | File | Before | After |
|-------|------|--------|-------|
| Renderer call | `src/ui/TerminalOverlay.ts`, `src/ui/SeriousTerminalController.ts` | `history: string[]` | `history: SessionHistoryEntry[]` |
| Context bridge | `electron/terminal/preload.ts` | `getSessionHistory(...): Promise<string[]>` | `getSessionHistory(...): Promise<SessionHistoryEntry[]>` (impl + `Window.copilotBridge` type) |
| Main relay | `electron/terminal/ipc-relay.ts` | forwards `terminal-get-session-history` result | unchanged logic; forwarded result is now `SessionHistoryEntry[]` (type only) |
| Server handler | `electron/terminal/server.ts` `case 'get-session-history'` | `result: string[]` | `result: SessionHistoryEntry[]` (returns the coerced in-memory entries) |
| Persistence | `.data/{officeId}.sessions.json` `history[agentId]` | `string[]` | `SessionHistoryEntry[]` (legacy `string[]` still accepted on read) |

The `set(...)` for `get-all-session-meta` and the `session-meta-updated` server event are **not**
part of this contract and remain unchanged.

## Request/response examples

Request (main → server), unchanged:

```json
{ "type": "get-session-history", "requestId": "r-42", "officeId": "office-1", "agentId": "agent-1" }
```

Response (server → main), new shape — titled + untitled entries coexist:

```json
{
  "type": "response",
  "requestId": "r-42",
  "result": [
    { "id": "b1e...uuid1", "title": "fix the terminal copy bug" },
    { "id": "c2f...uuid2" },
    { "id": "d3a...uuid3", "title": "draft the demo fleet plan" }
  ]
}
```

Response when the agent has no history (unchanged from caller's perspective):

```json
{ "type": "response", "requestId": "r-42", "result": [] }
```

## Backward-compatibility guarantees

1. **Legacy read**: a persisted `history[agentId]` of bare strings is coerced element-wise to
   `{ id }` (no `title`) at load. No entry is dropped (FR-006, SC-004).
2. **Empty/whitespace title** in a persisted object is normalized to *absent* (`title`
   undefined) so the renderer applies the neutral fallback (FR-005).
3. **ID fidelity**: `id` is copied verbatim; it is never combined with the title or truncated
   (FR-007).
4. **No version negotiation**: the shape is self-describing (string element = legacy, object
   element = 019). No version field is added to the file.

## Renderer display contract (both surfaces, FR-014)

Given `SessionHistoryEntry[]`, each row MUST:

- show the entry `id` verbatim, selectable/copyable (`user-select: all` on the ID span);
- show `title` when present and non-empty, else the literal fallback text `Untitled session`;
- render `title` as **literal text** (`textContent` or escaped) — never interpreted as markup
  (FR-010);
- truncate an over-long title with a CSS ellipsis on a single line and expose the full title via
  the DOM `title` attribute (hover tooltip), without widening, wrapping, or horizontally
  scrolling the popover (FR-012a);
- preserve existing ordering (most-recent-first) and per-entry numbering (`#N`) (FR-013).

## Test-mock contract (`tests/setup/copilot-bridge-mock.ts`)

- Default `getSessionHistory` resolves to `[]` (assignable to `SessionHistoryEntry[]` — no
  change required to the default).
- Tests exercising populated history MUST supply entry objects, e.g.
  `getSessionHistory: vi.fn().mockResolvedValue([{ id: 'u1', title: 'T' }, { id: 'u2' }])`.
