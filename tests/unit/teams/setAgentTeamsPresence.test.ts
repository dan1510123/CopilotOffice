// spec 017 — T029. Unit tests for setAgentTeamsPresence (US8). Gated act-on that
// reuses teamsRegister / teams:stop via injected deps. Respects the Teams feature
// flag (unavailable when disabled); typed outcomes for online/offline + failures.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStatus } from '../../../src/office/officeManager';
import { ORCHESTRATOR_AGENT_ID } from '../../../electron/orchestrator/orchestratorIdentity';

const statusByOffice = new Map<string, Map<string, AgentStatus>>();
let currentOfficeId: string | null = 'o1';

vi.mock('../../../src/office/officeManager', () => ({
  officeManager: {
    get currentOfficeId() {
      return currentOfficeId;
    },
    getAllOffices: () => [...statusByOffice.keys()].map((id) => ({ id, name: id })),
    getAgentStatus: (officeId: string, agentId: string) => statusByOffice.get(officeId)?.get(agentId),
  },
}));

import { setAgentTeamsPresence, type ActOnDeps } from '../../../src/office/orchestratorActOn';

function status(overrides: Partial<AgentStatus>): AgentStatus {
  return {
    agentId: 'x', state: 'active', subState: 'ready', thinkingDetail: null, currentTool: null,
    completionPendingAck: false, unreadCount: 0, lastEvent: null, activityStartTime: 1,
    lastCompletedAction: null, recentActions: [], taskSummary: null, ...overrides,
  };
}
function seat(officeId: string, agentId: string, st: AgentStatus): void {
  if (!statusByOffice.has(officeId)) statusByOffice.set(officeId, new Map());
  statusByOffice.get(officeId)!.set(agentId, st);
}
function deps(overrides: Partial<ActOnDeps> = {}): ActOnDeps {
  return {
    ensureOnline: vi.fn().mockResolvedValue(true),
    deliverText: vi.fn().mockResolvedValue(true),
    stopSession: vi.fn().mockResolvedValue(true),
    restartSession: vi.fn().mockResolvedValue(true),
    teamsEnabled: vi.fn().mockResolvedValue(true),
    teamsRegister: vi.fn().mockResolvedValue({ success: true, threadWebUrl: 'https://teams/x' }),
    teamsStop: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => {
  statusByOffice.clear();
  currentOfficeId = 'o1';
});

describe('setAgentTeamsPresence', () => {
  it('brings an agent online in Teams and surfaces the thread url', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    const d = deps();
    const res = await setAgentTeamsPresence({ agentId: 'coder', online: true }, d);
    expect(res.outcome).toBe('online-in-teams');
    expect(res.threadWebUrl).toBe('https://teams/x');
    expect(d.teamsRegister).toHaveBeenCalledWith('o1', 'coder');
  });

  it('takes an agent offline in Teams', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    const d = deps();
    const res = await setAgentTeamsPresence({ agentId: 'coder', online: false }, d);
    expect(res.outcome).toBe('taken-offline');
    expect(d.teamsStop).toHaveBeenCalledWith('o1', 'coder');
  });

  it('returns unavailable when the Teams feature is disabled', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    const d = deps({ teamsEnabled: vi.fn().mockResolvedValue(false) });
    const res = await setAgentTeamsPresence({ agentId: 'coder', online: true }, d);
    expect(res.outcome).toBe('unavailable');
    expect(d.teamsRegister).not.toHaveBeenCalled();
  });

  it('returns failed when Teams registration fails', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    const d = deps({ teamsRegister: vi.fn().mockResolvedValue({ success: false, error: 'no channel' }) });
    const res = await setAgentTeamsPresence({ agentId: 'coder', online: true }, d);
    expect(res.outcome).toBe('failed');
    expect(res.message).toMatch(/no channel/);
  });

  it('returns failed when taking offline fails', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    const d = deps({ teamsStop: vi.fn().mockResolvedValue(false) });
    expect((await setAgentTeamsPresence({ agentId: 'coder', online: false }, d)).outcome).toBe('failed');
  });

  it('refuses unknown and orchestrator identities before touching Teams', async () => {
    const d = deps();
    expect((await setAgentTeamsPresence({ agentId: 'ghost', online: true }, d)).outcome).toBe('invalid-target');
    expect((await setAgentTeamsPresence({ agentId: ORCHESTRATOR_AGENT_ID, online: true }, d)).outcome).toBe('invalid-target');
    expect(d.teamsEnabled).not.toHaveBeenCalled();
  });
});
