// Unit tests for setAgentTitle — gated act-on that renames an agent's session
// title via the injected setTitle dep (window.copilotBridge.setSessionMeta).

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

import { setAgentTitle, type ActOnDeps } from '../../../src/office/orchestratorActOn';

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
    submitAnswer: vi.fn().mockResolvedValue(true),
    stopSession: vi.fn().mockResolvedValue(true),
    restartSession: vi.fn().mockResolvedValue(true),
    teamsEnabled: vi.fn().mockResolvedValue(true),
    teamsRegister: vi.fn().mockResolvedValue({ success: true }),
    teamsStop: vi.fn().mockResolvedValue(true),
    setTitle: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

beforeEach(() => {
  statusByOffice.clear();
  currentOfficeId = 'o1';
});

describe('setAgentTitle', () => {
  it('sets the title on a known agent', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    const d = deps();
    const res = await setAgentTitle({ agentId: 'coder', title: 'Refactoring auth' }, d);
    expect(res.outcome).toBe('title-set');
    expect(d.setTitle).toHaveBeenCalledWith('o1', 'coder', 'Refactoring auth');
  });

  it('can set a title even on a dormant (non-active) agent', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', state: 'slacking' }));
    const d = deps();
    expect((await setAgentTitle({ agentId: 'coder', title: 'Later work' }, d)).outcome).toBe('title-set');
  });

  it('rejects an empty title', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    const d = deps();
    const res = await setAgentTitle({ agentId: 'coder', title: '   ' }, d);
    expect(res.outcome).toBe('invalid-target');
    expect(d.setTitle).not.toHaveBeenCalled();
  });

  it('returns failed when the underlying setTitle fails', async () => {
    seat('o1', 'coder', status({ agentId: 'coder' }));
    const d = deps({ setTitle: vi.fn().mockResolvedValue(false) });
    expect((await setAgentTitle({ agentId: 'coder', title: 'x' }, d)).outcome).toBe('failed');
  });

  it('refuses unknown and orchestrator identities', async () => {
    const d = deps();
    expect((await setAgentTitle({ agentId: 'ghost', title: 'x' }, d)).outcome).toBe('invalid-target');
    expect((await setAgentTitle({ agentId: ORCHESTRATOR_AGENT_ID, title: 'x' }, d)).outcome).toBe('invalid-target');
    expect(d.setTitle).not.toHaveBeenCalled();
  });
});
