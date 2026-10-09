import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';

// ask_user elicitation wrapper — post a structured multi-field form into the bound thread,
// present each field with per-field selector letters, and resolve a line-per-field reply
// (accept with a content map), a cancel reply, or nudge on a bad/missing answer. Mirrors the
// plan-mode and ask_user integration tests.

const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl:
    'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
  ackEnabled: false,
  checkInEnabled: false,
  checkInThresholdMs: 120000,
  checkInThrottleMs: 60000,
} as unknown as TeamsSettings;

interface ElicitCall {
  officeId: string;
  agentId: string;
  e: { requestId?: string; action: 'accept' | 'decline' | 'cancel'; content?: Record<string, string | number | boolean | string[]> };
}

function makeHarness(elicitFails = false) {
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
  const elicits: ElicitCall[] = [];
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async (_o, _a, prompt) => {
      submitted.push(prompt);
    },
    submitAnswer: async () => {},
    respondPlan: async () => {},
    respondElicitation: async (officeId, agentId, e) => {
      elicits.push({ officeId, agentId, e });
      if (elicitFails) throw new Error('render-only');
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

  return { service, replies, submitted, elicits, inbound: () => emit, agent: () => agentCb };
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

type Field = NonNullable<AgentEvent['elicitation']>['fields'][number];

function elicit(h: ReturnType<typeof makeHarness>, fields: Field[], requestId = 'eli-1', mode = 'form') {
  h.agent()({
    agentId: 'generalist',
    kind: 'elicitation',
    elicitation: { toolId: 'tool-1', requestId, message: 'A few details', mode, fields },
  } as AgentEvent);
}

const selectField = (name: string, required = true): Field => ({
  name,
  title: `Choose ${name}`,
  description: '',
  kind: 'select',
  required,
  options: [
    { value: 'alpha', label: 'Alpha' },
    { value: 'beta', label: 'Beta' },
  ],
});

describe('ask_user elicitation post + resolve (SDK/native-bridge)', () => {
  it('posts the message and each field with per-field selector letters', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [selectField('scope'), { name: 'notes', title: 'Notes', description: '', kind: 'string', required: false, options: [] }]);
    await tick();

    const joined = h.replies.join('\n');
    expect(joined).toContain('A few details');
    expect(joined).toContain('Choose scope');
    expect(joined).toContain('Alpha');
    expect(joined).toContain('Notes');
    // multi-field instruction
    expect(joined.toLowerCase()).toContain('one line per question');
  });

  it('resolves a single-field select reply "A" as accept with the chosen option value', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [selectField('scope')]);
    await tick();

    h.inbound()(reply('A'));
    await tick();

    expect(h.elicits).toHaveLength(1);
    expect(h.elicits[0]).toEqual({
      officeId: 'office-0',
      agentId: 'generalist',
      e: { requestId: 'eli-1', action: 'accept', content: { scope: 'alpha' } },
    });
    expect(h.submitted).toHaveLength(0);

    // record cleared → a subsequent reply is a normal prompt
    h.elicits.length = 0;
    h.inbound()(reply('hello again'));
    await tick();
    expect(h.elicits).toHaveLength(0);
    expect(h.submitted).toContain('hello again');
  });

  it('treats a whole single-field free-text reply as the string answer', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [{ name: 'summary', title: 'Summary', description: '', kind: 'string', required: true, options: [] }]);
    await tick();

    h.inbound()(reply('please make it fast and concise'));
    await tick();

    expect(h.elicits[0].e.action).toBe('accept');
    expect(h.elicits[0].e.content).toEqual({ summary: 'please make it fast and concise' });
  });

  it('maps one line per field (select letter, yes/no, number, freeform) in order', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [
      selectField('scope'),
      { name: 'enabled', title: 'Enabled?', description: '', kind: 'boolean', required: true, options: [] },
      { name: 'retries', title: 'Retries', description: '', kind: 'number', required: true, options: [] },
      { name: 'note', title: 'Note', description: '', kind: 'string', required: false, options: [] },
    ]);
    await tick();

    h.inbound()(reply('B\nyes\n3\nship it'));
    await tick();

    expect(h.elicits).toHaveLength(1);
    expect(h.elicits[0].e).toEqual({
      requestId: 'eli-1',
      action: 'accept',
      content: { scope: 'beta', enabled: true, retries: 3, note: 'ship it' },
    });
  });

  it('keeps positional field mapping when an optional mid-field is left blank', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [
      selectField('scope'),
      { name: 'note', title: 'Note', description: '', kind: 'string', required: false, options: [] },
      { name: 'count', title: 'Count', description: '', kind: 'number', required: true, options: [] },
    ]);
    await tick();

    // blank second line skips the optional note; 5 must still bind to count, not note
    h.inbound()(reply('A\n\n5'));
    await tick();

    expect(h.elicits).toHaveLength(1);
    expect(h.elicits[0].e.action).toBe('accept');
    expect(h.elicits[0].e.content).toEqual({ scope: 'alpha', count: 5 });
  });

  it('answers an option-less multiselect as comma-separated freeform values', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [{ name: 'tags', title: 'Tags', description: '', kind: 'multiselect', required: true, options: [] }]);
    await tick();

    h.inbound()(reply('alpha, beta gamma, delta'));
    await tick();

    expect(h.elicits).toHaveLength(1);
    expect(h.elicits[0].e.content).toEqual({ tags: ['alpha', 'beta gamma', 'delta'] });
  });

  it('nudges and keeps the form pending when a required field is missing or unparseable', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [selectField('scope'), { name: 'enabled', title: 'Enabled?', description: '', kind: 'boolean', required: true, options: [] }]);
    await tick();
    h.replies.length = 0;

    // only one line for two required fields, and the boolean is unparseable → nudge, no submit
    h.inbound()(reply('A'));
    await tick();
    expect(h.elicits).toHaveLength(0);
    expect(h.replies.join('\n').toLowerCase()).toContain("couldn't read");

    // a complete reply now resolves it
    h.inbound()(reply('A\nno'));
    await tick();
    expect(h.elicits).toHaveLength(1);
    expect(h.elicits[0].e.content).toEqual({ scope: 'alpha', enabled: false });
  });

  it('dismisses the form on a "cancel" reply (action: cancel)', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [selectField('scope')]);
    await tick();

    h.inbound()(reply('cancel'));
    await tick();
    expect(h.elicits).toHaveLength(1);
    expect(h.elicits[0].e.action).toBe('cancel');
    expect(h.elicits[0].e.content).toBeUndefined();
  });

  it('keeps the form open and releases the latch when the transport fails', async () => {
    const h = makeHarness(true); // respondElicitation throws
    await online(h);
    elicit(h, [selectField('scope')]);
    await tick();

    h.inbound()(reply('A'));
    await tick();
    expect(h.elicits).toHaveLength(1);

    // latch released → a second valid reply retries
    h.inbound()(reply('B'));
    await tick();
    expect(h.elicits).toHaveLength(2);
  });
});

