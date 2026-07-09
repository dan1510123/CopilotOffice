import { describe, expect, it, vi } from 'vitest';
import {
  createRelaySender,
  createRoutingGraphSender,
  decodeMetaBlock,
  stripMetaMarkers,
  type MentionResolver,
} from '../../../electron/teams/relaySender';
import type { GraphSender, CreateThreadParams, ReplyParams } from '../../../electron/teams/graphClient';
import { hasMarker } from '../../../electron/teams/marker';

const CH = '19:aaa@thread.tacv2';
// A real Dump-channel deep-link (teamId in groupId, channelId in the path).
const DUMP_URL =
  'https://teams.microsoft.com/l/channel/19%3A0123456789abcdef0123456789abcdef%40thread.tacv2/Agent%20Hub?groupId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&tenantId=00000000-0000-0000-0000-000000000000';
const DUMP_TEAM = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';
const DUMP_CHANNEL = '19:0123456789abcdef0123456789abcdef@thread.tacv2';

// Destination (real) channel the caller intends the message for.
const DEST_TEAM = 'dest-team-guid';
const DEST_CHANNEL = '19:dest@thread.tacv2';

function recordingPrimary(): GraphSender & { createCalls: CreateThreadParams[]; replyCalls: ReplyParams[] } {
  const createCalls: CreateThreadParams[] = [];
  const replyCalls: ReplyParams[] = [];
  return {
    createCalls,
    replyCalls,
    async createThread(p) {
      createCalls.push(p);
      return { threadRootId: 'trigger-msg-id', webUrl: 'https://trigger/url' };
    },
    async replyToThread(p) {
      replyCalls.push(p);
      return { messageId: 'trigger-reply-id' };
    },
  };
}

const noneResolver: MentionResolver = async () => ({ mentionType: 'none', mentionId: '' });

function build(overrides: Partial<Parameters<typeof createRelaySender>[0]> = {}) {
  const primary = recordingPrimary();
  const sender = createRelaySender({
    primary,
    getDumpChannelUrl: () => DUMP_URL,
    getMention: () => ({ type: 'none', value: '' }),
    resolveMention: noneResolver,
    isDestinationAllowed: () => true,
    ...overrides,
  });
  return { primary, sender };
}

