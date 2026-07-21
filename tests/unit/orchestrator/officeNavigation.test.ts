import { beforeEach, describe, expect, it, vi } from 'vitest';

// Mutable fixture backing the mocked officeManager.
interface FakeOffice {
  config: { id: string; name: string; layout: string };
  agents: Map<string, { state: 'slacking' | 'active' }>;
}
const offices = new Map<string, FakeOffice>();
let currentOfficeId: string | null = 'office-0';

vi.mock('../../../src/office/officeManager', () => ({
  officeManager: {
    get currentOfficeId() { return currentOfficeId; },
    getAllOffices: () => Array.from(offices.values()).map((o) => o.config),
    getOffice: (id: string) => offices.get(id),
  },
}));

import {
  computeOfficeSummaries,
  resolveSwitchOffice,
} from '../../../src/office/orchestratorOffices';

function addOffice(id: string, name: string, layout: string, agents: Array<'slacking' | 'active'>): void {
  const map = new Map<string, { state: 'slacking' | 'active' }>();
  agents.forEach((state, i) => map.set(`${id}-a${i}`, { state }));
  offices.set(id, { config: { id, name, layout }, agents: map });
}

beforeEach(() => {
  offices.clear();
  currentOfficeId = 'office-0';
});

describe('computeOfficeSummaries', () => {
  it('summarizes every office with layout, isCurrent, and active agent counts', () => {
    addOffice('office-0', 'HQ', 'default', ['active', 'slacking', 'active']);
    addOffice('office-1', 'Fleet', 'fleet-vteam', ['slacking']);
    currentOfficeId = 'office-1';

    const summaries = computeOfficeSummaries();
    expect(summaries).toEqual([
      { officeId: 'office-0', name: 'HQ', layout: 'default', isCurrent: false, activeAgentCount: 2 },
      { officeId: 'office-1', name: 'Fleet', layout: 'fleet-vteam', isCurrent: true, activeAgentCount: 0 },
    ]);
  });

  it('returns an empty list when there are no offices', () => {
    expect(computeOfficeSummaries()).toEqual([]);
  });
});

describe('resolveSwitchOffice', () => {
  beforeEach(() => {
    addOffice('office-0', 'HQ', 'default', []);
    addOffice('office-1', 'Fleet', 'fleet-vteam', []);
  });

  it('switches to a valid, non-current office and invokes the delegate', () => {
    const doSwitch = vi.fn();
    const result = resolveSwitchOffice('office-1', doSwitch);
    expect(doSwitch).toHaveBeenCalledWith('office-1');
    expect(result.outcome).toBe('switched');
    expect(result.officeId).toBe('office-1');
  });

  it('reports already-current without invoking the delegate', () => {
    const doSwitch = vi.fn();
    const result = resolveSwitchOffice('office-0', doSwitch);
    expect(doSwitch).not.toHaveBeenCalled();
    expect(result.outcome).toBe('already-current');
  });

  it('reports invalid-target for an unknown officeId', () => {
    const doSwitch = vi.fn();
    const result = resolveSwitchOffice('office-99', doSwitch);
    expect(doSwitch).not.toHaveBeenCalled();
    expect(result.outcome).toBe('invalid-target');
  });

  it('reports invalid-target for an empty officeId', () => {
    const result = resolveSwitchOffice('  ', vi.fn());
    expect(result.outcome).toBe('invalid-target');
  });

  it('reports failed when the delegate throws', () => {
    const result = resolveSwitchOffice('office-1', () => {
      throw new Error('boom');
    });
    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('boom');
  });
});
