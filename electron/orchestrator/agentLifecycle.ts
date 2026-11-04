import { buildAgentCatalog, matchCatalogAgents, type CatalogAgent } from '../../src/office/agentCatalog';
import { resolveOfficeAgentWorkingDir } from '../../src/office/launchWorkingDir';
import type { OfficeConfig } from '../../src/office/officeManager';
import type { StartResult } from '../terminal/protocol';
import type { ActOnResult, AgentStatusLookup, AgentTeamsPresence, BringOnlineCandidate, BringOnlineResult } from './types';
import { resolveStatusKey, STATUS_PRESENTATION } from '../../src/config/agentStatusPresentation';

export class AgentTargetError extends Error {
  constructor(readonly outcome: 'ambiguous-target' | 'invalid-target', message: string,
    readonly matches: readonly CatalogAgent[] = []) {
    super(message);
  }
}

export interface AgentRuntimeState {
  alive: boolean;
  ready: boolean;
  inTurn: boolean;
  starting?: boolean;
}

export interface AgentLifecycleDeps {
  getOffices(): Promise<OfficeConfig[]>;
  getStatuses(officeId: string): Promise<Record<string, AgentRuntimeState>>;
  ensureSeat(officeId: string, agentId: string, deskId: string, deadline: number): Promise<void>;
  ensureSession(agent: CatalogAgent, requireInactive: boolean, deadline: number): Promise<StartResult>;
  teamsPreflight(agent: CatalogAgent): Promise<void>;
  registerTeams(agent: CatalogAgent, sessionId: string, deadline: number): Promise<{
    success: boolean; state?: 'online' | 'paused'; threadWebUrl?: string; error?: string;
  }>;
  stopTeams(agent: CatalogAgent): Promise<{ success: boolean }>;
  teamsPresence?(agent: CatalogAgent): Promise<AgentTeamsPresence>;
}

export class AgentLifecycle {
  private readonly operations = new Map<string, { intent: string; promise: Promise<ActOnResult>; token: { cancelled: boolean } }>();

  constructor(private readonly deps: AgentLifecycleDeps) {}

  private async catalog(officeId?: string): Promise<CatalogAgent[]> {
    const offices = await this.deps.getOffices();
    if (officeId && !offices.some((o) => o.id === officeId)) throw new AgentTargetError('invalid-target', `Unknown office "${officeId}".`);
    return buildAgentCatalog(officeId ? offices.filter((o) => o.id === officeId) : offices);
  }

  async candidates(officeId?: string): Promise<BringOnlineCandidate[]> {
    const catalog = await this.catalog(officeId);
    const statuses = new Map<string, Record<string, AgentRuntimeState>>();
    await Promise.all([...new Set(catalog.map((a) => a.officeId))].map(async (id) => {
      statuses.set(id, await this.deps.getStatuses(id));
    }));
    return catalog.filter((a) => {
      const state = statuses.get(a.officeId)?.[a.agentId];
      return !state?.alive && !state?.starting && !this.operations.has(`${a.officeId}:${a.agentId}`);
    }).map(({ config: _config, office: _office, ...candidate }) => candidate);
  }

  async status(agent: CatalogAgent, detail: AgentStatusLookup): Promise<AgentStatusLookup> {
    const state = (await this.deps.getStatuses(agent.officeId))[agent.agentId];
    const hasSession = !!(state?.alive || state?.starting);
    const key = resolveStatusKey({
      state: hasSession ? 'active' : 'slacking',
      subState: state?.starting || (state?.alive && !state.ready) ? 'starting' : state?.inTurn ? 'thinking' : 'ready',
    });
    const snapshot = detail.agent;
    const preserveDetail = snapshot && snapshot.hasSession === hasSession && state?.ready;
    return {
      query: detail.query, outcome: 'found',
      agent: {
        agentId: agent.agentId, officeId: agent.officeId, name: agent.name, officeName: agent.office.name,
        hasSession, statusKey: preserveDetail ? snapshot.statusKey : key,
        statusLabel: preserveDetail ? snapshot.statusLabel : STATUS_PRESENTATION[key].label,
        activity: preserveDetail ? snapshot.activity : '', timeInState: preserveDetail ? snapshot.timeInState : '',
        awaitingInput: preserveDetail ? snapshot.awaitingInput : false,
        ...(preserveDetail && snapshot.pendingQuestion ? { pendingQuestion: snapshot.pendingQuestion } : {}),
      },
      ...(this.deps.teamsPresence ? { teams: await this.deps.teamsPresence(agent) } : {}),
      message: hasSession ? `${agent.name} (${agent.office.name}) has an active session.` : `${agent.name} (${agent.office.name}) has no active session.`,
    };
  }

