import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamsService } from '../../../electron/teams/teamsService';
import { InMemoryTeamsOnlineStore } from '../../../electron/teams/onlineAgentsStore';
import type { SessionGateway } from '../../../electron/teams/sessionGateway';
import type { GraphSender } from '../../../electron/teams/graphClient';
import type { TeamsSettings } from '../../../electron/teams/types';

const ctx = { officeId: 'office-0', agentId: 'generalist', displayName: 'Gene', workingDir: '.' };
const settings: TeamsSettings = {
  enabled: true,
  defaultChannelUrl: 'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Agent?groupId=team-1&tenantId=tenant-1',
  ackEnabled: false, checkInEnabled: false, checkInThresholdMs: 120000, checkInThrottleMs: 60000,
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => { resolve = done; });
  return { promise, resolve };
}

const services: TeamsService[] = [];
afterEach(async () => {
  await Promise.all(services.splice(0).map((service) => service.stop()));
  vi.restoreAllMocks();
});

function harness(store = new InMemoryTeamsOnlineStore()) {
  const graph: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: 'root-1', webUrl: 'https://web/thread' })),
    replyToThread: vi.fn(async () => ({ messageId: 'reply-1' })),
  };
  const gateway: SessionGateway = {
    ensureSessionOnline: vi.fn(async () => ({ success: true, sessionId: 'session-1' })),
    getSessionId: vi.fn(async () => 'session-1'),
    getSessionMeta: vi.fn(async () => ({ title: '' })),
    isAgentReady: vi.fn(async () => true),
    submitPrompt: vi.fn(async () => {}),
    setForwarding: vi.fn(() => {}),
    onAgentEvent: () => () => {},
    onSessionExit: () => () => {},
  };
  const service = new TeamsService({
    store, graph, gateway,
    tokens: { getToken: async () => 'fake' },
    source: { health: 'connected', start: async () => {}, stop: async () => {} },
    getSettings: () => settings,
    emitStatus: vi.fn(), emitToast: vi.fn(),
  });
  services.push(service);
  return { service, store, graph, gateway };
}

function pendingCreate(graph: GraphSender) {
  const created = deferred<{ threadRootId: string; webUrl: string }>();
  const entered = deferred<void>();
  vi.mocked(graph.createThread).mockImplementationOnce(() => {
    entered.resolve();
    return created.promise;
  });
  return { entered: entered.promise, complete: () => created.resolve({ threadRootId: 'root-1', webUrl: 'https://web/thread' }) };
}

