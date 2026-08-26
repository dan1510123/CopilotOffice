import { describe, it, expect } from 'vitest';
import { resolveOfficeAgentWorkingDir, PC_TERMINAL_AGENT_ID } from '../../../src/office/launchWorkingDir';
import type { OfficeConfig } from '../../../src/office/officeManager';
import type { AgentConfig } from '../../../src/config/agents';

function makeOffice(overrides: Partial<OfficeConfig> = {}): OfficeConfig {
  return {
    id: 'office-1',
    name: 'Test Office',
    workingDirectory: 'C:\\repos\\override-folder',
    createdAt: 0,
    layout: 'default',
    seatedAgents: [],
    ...overrides,
  };
}

function agent(id: string, workingDir?: string): AgentConfig {
  return {
    id,
    name: id,
    skill: 'general',
    sprite: 'npc_random_0',
    color: 0,
    position: { x: 0, y: 0 },
    greeting: '',
    description: '',
    ...(workingDir ? { workingDir } : {}),
  } as AgentConfig;
}

describe('resolveOfficeAgentWorkingDir', () => {
  it('falls back to the office override working directory when the agent has no override', () => {
    const office = makeOffice();
    const res = resolveOfficeAgentWorkingDir(office, 'office-1-agent-0');
    // Regression: New Session must land in the per-office override folder, not
    // the main/default folder.
    expect(res).toEqual({ workingDir: 'C:\\repos\\override-folder', launchMode: 'copilot' });
  });

  it('prefers a per-agent override on the office custom roster', () => {
    const office = makeOffice({
      customAgents: [agent('office-1-agent-0', 'C:\\repos\\agent-specific')],
    });
    const res = resolveOfficeAgentWorkingDir(office, 'office-1-agent-0');
    expect(res?.workingDir).toBe('C:\\repos\\agent-specific');
  });

  it('resolves a per-agent override from the custom reserve roster', () => {
    const office = makeOffice({
      customReserveAgents: { 'desk-1': agent('office-1-reserve-0', 'C:\\repos\\reserve-dir') },
    });
    const res = resolveOfficeAgentWorkingDir(office, 'office-1-reserve-0');
    expect(res?.workingDir).toBe('C:\\repos\\reserve-dir');
  });

  it('uses shell launch mode for the PC terminal', () => {
    const office = makeOffice();
    const res = resolveOfficeAgentWorkingDir(office, PC_TERMINAL_AGENT_ID);
    expect(res).toEqual({ workingDir: 'C:\\repos\\override-folder', launchMode: 'shell' });
  });

  it('returns undefined for an unknown/missing office', () => {
    expect(resolveOfficeAgentWorkingDir(undefined, 'office-1-agent-0')).toBeUndefined();
    expect(resolveOfficeAgentWorkingDir(null, 'office-1-agent-0')).toBeUndefined();
  });

  it('returns undefined when neither the agent nor the office provides a directory', () => {
    const office = makeOffice({ workingDirectory: '' });
    expect(resolveOfficeAgentWorkingDir(office, 'office-1-agent-0')).toBeUndefined();
  });
});
