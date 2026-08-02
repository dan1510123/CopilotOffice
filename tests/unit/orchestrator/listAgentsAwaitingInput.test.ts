// spec 017 — T017. Unit tests for computeAwaitingAgents (US3). The waiting subset,
// longest-waiting first (oldest activityStartTime first), presentation-derived.

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

import { computeAwaitingAgents } from '../../../src/office/orchestratorStatus';

const NOW = 1_000_000;

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
    activityStartTime: NOW,
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
      agents: new Map<string, AgentStatus>([
        // waiting 10s
        ['recent', status({ agentId: 'recent', activityStartTime: NOW - 10_000 })],
        // waiting 90s (longest)
        ['oldest', status({ agentId: 'oldest', activityStartTime: NOW - 90_000 })],
        // thinking → not awaiting
        ['busy', status({ agentId: 'busy', subState: 'thinking' })],
      ]),
    },
    {
      id: 'o2',
      name: 'Annex',
      agents: new Map<string, AgentStatus>([
        // waiting 45s
        ['middle', status({ agentId: 'middle', activityStartTime: NOW - 45_000 })],
      ]),
    },
  ];
});

describe('computeAwaitingAgents', () => {
  it('returns only waiting agents', () => {
    const ids = computeAwaitingAgents(NOW).map((a) => a.agentId);
    expect(ids).not.toContain('busy');
    expect(ids.sort()).toEqual(['middle', 'oldest', 'recent']);
  });

  it('orders longest-waiting first (across offices)', () => {
    const ids = computeAwaitingAgents(NOW).map((a) => a.agentId);
    expect(ids).toEqual(['oldest', 'middle', 'recent']);
  });

  it('scopes to a single office when officeId is provided', () => {
    expect(computeAwaitingAgents(NOW, 'o1').map((a) => a.agentId)).toEqual(['oldest', 'recent']);
    expect(computeAwaitingAgents(NOW, 'o2').map((a) => a.agentId)).toEqual(['middle']);
    expect(computeAwaitingAgents(NOW, 'nope')).toEqual([]);
  });

  it('flags every returned agent as awaitingInput with a pendingQuestion', () => {
    for (const a of computeAwaitingAgents(NOW)) {
      expect(a.awaitingInput).toBe(true);
      expect(a.pendingQuestion).toBeTruthy();
    }
  });

  it('surfaces the captured ask_user question (taskSummary) as pendingQuestion', () => {
    offices = [
      {
        id: 'o1',
        name: 'HQ',
        agents: new Map<string, AgentStatus>([
          [
            'asker',
            status({
              agentId: 'asker',
              taskSummary: 'Which database should I use — PostgreSQL or MySQL?',
            }),
          ],
        ]),
      },
    ];
    const [a] = computeAwaitingAgents(NOW);
    expect(a.pendingQuestion).toBe('Which database should I use — PostgreSQL or MySQL?');
  });

  it('falls back to a generic notice when no question context is captured', () => {
    offices = [
      {
        id: 'o1',
        name: 'HQ',
        agents: new Map<string, AgentStatus>([
          ['bare', status({ agentId: 'bare', taskSummary: null })],
        ]),
      },
    ];
    const [a] = computeAwaitingAgents(NOW);
    expect(a.pendingQuestion).toBe('Waiting for your answer');
  });

  it('returns [] when nobody is waiting', () => {
    offices = [{ id: 'o1', name: 'HQ', agents: new Map([['busy', status({ subState: 'thinking' })]]) }];
    expect(computeAwaitingAgents(NOW)).toEqual([]);
  });
});
