# Phase 1 Data Model: Restore a Previous Session from History

This feature introduces **no new persisted entity and no schema change**. It adds
one transient request/response contract and one pure state-transition operation
over existing in-memory maps. The persisted file shape stays `{ current, history,
metadata }`.

---

## Existing entities (unchanged shape)

### SessionHistoryEntry (`electron/terminal/protocol.ts`)

```ts
interface SessionHistoryEntry {
  id: string;        // opaque, stable, sole identifier — always present & copyable
  title?: string;    // human-readable snapshot from sessionMeta at archive time (spec 019); absent for legacy/no-title
}
```

Restore adds an *action* to an entry; it does NOT change the entry's stored shape
(Key Entity note in spec).

### Per-office in-memory session state (`server.ts` `OfficeSessionData`)

| Map | Key | Value | Role in restore |
|-----|-----|-------|-----------------|
| `sessionIds` | `agentId` | `string` (current session id) | The **Current Session Pointer**; restore moves it to the promoted id |
| `sessionHistory` | `agentId` | `SessionHistoryEntry[]` (oldest→newest) | Archive of past sessions; restore appends outgoing, removes promoted |
| `sessionMeta` | `agentId` | `{ title: string }` | Current session's display title; restore sets it from the promoted entry's title (or clears) |

Persisted form (`.data/copilot-office-sessions.json`): `{ current, history,
metadata }` — **no change** (FR-008).

---

## New transient contract entities

### Restore/Switch Request — `MsgRestoreSession` (`protocol.ts`, `MainToServer` union)

```ts
interface MsgRestoreSession {
  type: 'restore-session';
  requestId: string;
  officeId: string;
  agentId: string;
  sessionId: string;   // the target id being promoted (must exist in this agent's history)
}
```

### Restore response (`SrvResponse.result` payload)

```ts
// Success (swap completed):
{
  success: true;
  sessionId: string;                 // the now-current (promoted) id
  resumeContextUncertain?: boolean;  // FR-013: true when prior context can't be confirmed rehydrated
}

// Failure (no state change — collision guard or target-not-in-history):
{
  success: false;
  error: string;                     // operator-visible reason
}
```

### Bridge method (`preload.ts` + `Window.copilotBridge` type)

```ts
restoreSession(
  officeId: string,
  agentId: string,
  sessionId: string
): Promise<{ success: boolean; sessionId?: string; resumeContextUncertain?: boolean; error?: string }>;
```

---

## Pure state-transition operation

### `promoteHistoryEntry(history, sessionId)` (`session-history.ts`)

```ts
/**
 * Remove and return the history entry whose id === sessionId (the promoted entry).
 * Mutates `history` in place. Returns undefined if no matching entry exists.
 * Mirrors pushArchivedEntry: pure, no server import, unit-testable.
 */
export function promoteHistoryEntry(
  history: SessionHistoryEntry[],
  sessionId: string
): SessionHistoryEntry | undefined
```

**Invariants** (unit-tested — SC-004):
- Removes **exactly one** entry (the first id match); all other entries keep their
  order, number, title, and id (FR-014).
- Never duplicates an entry; a non-existent id returns `undefined` and leaves
  `history` untouched.
- ID matching is exact string equality (session id is authoritative; no
  normalization beyond what already exists on stored ids).

---

## Restore transition (server handler algorithm)

Ordered steps for `case 'restore-session'` in `server.ts` (see contract for full
detail):

1. **Validate** target `sessionId` exists in `sessionHistory[agentId]`. If not →
   `{ success: false, error: 'target session not in history' }` (no state change).
2. **No-op guard**: if target === current `sessionIds[agentId]` → return success
   without mutating history (target-equals-current edge case).
3. **Collision guard** (reuse existing): if target === another agent's current id
   in this office → `{ success: false, error: '…already in use…' }` (no state change).
4. **Archive current** via `archiveSessionId(officeId, agentId)` — snapshots the
   current title BEFORE any meta clear, dedupes by id (019 semantics, FR-005).
5. **Promote**: `const promoted = promoteHistoryEntry(history, target)` — removes
   the target from history (FR-006).
6. **Set current pointer**: `sessionIds[agentId] = target`.
7. **Restore title**: set `sessionMeta[agentId] = { title: promoted.title ?? '' }`
   (a legacy no-title entry clears the current title → neutral fallback, FR-011 back-compat).
   Emit `session-meta-updated` so the header updates.
8. **Restart PTY**: kill the live PTY (viewer/watcher/scrollback cleanup like the
   `kill` handler) so the next `start` relaunches `copilot --session-id=<target>`
   (R-001). Best-effort resume; compute `resumeContextUncertain` (FR-013).
9. **Persist**: `await saveOfficeSessionFile(officeId)` (FR-008 / SC-005).
10. **Respond** `{ success: true, sessionId: target, resumeContextUncertain }`.

### State transition diagram (per agent)

```text
Before:  current = B
         history = [ ..., A, ... ]           (A is the selected/target entry)
         meta.title = titleB

restore(A):
  archive B  → history gains { id:B, title:titleB }   (deduped)
  promote A  → history loses A
  current    → A
  meta.title → titleA (or '' if A had no title)

After:   current = A
         history = [ ..., B, ... ]           (A removed, B appended)
         meta.title = titleA
```

Round-trip `restore(B)` returns to the original mapping (SC-003).

---

## Edge-case behavior matrix

| Edge case (spec) | Data-model outcome |
|------------------|--------------------|
| Cancel confirmation | No IPC sent → zero state change (FR-004, SC-002) |
| Target equals current | Step 2 no-op: success, history unchanged, no duplicate |
| Target not in history | Step 1 reject: `success:false`, no state change |
| Target used by another agent | Step 3 reject: `success:false`, no state change (FR-009) |
| Empty history | No rows clickable; "No previous sessions" unchanged |
| Legacy promoted entry (no title) | Step 7 clears current title → neutral fallback |
| Rapid double-confirm | Renderer in-flight latch (FR-010) + steps 1–3 idempotency |
| Restart after switch | Step 9 persists new `{ current, history, metadata }` (SC-005) |
| Resume can't rehydrate | Step 8 sets `resumeContextUncertain` → renderer shows advisory (FR-013, SC-006) |
| ID text selected/copied | Row `onSelect` not triggered; id span stops propagation (FR-007) |
