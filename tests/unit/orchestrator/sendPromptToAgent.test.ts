// spec 017 — T026. Unit tests for sendPromptToAgent (US5). Requires the target to
// be online (any active state); delivers via the injected terminal op; typed
// outcomes (sent / not-online / invalid-target / failed).

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

import { sendPromptToAgent, type ActOnDeps } from '../../../src/office/orchestratorActOn';

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
    ...overrides,
  };
}

beforeEach(() => {
  statusByOffice.clear();
  currentOfficeId = 'o1';
});

describe('sendPromptToAgent', () => {
  it('sends the prompt to an online agent (no waiting requirement)', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', subState: 'thinking' }));
    const d = deps();
    const res = await sendPromptToAgent({ agentId: 'coder', prompt: 'also add tests' }, d);
    expect(res.outcome).toBe('sent');
    expect(d.deliverText).toHaveBeenCalledWith('o1', 'coder', 'also add tests');
  });

  it('returns not-online for a slacking agent (bring it online first)', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', state: 'slacking', subState: null }));
    const res = await sendPromptToAgent({ agentId: 'coder', prompt: 'x' }, deps());
    expect(res.outcome).toBe('not-online');
  });

  it('returns invalid-target for unknown and orchestrator identities', async () => {
    expect((await sendPromptToAgent({ agentId: 'ghost', prompt: 'x' }, deps())).outcome).toBe('invalid-target');
    expect((await sendPromptToAgent({ agentId: ORCHESTRATOR_AGENT_ID, prompt: 'x' }, deps())).outcome).toBe('invalid-target');
  });

  it('surfaces failed when delivery fails or throws', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', subState: 'ready' }));
    expect((await sendPromptToAgent({ agentId: 'coder', prompt: 'x' }, deps({ deliverText: vi.fn().mockResolvedValue(false) }))).outcome).toBe('failed');
    expect((await sendPromptToAgent({ agentId: 'coder', prompt: 'x' }, deps({ deliverText: vi.fn().mockRejectedValue(new Error('boom')) }))).outcome).toBe('failed');
  });
});