describe('Teams registration concurrency and retained threads', () => {
  it('preserves a healthy existing Teams connection when re-registration persistence fails', async () => {
    const h = harness();
    await h.service.start();
    await h.service.register(ctx);
    vi.spyOn(h.store, 'save').mockRejectedValueOnce(new Error('Disk temporarily unavailable'));
    expect(await h.service.register({ ...ctx, readySessionId: 'session-1' }))
      .toMatchObject({ success: false, error: expect.stringContaining('preserved') });
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)?.online).toBe(true);
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, false);
    expect(await h.service.register({ ...ctx, readySessionId: 'session-1' }))
      .toMatchObject({ success: true, state: 'online' });
    expect(h.graph.createThread).toHaveBeenCalledTimes(1);
  });

  it('does not deactivate an existing online binding when re-registration expires during persistence', async () => {
    const h = harness();
    await h.service.start();
    await h.service.register(ctx);
    const persisted = deferred<void>();
    const entered = deferred<void>();
    vi.spyOn(h.store, 'save').mockImplementationOnce(async () => {
      entered.resolve();
      await persisted.promise;
    });
    const deadline = Date.now() + 10_000;
    const pending = h.service.register({ ...ctx, readySessionId: 'session-1', deadline });
    await entered.promise;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline + 1);
    persisted.resolve();
    expect(await pending).toMatchObject({ success: false, error: expect.stringContaining('preserved') });
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)?.online).toBe(true);
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, false);
    clock.mockRestore();
  });

  it('never enables a thread created after the lifecycle deadline and reuses it on explicit retry', async () => {
    const h = harness();
    await h.service.start();
    const create = pendingCreate(h.graph);
    const deadline = Date.now() + 10_000;
    const pending = h.service.register({ ...ctx, readySessionId: 'session-1', deadline });
    await create.entered;
    const clock = vi.spyOn(Date, 'now').mockReturnValue(deadline + 1);
    create.complete();
    expect(await pending).toMatchObject({ success: false, threadWebUrl: 'https://web/thread' });
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)?.online).not.toBe(true);
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, true);
    clock.mockRestore();
    expect(await h.service.register({ ...ctx, readySessionId: 'session-1', deadline: Date.now() + 10_000 }))
      .toMatchObject({ success: true, state: 'online', threadWebUrl: 'https://web/thread' });
    expect(h.graph.createThread).toHaveBeenCalledTimes(1);
  });

  it('accepts an explicitly verified ready session without ensuring it a second time', async () => {
    const h = harness();
    await h.service.start();
    expect(await h.service.register({ ...ctx, readySessionId: 'session-1' }))
      .toMatchObject({ success: true, state: 'online' });
    expect(h.gateway.getSessionId).toHaveBeenCalledWith(ctx.officeId, ctx.agentId);
    expect(h.gateway.isAgentReady).toHaveBeenCalledWith(ctx.officeId, ctx.agentId);
    expect(h.gateway.ensureSessionOnline).not.toHaveBeenCalled();
  });

  it.each(['mismatched', 'not-ready'] as const)('rejects a %s ready token without spawning or creating a thread', async (reason) => {
    const h = harness();
    await h.service.start();
    if (reason === 'not-ready') vi.mocked(h.gateway.isAgentReady).mockResolvedValue(false);
    expect(await h.service.register({ ...ctx, readySessionId: reason === 'mismatched' ? 'old-session' : 'session-1' }))
      .toMatchObject({ success: false, error: expect.stringMatching(/stale/) });
    expect(h.gateway.ensureSessionOnline).not.toHaveBeenCalled();
    expect(h.graph.createThread).not.toHaveBeenCalled();
  });

  it('single-flights identical registrations throughout a pending Graph create', async () => {
    const h = harness();
    await h.service.start();
    const create = pendingCreate(h.graph);
    const first = h.service.register(ctx);
    await create.entered;
    const second = h.service.register({ ...ctx });
    expect(second).toBe(first);
    const conflicting = await h.service.register({ ...ctx, displayName: 'Different' });
    expect(conflicting).toMatchObject({ success: false, error: expect.stringMatching(/in progress/) });
    create.complete();
    expect(await first).toMatchObject({ success: true, state: 'online' });
    expect(await second).toEqual(await first);
    expect(h.graph.createThread).toHaveBeenCalledTimes(1);
    expect(h.gateway.ensureSessionOnline).toHaveBeenCalledTimes(1);
  });

  it('offline cancels a pending create, keeps its thread, and retries never duplicate it', async () => {
    const h = harness();
    await h.service.start();
    const create = pendingCreate(h.graph);
    const first = h.service.register(ctx);
    await create.entered;
    await h.service.goOffline(ctx.officeId, ctx.agentId);
    const retryWhilePending = h.service.register(ctx);
    expect(retryWhilePending).toBe(first);
    create.complete();
    expect(await first).toMatchObject({ success: false, threadWebUrl: 'https://web/thread', error: expect.stringMatching(/cancelled/) });
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)).toBeNull();
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, true);
    expect((await h.store.load()).knownThreads).toEqual([
      expect.objectContaining({ threadRootId: 'root-1', noticePosted: false }),
    ]);
    expect(await h.service.register(ctx)).toMatchObject({ success: true, state: 'online', threadWebUrl: 'https://web/thread' });
    expect(h.graph.createThread).toHaveBeenCalledTimes(1);
  });

  it.each(['pause', 'stop'] as const)('%s cancels a pending create without late enabling forwarding', async (intent) => {
    const h = harness();
    await h.service.start();
    const create = pendingCreate(h.graph);
    const registration = h.service.register(ctx);
    await create.entered;
    if (intent === 'pause') await h.service.pauseAgentConnections();
    else await h.service.stop();
    create.complete();
    expect(await registration).toMatchObject({ success: false, error: expect.stringMatching(/cancelled/) });
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, true);
    if (intent === 'pause') {
      expect(await h.service.register(ctx)).toMatchObject({ success: true, state: 'paused' });
      expect(h.service.getStatus(ctx.officeId, ctx.agentId)?.online).toBe(false);
      expect(h.graph.createThread).toHaveBeenCalledTimes(1);
    }
  });

  it('a pause followed by resume cannot revive the older pending registration intent', async () => {
    const h = harness();
    await h.service.start();
    const create = pendingCreate(h.graph);
    const registration = h.service.register(ctx);
    await create.entered;
    await h.service.pauseAgentConnections();
    await h.service.resumeAgentConnections();
    create.complete();
    expect(await registration).toMatchObject({ success: false, error: expect.stringMatching(/cancelled/) });
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, true);
  });

  it('remembers a cancelled externally-created thread across a restart', async () => {
    const h = harness();
    await h.service.start();
    const create = pendingCreate(h.graph);
    const registration = h.service.register(ctx);
    await create.entered;
    await h.service.goOffline(ctx.officeId, ctx.agentId);
    create.complete();
    expect(await registration).toMatchObject({ success: false });
    await h.service.stop();
    const restored = harness(h.store);
    await restored.service.start();
    expect(restored.service.getStatus(ctx.officeId, ctx.agentId)).toBeNull();
    expect(await restored.service.register(ctx)).toMatchObject({ success: true, state: 'online', threadWebUrl: 'https://web/thread' });
    expect(restored.graph.createThread).not.toHaveBeenCalled();
    await restored.service.stop();
    const completed = harness(h.store);
    await completed.service.start();
    await completed.service.reconcileNow();
    expect(completed.service.getStatus(ctx.officeId, ctx.agentId)?.online).toBe(true);
  });

  it('offline cancels the ensured-ready await before any external thread is created', async () => {
    const h = harness();
    await h.service.start();
    const ensured = deferred<{ success: boolean }>();
    const entered = deferred<void>();
    vi.mocked(h.gateway.ensureSessionOnline!).mockImplementationOnce(() => {
      entered.resolve();
      return ensured.promise;
    });
    const registration = h.service.register(ctx);
    await entered.promise;
    await h.service.goOffline(ctx.officeId, ctx.agentId);
    ensured.resolve({ success: true });
    expect(await registration).toMatchObject({ success: false, error: expect.stringMatching(/cancelled/) });
    expect(h.graph.createThread).not.toHaveBeenCalled();
  });

  it('reuses a persisted offline binding, adopting the ensured live session', async () => {
    const h = harness();
    await h.service.start();
    await h.service.register(ctx);
    const persisted = await h.store.load();
    persisted.bindings[0].online = false;
    persisted.bindings[0].sessionId = 'previous-session';
    await h.store.save(persisted);
    await h.service.stop();
    const restored = harness(h.store);
    await restored.service.start();
    expect(await restored.service.register(ctx)).toMatchObject({ success: true, state: 'online', threadWebUrl: 'https://web/thread' });
    expect(restored.gateway.ensureSessionOnline).toHaveBeenCalledTimes(1);
    expect(restored.graph.createThread).not.toHaveBeenCalled();
    expect((await h.store.load()).bindings[0].sessionId).toBe('session-1');
  });

  it('reports paused state for both new and already-paused registrations', async () => {
    const h = harness();
    await h.service.start();
    await h.service.pauseAgentConnections();
    expect(await h.service.register(ctx)).toMatchObject({ success: true, state: 'paused' });
    expect(await h.service.register(ctx)).toMatchObject({ success: true, state: 'paused' });
    expect(h.graph.createThread).toHaveBeenCalledTimes(1);
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, true);
  });

  it('surfaces persistence failure with the created thread and safely reuses it on retry', async () => {
    const h = harness();
    await h.service.start();
    const save = vi.spyOn(h.store, 'save').mockRejectedValueOnce(new Error('disk full'));
    const failed = await h.service.register(ctx);
    expect(failed).toMatchObject({ success: false, threadWebUrl: 'https://web/thread', error: expect.stringMatching(/persistence failed: disk full/) });
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, true);
    await h.service.reconcileNow();
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)?.online).toBe(false);
    expect(await h.service.register(ctx)).toMatchObject({ success: true, state: 'online' });
    expect(h.graph.createThread).toHaveBeenCalledTimes(1);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('offline during persistence cannot enable the just-created binding after the save returns', async () => {
    const h = harness();
    await h.service.start();
    const saving = deferred<void>();
    const entered = deferred<void>();
    vi.spyOn(h.store, 'save').mockImplementationOnce(() => {
      entered.resolve();
      return saving.promise;
    });
    const registration = h.service.register(ctx);
    await entered.promise;
    await h.service.goOffline(ctx.officeId, ctx.agentId, false);
    saving.resolve();
    expect(await registration).toMatchObject({ success: false, error: expect.stringMatching(/cancelled/) });
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)).toBeNull();
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, true);
  });

  it('pause during persistence leaves a paused binding that only an explicit resume reconnects', async () => {
    const h = harness();
    await h.service.start();
    const saving = deferred<void>();
    const entered = deferred<void>();
    vi.spyOn(h.store, 'save').mockImplementationOnce(() => {
      entered.resolve();
      return saving.promise;
    });
    const registration = h.service.register(ctx);
    await entered.promise;
    await h.service.pauseAgentConnections();
    saving.resolve();
    expect(await registration).toMatchObject({ success: false, error: expect.stringMatching(/cancelled/) });
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)?.online).toBe(false);
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, true);
    await h.service.resumeAgentConnections();
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)?.online).toBe(true);
    expect(h.graph.createThread).toHaveBeenCalledTimes(1);
  });

  it('pausing during an online binding registration disables its existing forwarding', async () => {
    const h = harness();
    await h.service.start();
    await h.service.register(ctx);
    vi.mocked(h.gateway.setForwarding).mockClear();
    const saving = deferred<void>();
    const entered = deferred<void>();
    vi.spyOn(h.store, 'save').mockImplementationOnce(() => {
      entered.resolve();
      return saving.promise;
    });
    const registration = h.service.register(ctx);
    await entered.promise;
    await h.service.pauseAgentConnections();
    saving.resolve();
    expect(await registration).toMatchObject({ success: false, error: expect.stringMatching(/cancelled/) });
    expect(h.gateway.setForwarding).toHaveBeenCalledWith(ctx.officeId, ctx.agentId, false);
    expect(h.gateway.setForwarding).not.toHaveBeenCalledWith(ctx.officeId, ctx.agentId, true);
    expect(h.service.getStatus(ctx.officeId, ctx.agentId)?.online).toBe(false);
  });
});
