import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BringOnlineCandidate } from '../../../electron/orchestrator/types';

// Regression: the orchestrator LLM frequently passes an agent's display NAME
// (e.g. "Rhys") instead of its agentId (e.g. "office-6-reserve-4"). The
// exact-id-only path used to return `invalid-target`; executeBringOnline now
// resolves name→id and defaults a blank identifier to the next dormant agent.

let candidates: BringOnlineCandidate[] = [];
const statusMap = new Map<string, { state: 'slacking' | 'active' }>();
let currentOfficeId: string | null = 'office-3';

vi.mock('../../../src/office/orchestratorCandidates', () => ({
  computeBringOnlineCandidates: () => candidates,
}));
vi.mock('../../../src/office/officeManager', () => ({
  officeManager: {
    get currentOfficeId() { return currentOfficeId; },
    getAgentStatus: (_o: string, id: string) => statusMap.get(id),
  },
}));

import { executeBringOnline } from '../../../src/office/orchestratorExecute';

function reserve(id: string, name: string, deskId: string): BringOnlineCandidate {
  return { agentId: id, name, skill: 'general', description: '', source: 'reserve', deskId, officeId: 'office-3' };
}
function seated(id: string, name: string): BringOnlineCandidate {
  return { agentId: id, name, skill: 'general', description: '', source: 'idle-seated', deskId: null, officeId: 'office-3' };
}

const deps = () => ({ startSeated: vi.fn().mockResolvedValue(true), activateReserve: vi.fn().mockResolvedValue('started' as const) });

beforeEach(() => {
  statusMap.clear();
  currentOfficeId = 'office-3';
  candidates = [
    seated('office-6-agent-0', 'Grace'),
    reserve('office-6-reserve-3', 'Darcy', 'unassigned-left-13'),
    reserve('office-6-reserve-4', 'Rhys', 'unassigned-right-13'),
  ];
});

describe('executeBringOnline name/default resolution', () => {
  it('resolves by exact agentId', async () => {
    const d = deps();
    const res = await executeBringOnline('office-6-reserve-4', d);
    expect(res.outcome).toBe('started');
    expect(d.activateReserve).toHaveBeenCalledWith('unassigned-right-13');
  });

  it('resolves by display name (case-insensitive)', async () => {
    const d = deps();
    const res = await executeBringOnline('rhys', d);
    expect(res.outcome).toBe('started');
    expect(res.agentId).toBe('office-6-reserve-4');
    expect(d.activateReserve).toHaveBeenCalledWith('unassigned-right-13');
  });

  it('defaults a blank identifier to the next dormant agent (first candidate)', async () => {
    const d = deps();
    const res = await executeBringOnline('', d);
    expect(res.outcome).toBe('started');
    expect(res.agentId).toBe('office-6-agent-0');
    expect(d.startSeated).toHaveBeenCalledWith('office-3', 'office-6-agent-0');
  });

  it('still returns invalid-target for a genuinely unknown name', async () => {
    const res = await executeBringOnline('Zaphod', deps());
    expect(res.outcome).toBe('invalid-target');
  });
});
