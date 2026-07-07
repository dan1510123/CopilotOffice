import { describe, expect, it, vi } from 'vitest';
import {
  allowedChannelIdSet,
  createAllowlistedGraphSender,
  officeChannelOverridesFromJson,
  createCachedAllowedChannels,
} from '../../../electron/teams/channelAllowlist';
import type { GraphSender } from '../../../electron/teams/graphClient';

// Deep-links whose channelId path segment is `19:aaa@thread.tacv2` / `19:bbb@thread.tacv2`.
const URL_A = 'https://teams.microsoft.com/l/channel/19%3Aaaa%40thread.tacv2/A?groupId=team-a&tenantId=tn';
const URL_B = 'https://teams.microsoft.com/l/channel/19%3Abbb%40thread.tacv2/B?groupId=team-b&tenantId=tn';
const CH_A = '19:aaa@thread.tacv2';
const CH_B = '19:bbb@thread.tacv2';
const CH_FOREIGN = '19:zzz@thread.tacv2';

describe('allowedChannelIdSet', () => {
  it('collects channelIds from the default + override URLs', () => {
    const set = allowedChannelIdSet(URL_A, [URL_B]);
    expect([...set].sort()).toEqual([CH_A, CH_B].sort());
  });

  it('skips empty/unparseable URLs', () => {
    const set = allowedChannelIdSet('', ['   ', 'not-a-teams-link', URL_A]);
    expect([...set]).toEqual([CH_A]);
  });

  it('returns an empty set when nothing is configured', () => {
    expect(allowedChannelIdSet('', []).size).toBe(0);
    expect(allowedChannelIdSet(null, [null, undefined]).size).toBe(0);
  });
});

describe('officeChannelOverridesFromJson', () => {
  it('extracts non-empty teamsChannelUrl values', () => {
    const json = JSON.stringify({
      offices: [
        { id: 'office-0', teamsChannelUrl: URL_A },
        { id: 'office-1' },
        { id: 'office-2', teamsChannelUrl: '   ' },
        { id: 'office-3', teamsChannelUrl: URL_B },
      ],
    });
    expect(officeChannelOverridesFromJson(json)).toEqual([URL_A, URL_B]);
  });

  it('returns [] on null/invalid/misshaped input', () => {
    expect(officeChannelOverridesFromJson(null)).toEqual([]);
    expect(officeChannelOverridesFromJson('{bad json')).toEqual([]);
    expect(officeChannelOverridesFromJson('{}')).toEqual([]);
  });
});

describe('createAllowlistedGraphSender', () => {
  function makeInner() {
    const inner: GraphSender = {
      createThread: vi.fn(async () => ({ threadRootId: 'root-1', webUrl: 'https://web' })),
      replyToThread: vi.fn(async () => ({ messageId: 'm-1' })),
      listChannels: vi.fn(async () => [{ id: 'x', displayName: 'X' }]),
    };
    return inner;
  }

  it('allows sends to channels in the allowlist', async () => {
    const inner = makeInner();
    const g = createAllowlistedGraphSender(inner, () => new Set([CH_A]));
    await expect(g.createThread({ teamId: 't', channelId: CH_A, subject: 's', html: 'h' })).resolves.toBeTruthy();
    await expect(g.replyToThread({ teamId: 't', channelId: CH_A, threadRootId: 'r', html: 'h' })).resolves.toBeTruthy();
    expect(inner.createThread).toHaveBeenCalledOnce();
    expect(inner.replyToThread).toHaveBeenCalledOnce();
  });

  it('blocks createThread + replyToThread to channels not in the allowlist', async () => {
    const inner = makeInner();
    const g = createAllowlistedGraphSender(inner, () => new Set([CH_A]));
    await expect(
      g.createThread({ teamId: 't', channelId: CH_FOREIGN, subject: 's', html: 'h' }),
    ).rejects.toThrow(/not in the settings\/overrides allowlist/i);
    await expect(
      g.replyToThread({ teamId: 't', channelId: CH_FOREIGN, threadRootId: 'r', html: 'h' }),
    ).rejects.toThrow(/allowlist/i);
    expect(inner.createThread).not.toHaveBeenCalled();
    expect(inner.replyToThread).not.toHaveBeenCalled();
  });

  it('re-evaluates the allowlist per call (config changes take effect immediately)', async () => {
    const inner = makeInner();
    let allowed = new Set<string>([CH_A]);
    const g = createAllowlistedGraphSender(inner, () => allowed);
    await expect(g.replyToThread({ teamId: 't', channelId: CH_B, threadRootId: 'r', html: 'h' })).rejects.toThrow();
    allowed = new Set([CH_A, CH_B]);
    await expect(g.replyToThread({ teamId: 't', channelId: CH_B, threadRootId: 'r', html: 'h' })).resolves.toBeTruthy();
  });

  it('passes through the optional listChannels capability (no channel target to gate)', async () => {
    const inner = makeInner();
    const g = createAllowlistedGraphSender(inner, () => new Set());
    await expect(g.listChannels!('team-1')).resolves.toEqual([{ id: 'x', displayName: 'X' }]);
  });
});

describe('createCachedAllowedChannels', () => {
  it('computes once within the TTL, then refreshes after it', () => {
    let t = 1000;
    const compute = vi.fn(() => new Set([CH_A]));
    const get = createCachedAllowedChannels(compute, 2000, () => t);

    expect([...get()]).toEqual([CH_A]); // first call computes
    expect([...get()]).toEqual([CH_A]); // cached
    expect(compute).toHaveBeenCalledOnce();

    t += 2500; // past TTL
    get();
    expect(compute).toHaveBeenCalledTimes(2);
  });

  it('reflects config changes on the next refresh', () => {
    let t = 0;
    let current = new Set([CH_A]);
    const get = createCachedAllowedChannels(() => current, 1000, () => t);
    expect(get().has(CH_A)).toBe(true);
    current = new Set([CH_B]); // channel A removed from config
    t += 1500;
    expect(get().has(CH_A)).toBe(false);
    expect(get().has(CH_B)).toBe(true);
  });

  it('retains the last known-good set if compute throws (no false block)', () => {
    let t = 0;
    let mode: 'ok' | 'throw' = 'ok';
    const get = createCachedAllowedChannels(
      () => {
        if (mode === 'throw') throw new Error('transient read error');
        return new Set([CH_A]);
      },
      1000,
      () => t,
    );
    expect(get().has(CH_A)).toBe(true); // seed a good set
    mode = 'throw';
    t += 1500; // TTL expired → recompute throws
    expect(get().has(CH_A)).toBe(true); // retained, not collapsed to empty
  });

  it('fails closed (empty set) if the very first compute throws', () => {
    const get = createCachedAllowedChannels(() => {
      throw new Error('read error');
    });
    expect(get().size).toBe(0);
  });
});
