import { beforeEach, describe, expect, it, vi } from 'vitest';

// Controllable fixtures for the mocked modules. Mutated per-test.
const AGENTS_FIXTURE: Array<{ id: string; name: string; skill: string; description: string }> = [];
const RESERVE_FIXTURE: Record<string, { id: string; name: string; skill: string; description: string }> = {};
const statusMap = new Map<string, { state: 'slacking' | 'active' }>();
let currentOfficeId: string | null = 'office-1';
let layoutKey = 'default';
let supportsReserve = false;

vi.mock('../../../src/config/agents', () => ({
  get AGENTS() { return AGENTS_FIXTURE; },
  get RESERVE_AGENTS() { return RESERVE_FIXTURE; },
}));

vi.mock('../../../src/office/officeManager', () => ({
  officeManager: {
    get currentOfficeId() { return currentOfficeId; },
    get currentOffice() { return currentOfficeId ? { config: { layout: layoutKey } } : null; },
    getAgentStatus: (_officeId: string, agentId: string) => statusMap.get(agentId),
  },
}));

vi.mock('../../../src/layouts', () => ({
  getLayout: () => ({ behaviors: { supportsReserveAgents: supportsReserve } }),
}));

import { computeBringOnlineCandidates } from '../../../src/office/orchestratorCandidates';

function seatAgent(id: string, active: boolean): void {
  AGENTS_FIXTURE.push({ id, name: id, skill: 'general', description: `${id} desc` });
  statusMap.set(id, { state: active ? 'active' : 'slacking' });
}

beforeEach(() => {
  AGENTS_FIXTURE.length = 0;
  for (const k of Object.keys(RESERVE_FIXTURE)) delete RESERVE_FIXTURE[k];
  statusMap.clear();
  currentOfficeId = 'office-1';
  layoutKey = 'default';
  supportsReserve = false;
});

describe('computeBringOnlineCandidates', () => {
  it('returns idle-seated agents (state slacking or absent) and excludes active ones', () => {
    seatAgent('generalist', false);   // slacking → candidate
    seatAgent('debugger', true);      // active → excluded
    AGENTS_FIXTURE.push({ id: 'admin', name: 'admin', skill: 'general', description: 'admin desc' }); // no status → candidate

    const result = computeBringOnlineCandidates();
    const ids = result.map((c) => c.agentId).sort();
    expect(ids).toEqual(['admin', 'generalist']);
    expect(result.every((c) => c.source === 'idle-seated')).toBe(true);
    expect(result.find((c) => c.agentId === 'generalist')?.deskId).toBeNull();
  });

  it('includes activatable reserves only when the layout supports reserve agents', () => {
    RESERVE_FIXTURE['unassigned-1'] = { id: 'scout', name: 'Scout', skill: 'research', description: 'scouts' };

    // supportsReserve = false → no reserve candidate
    expect(computeBringOnlineCandidates().find((c) => c.agentId === 'scout')).toBeUndefined();

    // supportsReserve = true → reserve candidate surfaces with its deskId
    supportsReserve = true;
    const withReserve = computeBringOnlineCandidates();
    const scout = withReserve.find((c) => c.agentId === 'scout');
    expect(scout).toBeDefined();
    expect(scout?.source).toBe('reserve');
    expect(scout?.deskId).toBe('unassigned-1');
  });

  it('excludes reserves that are already seated in the roster', () => {
    supportsReserve = true;
    RESERVE_FIXTURE['unassigned-1'] = { id: 'scout', name: 'Scout', skill: 'research', description: 'scouts' };
    seatAgent('scout', false); // already in AGENTS → not offered as reserve

    const scoutCandidates = computeBringOnlineCandidates().filter((c) => c.agentId === 'scout');
    expect(scoutCandidates).toHaveLength(1);
    expect(scoutCandidates[0].source).toBe('idle-seated');
  });

  it('yields the empty "nothing to bring online" set when no office is active', () => {
    currentOfficeId = null;
    expect(computeBringOnlineCandidates()).toEqual([]);
  });

  it('yields an empty set when every seated agent is active and no reserves exist', () => {
    seatAgent('generalist', true);
    seatAgent('debugger', true);
    expect(computeBringOnlineCandidates()).toEqual([]);
  });
});
