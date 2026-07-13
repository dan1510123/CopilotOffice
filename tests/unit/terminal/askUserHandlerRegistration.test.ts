import { describe, expect, it, vi } from 'vitest';
import {
  ControlPlaneClient,
  CopilotSdkBackend,
  makeUserInputHandler,
  handlePendingUserInput,
  clearPendingUserInputForSession,
  pendingUserInputCount,
} from '../../../electron/terminal/terminal-backend';

// spec 015 (events-ipc §0) — the user-input handler is the spike-verified prerequisite:
// both managed-session factories MUST register `onUserInputRequest` (so the runtime
// advertises ask_user and the model can call it), and handlePendingUserInput must
// resolve the stored late promise idempotently.

type Captured = Record<string, unknown>;

describe('managed sessions register onUserInputRequest (requestUserInput prerequisite)', () => {
  it('ControlPlaneClient.createOrResumeSession registers the handler', async () => {
    let captured: Captured | undefined;
    const fakeSession = { send: vi.fn(), disconnect: vi.fn() };
    const underlying = {
      resumeSession: vi.fn((_id: string, config: Captured) => {
        captured = config;
        return Promise.resolve(fakeSession);
      }),
      createSession: vi.fn(() => Promise.resolve(fakeSession)),
      setForegroundSessionId: vi.fn(() => Promise.resolve()),
      listSessions: vi.fn(() => Promise.resolve([])),
      stop: vi.fn(() => Promise.resolve()),
    };
    const cpc = new ControlPlaneClient({ status: 'ready' } as never);
    (cpc as unknown as { client: unknown }).client = underlying;
    (cpc as unknown as { startPromise: Promise<void> }).startPromise = Promise.resolve();

    await cpc.createOrResumeSession('s1', '/cwd');
    expect(typeof captured?.onUserInputRequest).toBe('function');
  });

  it('CopilotSdkBackend.resumeOrCreateSession (forStdio) registers the handler', async () => {
    let captured: Captured | undefined;
    const fakeSession = { send: vi.fn(), disconnect: vi.fn() };
    const fakeClient = {
      resumeSession: vi.fn((_id: string, config: Captured) => {
        captured = config;
        return Promise.resolve(fakeSession);
      }),
      createSession: vi.fn(() => Promise.resolve(fakeSession)),
    };
    const backend = new CopilotSdkBackend(
      vi.fn() as never,
      { forStdio: () => ({}) } as never,
      undefined,
      'copilot',
      [],
    );
    const session = await (backend as unknown as {
      resumeOrCreateSession(client: unknown, options: unknown): Promise<unknown>;
    }).resumeOrCreateSession(fakeClient, { sessionId: 's2', cwd: '/cwd' });

    expect(session).toBe(fakeSession);
    expect(typeof captured?.onUserInputRequest).toBe('function');
  });
});

describe('handlePendingUserInput — late resolution + idempotence (session-scoped)', () => {
  it('resolves the stored late promise with the answer', async () => {
    const handler = makeUserInputHandler('sess-A');
    const before = pendingUserInputCount();
    const answerP = handler({ requestId: 'r-1', toolCallId: 't-1' });

    const ok = handlePendingUserInput('sess-A', { answer: 'MySQL', wasFreeform: false });
    expect(ok).toBe(true);
    await expect(answerP).resolves.toEqual({ answer: 'MySQL', wasFreeform: false });
    // the pending entry is removed after resolution.
    expect(pendingUserInputCount()).toBe(before);
  });

  it('is an idempotent no-op for an already-resolved session', async () => {
    const handler = makeUserInputHandler('sess-B');
    const answerP = handler({ requestId: 'r-2' });
    expect(handlePendingUserInput('sess-B', { answer: 'A', wasFreeform: false })).toBe(true);
    // second resolve of the same session does nothing.
    expect(handlePendingUserInput('sess-B', { answer: 'B', wasFreeform: true })).toBe(false);
    await expect(answerP).resolves.toEqual({ answer: 'A', wasFreeform: false });
  });

  it('is a no-op for an unknown session', () => {
    expect(handlePendingUserInput('sess-Z', { answer: 'x', wasFreeform: false })).toBe(false);
  });

  it('resolves purely by sessionId — the callback carries no requestId (spike 2026-07-13)', async () => {
    // The onUserInputRequest callback provides only { question, choices, allowFreeform }.
    // Even with NO requestId on the request, the resolver must be found by sessionId.
    const handler = makeUserInputHandler('sess-noreq');
    const answerP = handler({} as never); // no requestId, no toolCallId
    expect(handlePendingUserInput('sess-noreq', { answer: 'blue', wasFreeform: true })).toBe(true);
    await expect(answerP).resolves.toEqual({ answer: 'blue', wasFreeform: true });
  });

  it('scopes by session — two live sessions do not collide (h3)', async () => {
    const hA = makeUserInputHandler('sess-1');
    const hB = makeUserInputHandler('sess-2');
    const pA = hA({ requestId: 'dup' });
    const pB = hB({ requestId: 'dup' });

    expect(handlePendingUserInput('sess-1', { answer: 'one', wasFreeform: false })).toBe(true);
    await expect(pA).resolves.toEqual({ answer: 'one', wasFreeform: false });

    expect(handlePendingUserInput('sess-2', { answer: 'two', wasFreeform: false })).toBe(true);
    await expect(pB).resolves.toEqual({ answer: 'two', wasFreeform: false });
  });

  it('clearPendingUserInputForSession drops only that session\'s pending interaction (h3 GC)', () => {
    const before = pendingUserInputCount();
    const hA = makeUserInputHandler('gc-A');
    const hB = makeUserInputHandler('gc-B');
    void hA({ requestId: 'a1' });
    void hB({ requestId: 'b1' });
    expect(pendingUserInputCount()).toBe(before + 2);

    const dropped = clearPendingUserInputForSession('gc-A');
    expect(dropped).toBe(1);
    expect(pendingUserInputCount()).toBe(before + 1);
    // gc-B is untouched and still resolvable.
    expect(handlePendingUserInput('gc-B', { answer: 'x', wasFreeform: false })).toBe(true);
    // gc-A can no longer be resolved.
    expect(handlePendingUserInput('gc-A', { answer: 'x', wasFreeform: false })).toBe(false);
  });
});
