import { describe, expect, it } from 'vitest';
import { normalizeHandle, assignHandle } from '../../../electron/teams/handleRegistry';

describe('normalizeHandle', () => {
  it('lowercases and strips non-alphanumerics', () => {
    expect(normalizeHandle('Gene')).toBe('gene');
    expect(normalizeHandle('Dan the Debugger!')).toBe('danthedebugger');
    expect(normalizeHandle('Agent-007')).toBe('agent007');
  });

  it('returns empty string for names with no alnum chars', () => {
    expect(normalizeHandle('***')).toBe('');
    expect(normalizeHandle('')).toBe('');
  });
});

describe('assignHandle', () => {
  it('returns the base when free', () => {
    expect(assignHandle('gene', new Set())).toBe('gene');
  });

  it('suffixes on collision', () => {
    const taken = new Set(['gene']);
    expect(assignHandle('gene', taken)).toBe('gene-1');
    taken.add('gene-1');
    expect(assignHandle('gene', taken)).toBe('gene-2');
  });

  it('throws for an empty base', () => {
    expect(() => assignHandle('', new Set())).toThrow();
  });
});
