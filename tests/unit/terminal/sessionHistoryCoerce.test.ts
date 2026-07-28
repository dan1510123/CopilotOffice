import { describe, expect, it } from 'vitest';
import { coerceHistory, normalizeTitle, pushArchivedEntry } from '../../../electron/terminal/session-history';
import type { SessionHistoryEntry } from '../../../electron/terminal/protocol';

/**
 * Spec 019 — legacy coercion & title normalization (quickstart cases 2, 4, 5; FR-006).
 */
describe('spec 019 — coerceHistory / normalizeTitle', () => {
  it('turns a bare-string legacy history into { id }[] with zero entries lost (case 4)', () => {
    const legacy = ['uuid-old-1', 'uuid-old-2', 'uuid-old-3'];
    const result = coerceHistory(legacy);
    expect(result).toEqual([
      { id: 'uuid-old-1' },
      { id: 'uuid-old-2' },
      { id: 'uuid-old-3' },
    ]);
    expect(result).toHaveLength(legacy.length);
  });

  it('normalizes a persisted { id, title: "   " } to title undefined (case 5)', () => {
    const result = coerceHistory([{ id: 'u1', title: '   ' }]);
    expect(result).toEqual([{ id: 'u1' }]);
    expect(result[0]).not.toHaveProperty('title');
  });

  it('keeps a real persisted title and coerces id to string', () => {
    const result = coerceHistory([{ id: 'u1', title: 'draft the demo fleet plan' }, { id: 2 as unknown as string }]);
    expect(result).toEqual([
      { id: 'u1', title: 'draft the demo fleet plan' },
      { id: '2' },
    ]);
  });

  it('drops entries with an empty id but keeps every valid id', () => {
    const result = coerceHistory(['', { id: '' }, { id: 'good', title: 'ok' }]);
    expect(result).toEqual([{ id: 'good', title: 'ok' }]);
  });

  it('returns [] for non-array input', () => {
    expect(coerceHistory(undefined)).toEqual([]);
    expect(coerceHistory(null)).toEqual([]);
    expect(coerceHistory({})).toEqual([]);
  });

  it('normalizeTitle trims and maps empty/whitespace/non-string to undefined', () => {
    expect(normalizeTitle('  hi  ')).toBe('hi');
    expect(normalizeTitle('   ')).toBeUndefined();
    expect(normalizeTitle('')).toBeUndefined();
    expect(normalizeTitle(undefined)).toBeUndefined();
    expect(normalizeTitle(42)).toBeUndefined();
  });

  it('archiving an untitled session yields { id } (case 2)', () => {
    const history: SessionHistoryEntry[] = [];
    pushArchivedEntry(history, 'sess-x', undefined);
    expect(history).toEqual([{ id: 'sess-x' }]);
  });
});
