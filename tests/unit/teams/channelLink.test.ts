import { describe, expect, it } from 'vitest';
import { parseChannelLink } from '../../../electron/teams/channelLink';

const REAL_LINK =
  'https://teams.microsoft.com/l/channel/19%3A0123456789abcdef0123456789abcdef%40thread.tacv2/Agent%20Hub?groupId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&tenantId=00000000-0000-0000-0000-000000000000';

describe('parseChannelLink', () => {
  it('parses a real Teams channel deep-link', () => {
    const coords = parseChannelLink(REAL_LINK);
    expect(coords).toEqual({
      teamId: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      channelId: '19:0123456789abcdef0123456789abcdef@thread.tacv2',
      tenantId: '00000000-0000-0000-0000-000000000000',
    });
  });

  it('returns null for empty / non-url input', () => {
    expect(parseChannelLink('')).toBeNull();
    expect(parseChannelLink('   ')).toBeNull();
    expect(parseChannelLink('not a url')).toBeNull();
  });

  it('returns null when groupId is missing', () => {
    const url =
      'https://teams.microsoft.com/l/channel/19%3Aabc%40thread.tacv2/Chan?tenantId=t';
    expect(parseChannelLink(url)).toBeNull();
  });

  it('returns null when the channel id is not a channel-shaped id', () => {
    const url = 'https://teams.microsoft.com/l/channel/48%3Anotes/Chan?groupId=g&tenantId=t';
    expect(parseChannelLink(url)).toBeNull();
  });
});
