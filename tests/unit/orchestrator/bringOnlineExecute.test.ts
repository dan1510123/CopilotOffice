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

  it('reports already-active when marked active AND the session is genuinely alive', async () => {
    statusMap.set('debugger', { state: 'active' });
    const startSeated = vi.fn();
    const res = await executeBringOnline('debugger', {
      startSeated,
      activateReserve: vi.fn(),
      isSessionAlive: vi.fn().mockResolvedValue(true),
    });
    expect(res.outcome).toBe('already-active');
    expect(startSeated).not.toHaveBeenCalled();
  });

  it('re-warms a seated agent the renderer marks active but whose PTY is dead (desync)', async () => {
    statusMap.set('debugger', { state: 'active' });
    const startSeated = vi.fn().mockResolvedValue(true);
    const res = await executeBringOnline('debugger', {
      startSeated,
      activateReserve: vi.fn(),
      isSessionAlive: vi.fn().mockResolvedValue(false),
    });
    expect(res.outcome).toBe('started');
    expect(startSeated).toHaveBeenCalledWith('office-1', 'debugger');
  });

  it('surfaces failed when re-warming a desynced active agent cannot restore its session', async () => {
    statusMap.set('debugger', { state: 'active' });
    const res = await executeBringOnline('debugger', {
      startSeated: vi.fn().mockResolvedValue(false),
      activateReserve: vi.fn(),
      isSessionAlive: vi.fn().mockResolvedValue(false),
    });
    expect(res.outcome).toBe('failed');
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

  it('auto-switches to the target office before bringing online when it differs from current', async () => {
    candidates = [candidate({ agentId: 'scout', name: 'Scout', source: 'reserve', deskId: 'unassigned-1', officeId: 'office-3' })];
    const startSeated = vi.fn();
    const activateReserve = vi.fn().mockResolvedValue('started');
    const switchOffice = vi.fn().mockImplementation(async (oid: string) => { currentOfficeId = oid; });

    const res = await executeBringOnline('scout', { startSeated, activateReserve, switchOffice }, 'office-3');
    expect(switchOffice).toHaveBeenCalledWith('office-3');
    expect(res.outcome).toBe('started');
    expect(activateReserve).toHaveBeenCalledWith('unassigned-1');
  });

  it('does NOT switch when the target office is already current', async () => {
    candidates = [candidate({ agentId: 'generalist', source: 'idle-seated' })];
    const switchOffice = vi.fn().mockResolvedValue(undefined);

    const res = await executeBringOnline('generalist', {
      startSeated: vi.fn().mockResolvedValue(true),
      activateReserve: vi.fn(),
      switchOffice,
    }, 'office-1');
    expect(switchOffice).not.toHaveBeenCalled();
    expect(res.outcome).toBe('started');
  });

  it('returns failed when the office switch throws', async () => {
    const switchOffice = vi.fn().mockRejectedValue(new Error('switch boom'));
    const res = await executeBringOnline('scout', {
      startSeated: vi.fn(),
      activateReserve: vi.fn(),
      switchOffice,
    }, 'office-9');
    expect(res.outcome).toBe('failed');
    expect(res.message).toMatch(/switch boom/);
  });
});
