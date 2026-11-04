import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneClient } from '../../../electron/terminal/terminal-backend';

/**
 * Live YOLO auto-approve under the ui-server backend.
 *
 * The permission handler bound at session-create time must evaluate the
 * `isYoloEnabled` getter PER REQUEST — so toggling YOLO in the app takes effect
 * on an already-running ui-server session without recreating it:
 *   - getter true  → approve (`approve-once`)
 *   - getter false → `user-not-available` (CLI 1.0.98 rejects 'approved'/'no-result')
 */

type CapturedHandler = (request: unknown, invocation: unknown) => Promise<{ kind: string }>;

function makeClient() {
  // Fake underlying SDK client: resumeSession captures the onPermissionRequest
  // handler from the session config and returns a fake session.
  let captured: CapturedHandler | undefined;
  const setMode = vi.fn(async ({ mode }: { mode: 'manual' | 'allow-all' }) => ({ success: true, mode }));
  const fakeSession = {
    send: vi.fn(), disconnect: vi.fn(),
    rpc: { permissions: { setMode } },
  };
  const underlying = {
    resumeSession: vi.fn((_sessionId: string, config: Record<string, unknown>) => {
      captured = config.onPermissionRequest as CapturedHandler;
      return Promise.resolve(fakeSession);
    }),
    createSession: vi.fn(() => Promise.resolve(fakeSession)),
    getSessionMetadata: vi.fn(async (_sessionId: string): Promise<{ sessionId: string } | undefined> => ({ sessionId: _sessionId })),
    setForegroundSessionId: vi.fn(() => Promise.resolve()),
    listSessions: vi.fn(() => Promise.resolve([])),
    stop: vi.fn(() => Promise.resolve()),
  };

  const cpc = new ControlPlaneClient({ status: 'ready' } as never);
  // Bypass the real SDK load: inject the fake client and a resolved start.
  (cpc as unknown as { client: unknown }).client = underlying;
  (cpc as unknown as { startPromise: Promise<void> }).startPromise = Promise.resolve();

  return { cpc, underlying, fakeSession, setMode, getHandler: () => captured! };
}

const req = { kind: 'shell' };
const inv = { toolName: 'shell' };

