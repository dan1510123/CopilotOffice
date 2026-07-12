import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';

// spec 015 FR-016 — the ask_user consumer changes must NOT regress ordinary routing:
// normal Teams prompts still dispatch, and generic (non-ask-user) agent events still
// stream, with no spurious answer/notice side effects when no question is pending.

const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl:
    'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
  ackEnabled: false,
  checkInEnabled: false,
  checkInThresholdMs: 120000,
  checkInThrottleMs: 60000,
};

function makeHarness() {
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
  let agentCb: (e: AgentEvent) => void = () => {};
  const submitted: string[] = [];
  const answers: unknown[] = [];
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async (_o, _a, prompt) => {
      submitted.push(prompt);
    },
    submitAnswer: async (_o, _a, payload) => {
      answers.push(payload);
    },
    setForwarding: () => {},
    onAgentEvent: (cb) => {
      agentCb = cb;
      return () => {};
    },
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
  return { service, replies, submitted, answers, inbound: () => emit, agent: () => agentCb };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function prompt(content: string): InboundMessage {
  return {
    messageId: `m-${Math.random().toString(36).slice(2)}`,
    channelId: '19:abc@thread.tacv2',
    threadRootId: 'root-1',
    senderName: 'Alice',
    content,
    composeTime: new Date().toISOString(),
    hasMarker: false,
  };
}

async function online(h: ReturnType<typeof makeHarness>) {
  await h.service.start();
  await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
  h.replies.length = 0;
}

describe('ask_user non-regression (FR-016)', () => {
  it('routes an ordinary Teams prompt to submitPrompt (not submitAnswer) when no question pending', async () => {
    const h = makeHarness();
    await online(h);
    h.inbound()(prompt('what is 2+2'));
    await tick(40);
    expect(h.submitted).toContain('what is 2+2');
    expect(h.answers).toHaveLength(0);
  });

  it('streams a generic turn (tool-start / turn / message) with no answer or spurious notice', async () => {
    const h = makeHarness();
    await online(h);
    h.inbound()(prompt('do the thing'));
    await tick(20);

    // A normal tool-using turn — none of these are ask-user.
    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'do the thing' });
    h.agent()({ agentId: 'generalist', kind: 'turn-start' });
    h.agent()({ agentId: 'generalist', kind: 'tool-start', toolName: 'view' } as AgentEvent);
    h.agent()({ agentId: 'generalist', kind: 'message', content: 'All done.' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await tick(40);

    const joined = h.replies.join('\n');
    expect(joined).toContain('All done.'); // reply streamed as before
    expect(joined.toLowerCase()).not.toContain('answered in the app'); // no false local-resolve notice
    expect(joined.toLowerCase()).not.toContain('needs your answer'); // no question posted
    expect(h.answers).toHaveLength(0);
  });

  it('does not treat a generic local (ambient) turn as an answer', async () => {
    const h = makeHarness();
    await online(h);
    // No inbound → ambient/local turn.
    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'local work' });
    h.agent()({ agentId: 'generalist', kind: 'turn-start' });
    h.agent()({ agentId: 'generalist', kind: 'message', content: 'local reply' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await tick(40);

    expect(h.answers).toHaveLength(0);
    expect(h.replies.join('\n').toLowerCase()).not.toContain('answered in the app');
  });
});
