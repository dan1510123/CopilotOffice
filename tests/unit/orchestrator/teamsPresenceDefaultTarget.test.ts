import { describe, expect, it, vi } from 'vitest';
import { buildOrchestratorTools, type OrchestratorToolDeps } from '../../../electron/orchestrator/tools';
import type { BringOnlineCandidate, ActOnResult } from '../../../electron/orchestrator/types';

// spec 021: `set_agent_teams_presence` may omit agentId when bringing an agent
// ONLINE — it then defaults to the next dormant candidate in the office (mirroring
// bring_agent_online). A single name-less call thus brings the next reserve all the
// way online AND into Teams. Taking an agent OFFLINE still requires a concrete id.

function candidate(id: string, name: string): BringOnlineCandidate {
  return { agentId: id, name, skill: 'general', description: '', source: 'reserve', deskId: 'd', officeId: 'office-3' };
}

function makeDeps(candidates: BringOnlineCandidate[]) {
  const requestTeamsPresence = vi.fn(
    async (a: { agentId: string; officeId?: string; online: boolean }): Promise<ActOnResult> => ({
      agentId: a.agentId,
      officeId: a.officeId ?? 'office-3',
      outcome: a.online ? 'online-in-teams' : 'taken-offline',
      message: 'ok',
    }),
  );
  const requestCandidates = vi.fn(async () => candidates);
  const deps = {
    requestCandidates,
    requestTeamsPresence,
    getOfficeId: () => 'office-3',
    // Unused by this tool but required by the interface.
    requestExecute: vi.fn(),
    requestOffices: vi.fn(),
    requestSwitch: vi.fn(),
    requestActiveAgents: vi.fn(),
    requestAwaitingAgents: vi.fn(),
    requestAgentOutput: vi.fn(),
    requestAgentStatus: vi.fn(),
    requestAnswerAgent: vi.fn(),
    requestSendPrompt: vi.fn(),
    requestStopAgent: vi.fn(),
    requestRestartAgent: vi.fn(),
    requestSetTitle: vi.fn(),
  } as unknown as OrchestratorToolDeps;
  return { deps, requestTeamsPresence, requestCandidates };
}

function teamsTool(deps: OrchestratorToolDeps) {
  const tool = buildOrchestratorTools(deps).find((t) => t.name === 'set_agent_teams_presence');
  if (!tool?.handler) throw new Error('set_agent_teams_presence tool not found');
  return tool.handler;
}

describe('set_agent_teams_presence default target', () => {
  it('defaults a blank agentId to the next dormant candidate when bringing online', async () => {
    const { deps, requestTeamsPresence, requestCandidates } = makeDeps([
      candidate('office-6-reserve-4', 'Rhys'),
      candidate('office-6-reserve-5', 'Luna'),
    ]);
    const res = (await teamsTool(deps)({ online: true }, {} as any)) as ActOnResult;
    expect(requestCandidates).toHaveBeenCalledTimes(1);
    expect(requestTeamsPresence).toHaveBeenCalledWith({
      agentId: 'office-6-reserve-4',
      officeId: undefined,
      online: true,
    });
    expect(res.outcome).toBe('online-in-teams');
  });

  it('passes an explicit agentId straight through without listing candidates', async () => {
    const { deps, requestTeamsPresence, requestCandidates } = makeDeps([candidate('office-6-reserve-4', 'Rhys')]);
    await teamsTool(deps)({ agentId: 'office-6-reserve-5', online: true }, {} as any);
    expect(requestCandidates).not.toHaveBeenCalled();
    expect(requestTeamsPresence).toHaveBeenCalledWith({
      agentId: 'office-6-reserve-5',
      officeId: undefined,
      online: true,
    });
  });

  it('returns invalid-target (and never calls presence) when online with no dormant agents', async () => {
    const { deps, requestTeamsPresence } = makeDeps([]);
    const res = (await teamsTool(deps)({ online: true }, {} as any)) as ActOnResult;
    expect(res.outcome).toBe('invalid-target');
    expect(requestTeamsPresence).not.toHaveBeenCalled();
  });

  it('does NOT default when taking an agent offline (requires explicit id)', async () => {
    const { deps, requestTeamsPresence, requestCandidates } = makeDeps([candidate('office-6-reserve-4', 'Rhys')]);
    await teamsTool(deps)({ online: false }, {} as any);
    expect(requestCandidates).not.toHaveBeenCalled();
    expect(requestTeamsPresence).toHaveBeenCalledWith({ agentId: '', officeId: undefined, online: false });
  });
});
