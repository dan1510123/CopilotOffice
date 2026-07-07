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
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: 'Fixing scroll' }),
    isAgentReady: async () => true,
    submitPrompt: async (_o, _a, prompt) => {
      submitted.push(prompt);
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

  return { service, graph, replies, submitted, inbound: () => emit, agent: () => agentCb };
}

describe('teams online round-trip (US1)', () => {
  it('register → thread → bound message → dispatch → reply', async () => {
    const h = makeHarness();
    await h.service.start();

    const reg = await h.service.register({
      officeId: 'office-0',
      agentId: 'generalist',
      displayName: 'Gene',
      workingDir: 'C:/repo',
    });
    expect(reg.success).toBe(true);
    expect(reg.handle).toBe('gene');
    expect(h.graph.createThread).toHaveBeenCalledOnce();

    // A human replies in the bound thread.
    h.inbound()({
      messageId: 'm-1',
      channelId: '19:abc@thread.tacv2',
      threadRootId: 'root-1',
      senderName: 'Alice',
      content: 'what is 2+2',
      composeTime: new Date().toISOString(),
      hasMarker: false,
    });

    // Allow the queue to submit the prompt.
    await new Promise((r) => setTimeout(r, 20));
    expect(h.submitted).toEqual(['what is 2+2']);

    // Agent responds, then the turn ends.
    h.agent()({ agentId: 'generalist', kind: 'message', content: '4' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });

    await new Promise((r) => setTimeout(r, 20));
    expect(h.replies.some((r) => r.includes('4'))).toBe(true);
  });

  it('does not drop post-tool turns — multi-turn reply is forwarded whole (office-image regression)', async () => {
    // Regression: a tool-using response is split into two copilot turns
    // (message → tool → turn_end, then turn_start → message → turn_end). Finalizing
    // on the first turn-end posted only the pre-tool text and dropped the real answer
    // (e.g. one carrying an office-image sentinel). Every turn's text must be posted.
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: 'C:/repo' });

    h.inbound()({
      messageId: 'm-multi',
      channelId: '19:abc@thread.tacv2',
      threadRootId: 'root-1',
      senderName: 'Alice',
      content: 'render something',
      composeTime: new Date().toISOString(),
      hasMarker: false,
    });
    await new Promise((r) => setTimeout(r, 20));

    // Turn 1: preamble text, a tool call, then the turn ends.
    h.agent()({ agentId: 'generalist', kind: 'turn-start' });
    h.agent()({ agentId: 'generalist', kind: 'message', content: 'Working on it…' });
    h.agent()({ agentId: 'generalist', kind: 'tool-start', toolName: 'shell' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    // Turn 2: the real answer arrives AFTER the tool (previously dropped).
    h.agent()({ agentId: 'generalist', kind: 'turn-start' });
    h.agent()({ agentId: 'generalist', kind: 'message', content: 'Here is the final answer.' });
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });

    // Exceed the (test) settle window so the dispatch closes out.
    await new Promise((r) => setTimeout(r, 40));

    const joined = h.replies.join('\n');
    expect(joined).toContain('Working on it');
    expect(joined).toContain('Here is the final answer');
  });

  it('continues the same session across follow-ups (US2)', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    const send = (content: string) =>
      h.inbound()({
        messageId: `m-${content}`,
        channelId: '19:abc@thread.tacv2',
        threadRootId: 'root-1',
        senderName: 'Alice',
        content,
        composeTime: new Date().toISOString(),
        hasMarker: false,
      });

    send('remember 42');
    await new Promise((r) => setTimeout(r, 10));
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await new Promise((r) => setTimeout(r, 10));

    send('what number?');
    await new Promise((r) => setTimeout(r, 10));
    h.agent()({ agentId: 'generalist', kind: 'turn-end' });
    await new Promise((r) => setTimeout(r, 10));

    // Same session reused — createThread called only once (no re-thread).
    expect(h.graph.createThread).toHaveBeenCalledOnce();
    expect(h.submitted).toEqual(['remember 42', 'what number?']);
  });

  it('ignores app self-posts (marker) — no dispatch loop', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.inbound()({
      messageId: 'm-echo',
      channelId: '19:abc@thread.tacv2',
      threadRootId: 'root-1',
      senderName: 'Me',
      content: 'copilotoffice-agent-post-v1 offline notice',
      composeTime: new Date().toISOString(),
      hasMarker: true,
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.submitted).toHaveLength(0);
  });

  it('ignores the intro-post echo by message id even when the marker was stripped', async () => {
    // Regression: Teams strips HTML comments, so the old marker vanished and the
    // app's own intro post got dispatched. The message-id guard (D9) must drop it
    // even with hasMarker=false. The intro's message id === the thread root id.
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.inbound()({
      messageId: 'root-1', // echo of our own createThread post
      channelId: '19:abc@thread.tacv2',
      threadRootId: 'root-1',
      senderName: 'Me (app identity)',
      content: 'Gene is now online via Copilot Office. Reply in this thread…',
      composeTime: new Date().toISOString(),
      hasMarker: false, // marker was stripped by Teams
    });
    await new Promise((r) => setTimeout(r, 20));
    expect(h.submitted).toHaveLength(0);
  });

  it('/stop takes the agent offline (session untouched)', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    h.inbound()({
      messageId: 'm-stop',
      channelId: '19:abc@thread.tacv2',
      threadRootId: 'root-1',
      senderName: 'Alice',
      content: '/stop',
      composeTime: new Date().toISOString(),
      hasMarker: false,
    });
    await new Promise((r) => setTimeout(r, 20));
    const status = h.service.getStatus('office-0', 'generalist');
    expect(status).toBeNull(); // binding removed
    expect(h.submitted).toHaveLength(0);
  });

  it('assigns a suffixed handle on collision (US3)', async () => {
    const h = makeHarness();
    await h.service.start();
    const a = await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    const b = await h.service.register({ officeId: 'office-1', agentId: 'debugger', displayName: 'Gene', workingDir: '.' });
    expect(a.handle).toBe('gene');
    expect(b.handle).toBe('gene-1');
  });
});
