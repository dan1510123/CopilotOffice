import { describe, expect, it, vi } from 'vitest';
import { createResilientGraphSender } from '../../../electron/teams/graphResilience';
import { GraphError, parseRetryAfterMs } from '../../../electron/teams/graphClient';
import type { GraphSender, ReplyParams } from '../../../electron/teams/graphClient';

/** A GraphSender stub whose replyToThread resolves after a caller-controlled tick,
 *  tracking peak concurrency so we can assert per-thread serialization. */
function makeTrackingSender() {
  let inFlightByThread = new Map<string, number>();
  let peakByThread = new Map<string, number>();
  const order: string[] = [];
  const sender: GraphSender = {
    createThread: vi.fn(async () => ({ threadRootId: 'root', webUrl: '' })),
    replyToThread: vi.fn(async (p: ReplyParams) => {
      const cur = (inFlightByThread.get(p.threadRootId) ?? 0) + 1;
      inFlightByThread.set(p.threadRootId, cur);
      peakByThread.set(p.threadRootId, Math.max(peakByThread.get(p.threadRootId) ?? 0, cur));
      order.push(p.html);
      await new Promise((r) => setTimeout(r, 5));
      inFlightByThread.set(p.threadRootId, (inFlightByThread.get(p.threadRootId) ?? 1) - 1);
      return { messageId: p.html };
    }),
  };
  return { sender, peakByThread, order };
}

function reply(threadRootId: string, html: string): ReplyParams {
  return { teamId: 't', channelId: 'c', threadRootId, html } as ReplyParams;
}

const noSleep = { sleep: async () => {}, jitter: () => 0 };

describe('createResilientGraphSender — per-thread serialization', () => {
  it('never runs two replies to the same thread concurrently', async () => {
    const { sender, peakByThread } = makeTrackingSender();
    const g = createResilientGraphSender(sender, noSleep);

    await Promise.all([
      g.replyToThread(reply('T1', 'a')),
      g.replyToThread(reply('T1', 'b')),
      g.replyToThread(reply('T1', 'c')),
    ]);

    expect(peakByThread.get('T1')).toBe(1);
  });

  it('preserves submission order within a thread', async () => {
    const { sender, order } = makeTrackingSender();
    const g = createResilientGraphSender(sender, noSleep);

    await Promise.all([
      g.replyToThread(reply('T1', 'first')),
      g.replyToThread(reply('T1', 'second')),
      g.replyToThread(reply('T1', 'third')),
    ]);

    expect(order).toEqual(['first', 'second', 'third']);
  });

  it('allows different threads to run in parallel', async () => {
    const { sender, peakByThread } = makeTrackingSender();
    const g = createResilientGraphSender(sender, noSleep);

    await Promise.all([
      g.replyToThread(reply('A', '1')),
      g.replyToThread(reply('B', '2')),
    ]);

    // Each thread saw at most one in-flight; they were independent.
    expect(peakByThread.get('A')).toBe(1);
    expect(peakByThread.get('B')).toBe(1);
  });

  it('a failing post does not block the next post to the same thread', async () => {
    const calls: string[] = [];
    const sender: GraphSender = {
      createThread: vi.fn(async () => ({ threadRootId: 'root', webUrl: '' })),
      replyToThread: vi.fn(async (p: ReplyParams) => {
        calls.push(p.html);
        if (p.html === 'boom') throw new Error('nope'); // non-retryable
        return { messageId: p.html };
      }),
    };
    const g = createResilientGraphSender(sender, noSleep);

    const results = await Promise.allSettled([
      g.replyToThread(reply('T1', 'boom')),
      g.replyToThread(reply('T1', 'ok')),
    ]);

    expect(results[0].status).toBe('rejected');
    expect(results[1].status).toBe('fulfilled');
    expect(calls).toEqual(['boom', 'ok']);
  });
});

describe('createResilientGraphSender — retry on throttling', () => {
  it('retries a 429 and eventually succeeds', async () => {
    let attempts = 0;
    const sender: GraphSender = {
      createThread: vi.fn(async () => ({ threadRootId: 'root', webUrl: '' })),
      replyToThread: vi.fn(async () => {
        attempts++;
        if (attempts < 3) throw new GraphError('Graph replyToThread failed: 429 busy', 429);
        return { messageId: 'ok' };
      }),
    };
    const g = createResilientGraphSender(sender, { ...noSleep, maxRetries: 4 });

    const res = await g.replyToThread(reply('T1', 'x'));
    expect(res.messageId).toBe('ok');
    expect(attempts).toBe(3);
  });

  it('honors Retry-After for the backoff delay', async () => {
    const sleeps: number[] = [];
    let attempts = 0;
    const sender: GraphSender = {
      createThread: vi.fn(async () => ({ threadRootId: 'root', webUrl: '' })),
      replyToThread: vi.fn(async () => {
        attempts++;
        if (attempts < 2) throw new GraphError('429', 429, 3000);
        return { messageId: 'ok' };
      }),
    };
    const g = createResilientGraphSender(sender, {
      sleep: async (ms) => { sleeps.push(ms); },
      jitter: () => 0,
      baseDelayMs: 500,
    });

    await g.replyToThread(reply('T1', 'x'));
    // First backoff should use the server-advised 3000ms (> exponential 500ms).
    expect(sleeps[0]).toBe(3000);
  });

  it('does NOT retry a non-retryable status (e.g. 403)', async () => {
    let attempts = 0;
    const sender: GraphSender = {
      createThread: vi.fn(async () => ({ threadRootId: 'root', webUrl: '' })),
      replyToThread: vi.fn(async () => {
        attempts++;
        throw new GraphError('Graph replyToThread failed: 403 forbidden', 403);
      }),
    };
    const g = createResilientGraphSender(sender, noSleep);

    await expect(g.replyToThread(reply('T1', 'x'))).rejects.toThrow(/403/);
    expect(attempts).toBe(1);
  });

  it('gives up after maxRetries and rethrows the last GraphError', async () => {
    let attempts = 0;
    const sender: GraphSender = {
      createThread: vi.fn(async () => ({ threadRootId: 'root', webUrl: '' })),
      replyToThread: vi.fn(async () => {
        attempts++;
        throw new GraphError('Graph replyToThread failed: 429 busy', 429);
      }),
    };
    const g = createResilientGraphSender(sender, { ...noSleep, maxRetries: 2 });

    await expect(g.replyToThread(reply('T1', 'x'))).rejects.toThrow(/429/);
    expect(attempts).toBe(3); // initial + 2 retries
  });
});

describe('parseRetryAfterMs', () => {
  it('parses delta-seconds into ms', () => {
    expect(parseRetryAfterMs('5')).toBe(5000);
    expect(parseRetryAfterMs('0')).toBe(0);
  });

  it('parses an HTTP-date relative to now', () => {
    const now = () => Date.parse('2026-01-01T00:00:00Z');
    expect(parseRetryAfterMs('Thu, 01 Jan 2026 00:00:10 GMT', now)).toBe(10000);
  });

  it('returns undefined for absent/unparseable values', () => {
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs(undefined)).toBeUndefined();
    expect(parseRetryAfterMs('not-a-date')).toBeUndefined();
  });
});
