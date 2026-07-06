import { describe, expect, it } from 'vitest';
import { classifyThread, resolveChannel, activeChannelSet } from '../../../electron/teams/channelResolver';
import type { OnlineAgentBinding, KnownThread } from '../../../electron/teams/types';

function binding(overrides: Partial<OnlineAgentBinding>): OnlineAgentBinding {
  return {
    agentId: 'generalist',
    officeId: 'office-0',
    sessionId: 's1',
    handle: 'gene',
    displayName: 'Gene',
    workingDir: '.',
    sessionTitle: '',
    teamId: 'team',
    channelId: 'chanA',
    tenantId: 'tenant',
    threadRootId: 'root1',
    online: true,
    lastConnected: Date.now(),
    ...overrides,
  };
}

describe('resolveChannel', () => {
  it('prefers the office override over the default', () => {
    expect(resolveChannel({ teamsChannelUrl: 'override' }, { defaultChannelUrl: 'default' })).toBe('override');
  });
  it('falls back to the default when no override', () => {
    expect(resolveChannel({}, { defaultChannelUrl: 'default' })).toBe('default');
    expect(resolveChannel({ teamsChannelUrl: '  ' }, { defaultChannelUrl: 'default' })).toBe('default');
  });
  it('returns empty when neither is set', () => {
    expect(resolveChannel({}, { defaultChannelUrl: '' })).toBe('');
  });
});

describe('activeChannelSet', () => {
  it('collects distinct channels of online bindings only', () => {
    const set = activeChannelSet([
      binding({ channelId: 'chanA', online: true }),
      binding({ channelId: 'chanB', online: true }),
      binding({ channelId: 'chanC', online: false }),
    ]);
    expect([...set].sort()).toEqual(['chanA', 'chanB']);
  });
});

describe('classifyThread', () => {
  const bindings = [binding({ channelId: 'chanA', threadRootId: 'root1' })];
  const known: KnownThread[] = [
    { threadRootId: 'root1', noticePosted: false },
    { threadRootId: 'oldRoot', noticePosted: false },
  ];

  it('bound when an online binding owns (channel, root)', () => {
    expect(classifyThread('chanA', 'root1', bindings, known)).toBe('bound');
  });

  it('orphaned when the app created the thread but has no online binding', () => {
    expect(classifyThread('chanA', 'oldRoot', bindings, known)).toBe('orphaned');
  });

  it('foreign for a thread the app never created', () => {
    expect(classifyThread('chanA', 'strangerRoot', bindings, known)).toBe('foreign');
  });
});
