import { describe, expect, it } from 'vitest';
import {
  promoteHistoryEntry,
  pushArchivedEntry,
} from '../../../electron/terminal/session-history';
import type { SessionHistoryEntry } from '../../../electron/terminal/protocol';

/**
 * Spec 020 — `promoteHistoryEntry` pure helper (contracts/restore-session.md §3, R-004).
 *
 * The mutating core of the server's `restore-session` handler: remove and return the target
 * archived entry, preserving the order/contents of everything else. Unit-testable without
 * importing server.ts (which runs main() on import), mirroring `pushArchivedEntry`.
 */
describe('spec 020 — promoteHistoryEntry', () => {
  it('removes exactly the matching entry and returns it', () => {
    const history: SessionHistoryEntry[] = [
      { id: 'a', title: 'Alpha' },
      { id: 'b', title: 'Beta' },
      { id: 'c' },
    ];
    const promoted = promoteHistoryEntry(history, 'b');
    expect(promoted).toEqual({ id: 'b', title: 'Beta' });
    expect(history).toEqual([{ id: 'a', title: 'Alpha' }, { id: 'c' }]);
  });

  it('returns undefined and leaves history unchanged when the id is absent (no-op)', () => {
    const history: SessionHistoryEntry[] = [{ id: 'a' }, { id: 'b', title: 'Beta' }];
    const snapshot = JSON.parse(JSON.stringify(history));
    const promoted = promoteHistoryEntry(history, 'missing');
    expect(promoted).toBeUndefined();
    expect(history).toEqual(snapshot);
    expect(history).toHaveLength(2);
  });

  it('preserves order/number/title/id of all other entries', () => {
    const history: SessionHistoryEntry[] = [
      { id: 'a', title: 'A' },
      { id: 'b', title: 'B' },
      { id: 'c', title: 'C' },
      { id: 'd' },
    ];
    promoteHistoryEntry(history, 'c');
    expect(history).toEqual([{ id: 'a', title: 'A' }, { id: 'b', title: 'B' }, { id: 'd' }]);
  });

  it('uses exact-string equality (no normalization)', () => {
    const history: SessionHistoryEntry[] = [{ id: 'ABC' }, { id: 'abc' }];
    // Lowercase target matches only the exact lowercase entry.
    const promoted = promoteHistoryEntry(history, 'abc');
    expect(promoted).toEqual({ id: 'abc' });
    expect(history).toEqual([{ id: 'ABC' }]);
  });

  it('removes only the first match when ids are duplicated (dedupe-safe)', () => {
    const history: SessionHistoryEntry[] = [{ id: 'dup' }, { id: 'other' }, { id: 'dup' }];
    const promoted = promoteHistoryEntry(history, 'dup');
    expect(promoted).toEqual({ id: 'dup' });
    expect(history).toEqual([{ id: 'other' }, { id: 'dup' }]);
  });
});

/**
 * Spec 020 — swap semantics (no-loss / no-dup / round-trip). Models the server's mutate path
 * (archive-current → promote-target → set-current) using the same pure helpers the handler
 * calls, so the invariants can be asserted without importing server.ts.
 */
describe('spec 020 — restore swap semantics (archive + promote composition)', () => {
  /** Mirror the handler's mutate path steps 4–6 against plain state. */
  function swap(
    state: { current: string; history: SessionHistoryEntry[]; meta: Map<string, string> },
    agentId: string,
    target: string
  ): void {
    // (4) archive current with its title snapshot + dedupe by id (019 archiveSessionId core).
    pushArchivedEntry(state.history, state.current, state.meta.get(agentId));
    // (5) promote target out of history.
    const promoted = promoteHistoryEntry(state.history, target);
    // (6) set current pointer.
    state.current = target;
    // (7) restore promoted title into meta (legacy no-title clears).
    if (promoted?.title) state.meta.set(agentId, promoted.title);
    else state.meta.delete(agentId);
  }

  it('swap is lossless: the previously-current session appears in history, the target does not', () => {
    const state = {
      current: 'B',
      history: [{ id: 'A', title: 'Alpha' }] as SessionHistoryEntry[],
      meta: new Map<string, string>([['dan', 'Beta']]),
    };
    swap(state, 'dan', 'A');
    expect(state.current).toBe('A');
    expect(state.history.some((e) => e.id === 'A')).toBe(false);
    expect(state.history).toContainEqual({ id: 'B', title: 'Beta' });
    // Restored title moved into meta.
    expect(state.meta.get('dan')).toBe('Alpha');
  });

  it('round-trip restore returns to the original { current, history } mapping (SC-003)', () => {
    const state = {
      current: 'B',
      history: [{ id: 'A', title: 'Alpha' }] as SessionHistoryEntry[],
      meta: new Map<string, string>([['dan', 'Beta']]),
    };
    // Restore A…
    swap(state, 'dan', 'A');
    // …then switch back to B.
    swap(state, 'dan', 'B');
    expect(state.current).toBe('B');
    expect(state.history).toEqual([{ id: 'A', title: 'Alpha' }]);
    expect(state.meta.get('dan')).toBe('Beta');
  });

  it('entry count is stable across repeated switches — nothing lost or duplicated (SC-004)', () => {
    const state = {
      current: 'C',
      history: [{ id: 'A', title: 'Alpha' }, { id: 'B', title: 'Beta' }] as SessionHistoryEntry[],
      meta: new Map<string, string>([['dan', 'Gamma']]),
    };
    // history has 2 + current = 3 distinct sessions total; that invariant must hold.
    const total = () => state.history.length + 1;
    expect(total()).toBe(3);
    swap(state, 'dan', 'A'); // A promoted, C archived
    expect(total()).toBe(3);
    swap(state, 'dan', 'B'); // B promoted, A archived
    expect(total()).toBe(3);
    const ids = new Set([state.current, ...state.history.map((e) => e.id)]);
    expect(ids).toEqual(new Set(['A', 'B', 'C']));
  });
});
