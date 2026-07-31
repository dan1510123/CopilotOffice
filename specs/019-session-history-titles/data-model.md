# Phase 1 Data Model: Titled Session History Entries

## Entity: `SessionHistoryEntry`

One archived session for a given agent within a given office.

| Field   | Type               | Required | Notes |
|---------|--------------------|----------|-------|
| `id`    | `string`           | Yes      | Opaque, stable session identifier (UUID). The sole identifier; never derived from or matched against the title. Must remain exact and copyable (FR-007). |
| `title` | `string \| undefined` | No    | Point-in-time snapshot of the agent's `sessionMeta.title` at archive time (auto-derived from first user message, ≤80 chars). Absent for legacy/never-titled sessions. Immutable once recorded (FR-002, FR-011, FR-012). |

TypeScript definition (to add in `electron/terminal/protocol.ts`):

```ts
/** One archived session in an agent's history (spec 019). */
export interface SessionHistoryEntry {
  /** Opaque, stable session identifier — the sole identifier, always present & copyable. */
  id: string;
  /**
   * Human-readable title snapshotted from sessionMeta at archive time.
   * Optional: absent for legacy (pre-019) records and sessions archived with no title.
   */
  title?: string;
}
```

### Validation & invariants

- `id` is always present and non-empty (an entry is only created from an existing session ID).
- `title`, when present, is already ≤80 chars (it is a copy of the existing `sessionMeta.title`,
  which server.ts truncates at 80 with a `...` suffix). No new truncation/derivation is added
  at the data layer.
- Empty or whitespace-only `title` is treated as **no title** (fallback applies) — normalize by
  trimming at snapshot time and storing `undefined` when the result is empty.
- Entries for one agent are ordered oldest→newest in the array (append on archive), matching the
  existing `history.push(oldId)` order; renderers iterate in reverse for most-recent-first
  display (FR-013).
- Uniqueness: an entry whose `id` already exists in the agent's array is **not** appended again;
  a re-archive must not replace an existing real title with an empty one (dedupe by `id`).

## In-memory model (`electron/terminal/server.ts`)

`OfficeSessionData.sessionHistory` changes value type:

```ts
interface OfficeSessionData {
  sessionIds: Map<string, string>;                 // agentId → current sessionId (unchanged)
  sessionHistory: Map<string, SessionHistoryEntry[]>; // agentId → archived entries (CHANGED)
  sessionMeta: Map<string, { title: string }>;     // agentId → current-session metadata (unchanged)
}
```

## Persisted model — `.data/{officeId}.sessions.json`

Top-level shape is unchanged: `{ current, history, metadata }`. Only the element type of each
`history[agentId]` array changes.

### New (spec 019) shape

```jsonc
{
  "current":  { "agent-1": "uuid-current" },
  "history":  {
    "agent-1": [
      { "id": "uuid-old-1", "title": "fix the terminal copy bug" },
      { "id": "uuid-old-2", "title": "draft the demo fleet plan" },
      { "id": "uuid-old-3" }                       // archived while untitled → fallback on render
    ]
  },
  "metadata": { "agent-1": { "title": "current session title" } }
}
```

### Legacy (pre-019) shape — must still load (FR-006)

```jsonc
{
  "current":  { "agent-1": "uuid-current" },
  "history":  { "agent-1": ["uuid-old-1", "uuid-old-2"] },  // bare string IDs
  "metadata": { "agent-1": { "title": "..." } }
}
```

## Migration / coercion rule

Applied per-agent inside `loadOfficeSessionFile()` when building the `sessionHistory` map:

```ts
function coerceHistory(raw: unknown): SessionHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((e) =>
    typeof e === 'string'
      ? { id: e }                                   // legacy ID-only → no title
      : { id: String((e as SessionHistoryEntry).id),
          title: normalizeTitle((e as SessionHistoryEntry).title) }
  ).filter((e) => e.id.length > 0);
}

function normalizeTitle(t: unknown): string | undefined {
  const s = typeof t === 'string' ? t.trim() : '';
  return s ? s : undefined;                         // empty/whitespace → undefined (fallback)
}
```

- Coercion is **lossless for IDs** (no entry dropped — SC-004, FR-006).
- The next `saveOfficeSessionFile()` writes the object shape, performing the in-place upgrade
  transparently (same pattern as the existing legacy-flat-format rewrite and V3 repair path).
- The legacy top-level flat format (`{ agentId: sessionId }`) path already sets
  `sessionHistory = new Map()` and is unaffected.

## Snapshot rule (`archiveSessionId`)

```ts
function archiveSessionId(officeId: string, agentId: string): void {
  const data = getOfficeSession(officeId);
  const oldId = data.sessionIds.get(agentId);
  if (!oldId) return;
  const history = data.sessionHistory.get(agentId) || [];
  if (history.some((e) => e.id === oldId)) return;  // dedupe by id (no double-archive)
  const title = normalizeTitle(data.sessionMeta.get(agentId)?.title); // point-in-time snapshot
  history.push(title ? { id: oldId, title } : { id: oldId });
  data.sessionHistory.set(agentId, history);
}
```

## State transitions

```
(no history)                      ── first archive ──▶ [ {id, title?} ]
[ ...entries ]                    ── archive ────────▶ [ ...entries, {id, title?} ]   (append, dedupe by id)
[ ...entries ]                    ── clear-history ──▶ (agent key deleted → titles removed too, FR-008)
[ ...entries in office A ]        ── transfer ───────▶ deep-copied into office B (titles carried, FR-009)
```

- **Clear** (`clear-session-history`): `sessionHistory.delete(agentId)` already removes the whole
  array; because titles live *inside* the entries, no title data is orphaned (FR-008). No code
  change needed beyond the type.
- **Transfer** (`transfer-session`): existing `toData.sessionHistory.set(agentId, [...history])`
  shallow-copies the array of entry objects; entries are immutable snapshots so the shallow copy
  carries titles correctly (FR-009). Objects are never mutated after creation, so no deep clone
  is required; the plain-object entries are structured-clone-safe across the process IPC boundary.

## Wire model

The `get-session-history` response, the preload `getSessionHistory` return type, and the
`ipc-relay` handler forward `SessionHistoryEntry[]`. See
[`contracts/session-history-protocol.md`](./contracts/session-history-protocol.md).

## Non-entities (explicitly unchanged)

- `sessionMeta` (`{ title: string }`) — the *current* session's title. This feature reads it at
  archive time but does not change its shape or lifecycle.
- `sessionIds` (current session per agent) — unchanged; the ID remains the sole identifier.
- Retention limits, archive triggers, and clear/reset semantics — unchanged apart from titles
  now travelling inside history entries.
