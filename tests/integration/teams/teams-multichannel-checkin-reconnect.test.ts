import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings, OnlineAgentBinding } from '../../../electron/teams/types';

const CH_A = '19:aaa@thread.tacv2';
const CH_B = '19:bbb@thread.tacv2';
const URL_A = `https://teams.microsoft.com/l/channel/19%3Aaaa%40thread.tacv2/A?groupId=team-a&tenantId=tn`;
const URL_B = `https://teams.microsoft.com/l/channel/19%3Abbb%40thread.tacv2/B?groupId=team-b&tenantId=tn`;

function baseSettings(over: Partial<TeamsSettings> = {}): TeamsSettings {
  return {
    enabled: true,
    defaultChannelUrl: URL_A,
    relayChannelUrl: '',
    relayMentionType: 'none',
    relayMentionValue: '',
    notifyOnCompleteEnabled: false,
    ackEnabled: false,
    checkInEnabled: false,
    checkInThresholdMs: 120000,
    checkInThrottleMs: 60000,
    ...over,
  };
}

function makeHarness(opts: { settings?: TeamsSettings; now?: () => number; seed?: OnlineAgentBinding[]; notify?: boolean } = {}) {
  const store = new InMemoryTeamsOnlineStore(
    opts.seed ? { bindings: opts.seed, knownThreads: opts.seed.map((b) => ({ threadRootId: b.threadRootId, noticePosted: false })) } : undefined,
  );
  const tokens: TokenProvider = { getToken: async () => 'fake' };
  const replies: Array<{ threadRootId: string; html: string }> = [];
  let threadSeq = 0;
  const graph: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: `root-${++threadSeq}`, webUrl: 'https://web' })),
    replyToThread: vi.fn(async (p) => { replies.push({ threadRootId: p.threadRootId, html: p.html }); return { messageId: 'x' }; }),
  };
  // Distinct-identity notifier (relay/Dump channel) used only for the completion ping.
  const notifies: Array<{ threadRootId: string; html: string }> = [];
  const notifier: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: 'dump', webUrl: 'https://web' })),
    replyToThread: vi.fn(async (p) => { notifies.push({ threadRootId: p.threadRootId, html: p.html }); return { messageId: '' }; }),
  };
  let emit: (m: InboundMessage) => void = () => {};
  const source: MessageSource = { health: 'connected', start: async (cb) => { emit = cb; }, stop: async () => {} };
  let agentCb: (e: AgentEvent) => void = () => {};
  const submitted: Array<{ agentId: string; prompt: string }> = [];
  const sessionByAgent: Record<string, string | null> = { generalist: 'session-1', debugger: 'session-2' };
  const readyByAgent: Record<string, boolean> = { generalist: true, debugger: true };
  const gateway: SessionGateway = {
    getSessionId: async (_o, a) => sessionByAgent[a] ?? null,
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async (_o, a) => readyByAgent[a] ?? true,
    submitPrompt: async (_o, a, prompt) => { submitted.push({ agentId: a, prompt }); },
    setForwarding: () => {},
    onAgentEvent: (cb) => { agentCb = cb; return () => {}; },
    onSessionExit: () => () => {},
  };
  const service = new TeamsService({
    store, tokens, graph, source, gateway,
    notifier,
    isNotifyActive: () => opts.notify ?? false,
    getSettings: () => opts.settings ?? baseSettings(),
    emitStatus: () => {}, emitToast: () => {},
    now: opts.now,
    turnSettleMs: 5,
  });
  return { service, replies, notifies, submitted, sessionByAgent, readyByAgent, inbound: () => emit, agent: () => agentCb };
}

const inbound = (channelId: string, threadRootId: string, content: string): InboundMessage => ({
  messageId: `m-${Math.random()}`, channelId, threadRootId, senderName: 'Alice', content,
  composeTime: new Date().toISOString(), hasMarker: false,
});

describe('teams multichannel (US3, FR-005)', () => {
  it('routes replies to the right agent across two channels', async () => {
    const h = makeHarness();
    await h.service.start();
    // Gene on default channel A (office-0), Dan on override channel B (office-1).
    const a = await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    const b = await h.service.register({ officeId: 'office-1', agentId: 'debugger', displayName: 'Dan', workingDir: '.', officeChannelUrl: URL_B });
    expect(a.success && b.success).toBe(true);

    // Message in channel B / Dan's thread → routes to debugger only.
    h.inbound()(inbound(CH_B, 'root-2', 'hi dan'));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.submitted).toEqual([{ agentId: 'debugger', prompt: 'hi dan' }]);

    // Message in channel A / Gene's thread → routes to generalist.
    h.inbound()(inbound(CH_A, 'root-1', 'hi gene'));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.submitted).toContainEqual({ agentId: 'generalist', prompt: 'hi gene' });
  });
});

