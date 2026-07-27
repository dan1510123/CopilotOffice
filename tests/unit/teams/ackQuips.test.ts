import { describe, expect, it } from 'vitest';
import {
  ACK_QUIPS,
  ORCHESTRATOR_ACK_QUIPS,
  pickAckQuip,
  pickOrchestratorAckQuip,
} from '../../../electron/teams/ackQuips';

describe('ackQuips', () => {
  it('has separate non-empty quip lists', () => {
    expect(ACK_QUIPS.length).toBeGreaterThan(0);
    for (const q of ACK_QUIPS) expect(q.trim().length).toBeGreaterThan(0);
    expect(ORCHESTRATOR_ACK_QUIPS.length).toBeGreaterThan(0);
    for (const q of ORCHESTRATOR_ACK_QUIPS) expect(q.trim().length).toBeGreaterThan(0);
    expect(ORCHESTRATOR_ACK_QUIPS.some((q) => ACK_QUIPS.includes(q))).toBe(false);
  });

  it('picks normal agent quips from the normal list', () => {
    // First quip (rng → 0) and last quip (rng → just under 1).
    expect(pickAckQuip(() => 0)).toBe(ACK_QUIPS[0]);
    expect(pickAckQuip(() => 0.999999)).toBe(ACK_QUIPS[ACK_QUIPS.length - 1]);
  });

  it('picks orchestrator quips from the orchestrator list', () => {
    expect(pickOrchestratorAckQuip(() => 0)).toBe(ORCHESTRATOR_ACK_QUIPS[0]);
    expect(pickOrchestratorAckQuip(() => 0.999999)).toBe(
      ORCHESTRATOR_ACK_QUIPS[ORCHESTRATOR_ACK_QUIPS.length - 1],
    );
  });

  it('always returns a member of the selected list', () => {
    for (let i = 0; i < 50; i++) {
      expect(ACK_QUIPS).toContain(pickAckQuip());
      expect(ORCHESTRATOR_ACK_QUIPS).toContain(pickOrchestratorAckQuip());
    }
  });
});
