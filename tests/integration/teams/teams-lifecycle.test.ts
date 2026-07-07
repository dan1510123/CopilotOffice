import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway } from '../../../electron/teams/sessionGateway';
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

function makeHarness() {
  const store = new InMemoryTeamsOnlineStore();
  const tokens: TokenProvider = { getToken: async () => 'fake' };
  const replies: Array<{ threadRootId: string; html: string }> = [];
  let threadSeq = 0;
  const graph: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: `root-${++threadSeq}`, webUrl: 'https://web' })),
    replyToThread: vi.fn(async (p) => {
      replies.push({ threadRootId: p.threadRootId, html: p.html });
      return { messageId: `r${replies.length}` };
    }),
  };
  let emit: (m: InboundMessage) => void = () => {};
  const source: MessageSource = {
    health: 'connected',
    start: async (cb) => { emit = cb; },
    stop: async () => {},
  };
  let exitCb: (agentId: string) => void = () => {};
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async () => {},
    setForwarding: () => {},
    onAgentEvent: () => () => {},
    onSessionExit: (cb) => { exitCb = cb; return () => {}; },
  };
  const service = new TeamsService({
    store, tokens, graph, source, gateway,
    getSettings: () => settings,
    emitStatus: () => {},
    emitToast: () => {},
    turnSettleMs: 5,
  });
  return { service, replies, inbound: () => emit, exit: () => exitCb };
}

const bound = (content: string, threadRootId = 'root-1'): InboundMessage => ({
  messageId: `m-${Math.random()}`,
  channelId: '19:abc@thread.tacv2',
  threadRootId,
  senderName: 'Alice',
  content,
  composeTime: new Date().toISOString(),
  hasMarker: false,
});

describe('teams lifecycle', () => {
  it('takes the agent offline + posts a notice when the session exits (FR-022)', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    expect(h.service.getStatus('office-0', 'generalist')?.online).toBe(true);
    h.exit()('generalist');
    await new Promise((r) => setTimeout(r, 20));

    expect(h.service.getStatus('office-0', 'generalist')).toBeNull();
    expect(h.replies.some((r) => /offline/i.test(r.html))).toBe(true);
  });

  it('posts a one-time inactive notice for an orphaned thread, then dedupes (FR-026/027)', async () => {
    const h = makeHarness();
    await h.service.start();
    // Bring online (creates known thread root-1), then take offline → thread becomes orphaned.
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    await h.service.goOffline('office-0', 'generalist', false);

    // Bring a *different* agent online so the channel stays active.
    await h.service.register({ officeId: 'office-0', agentId: 'debugger', displayName: 'Dan', workingDir: '.' });

    const before = h.replies.length;
    h.inbound()(bound('are you there?', 'root-1'));
    await new Promise((r) => setTimeout(r, 20));
    h.inbound()(bound('hello again?', 'root-1'));
    await new Promise((r) => setTimeout(r, 20));

    const notices = h.replies.slice(before).filter((r) => r.threadRootId === 'root-1' && /no longer active/i.test(r.html));
    expect(notices).toHaveLength(1); // one-time only
  });

  it('ignores foreign threads silently (FR-028)', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    const before = h.replies.length;
    h.inbound()(bound('random', 'never-created-root'));
    await new Promise((r) => setTimeout(r, 20));
    expect(h.replies.length).toBe(before);
  });
});