describe('teams check-ins (US5, FR-016)', () => {
  it('posts a throttled interim update on a long turn when enabled', async () => {
    let t = 1_000_000;
    const h = makeHarness({ settings: baseSettings({ checkInEnabled: true, checkInThresholdMs: 1000, checkInThrottleMs: 500 }), now: () => t });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.inbound()(inbound(CH_A, 'root-1', 'do a big task'));
    await new Promise((r) => setTimeout(r, 20));

    // Advance past the check-in threshold, then a tool starts.
    t += 2000;
    h.agent()({ agentId: 'generalist', kind: 'tool-start', toolName: 'grep' });
    await new Promise((r) => setTimeout(r, 20));

    expect(h.replies.some((r) => /still working/i.test(r.html))).toBe(true);
  });

  it('does not post check-ins when disabled', async () => {
    let t = 1_000_000;
    const h = makeHarness({ settings: baseSettings({ checkInEnabled: false, checkInThresholdMs: 1000 }), now: () => t });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    h.inbound()(inbound(CH_A, 'root-1', 'task'));
    await new Promise((r) => setTimeout(r, 20));
    t += 5000;
    h.agent()({ agentId: 'generalist', kind: 'tool-start', toolName: 'grep' });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.replies.some((r) => /still working/i.test(r.html))).toBe(false);
  });
});

describe('teams acknowledgment + agent-name prefix (US5)', () => {
  it('posts an immediate hourglass ack on dispatch when enabled, with a bold agent-name prefix', async () => {
    const h = makeHarness({ settings: baseSettings({ ackEnabled: true }) });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.inbound()(inbound(CH_A, 'root-1', 'do a task'));
    await new Promise((r) => setTimeout(r, 20));

    const ack = h.replies.find((r) => /message received/i.test(r.html));
    expect(ack).toBeDefined();
    expect(ack!.html).toContain('⌛');
    expect(ack!.html).toContain('<b>Gene</b>');
  });

  it('does not ack when disabled', async () => {
    const h = makeHarness({ settings: baseSettings({ ackEnabled: false }) });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    h.inbound()(inbound(CH_A, 'root-1', 'do a task'));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.replies.some((r) => /message received/i.test(r.html))).toBe(false);
  });

  it('prefixes the assistant reply with the bold agent name', async () => {
    const h = makeHarness({ settings: baseSettings({ ackEnabled: false }) });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    h.inbound()(inbound(CH_A, 'root-1', 'what is 2+2'));
    await new Promise((r) => setTimeout(r, 20));
    h.agent()({ agentId: 'generalist', kind: 'message', content: '4' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await new Promise((r) => setTimeout(r, 20));
    const reply = h.replies.find((r) => r.html.includes('4'));
    expect(reply).toBeDefined();
    expect(reply!.html.startsWith('<b>Gene</b>')).toBe(true);
  });

  it('never re-dispatches its own ack echo (self-loop guard)', async () => {
    const h = makeHarness({ settings: baseSettings({ ackEnabled: true }) });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    h.inbound()(inbound(CH_A, 'root-1', 'hello'));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.submitted).toHaveLength(1);

    // Simulate Teams echoing our ack back (replyToThread returns messageId 'x').
    h.inbound()({
      messageId: 'x', channelId: CH_A, threadRootId: 'root-1', senderName: 'Gene (app identity)',
      content: 'Gene ⌛ Working on this… (message received)', composeTime: new Date().toISOString(), hasMarker: false,
    });
    await new Promise((r) => setTimeout(r, 20));
    // No second dispatch — the echo was dropped by the message-id guard.
    expect(h.submitted).toHaveLength(1);
  });
});