  async resolve(agentId: string, officeId?: string, requireInactive = false): Promise<CatalogAgent> {
    let matches = matchCatalogAgents(await this.catalog(officeId), agentId, officeId);
    if (!agentId.trim()) {
      const candidates = await this.candidates(officeId);
      matches = matches.filter((a) => candidates.some((c) => c.officeId === a.officeId && c.agentId === a.agentId));
    }
    if (matches.length !== 1) {
      const choices = matches.map((a) => `${a.office.name}: ${a.name} (${a.officeId}/${a.agentId})`).join(', ');
      throw new AgentTargetError(matches.length ? 'ambiguous-target' : 'invalid-target',
        matches.length ? `Ambiguous target. Choose one: ${choices}` : 'No eligible agent matches this request.', matches);
    }
    const agent = matches[0];
    if (requireInactive) {
      const state = (await this.deps.getStatuses(agent.officeId))[agent.agentId];
      if (state?.alive || state?.starting || this.operations.has(`${agent.officeId}:${agent.agentId}`)) {
        throw new Error(`${agent.name} already has an active or starting session; choose an inactive agent.`);
      }
    }
    return agent;
  }

  async bringOnline(agentId: string, officeId?: string): Promise<BringOnlineResult> {
    const result = await this.run({ agentId, officeId, requireInactive: true });
    return {
      agentId: result.agentId, officeId: result.officeId, sessionId: result.sessionId, ready: result.ready,
      outcome: result.outcome === 'sent' ? 'started'
        : result.outcome === 'not-online' ? 'already-active'
        : result.outcome === 'target-became-active' ? 'target-became-active'
        : result.outcome === 'ambiguous-target' ? 'ambiguous-target'
        : result.outcome === 'invalid-target' ? 'invalid-target' : 'failed',
      message: result.message,
    };
  }

