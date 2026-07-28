// Session-history pure helpers (spec 019).
//
// Extracted from server.ts so the coercion / snapshot / dedupe logic is unit-testable
// without importing server.ts (which calls main() at import time and owns PTY state).
// Same pattern as session-repair.ts / agent-viewers.ts.

import type { SessionHistoryEntry } from './protocol';

/**
 * Normalize a title value: trim strings; empty/whitespace (or non-string) → undefined.
 * An empty/whitespace title is treated as "no title" so the renderer applies its fallback
 * (FR-005).
 */
export function normalizeTitle(t: unknown): string | undefined {
  const s = typeof t === 'string' ? t.trim() : '';
  return s ? s : undefined;
}

/**
 * Coerce a persisted `history[agentId]` array (unknown shape) into `SessionHistoryEntry[]`.
 * - Legacy bare-string entries → `{ id }` (no title).
 * - Object entries → `{ id: String(id), title: normalizeTitle(title) }`.
 * - Entries with an empty id are dropped; ID coercion is otherwise lossless (FR-006, SC-004).
 */
export function coerceHistory(raw: unknown): SessionHistoryEntry[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((e): SessionHistoryEntry => {
      if (typeof e === 'string') return { id: e };
      const id = String((e as SessionHistoryEntry)?.id ?? '');
      const title = normalizeTitle((e as SessionHistoryEntry)?.title);
      return title ? { id, title } : { id };
    })
    .filter((e) => e.id.length > 0);
}

/**
 * Append an archived entry for `oldId` to `history`, snapshotting `currentTitle` at archive time.
 *
 * - Dedupes by `id`: a re-archive of an id already present is a no-op — it neither appends a
 *   duplicate nor overwrites an existing real title with an empty one (spec 019).
 * - The stored entry is a fresh object (point-in-time snapshot), so later changes to the current
 *   session title do NOT mutate the archived entry (title immutability, FR-002).
 *
 * Mutates and returns `history`.
 */
export function pushArchivedEntry(
  history: SessionHistoryEntry[],
  oldId: string,
  currentTitle: unknown
): SessionHistoryEntry[] {
  if (!oldId) return history;
  if (history.some((e) => e.id === oldId)) return history;
  const title = normalizeTitle(currentTitle);
  history.push(title ? { id: oldId, title } : { id: oldId });
  return history;
}
