import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';

// spec 015 US3 — question presentation / attention framing (FR-002).

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
  const source: MessageSource = {
    health: 'connected',
    start: async () => {},
    stop: async () => {},
  };
  let agentCb: (e: AgentEvent) => void = () => {};
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async () => {},
    submitAnswer: async () => {},
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
  return { service, replies, agent: () => agentCb };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

async function online(h: ReturnType<typeof makeHarness>) {
  await h.service.start();
  await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
  h.replies.length = 0;
}

function askUser(h: ReturnType<typeof makeHarness>, freeform: boolean) {
  h.agent()({
    agentId: 'generalist',
    kind: 'ask-user',
    askUser: {
      toolId: 'tool-1',
      requestId: 'req-1',
      question: 'Which <db> should I use?',
      options: [{ text: 'PostgreSQL' }, { text: 'MySQL' }],
      freeform,
    },
  } as AgentEvent);
}

describe('ask_user question presentation (US3)', () => {
  it('includes distinct "needs your answer" framing and each Label — text line', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h, false);
    await tick(40);

    const html = h.replies.join('\n');
    expect(html).toContain('needs your answer'); // attention framing distinct from ordinary replies
    expect(html).toContain('<b>A</b> — PostgreSQL');
    expect(html).toContain('<b>B</b> — MySQL');
    // question text is HTML-escaped
    expect(html).toContain('Which &lt;db&gt; should I use?');
  });

  it('omits the freeform hint when freeform is false', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h, false);
    await tick(40);
    expect(h.replies.join('\n')).not.toContain('your own answer');
  });

  it('includes the freeform hint when freeform is true', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h, true);
    await tick(40);
    expect(h.replies.join('\n')).toContain('your own answer');
  });
});
