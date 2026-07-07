// Outbound channel allowlist (hard gate on where the app may POST).
//
// Teams "send" must be restricted to the channels the operator configured: the
// global default channel (TeamsSettings.defaultChannelUrl) plus any per-office
// overrides (OfficeConfig.teamsChannelUrl). This is enforced at the GraphSender
// boundary so EVERY outbound path — thread creation, replies, acks, check-ins,
// offline/orphaned notices, and any future sender — is validated in one place,
// independent of the calling code. A blocked send throws (callers already handle
// send failures: register() surfaces an error; safeReply() logs and moves on).

import type { GraphSender, CreateThreadParams, ReplyParams } from './graphClient';
import { parseChannelLink } from './channelLink';

/**
 * Build the set of allowed channelIds from the configured deep-link URLs (the
 * global default + per-office overrides). Unparseable/empty URLs are skipped.
 */
export function allowedChannelIdSet(
  defaultChannelUrl: string | null | undefined,
  overrideUrls: readonly (string | null | undefined)[] = [],
): Set<string> {
  const set = new Set<string>();
  for (const url of [defaultChannelUrl, ...overrideUrls]) {
    const trimmed = (url ?? '').trim();
    if (!trimmed) continue;
    const coords = parseChannelLink(trimmed);
    if (coords?.channelId) set.add(coords.channelId);
  }
  return set;
}

/**
 * Wrap a GraphSender so createThread/replyToThread refuse any channel not in the
 * currently-allowed set. `getAllowed` is evaluated per-call so it always reflects
 * the latest settings/overrides (a channel removed from config is blocked at once).
 */
export function createAllowlistedGraphSender(
  inner: GraphSender,
  getAllowed: () => Set<string>,
): GraphSender {
  const assertAllowed = (channelId: string, op: string): void => {
    if (!getAllowed().has(channelId)) {
      throw new Error(
        `Teams outbound blocked: channel ${channelId} is not in the settings/overrides allowlist (${op}).`,
      );
    }
  };
  const wrapped: GraphSender = {
    createThread: async (p: CreateThreadParams) => {
      assertAllowed(p.channelId, 'createThread');
      return inner.createThread(p);
    },
    replyToThread: async (p: ReplyParams) => {
      assertAllowed(p.channelId, 'replyToThread');
      return inner.replyToThread(p);
    },
  };
  // Preserve the optional read-only capability verbatim (no channel target to gate).
  if (inner.listChannels) {
    wrapped.listChannels = (teamId: string) => inner.listChannels!(teamId);
  }
  return wrapped;
}

/**
 * Extract per-office Teams channel override URLs from the persisted offices JSON
 * (`.data/copilot-offices.json`, shape `{ offices: [{ teamsChannelUrl? }] }`).
 * Best-effort: returns [] on any parse/shape error.
 */
export function officeChannelOverridesFromJson(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const record = JSON.parse(json) as { offices?: Array<{ teamsChannelUrl?: unknown }> };
    const offices = Array.isArray(record?.offices) ? record.offices : [];
    const urls: string[] = [];
    for (const o of offices) {
      const u = o?.teamsChannelUrl;
      if (typeof u === 'string' && u.trim()) urls.push(u.trim());
    }
    return urls;
  } catch {
    return [];
  }
}

/**
 * Wrap an allowed-channel-set computation with a short in-memory TTL cache so the
 * underlying (synchronous, disk-backed) settings/office reads run at most once per
 * `ttlMs` instead of on every outbound send. This keeps bursts of replies/chunks off
 * the event loop and shrinks the window in which a mid-write file lock could be hit.
 *
 * Resilience: if `compute` throws (e.g. a transient read error), the last known-good
 * set is retained rather than collapsing to empty and falsely blocking a legitimate
 * send; the retry happens on the next call (the cache timestamp is not advanced on
 * error). Config changes take effect within `ttlMs` (default 2s).
 */
export function createCachedAllowedChannels(
  compute: () => Set<string>,
  ttlMs = 2000,
  now: () => number = Date.now,
): () => Set<string> {
  let cached: Set<string> | null = null;
  let computedAt = 0;
  return () => {
    const t = now();
    if (cached && t - computedAt < ttlMs) return cached;
    try {
      cached = compute();
      computedAt = t;
    } catch {
      if (!cached) cached = new Set(); // fail closed if we never had a good set
      // keep the old timestamp so the next call retries instead of trusting stale
    }
    return cached;
  };
}
