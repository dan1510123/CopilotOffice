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
  const fakeSession = { send: vi.fn(), disconnect: vi.fn() };
  const underlying = {
    resumeSession: vi.fn((_sessionId: string, config: Record<string, unknown>) => {
      captured = config.onPermissionRequest as CapturedHandler;
      return Promise.resolve(fakeSession);
    }),
    createSession: vi.fn(() => Promise.resolve(fakeSession)),
    setForegroundSessionId: vi.fn(() => Promise.resolve()),
    listSessions: vi.fn(() => Promise.resolve([])),
    stop: vi.fn(() => Promise.resolve()),
  };

  const cpc = new ControlPlaneClient({ status: 'ready' } as never);
  // Bypass the real SDK load: inject the fake client and a resolved start.
  (cpc as unknown as { client: unknown }).client = underlying;
  (cpc as unknown as { startPromise: Promise<void> }).startPromise = Promise.resolve();

  return { cpc, getHandler: () => captured! };
}

const req = { kind: 'shell' };
const inv = { toolName: 'shell' };

describe('ControlPlaneClient live YOLO permission handler', () => {
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