describe('createRelaySender', () => {
  it('posts createThread to the Dump channel with a decodable metadata block carrying the real destination', async () => {
    const { primary, sender } = build();

    const res = await sender.createThread({
      teamId: DEST_TEAM,
      channelId: DEST_CHANNEL,
      subject: 'Gene · Office X',
      html: '<p>Hi</p>',
    });

    expect(res).toEqual({ threadRootId: '', webUrl: '' });
    expect(primary.createCalls).toHaveLength(1);
    // Posted to the DUMP channel, not the caller's destination.
    expect(primary.createCalls[0].teamId).toBe(DUMP_TEAM);
    expect(primary.createCalls[0].channelId).toBe(DUMP_CHANNEL);
    // Body contains the human text + a metadata block.
    const body = primary.createCalls[0].html;
    expect(body).toContain('Hi');
    const meta = decodeMetaBlock(body);
    expect(meta).toMatchObject({
      v: 1,
      destTeamId: DEST_TEAM,
      destChannelId: DEST_CHANNEL,
      threadRootId: '', // createThread → no existing thread to reply under
      mentionType: 'none',
      mentionId: '',
      title: 'Gene · Office X',
    });
    // Forwarded content carries the self-loop marker so the Flow-bot re-post is dropped.
    expect(meta?.html).toContain('Hi');
    expect(hasMarker(meta!.html)).toBe(true);
    expect(primary.replyCalls).toHaveLength(0);
  });

  it('replyToThread carries the agent thread root in metadata (flow replies in-thread)', async () => {
    const { primary, sender } = build();

    const res = await sender.replyToThread({
      teamId: DEST_TEAM,
      channelId: DEST_CHANNEL,
      threadRootId: 'root',
      html: '<p>Yo</p>',
    });

    expect(res).toEqual({ messageId: '' });
    expect(primary.createCalls).toHaveLength(1);
    expect(primary.replyCalls).toHaveLength(0);
    // Dump post is still a NEW root (so the flow trigger fires)…
    expect(primary.createCalls[0].channelId).toBe(DUMP_CHANNEL);
    const meta = decodeMetaBlock(primary.createCalls[0].html);
    // …but it carries the destination thread root so the flow replies under it.
    expect(meta?.threadRootId).toBe('root');
    expect(meta?.html).toContain('Yo');
    expect(hasMarker(meta!.html)).toBe(true);
  });

  it('resolves a user mention and embeds the resolved id + type in metadata', async () => {
    const resolveMention = vi.fn<MentionResolver>(async (ref, destTeamId) => {
      expect(ref).toEqual({ type: 'user', value: 'user@example.com' });
      expect(destTeamId).toBe(DEST_TEAM);
      return { mentionType: 'user', mentionId: 'oid-123' };
    });
    const { primary, sender } = build({
      getMention: () => ({ type: 'user', value: 'user@example.com' }),
      resolveMention,
    });

    await sender.createThread({ teamId: DEST_TEAM, channelId: DEST_CHANNEL, subject: 's', html: 'a' });

    expect(resolveMention).toHaveBeenCalledOnce();
    const meta = decodeMetaBlock(primary.createCalls[0].html);
    expect(meta).toMatchObject({ mentionType: 'user', mentionId: 'oid-123' });
  });

  it('degrades to no mention when resolution throws (never blocks the post)', async () => {
    const resolveMention: MentionResolver = async () => {
      throw new Error('graph down');
    };
    const { primary, sender } = build({
      getMention: () => ({ type: 'tag', value: 'Leads' }),
      resolveMention,
    });

    await sender.createThread({ teamId: DEST_TEAM, channelId: DEST_CHANNEL, subject: 's', html: 'a' });

    expect(primary.createCalls).toHaveLength(1);
    expect(decodeMetaBlock(primary.createCalls[0].html)).toMatchObject({ mentionType: 'none', mentionId: '' });
  });

  it('does not call the resolver when mention type is none or value is blank', async () => {
    const resolveMention = vi.fn<MentionResolver>(async () => ({ mentionType: 'none', mentionId: '' }));
    const { sender } = build({ getMention: () => ({ type: 'user', value: '   ' }), resolveMention });

    await sender.createThread({ teamId: DEST_TEAM, channelId: DEST_CHANNEL, subject: 's', html: 'a' });

    expect(resolveMention).not.toHaveBeenCalled();
  });

  it('reads the Dump URL per-send (live settings changes)', async () => {
    const primary = recordingPrimary();
    let url = DUMP_URL;
    const sender = createRelaySender({
      primary,
      getDumpChannelUrl: () => url,
      getMention: () => ({ type: 'none', value: '' }),
      resolveMention: noneResolver,
      isDestinationAllowed: () => true,
    });

    await sender.createThread({ teamId: DEST_TEAM, channelId: DEST_CHANNEL, subject: 's', html: 'a' });
    url =
      'https://teams.microsoft.com/l/channel/19%3Adeadbeef%40thread.tacv2/Other?groupId=11111111-1111-1111-1111-111111111111&tenantId=00000000-0000-0000-0000-000000000000';
    await sender.createThread({ teamId: DEST_TEAM, channelId: DEST_CHANNEL, subject: 's', html: 'b' });

    expect(primary.createCalls.map((c) => c.channelId)).toEqual([DUMP_CHANNEL, '19:deadbeef@thread.tacv2']);
  });

  it('strips CO-META markers to a fixed point (nested markers cannot reconstruct a block)', async () => {
    // A single non-rescanning pass would leave a full block behind; the fixed-point
    // loop must remove every trace of both marker tokens.
    expect(stripMetaMarkers('[[CO-[[CO-META]]META]]')).toBe('');
    const nested = 'X[[CO-[[/CO-META]]META]]YYY[[/CO-[[/CO-META]]META]]Z';
    const stripped = stripMetaMarkers(nested);
    expect(stripped).not.toContain('[[CO-META]]');
    expect(stripped).not.toContain('[[/CO-META]]');
  });

  it('strips CO-META markers from caller html so a forged block cannot be injected', async () => {
    const { primary, sender } = build();
    const forged = Buffer.from(
      JSON.stringify({ destChannelId: '19:evil@thread.tacv2', mentionType: 'user', mentionId: 'victim' }),
    ).toString('base64');
    const evilHtml = `<p>hello</p>[[CO-META]]${forged}[[/CO-META]]`;

    await sender.createThread({ teamId: DEST_TEAM, channelId: DEST_CHANNEL, subject: 's', html: evilHtml });

    const body = primary.createCalls[0].html;
    // Only ONE marker block survives, and it is the app's real one (correct destination).
    expect(body.split('[[CO-META]]')).toHaveLength(2);
    expect(decodeMetaBlock(body)).toMatchObject({ destChannelId: DEST_CHANNEL, mentionType: 'none' });
  });

  it('blocks a destination channel that is not in the allowlist (relay path)', async () => {
    const { primary, sender } = build({ isDestinationAllowed: (ch) => ch === '19:allowed@thread.tacv2' });

    await expect(
      sender.createThread({ teamId: DEST_TEAM, channelId: '19:notallowed@thread.tacv2', subject: 's', html: 'a' }),
    ).rejects.toThrow(/not in the allowlist/);
    expect(primary.createCalls).toHaveLength(0);
  });

  it('throws when the Dump URL is empty or unparseable', async () => {
    const empty = build({ getDumpChannelUrl: () => '  ' });
    await expect(
      empty.sender.createThread({ teamId: DEST_TEAM, channelId: DEST_CHANNEL, subject: 's', html: 'a' }),
    ).rejects.toThrow(/not configured/);

    const bad = build({ getDumpChannelUrl: () => 'https://example.com/not-a-channel' });
    await expect(
      bad.sender.replyToThread({ teamId: DEST_TEAM, channelId: DEST_CHANNEL, threadRootId: 'r', html: 'a' }),
    ).rejects.toThrow(/could not be parsed/);
    expect(bad.primary.createCalls).toHaveLength(0);
  });
});