describe('teams reconnect (FR-024, SC-010)', () => {
  it('re-binds a persisted binding when its session reappears, with no new thread', async () => {
    const seed: OnlineAgentBinding[] = [{
      agentId: 'generalist', officeId: 'office-0', sessionId: 'session-1', handle: 'gene',
      displayName: 'Gene', workingDir: '.', sessionTitle: '', teamId: 'team-a', channelId: CH_A,
      tenantId: 'tn', threadRootId: 'root-seed', threadWebUrl: 'https://web', online: true,
      lastConnected: Date.now(),
    }];
    const h = makeHarness({ seed });
    await h.service.start(); // loads as offline, reconcile() re-binds since session-1 matches
    await new Promise((r) => setTimeout(r, 20)); // let the fire-and-forget reconcile() settle

    const status = h.service.getStatus('office-0', 'generalist');
    expect(status?.online).toBe(true);
    // No new thread created on reconnect.
    // (createThread is only called by register(), never on reconnect.)

    // A reconnect notice is posted into the existing thread, prefixed with the bold agent name.
    const notice = h.replies.find((r) => /reconnected/i.test(r.html));
    expect(notice).toBeDefined();
    expect(notice!.threadRootId).toBe('root-seed');
    expect(notice!.html).toContain('<b>Gene</b>');
  });

  it('reconcileNow() re-onlines a binding whose session reappears after start', async () => {
    const seed: OnlineAgentBinding[] = [{
      agentId: 'generalist', officeId: 'office-0', sessionId: 'session-1', handle: 'gene',
      displayName: 'Gene', workingDir: '.', sessionTitle: '', teamId: 'team-a', channelId: CH_A,
      tenantId: 'tn', threadRootId: 'root-seed', threadWebUrl: 'https://web', online: true,
      lastConnected: Date.now(),
    }];
    // Session not available yet at start → binding stays offline after the initial reconcile.
    const h = makeHarness({ seed });
    h.sessionByAgent.generalist = null;
    await h.service.start();
    expect(h.service.getStatus('office-0', 'generalist')?.online).toBe(false);

    // Session reappears (terminal reconnect), then an on-demand reconcile re-onlines it
    // immediately — no waiting for the periodic tick.
    h.sessionByAgent.generalist = 'session-1';
    await h.service.reconcileNow();
    expect(h.service.getStatus('office-0', 'generalist')?.online).toBe(true);
  });

  it('reconcileNow() is a no-op before start()', async () => {
    const h = makeHarness();
    await expect(h.service.reconcileNow()).resolves.toBeUndefined();
  });

  it('does NOT online or post a reconnect notice while the session is not ready', async () => {
    const seed: OnlineAgentBinding[] = [{
      agentId: 'generalist', officeId: 'office-0', sessionId: 'session-1', handle: 'gene',
      displayName: 'Gene', workingDir: '.', sessionTitle: '', teamId: 'team-a', channelId: CH_A,
      tenantId: 'tn', threadRootId: 'root-seed', threadWebUrl: 'https://web', online: true,
      lastConnected: Date.now(),
    }];
    const h = makeHarness({ seed });
    // Session id is persisted (getSessionId returns it) but the agent is NOT ready.
    h.readyByAgent.generalist = false;
    await h.service.start();
    await new Promise((r) => setTimeout(r, 20)); // let the initial reconcile() run (with ready=false)

    // Stays offline; no premature "reconnected" notice posted to the thread.
    expect(h.service.getStatus('office-0', 'generalist')?.online).toBe(false);
    expect(h.replies.some((r) => /reconnected/i.test(r.html))).toBe(false);

    // Once the agent becomes ready, an on-demand reconcile onlines + notifies.
    h.readyByAgent.generalist = true;
    await h.service.reconcileNow();
    expect(h.service.getStatus('office-0', 'generalist')?.online).toBe(true);
    expect(h.replies.some((r) => /reconnected/i.test(r.html))).toBe(true);
  });
});

describe('teams completion notification (distinct-identity ping at idle)', () => {
  async function runReply(h: ReturnType<typeof makeHarness>, content?: string) {
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    h.inbound()(inbound(CH_A, 'root-1', 'what is the answer'));
    await new Promise((r) => setTimeout(r, 20));
    if (content) h.agent()({ agentId: 'generalist', kind: 'message', content });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await new Promise((r) => setTimeout(r, 40)); // let the settle debounce → finalizeDispatch fire
  }

  it('fires exactly ONE completion ping via the notifier once the agent goes idle', async () => {
    const h = makeHarness({ settings: baseSettings({ notifyOnCompleteEnabled: true }), notify: true });
    await runReply(h, 'The answer is 42');

    // Content posted directly (as the signed-in user) via graph, NOT via the notifier.
    expect(h.replies.some((r) => r.html.includes('42'))).toBe(true);
    // Exactly one distinct-identity completion ping, with the agent name + a preview.
    expect(h.notifies).toHaveLength(1);
    expect(h.notifies[0].html).toMatch(/finished replying/i);
    expect(h.notifies[0].html).toContain('<b>Gene</b>');
    expect(h.notifies[0].html).toContain('42');
  });

  it('does NOT ping when the notification is inactive', async () => {
    const h = makeHarness({ settings: baseSettings({ notifyOnCompleteEnabled: false }), notify: false });
    await runReply(h, 'hello there');
    expect(h.replies.some((r) => r.html.includes('hello there'))).toBe(true);
    expect(h.notifies).toHaveLength(0);
  });

  it('does NOT ping when the response produced no text', async () => {
    const h = makeHarness({ settings: baseSettings({ notifyOnCompleteEnabled: true }), notify: true });
    await runReply(h); // turn-end with no message content
    expect(h.notifies).toHaveLength(0);
  });
});
