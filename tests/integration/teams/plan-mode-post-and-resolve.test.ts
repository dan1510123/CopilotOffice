import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';

// Plan mode wrapper — post an exit_plan_mode plan into the bound thread, present the
// approval actions as selectors, and resolve a labeled reply (approve) or freeform
// reply (request changes) exactly once. Mirrors the ask_user integration tests.

const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl:
    'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
  ackEnabled: false,
  checkInEnabled: false,
  checkInThresholdMs: 120000,
  checkInThrottleMs: 60000,
};

interface PlanCall {
  officeId: string;
  agentId: string;
  d: { requestId?: string; approved: boolean; selectedAction?: string; feedback?: string };
}

function makeHarness(planFails = false) {
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
  const plans: PlanCall[] = [];
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async (_o, _a, prompt) => {
      submitted.push(prompt);
    },
    submitAnswer: async () => {},
    respondPlan: async (officeId, agentId, d) => {
      plans.push({ officeId, agentId, d });
      if (planFails) throw new Error('render-only');
    },
    setForwarding: () => {},
    onAgentEvent: (cb) => {
      agentCb = cb;
      return () => {};
    },
    onSessionExit: () => () => {},
  } as unknown as SessionGateway;

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

  return { service, replies, submitted, plans, inbound: () => emit, agent: () => agentCb };
}

const tick = (ms = 40) => new Promise((r) => setTimeout(r, ms));

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

function plan(h: ReturnType<typeof makeHarness>, requestId = 'req-1') {
  h.agent()({
    agentId: 'generalist',
    kind: 'plan',
    plan: {
      toolId: 'tool-1',
      requestId,
      summary: '- Refactor the parser\n- Add tests',
      planContent: '# Plan\n- Refactor the parser\n- Add tests',
      actions: ['interactive', 'autopilot'],
      recommendedAction: 'interactive',
    },
  } as AgentEvent);
}

describe('plan mode post + resolve (SDK/native-bridge)', () => {
  it('posts the plan summary and a decision message listing labeled actions (recommended first)', async () => {
    const h = makeHarness();
    await online(h);
    plan(h);
    await tick();

    const joined = h.replies.join('\n');
    expect(joined).toContain('Refactor the parser');
    // recommended action rendered first as option A
    expect(joined).toContain('A');
    expect(joined.toLowerCase()).toContain('recommended');
    expect(joined.toLowerCase()).toMatch(/approv|feedback/);
  });

  it('resolves reply "A" by approving with the recommended action once, then clears the record', async () => {
    const h = makeHarness();
    await online(h);
    plan(h);
    await tick();

    h.inbound()(reply('A'));
    await tick();

    expect(h.plans).toHaveLength(1);
    expect(h.plans[0]).toEqual({
      officeId: 'office-0',
      agentId: 'generalist',
      d: { requestId: 'req-1', approved: true, selectedAction: 'interactive', feedback: undefined },
    });
    // not dispatched as a normal prompt
    expect(h.submitted).toHaveLength(0);

    // record cleared → a subsequent reply is a normal prompt, not a plan decision
    h.plans.length = 0;
    h.inbound()(reply('hello again'));
    await tick();
    expect(h.plans).toHaveLength(0);
    expect(h.submitted).toContain('hello again');
  });

  it('treats a non-selector reply as a change request (approved:false, feedback = reply)', async () => {
    const h = makeHarness();
    await online(h);
    plan(h);
    await tick();

    h.inbound()(reply('please also update the docs'));
    await tick();

    expect(h.plans).toHaveLength(1);
    expect(h.plans[0].d.approved).toBe(false);
    expect(h.plans[0].d.feedback).toBe('please also update the docs');
    expect(h.plans[0].d.selectedAction).toBeUndefined();
  });

  it('accepts label variants (lowercase, trailing punctuation)', async () => {
    const h = makeHarness();
    await online(h);
    plan(h);
    await tick();

    h.inbound()(reply('b)'));
    await tick();
    expect(h.plans).toHaveLength(1);
    expect(h.plans[0].d.selectedAction).toBe('autopilot');
    expect(h.plans[0].d.approved).toBe(true);
  });

  it('keeps the plan open and releases the latch when the transport fails', async () => {
    const h = makeHarness(true); // respondPlan throws
    await online(h);
    plan(h);
    await tick();

    h.inbound()(reply('A'));
    await tick();
    expect(h.plans).toHaveLength(1);

    // latch released → a second reply can retry the decision
    h.inbound()(reply('A'));
    await tick();
    expect(h.plans).toHaveLength(2);
  });
});

describe('plan mode render-only (node-pty, empty requestId)', () => {
  it('posts the plan but does NOT track an answerable pending plan', async () => {
    const h = makeHarness();
    await online(h);
    plan(h, ''); // node-pty: no requestId
    await tick();

    expect(h.replies.join('\n')).toContain('Refactor the parser');

    // a reply is treated as a normal prompt (no plan decision recorded)
    h.inbound()(reply('A'));
    await tick();
    expect(h.plans).toHaveLength(0);
    expect(h.submitted).toContain('A');
  });
});

describe('plan mode local resolution (exit_plan_mode.completed)', () => {
  it('clears a Teams pending plan when resolved locally by matching requestId', async () => {
    const h = makeHarness();
    await online(h);
    plan(h);
    await tick();

    h.agent()({
      agentId: 'generalist',
      kind: 'plan-complete',
      planComplete: { requestId: 'req-1', approved: true, selectedAction: 'interactive' },
    } as AgentEvent);
    await tick();

    // now a reply is a normal prompt, not a plan decision
    h.inbound()(reply('A'));
    await tick();
    expect(h.plans).toHaveLength(0);
    expect(h.submitted).toContain('A');
  });
});
