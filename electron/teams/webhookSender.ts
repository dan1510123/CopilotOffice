// Webhook-backed GraphSender — routes outbound Teams posts through an incoming
// webhook (e.g. a Power Automate "Workflows" webhook) so messages appear under a
// DISTINCT bot identity instead of the signed-in user. The motivating use case:
// Teams never notifies you about your own messages, so posting as yourself means
// you never see the notification. A webhook bot is a different sender, so you do.
//
// Send-only by nature: an incoming webhook cannot reply into a specific thread or
// return the created message id. Therefore `createThread`/`replyToThread` both POST
// a new top-level channel message and return empty ids, and threaded reply routing
// (threadRootId binding) is INACTIVE on this path. That is acceptable when the app
// already monitors the channel via the receive transport and does not depend on the
// thread binding to drive agents. Inline hosted images are dropped (the webhook flow
// controls rendering); the plain-text body is always sent.
//
// Feature-flag semantics: this sender is only selected by `createRoutingGraphSender`
// when a webhook URL is configured. With no URL, the app falls back to the existing
// signed-in-user Graph sender and behaves exactly as before.

import type { GraphSender, CreateThreadParams, ReplyParams } from './graphClient';
import { stripHtml } from './htmlText';
import { tlog } from './log';

/** Minimal fetch surface (injectable for tests). */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string },
) => Promise<{ ok: boolean; status: number; text(): Promise<string> }>;

export interface WebhookSenderOptions {
  /** Returns the current webhook URL (read per-send so settings changes take effect live). */
  getWebhookUrl: () => string;
  /** Injectable fetch; defaults to the global fetch (Electron main / Node 18+). */
  fetchImpl?: FetchLike;
}

/** POST body shape the receiving flow can bind to (`text` is the primary field). */
interface WebhookPayload {
  text: string;
  html: string;
  title?: string;
}

async function safeText(res: { text(): Promise<string> }): Promise<string> {
  try {
    return (await res.text()).slice(0, 200);
  } catch {
    return '';
  }
}

/**
 * Build a `GraphSender` that forwards every outbound post to the configured webhook.
 * Throws if the URL is empty at send time (callers already handle send failures).
 */
export function createWebhookSender(opts: WebhookSenderOptions): GraphSender {
  const doFetch: FetchLike =
    opts.fetchImpl ?? ((url, init) => (globalThis.fetch as unknown as FetchLike)(url, init));

  const post = async (html: string, title?: string): Promise<void> => {
    const url = opts.getWebhookUrl().trim();
    if (!url) throw new Error('Teams webhook URL is not configured.');
    const payload: WebhookPayload = { text: stripHtml(html), html };
    if (title) payload.title = title;
    const res = await doFetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      throw new Error(`Teams webhook POST failed: ${res.status} ${await safeText(res)}`);
    }
    tlog(`Webhook post ok (${payload.text.length} chars).`);
  };

  return {
    async createThread(p: CreateThreadParams): Promise<{ threadRootId: string; webUrl: string }> {
      await post(p.html, p.subject);
      // Webhooks return no message id and support no threading.
      return { threadRootId: '', webUrl: '' };
    },
    async replyToThread(_p: ReplyParams): Promise<{ messageId: string }> {
      await post(_p.html);
      return { messageId: '' };
    },
  };
}

/**
 * Route outbound sends to `webhook` when `isWebhookActive()` returns true, otherwise
 * to `primary` (the signed-in-user Graph sender). The predicate is evaluated PER CALL
 * so toggling the webhook URL in settings takes effect without a restart. `listChannels`
 * (a read-only Graph capability) is always delegated to `primary`.
 */
export function createRoutingGraphSender(
  primary: GraphSender,
  webhook: GraphSender,
  isWebhookActive: () => boolean,
): GraphSender {
  const pick = (): GraphSender => (isWebhookActive() ? webhook : primary);
  const wrapped: GraphSender = {
    createThread: (p) => pick().createThread(p),
    replyToThread: (p) => pick().replyToThread(p),
  };
  if (primary.listChannels) {
    wrapped.listChannels = (teamId: string) => primary.listChannels!(teamId);
  }
  return wrapped;
}
