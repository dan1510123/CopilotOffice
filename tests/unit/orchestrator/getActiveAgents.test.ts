// spec 017 — T014. Unit tests for computeActiveAgents (US2). Enumerates every
// session-bearing agent across ALL offices; excludes slacking (no live session);
// does NOT omit done/idle-online; derives labels ONLY from agentStatusPresentation.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStatus } from '../../../src/office/officeManager';

interface FakeOffice {
  id: string;
  name: string;
  customAgents?: Array<{ id: string; name: string }>;
  agents: Map<string, AgentStatus>;
}

let offices: FakeOffice[] = [];
let currentOfficeId: string | null = 'o1';

vi.mock('../../../src/office/officeManager', () => ({
  officeManager: {
    get currentOfficeId() {
      return currentOfficeId;
    },
    getAllOffices: () => offices.map((o) => ({ id: o.id, name: o.name, customAgents: o.customAgents })),
    getOffice: (id: string) => {
      const o = offices.find((x) => x.id === id);
      return o ? { config: { id: o.id, name: o.name, customAgents: o.customAgents }, agents: o.agents } : undefined;
    },
    getAgentStatus: (officeId: string, agentId: string) =>
      offices.find((o) => o.id === officeId)?.agents.get(agentId),
    getRecentActions: () => [],
  },
}));

import { computeActiveAgents } from '../../../src/office/orchestratorStatus';

const NOW = 1_000_000;

function status(overrides: Partial<AgentStatus>): AgentStatus {
  return {
    agentId: 'x',
    state: 'active',
    subState: 'thinking',
    thinkingDetail: null,
    currentTool: null,
    completionPendingAck: false,
    unreadCount: 0,
    lastEvent: null,
    activityStartTime: NOW - 7000,
    lastCompletedAction: null,
    recentActions: [],
    taskSummary: null,
    ...overrides,
  };
}

beforeEach(() => {
  currentOfficeId = 'o1';
  offices = [
    {
      id: 'o1',
      name: 'HQ',
      customAgents: [
        { id: 'alpha', name: 'Alpha' },
        { id: 'beta', name: 'Beta' },
        { id: 'delta', name: 'Delta' },
        { id: 'gamma', name: 'Gamma' },
      ],
      agents: new Map<string, AgentStatus>([
        ['alpha', status({ agentId: 'alpha', subState: 'thinking' })],
        ['beta', status({ agentId: 'beta', subState: 'waiting', activityStartTime: NOW - 30000 })],
        ['delta', status({ agentId: 'delta', subState: 'ready', completionPendingAck: true })],
        // slacking → no live session → excluded
        ['gamma', status({ agentId: 'gamma', state: 'slacking', subState: null })],
      ]),
    },
    {
      id: 'o2',
      name: 'Annex',
      customAgents: [{ id: 'epsilon', name: 'Epsilon' }],
      agents: new Map<string, AgentStatus>([
        ['epsilon', status({ agentId: 'epsilon', subState: 'starting' })],
      ]),
    },
  ];
});

describe('computeActiveAgents', () => {
  it('enumerates session-bearing agents across all offices, excluding slacking', () => {
    const ids = computeActiveAgents(NOW).map((a) => a.agentId).sort();
    expect(ids).toEqual(['alpha', 'beta', 'delta', 'epsilon']);
    expect(ids).not.toContain('gamma');
  });

  it('does NOT omit done (ready + completionPendingAck) agents', () => {
    const delta = computeActiveAgents(NOW).find((a) => a.agentId === 'delta');
    expect(delta).toBeDefined();
    expect(delta?.statusKey).toBe('done');
  });

  it('derives label/statusKey from presentation and flags waiting agents', () => {
    const beta = computeActiveAgents(NOW).find((a) => a.agentId === 'beta')!;
    expect(beta.statusKey).toBe('waiting');
    expect(beta.statusLabel).toBe('Waiting for input'); // canonical presentation label
    expect(beta.awaitingInput).toBe(true);
    expect(beta.pendingQuestion).toBeTruthy();
    expect(beta.name).toBe('Beta');
    expect(beta.officeName).toBe('HQ');
  });

  it('non-waiting agents are not flagged awaitingInput', () => {
    const alpha = computeActiveAgents(NOW).find((a) => a.agentId === 'alpha')!;
    expect(alpha.awaitingInput).toBe(false);
    expect(alpha.pendingQuestion).toBeUndefined();
  });

  it('formats time-in-state as m:ss', () => {
    const beta = computeActiveAgents(NOW).find((a) => a.agentId === 'beta')!;
    expect(beta.timeInState).toBe('0:30');
  });

  it('returns [] when no offices have live agents', () => {
    offices = [{ id: 'o1', name: 'HQ', agents: new Map() }];
    expect(computeActiveAgents(NOW)).toEqual([]);
  });

  it('resolves a foreign-office agent name via cross-office fallback', () => {
    // A custom agent seated into HQ (o1) whose name config lives in Annex (o2)
    // — mirrors the orchestrator seating `office-5-agent-0` into Main Office.
    offices[0].agents.set('epsilon', status({ agentId: 'epsilon', subState: 'ready' }));
    const seated = computeActiveAgents(NOW).find(
      (a) => a.agentId === 'epsilon' && a.officeId === 'o1',
    )!;
    expect(seated.name).toBe('Epsilon');
    expect(seated.officeName).toBe('HQ');
  });
});
