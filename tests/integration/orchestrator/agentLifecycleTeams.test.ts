// Real lifecycle, Teams service, dispatch queue, and relay gateway; external transports are in-memory.
import { EventEmitter } from 'node:events';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentLifecycle, type AgentLifecycleDeps } from '../../../electron/orchestrator/agentLifecycle';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import { RelaySessionGateway, type TerminalRelayLike } from '../../../electron/teams/sessionGateway';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';
import type { StartResult } from '../../../electron/terminal/protocol';
import { DEFAULT_AGENTS, DEFAULT_RESERVE_MAP } from '../../../src/config/agents';
import type { OfficeConfig } from '../../../src/office/officeManager';

const services: TeamsService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  vi.restoreAllMocks();
});

function harness() {
  const officeId = 'office-2';
  const agentId = 'office-2-reserve-0';
  const sessionId = 'verified-background-session';
  const [deskId, reserve] = Object.entries(DEFAULT_RESERVE_MAP)[0];
  const office: OfficeConfig = {
    id: officeId, name: 'Background Office', workingDirectory: 'D:\\isolated-test-office',
    layout: 'default', createdAt: 1, seatedAgents: [],
    customAgents: [{ ...DEFAULT_AGENTS[0], id: 'office-2-agent-0' }],
    customReserveAgents: { [deskId]: { ...reserve, id: agentId, name: 'Background Reserve' } },
  };
  const settings: TeamsSettings = {
    enabled: true,
    defaultChannelUrl: 'https://teams.microsoft.com/l/channel/19%3Atest%40thread.tacv2/Agents?groupId=test-team&tenantId=test-tenant',
    ackEnabled: false, checkInEnabled: false, checkInThresholdMs: 120000, checkInThrottleMs: 60000,
  };
  const order: string[] = [];
  const events = new EventEmitter();
  let ready = false;
  let resolveReady!: (result: StartResult) => void;
  const readiness = new Promise<StartResult>((resolve) => { resolveReady = resolve; });
  const relay: TerminalRelayLike = {
    mainEvents: events,
    mainGetSessionId: vi.fn(async () => ready ? sessionId : null),
    mainGetSessionMeta: vi.fn(async () => ({ title: 'Background task' })),
    mainIsAgentReady: vi.fn(async () => ready),
    mainEnsureSessionOnline: vi.fn(async () => ({ success: false, error: 'Unexpected duplicate startup' })),
    mainSubmitPrompt: vi.fn(async () => ({ success: true })),
    mainSetAgentForwarding: vi.fn(),
    mainWrite: vi.fn(async () => ({ success: true })),
    mainResetSession: vi.fn(async () => ({ success: true })),
    mainRunControl: vi.fn(async () => ({ success: true })),
    mainSubmitAnswer: vi.fn(async () => ({ success: true })),
    mainSubmitPlanDecision: vi.fn(async () => ({ success: true })),
    mainSubmitElicitation: vi.fn(async () => ({ success: true })),
  };
  const graph: GraphSender = {
    createThread: vi.fn(async () => {
      order.push('thread');
      return { threadRootId: 'background-root', webUrl: 'https://example.test/background-thread' };
    }),
    replyToThread: vi.fn(async () => ({ messageId: 'assistant-reply' })),
  };
  let inbound!: (message: InboundMessage) => void;
  const teams = new TeamsService({
    store: new InMemoryTeamsOnlineStore(), graph, gateway: new RelaySessionGateway(relay),
    tokens: { getToken: async () => 'in-memory-token' },
    source: {
      health: 'connected',
      start: async (callback) => { inbound = callback; },
      stop: async () => {},
    },
    getSettings: () => settings, emitStatus: vi.fn(), emitToast: vi.fn(), turnSettleMs: 5,
  });
  services.push(teams);
  const deps: AgentLifecycleDeps = {
    getOffices: vi.fn(async () => [office]),
    getStatuses: vi.fn(async () => ready ? { [agentId]: { alive: true, ready: true, inTurn: false } } : {}),
    ensureSeat: vi.fn(async (id, agent, desk) => {
      expect(id).toBe(officeId);
      office.seatedAgents.push({ agentId: agent, deskId: desk });
      order.push('seat');
    }),
    ensureSession: vi.fn(async () => {
      order.push('start');
      const result = await readiness;
      ready = result.success && result.ready === true;
      order.push('readiness-result');
      return result;
    }),
    teamsPreflight: vi.fn(async () => { order.push('preflight'); }),
    registerTeams: vi.fn(async (agent, verifiedSessionId, deadline) => teams.register({
      officeId: agent.officeId, agentId: agent.agentId, displayName: agent.name,
      workingDir: agent.office.workingDirectory, readySessionId: verifiedSessionId, deadline,
    })),
    stopTeams: vi.fn(async (agent) => teams.goOffline(agent.officeId, agent.agentId)),
  };
  return {
    lifecycle: new AgentLifecycle(deps), deps, teams, graph, relay, office, order, events, resolveReady,
    officeId, agentId, deskId, sessionId,
    inbound: (message: InboundMessage) => inbound(message),
  };
}

