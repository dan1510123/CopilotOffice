import { describe, expect, it } from 'vitest';
import { gcStale } from '../../../electron/teams/onlineAgentsStore';
import type { OnlineAgentBinding } from '../../../electron/teams/types';

function b(id: string, lastConnected: number): OnlineAgentBinding {
  return {
    agentId: id,
    officeId: 'office-0',
    sessionId: 's',
    handle: id,
    displayName: id,
    workingDir: '.',
    sessionTitle: '',
    teamId: 't',
    channelId: 'c',
    tenantId: 'tn',
    threadRootId: 'r',
    online: true,
    lastConnected,
  };
}

describe('gcStale', () => {
  const now = 1_000_000_000_000;
  const thirtyDays = 30 * 24 * 60 * 60 * 1000;

  it('removes bindings older than 30 days, keeps fresh ones', () => {
    const fresh = b('fresh', now - 1000);
    const stale = b('stale', now - thirtyDays - 1);
    const { kept, removed } = gcStale([fresh, stale], now);
    expect(kept.map((x) => x.agentId)).toEqual(['fresh']);
    expect(removed.map((x) => x.agentId)).toEqual(['stale']);
  });

  it('keeps a binding exactly at the boundary', () => {
    const edge = b('edge', now - thirtyDays);
    const { kept } = gcStale([edge], now);
    expect(kept).toHaveLength(1);
  });
});
