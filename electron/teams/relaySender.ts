// Relay-backed GraphSender — posts every outbound Teams message to ONE dedicated
// "Dump" trigger channel with machine-readable METADATA, so a single Power Automate
// flow can fan each message out to the correct destination channel under a DISTINCT
// bot identity (the Flow bot) with an @mention of a person OR a Teams tag. The
// motivating use case: Teams never notifies you about your own messages, so posting as
// yourself means you never see the notification. The Flow bot is a different sender, so
// you do — and it dodges the tenant DLP that blocks HTTP/webhook triggers (this path
// uses only the Teams connector).
//
// How it works: every send is posted as a NEW top-level message to the operator-
// configured Dump channel via the existing Graph sender (`GraphClient`). The message
// body carries the human-readable html PLUS a base64-encoded JSON metadata block
// delimited by `[[CO-META]]`/`[[/CO-META]]`. base64 is used so Teams' HTML encoding of
// the stored message can't corrupt the JSON when the flow reads it back. The flow
// parses the metadata and posts to `destTeamId`/`destChannelId` with the mention.
//
// Because the "new channel message" trigger only fires on ROOT messages (not replies),
// `replyToThread` also posts a new root message. Send-only by nature: the Dump-channel
// post's ids don't map to a thread in the real channel, so both methods return empty
// ids and threaded reply routing is INACTIVE on this path — acceptable when the app
// already monitors channels via the receive transport.
//
// Security boundary: the Dump channel is FIXED by operator settings (a parsed channel
// deep-link), not attacker-controllable, so this path intentionally bypasses the
// outbound channel allowlist — pass a RAW `GraphClient` (not the allowlisted one) so
// posts to the Dump channel (which is not in the allowlist) are not rejected.
//
// Feature-flag semantics: selected by `createRoutingGraphSender` only when a Dump
// channel URL is configured. With no URL, the app falls back to the existing
// allowlisted signed-in-user Graph sender and behaves exactly as before.

import type { GraphSender, CreateThreadParams, ReplyParams } from './graphClient';

type HostedImages = CreateThreadParams['hostedImages'];
import { parseChannelLink } from './channelLink';
import { embedMarker } from './marker';
import { tlog } from './log';

/** How the destination @mention is addressed. */
export type MentionType = 'user' | 'tag' | 'none';

/** Operator-configured mention target (a person or a Teams tag), pre-resolution. */
export interface MentionRef {
  type: MentionType;
  /** A UPN/oid/display-name (user) or a tag display-name/tagId (tag). Empty ⇒ no mention. */
  value: string;
}

/** Mention resolved to the concrete id the flow's connector op needs. */
export interface ResolvedMention {
  mentionType: MentionType;
  /** UPN/oid for a user, tagId for a tag, '' for none. */
  mentionId: string;
}

/**
 * Resolve an operator MentionRef to a concrete id, per destination team (tags are
 * team-scoped). Implementations use Graph (list tags / look up user). Must never throw
 * — return `{ mentionType: 'none', mentionId: '' }` when a target can't be resolved.
 */
export type MentionResolver = (ref: MentionRef, destTeamId: string) => Promise<ResolvedMention>;

/** The JSON the flow parses out of the base64 metadata block. */
export interface RelayMetadata {
  v: 1;
  destTeamId: string;
  destChannelId: string;
  /**
   * Root message id of the agent's Teams-remote thread in the destination channel. When
   * non-empty the flow REPLIES under this message (ReplyWithMessageToConversation) so the
   * notification lands inside the agent's conversation; empty ⇒ the flow posts a new root
   * message (legacy behaviour, e.g. thread-creation announcements).
   */
  threadRootId: string;
  mentionType: MentionType;
  mentionId: string;
  title: string;
  html: string;
}

export const META_OPEN = '[[CO-META]]';
export const META_CLOSE = '[[/CO-META]]';

/** Remove any CO-META marker tokens from caller-supplied html so a forged metadata
 *  block can't be injected ahead of the app's real one (content-injection guard).
 *  Strips to a FIXED POINT: a single pass can reconstruct a marker at a join boundary
 *  (e.g. `[[CO-[[CO-META]]META]]` → `[[CO-META]]`), so we repeat until stable. On exit
 *  neither marker substring can remain (else another pass would have changed the text). */
export function stripMetaMarkers(html: string): string {
  let out = html;
  let prev: string;
  do {
    prev = out;
    out = out.split(META_OPEN).join('').split(META_CLOSE).join('');
  } while (out !== prev);
  return out;
}

export interface RelaySenderOptions {
  /** The raw Graph sender used to post into the Dump channel (NOT allowlisted). */
  primary: GraphSender;
  /** Returns the current Dump channel deep-link (read per-send so settings changes take effect live). */
  getDumpChannelUrl: () => string;
  /** Returns the operator's current mention target (read per-send). */
  getMention: () => MentionRef;
  /** Resolves a mention target to the concrete id for a given destination team. */
  resolveMention: MentionResolver;
  /**
   * Gate on the logical DESTINATION channel (the real channel the flow will fan out to).
   * The relay bypasses the allowlist for the Dump-channel POST itself (the Dump channel
   * is operator-configured), but the destination must still satisfy the same outbound
   * allowlist as the direct path. Returns true when the destination channel is allowed.
   */
  isDestinationAllowed: (channelId: string) => boolean;
}

