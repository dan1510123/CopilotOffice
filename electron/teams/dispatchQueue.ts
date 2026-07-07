// T032 — Per-agent sequential dispatch queue.
//
// Each agent processes one prompt at a time (FIFO). A queued prompt is submitted via the
// SessionGateway; the next item is dequeued only after the current turn ends. Exactly one
// reply is produced per prompt.

import { twarn } from './log';

export interface DispatchItem {
  agentId: string;
  officeId: string;
  sessionId: string;
  threadRootId: string;
  prompt: string;
}

type ProcessFn = (item: DispatchItem) => Promise<void>;

/** FIFO queue keyed by `${officeId}:${agentId}`. */
export class DispatchQueue {
  private queues = new Map<string, DispatchItem[]>();
  private processing = new Set<string>();

  constructor(private readonly process: ProcessFn) {}

  private key(officeId: string, agentId: string): string {
    return `${officeId}:${agentId}`;
  }

  enqueue(item: DispatchItem): void {
    const k = this.key(item.officeId, item.agentId);
    const q = this.queues.get(k) ?? [];
    q.push(item);
    this.queues.set(k, q);
    void this.drain(k);
  }

  /** Number of pending items for an agent (excludes the in-flight one). */
  pending(officeId: string, agentId: string): number {
    return this.queues.get(this.key(officeId, agentId))?.length ?? 0;
  }

  /** Drop all queued work for an agent (e.g. on going offline). */
  clear(officeId: string, agentId: string): void {
    this.queues.delete(this.key(officeId, agentId));
  }

  private async drain(k: string): Promise<void> {
    if (this.processing.has(k)) return;
    this.processing.add(k);
    try {
      for (;;) {
        const q = this.queues.get(k);
        const item = q?.shift();
        if (!item) break;
        try {
          await this.process(item);
        } catch (e) {
          twarn('dispatch item failed:', (e as Error).message);
        }
      }
    } finally {
      this.processing.delete(k);
    }
  }
}
