import { describe, expect, it, vi } from 'vitest';
import { TeamsService, type TeamsToast } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { TeamsSettings } from '../../../electron/teams/types';

const CHANNEL_URL =
  'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1';
const DUMP_URL =
  'https://teams.microsoft.com/l/channel/19%3Adump%40thread.tacv2/Dump?groupId=team-1&tenantId=tenant-1';

const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl: CHANNEL_URL,
  relayChannelUrl: '',
  relayMentionType: 'none',
  relayMentionValue: '',
  notifyOnCompleteEnabled: false,
  ackEnabled: false,
  checkInEnabled: false,
  checkInThresholdMs: 120000,
  checkInThrottleMs: 60000,
};

function makeHarness(opts?: {
  getChannel?: GraphSender['getChannel'];
  settings?: TeamsSettings;
  now?: () => number;
}) {
  const store = new InMemoryTeamsOnlineStore();
  const tokens: TokenProvider = { getToken: async () => 'fake' };
  const graph: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: 'root-1', webUrl: 'https://web' })),
    replyToThread: vi.fn(async () => ({ messageId: 'r1' })),
    getChannel: opts?.getChannel ?? vi.fn(async (_t: string, c: string) => ({ id: c, displayName: 'Chan' })),
  };
  const srcHealth = { value: 'connected' as 'connected' | 'disconnected' | 'error' };
  const source: MessageSource = {
    get health() {
      return srcHealth.value;
    },
    start: async () => {},
    stop: async () => {},
  } as MessageSource;
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async () => {},
    setForwarding: () => {},
    onAgentEvent: () => () => {},
    onSessionExit: () => () => {},
  };
  const toasts: TeamsToast[] = [];
  const service = new TeamsService({
    store,
    tokens,
    graph,
    source,
    gateway,
    getSettings: () => opts?.settings ?? settings,
    emitStatus: () => {},
    emitToast: (t) => toasts.push(t),
    now: opts?.now,
    turnSettleMs: 5,
  });
  return { service, toasts, srcHealth, graph };
}

async function bringOnline(service: TeamsService) {
  await service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
}

describe('teams credential health — onTokenOutcome', () => {
  it('stays silent on a hard failure when no agent is bound', () => {
    const h = makeHarness();
    h.service.onTokenOutcome('fail', 'ic3', false);
    expect(h.toasts).toHaveLength(0);
  });

  it('emits a 60s az-login error toast on a hard failure when an agent is bound', async () => {
    const h = makeHarness();
    await h.service.start();
    await bringOnline(h.service);
    h.toasts.length = 0;
    h.service.onTokenOutcome('fail', 'ic3', false);
    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0].level).toBe('error');
    expect(h.toasts[0].message).toMatch(/az login/i);
    expect(h.toasts[0].durationMs).toBe(60_000);
  });

  it('does not re-toast a still-broken credential before the 5-min repeat window', async () => {
    let t = 1_000_000;
    const h = makeHarness({ now: () => t });
    await h.service.start();
    await bringOnline(h.service);
    h.toasts.length = 0;
    h.service.onTokenOutcome('fail', 'ic3', false); // first
    t += 60_000; // +1 min
    h.service.onTokenOutcome('fail', 'ic3', false); // still broken, too soon
    expect(h.toasts).toHaveLength(1);
  });

  it('re-toasts once the 5-min repeat window has elapsed', async () => {
    let t = 1_000_000;
    const h = makeHarness({ now: () => t });
    await h.service.start();
    await bringOnline(h.service);
    h.toasts.length = 0;
    h.service.onTokenOutcome('fail', 'ic3', false);
    t += 5 * 60 * 1000 + 1;
    h.service.onTokenOutcome('fail', 'ic3', false);
    expect(h.toasts).toHaveLength(2);
  });

  it('ignores a soft failure (cached-token reuse)', async () => {
    const h = makeHarness();
    await h.service.start();
    await bringOnline(h.service);
    h.toasts.length = 0;
    h.service.onTokenOutcome('fail', 'ic3', true);
    expect(h.toasts).toHaveLength(0);
  });

  it('uses a generic connectivity message for a non-login hard failure', async () => {
    const h = makeHarness();
    await h.service.start();
    await bringOnline(h.service);
    h.toasts.length = 0;
    h.service.onTokenOutcome('fail', 'ic3', false, new Error('ECONNRESET socket hang up'));
    expect(h.toasts).toHaveLength(1);
    expect(h.toasts[0].level).toBe('error');
    expect(h.toasts[0].message).not.toMatch(/az login/i);
    expect(h.toasts[0].message).toMatch(/network/i);
  });

  it('emits a recovery info toast on acquire after a break', async () => {
    const h = makeHarness();
    await h.service.start();
    await bringOnline(h.service);
    h.toasts.length = 0;
    h.service.onTokenOutcome('fail', 'ic3', false); // break
    h.service.onTokenOutcome('acquire', 'ic3', false); // recover
    expect(h.toasts.some((t) => t.level === 'info' && /restored|reconnect/i.test(t.message))).toBe(true);
  });

  it('does not emit a recovery toast when nothing was broken', async () => {
    const h = makeHarness();
    await h.service.start();
    await bringOnline(h.service);
    h.toasts.length = 0;
    h.service.onTokenOutcome('acquire', 'ic3', false);
    expect(h.toasts).toHaveLength(0);
  });

  it('does not emit a recovery toast if the break happened while unbound (no warning was shown)', async () => {
    const h = makeHarness();
    await h.service.start(); // no agent bound yet
    h.toasts.length = 0;
    h.service.onTokenOutcome('fail', 'ic3', false); // sets authBroken, no toast (unbound)
    expect(h.toasts).toHaveLength(0);
    await bringOnline(h.service);
    h.toasts.length = 0;
    h.service.onTokenOutcome('acquire', 'ic3', false); // recover — but user never saw a warning
    expect(h.toasts.filter((t) => /restored|reconnect/i.test(t.message))).toHaveLength(0);
  });
});

