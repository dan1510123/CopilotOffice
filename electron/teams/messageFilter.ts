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

/** Known relay/automation bot display names (locale-stable fallback when no MRI). */
const BOT_DISPLAY_NAMES = /^(flow bot|power automate|microsoft power automate)$/i;

/**
 * True when a message was authored by a bot/app rather than a person. Primary signal is
 * the sender MRI: Teams bot/app identities use the `28:` prefix (users are `8:orgid:…`),
 * so a `28:` anywhere in the id (bare MRI or a resource URL containing it) marks a bot.
 * Falls back to matching a known relay bot display name when the transport gave no MRI.
 */
export function isBotSender(msg: InboundMessage): boolean {
  const id = (msg.senderId || '').trim();
  // When an MRI is present, trust it exclusively: `28:` = bot/app, anything else (e.g.
  // `8:orgid:…`) is a real user — so a human who happens to be named "Flow bot" is safe.
  if (id) return id.includes('28:');
  // No MRI from this transport → fall back to a known relay bot display name.
  return BOT_DISPLAY_NAMES.test((msg.senderName || '').trim());
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

    // 2b. bot-drop (relay Flow bot re-posts, and any other bot/app author). The relay
    // fans the completion notification into the agent's own thread as the Flow bot; that
    // echo must never route back into the agent. Detect by sender MRI (`28:` = bot/app)
    // or a known relay bot display name. Belt-and-suspenders with the marker above.
    if (isBotSender(msg)) return { action: 'ignore', reason: 'bot-sender' };

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
