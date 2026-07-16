import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BringOnlineCandidate } from '../../../electron/orchestrator/types';

let candidates: BringOnlineCandidate[] = [];
const statusMap = new Map<string, { state: 'slacking' | 'active' }>();
let currentOfficeId: string | null = 'office-1';

vi.mock('../../../src/office/orchestratorCandidates', () => ({
  computeBringOnlineCandidates: () => candidates,
}));

vi.mock('../../../src/office/officeManager', () => ({
  officeManager: {
    get currentOfficeId() { return currentOfficeId; },
    getAgentStatus: (_officeId: string, agentId: string) => statusMap.get(agentId),
  },
}));

import { executeBringOnline } from '../../../src/office/orchestratorExecute';

function candidate(overrides: Partial<BringOnlineCandidate>): BringOnlineCandidate {
  return {
    agentId: 'generalist',
    name: 'Gene',
    skill: 'general',
    description: 'general',
    source: 'idle-seated',
    deskId: null,
    officeId: 'office-1',
    ...overrides,
  };
}

beforeEach(() => {
  candidates = [];
  statusMap.clear();
  currentOfficeId = 'office-1';
});

describe('executeBringOnline', () => {
  it('starts an idle-seated agent (setAgentStarting + terminalStart)', async () => {
    candidates = [candidate({ agentId: 'generalist', source: 'idle-seated' })];
    const startSeated = vi.fn().mockResolvedValue(true);
    const activateReserve = vi.fn();

    const res = await executeBringOnline('generalist', { startSeated, activateReserve });
    expect(res.outcome).toBe('started');
    expect(startSeated).toHaveBeenCalledWith('office-1', 'generalist');
    expect(activateReserve).not.toHaveBeenCalled();
  });

  it('starts a reserve agent via the scene delegate', async () => {
    candidates = [candidate({ agentId: 'scout', name: 'Scout', source: 'reserve', deskId: 'unassigned-1' })];
    const startSeated = vi.fn();
    const activateReserve = vi.fn().mockResolvedValue('started');

    const res = await executeBringOnline('scout', { startSeated, activateReserve });
    expect(res.outcome).toBe('started');
    expect(activateReserve).toHaveBeenCalledWith('unassigned-1');
    expect(startSeated).not.toHaveBeenCalled();
  });

  it('is a no-op already-active when the target is already active and not a candidate', async () => {
    statusMap.set('debugger', { state: 'active' });
    const res = await executeBringOnline('debugger', { startSeated: vi.fn(), activateReserve: vi.fn() });
    expect(res.outcome).toBe('already-active');
  });

  it('returns invalid-target for an unknown id with no candidate and no active status', async () => {
    const res = await executeBringOnline('nobody', { startSeated: vi.fn(), activateReserve: vi.fn() });
    expect(res.outcome).toBe('invalid-target');
  });

  it('surfaces failed (never silent) when startSeated fails', async () => {
    candidates = [candidate({ agentId: 'generalist', source: 'idle-seated' })];
    const res = await executeBringOnline('generalist', {
      startSeated: vi.fn().mockResolvedValue(false),
      activateReserve: vi.fn(),
    });
    expect(res.outcome).toBe('failed');
    expect(res.message).toMatch(/failed/i);
  });

  it('surfaces failed when a delegate throws', async () => {
    candidates = [candidate({ agentId: 'scout', source: 'reserve', deskId: 'unassigned-1' })];
    const res = await executeBringOnline('scout', {
      startSeated: vi.fn(),
      activateReserve: vi.fn().mockRejectedValue(new Error('boom')),
    });
    expect(res.outcome).toBe('failed');
    expect(res.message).toMatch(/boom/);
  });

  it('returns failed when no office is active', async () => {
    currentOfficeId = null;
    const res = await executeBringOnline('generalist', { startSeated: vi.fn(), activateReserve: vi.fn() });
    expect(res.outcome).toBe('failed');
  });
});
