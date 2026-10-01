import { afterEach, describe, expect, it, vi } from 'vitest';
import { ReadyWaiters } from '../../../electron/terminal/ready-waiters';

const timeoutMessage = (key: string, ms: number) => `${key} not ready after ${ms}ms`;

afterEach(() => {
  vi.useRealTimers();
});

describe('ReadyWaiters (Teams ensure-online readiness)', () => {
  it('resolves immediately when the agent is already ready (reuse an active bridge)', async () => {
    const waiters = new ReadyWaiters((key) => key === 'office-0:generalist');
    await expect(waiters.wait('office-0:generalist', 10, timeoutMessage)).resolves.toBeUndefined();
    expect(waiters.pendingCount('office-0:generalist')).toBe(0);
  });

  it('resolves every waiter when the ready signal arrives', async () => {
    const waiters = new ReadyWaiters(() => false);
    const first = waiters.wait('office-0:generalist', 5_000, timeoutMessage);
    const second = waiters.wait('office-0:generalist', 5_000, timeoutMessage);
    expect(waiters.pendingCount('office-0:generalist')).toBe(2);

    waiters.settle('office-0:generalist');

    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    expect(waiters.pendingCount('office-0:generalist')).toBe(0);
  });

  it('fails waiters explicitly when the session exits before it is ready', async () => {
    const waiters = new ReadyWaiters(() => false);
    const pending = waiters.wait('office-0:generalist', 5_000, timeoutMessage);

    waiters.settle('office-0:generalist', new Error('exited before it was ready (code 1)'));

    await expect(pending).rejects.toThrow('exited before it was ready (code 1)');
  });

  it('times out with the explicit reason and forgets the waiter', async () => {
    vi.useFakeTimers();
    const waiters = new ReadyWaiters(() => false);
    const pending = waiters.wait('office-0:generalist', 1_000, timeoutMessage);
    const assertion = expect(pending).rejects.toThrow('office-0:generalist not ready after 1000ms');

    await vi.advanceTimersByTimeAsync(1_000);

    await assertion;
    expect(waiters.pendingCount('office-0:generalist')).toBe(0);
    waiters.settle('office-0:generalist');
  });

  it('keeps agents independent', async () => {
    const waiters = new ReadyWaiters(() => false);
    const gene = waiters.wait('office-0:generalist', 5_000, timeoutMessage);
    const dan = waiters.wait('office-0:debugger', 5_000, timeoutMessage);

    waiters.settle('office-0:debugger');

    await expect(dan).resolves.toBeUndefined();
    expect(waiters.pendingCount('office-0:generalist')).toBe(1);
    waiters.settle('office-0:generalist');
    await expect(gene).resolves.toBeUndefined();
  });
});
