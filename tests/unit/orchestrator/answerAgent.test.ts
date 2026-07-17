// spec 017 — T023. Unit tests for answerAgent (US4). Reached only AFTER the gate
// approves. Re-validates the office-qualified target (FR-019), refuses the
// synthetic orchestrator identity (FR-020), requires online + waiting, reuses the
// injected session ops, and returns a typed outcome (never silent — FR-021).

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

import { answerAgent, type ActOnDeps } from '../../../src/office/orchestratorActOn';

function status(overrides: Partial<AgentStatus>): AgentStatus {
  return {
    agentId: 'x',
    state: 'active',
    subState: 'waiting',
    thinkingDetail: null,
    currentTool: null,
    completionPendingAck: false,
    unreadCount: 0,
    lastEvent: null,
    activityStartTime: 1,
    lastCompletedAction: null,
    recentActions: [],
    taskSummary: null,
    ...overrides,
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

describe('answerAgent', () => {
  it('delivers the answer to an online, waiting agent', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', subState: 'waiting' }));
    const d = deps();
    const res = await answerAgent({ agentId: 'coder', answer: 'use option B' }, d);
    expect(res.outcome).toBe('delivered');
    expect(res.officeId).toBe('o1');
    expect(d.ensureOnline).toHaveBeenCalledWith('o1', 'coder');
    expect(d.submitAnswer).toHaveBeenCalledWith('o1', 'coder', 'use option B');
  });

  it('returns not-waiting when the agent is online but not awaiting input', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', subState: 'thinking' }));
    const d = deps();
    const res = await answerAgent({ agentId: 'coder', answer: 'hi' }, d);
    expect(res.outcome).toBe('not-waiting');
    expect(d.submitAnswer).not.toHaveBeenCalled();
  });

  it('returns not-online for a slacking agent', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', state: 'slacking', subState: null }));
    const res = await answerAgent({ agentId: 'coder', answer: 'hi' }, deps());
    expect(res.outcome).toBe('not-online');
  });

  it('returns invalid-target for an unknown agent (FR-019)', async () => {
    const res = await answerAgent({ agentId: 'ghost', answer: 'hi' }, deps());
    expect(res.outcome).toBe('invalid-target');
  });

  it('refuses the synthetic orchestrator identity (FR-020)', async () => {
    const res = await answerAgent({ agentId: ORCHESTRATOR_AGENT_ID, answer: 'hi' }, deps());
    expect(res.outcome).toBe('invalid-target');
  });

  it('surfaces failed (never silent) when delivery fails', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', subState: 'waiting' }));
    const res = await answerAgent({ agentId: 'coder', answer: 'hi' }, deps({ submitAnswer: vi.fn().mockResolvedValue(false) }));
    expect(res.outcome).toBe('failed');
  });

  it('surfaces failed when an injected op throws', async () => {
    seat('o1', 'coder', status({ agentId: 'coder', subState: 'waiting' }));
    const res = await answerAgent(
      { agentId: 'coder', answer: 'hi' },
      deps({ submitAnswer: vi.fn().mockRejectedValue(new Error('pipe broke')) }),
    );
    expect(res.outcome).toBe('failed');
    expect(res.message).toMatch(/pipe broke/);
  });

  it('resolves a target in a non-current office via disambiguation', async () => {
    currentOfficeId = 'o1';
    seat('o2', 'remote', status({ agentId: 'remote', subState: 'waiting' }));
    const res = await answerAgent({ agentId: 'remote', answer: 'go' }, deps());
    expect(res.outcome).toBe('delivered');
    expect(res.officeId).toBe('o2');
  });
});
