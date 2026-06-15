import { beforeEach, describe, expect, it, vi } from 'vitest';
import { OfficeManager } from '../../../src/office/officeManager';
import { createStoredOfficePayload } from '../../factories/office-factory';

describe('office/officeManager', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('creates a default office when requested', () => {
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();

    expect(manager.currentOfficeId).toBe('office-0');
    expect(manager.getAllOffices()).toHaveLength(1);
  });

  it('generates custom agents for non-primary default offices', () => {
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();

    const office = manager.createOffice('Branch', '.');
    expect(office.config.id).toBe('office-1');
    expect(office.config.customAgents?.length).toBe(4);
    expect(Object.keys(office.config.customReserveAgents || {})).toHaveLength(6);
  });

  it('protects office-0 from deletion', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();

    expect(manager.deleteOffice('office-0')).toBe(false);
    expect(warnSpy).toHaveBeenCalled();
  });

  it('cleans deleted office session mappings and preserves others', () => {
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();
    const office1 = manager.createOffice('One', '.');
    const office2 = manager.createOffice('Two', '.');

    manager.assignSessionToOffice('s1', office1.config.id);
    manager.assignSessionToOffice('s2', office2.config.id);
    manager.switchOffice(office1.config.id);
    expect(manager.deleteOffice(office1.config.id)).toBe(true);

    expect(manager.getOfficeForSession('s1')).toBeUndefined();
    expect(manager.getOfficeForSession('s2')).toBe(office2.config.id);
    expect(manager.currentOfficeId).toBe('office-0');
  });

  it('backfills legacy office payloads with missing layout', () => {
    localStorage.setItem(
      'copilot-offices',
      createStoredOfficePayload([
        {
          id: 'legacy-id',
          name: 'Legacy',
          workingDirectory: '.',
          createdAt: 123,
        },
      ])
    );

    const manager = new OfficeManager();
    const offices = manager.getAllOffices();
    expect(offices[0].id).toBe('office-0');
    expect(offices[0].layout).toBe('default');
    expect(offices[0].seatedAgents).toEqual([]);
  });

  it('warns on invalid status transitions but still applies target state', () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const manager = new OfficeManager();
    manager.ensureDefaultOffice();

    manager.setAgentError('office-0', 'generalist', 'boom');
    const status = manager.getAgentStatus('office-0', 'generalist');

    expect(warnSpy).toHaveBeenCalled();
    expect(status?.subState).toBe('error');
    expect(status?.thinkingDetail).toBe('boom');
  });

  // Spec 008 regression (2026-06-12): if the renderer triggers a save during
  // the gap between sync localStorage hydrate and async durable load, the
  // durable file used to get clobbered with the stale (single-office)
  // localStorage state. Gate must hold durable writes until loadDurable
  // settles. This test simulates: localStorage has 1 office, durable file
  // has 3, a mutation fires before loadDurable resolves.
  it('does not clobber durable file with stale state during boot race', async () => {
    localStorage.setItem(
      'copilot-offices',
      createStoredOfficePayload([
        { id: 'office-0', name: 'Stale', workingDirectory: '.', createdAt: 1 },
      ])
    );

    // Manual port whose loadDurable we control with a deferred Promise.
    let resolveDurable!: (json: string) => void;
    const durablePromise = new Promise<string>((res) => { resolveDurable = res; });
    const savedDurable: string[] = [];
    const port = {
      loadDurable: () => durablePromise.then((v) => v as string | null),
      saveDurable: async (json: string) => { savedDurable.push(json); },
      createOfficeSession: async () => {},
      deleteOfficeSession: async () => {},
    };

    const manager = new OfficeManager(port);

    // BEFORE durable load resolves, trigger a state mutation that calls
    // saveToStorage immediately. createOffice persists; status mutations
    // don't. Without the gate, this would write a stale 2-office JSON to
    // disk (the localStorage-only state plus the new office).
    manager.createOffice('Hot', '.');

    // No durable saves should have happened yet — gate is closed.
    expect(savedDurable, 'durable save fired before loadDurable settled').toEqual([]);

    // Now resolve the durable load with the 3-office payload (the file the
    // user actually has on disk).
    resolveDurable(
      createStoredOfficePayload([
        { id: 'office-0', name: 'Main', workingDirectory: '.', createdAt: 100 },
        { id: 'office-1', name: 'Two', workingDirectory: '.', createdAt: 200 },
        { id: 'office-2', name: 'Three', workingDirectory: '.', createdAt: 300 },
      ])
    );

    // Let the promise chain (and .finally) settle.
    await new Promise((r) => setTimeout(r, 0));
    await new Promise((r) => setTimeout(r, 0));

    // After the gate opens, the pending save should flush with the MERGED
    // post-durable state — i.e., 3 offices, not 1.
    expect(savedDurable.length, 'expected exactly one flushed durable save').toBe(1);
    const flushed = JSON.parse(savedDurable[0]);
    expect(flushed.offices, 'flushed save must include all 3 offices from durable load')
      .toHaveLength(3);
  });
});

