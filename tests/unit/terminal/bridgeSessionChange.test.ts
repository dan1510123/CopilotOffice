import { describe, expect, it } from 'vitest';
import {
  applyBridgeSessionChange,
  type BridgeSessionData,
} from '../../../electron/terminal/bridge-session-change';

function officeData(overrides: Partial<BridgeSessionData> = {}): BridgeSessionData {
  return {
    sessionIds: new Map([['generalist', 'session-a'], ['debugger', 'session-d']]),
    sessionHistory: new Map([['generalist', [{ id: 'session-old', title: 'Old work' }]]]),
    sessionMeta: new Map([['generalist', { title: 'Refactor parser' }]]),
    ...overrides,
  };
}

describe('applyBridgeSessionChange (native bridge authoritative session)', () => {
  it('is a no-op when the bridge reports the session already current (initial connect / reconnect)', () => {
    const data = officeData();

    expect(applyBridgeSessionChange(data, 'generalist', 'session-a')).toEqual({ changed: false });
    expect(applyBridgeSessionChange(data, 'generalist', '  SESSION-A ')).toEqual({ changed: false });
    expect(data.sessionIds.get('generalist')).toBe('session-a');
    expect(data.sessionHistory.get('generalist')).toEqual([{ id: 'session-old', title: 'Old work' }]);
    expect(data.sessionMeta.get('generalist')).toEqual({ title: 'Refactor parser' });
  });

  it('archives the previous session exactly once and starts the /clear session untitled', () => {
    const data = officeData();

    const result = applyBridgeSessionChange(data, 'generalist', 'session-cleared');
    const repeat = applyBridgeSessionChange(data, 'generalist', 'session-cleared');

    expect(result).toEqual({
      changed: true,
      sessionId: 'session-cleared',
      previousSessionId: 'session-a',
      title: '',
      restoredFromHistory: false,
    });
    expect(repeat).toEqual({ changed: false });
    expect(data.sessionIds.get('generalist')).toBe('session-cleared');
    expect(data.sessionHistory.get('generalist')).toEqual([
      { id: 'session-old', title: 'Old work' },
      { id: 'session-a', title: 'Refactor parser' },
    ]);
    expect(data.sessionMeta.has('generalist')).toBe(false);
  });

  it('promotes a resumed archived session out of history and restores its title', () => {
    const data = officeData();

    const result = applyBridgeSessionChange(data, 'generalist', 'SESSION-OLD');

    expect(result).toEqual({
      changed: true,
      sessionId: 'SESSION-OLD',
      previousSessionId: 'session-a',
      title: 'Old work',
      restoredFromHistory: true,
    });
    expect(data.sessionHistory.get('generalist')).toEqual([{ id: 'session-a', title: 'Refactor parser' }]);
    expect(data.sessionMeta.get('generalist')).toEqual({ title: 'Old work' });
  });

  it('adopts the bridge session for an agent without a persisted id and flags cross-agent collisions', () => {
    const data = officeData({ sessionIds: new Map([['debugger', 'session-d']]) });

    const result = applyBridgeSessionChange(data, 'generalist', 'session-d');

    expect(result).toEqual({
      changed: true,
      sessionId: 'session-d',
      title: '',
      restoredFromHistory: false,
      collidesWithAgentId: 'debugger',
    });
    expect(data.sessionHistory.get('generalist')).toEqual([{ id: 'session-old', title: 'Old work' }]);
  });

  it('ignores an empty bridge session id', () => {
    const data = officeData();
    expect(applyBridgeSessionChange(data, 'generalist', '   ')).toEqual({ changed: false });
    expect(data.sessionIds.get('generalist')).toBe('session-a');
  });
});
