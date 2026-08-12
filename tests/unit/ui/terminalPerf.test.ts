import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  countTerminalPerfEntries,
  getTerminalPerfEntries,
  isTerminalPerfEnabled,
  perfMark,
  resetTerminalPerf,
  setTerminalPerfEnabled,
} from '../../../src/ui/terminalPerf';

describe('unit/terminalPerf', () => {
  beforeEach(() => {
    resetTerminalPerf();
    setTerminalPerfEnabled(true);
  });

  afterEach(() => {
    setTerminalPerfEnabled(false);
    resetTerminalPerf();
  });

  it('records nothing while disabled (zero-overhead no-op)', () => {
    setTerminalPerfEnabled(false);
    expect(isTerminalPerfEnabled()).toBe(false);
    perfMark('overlay', 'switch:request', 'office-0:generalist');
    perfMark('serious', 'switch:activate-done', 'office-0:debugger');
    expect(getTerminalPerfEntries()).toHaveLength(0);
  });

  it('records entries while enabled with monotonic sequence and preserved fields', () => {
    perfMark('overlay', 'switch:request', 'office-0:generalist');
    perfMark('overlay', 'switch:scrollback-write', 'office-0:generalist', 4096);

    const entries = getTerminalPerfEntries();
    expect(entries).toHaveLength(2);
    expect(entries[0].seq).toBe(0);
    expect(entries[1].seq).toBe(1);
    expect(entries[0]).toMatchObject({ surface: 'overlay', phase: 'switch:request', target: 'office-0:generalist' });
    expect(entries[1]).toMatchObject({ phase: 'switch:scrollback-write', value: 4096 });
    expect(typeof entries[0].t).toBe('number');
  });

  it('counts entries by phase with optional surface/target filters', () => {
    perfMark('overlay', 'switch:request', 'office-0:a');
    perfMark('overlay', 'switch:request', 'office-0:b');
    perfMark('serious', 'switch:request', 'office-0:a');

    expect(countTerminalPerfEntries('switch:request')).toBe(3);
    expect(countTerminalPerfEntries('switch:request', { surface: 'overlay' })).toBe(2);
    expect(countTerminalPerfEntries('switch:request', { target: 'office-0:a' })).toBe(2);
    expect(countTerminalPerfEntries('switch:request', { surface: 'serious', target: 'office-0:a' })).toBe(1);
    expect(countTerminalPerfEntries('switch:detach-done')).toBe(0);
  });

  it('bounds memory via the ring buffer (drops oldest beyond capacity)', () => {
    // Capacity is 512; push more and assert it never exceeds capacity and keeps newest.
    for (let i = 0; i < 600; i++) {
      perfMark('overlay', 'switch:request', `office-0:agent-${i}`);
    }
    const entries = getTerminalPerfEntries();
    expect(entries.length).toBeLessThanOrEqual(512);
    // Newest entry retained.
    expect(entries[entries.length - 1].target).toBe('office-0:agent-599');
    // Oldest were evicted.
    expect(entries.some((e) => e.target === 'office-0:agent-0')).toBe(false);
  });

  it('resetTerminalPerf clears entries and sequence', () => {
    perfMark('overlay', 'switch:request', 'office-0:a');
    resetTerminalPerf();
    expect(getTerminalPerfEntries()).toHaveLength(0);
    perfMark('overlay', 'switch:request', 'office-0:b');
    expect(getTerminalPerfEntries()[0].seq).toBe(0);
  });
});
