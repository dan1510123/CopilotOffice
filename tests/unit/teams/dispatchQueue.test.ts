import { describe, expect, it } from 'vitest';
import { DispatchQueue, type DispatchItem } from '../../../electron/teams/dispatchQueue';

function item(prompt: string): DispatchItem {
  return { officeId: 'office-0', agentId: 'gene', sessionId: 's', threadRootId: 'r', prompt };
}

describe('DispatchQueue', () => {
  it('processes items in FIFO order, one at a time', async () => {
    const order: string[] = [];
    let active = 0;
    let maxActive = 0;
    const q = new DispatchQueue(async (it) => {
      active++;
      maxActive = Math.max(maxActive, active);
      await new Promise((r) => setTimeout(r, 5));
      order.push(it.prompt);
      active--;
    });

    q.enqueue(item('a'));
    q.enqueue(item('b'));
    q.enqueue(item('c'));

    await new Promise((r) => setTimeout(r, 60));
    expect(order).toEqual(['a', 'b', 'c']);
    expect(maxActive).toBe(1); // never concurrent for one agent
  });

  it('runs different agents concurrently', async () => {
    let concurrent = 0;
    let maxConcurrent = 0;
    const q = new DispatchQueue(async () => {
      concurrent++;
      maxConcurrent = Math.max(maxConcurrent, concurrent);
      await new Promise((r) => setTimeout(r, 10));
      concurrent--;
    });
    q.enqueue({ officeId: 'o', agentId: 'a', sessionId: 's', threadRootId: 'r', prompt: '1' });
    q.enqueue({ officeId: 'o', agentId: 'b', sessionId: 's', threadRootId: 'r', prompt: '1' });
    await new Promise((r) => setTimeout(r, 40));
    expect(maxConcurrent).toBe(2);
  });

  it('clear() drops pending work', async () => {
    const seen: string[] = [];
    const q = new DispatchQueue(async (it) => {
      await new Promise((r) => setTimeout(r, 5));
      seen.push(it.prompt);
    });
    q.enqueue(item('first'));
    q.enqueue(item('second'));
    q.clear('office-0', 'gene');
    await new Promise((r) => setTimeout(r, 40));
    // 'first' may already be in flight; 'second' must be dropped.
    expect(seen).not.toContain('second');
  });
});
