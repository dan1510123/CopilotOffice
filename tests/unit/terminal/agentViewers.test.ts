import { describe, expect, it } from 'vitest';
import {
  addAgentViewer,
  hasActiveViewer,
  removeAgentViewer,
  type ViewerMaps,
} from '../../../electron/terminal/agent-viewers';

function makeMaps(): ViewerMaps {
  return {
    activeAgentViewers: new Set<string>(),
    agentToTerminal: new Map<string, string>(),
  };
}

describe('electron/terminal/agent-viewers — dual-key invariant (R-002)', () => {
  it('addAgentViewer marks only the ck when there is no alias', () => {
    const maps = makeMaps();

    const result = addAgentViewer('office-0:architect', maps);

    expect(result.aliasKey).toBeNull();
    expect(maps.activeAgentViewers.has('office-0:architect')).toBe(true);
    expect(maps.activeAgentViewers.size).toBe(1);
  });

  it('addAgentViewer mirrors onto the original terminal key for transferred sessions', () => {
    const maps = makeMaps();
    // Simulate a transferred session: the fleet office key aliases the source PTY key.
    maps.agentToTerminal.set('office-fleet-001:architect', 'office-0:architect');

    const result = addAgentViewer('office-fleet-001:architect', maps);

    expect(result.aliasKey).toBe('office-0:architect');
    expect(maps.activeAgentViewers.has('office-fleet-001:architect')).toBe(true);
    // CRITICAL: the original key must also be active so PTY/event closures
    // captured against the source composite key continue forwarding payloads.
    expect(maps.activeAgentViewers.has('office-0:architect')).toBe(true);
  });

  it('addAgentViewer does not double-mark when ck === terminal key', () => {
    const maps = makeMaps();
    // Self-referential alias (shouldn't happen in practice, but be defensive).
    maps.agentToTerminal.set('office-0:architect', 'office-0:architect');

    const result = addAgentViewer('office-0:architect', maps);

    expect(result.aliasKey).toBeNull();
    expect(maps.activeAgentViewers.size).toBe(1);
  });

  it('removeAgentViewer removes both keys for transferred sessions', () => {
    const maps = makeMaps();
    maps.agentToTerminal.set('office-fleet-001:architect', 'office-0:architect');
    addAgentViewer('office-fleet-001:architect', maps);

    const result = removeAgentViewer('office-fleet-001:architect', maps);

    expect(result.aliasKey).toBe('office-0:architect');
    expect(maps.activeAgentViewers.has('office-fleet-001:architect')).toBe(false);
    expect(maps.activeAgentViewers.has('office-0:architect')).toBe(false);
  });

  it('removeAgentViewer is a no-op for keys without an alias mapping', () => {
    const maps = makeMaps();
    addAgentViewer('office-0:architect', maps);

    const result = removeAgentViewer('office-0:architect', maps);

    expect(result.aliasKey).toBeNull();
    expect(maps.activeAgentViewers.size).toBe(0);
  });

  it('hasActiveViewer returns true via direct registration', () => {
    const maps = makeMaps();
    addAgentViewer('office-0:architect', maps);

    expect(hasActiveViewer('office-0:architect', maps)).toBe(true);
  });

  it('hasActiveViewer returns true via alias forward lookup', () => {
    const maps = makeMaps();
    // Source PTY key has no direct viewer, but a fleet-aliased key does.
    maps.agentToTerminal.set('office-fleet-001:architect', 'office-0:architect');
    // Only the alias key is in activeAgentViewers (simulates the BUG scenario
    // before the dual-key fix). The forward lookup must still find it.
    maps.activeAgentViewers.add('office-fleet-001:architect');

    expect(hasActiveViewer('office-0:architect', maps)).toBe(true);
  });

  it('hasActiveViewer returns false when no viewers and no alias points to ck', () => {
    const maps = makeMaps();
    maps.agentToTerminal.set('office-fleet-001:architect', 'office-0:architect');
    // No active viewers anywhere.
    expect(hasActiveViewer('office-0:architect', maps)).toBe(false);
    expect(hasActiveViewer('office-fleet-001:architect', maps)).toBe(false);
  });

  it('attach + detach round-trip leaves both keys clean (transferred session)', () => {
    const maps = makeMaps();
    maps.agentToTerminal.set('office-fleet-001:architect', 'office-0:architect');

    addAgentViewer('office-fleet-001:architect', maps);
    expect(hasActiveViewer('office-0:architect', maps)).toBe(true);

    removeAgentViewer('office-fleet-001:architect', maps);
    expect(maps.activeAgentViewers.size).toBe(0);
    expect(hasActiveViewer('office-0:architect', maps)).toBe(false);
  });
});