/** Encode the metadata block appended to every Dump-channel post. */
export function encodeMetaBlock(meta: RelayMetadata): string {
  const b64 = Buffer.from(JSON.stringify(meta), 'utf8').toString('base64');
  return `<p>${META_OPEN}${b64}${META_CLOSE}</p>`;
}

/** Extract + decode the metadata block from a Dump-channel message body (used by tests / tooling).
 *  Parses the LAST marker block — the app always appends its block last, so this is robust
 *  even if the human html still contained marker-like text. */
export function decodeMetaBlock(body: string): RelayMetadata | null {
  const start = body.lastIndexOf(META_OPEN);
  if (start < 0) return null;
  const end = body.indexOf(META_CLOSE, start + META_OPEN.length);
  if (end < 0) return null;
  const b64 = body.slice(start + META_OPEN.length, end).trim();
  try {
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8')) as RelayMetadata;
  } catch {
    return null;
  }
}

/**
 * Build a `GraphSender` that forwards every outbound post to the operator-configured
 * Dump channel with routing metadata. Throws if the Dump URL is empty or unparseable at
 * send time (callers already handle send failures). Mention-resolution failures do NOT
 * throw — they degrade to no mention so the message still gets through.
 */
export function createRelaySender(opts: RelaySenderOptions): GraphSender {
  const resolveDump = (): { teamId: string; channelId: string } => {
    const url = opts.getDumpChannelUrl().trim();
    if (!url) throw new Error('Teams Dump channel URL is not configured.');
    const coords = parseChannelLink(url);
    if (!coords) throw new Error('Teams Dump channel URL could not be parsed.');
    return { teamId: coords.teamId, channelId: coords.channelId };
  };

  const postToDump = async (
    dest: { teamId: string; channelId: string; threadRootId: string },
    title: string,
    html: string,
    hostedImages: HostedImages,
  ): Promise<void> => {
    // Enforce the SAME outbound allowlist on the logical destination as the direct path.
    // (Only the Dump-channel POST itself bypasses the allowlist, not the fan-out target.)
    if (!opts.isDestinationAllowed(dest.channelId)) {
      throw new Error(
        `Teams outbound blocked: destination channel ${dest.channelId} is not in the allowlist (relay).`,
      );
    }
    const dump = resolveDump();

    let resolved: ResolvedMention = { mentionType: 'none', mentionId: '' };
    const ref = opts.getMention();
    if (ref && ref.type !== 'none' && ref.value.trim()) {
      try {
        resolved = await opts.resolveMention({ type: ref.type, value: ref.value.trim() }, dest.teamId);
      } catch (err) {
        tlog(`Relay mention resolution failed (${(err as Error).message}); posting without mention.`);
        resolved = { mentionType: 'none', mentionId: '' };
      }
    }

    // Strip any marker tokens from the human html so the appended block is the only one,
    // then embed the self-loop marker so when the Flow bot re-posts this content into the
    // agent's thread (a channel the app monitors), the app drops its own echo instead of
    // routing it back to the agent — closing the notify→reply→notify loop.
    const humanHtml = embedMarker(stripMetaMarkers(html));
    const meta: RelayMetadata = {
      v: 1,
      destTeamId: dest.teamId,
      destChannelId: dest.channelId,
      threadRootId: dest.threadRootId,
      mentionType: resolved.mentionType,
      mentionId: resolved.mentionId,
      title,
      html: humanHtml,
    };
    const body = `${humanHtml}${encodeMetaBlock(meta)}`;
    await opts.primary.createThread({
      teamId: dump.teamId,
      channelId: dump.channelId,
      subject: 'CopilotOffice',
      html: body,
      hostedImages,
    });
    tlog(`Relay post to Dump channel ok (dest=${dest.channelId}, thread=${dest.threadRootId || 'root'}, mention=${resolved.mentionType}).`);
  };

  return {
    async createThread(p: CreateThreadParams): Promise<{ threadRootId: string; webUrl: string }> {
      // No existing thread to reply under → flow posts a new root message.
      await postToDump({ teamId: p.teamId, channelId: p.channelId, threadRootId: '' }, p.subject, p.html, p.hostedImages);
      // The Dump-channel post's ids don't map to a thread in the real channel.
      return { threadRootId: '', webUrl: '' };
    },
    async replyToThread(p: ReplyParams): Promise<{ messageId: string }> {
      // Carry the agent's thread root so the flow REPLIES under it in the real channel.
      // (The Dump-channel post itself is still a new root so the flow's trigger fires.)
      await postToDump(
        { teamId: p.teamId, channelId: p.channelId, threadRootId: p.threadRootId },
        '',
        p.html,
        p.hostedImages,
      );
      return { messageId: '' };
    },
  };
}

/**
 * Route outbound sends to `relay` when `isRelayActive()` returns true, otherwise to
 * `primary` (the allowlisted signed-in-user Graph sender). The predicate is evaluated
 * PER CALL so toggling the Dump channel URL in settings takes effect without a restart.
 * `listChannels` (a read-only Graph capability) is always delegated to `primary`.
 */
export function createRoutingGraphSender(
  primary: GraphSender,
  relay: GraphSender,
  isRelayActive: () => boolean,
): GraphSender {
  const pick = (): GraphSender => (isRelayActive() ? relay : primary);
  const wrapped: GraphSender = {
    createThread: (p) => pick().createThread(p),
    replyToThread: (p) => pick().replyToThread(p),
  };
  if (primary.listChannels) {
    wrapped.listChannels = (teamId: string) => primary.listChannels!(teamId);
  }
  return wrapped;
}