describe('ControlPlaneClient live YOLO permission handler', () => {
  it.each([true, false])('sets the actual resumed session mode (YOLO=%s)', async (enabled) => {
    const { cpc, setMode } = makeClient();
    await cpc.createOrResumeSession('s1', '/cwd', () => enabled);
    expect(setMode).toHaveBeenCalledWith({ mode: enabled ? 'allow-all' : 'manual', source: 'rpc' });
  });

  it('sets mode on fresh sessions and passes --agent into session creation', async () => {
    const { cpc, underlying, setMode } = makeClient();
    underlying.getSessionMetadata.mockResolvedValue(undefined);
    await cpc.createOrResumeSession('new-session', '/cwd', () => true, ['--model', 'auto', '--agent', 'anvil']);
    expect(underlying.createSession).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: 'new-session', agent: 'anvil', model: 'auto',
    }));
    expect(setMode).toHaveBeenCalledWith({ mode: 'allow-all', source: 'rpc' });
    expect(underlying.resumeSession).not.toHaveBeenCalled();
  });

  it.each(['transport disconnected', 'authentication failed', 'invalid session configuration', 'session not found'])(
    'does not create a session when resume fails: %s',
    async (message) => {
      const { cpc, underlying, setMode } = makeClient();
      const error = new Error(message);
      underlying.resumeSession.mockRejectedValue(error);
      await expect(cpc.createOrResumeSession('s1', '/cwd')).rejects.toBe(error);
      expect(underlying.getSessionMetadata).toHaveBeenCalledExactlyOnceWith('s1');
      expect(underlying.createSession).not.toHaveBeenCalled();
      expect(setMode).not.toHaveBeenCalled();
    },
  );

  it('does not resume or create when metadata lookup fails', async () => {
    const { cpc, underlying } = makeClient();
    const error = new Error('metadata transport disconnected');
    underlying.getSessionMetadata.mockRejectedValue(error);
    await expect(cpc.createOrResumeSession('s1', '/cwd')).rejects.toBe(error);
    expect(underlying.resumeSession).not.toHaveBeenCalled();
    expect(underlying.createSession).not.toHaveBeenCalled();
  });

  it('never creates after a resume failure when metadata lookup is unavailable', async () => {
    const { cpc, underlying } = makeClient();
    Reflect.deleteProperty(underlying, 'getSessionMetadata');
    const error = new Error('session not found');
    underlying.resumeSession.mockRejectedValue(error);
    await expect(cpc.createOrResumeSession('s1', '/cwd')).rejects.toBe(error);
    expect(underlying.createSession).not.toHaveBeenCalled();
  });

  it('passes --agent=name into resumed sessions too', async () => {
    const { cpc, underlying } = makeClient();
    await cpc.createOrResumeSession('s1', '/cwd', () => true, ['--agent=anvil']);
    expect(underlying.resumeSession).toHaveBeenCalledWith('s1', expect.objectContaining({ agent: 'anvil' }));
  });

  it('maps model and reasoning effort on resume without forwarding unknown config keys', async () => {
    const { cpc, underlying } = makeClient();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await cpc.createOrResumeSession('s1', '/cwd', () => true, [
        '--model=auto', '--reasoning-effort', 'high', '--no-auto-update',
      ]);
      const config = underlying.resumeSession.mock.calls[0][1];
      expect(config).toMatchObject({ model: 'auto', reasoningEffort: 'high' });
      expect(config).not.toHaveProperty('noAutoUpdate');
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('--no-auto-update'));
    } finally {
      warn.mockRestore();
    }
  });

  it('updates all connected sessions when the setting changes, excluding disconnected ones', async () => {
    let enabled = false;
    const { cpc, setMode } = makeClient();
    await cpc.createOrResumeSession('s1', '/one', () => enabled);
    await cpc.createOrResumeSession('s2', '/two', () => enabled);
    setMode.mockClear();
    enabled = true;
    await cpc.synchronizePermissions();
    expect(setMode).toHaveBeenCalledTimes(2);
    expect(setMode).toHaveBeenNthCalledWith(1, { mode: 'allow-all', source: 'rpc' });
    expect(setMode).toHaveBeenNthCalledWith(2, { mode: 'allow-all', source: 'rpc' });
    cpc.forgetSession('s1');
    setMode.mockClear();
    enabled = false;
    await cpc.synchronizePermissions();
    expect(setMode).toHaveBeenCalledExactlyOnceWith({ mode: 'manual', source: 'rpc' });
  });

  it('rejects startup when the runtime refuses allow-all, without silently creating another session', async () => {
    const { cpc, setMode, underlying, fakeSession } = makeClient();
    setMode.mockResolvedValue({ success: false, mode: 'manual' });
    await expect(cpc.createOrResumeSession('s1', '/cwd', () => true)).rejects.toThrow('Failed to synchronize');
    expect(underlying.createSession).not.toHaveBeenCalled();
    expect(fakeSession.disconnect).toHaveBeenCalledOnce();
  });

  it('surfaces a failed live update and allows retry', async () => {
    let enabled = false;
    const { cpc, setMode } = makeClient();
    await cpc.createOrResumeSession('s1', '/cwd', () => enabled);
    enabled = true;
    setMode.mockRejectedValueOnce(new Error('policy rejected'));
    await expect(cpc.synchronizePermissions()).rejects.toThrow('policy rejected');
    await expect(cpc.synchronizePermissions()).resolves.toBeUndefined();
  });

  it('still updates other sessions when one fails', async () => {
    let enabled = false;
    const { cpc, setMode } = makeClient();
    await cpc.createOrResumeSession('s1', '/one', () => enabled);
    await cpc.createOrResumeSession('s2', '/two', () => enabled);
    setMode.mockClear();
    setMode.mockRejectedValueOnce(new Error('session lost'));
    enabled = true;
    await expect(cpc.synchronizePermissions()).rejects.toThrow('session lost');
    expect(setMode).toHaveBeenCalledTimes(2);
  });

  it('approves once when the getter is true', async () => {
    const { cpc, getHandler } = makeClient();
    await cpc.createOrResumeSession('s1', '/cwd', () => true);
    expect(await getHandler()(req, inv)).toEqual({ kind: 'approve-once' });
  });

  it('is user-not-available when the getter is false', async () => {
    const { cpc, getHandler } = makeClient();
    await cpc.createOrResumeSession('s1', '/cwd', () => false);
    expect(await getHandler()(req, inv)).toEqual({ kind: 'user-not-available' });
  });

  it('reflects a live toggle without recreating the session', async () => {
    let yolo = false;
    const { cpc, getHandler } = makeClient();
    await cpc.createOrResumeSession('s1', '/cwd', () => yolo);
    const handler = getHandler();

    expect(await handler(req, inv)).toEqual({ kind: 'user-not-available' });
    yolo = true;
    expect(await handler(req, inv)).toEqual({ kind: 'approve-once' });
    yolo = false;
    expect(await handler(req, inv)).toEqual({ kind: 'user-not-available' });
  });

  it('never returns the legacy approved kind', async () => {
    const { cpc, getHandler } = makeClient();
    await cpc.createOrResumeSession('s1', '/cwd', () => true);
    expect((await getHandler()(req, inv)).kind).not.toBe('approved');
  });
});