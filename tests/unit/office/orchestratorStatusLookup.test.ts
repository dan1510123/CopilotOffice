// Unit tests for computeAgentStatusLookup — the cheap single-agent lookup behind
// the get_agent_status tool. Resolves ONE agent by fuzzy name or agentId and
// reports session status; Teams presence is layered on by the renderer resolver.

import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentStatus } from '../../../src/office/officeManager';
import type { AgentConfig } from '../../../src/config/agents';

interface FakeOffice {
  config: { id: string; name: string; customAgents?: AgentConfig[]; customReserveAgents?: Record<string, AgentConfig> };
  agents: Map<string, AgentStatus>;
}
const offices = new Map<string, FakeOffice>();
let currentOfficeId: string | null = 'o1';

vi.mock('../../../src/office/officeManager', () => ({
  officeManager: {
    get currentOfficeId() {
      return currentOfficeId;
    },
    getAllOffices: () => [...offices.values()].map((o) => o.config),
    getOffice: (id: string) => offices.get(id),
    getAgentStatus: (id: string, aid: string) => offices.get(id)?.agents.get(aid),
  },
}));

vi.mock('../../../src/office/askUserRegistry', () => ({
  getPendingAskUser: () => undefined,
}));

import { computeAgentStatusLookup } from '../../../src/office/orchestratorStatus';

function status(overrides: Partial<AgentStatus>): AgentStatus {
  return {
    agentId: 'x', state: 'active', subState: 'ready', thinkingDetail: null, currentTool: null,
    completionPendingAck: false, unreadCount: 0, lastEvent: null, activityStartTime: 1,
    lastCompletedAction: null, recentActions: [], taskSummary: null, ...overrides,
  };
}
function office(id: string, name: string): FakeOffice {
  const o: FakeOffice = { config: { id, name }, agents: new Map() };
  offices.set(id, o);
  return o;
}
function custom(id: string, name: string): AgentConfig {
  return { id, name, skill: 'general', description: '', sprite: '', color: 0, position: { x: 0, y: 0 } } as unknown as AgentConfig;
}

beforeEach(() => {
  offices.clear();
  currentOfficeId = 'o1';
});

describe('computeAgentStatusLookup', () => {
  it('resolves an exact agentId to a session-bearing agent', () => {
    office('o1', 'Alpha').agents.set('generalist', status({ agentId: 'generalist' }));
    const res = computeAgentStatusLookup('generalist');
    expect(res.outcome).toBe('found');
    expect(res.agent?.agentId).toBe('generalist');
    expect(res.agent?.hasSession).toBe(true);
  });

  it('resolves a fuzzy name (Gene) to the default generalist agent', () => {
    office('o1', 'Alpha').agents.set('generalist', status({ agentId: 'generalist' }));
    const res = computeAgentStatusLookup('gene');
    expect(res.outcome).toBe('found');
    expect(res.agent?.agentId).toBe('generalist');
  });

  it('reports a known-but-dormant agent with hasSession=false', () => {
    office('o1', 'Alpha').agents.set('debugger', status({ agentId: 'debugger', state: 'slacking' }));
    const res = computeAgentStatusLookup('dan');
    expect(res.outcome).toBe('found');
    expect(res.agent?.hasSession).toBe(false);
  });

  it('returns not-found for an unknown name', () => {
    office('o1', 'Alpha');
    expect(computeAgentStatusLookup('nobody-here').outcome).toBe('not-found');
  });

  it('returns ambiguous when a name matches agents in two offices', () => {
    const a = office('o1', 'Alpha');
    a.config.customAgents = [custom('olivia-a', 'Olivia')];
    const b = office('o2', 'Bravo');
    b.config.customAgents = [custom('olivia-b', 'Olivia')];
    const res = computeAgentStatusLookup('olivia');
    expect(res.outcome).toBe('ambiguous');
    expect(res.matches).toHaveLength(2);
    expect(res.matches?.map((m) => m.agentId).sort()).toEqual(['olivia-a', 'olivia-b']);
  });

  it('prefers the session-bearing instance when the same agent is dormant in another office', () => {
    office('o1', 'Alpha').agents.set('generalist', status({ agentId: 'generalist' }));
    const b = office('o2', 'Bravo');
    b.config.customAgents = [custom('generalist', 'Gene')]; // dormant seat elsewhere
    const res = computeAgentStatusLookup('generalist'); // current office = o1
    expect(res.outcome).toBe('found');
    expect(res.agent?.officeId).toBe('o1');
    expect(res.agent?.hasSession).toBe(true);
  });

  it('reports ambiguous when the SAME agent is live in two offices', () => {
    office('o1', 'Alpha').agents.set('generalist', status({ agentId: 'generalist' }));
    office('o2', 'Bravo').agents.set('generalist', status({ agentId: 'generalist' }));
    const res = computeAgentStatusLookup('generalist');
    expect(res.outcome).toBe('ambiguous');
    expect(res.matches?.map((m) => m.officeId).sort()).toEqual(['o1', 'o2']);
  });

  it('ignores a bogus officeId hint instead of inventing a match in a non-existent office', () => {
    office('o1', 'Alpha').agents.set('generalist', status({ agentId: 'generalist' }));
    // 'gene' would only resolve via the default-agent (Pass C) scope; a bogus hint
    // must fall back to the current office, not synthesize a match under 'ghost-office'.
    const res = computeAgentStatusLookup('gene', 'ghost-office');
    expect(res.outcome).toBe('found');
    expect(res.agent?.officeId).toBe('o1');
  });
});