describe('decodeMetaBlock', () => {
  it('returns null on missing or garbage blocks', () => {
    expect(decodeMetaBlock('<p>no meta here</p>')).toBeNull();
    expect(decodeMetaBlock('<p>[[CO-META]]!!!notbase64!!![[/CO-META]]</p>')).toBeNull();
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

  it('routes to the relay when active, else to primary — evaluated per call', async () => {
    const primary = stubSender('primary');
    const relay = stubSender('relay');
    let active = false;
    const router = createRoutingGraphSender(primary, relay, () => active);

    const a = await router.createThread({ teamId: 't', channelId: CH, subject: 's', html: 'x' });
    expect(a.threadRootId).toBe('primary');

    active = true;
    const b = await router.createThread({ teamId: 't', channelId: CH, subject: 's', html: 'x' });
    expect(b.threadRootId).toBe('relay');

    expect(primary.created).toBe(1);
    expect(relay.created).toBe(1);
  });

  it('always delegates listChannels to primary when present', async () => {
    const primary: GraphSender = {
      createThread: async () => ({ threadRootId: 'p', webUrl: 'p' }),
      replyToThread: async () => ({ messageId: 'p' }),
      listChannels: vi.fn(async () => [{ id: 'c1', displayName: 'C1' }]),
    };
    const relay = stubSender('relay');
    const router = createRoutingGraphSender(primary, relay, () => true);

    expect(router.listChannels).toBeDefined();
    const chans = await router.listChannels!('team');
    expect(chans).toEqual([{ id: 'c1', displayName: 'C1' }]);
    expect(primary.listChannels).toHaveBeenCalledWith('team');
  });
});
