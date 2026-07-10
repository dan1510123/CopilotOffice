import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfficeManager } from '../../../src/office/officeManager';
import { resolveStatusKey } from '../../../src/config/agentStatusPresentation';

// Spec 014 reliability regressions:
//  - FR-006: office-switch freshness (no stale cross-office snapshot).
//  - FR-005: session interruption resolves to a defined terminal state
//            (slacking / error) with no residual in-progress key on any surface.
//
// These assert at the officeManager + resolveStatusKey seam because that is the
// single source every surface (badge / dashboards / notifications) reads from.

describe('office/status freshness on office switch (FR-006)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('keeps per-office agent status isolated and current after switching away and back', () => {
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();
    const officeA = manager.currentOfficeId!;
    const officeB = manager.createOffice('Branch', '.').config.id;

    // Same agent id is busy in A (thinking) and idle-done in B.
    manager.setAgentThinking(officeA, 'generalist', 'Processing...');
    manager.switchOffice(officeB);
    manager.setAgentDonePendingAck(officeB, 'generalist', 'turn_end');

    // Switch back to A: its snapshot must still read thinking (not leaked from B).
    manager.switchOffice(officeA);
    const a = manager.getAgentStatus(officeA, 'generalist');
    expect(resolveStatusKey(a)).toBe('thinking');

    // And B still independently reads done.
    const b = manager.getAgentStatus(officeB, 'generalist');
    expect(resolveStatusKey(b)).toBe('done');
  });

  it('reflects a status change made while an office was not current', () => {
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();
    const officeA = manager.currentOfficeId!;
    const officeB = manager.createOffice('Branch', '.').config.id;

    manager.setAgentThinking(officeA, 'debugger', 'Processing...');
    manager.switchOffice(officeB);

    // Mutate A while B is current — switching back must show the fresh value.
    manager.setAgentReady(officeA, 'debugger');
    manager.switchOffice(officeA);
    expect(resolveStatusKey(manager.getAgentStatus(officeA, 'debugger'))).toBe('ready');
  });
});

describe('office/session interruption resolves to a defined state (FR-005)', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('an active (thinking) agent whose session closes resolves to slacking with no in-progress residue', () => {
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();
    const officeId = manager.currentOfficeId!;

    manager.setAgentThinking(officeId, 'generalist', 'edit');
    expect(resolveStatusKey(manager.getAgentStatus(officeId, 'generalist'))).toBe('thinking');

    // Session closed (main.ts setAgentSlacking path).
    manager.setAgentSlacking(officeId, 'generalist');

    const status = manager.getAgentStatus(officeId, 'generalist');
    expect(resolveStatusKey(status)).toBe('slacking');
    expect(status?.subState).not.toBe('thinking');
    expect(status?.thinkingDetail).toBeNull();
    expect(status?.currentTool).toBeNull();
  });

  it('an active agent whose session errors resolves to error with no in-progress residue', () => {
    // thinking -> error is not a declared transition; it only warns, still applies.
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();
    const officeId = manager.currentOfficeId!;

    manager.setAgentThinking(officeId, 'admin', 'grep');
    manager.setAgentError(officeId, 'admin', 'Session crashed');

    const status = manager.getAgentStatus(officeId, 'admin');
    expect(resolveStatusKey(status)).toBe('error');
    expect(status?.subState).toBe('error');
    warnSpy.mockRestore();
  });

  it('a done-pending-ack agent whose session closes drops the done badge (resolves to slacking)', () => {
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();
    const officeId = manager.currentOfficeId!;

    manager.setAgentDonePendingAck(officeId, 'generalist', 'turn_end');
    expect(resolveStatusKey(manager.getAgentStatus(officeId, 'generalist'))).toBe('done');

    manager.setAgentSlacking(officeId, 'generalist');
    const status = manager.getAgentStatus(officeId, 'generalist');
    expect(resolveStatusKey(status)).toBe('slacking');
    expect(status?.completionPendingAck).toBe(false);
  });
});
