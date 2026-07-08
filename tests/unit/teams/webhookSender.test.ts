import { describe, expect, it, vi } from 'vitest';
import {
  createWebhookSender,
  createRoutingGraphSender,
  type FetchLike,
} from '../../../electron/teams/webhookSender';
import type { GraphSender } from '../../../electron/teams/graphClient';

const CH = '19:aaa@thread.tacv2';

function okFetch(): { impl: FetchLike; calls: Array<{ url: string; body: string }> } {
  const calls: Array<{ url: string; body: string }> = [];
  const impl: FetchLike = async (url, init) => {
    calls.push({ url, body: init.body });
    return { ok: true, status: 200, text: async () => '' };
  };
  return { impl, calls };
}

describe('createWebhookSender', () => {
  it('POSTs a JSON body with text + html + title on createThread and returns empty ids', async () => {
    const { impl, calls } = okFetch();
    const sender = createWebhookSender({ getWebhookUrl: () => 'https://hook.example/x', fetchImpl: impl });

    const res = await sender.createThread({
      teamId: 't',
      channelId: CH,
      subject: 'Hello',
      html: '<p>Hi <b>there</b></p>',
    });

    expect(res).toEqual({ threadRootId: '', webUrl: '' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://hook.example/x');
    const payload = JSON.parse(calls[0].body);
    expect(payload.text).toBe('Hi there'); // html stripped to plain text
    expect(payload.html).toBe('<p>Hi <b>there</b></p>');
    expect(payload.title).toBe('Hello');
  });

  it('POSTs on replyToThread (no title) and returns an empty messageId', async () => {
    const { impl, calls } = okFetch();
    const sender = createWebhookSender({ getWebhookUrl: () => 'https://hook.example/x', fetchImpl: impl });

    const res = await sender.replyToThread({ teamId: 't', channelId: CH, threadRootId: 'root', html: '<p>Yo</p>' });

    expect(res).toEqual({ messageId: '' });
    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].body).title).toBeUndefined();
  });

  it('reads the URL per-send (live settings changes)', async () => {
    const { impl, calls } = okFetch();
    let url = 'https://hook.example/first';
    const sender = createWebhookSender({ getWebhookUrl: () => url, fetchImpl: impl });

    await sender.createThread({ teamId: 't', channelId: CH, subject: 's', html: 'a' });
    url = 'https://hook.example/second';
    await sender.createThread({ teamId: 't', channelId: CH, subject: 's', html: 'b' });

    expect(calls.map((c) => c.url)).toEqual(['https://hook.example/first', 'https://hook.example/second']);
  });

  it('throws when the URL is empty', async () => {
    const { impl } = okFetch();
    const sender = createWebhookSender({ getWebhookUrl: () => '  ', fetchImpl: impl });
    await expect(sender.createThread({ teamId: 't', channelId: CH, subject: 's', html: 'a' })).rejects.toThrow(
      /not configured/,
    );
  });

  it('throws on a non-ok HTTP response', async () => {
    const impl: FetchLike = async () => ({ ok: false, status: 502, text: async () => 'bad gateway' });
    const sender = createWebhookSender({ getWebhookUrl: () => 'https://hook.example/x', fetchImpl: impl });
    await expect(sender.replyToThread({ teamId: 't', channelId: CH, threadRootId: 'r', html: 'a' })).rejects.toThrow(
      /502/,
    );
  });
});

describe('createRoutingGraphSender', () => {
  function stubSender(tag: string): GraphSender & { created: number; replied: number } {
    const s = {
      created: 0,
      replied: 0,
      async createThread() {
        s.created++;
        return { threadRootId: tag, webUrl: tag };
      },
      async replyToThread() {
        s.replied++;
        return { messageId: tag };
      },
    };
    return s;
  }

  it('routes to the webhook when active, else to primary — evaluated per call', async () => {
    const primary = stubSender('primary');
    const webhook = stubSender('webhook');
    let active = false;
    const router = createRoutingGraphSender(primary, webhook, () => active);

    const a = await router.createThread({ teamId: 't', channelId: CH, subject: 's', html: 'x' });
    expect(a.threadRootId).toBe('primary');

    active = true;
    const b = await router.createThread({ teamId: 't', channelId: CH, subject: 's', html: 'x' });
    expect(b.threadRootId).toBe('webhook');

    expect(primary.created).toBe(1);
    expect(webhook.created).toBe(1);
  });

  it('always delegates listChannels to primary when present', async () => {
    const primary: GraphSender = {
      createThread: async () => ({ threadRootId: 'p', webUrl: 'p' }),
      replyToThread: async () => ({ messageId: 'p' }),
      listChannels: vi.fn(async () => [{ id: 'c1', displayName: 'C1' }]),
    };
    const webhook = stubSender('webhook');
    const router = createRoutingGraphSender(primary, webhook, () => true);

    expect(router.listChannels).toBeDefined();
    const chans = await router.listChannels!('team');
    expect(chans).toEqual([{ id: 'c1', displayName: 'C1' }]);
    expect(primary.listChannels).toHaveBeenCalledWith('team');
  });
});
