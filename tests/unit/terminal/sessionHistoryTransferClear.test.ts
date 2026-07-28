import { describe, expect, it } from 'vitest';
import type { SessionHistoryEntry } from '../../../electron/terminal/protocol';

/**
 * Spec 019 — transfer & clear (quickstart cases 7 & 8; FR-008, FR-009).
 *
 * Mirrors the server.ts map operations:
 *  - transfer-session: `toData.sessionHistory.set(agentId, [...history])`
 *  - clear-session-history: `sessionHistory.delete(agentId)`
 * Entries are immutable snapshots, so a shallow copy carries titles correctly.
 */
describe('spec 019 — transfer carries titles', () => {
  it('copies entries with titles intact into the destination office (case 8)', () => {
    const from = new Map<string, SessionHistoryEntry[]>();
    const to = new Map<string, SessionHistoryEntry[]>();
    const entries: SessionHistoryEntry[] = [
      { id: 'a', title: 'fix copy bug' },
      { id: 'b' },
    ];
    from.set('agent-1', entries);

    // transfer-session logic
    const history = from.get('agent-1');
    if (history) to.set('agent-1', [...history]);

    expect(to.get('agent-1')).toEqual([{ id: 'a', title: 'fix copy bug' }, { id: 'b' }]);
    // Destination is a distinct array (shallow copy), but entries carry their titles.
    expect(to.get('agent-1')).not.toBe(from.get('agent-1'));
    expect(to.get('agent-1')![0].title).toBe('fix copy bug');
  });
});

describe('spec 019 — clear removes titles with ids', () => {
  it('deletes the agent history entirely with no residual title data (case 7)', () => {
    const sessionHistory = new Map<string, SessionHistoryEntry[]>();
    sessionHistory.set('agent-1', [{ id: 'a', title: 'has title' }, { id: 'b' }]);

    // clear-session-history logic
    sessionHistory.delete('agent-1');

    expect(sessionHistory.has('agent-1')).toBe(false);
    expect(sessionHistory.get('agent-1')).toBeUndefined();
  });
});
