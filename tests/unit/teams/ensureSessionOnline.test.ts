import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import { CompositeSessionGateway } from '../../../electron/teams/compositeSessionGateway';
import {
  RelaySessionGateway,
  type SessionGateway,
  type TerminalRelayLike,
} from '../../../electron/teams/sessionGateway';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { TeamsSettings } from '../../../electron/teams/types';

const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl:
    'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
  ackEnabled: false,
  checkInEnabled: false,
  checkInThresholdMs: 120000,
  checkInThrottleMs: 60000,
} as TeamsSettings;

function makeGateway(overrides: Partial<SessionGateway> = {}): SessionGateway & { calls: string[] } {
  const calls: string[] = [];
  const gateway: SessionGateway & { calls: string[] } = {
    calls,
    getSessionId: vi.fn(async () => {
      calls.push('getSessionId');
      return 'session-native';
    }),
    getSessionMeta: vi.fn(async () => ({ title: '' })),
    isAgentReady: vi.fn(async () => true),
    submitPrompt: vi.fn(async () => {}),
    submitAnswer: vi.fn(async () => {}),
    respondPlan: vi.fn(async () => {}),
    respondPermission: vi.fn(async () => {}),
    setForwarding: vi.fn(() => {}),
    onAgentEvent: () => () => {},
    onSessionExit: () => () => {},
    ...overrides,
  };
  return gateway;
}

function makeService(gateway: SessionGateway) {
  const graph: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: 'root-1', webUrl: 'https://web/thread' })),
    replyToThread: vi.fn(async () => ({ messageId: 'r1' })),
  };
  const source: MessageSource = { health: 'connected', start: async () => {}, stop: async () => {} };
  const service = new TeamsService({
    store: new InMemoryTeamsOnlineStore(),
    tokens: { getToken: async () => 'fake' },
    graph,
    source,
    gateway,
    getSettings: () => settings,
    emitStatus: () => {},
    emitToast: () => {},
    turnSettleMs: 5,
  });
  return { service, graph };
}

