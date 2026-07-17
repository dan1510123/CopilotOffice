// spec 017 — T032. Unit tests for stopAgent / restartAgent (US6). Both require the
// target to be online; reuse the injected stop (terminalKill) / restart (kill+warm)
// ops; typed outcomes (stopped / restarted / not-online / invalid-target / failed).

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

import { stopAgent, restartAgent, type ActOnDeps } from '../../../src/office/orchestratorActOn';

function status(overrides: Partial<AgentStatus>): AgentStatus {
  return {
    agentId: 'x', state: 'active', subState: 'thinking', thinkingDetail: null, currentTool: null,
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
    submitAnswer: vi.fn().mockResolvedValue(true),
    stopSession: vi.fn().mockResolvedValue(true),
    restartSession: vi.fn().mockResolvedValue(true),
    teamsEnabled: vi.fn().mockResolvedValue(true),
    teamsRegister: vi.fn().mockResolvedValue({ success: true }),
    teamsStop: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => {
  statusByOffice.clear();
  currentOfficeId = 'o1';
});

describe('stopAgent', () => {
  it('stops an online agent via the injected stop op', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    const d = deps();
    const res = await stopAgent({ agentId: 'coder' }, d);
    expect(res.outcome).toBe('stopped');
    expect(d.stopSession).toHaveBeenCalledWith('o1', 'coder');
  });

  it('returns not-online when the agent is slacking', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', state: 'slacking', subState: null }));
    expect((await stopAgent({ agentId: 'coder' }, deps())).outcome).toBe('not-online');
  });

  it('returns invalid-target for unknown and orchestrator identities', async () => {
    expect((await stopAgent({ agentId: 'ghost' }, deps())).outcome).toBe('invalid-target');
    expect((await stopAgent({ agentId: ORCHESTRATOR_AGENT_ID }, deps())).outcome).toBe('invalid-target');
  });

  it('surfaces failed when the stop op reports/throws failure', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    expect((await stopAgent({ agentId: 'coder' }, deps({ stopSession: vi.fn().mockResolvedValue(false) }))).outcome).toBe('failed');
    expect((await stopAgent({ agentId: 'coder' }, deps({ stopSession: vi.fn().mockRejectedValue(new Error('x')) }))).outcome).toBe('failed');
  });
});

describe('restartAgent', () => {
  it('restarts an online agent via the injected restart op', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    const d = deps();
    const res = await restartAgent({ agentId: 'coder' }, d);
    expect(res.outcome).toBe('restarted');
    expect(d.restartSession).toHaveBeenCalledWith('o1', 'coder');
  });

  it('returns not-online for a slacking agent', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', state: 'slacking', subState: null }));
    expect((await restartAgent({ agentId: 'coder' }, deps())).outcome).toBe('not-online');
  });

  it('surfaces failed when the restart op reports failure', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    expect((await restartAgent({ agentId: 'coder' }, deps({ restartSession: vi.fn().mockResolvedValue(false) }))).outcome).toBe('failed');
  });
});
