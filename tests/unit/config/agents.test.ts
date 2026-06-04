import { describe, expect, it } from 'vitest';
import {
  ADMIN_AGENT_ID,
  AGENTS,
  ARCHITECT_AGENT_ID,
  CORE_AGENT_IDS,
  DEBUGGER_AGENT_ID,
  DEFAULT_PLAN_AGENT_IDS,
  GENERALIST_AGENT_ID,
  generateRandomOfficeAgents,
} from '../../../src/config/agents';

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

describe('config/agents — named id constants (S2-E)', () => {
  it('exports each core id as a non-empty string', () => {
    for (const id of [GENERALIST_AGENT_ID, DEBUGGER_AGENT_ID, ADMIN_AGENT_ID, ARCHITECT_AGENT_ID]) {
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
    }
  });

  it('every AGENTS entry id is listed in CORE_AGENT_IDS', () => {
    for (const agent of AGENTS) {
      expect(CORE_AGENT_IDS.has(agent.id)).toBe(true);
    }
  });

  it('DEFAULT_PLAN_AGENT_IDS matches the plannable core agents (no architect)', () => {
    // The architect is the planner — never a plan target.
    expect(DEFAULT_PLAN_AGENT_IDS).toContain(GENERALIST_AGENT_ID);
    expect(DEFAULT_PLAN_AGENT_IDS).toContain(DEBUGGER_AGENT_ID);
    expect(DEFAULT_PLAN_AGENT_IDS).toContain(ADMIN_AGENT_ID);
    expect(DEFAULT_PLAN_AGENT_IDS).not.toContain(ARCHITECT_AGENT_ID);
  });

  it('named id constants match the literal string values used previously', () => {
    // Regression check — confirms the rename didn't drift the canonical values.
    expect(GENERALIST_AGENT_ID).toBe('generalist');
    expect(DEBUGGER_AGENT_ID).toBe('debugger');
    expect(ADMIN_AGENT_ID).toBe('admin');
    expect(ARCHITECT_AGENT_ID).toBe('architect');
  });
});

