import { describe, it, expect } from 'vitest';
import {
  officeOf,
  shouldForwardSharedHostData,
  viewersToDeactivate,
  foregroundAfterStart,
  shouldReassertForeground,
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

// Anti-hijack invariant for cross-office Teams cold-warm (warmAllTeamsBoundAgents):
// under the shared ui-server host, a background warm/start of a non-viewed agent
// must NOT seize the office foreground (input ownership) from the agent the user
// is actually viewing.
describe('foregroundAfterStart', () => {
  it('claims foreground when the office has none yet', () => {
    expect(foregroundAfterStart(undefined, 'office-0:a')).toBe('office-0:a');
  });

  it('never overwrites an existing foreground with a background-started agent', () => {
    // Viewer is on office-0:a; a Teams cold-warm starts office-0:b in the same
    // office. The viewed agent must keep foreground.
    expect(foregroundAfterStart('office-0:a', 'office-0:b')).toBe('office-0:a');
  });

  it('is idempotent when the foreground agent itself restarts', () => {
    expect(foregroundAfterStart('office-0:a', 'office-0:a')).toBe('office-0:a');
  });
});

describe('shouldReassertForeground', () => {
  it('re-asserts when a different agent starts under a recorded foreground', () => {
    // Background warm of office-0:b while office-0:a is the viewer's foreground
    // → the viewed agent's foreground must be re-asserted so input isn't stolen.
    expect(shouldReassertForeground('office-0:a', 'office-0:b')).toBe(true);
  });

  it('does not re-assert when the foreground agent is the one starting', () => {
    expect(shouldReassertForeground('office-0:a', 'office-0:a')).toBe(false);
  });

  it('does not re-assert when no foreground is recorded', () => {
    // First start in an office establishes foreground; nothing to protect yet.
    expect(shouldReassertForeground(undefined, 'office-0:a')).toBe(false);
  });
});