  async run(args: { agentId: string; officeId?: string; online?: boolean; requireInactive?: boolean }): Promise<ActOnResult> {
    let agent: CatalogAgent;
    try {
      agent = await this.resolve(args.agentId, args.officeId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { agentId: args.agentId, officeId: args.officeId ?? '',
        outcome: error instanceof AgentTargetError ? error.outcome : 'failed', message };
    }
    const key = `${agent.officeId}:${agent.agentId}`;
    const intent = JSON.stringify([args.online, !!args.requireInactive]);
    const pending = this.operations.get(key);
    if (pending) {
      if (pending.intent === intent) return pending.promise;
      if (args.online === false) {
        pending.token.cancelled = true;
        try {
          const stopped = await this.deps.stopTeams(agent);
          return { agentId: agent.agentId, officeId: agent.officeId, outcome: stopped.success ? 'taken-offline' : 'failed',
            message: stopped.success ? 'Teams connection cancelled and taken offline.' : 'Teams disconnect failed.' };
        } catch (error) {
          return { agentId: agent.agentId, officeId: agent.officeId, outcome: 'failed',
            message: error instanceof Error ? error.message : String(error) };
        }
      }
      return { agentId: agent.agentId, officeId: agent.officeId, outcome: 'failed',
        message: 'Another lifecycle operation is in progress for this agent. Retry after it completes.' };
    }
    const operation = { cancelled: false };
    const promise = this.execute(agent, args, operation).finally(() => {
      if (this.operations.get(key)?.promise === promise) this.operations.delete(key);
    });
    this.operations.set(key, { intent, promise, token: operation });
    return promise;
  }

  private async execute(agent: CatalogAgent, args: { online?: boolean; requireInactive?: boolean },
    operation: { cancelled: boolean }): Promise<ActOnResult> {
    const target = { agentId: agent.agentId, officeId: agent.officeId };
    let readySession: string | undefined;
    let activated = false;
    let stage = 'validation';
    const deadline = Date.now() + 60_000;
    const bounded = async <T>(action: () => Promise<T>): Promise<T> => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Lifecycle operation deadline exceeded.');
      if (operation.cancelled) throw new Error('Lifecycle operation cancelled by a later disconnect request.');
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([action(), new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new Error('Lifecycle operation deadline exceeded.')), remaining);
        })]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
    try {
      if (args.online === false) {
        const result = await bounded(() => this.deps.stopTeams(agent));
        return { ...target, outcome: result.success ? 'taken-offline' : 'failed',
          message: result.success ? `${agent.name} is offline in Teams.` : `Could not take ${agent.name} offline in Teams.` };
      }
      const launch = resolveOfficeAgentWorkingDir(agent.office, agent.agentId);
      if (!launch?.workingDir || launch.launchMode !== 'copilot') throw new Error('No Copilot launch directory is configured.');
      if (args.online) {
        stage = 'Teams configuration';
        await bounded(() => this.deps.teamsPreflight(agent));
      }
      const state = (await bounded(() => this.deps.getStatuses(agent.officeId)))[agent.agentId];
      if (args.requireInactive && (state?.alive || state?.starting)) {
        return { ...target, outcome: args.online ? 'target-became-active' : 'not-online',
          message: `${agent.name} already has an active session. It was not restarted or connected as a new agent.` };
      }
      stage = 'seat persistence';
      if (agent.source === 'reserve' && agent.deskId) {
        const deskId = agent.deskId;
        await bounded(() => this.deps.ensureSeat(agent.officeId, agent.agentId, deskId, deadline));
      }
      stage = 'session readiness';
      const started = await bounded(() => this.deps.ensureSession(agent, !!args.requireInactive, deadline));
      if (!started.success || !started.ready || !started.sessionId) {
        if (started.alreadyActive) return { ...target, outcome: 'target-became-active', message: started.error ?? 'Agent became active before startup.' };
        throw new Error(started.error ?? 'Backend did not confirm a controllable session.');
      }
      readySession = started.sessionId;
      const sessionId = started.sessionId;
      activated = !state?.alive && !started.reused;
      if (!args.online) {
        return { ...target, outcome: 'sent', message: `${agent.name} is online and ready.`,
          sessionId: readySession, ready: true, activated };
      }
      stage = 'Teams registration';
      const teams = await bounded(() => this.deps.registerTeams(agent, sessionId, deadline));
      if (!teams.success || !teams.state) throw new Error(teams.error ?? 'Teams did not confirm its connection state.');
      return { ...target, outcome: teams.state === 'paused' ? 'paused' : 'online-in-teams',
        message: teams.state === 'paused' ? `${agent.name} is ready; its Teams connection remains paused.` : `${agent.name} is online in Teams.`,
        threadWebUrl: teams.threadWebUrl, sessionId: readySession, ready: true, activated };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      console.warn(`[Ringleader] ${target.officeId}:${target.agentId} failed at ${stage}: ${reason}`);
      return { ...target, outcome: stage === 'Teams configuration' ? 'unavailable' : 'failed',
        message: `${readySession ? 'Session ready; ' : ''}${stage} failed: ${reason}`,
        ...(readySession ? { sessionId: readySession, ready: true, activated } : {}) };
    }
  }
}
