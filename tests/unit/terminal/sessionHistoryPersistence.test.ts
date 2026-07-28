import { describe, expect, it } from 'vitest';
import { coerceHistory, pushArchivedEntry } from '../../../electron/terminal/session-history';
import type { SessionHistoryEntry } from '../../../electron/terminal/protocol';

/**
 * Spec 019 — persistence & title immutability (quickstart cases 3 & 4; FR-002, FR-003).
 *
 * Mirrors server.ts semantics: archived entries are point-in-time snapshots, and the persisted
 * `history` object re-serializes to the 019 object shape via `Object.fromEntries` + JSON.
 */
describe('spec 019 — persistence & immutability', () => {
  it('archived title is unchanged after the current session title later changes (case 3)', () => {
    // Simulate the current session metadata the server snapshots from.
    const sessionMeta = new Map<string, { title: string }>([['agent-1', { title: 'Title A' }]]);
    const history: SessionHistoryEntry[] = [];

    pushArchivedEntry(history, 'sess-old', sessionMeta.get('agent-1')?.title);
    expect(history[0]).toEqual({ id: 'sess-old', title: 'Title A' });

    // Current session gets a new title; the archived snapshot must be untouched.
    sessionMeta.set('agent-1', { title: 'Title B (renamed current)' });
    expect(history[0]).toEqual({ id: 'sess-old', title: 'Title A' });
  });

  it('a coerced legacy array re-serializes to the object shape (case 4, FR-003)', () => {
    const sessionHistory = new Map<string, SessionHistoryEntry[]>();
    sessionHistory.set('agent-1', coerceHistory(['legacy-1', 'legacy-2']));

    // saveOfficeSessionFile does: { history: Object.fromEntries(data.sessionHistory) }.
    const persisted = JSON.parse(JSON.stringify({ history: Object.fromEntries(sessionHistory) }));

    expect(persisted.history['agent-1']).toEqual([{ id: 'legacy-1' }, { id: 'legacy-2' }]);
    // Every element is now an object (not a bare string) — the in-place upgrade.
    for (const entry of persisted.history['agent-1']) {
      expect(typeof entry).toBe('object');
      expect(entry).toHaveProperty('id');
    }

    // Reloading the just-saved object shape is stable (round-trips unchanged).
    expect(coerceHistory(persisted.history['agent-1'])).toEqual([{ id: 'legacy-1' }, { id: 'legacy-2' }]);
  });

  it('titled entries survive a save/load round-trip', () => {
    const original: SessionHistoryEntry[] = [
      { id: 'a', title: 'first' },
      { id: 'b' },
      { id: 'c', title: 'third' },
    ];
    const persisted = JSON.parse(JSON.stringify(Object.fromEntries(new Map([['agent-1', original]]))));
    expect(coerceHistory(persisted['agent-1'])).toEqual(original);
  });
});