describe('TeamsService.register — ensure session online seam', () => {
  it('ensures the native session is online (in the agent folder) before binding a thread', async () => {
    const ensureSessionOnline = vi.fn(async () => ({ success: true, sessionId: 'session-native' }));
    const gateway = makeGateway({ ensureSessionOnline });
    gateway.calls.length = 0;
    const order: string[] = gateway.calls;
    ensureSessionOnline.mockImplementation(async () => {
      order.push('ensure');
      return { success: true, sessionId: 'session-native' };
    });
    const { service, graph } = makeService(gateway);
    await service.start();

    const result = await service.register({
      officeId: 'office-0',
      agentId: 'generalist',
      displayName: 'Gene',
      workingDir: '"C:\\work\\repo"',
    });

    expect(result).toMatchObject({ success: true, handle: expect.any(String) });
    expect(ensureSessionOnline).toHaveBeenCalledWith('office-0', 'generalist', 'C:\\work\\repo');
    expect(order.slice(0, 2)).toEqual(['ensure', 'getSessionId']);
    expect(graph.createThread).toHaveBeenCalledTimes(1);
    expect(gateway.setForwarding).toHaveBeenCalledWith('office-0', 'generalist', true);
    await service.stop();
  });

  it('surfaces an explicit error and binds nothing when the bridge cannot connect', async () => {
    const gateway = makeGateway({
      ensureSessionOnline: vi.fn(async () => ({
        success: false,
        error: 'Copilot session for office-0:generalist did not become ready within 20s',
      })),
    });
    const { service, graph } = makeService(gateway);
    await service.start();

    const result = await service.register({
      officeId: 'office-0',
      agentId: 'generalist',
      displayName: 'Gene',
      workingDir: 'C:\\work\\repo',
    });

    expect(result).toEqual({
      success: false,
      error: "Couldn't bring the agent's Copilot session online: Copilot session for office-0:generalist did not become ready within 20s",
    });
    expect(gateway.getSessionId).not.toHaveBeenCalled();
    expect(graph.createThread).not.toHaveBeenCalled();
    expect(gateway.setForwarding).not.toHaveBeenCalled();
    expect(service.getStatus('office-0', 'generalist')).toBeNull();
    await service.stop();
  });

  it('re-ensures an existing binding so a dead bridge is resumed instead of blindly reused', async () => {
    const ensureSessionOnline = vi.fn(async () => ({ success: true }));
    const gateway = makeGateway({ ensureSessionOnline });
    const { service } = makeService(gateway);
    await service.start();
    const ctx = { officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' };

    await service.register(ctx);
    const again = await service.register(ctx);

    expect(again).toMatchObject({ success: true, threadWebUrl: 'https://web/thread' });
    expect(ensureSessionOnline).toHaveBeenCalledTimes(2);
    await service.stop();
  });
});

function makeRelay(overrides: Partial<TerminalRelayLike> = {}): TerminalRelayLike {
  return {
    mainGetSessionId: vi.fn(async () => 'session-1'),
    mainGetSessionMeta: vi.fn(async () => null),
    mainWrite: vi.fn(async () => ({ success: true })),
    mainSubmitPrompt: vi.fn(async () => ({ success: true })),
    mainResetSession: vi.fn(async () => ({ success: true })),
    mainRunControl: vi.fn(async () => ({ executed: false as const, error: 'n/a' })),
    mainSubmitAnswer: vi.fn(async () => ({ success: true })),
    mainSubmitPlanDecision: vi.fn(async () => ({ success: true })),
    mainSetAgentForwarding: vi.fn(() => {}),
    mainIsAgentReady: vi.fn(async () => true),
    mainEvents: new EventEmitter() as unknown as TerminalRelayLike['mainEvents'],
    ...overrides,
  };
}

describe('RelaySessionGateway.ensureSessionOnline', () => {
  it('starts or reuses the session through the relay background seam', async () => {
    const mainEnsureSessionOnline = vi.fn(async () => ({ success: true, sessionId: 'session-native', reused: true, ready: true }));
    const gateway = new RelaySessionGateway(makeRelay({ mainEnsureSessionOnline }));

    await expect(gateway.ensureSessionOnline('office-0', 'generalist', 'C:\\work\\repo'))
      .resolves.toEqual({ success: true, sessionId: 'session-native' });
    expect(mainEnsureSessionOnline).toHaveBeenCalledWith('office-0', 'generalist', 'C:\\work\\repo');
  });

  it('returns the explicit relay error and a default reason when none is given', async () => {
    const failing = new RelaySessionGateway(makeRelay({
      mainEnsureSessionOnline: vi.fn(async () => ({ success: false, error: 'bridge did not connect' })),
    }));
    const silent = new RelaySessionGateway(makeRelay({
      mainEnsureSessionOnline: vi.fn(async () => ({ success: false })),
    }));

    await expect(failing.ensureSessionOnline('office-0', 'generalist'))
      .resolves.toEqual({ success: false, error: 'bridge did not connect' });
    await expect(silent.ensureSessionOnline('office-0', 'generalist'))
      .resolves.toEqual({ success: false, error: 'Copilot session for office-0:generalist could not be brought online' });
  });

  it('keeps the legacy contract for relays without the seam', async () => {
    const gateway = new RelaySessionGateway(makeRelay());
    await expect(gateway.ensureSessionOnline('office-0', 'generalist')).resolves.toEqual({ success: true });
  });
});

describe('CompositeSessionGateway.ensureSessionOnline', () => {
  it('routes office agents to the office gateway and treats the orchestrator as always online', async () => {
    const officeEnsure = vi.fn(async () => ({ success: true, sessionId: 'session-native' }));
    const office = makeGateway({ ensureSessionOnline: officeEnsure });
    const orchestrator = makeGateway();
    const composite = new CompositeSessionGateway(office, orchestrator);

    await expect(composite.ensureSessionOnline('office-0', 'generalist', 'dir'))
      .resolves.toEqual({ success: true, sessionId: 'session-native' });
    await expect(composite.ensureSessionOnline('__orchestrator__', 'orchestrator'))
      .resolves.toEqual({ success: true });
    expect(officeEnsure).toHaveBeenCalledTimes(1);
    expect(officeEnsure).toHaveBeenCalledWith('office-0', 'generalist', 'dir');
  });
});
