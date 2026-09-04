import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';
import type { ControlCommandResult } from '../../../electron/terminal/protocol';

const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl:
    'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
  ackEnabled: false,
  checkInEnabled: false,
  checkInThresholdMs: 120000,
  checkInThrottleMs: 60000,
};

async function waitFor(predicate: () => boolean, timeoutMs = 2000): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) return;
    await new Promise((r) => setTimeout(r, 5));
  }
}

function makeHarness(controlResult: ControlCommandResult) {
  const store = new InMemoryTeamsOnlineStore();
  const tokens: TokenProvider = { getToken: async () => 'fake' };

  const replies: string[] = [];
  const graph: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: 'root-1', webUrl: 'https://web/thread' })),
    replyToThread: vi.fn(async (p) => {
      replies.push(p.html);
      return { messageId: `reply-${replies.length}` };
    }),
  };

  let emit: (m: InboundMessage) => void = () => {};
  const source: MessageSource = {
    health: 'connected',
    start: async (cb) => {
      emit = cb;
    },
    stop: async () => {},
  };

  const submitted: string[] = [];
  const resetSession = vi.fn(async () => 'fresh-session-id');
  const runControl = vi.fn(async () => controlResult);
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: 'Fixing scroll' }),
    isAgentReady: async () => true,
    submitPrompt: async (_o, _a, prompt) => {
      submitted.push(prompt);
    },
    resetSession,
    runControl,
    setForwarding: () => {},
    onAgentEvent: () => () => {},
    onSessionExit: () => () => {},
  };

  const service = new TeamsService({
    store,
    tokens,
    graph,
    source,
    gateway,
    getSettings: () => settings,
    emitStatus: () => {},
    emitToast: () => {},
    turnSettleMs: 5,
  });

  return { service, replies, submitted, resetSession, runControl, inbound: () => emit };
}

function inbound(content: string): InboundMessage {
  return {
    messageId: `m-${Math.random()}`,
    channelId: '19:abc@thread.tacv2',
    threadRootId: 'root-1',
    senderName: 'Alice',
    content,
    composeTime: new Date().toISOString(),
    hasMarker: false,
  };
}

async function register(h: ReturnType<typeof makeHarness>) {
  await h.service.start();
  await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: 'C:/repo' });
}

describe('teams slash-command interception', () => {
  it('/compact runs runControl and posts the summary — never enqueues a prompt', async () => {
    const h = makeHarness({ executed: true, via: 'sdk', data: { kind: 'compact', success: true, tokensRemoved: 5000, messagesRemoved: 3, summary: 'Compacted the plan' } });
    await register(h);

    h.inbound()(inbound('/compact'));
    await waitFor(() => h.replies.some((r) => r.includes('compacted')));

    expect(h.runControl).toHaveBeenCalledWith('office-0', 'generalist', 'compact', undefined);
    expect(h.replies.some((r) => r.includes('Compacted the plan'))).toBe(true);
    expect(h.submitted).toEqual([]);
  });

  it('/model <id> forwards the arg to runControl', async () => {
    const h = makeHarness({ executed: true, via: 'sdk', data: { kind: 'model', current: 'gpt-5.6-sol', switchedTo: 'gpt-5.6-sol' } });
    await register(h);

    h.inbound()(inbound('/model gpt-5.6-sol'));
    await waitFor(() => h.replies.some((r) => r.includes('Switched model')));

    expect(h.runControl).toHaveBeenCalledWith('office-0', 'generalist', 'model', 'gpt-5.6-sol');
    expect(h.submitted).toEqual([]);
  });

  it('a failed control command posts a graceful notice', async () => {
    const h = makeHarness({ executed: false, error: 'compaction is not supported by this session' });
    await register(h);

    h.inbound()(inbound('/compact'));
    await waitFor(() => h.replies.some((r) => r.includes("couldn't run")));

    expect(h.replies.some((r) => r.includes('not supported by this session'))).toBe(true);
    expect(h.submitted).toEqual([]);
  });

  it('/new resets the session and confirms', async () => {
    const h = makeHarness({ executed: true, via: 'sdk', data: { kind: 'compact', success: true, tokensRemoved: 0, messagesRemoved: 0 } });
    await register(h);

    h.inbound()(inbound('/new'));
    await waitFor(() => h.replies.some((r) => r.includes('fresh session')));

    expect(h.resetSession).toHaveBeenCalledWith('office-0', 'generalist');
    expect(h.runControl).not.toHaveBeenCalled();
    expect(h.submitted).toEqual([]);
  });

  it('/help posts the supported-commands list without touching the gateway', async () => {
    const h = makeHarness({ executed: true, via: 'sdk', data: { kind: 'compact', success: true, tokensRemoved: 0, messagesRemoved: 0 } });
    await register(h);

    h.inbound()(inbound('/help'));
    await waitFor(() => h.replies.some((r) => r.includes('/compact')));

    expect(h.runControl).not.toHaveBeenCalled();
    expect(h.resetSession).not.toHaveBeenCalled();
    expect(h.submitted).toEqual([]);
  });

  it('an unknown slash falls through to normal prompt dispatch', async () => {
    const h = makeHarness({ executed: true, via: 'sdk', data: { kind: 'compact', success: true, tokensRemoved: 0, messagesRemoved: 0 } });
    await register(h);

    h.inbound()(inbound('/foobar do a thing'));
    await waitFor(() => h.submitted.length > 0);

    expect(h.submitted).toEqual(['/foobar do a thing']);
    expect(h.runControl).not.toHaveBeenCalled();
    expect(h.resetSession).not.toHaveBeenCalled();
  });
});
