import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';

// spec 015 US1 — single-resolution across Teams/local + abandonment.

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
    onSessionExit: (cb) => {
      exitCb = cb;
      return () => {};
    },
  };
  let exitCb: (agentId: string) => void = () => {};

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
    exit: () => exitCb,
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
  h.replies.length = 0;
}

function askUser(h: ReturnType<typeof makeHarness>) {
  h.agent()({
    agentId: 'generalist',
    kind: 'ask-user',
    askUser: {
      toolId: 'tool-1',
      requestId: 'req-1',
      question: 'Pick one',
      options: [{ text: 'Alpha' }, { text: 'Beta' }],
      freeform: false,
    },
  } as AgentEvent);
}

describe('single-resolution + abandonment (US1)', () => {
  it('local resolution posts an "answered in app" notice; later Teams reply is a no-op', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h);
    await tick(40);
    h.replies.length = 0;

    // The agent's ask_user is answered in-app → the SDK emits user_input.completed for
    // this requestId (hardening h1: the precise local-resolution signal, not a heuristic).
    h.agent()({ agentId: 'generalist', kind: 'ask-user-complete', requestId: 'req-1' } as AgentEvent);
    await tick(40);

    const joined = h.replies.join('\n').toLowerCase();
    expect(joined).toContain('answered in the app');

    // A later Teams reply for the cleared question does not submit an answer.
    h.inbound()(reply('A'));
    await tick(40);
    expect(h.answers).toHaveLength(0);
  });

  it('near-simultaneous double reply resolves exactly once (SC-004)', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h);
    await tick(40);

    h.inbound()(reply('A'));
    h.inbound()(reply('B'));
    await tick(60);

    expect(h.answers).toHaveLength(1);
    expect(h.answers[0].payload.answer).toBe('Alpha');
  });

  it('goOffline while pending posts "no longer answerable" and drops later replies (FR-009)', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h);
    await tick(40);
    h.replies.length = 0;

    await h.service.goOffline('office-0', 'generalist', true);
    const joined = h.replies.join('\n').toLowerCase();
    expect(joined).toContain('no longer answerable');

    h.inbound()(reply('A'));
    await tick(40);
    expect(h.answers).toHaveLength(0);
  });

  it('onSessionExit while pending posts "no longer answerable" (FR-009)', async () => {
    const h = makeHarness();
    await online(h);
    askUser(h);
    await tick(40);
    h.replies.length = 0;

    h.exit()('generalist');
    await tick(40);
    const joined = h.replies.join('\n').toLowerCase();
    expect(joined).toContain('no longer answerable');
  });
});
