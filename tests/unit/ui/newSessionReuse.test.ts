import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  canReuseLivePtyForNewSession,
  reuseLivePtyForNewSession,
  resetNewSessionBackendCache,
} from '../../../src/ui/newSessionReuse';

function makeBridge(overrides: Partial<{
  backend: string | null;
  statuses: Record<string, { alive: boolean }>;
  writeResult: { success: boolean; error?: string };
  getBackendInfo: () => Promise<{ name: string } | null>;
  queryAgentStatuses: (officeId?: string) => Promise<Record<string, { alive: boolean }>>;
  terminalWrite: (officeId: string, agentId: string, data: string) => Promise<{ success: boolean; error?: string }>;
}> = {}) {
  const getBackendInfo = overrides.getBackendInfo
    ?? vi.fn(async () => (overrides.backend === undefined ? { name: 'native-bridge' } : (overrides.backend === null ? null : { name: overrides.backend })));
  const queryAgentStatuses = overrides.queryAgentStatuses
    ?? vi.fn(async () => overrides.statuses ?? { a1: { alive: true } });
  const terminalWrite = overrides.terminalWrite
    ?? vi.fn(async () => overrides.writeResult ?? { success: true });
  return { getBackendInfo, queryAgentStatuses, terminalWrite };
}

describe('newSessionReuse', () => {
  beforeEach(() => {
    resetNewSessionBackendCache();
  });

  it('allows reuse for a live native-bridge agent in copilot mode', async () => {
    const bridge = makeBridge({ backend: 'native-bridge', statuses: { a1: { alive: true } } });
    expect(await canReuseLivePtyForNewSession(bridge, 'office-0', 'a1', 'copilot')).toBe(true);
  });

  it('refuses when the backend is not native-bridge', async () => {
    const bridge = makeBridge({ backend: 'sdk', statuses: { a1: { alive: true } } });
    expect(await canReuseLivePtyForNewSession(bridge, 'office-0', 'a1', 'copilot')).toBe(false);
  });

  it('refuses for node-pty backend', async () => {
    const bridge = makeBridge({ backend: 'node-pty', statuses: { a1: { alive: true } } });
    expect(await canReuseLivePtyForNewSession(bridge, 'office-0', 'a1', 'copilot')).toBe(false);
  });

  it('refuses shell launch mode even on native-bridge', async () => {
    const bridge = makeBridge({ backend: 'native-bridge', statuses: { a1: { alive: true } } });
    expect(await canReuseLivePtyForNewSession(bridge, 'office-0', 'a1', 'shell')).toBe(false);
    // Shell is rejected before any backend/liveness IPC.
    expect(bridge.getBackendInfo).not.toHaveBeenCalled();
    expect(bridge.queryAgentStatuses).not.toHaveBeenCalled();
  });

  it('refuses when the agent PTY is not alive', async () => {
    const bridge = makeBridge({ backend: 'native-bridge', statuses: { a1: { alive: false } } });
    expect(await canReuseLivePtyForNewSession(bridge, 'office-0', 'a1', 'copilot')).toBe(false);
  });

  it('refuses when the agent is absent from the status map', async () => {
    const bridge = makeBridge({ backend: 'native-bridge', statuses: {} });
    expect(await canReuseLivePtyForNewSession(bridge, 'office-0', 'missing', 'copilot')).toBe(false);
  });

  it('refuses (never throws) when there is no bridge', async () => {
    expect(await canReuseLivePtyForNewSession(undefined, 'office-0', 'a1', 'copilot')).toBe(false);
  });

  it('refuses (never throws) when the liveness query rejects', async () => {
    const bridge = makeBridge({
      backend: 'native-bridge',
      queryAgentStatuses: vi.fn(async () => { throw new Error('ipc down'); }),
    });
    expect(await canReuseLivePtyForNewSession(bridge, 'office-0', 'a1', 'copilot')).toBe(false);
  });

  it('treats an unknown/failed backend lookup as not reusable', async () => {
    const bridge = makeBridge({ backend: null, statuses: { a1: { alive: true } } });
    expect(await canReuseLivePtyForNewSession(bridge, 'office-0', 'a1', 'copilot')).toBe(false);
  });

  it('memoizes the backend lookup across calls', async () => {
    const bridge = makeBridge({ backend: 'native-bridge', statuses: { a1: { alive: true } } });
    await canReuseLivePtyForNewSession(bridge, 'office-0', 'a1', 'copilot');
    await canReuseLivePtyForNewSession(bridge, 'office-0', 'a1', 'copilot');
    expect(bridge.getBackendInfo).toHaveBeenCalledTimes(1);
  });

  it('sends the Ctrl-U + /new submit sequence to the live TUI', async () => {
    const bridge = makeBridge({ writeResult: { success: true } });
    const ok = await reuseLivePtyForNewSession(bridge, 'office-0', 'a1');
    expect(ok).toBe(true);
    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'a1', '\x15/new\r');
  });

  it('reports failure when the write is rejected', async () => {
    const bridge = makeBridge({ writeResult: { success: false, error: 'dead pty' } });
    expect(await reuseLivePtyForNewSession(bridge, 'office-0', 'a1')).toBe(false);
  });

  it('reports failure (never throws) when the write throws', async () => {
    const bridge = makeBridge({
      terminalWrite: vi.fn(async () => { throw new Error('boom'); }),
    });
    expect(await reuseLivePtyForNewSession(bridge, 'office-0', 'a1')).toBe(false);
  });
});
