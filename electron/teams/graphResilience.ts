// Resilience decorator for a GraphSender that eliminates the Teams
// `429 ConcurrentRequestLimitExceeded-ETag mismatch for thread resource` errors.
//
// Microsoft Graph allows only ONE in-flight write per thread: two concurrent
// POSTs to the same thread's /replies race on the thread's ETag and the loser is
// rejected with a 429. The app posts to a single thread from several independent,
// fire-and-forget paths (per-turn flush, tool check-ins, receipt ack, completion),
// which can easily overlap when an agent emits turns/tools in quick succession.
//
// This wrapper fixes that with two layers:
//   1. Per-thread SERIALIZATION — replies to a given threadRootId are chained so
//      only one is ever in flight at a time (removes the concurrency race itself).
//   2. Retry with backoff on throttling/transient status (429/502/503/504),
//      honoring the server's `Retry-After` when provided (safety net for genuine
//      volume throttling, and for any concurrent writer outside this process).
//
// createThread is only retried (a fresh thread has no existing-ETag contention),
// while replyToThread is both serialized per thread AND retried.

import type { GraphSender, CreateThreadParams, ReplyParams } from './graphClient';
import { GraphError } from './graphClient';

export interface ResilientSenderOptions {
  /** Max retry attempts after the first try (default 4). */
  maxRetries?: number;
  /** Base backoff in ms for the exponential schedule (default 500). */
  baseDelayMs?: number;
  /** Upper bound for a single computed backoff in ms (default 8000). */
  maxDelayMs?: number;
  /** Injectable sleep (tests). */
  sleep?: (ms: number) => Promise<void>;
  /** Injectable jitter in ms (tests); default random 0–250ms. */
  jitter?: () => number;
  /** Optional warn sink for retry diagnostics. */
  warn?: (msg: string) => void;
}

/** HTTP statuses worth retrying: Graph throttling + transient gateway/service errors. */
const RETRYABLE = new Set([429, 502, 503, 504]);

const defaultSleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createResilientGraphSender(
  inner: GraphSender,
  opts: ResilientSenderOptions = {},
): GraphSender {
  const maxRetries = opts.maxRetries ?? 4;
  const baseDelayMs = opts.baseDelayMs ?? 500;
  const maxDelayMs = opts.maxDelayMs ?? 8000;
  const sleep = opts.sleep ?? defaultSleep;
  const jitter = opts.jitter ?? (() => Math.floor(Math.random() * 250));
  const warn = opts.warn ?? (() => {});

  // Per-thread promise tail: each reply for a threadRootId is chained onto the prior
  // one so at most one write to that thread is in flight. Errors don't break the chain.
  const tails = new Map<string, Promise<unknown>>();

  function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const prev = tails.get(key) ?? Promise.resolve();
    // Run after the previous settles (success OR failure), so one failed post never
    // blocks the next queued post to the same thread.
    const run = prev.catch(() => {}).then(fn);
    const tail = run.catch(() => {});
    tails.set(key, tail);
    // Drop the entry once this is the last queued op for the thread, so the map does
    // not grow unbounded across many short-lived threads.
    void tail.then(() => {
      if (tails.get(key) === tail) tails.delete(key);
    });
    return run;
  }

  async function withRetry<T>(label: string, fn: () => Promise<T>): Promise<T> {
    let attempt = 0;
    for (;;) {
      try {
        return await fn();
      } catch (e) {
        const status = e instanceof GraphError ? e.status : undefined;
        if (status === undefined || !RETRYABLE.has(status) || attempt >= maxRetries) throw e;
        const advised = e instanceof GraphError ? e.retryAfterMs : undefined;
        const backoff = Math.min(baseDelayMs * 2 ** attempt, maxDelayMs);
        const delay = Math.max(advised ?? 0, backoff) + jitter();
        attempt++;
        warn(`graph ${label}: ${status} — retry ${attempt}/${maxRetries} in ${delay}ms`);
        await sleep(delay);
      }
    }
  }

  return {
    createThread: (p: CreateThreadParams) => withRetry('createThread', () => inner.createThread(p)),
    replyToThread: (p: ReplyParams) =>
      serialize(p.threadRootId, () => withRetry('replyToThread', () => inner.replyToThread(p))),
    listChannels: inner.listChannels ? (teamId: string) => inner.listChannels!(teamId) : undefined,
    getChannel: inner.getChannel
      ? (teamId: string, channelId: string) => inner.getChannel!(teamId, channelId)
      : undefined,
  };
}
