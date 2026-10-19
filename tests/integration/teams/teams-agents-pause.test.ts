import { describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { MessageSource } from '../../../electron/teams/chatsvcClient';
import type { SessionGateway } from '../../../electron/teams/sessionGateway';
import type { TokenProvider } from '../../../electron/teams/auth';
import type { TeamsSettings } from '../../../electron/teams/types';
import {
  ORCHESTRATOR_OFFICE_ID,
  ORCHESTRATOR_AGENT_ID,
} from '../../../electron/orchestrator/orchestratorIdentity';

/**
 * Pause/resume non-orchestrator agent Teams connections (the top-bar
 * "Connection Active/Paused" pill + the orchestrator's own
 * set_teams_agents_connection tool share this exact backend mechanism).
 * Core invariant under test: the orchestrator's own Teams binding is NEVER
 * affected, in either direction — distinct from TeamsSettings.enabled (the
 * full feature kill switch, which DOES affect the orchestrator via
 * TeamsService.start()/stop(), unchanged by this feature and not exercised
 * here).
 */

function makeSettings(overrides: Partial<TeamsSettings> = {}): TeamsSettings {
  return {
    enabled: true,
    defaultChannelUrl:
      'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent%20Hub?groupId=team-1&tenantId=tenant-1',
    ackEnabled: false,
    checkInEnabled: false,
    checkInThresholdMs: 120000,
    checkInThrottleMs: 60000,
    ...overrides,
  } as TeamsSettings;
}

function makeHarness(settingsOverrides: Partial<TeamsSettings> = {}, sharedStore?: InMemoryTeamsOnlineStore) {
  const settings = makeSettings(settingsOverrides);
  const store = sharedStore ?? new InMemoryTeamsOnlineStore();
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
  let emit: (m: import('../../../electron/teams/types').InboundMessage) => void = () => {};
  const source: MessageSource = {
    health: 'connected',
    start: async (cb) => { emit = cb; },
    stop: async () => {},
  };
  const forwardingCalls: Array<{ officeId: string; agentId: string; enabled: boolean }> = [];
  let agentEventCb: (e: import('../../../electron/teams/sessionGateway').AgentEvent) => void = () => {};
  const gateway: SessionGateway = {
    getSessionId: async () => 'session-1',
    getSessionMeta: async () => ({ title: '' }),
    isAgentReady: async () => true,
    submitPrompt: async () => {},
    setForwarding: (officeId, agentId, enabled) => {
      forwardingCalls.push({ officeId, agentId, enabled });
    },
    onAgentEvent: (cb) => { agentEventCb = cb; return () => {}; },
    onSessionExit: () => () => {},
  };
  const service = new TeamsService({
    store, tokens, graph, source, gateway,
    getSettings: () => settings,
    emitStatus: () => {},
    emitToast: () => {},
    turnSettleMs: 5,
  });
  return { service, graph, replies, forwardingCalls, store, inbound: () => emit, agentEvent: (e: import('../../../electron/teams/sessionGateway').AgentEvent) => agentEventCb(e) };
}

describe('teams agents pause/resume (orchestrator separation)', () => {
  it('pauses online non-orchestrator bindings, leaving the orchestrator untouched', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    await h.service.register({ officeId: ORCHESTRATOR_OFFICE_ID, agentId: ORCHESTRATOR_AGENT_ID, displayName: 'Office Orchestrator', workingDir: '.' });

    expect(h.service.getStatus('office-0', 'generalist')?.online).toBe(true);
    expect(h.service.getStatus(ORCHESTRATOR_OFFICE_ID, ORCHESTRATOR_AGENT_ID)?.online).toBe(true);
    h.forwardingCalls.length = 0;

    const result = await h.service.pauseAgentConnections();

    expect(result.outcome).toBe('paused');
    expect(result.count).toBe(1);
    expect(h.service.isAgentsPaused()).toBe(true);
    // The regular agent is now offline (forwarding disabled, online false)...
    expect(h.service.getStatus('office-0', 'generalist')?.online).toBe(false);
    expect(h.forwardingCalls).toContainEqual({ officeId: 'office-0', agentId: 'generalist', enabled: false });
    // ...but the orchestrator's binding is completely untouched.
    expect(h.service.getStatus(ORCHESTRATOR_OFFICE_ID, ORCHESTRATOR_AGENT_ID)?.online).toBe(true);
    expect(h.forwardingCalls.some((c) => c.officeId === ORCHESTRATOR_OFFICE_ID)).toBe(false);
  });

  it('a paused binding does NOT get silently reconnected by a periodic reconcile tick', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    await h.service.pauseAgentConnections();
    h.replies.length = 0;

    await h.service.reconcileNow();

    // Still offline — reconcile must skip a deliberately paused binding.
    expect(h.service.getStatus('office-0', 'generalist')?.online).toBe(false);
    expect(h.replies.some((r) => /reconnected/i.test(r.html))).toBe(false);
  });

  it('resumeAgentConnections reconnects paused agents into their EXISTING thread (posts Reconnected)', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    const threadCountBeforePause = (h.service.getStatuses().length);
    await h.service.pauseAgentConnections();
    h.replies.length = 0;

    const result = await h.service.resumeAgentConnections();

    expect(result.outcome).toBe('resumed');
    expect(result.count).toBe(1);
    expect(h.service.isAgentsPaused()).toBe(false);
    expect(h.service.getStatus('office-0', 'generalist')?.online).toBe(true);
    expect(h.replies.some((r) => /reconnected/i.test(r.html))).toBe(true);
    // No new thread/binding was created — same binding count as before pause.
    expect(h.service.getStatuses().length).toBe(threadCountBeforePause);
  });

  it('pausing/resuming with nothing online reports already-paused/already-active and never touches the orchestrator', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: ORCHESTRATOR_OFFICE_ID, agentId: ORCHESTRATOR_AGENT_ID, displayName: 'Office Orchestrator', workingDir: '.' });

    const pauseResult = await h.service.pauseAgentConnections();
    expect(pauseResult.outcome).toBe('already-paused');
    expect(pauseResult.count).toBe(0);
    expect(h.service.getStatus(ORCHESTRATOR_OFFICE_ID, ORCHESTRATOR_AGENT_ID)?.online).toBe(true);

    const resumeResult = await h.service.resumeAgentConnections();
    expect(resumeResult.outcome).toBe('already-active');
    expect(resumeResult.count).toBe(0);
  });

  it('reports unavailable when Teams is disabled in settings', async () => {
    const h = makeHarness({ enabled: false });
    await h.service.start();

    const pauseResult = await h.service.pauseAgentConnections();
    expect(pauseResult.outcome).toBe('unavailable');
    const resumeResult = await h.service.resumeAgentConnections();
    expect(resumeResult.outcome).toBe('unavailable');
  });

  it('register() creates a paused thread while the orchestrator can still register online', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    await h.service.pauseAgentConnections();

    h.forwardingCalls.length = 0;
    const connected = await h.service.register({ officeId: 'office-0', agentId: 'debugger', displayName: 'Dan', workingDir: '.' });
    expect(connected.success).toBe(true);
    expect(h.graph.createThread).toHaveBeenCalledTimes(2);
    expect(h.service.getStatus('office-0', 'debugger')?.online).toBe(false);
    expect(h.forwardingCalls).toContainEqual({ officeId: 'office-0', agentId: 'debugger', enabled: false });
    expect(h.forwardingCalls.some((c) => c.enabled)).toBe(false);
    await h.service.reconcileNow();
    expect(h.service.getStatus('office-0', 'debugger')?.online).toBe(false);

    const orchResult = await h.service.register({ officeId: ORCHESTRATOR_OFFICE_ID, agentId: ORCHESTRATOR_AGENT_ID, displayName: 'Office Orchestrator', workingDir: '.' });
    expect(orchResult.success).toBe(true);
    expect(h.service.getStatus(ORCHESTRATOR_OFFICE_ID, ORCHESTRATOR_AGENT_ID)?.online).toBe(true);
    await h.service.resumeAgentConnections();
    expect(h.service.getStatus('office-0', 'debugger')?.online).toBe(true);
    expect(h.graph.createThread).toHaveBeenCalledTimes(3);
  });

  it('register() reuses an already-paused binding without orphaning its thread', async () => {
    const h = makeHarness();
    await h.service.start();
    const first = await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    const firstThread = h.service.getStatus('office-0', 'generalist')?.threadWebUrl;
    await h.service.pauseAgentConnections();

    const reRegister = await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    expect(reRegister.success).toBe(true);
    expect(h.graph.createThread).toHaveBeenCalledTimes(1);
    // No second thread was created, and the original paused binding/thread survives intact.
    expect(h.service.getStatus('office-0', 'generalist')?.threadWebUrl).toBe(firstThread);
    expect(first.threadWebUrl).toBe(firstThread);
  });

  it('pausing tags an offline binding too (e.g. right after a restart, before reconcile reconnects it) — not just online ones', async () => {
    const store = new InMemoryTeamsOnlineStore();
    const h1 = makeHarness({}, store);
    await h1.service.start();
    await h1.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });

    // Simulate a restart: the binding reloads as `online: false` (start()'s
    // existing behavior) and has NOT yet been reconciled back online.
    const h2 = makeHarness({}, store);
    await h2.service.start();
    expect(h2.service.getStatus('office-0', 'generalist')?.online).toBe(false);

    // Pause fires in this window, before reconcile() has run — must still tag
    // the (currently offline) binding so it doesn't bypass the pause.
    await h2.service.pauseAgentConnections();
    const registered = await h2.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    expect(registered.success).toBe(true);
    expect(h2.graph.createThread).not.toHaveBeenCalled();
    expect(h2.service.getStatus('office-0', 'generalist')?.online).toBe(false);
  });

  it('disconnecting while paused posts the offline notice and prevents resume from restoring the binding', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.pauseAgentConnections();
    const ctx = { officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' };
    await h.service.register(ctx);
    await h.service.goOffline(ctx.officeId, ctx.agentId);
    expect(h.replies.some((r) => r.threadRootId === 'root-1' && /gone offline/.test(r.html))).toBe(true);
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)).toBeNull();
    await h.service.resumeAgentConnections();
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)).toBeNull();
    await h.service.pauseAgentConnections();
    await h.service.register(ctx);
    expect(h.graph.createThread).toHaveBeenCalledTimes(2);
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)?.online).toBe(false);
  });

  it('a paused thread\'s inbound reply is silently ignored, never posts a "no longer active" orphaned notice', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    await h.service.pauseAgentConnections();
    h.replies.length = 0;

    h.inbound()({
      messageId: 'm-1',
      channelId: '19:abc@thread.tacv2',
      threadRootId: 'root-1',
      senderName: 'Alice',
      content: 'are you there?',
      composeTime: new Date().toISOString(),
      hasMarker: false,
    });
    await new Promise((r) => setTimeout(r, 20));

    expect(h.replies.some((r) => /no longer active/i.test(r.html))).toBe(false);
    expect(h.replies.length).toBe(0);
  });

  it('pausing mid-turn discards the in-flight dispatch instead of posting a late reply after the pause', async () => {
    const h = makeHarness();
    await h.service.start();
    await h.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    h.replies.length = 0;

    // Inbound Teams message → enqueued → dispatched → creates an in-flight
    // PendingTurn (the DispatchQueue drains asynchronously).
    h.inbound()({
      messageId: 'm-1',
      channelId: '19:abc@thread.tacv2',
      threadRootId: 'root-1',
      senderName: 'Alice',
      content: 'do a thing',
      composeTime: new Date().toISOString(),
      hasMarker: false,
    });
    await new Promise((r) => setTimeout(r, 20));

    // Agent produced partial output (mid-turn) — buffered, not yet flushed.
    h.agentEvent({ agentId: 'generalist', kind: 'message', content: 'partial reply in progress' });

    // Pause lands WHILE this turn is still in flight.
    await h.service.pauseAgentConnections();

    // Turn-end arrives after the pause — must NOT post the buffered chunk.
    h.agentEvent({ agentId: 'generalist', kind: 'turn-end' });
    await new Promise((r) => setTimeout(r, 20));

    expect(h.replies.some((r) => /partial reply in progress/.test(r.html))).toBe(false);
  });

  it('agentsPaused is correctly restored after a simulated app restart (new TeamsService, same persisted store)', async () => {
    const store = new InMemoryTeamsOnlineStore();
    const h1 = makeHarness({}, store);
    await h1.service.start();
    await h1.service.register({ officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' });
    await h1.service.pauseAgentConnections();
    expect(h1.service.isAgentsPaused()).toBe(true);

    // Simulate an app restart: brand-new TeamsService instance, same backing store.
    const h2 = makeHarness({}, store);
    await h2.service.start();

    expect(h2.service.isAgentsPaused()).toBe(true);
    // New threads are allowed, but inherit the restored streaming pause.
    const connected = await h2.service.register({ officeId: 'office-0', agentId: 'debugger', displayName: 'Dan', workingDir: '.' });
    expect(connected.success).toBe(true);
    expect(h2.service.getStatus('office-0', 'debugger')?.online).toBe(false);

    const resumed = await h2.service.resumeAgentConnections();
    expect(resumed.outcome).toBe('resumed');
    expect(h2.service.isAgentsPaused()).toBe(false);
  });
});
