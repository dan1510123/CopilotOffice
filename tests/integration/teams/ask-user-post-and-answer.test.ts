import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';

// spec 015 US1 — post an ask_user question into the bound thread and resolve a labeled reply.

const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl:
    'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
  ackEnabled: false,
  checkInEnabled: false,
  checkInThresholdMs: 120000,
  checkInThrottleMs: 60000,
};

interface AnswerCall {
  officeId: string;
  agentId: string;
  payload: { requestId?: string; answer: string; wasFreeform: boolean };
}

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
  const answers: AnswerCall[] = [];
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async (_o, _a, prompt) => {
      submitted.push(prompt);
    },
    submitAnswer: async (officeId, agentId, payload) => {
      answers.push({ officeId, agentId, payload });
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

  return {
    service,
    replies,
    submitted,
    answers,
    inbound: () => emit,
    agent: () => agentCb,
  };
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
  h.replies.length = 0; // ignore the intro post
}

function askUser(h: ReturnType<typeof makeHarness>, freeform = false) {
  h.agent()({
    agentId: 'generalist',
    kind: 'ask-user',
    askUser: {
      toolId: 'tool-1',
      requestId: 'req-1',
      question: 'Which database should I use?',
      options: [{ text: 'PostgreSQL' }, { text: 'MySQL' }, { text: 'SQLite' }],
      freeform,
    },
  } as AgentEvent);
}

describe('ask-user post + labeled answer (US1)', () => {
  it('posts one framed message listing all labeled options (SC-001)', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h);
    await tick(40);

    const joined = h.replies.join('\n');
    expect(joined).toContain('Which database should I use?');
    expect(joined).toContain('PostgreSQL');
    expect(joined).toContain('MySQL');
    expect(joined).toContain('SQLite');
    // labels A/B/C assigned in order
    expect(joined).toContain('A');
    expect(joined).toContain('B');
    expect(joined).toContain('C');
    // "needs your answer" framing distinct from ordinary replies
    expect(joined.toLowerCase()).toMatch(/answer|question|input/);
  });

  it('resolves reply "B" by submitting option B text once, then clears the record (SC-003)', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h);
    await tick(40);

    h.inbound()(reply('B'));
    await tick(40);

    expect(h.answers).toHaveLength(1);
    expect(h.answers[0]).toEqual({
      officeId: 'office-0',
      agentId: 'generalist',
      payload: { requestId: 'req-1', answer: 'MySQL', wasFreeform: false },
    });
    // the answer was NOT dispatched as a prompt
    expect(h.submitted).toHaveLength(0);

    // record cleared → a subsequent reply is treated as a normal prompt (dispatch), not an answer
    h.answers.length = 0;
    h.inbound()(reply('hello again'));
    await tick(40);
    expect(h.answers).toHaveLength(0);
    expect(h.submitted).toContain('hello again');
  });

  it('accepts label variants (lowercase, trailing punctuation) via label-only matching', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h);
    await tick(40);

    h.inbound()(reply('c)'));
    await tick(40);
    expect(h.answers).toHaveLength(1);
    expect(h.answers[0].payload.answer).toBe('SQLite');
  });
});
