import { describe, expect, it, vi } from 'vitest';
import { evictUnbridgedReusedTerminal } from '../../../electron/terminal/unbridged-recovery';

describe('evictUnbridgedReusedTerminal', () => {
  it('removes only the expected terminal after a successful kill', () => {
    const expected = { pid: 1 };
    const processes = new Map([['office-0:agent', expected]]);
    const aliases = new Map([['office-0:agent', 'office-0:agent']]);
    const kill = vi.fn(() => true);

    expect(evictUnbridgedReusedTerminal(
      processes,
      aliases,
      'office-0:agent',
      expected,
      kill,
    )).toBe(true);

    expect(kill).toHaveBeenCalledWith(expected);
    expect(processes).toEqual(new Map());
    expect(aliases).toEqual(new Map());
  });

  it('preserves mappings when the process changed or cannot be killed', () => {
    const expected = { pid: 1 };
    const replacement = { pid: 2 };
    const processes = new Map([['office-0:agent', replacement]]);
    const aliases = new Map([['office-0:agent', 'office-0:agent']]);
    const kill = vi.fn(() => false);

    expect(evictUnbridgedReusedTerminal(
      processes,
      aliases,
      'office-0:agent',
      expected,
      kill,
    )).toBe(false);

    expect(kill).not.toHaveBeenCalled();
    expect(processes.get('office-0:agent')).toBe(replacement);
    expect(aliases.get('office-0:agent')).toBe('office-0:agent');
  });

  it('preserves mappings when the kill fails', () => {
    const expected = { pid: 1 };
    const processes = new Map([['office-0:agent', expected]]);
    const aliases = new Map([['office-0:agent', 'office-0:agent']]);

    expect(evictUnbridgedReusedTerminal(
      processes,
      aliases,
      'office-0:agent',
      expected,
      () => false,
    )).toBe(false);

    expect(processes.get('office-0:agent')).toBe(expected);
    expect(aliases.get('office-0:agent')).toBe('office-0:agent');
  });

  it('removes every alias that points at the recovered terminal', () => {
    const expected = { pid: 1 };
    const processes = new Map([['office-0:agent', expected]]);
    const aliases = new Map([
      ['office-0:agent', 'office-0:agent'],
      ['fleet:agent', 'office-0:agent'],
      ['office-1:other', 'office-1:other'],
    ]);

    expect(evictUnbridgedReusedTerminal(
      processes,
      aliases,
      'office-0:agent',
      expected,
      () => true,
    )).toBe(true);

    expect(aliases).toEqual(new Map([['office-1:other', 'office-1:other']]));
  });
});
