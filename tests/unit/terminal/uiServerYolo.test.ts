import { describe, expect, it, vi } from 'vitest';
import { ControlPlaneClient } from '../../../electron/terminal/terminal-backend';

/**
 * Live YOLO auto-approve under the ui-server backend.
 *
 * The permission handler bound at session-create time must evaluate the
 * `isYoloEnabled` getter PER REQUEST — so toggling YOLO in the app takes effect
 * on an already-running ui-server session without recreating it:
 *   - getter true  → approve (SDK `approveAll`, or `{ kind: 'approved' }` fallback)
 *   - getter false → `{ kind: 'no-result' }` (defer to the hosted runtime)
 */

type CapturedHandler = (request: unknown, invocation: unknown) => Promise<{ kind: string }>;

function makeClient(approveAll?: unknown) {
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
  (cpc as unknown as { approveAll: unknown }).approveAll = approveAll;

  return { cpc, getHandler: () => captured! };
}

const req = { kind: 'shell' };
const inv = { toolName: 'shell' };

describe('ControlPlaneClient live YOLO permission handler', () => {
  it('approves when the getter is true (approveAll fallback)', async () => {
    const { cpc, getHandler } = makeClient(undefined);
    await cpc.createOrResumeSession('s1', '/cwd', () => true);
    const result = await getHandler()(req, inv);
    expect(result).toEqual({ kind: 'approved' });
  });

  it('defers with no-result when the getter is false', async () => {
    const { cpc, getHandler } = makeClient(undefined);
    await cpc.createOrResumeSession('s1', '/cwd', () => false);
    const result = await getHandler()(req, inv);
    expect(result).toEqual({ kind: 'no-result' });
  });

  it('delegates to the SDK approveAll export when present', async () => {
    const approveAll = vi.fn(() => Promise.resolve({ kind: 'approve-once' }));
    const { cpc, getHandler } = makeClient(approveAll);
    await cpc.createOrResumeSession('s1', '/cwd', () => true);
    const result = await getHandler()(req, inv);
    expect(approveAll).toHaveBeenCalledWith(req, inv);
    expect(result).toEqual({ kind: 'approve-once' });
  });

  it('reflects a live toggle without recreating the session', async () => {
    let yolo = false;
    const { cpc, getHandler } = makeClient(undefined);
    await cpc.createOrResumeSession('s1', '/cwd', () => yolo);
    const handler = getHandler();

    expect(await handler(req, inv)).toEqual({ kind: 'no-result' });
    yolo = true;
    expect(await handler(req, inv)).toEqual({ kind: 'approved' });
    yolo = false;
    expect(await handler(req, inv)).toEqual({ kind: 'no-result' });
  });

  it('defaults to no-result (YOLO off) when no getter is provided', async () => {
    const { cpc, getHandler } = makeClient(undefined);
    await cpc.createOrResumeSession('s1', '/cwd');
    const result = await getHandler()(req, inv);
    expect(result).toEqual({ kind: 'no-result' });
  });
});
