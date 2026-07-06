// T008 — Channel resolution + active-channel-set + thread classification.
//
// Channel resolution: effective channel for an office = office override ?? global default.
// Active channel set: distinct channelIds across all currently-online bindings; the message
// filter admits a push only if its channel is in this set (multi-channel over one Trouter sub).
// Thread classification: given (channelId, threadRootId), decide whether the message targets a
// bound agent, an orphaned known-thread (notify once), or a foreign thread (ignore).

import type {
  OnlineAgentBinding,
  KnownThread,
  ThreadClassification,
} from './types';

/** Effective channel deep-link URL for an office: override ?? default. */
export function resolveChannel(
  office: { teamsChannelUrl?: string } | null | undefined,
  settings: { defaultChannelUrl: string } | null | undefined,
): string {
  const override = office?.teamsChannelUrl?.trim();
  if (override) return override;
  return settings?.defaultChannelUrl?.trim() || '';
}

/** Distinct channelIds with at least one online binding. */
export function activeChannelSet(bindings: OnlineAgentBinding[]): Set<string> {
  const set = new Set<string>();
  for (const b of bindings) {
    if (b.online && b.channelId) set.add(b.channelId);
  }
  return set;
}

/** Find the online binding for a (channelId, threadRootId) pair, if any. */
export function findBinding(
  channelId: string,
  threadRootId: string,
  bindings: OnlineAgentBinding[],
): OnlineAgentBinding | undefined {
  return bindings.find(
    (b) => b.online && b.channelId === channelId && b.threadRootId === threadRootId,
  );
}

/**
 * Classify a thread:
 *  - `bound`    → an online binding owns this (channelId, threadRootId)
 *  - `orphaned` → the app created this thread (known) but no longer has an online binding
 *  - `foreign`  → any other thread (never created by the app; ignore silently)
 */
export function classifyThread(
  channelId: string,
  threadRootId: string,
  bindings: OnlineAgentBinding[],
  knownThreads: KnownThread[],
): ThreadClassification {
  if (findBinding(channelId, threadRootId, bindings)) return 'bound';
  if (threadRootId && knownThreads.some((t) => t.threadRootId === threadRootId)) {
    return 'orphaned';
  }
  return 'foreign';
}
