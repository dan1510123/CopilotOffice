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
});

