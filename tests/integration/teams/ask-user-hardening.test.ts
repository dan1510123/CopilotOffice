import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';

// spec 015 hardening (h1/h2): precise SDK local-resolution via `ask-user-complete`
// (no false "answered in the app" while the agent is still blocked) and a re-openable
// question when the answer transport fails (no silent drop / agent hang).

const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl:
    'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
  ackEnabled: false,
  checkInEnabled: false,
  checkInThresholdMs: 120000,
  checkInThrottleMs: 60000,
};

function makeHarness(opts: { submitAnswer?: SessionGateway['submitAnswer'] } = {}) {
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
  const answers: Array<{ answer: string; wasFreeform: boolean }> = [];
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async () => {},
    submitAnswer:
      opts.submitAnswer ??
      (async (_o, _a, payload) => {
        answers.push({ answer: payload.answer, wasFreeform: payload.wasFreeform });
      }),
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

  return { service, replies, answers, inbound: () => emit, agent: () => agentCb };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

function reply(content: string): InboundMessage {
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

function askUser(h: ReturnType<typeof makeHarness>, requestId: string) {
  h.agent()({
    agentId: 'generalist',
    kind: 'ask-user',
    askUser: {
      toolId: 'tool-1',
      requestId,
      question: 'Which database should I use?',
      options: [{ text: 'PostgreSQL' }, { text: 'MySQL' }, { text: 'SQLite' }],
      freeform: false,
    },
  } as AgentEvent);
}

describe('ask-user hardening h1 — precise SDK local-resolution', () => {
  it('does NOT post an in-app notice from an ordinary event while an SDK question is still pending', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h, 'req-1'); // non-empty requestId ⇒ SDK path
    await tick(40);
    h.replies.length = 0;

    // Agent emits an ordinary event while STILL blocked on ask_user (e.g. a tool starts).
    h.agent()({ agentId: 'generalist', kind: 'tool-start', toolName: 'read' } as AgentEvent);
    await tick(40);

    // The heuristic must NOT fire for SDK records — no false "answered in the app".
    expect(h.replies.join('\n')).not.toContain('Answered in the app');

    // A later Teams reply still resolves the (still-pending) question exactly once.
    h.inbound()(reply('A'));
    await tick(40);
    expect(h.answers).toEqual([{ answer: 'PostgreSQL', wasFreeform: false }]);
  });

  it('posts the in-app notice precisely on ask-user-complete for the matching requestId', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h, 'req-1');
    await tick(40);
    h.replies.length = 0;

    // A non-matching completion is ignored.
    h.agent()({ agentId: 'generalist', kind: 'ask-user-complete', requestId: 'other' } as AgentEvent);
    await tick(20);
    expect(h.replies.join('\n')).not.toContain('Answered in the app');

    // The matching completion clears the record and posts the one-time notice.
    h.agent()({ agentId: 'generalist', kind: 'ask-user-complete', requestId: 'req-1' } as AgentEvent);
    await tick(40);
    expect(h.replies.join('\n')).toContain('Answered in the app');

    // Record cleared → a Teams answer no longer submits.
    h.inbound()(reply('A'));
    await tick(40);
    expect(h.answers).toHaveLength(0);
  });

  it('does NOT double-notify when the question was answered from Teams then completed', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h, 'req-1');
    await tick(40);

    h.inbound()(reply('A'));
    await tick(40);
    expect(h.answers).toEqual([{ answer: 'PostgreSQL', wasFreeform: false }]);
    h.replies.length = 0;

    // The SDK now reports the interaction completed — record is already gone → no notice.
    h.agent()({ agentId: 'generalist', kind: 'ask-user-complete', requestId: 'req-1' } as AgentEvent);
    await tick(40);
    expect(h.replies.join('\n')).not.toContain('Answered in the app');
  });

  it('node-pty path (empty requestId) still uses the ordinary-event heuristic', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h, ''); // empty requestId ⇒ node-pty degraded path
    await tick(40);
    h.replies.length = 0;

    h.agent()({ agentId: 'generalist', kind: 'turn-end' } as AgentEvent);
    await tick(40);
    expect(h.replies.join('\n')).toContain('Answered in the app');
  });
});

describe('ask-user hardening h2 — re-openable on transport failure', () => {
  it('keeps the question open and re-prompts when submitAnswer fails, then resolves on retry', async () => {
    let failNext = true;
    const delivered: Array<{ answer: string; wasFreeform: boolean }> = [];
    const h = makeHarness({
      submitAnswer: async (_o, _a, payload) => {
        if (failNext) {
          failNext = false;
          throw new Error('transient IPC failure');
        }
        delivered.push({ answer: payload.answer, wasFreeform: payload.wasFreeform });
      },
    });
    await online(h);
    askUser(h, 'req-1');
    await tick(40);
    h.replies.length = 0;

    // First reply: transport fails → the latch is released, record kept, error posted.
    h.inbound()(reply('B'));
    await tick(40);
    expect(delivered).toHaveLength(0);
    expect(h.replies.join('\n').toLowerCase()).toMatch(/couldn.t deliver|reply again/);

    // Second reply for the SAME still-open question now succeeds.
    h.inbound()(reply('B'));
    await tick(40);
    expect(delivered).toEqual([{ answer: 'MySQL', wasFreeform: false }]);
  });
});
