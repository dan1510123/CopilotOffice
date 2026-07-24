import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { TeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { TeamsSettings } from '../../../electron/teams/types';

const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl:
    'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
  ackEnabled: false,
  checkInEnabled: false,
  checkInThresholdMs: 120000,
  checkInThrottleMs: 60000,
};

function makeHarness(opts: { store?: TeamsOnlineStore; sessionId?: () => string } = {}) {
  const store = opts.store ?? new InMemoryTeamsOnlineStore();
  const tokens: TokenProvider = { getToken: async () => 'fake' };

  const replies: string[] = [];
  const graph: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: 'root-1', webUrl: 'https://web/thread' })),
    replyToThread: vi.fn(async (p) => {
      replies.push(p.html);
      return { messageId: `reply-${replies.length}` };
    }),
  };
  const notifier: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: '', webUrl: '' })),
    replyToThread: vi.fn(async () => ({ messageId: 'notify' })),
  };

  const source: MessageSource = {
    health: 'connected',
    start: async () => {},
    stop: async () => {},
  };

  let agentCb: (e: AgentEvent) => void = () => {};
  const forwarding: { agentId: string; enabled: boolean }[] = [];
  const getSessionId = opts.sessionId ?? (() => 'session-1');
  const gateway: SessionGateway = {
    getSessionId: async () => getSessionId(),
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async () => {},
    setForwarding: (_o, a, enabled) => {
      forwarding.push({ agentId: a, enabled });
    },
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
    notifier,
    isNotifyActive: () => false,
    source,
    gateway,
    getSettings: () => settings,
    emitStatus: () => {},
    emitToast: () => {},
    turnSettleMs: 5,
  });

  return { service, store, replies, forwarding, agent: () => agentCb };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('spec 017 enh 1 — orchestrator follow-up attribution in Teams', () => {
  it('labels an orchestrator-initiated ambient turn as "Orchestrator", not "Human local request"', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.service.noteOrchestratorPrompt('generalist');
    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'thank Gene for me' });
    await tick(40);

    const joined = h.replies.join('\n');
    expect(joined).toContain('🎩 <b>Orchestrator</b>');
    expect(joined).toContain('follow-up');
    expect(joined).toContain('thank Gene for me');
    expect(joined).not.toContain('👤 <b>Human</b>');
  });

  it('still labels a genuine local (human) request as "Human local request"', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'refactor the parser' });
    await tick(40);

    const joined = h.replies.join('\n');
    expect(joined).toContain('👤 <b>Human</b>');
    expect(joined).toContain('local request');
    expect(joined).not.toContain('Orchestrator');
  });

  it('consumes the tag one-shot — the NEXT local turn reverts to Human', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.service.noteOrchestratorPrompt('generalist');
    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'first (from orch)' });
    await tick(40);
    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'second (from human)' });
    await tick(40);

    const first = h.replies.find((r) => r.includes('first (from orch)'));
    const second = h.replies.find((r) => r.includes('second (from human)'));
    expect(first).toContain('🎩 <b>Orchestrator</b>');
    expect(second).toContain('👤 <b>Human</b>');
  });

  it('ignores the tag when the agent is not online in Teams', async () => {
    const h = makeHarness();
    await h.service.start();
    // Not registered → not online. noteOrchestratorPrompt must be a no-op.
    h.service.noteOrchestratorPrompt('generalist');
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'hello' });
    await tick(40);

    expect(h.replies.join('\n')).toContain('👤 <b>Human</b>');
  });
});

describe('spec 017 enh 2 — restore orchestrator Teams presence on startup', () => {
  it('re-onlines a persisted binding to its existing thread, adopting a new session id', async () => {
    const store = new InMemoryTeamsOnlineStore();
    let sid = 'session-a';

    // First run: register online, then simulate app close (stop keeps the binding).
    const h1 = makeHarness({ store, sessionId: () => sid });
    await h1.service.start();
    await h1.service.register({ officeId: '__orchestrator__', agentId: 'orchestrator', displayName: 'Office Orchestrator', workingDir: '.' });
    await h1.service.stop();

    // Second run (new launch): a FRESH session id, binding reloaded offline.
    sid = 'session-b';
    const h2 = makeHarness({ store, sessionId: () => sid });
    await h2.service.start();
    expect(h2.service.getStatus('__orchestrator__', 'orchestrator')?.online).toBe(false);

    const res = await h2.service.reonlineToCurrentSession('__orchestrator__', 'orchestrator');
    expect(res.success).toBe(true);
    expect(h2.service.getStatus('__orchestrator__', 'orchestrator')?.online).toBe(true);
    expect(h2.replies.join('\n')).toContain('Reconnected');
    expect(h2.forwarding).toContainEqual({ agentId: 'orchestrator', enabled: true });
  });

  it('is a no-op when there is no persisted binding to restore', async () => {
    const h = makeHarness();
    await h.service.start();
    const res = await h.service.reonlineToCurrentSession('__orchestrator__', 'orchestrator');
    expect(res.success).toBe(false);
    expect(res.error).toBe('no-binding');
  });
});

describe('orchestrator channel/@mention override', () => {
  const ORCH_CHANNEL =
    'https://teams.microsoft.com/l/channel/19%3Aorchhub%40thread.tacv2/Orchestrator?groupId=team-9&tenantId=tenant-9';

  it('creates the orchestrator thread in the override channel, not the default', async () => {
    const h = makeHarness();
    await h.service.start();
    // The registerOrchestrator handler forwards settings.orchestrator* as the office* ctx.
    const res = await h.service.register({
      officeId: '__orchestrator__',
      agentId: 'orchestrator',
      displayName: 'Office Orchestrator',
      workingDir: '.',
      officeChannelUrl: ORCH_CHANNEL,
      officeMentionType: 'tag',
      officeMentionValue: 'oncall',
    });
    expect(res.success).toBe(true);
    const call = (h.service as unknown as { bindings: Array<{ agentId: string; channelId: string; mentionType?: string; mentionValue?: string }> }).bindings.find(
      (b) => b.agentId === 'orchestrator',
    );
    expect(call?.channelId).toBe('19:orchhub@thread.tacv2');
    expect(call?.mentionType).toBe('tag');
    expect(call?.mentionValue).toBe('oncall');
  });

  it('falls back to the default channel when the override is empty', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({
      officeId: '__orchestrator__',
      agentId: 'orchestrator',
      displayName: 'Office Orchestrator',
      workingDir: '.',
      officeChannelUrl: '',
    });
    const call = (h.service as unknown as { bindings: Array<{ agentId: string; channelId: string }> }).bindings.find(
      (b) => b.agentId === 'orchestrator',
    );
    expect(call?.channelId).toBe('19:abc@thread.tacv2');
  });
});
