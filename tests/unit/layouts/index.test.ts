import { describe, expect, it } from 'vitest';
import { getLayout } from '../../../src/layouts/index';

describe('layouts/index — data-driven LayoutDefinition contract', () => {
  it('exposes both default and fleet-vteam with all required fields', () => {
    for (const id of ['default', 'fleet-vteam'] as const) {
      const layout = getLayout(id);
      expect(layout.agents.length).toBeGreaterThan(0);
      expect(layout.dashboard).toBeDefined();
      expect(layout.dashboard.renderCards).toBeTypeOf('function');
      expect(layout.clickHandler).toBeDefined();
      expect(layout.clickHandler.handleCardClick).toBeTypeOf('function');
      expect(layout.behaviors).toBeDefined();
    }
  });

  it('default layout enables reserve agents + player PC + no architect gating', () => {
    const { behaviors } = getLayout('default');
    expect(behaviors.supportsReserveAgents).toBe(true);
    expect(behaviors.hasPlayerPcTerminal).toBe(true);
    expect(behaviors.restrictsInteractionToArchitect).toBe(false);
    expect(behaviors.supportsFleetExecution).toBe(false);
  });

  it('fleet-vteam layout disables reserve agents + PC, enables architect gating + fleet exec', () => {
    const { behaviors } = getLayout('fleet-vteam');
    expect(behaviors.supportsReserveAgents).toBe(false);
    expect(behaviors.hasPlayerPcTerminal).toBe(false);
    expect(behaviors.restrictsInteractionToArchitect).toBe(true);
    expect(behaviors.supportsFleetExecution).toBe(true);
  });

  it('unknown layout id falls back to default', () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const layout = getLayout('not-a-layout' as any);
    expect(layout.behaviors.hasPlayerPcTerminal).toBe(true);
    expect(layout.behaviors.supportsReserveAgents).toBe(true);
  });

  it('each layout returns the same instance on repeated lookups (no per-call allocation)', () => {
    expect(getLayout('default')).toBe(getLayout('default'));
    expect(getLayout('fleet-vteam')).toBe(getLayout('fleet-vteam'));
  });

  it('the two layouts use disjoint behavior profiles (sanity check)', () => {
    const d = getLayout('default').behaviors;
    const f = getLayout('fleet-vteam').behaviors;
    expect(d.supportsReserveAgents).not.toBe(f.supportsReserveAgents);
    expect(d.hasPlayerPcTerminal).not.toBe(f.hasPlayerPcTerminal);
    expect(d.restrictsInteractionToArchitect).not.toBe(f.restrictsInteractionToArchitect);
    expect(d.supportsFleetExecution).not.toBe(f.supportsFleetExecution);
  });
});