describe('teams credential health — transport reconnect notice', () => {
  it('emits "reconnected" once when the transport recovers (bound agent)', async () => {
    const h = makeHarness();
    await h.service.start(); // first reconcile: prev=unknown → no toast
    await bringOnline(h.service);
    h.toasts.length = 0;
    h.srcHealth.value = 'error';
    await h.service.reconcileNow(); // connected → error: no toast
    h.srcHealth.value = 'connected';
    await h.service.reconcileNow(); // error → connected: reconnected toast
    const notices = h.toasts.filter((t) => /reconnected/i.test(t.message));
    expect(notices).toHaveLength(1);
    // A second stable-connected pass does not repeat it.
    await h.service.reconcileNow();
    expect(h.toasts.filter((t) => /reconnected/i.test(t.message))).toHaveLength(1);
  });
});

describe('teams credential health — verifyAccess', () => {
  it('emits an info toast when all configured channels are reachable', async () => {
    const cfg = { ...settings, relayChannelUrl: DUMP_URL };
    const h = makeHarness({ settings: cfg });
    await h.service.verifyAccess(cfg);
    const info = h.toasts.find((t) => t.level === 'info');
    expect(info?.message).toMatch(/verified access/i);
    expect(info?.message).toMatch(/default/);
    expect(info?.message).toMatch(/Dump/);
  });

  it('emits a warn toast naming an inaccessible channel (403)', async () => {
    const cfg = { ...settings, relayChannelUrl: DUMP_URL };
    const getChannel = vi.fn(async (_t: string, c: string) => {
      if (c.includes('dump')) throw new Error('Graph getChannel failed: 403 Forbidden');
      return { id: c, displayName: 'Chan' };
    });
    const h = makeHarness({ settings: cfg, getChannel });
    await h.service.verifyAccess(cfg);
    const warn = h.toasts.find((t) => t.level === 'warn');
    expect(warn?.message).toMatch(/Dump/);
    expect(warn?.message).not.toMatch(/verified access/i);
    // A partial success must NOT also emit an all-clear.
    expect(h.toasts.some((t) => /verified access/i.test(t.message))).toBe(false);
  });

  it('emits a credential error toast (not a membership warning) on 401', async () => {
    const getChannel = vi.fn(async () => {
      throw new Error('Graph getChannel failed: 401 Unauthorized');
    });
    const h = makeHarness({ getChannel });
    await h.service.verifyAccess(settings);
    const err = h.toasts.find((t) => t.level === 'error');
    expect(err?.message).toMatch(/az login/i);
    expect(h.toasts.some((t) => t.level === 'warn')).toBe(false);
  });

  it('does not claim success when one target fails with an unclassified (token) error', async () => {
    const cfg = { ...settings, relayChannelUrl: DUMP_URL };
    const getChannel = vi.fn(async (_t: string, c: string) => {
      if (c.includes('dump')) throw new Error('az token acquisition failed for https://graph.microsoft.com');
      return { id: c, displayName: 'Chan' };
    });
    const h = makeHarness({ settings: cfg, getChannel });
    await h.service.verifyAccess(cfg);
    // default succeeded, Dump failed with a token error → NO "verified access" toast.
    expect(h.toasts.some((t) => /verified access/i.test(t.message))).toBe(false);
  });

  it('does nothing when no channels are configured', async () => {
    const cfg = { ...settings, defaultChannelUrl: '', relayChannelUrl: '' };
    const h = makeHarness({ settings: cfg });
    await h.service.verifyAccess(cfg);
    expect(h.toasts).toHaveLength(0);
  });

  it('stays quiet on a token acquisition failure (observer owns that message)', async () => {
    const getChannel = vi.fn(async () => {
      throw new Error('az token acquisition failed for https://graph.microsoft.com');
    });
    const h = makeHarness({ getChannel });
    await h.service.verifyAccess(settings);
    // No 401/403/404 and not a "getChannel failed" → classified as a token error, no toast.
    expect(h.toasts.filter((t) => t.level === 'warn')).toHaveLength(0);
  });
});
