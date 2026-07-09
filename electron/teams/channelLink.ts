// T004 — Parse a Teams channel deep-link URL into { teamId, channelId, tenantId }.
//
// Example deep-link:
//   https://teams.microsoft.com/l/channel/19%3A0123456789abcdef0123456789abcdef%40thread.tacv2/
//     Agent%20Hub?groupId=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&tenantId=00000000-...
//
// The channel id sits in the path segment after `/l/channel/` (URL-encoded, `%3A`→`:`,
// `%40`→`@`); the team id is the `groupId` query param and the tenant is `tenantId`.

import type { ChannelCoords } from './types';

export function parseChannelLink(url: string): ChannelCoords | null {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;

  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return null;
  }

  const teamId = (parsed.searchParams.get('groupId') || '').trim();
  const tenantId = (parsed.searchParams.get('tenantId') || '').trim();

  // Channel id is the path segment following `/l/channel/`.
  const marker = '/l/channel/';
  const idx = parsed.pathname.indexOf(marker);
  let channelId = '';
  if (idx >= 0) {
    const rest = parsed.pathname.slice(idx + marker.length);
    const seg = rest.split('/')[0] || '';
    try {
      channelId = decodeURIComponent(seg).trim();
    } catch {
      channelId = seg.trim();
    }
  }

  if (!teamId || !channelId) return null;
  // Channel ids look like `19:...@thread.tacv2`.
  if (!/^19:.+@thread\./.test(channelId)) return null;

  return { teamId, channelId, tenantId };
}
