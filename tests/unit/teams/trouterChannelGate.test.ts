import { describe, expect, it } from 'vitest';
import { passesChannelGate } from '../../../electron/teams/trouterClient';

const CH_A = '19:aaa@thread.tacv2';
const CH_B = '19:bbb@thread.tacv2';

describe('passesChannelGate (Trouter firehose channel gate)', () => {
  it('stays open before initialization (setChannels never called)', () => {
    // Avoids black-holing real traffic if the gate is unwired.
    expect(passesChannelGate(CH_A, new Set(), false)).toBe(true);
    expect(passesChannelGate(CH_B, new Set([CH_A]), false)).toBe(true);
  });

  it('drops every channel once initialized with an empty active set', () => {
    // No online agent → nothing is routable → nothing should surface/log.
    expect(passesChannelGate(CH_A, new Set(), true)).toBe(false);
  });

  it('passes only channels with an online agent once initialized', () => {
    const active = new Set([CH_A]);
    expect(passesChannelGate(CH_A, active, true)).toBe(true);
    expect(passesChannelGate(CH_B, active, true)).toBe(false);
  });
});
