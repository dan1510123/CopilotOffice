import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';

// spec 015 US2 — unrecognized / freeform answers + race guard.

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
    submitAnswer: async (_o, _a, payload) => {
      answers.push({ payload });
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

function askUser(h: ReturnType<typeof makeHarness>, freeform: boolean) {
  h.agent()({
    agentId: 'generalist',
    kind: 'ask-user',
    askUser: {
      toolId: 'tool-1',
      requestId: 'req-1',
      question: 'Pick one',
      options: [{ text: 'Alpha' }, { text: 'Beta' }],
      freeform,
    },
  } as AgentEvent);
}

describe('nudge + freeform + race (US2)', () => {
  it('choices-only + unrecognized reply → nudge posted, record still pending, no submit (SC-005)', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h, false);
    await tick(40);
    h.replies.length = 0;

    h.inbound()(reply('xyz'));
    await tick(40);

    expect(h.answers).toHaveLength(0);
    const joined = h.replies.join('\n');
    expect(joined).toContain('Alpha'); // nudge re-lists options
    expect(joined).toContain('Beta');

    // still pending → a valid label now resolves it
    h.inbound()(reply('B'));
    await tick(40);
    expect(h.answers).toHaveLength(1);
    expect(h.answers[0].payload.answer).toBe('Beta');
  });

  it('freeform + unrecognized reply → submit once with wasFreeform:true (FR-006)', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h, true);
    await tick(40);

    h.inbound()(reply('use whatever you think best'));
    await tick(40);

    expect(h.answers).toHaveLength(1);
    expect(h.answers[0].payload).toEqual({
      requestId: 'req-1',
      answer: 'use whatever you think best',
      wasFreeform: true,
    });
    expect(h.submitted).toHaveLength(0);
  });

  it('near-simultaneous double reply → exactly one submitAnswer (SC-004)', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h, true);
    await tick(40);

    h.inbound()(reply('first freeform'));
    h.inbound()(reply('A'));
    await tick(60);

    expect(h.answers).toHaveLength(1);
  });
});
