// spec 017 — T020. Unit tests for computeAgentRecentOutput (US7). A bounded,
// read-only recent-output window sourced from getRecentActions + task summary
// (NOT live PTY scraping). Disambiguation: current office first, then all offices.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStatus, RecentAction } from '../../../src/office/officeManager';

interface FakeOffice {
  id: string;
  name: string;
  agents: Map<string, AgentStatus>;
}

let offices: FakeOffice[] = [];
let currentOfficeId: string | null = 'o1';

vi.mock('../../../src/office/officeManager', () => ({
  officeManager: {
    get currentOfficeId() {
      return currentOfficeId;
    },
    getAllOffices: () => offices.map((o) => ({ id: o.id, name: o.name })),
    getAgentStatus: (officeId: string, agentId: string) =>
      offices.find((o) => o.id === officeId)?.agents.get(agentId),
    getRecentActions: (officeId: string, agentId: string) =>
      offices.find((o) => o.id === officeId)?.agents.get(agentId)?.recentActions ?? [],
  },
}));

import { computeAgentRecentOutput } from '../../../src/office/orchestratorPeek';

function action(a: string, type: 'started' | 'completed'): RecentAction {
  return { action: a, type, timestamp: 1 };
}

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
    activityStartTime: 1,
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
        [
          'coder',
          status({
            agentId: 'coder',
            recentActions: [action('edit', 'started'), action('grep', 'completed')],
            taskSummary: 'Refactoring the parser',
          }),
        ],
        ['quiet', status({ agentId: 'quiet', recentActions: [], taskSummary: null })],
      ]),
    },
    {
      id: 'o2',
      name: 'Annex',
      agents: new Map<string, AgentStatus>([
        ['remote', status({ agentId: 'remote', recentActions: [action('view', 'started')] })],
      ]),
    },
  ];
});

describe('computeAgentRecentOutput', () => {
  it('formats recent actions and includes the task summary hint', () => {
    const out = computeAgentRecentOutput('coder');
    expect(out.hasOutput).toBe(true);
    expect(out.officeId).toBe('o1');
    expect(out.lines).toEqual(['edit (started)', 'grep (completed)']);
    expect(out.summaryHint).toBe('Refactoring the parser');
  });

  it('reports hasOutput=false when an agent has no recent activity or summary', () => {
    const out = computeAgentRecentOutput('quiet');
    expect(out.hasOutput).toBe(false);
    expect(out.lines).toEqual([]);
  });

  it('disambiguates to other offices when not in the current office', () => {
    const out = computeAgentRecentOutput('remote');
    expect(out.officeId).toBe('o2');
    expect(out.lines).toEqual(['view (started)']);
  });

  it('honors an explicit officeId', () => {
    const out = computeAgentRecentOutput('remote', 'o2');
    expect(out.officeId).toBe('o2');
    expect(out.hasOutput).toBe(true);
  });

  it('returns hasOutput=false with a hint for an unknown agent', () => {
    const out = computeAgentRecentOutput('ghost');
    expect(out.hasOutput).toBe(false);
    expect(out.summaryHint).toMatch(/No agent/i);
  });

  it('returns hasOutput=false when an explicit office does not host the agent', () => {
    const out = computeAgentRecentOutput('coder', 'o2');
    expect(out.hasOutput).toBe(false);
  });

  it('handles an empty agentId gracefully', () => {
    const out = computeAgentRecentOutput('');
    expect(out.hasOutput).toBe(false);
    expect(out.lines).toEqual([]);
  });
});
