import { describe, it, expect } from 'vitest';
import {
  officeOf,
  shouldForwardSharedHostData,
  viewersToDeactivate,
} from '../../../electron/terminal/office-foreground';

describe('officeOf', () => {
  it('extracts the office id from a composite key', () => {
    expect(officeOf('office-0:generalist')).toBe('office-0');
  });

  it('returns the whole string when there is no separator', () => {
    expect(officeOf('bare')).toBe('bare');
  });
});

describe('shouldForwardSharedHostData', () => {
  it('forwards for the foreground agent', () => {
    expect(shouldForwardSharedHostData('office-0:a', 'office-0:a')).toBe(true);
  });

  it('drops for a non-foreground agent (prevents cross-session leak)', () => {
    expect(shouldForwardSharedHostData('office-0:a', 'office-0:b')).toBe(false);
  });

  it('fails open when no foreground is recorded', () => {
    expect(shouldForwardSharedHostData('office-0:a', undefined)).toBe(true);
  });
});

describe('viewersToDeactivate', () => {
  it('returns other active viewers in the same office', () => {
    const active = ['office-0:a', 'office-0:b', 'office-0:c'];
    expect(viewersToDeactivate('office-0', 'office-0:a', null, active).sort()).toEqual([
      'office-0:b',
      'office-0:c',
    ]);
  });

  it('never returns the activated agent itself', () => {
    const active = ['office-0:a'];
    expect(viewersToDeactivate('office-0', 'office-0:a', null, active)).toEqual([]);
  });

  it('never returns the activated agent dual-key alias', () => {
    const active = ['office-fleet:a', 'office-0:a'];
    // Attaching in office-fleet under alias office-0:a must not deactivate the alias.
    expect(viewersToDeactivate('office-fleet', 'office-fleet:a', 'office-0:a', active)).toEqual([]);
  });

  it('leaves viewers in other offices untouched', () => {
    const active = ['office-0:a', 'office-1:x', 'office-1:y'];
    expect(viewersToDeactivate('office-0', 'office-0:a', null, active)).toEqual([]);
  });

  it('returns nothing when the activated agent is the only viewer', () => {
    expect(viewersToDeactivate('office-0', 'office-0:a', null, [])).toEqual([]);
  });
});
