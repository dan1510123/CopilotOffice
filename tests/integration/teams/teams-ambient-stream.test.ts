import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway, AgentEvent } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { InboundMessage, TeamsSettings } from '../../../electron/teams/types';

const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl:
    'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
  ackEnabled: false,
  checkInEnabled: false,
  checkInThresholdMs: 120000,
  checkInThrottleMs: 60000,
};

function makeHarness(opts: { notify?: boolean } = {}) {
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

  // Distinct-identity relay/Dump-channel sender used for the end-of-response completion ping.
  const notifierPosts: string[] = [];
  const notifier: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: '', webUrl: '' })),
    replyToThread: vi.fn(async (p) => {
      notifierPosts.push(p.html);
      return { messageId: `notify-${notifierPosts.length}` };
    }),
  };
  let notifyActive = opts.notify ?? false;

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
  const forwarding: { agentId: string; enabled: boolean }[] = [];
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async (_o, _a, prompt) => {
      submitted.push(prompt);
    },
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
    isNotifyActive: () => notifyActive,
    source,
    gateway,
    getSettings: () => settings,
    emitStatus: () => {},
    emitToast: () => {},
    turnSettleMs: 5,
  });

  return {
    service,
    graph,
    replies,
    notifierPosts,
    setNotifyActive: (v: boolean) => {
      notifyActive = v;
    },
    submitted,
    forwarding,
    inbound: () => emit,
    agent: () => agentCb,
  };
}

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));

describe('teams ambient (locally-driven) streaming', () => {
  it('enables forwarding for the whole online lifetime, disables on offline', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    expect(h.forwarding).toContainEqual({ agentId: 'generalist', enabled: true });

    await h.service.goOffline('office-0', 'generalist', false);
    expect(h.forwarding).toContainEqual({ agentId: 'generalist', enabled: false });
  });

  it('streams a locally-driven turn (no Teams inbound) into the thread', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    // No inbound Teams message → no pending dispatch. Drive the agent locally.
    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'refactor the parser' });
    h.agent()({ agentId: 'generalist', kind: 'turn-start' });
    h.agent()({ agentId: 'generalist', kind: 'message', content: 'Done refactoring.' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await tick(40);

    const joined = h.replies.join('\n');
    expect(joined).toContain('refactor the parser'); // local request mirrored
    expect(joined).toContain('local request');
    expect(joined).toContain('👤 <b>Human</b>'); // local request attributed to Human, not the agent
    expect(joined).toContain('🤖 <b>Gene</b>'); // the agent's reply is attributed to the agent
    expect(joined).toContain('Done refactoring.'); // reply streamed
    // The agent never received a Teams-originated prompt.
    expect(h.submitted).toHaveLength(0);
  });

  it('fires the Dump-channel completion notification once a local turn goes idle', async () => {
    const h = makeHarness({ notify: true });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'refactor the parser' });
    h.agent()({ agentId: 'generalist', kind: 'turn-start' });
    h.agent()({ agentId: 'generalist', kind: 'message', content: 'Done refactoring.' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await tick(40);

    // Exactly one completion ping via the distinct-identity notifier (relay/Dump channel).
    expect(h.notifierPosts).toHaveLength(1);
    expect(h.notifierPosts[0]).toContain('has finished responding');
    expect(h.notifierPosts[0]).toContain('🤖 <b>Gene</b>');
  });

  it('does not notify when a local turn produced no assistant text', async () => {
    const h = makeHarness({ notify: true });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    // A local user-message + turn-end with no `message` event → nothing was said.
    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'noop please' });
    h.agent()({ agentId: 'generalist', kind: 'turn-start' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await tick(40);

    expect(h.notifierPosts).toHaveLength(0);
  });

  it('does not notify when the completion notification is inactive', async () => {
    const h = makeHarness({ notify: false });
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'do a thing' });
    h.agent()({ agentId: 'generalist', kind: 'turn-start' });
    h.agent()({ agentId: 'generalist', kind: 'message', content: 'Thing done.' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await tick(40);

    // Reply still streamed under the operator identity, but no distinct-identity ping.
    expect(h.replies.join('\n')).toContain('Thing done.');
    expect(h.notifierPosts).toHaveLength(0);
  });

  it('does not echo the Teams prompt back as a local request (user-message during dispatch)', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.inbound()({
      messageId: 'm-1',
      channelId: '19:abc@thread.tacv2',
      threadRootId: 'root-1',
      senderName: 'Alice',
      content: 'what is 2+2',
      composeTime: new Date().toISOString(),
      hasMarker: false,
    });
    await tick();

    // The CLI accepts our prompt → user-message fires while a dispatch is pending.
    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'what is 2+2' });
    h.agent()({ agentId: 'generalist', kind: 'message', content: '4' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await tick(40);

    const joined = h.replies.join('\n');
    expect(joined).toContain('4');
    // The prompt must NOT be re-posted as a "local request".
    expect(joined).not.toContain('local request');
  });

  it('skips an empty local request but still streams the reply', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.agent()({ agentId: 'generalist', kind: 'user-message', content: '   ' });
    h.agent()({ agentId: 'generalist', kind: 'message', content: 'Reply without a request line.' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await tick(40);

    const joined = h.replies.join('\n');
    expect(joined).not.toContain('local request');
    expect(joined).toContain('Reply without a request line.');
  });

  it('does not stream local turns once the agent is offline', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    await h.service.goOffline('office-0', 'generalist', false);
    const before = h.replies.length;

    h.agent()({ agentId: 'generalist', kind: 'user-message', content: 'still there?' });
    h.agent()({ agentId: 'generalist', kind: 'message', content: 'ghost reply' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await tick(40);

    expect(h.replies.length).toBe(before);
  });

  it('disables forwarding for online bindings when the service stops (settings disable path)', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    h.forwarding.length = 0; // ignore the enable from register

    await h.service.stop();
    expect(h.forwarding).toContainEqual({ agentId: 'generalist', enabled: false });
  });

  it('does not start a queued dispatch (or re-enable forwarding) during stop', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    // In-flight dispatch + a second queued behind it.
    for (const c of ['first', 'second']) {
      h.inbound()({
        messageId: `m-${c}`,
        channelId: '19:abc@thread.tacv2',
        threadRootId: 'root-1',
        senderName: 'Alice',
        content: c,
        composeTime: new Date().toISOString(),
        hasMarker: false,
      });
    }
    await tick();
    expect(h.submitted).toEqual(['first']); // only the in-flight one submitted so far
    h.forwarding.length = 0;

    await h.service.stop();
    await tick(40);

    // The queued 'second' prompt must NOT be submitted after stop, and forwarding
    // must not be re-enabled (only the disable from stop is allowed).
    expect(h.submitted).toEqual(['first']);
    expect(h.forwarding.every((f) => f.enabled === false)).toBe(true);
  });
});
