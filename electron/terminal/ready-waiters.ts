// Bounded "wait until this agent is ready" registry for the terminal server.
//
// The Teams ensure-session-online seam starts (or reuses) a session from the
// main process and must not report success until the agent can actually take
// programmatic prompts — for the native bridge, until its extension has
// authenticated. Waiters are settled by the server's signalReady, failed when
// the session exits first, and time out with an explicit reason.
// Pure (no server.ts import) so it is unit-testable, like agent-viewers.ts.

type Settle = (error?: Error) => void;

export class ReadyWaiters {
  private readonly waiters = new Map<string, Set<Settle>>();

  constructor(private readonly isReady: (key: string) => boolean) {}

  /** Resolve once `key` is ready; reject with `timeoutMessage(...)` after `timeoutMs`. */
  wait(key: string, timeoutMs: number, timeoutMessage: (key: string, timeoutMs: number) => string): Promise<void> {
    if (this.isReady(key)) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      const settle: Settle = (error) => {
        if (timer) clearTimeout(timer);
        if (error) reject(error);
        else resolve();
      };
      timer = setTimeout(() => {
        this.remove(key, settle);
        reject(new Error(timeoutMessage(key, timeoutMs)));
      }, timeoutMs);
      let pending = this.waiters.get(key);
      if (!pending) {
        pending = new Set();
        this.waiters.set(key, pending);
      }
      pending.add(settle);
    });
  }

  /** Resolve every waiter for `key`, or reject them all with `error`. */
  settle(key: string, error?: Error): void {
    const pending = this.waiters.get(key);
    if (!pending) return;
    this.waiters.delete(key);
    for (const settle of pending) settle(error);
  }

  /** Number of callers still waiting on `key` (diagnostics/tests). */
  pendingCount(key: string): number {
    return this.waiters.get(key)?.size ?? 0;
  }

  private remove(key: string, settle: Settle): void {
    const pending = this.waiters.get(key);
    if (!pending) return;
    pending.delete(settle);
    if (pending.size === 0) this.waiters.delete(key);
  }
}