describe('background acquisition through Teams dispatch', () => {
  it('awaits verified readiness, registers once, and routes thread prompt and assistant reply to that agent', async () => {
    const h = harness();
    await h.teams.start();
    const args = { officeId: h.officeId, agentId: h.agentId, online: true, requireInactive: true };
    const first = h.lifecycle.run(args);
    const duplicate = h.lifecycle.run(args);
    await vi.waitFor(() => expect(h.deps.ensureSession).toHaveBeenCalledOnce());
    expect(h.office.seatedAgents).toEqual([{ deskId: h.deskId, agentId: h.agentId }]);
    expect(h.deps.registerTeams).not.toHaveBeenCalled();
    expect(h.graph.createThread).not.toHaveBeenCalled();

    h.resolveReady({ success: true, ready: true, sessionId: h.sessionId });
    const result = await first;
    expect(await duplicate).toEqual(result);
    expect(result).toMatchObject({
      outcome: 'online-in-teams', officeId: h.officeId, agentId: h.agentId,
      sessionId: h.sessionId, activated: true, ready: true,
    });
    expect(h.order).toEqual(['preflight', 'seat', 'start', 'readiness-result', 'thread']);
    expect(h.graph.createThread).toHaveBeenCalledOnce();
    expect(h.relay.mainEnsureSessionOnline).not.toHaveBeenCalled();
    expect(h.relay.mainSetAgentForwarding).toHaveBeenCalledWith(h.officeId, h.agentId, true);
    expect(h.graph.createThread).toHaveBeenCalledWith(expect.objectContaining({
      html: expect.stringContaining(h.sessionId),
    }));

    h.inbound({
      messageId: 'human-message', channelId: '19:test@thread.tacv2', threadRootId: 'background-root',
      senderName: 'Tester', content: 'What is 2+2?', composeTime: new Date().toISOString(), hasMarker: false,
    });
    await vi.waitFor(() => expect(h.relay.mainSubmitPrompt).toHaveBeenCalledOnce());
    expect(h.relay.mainSubmitPrompt).toHaveBeenCalledWith(h.officeId, h.agentId, 'What is 2+2?', 'Teams · Tester');
    expect(h.relay.mainWrite).not.toHaveBeenCalled();
    h.events.emit('copilot-turn-start', h.agentId);
    h.events.emit('copilot-event', h.agentId, {
      type: 'assistant.message', data: { content: 'The answer is 4.' },
      id: 'assistant-message', timestamp: new Date().toISOString(), parentId: null,
    });
    h.events.emit('copilot-turn-end', h.agentId);
    await vi.waitFor(() => expect(h.graph.replyToThread).toHaveBeenCalledWith(expect.objectContaining({
      threadRootId: 'background-root', html: expect.stringContaining('The answer is 4.'),
    })));
    expect(h.deps.ensureSession).toHaveBeenCalledOnce();
    expect(h.graph.createThread).toHaveBeenCalledOnce();
  });

  it('never creates a Teams thread or forwarding after startup fails despite a stored session id', async () => {
    const h = harness();
    await h.teams.start();
    const pending = h.lifecycle.run({
      officeId: h.officeId, agentId: h.agentId, online: true, requireInactive: true,
    });
    await vi.waitFor(() => expect(h.deps.ensureSession).toHaveBeenCalledOnce());
    h.resolveReady({ success: false, ready: false, sessionId: 'stored-but-unusable', error: 'Session not controllable' });
    expect(await pending).toMatchObject({ outcome: 'failed', message: expect.stringContaining('Session not controllable') });
    expect(h.deps.registerTeams).not.toHaveBeenCalled();
    expect(h.graph.createThread).not.toHaveBeenCalled();
    expect(h.relay.mainSetAgentForwarding).not.toHaveBeenCalledWith(h.officeId, h.agentId, true);
  });
});
