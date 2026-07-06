// T014 — Inbound message filter pipeline (research D10).
//
// Order: dedup(messageId) → marker-drop(app self-post) → stale(compose-time skew)
//   → channel-in-active-set → classifyThread(bound|orphaned|foreign) → injection-scan
//   → decision. Orphaned known-thread → one-time inactive notice. Foreign/root → ignore.

import type {
  InboundMessage,
  OnlineAgentBinding,
  KnownThread,
  FilterResult,
} from './types';
import { activeChannelSet, classifyThread, findBinding } from './channelResolver';

const STALE_MS = 5 * 60 * 1000;

/** Basic prompt-injection heuristics — block + log on hit (defense in depth). */
const INJECTION_PATTERNS: RegExp[] = [
  /ignore (all |your )?(previous|prior|above) instructions/i,
  /disregard (the |your )?(system|previous) prompt/i,
  /reveal (your )?(system )?prompt/i,
];

export function scanInjection(content: string): boolean {
  return INJECTION_PATTERNS.some((re) => re.test(content));
}

export class MessageFilter {
  private seen = new Set<string>();
  private seenOrder: string[] = [];
  private static readonly MAX_SEEN = 5000;

  constructor(private readonly nowFn: () => number = Date.now) {}

  /** Reset dedup memory (e.g. on service restart). */
  reset(): void {
    this.seen.clear();
    this.seenOrder = [];
  }

  private remember(id: string): void {
    this.seen.add(id);
    this.seenOrder.push(id);
    if (this.seenOrder.length > MessageFilter.MAX_SEEN) {
      const old = this.seenOrder.shift();
      if (old) this.seen.delete(old);
    }
  }

  evaluate(
    msg: InboundMessage,
    bindings: OnlineAgentBinding[],
    knownThreads: KnownThread[],
  ): FilterResult {
    // 1. dedup
    if (msg.messageId) {
      if (this.seen.has(msg.messageId)) return { action: 'ignore', reason: 'duplicate' };
      this.remember(msg.messageId);
    }

    // 2. marker-drop (app self-post)
    if (msg.hasMarker) return { action: 'ignore', reason: 'self-post' };

    // 3. stale
    if (msg.composeTime) {
      const t = Date.parse(msg.composeTime);
      if (Number.isFinite(t) && this.nowFn() - t > STALE_MS) {
        return { action: 'ignore', reason: 'stale' };
      }
    }

    // 4. channel-in-active-set
    const active = activeChannelSet(bindings);
    if (!active.has(msg.channelId)) return { action: 'ignore', reason: 'inactive-channel' };

    // A root-level message (no thread id) is never a reply we route.
    if (!msg.threadRootId) return { action: 'ignore', reason: 'root-message' };

    // 5. classify
    const classification = classifyThread(msg.channelId, msg.threadRootId, bindings, knownThreads);
    if (classification === 'foreign') {
      return { action: 'ignore', classification, reason: 'foreign-thread' };
    }
    if (classification === 'orphaned') {
      return { action: 'orphaned-notice', classification, reason: 'orphaned-thread' };
    }

    // 6. injection-scan
    if (scanInjection(msg.content)) {
      return { action: 'ignore', classification, reason: 'injection-blocked' };
    }

    const binding = findBinding(msg.channelId, msg.threadRootId, bindings);
    return { action: 'dispatch', classification, binding };
  }
}
