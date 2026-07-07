import { describe, expect, it } from 'vitest';
import { ACK_QUIPS, pickAckQuip } from '../../../electron/teams/ackQuips';

describe('ackQuips', () => {
  it('has a non-empty list of quips', () => {
    expect(ACK_QUIPS.length).toBeGreaterThan(0);
    for (const q of ACK_QUIPS) expect(q.trim().length).toBeGreaterThan(0);
  });

  it('picks a quip from the list', () => {
    // First quip (rng → 0) and last quip (rng → just under 1).
    expect(pickAckQuip(() => 0)).toBe(ACK_QUIPS[0]);
    expect(pickAckQuip(() => 0.999999)).toBe(ACK_QUIPS[ACK_QUIPS.length - 1]);
  });

  it('always returns a member of the list', () => {
    for (let i = 0; i < 50; i++) {
      expect(ACK_QUIPS).toContain(pickAckQuip());
    }
  });
});