describe('ask_user elicitation render-only (empty requestId / url mode / no fields)', () => {
  it('posts the form but does NOT track an answerable pending form (empty requestId)', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [selectField('scope')], ''); // degraded path: no requestId
    await tick();

    expect(h.replies.join('\n').toLowerCase()).toContain('in the app');

    h.inbound()(reply('A'));
    await tick();
    expect(h.elicits).toHaveLength(0);
    expect(h.submitted).toContain('A');
  });

  it('url-mode forms are render-only', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [], 'eli-u', 'url');
    await tick();

    h.inbound()(reply('A'));
    await tick();
    expect(h.elicits).toHaveLength(0);
    expect(h.submitted).toContain('A');
  });
});

describe('ask_user elicitation local resolution (elicitation.completed)', () => {
  it('clears a Teams pending form when resolved locally by matching requestId', async () => {
    const h = makeHarness();
    await online(h);
    elicit(h, [selectField('scope')]);
    await tick();

    h.agent()({
      agentId: 'generalist',
      kind: 'elicitation-complete',
      elicitationComplete: { requestId: 'eli-1', action: 'accept' },
    } as AgentEvent);
    await tick();

    // now a reply is a normal prompt, not an elicitation answer
    h.inbound()(reply('A'));
    await tick();
    expect(h.elicits).toHaveLength(0);
    expect(h.submitted).toContain('A');
  });
});
