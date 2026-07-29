import { describe, expect, it } from 'vitest';
import { pushArchivedEntry } from '../../../electron/terminal/session-history';
import type { SessionHistoryEntry } from '../../../electron/terminal/protocol';

/**
 * Spec 019 — archive-time snapshot + dedupe (quickstart cases 1 & 6).
 *
 * `pushArchivedEntry` is the pure core of server.ts `archiveSessionId`: it snapshots the
 * current session title into the pushed entry and dedupes by id.
 */
describe('spec 019 — archiveSessionId snapshot + dedupe', () => {
  it('snapshots the current sessionMeta title into the pushed entry (case 1)', () => {
    const history: SessionHistoryEntry[] = [];
    pushArchivedEntry(history, 'sess-1', 'fix the terminal copy bug');
    expect(history).toEqual([{ id: 'sess-1', title: 'fix the terminal copy bug' }]);
  });

  it('archiving an untitled session yields { id } with no title (case 2)', () => {
    const history: SessionHistoryEntry[] = [];
    pushArchivedEntry(history, 'sess-1', undefined);
    pushArchivedEntry(history, 'sess-2', '   '); // whitespace-only → no title
    expect(history).toEqual([{ id: 'sess-1' }, { id: 'sess-2' }]);
    expect(history[0]).not.toHaveProperty('title');
  });

  it('does not append a duplicate when the id is already present (case 6)', () => {
    const history: SessionHistoryEntry[] = [{ id: 'sess-1', title: 'original title' }];
    pushArchivedEntry(history, 'sess-1', 'a different current title');
    expect(history).toHaveLength(1);
    // Existing real title is NOT overwritten by a re-archive.
    expect(history[0]).toEqual({ id: 'sess-1', title: 'original title' });
  });

  it('does not overwrite an existing real title with an empty one on re-archive (case 6)', () => {
    const history: SessionHistoryEntry[] = [{ id: 'sess-1', title: 'original title' }];
    pushArchivedEntry(history, 'sess-1', '');
    expect(history).toEqual([{ id: 'sess-1', title: 'original title' }]);
  });

  it('appends distinct ids in oldest→newest order', () => {
    const history: SessionHistoryEntry[] = [];
    pushArchivedEntry(history, 'a', 'Title A');
    pushArchivedEntry(history, 'b', undefined);
    pushArchivedEntry(history, 'c', 'Title C');
    expect(history.map((e) => e.id)).toEqual(['a', 'b', 'c']);
  });

  // Regression: the reset-session path in server.ts must archive (snapshot the
  // title) BEFORE clearing sessionMeta, otherwise the archived entry loses its
  // title. This models that call ordering against the same map + helper the
  // server uses. (Reproduces the "closed a session, title not saved" bug.)
  it('archives the title before sessionMeta is cleared on reset (ordering)', () => {
    const sessionMeta = new Map<string, { title: string }>([
      ['dan', { title: 'debug the reset flow' }],
    ]);
    const history: SessionHistoryEntry[] = [];

    // Correct order: snapshot first…
    pushArchivedEntry(history, 'sess-1', sessionMeta.get('dan')?.title);
    // …then clear metadata for the new session.
    sessionMeta.delete('dan');

    expect(history).toEqual([{ id: 'sess-1', title: 'debug the reset flow' }]);
  });

  it('demonstrates the bug when meta is cleared before archiving (ordering)', () => {
    const sessionMeta = new Map<string, { title: string }>([
      ['dan', { title: 'debug the reset flow' }],
    ]);
    const history: SessionHistoryEntry[] = [];

    // Wrong order (the fixed bug): delete first, snapshot reads nothing.
    sessionMeta.delete('dan');
    pushArchivedEntry(history, 'sess-1', sessionMeta.get('dan')?.title);

    expect(history[0]).not.toHaveProperty('title');
  });
});
