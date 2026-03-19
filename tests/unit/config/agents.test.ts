import { describe, expect, it } from 'vitest';
import { generateRandomOfficeAgents } from '../../../src/config/agents';

describe('config/agents', () => {
  it('generates deterministic random agents for the same office id', () => {
    const a = generateRandomOfficeAgents('office-7');
    const b = generateRandomOfficeAgents('office-7');
    expect(a).toEqual(b);
  });

  it('generates different rosters for different office ids', () => {
    const a = generateRandomOfficeAgents('office-7');
    const b = generateRandomOfficeAgents('office-8');

    expect(a.coreAgents.map((x) => x.name)).not.toEqual(b.coreAgents.map((x) => x.name));
  });

  it('returns expected core and reserve counts', () => {
    const result = generateRandomOfficeAgents('office-3');
    expect(result.coreAgents).toHaveLength(4);
    expect(Object.keys(result.reserveAgents)).toHaveLength(6);
    expect(result.coreAgents[0].id).toContain('office-3-agent-');
  });
});

