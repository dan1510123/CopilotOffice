import { describe, expect, it } from 'vitest';
import {
  createNoopPersistencePort,
  deserializeOffices,
  serializeOffices,
} from '../../../src/office/officePersistence';
import type { OfficeConfig } from '../../../src/office/officeManager';

const baseOffice: OfficeConfig = {
  id: 'office-0',
  name: 'Main Office',
  workingDirectory: '.',
  createdAt: 100,
  layout: 'default',
  seatedAgents: [{ deskId: 'desk-a', agentId: 'generalist' }],
};

describe('office/officePersistence.serializeOffices', () => {
  it('produces pretty-printed JSON with currentOfficeId + offices', () => {
    const json = serializeOffices({ currentOfficeId: 'office-0', offices: [baseOffice] });
    const parsed = JSON.parse(json);
    expect(parsed.currentOfficeId).toBe('office-0');
    expect(parsed.offices).toHaveLength(1);
    expect(parsed.offices[0].name).toBe('Main Office');
    // Pretty-printed for human diffability
    expect(json).toContain('\n');
  });
});

describe('office/officePersistence.deserializeOffices', () => {
  it('returns an empty state for null / empty input', () => {
    expect(deserializeOffices(null)).toEqual({ currentOfficeId: null, offices: [] });
    expect(deserializeOffices('')).toEqual({ currentOfficeId: null, offices: [] });
  });

  it('returns an empty state for malformed JSON instead of throwing', () => {
    expect(deserializeOffices('{not json')).toEqual({ currentOfficeId: null, offices: [] });
    expect(deserializeOffices('null')).toEqual({ currentOfficeId: null, offices: [] });
    expect(deserializeOffices('42')).toEqual({ currentOfficeId: null, offices: [] });
  });

  it('round-trips a current payload without loss', () => {
    const json = serializeOffices({ currentOfficeId: 'office-0', offices: [baseOffice] });
    const restored = deserializeOffices(json);
    expect(restored.currentOfficeId).toBe('office-0');
    expect(restored.offices).toHaveLength(1);
    expect(restored.offices[0]).toMatchObject(baseOffice);
  });

  it('reindexes ids from array position (legacy UUID ids dropped)', () => {
    const legacy = JSON.stringify({
      currentOfficeId: 'uuid-xyz',
      offices: [
        { id: 'uuid-xyz', name: 'Legacy A', workingDirectory: '.', createdAt: 1 },
        { id: 'uuid-abc', name: 'Legacy B', workingDirectory: '.', createdAt: 2 },
      ],
    });
    const restored = deserializeOffices(legacy);
    expect(restored.offices.map((o) => o.id)).toEqual(['office-0', 'office-1']);
    // currentOfficeId did not match any reindexed id → falls back to first office
    expect(restored.currentOfficeId).toBe('office-0');
  });

  it('preserves stored office-N ids with a gap (post-deletion) instead of reindexing', () => {
    // After deleting office-3, the durable config keeps stable ids 0,1,2,4.
    // Reindexing to 0,1,2,3 would remap office-4 onto office-3's session-history
    // file and orphan its real history — the bug this guards against.
    const afterDelete = JSON.stringify({
      currentOfficeId: 'office-4',
      offices: [
        { id: 'office-0', name: 'Main', workingDirectory: '.', createdAt: 1, layout: 'default', seatedAgents: [] },
        { id: 'office-1', name: 'GMM', workingDirectory: '.', createdAt: 2, layout: 'default', seatedAgents: [] },
        { id: 'office-2', name: 'AIQB', workingDirectory: '.', createdAt: 3, layout: 'default', seatedAgents: [] },
        { id: 'office-4', name: 'Teams', workingDirectory: '.', createdAt: 4, layout: 'default', seatedAgents: [] },
      ],
    });
    const restored = deserializeOffices(afterDelete);
    expect(restored.offices.map((o) => o.id)).toEqual(['office-0', 'office-1', 'office-2', 'office-4']);
    expect(restored.offices.map((o) => o.name)).toEqual(['Main', 'GMM', 'AIQB', 'Teams']);
    expect(restored.currentOfficeId).toBe('office-4');
  });

  it('reindexes when a stored id is not in the office-N scheme', () => {
    // Mixed/legacy ids → positional migration still applies.
    const mixed = JSON.stringify({
      currentOfficeId: 'office-0',
      offices: [
        { id: 'office-0', name: 'A', workingDirectory: '.', createdAt: 1 },
        { id: 'weird-id', name: 'B', workingDirectory: '.', createdAt: 2 },
      ],
    });
    const restored = deserializeOffices(mixed);
    expect(restored.offices.map((o) => o.id)).toEqual(['office-0', 'office-1']);
  });

  it('reindexes when stored office-N ids contain a duplicate', () => {
    const dup = JSON.stringify({
      currentOfficeId: 'office-1',
      offices: [
        { id: 'office-1', name: 'A', workingDirectory: '.', createdAt: 1 },
        { id: 'office-1', name: 'B', workingDirectory: '.', createdAt: 2 },
      ],
    });
    const restored = deserializeOffices(dup);
    expect(restored.offices.map((o) => o.id)).toEqual(['office-0', 'office-1']);
  });

  it('backfills missing layout and seatedAgents on legacy payloads', () => {
    const legacy = JSON.stringify({
      currentOfficeId: null,
      offices: [{ id: 'x', name: 'L', workingDirectory: '.', createdAt: 1 }],
    });
    const restored = deserializeOffices(legacy);
    expect(restored.offices[0].layout).toBe('default');
    expect(restored.offices[0].seatedAgents).toEqual([]);
  });

  it('drops the legacy `index` field and other unknown keys', () => {
    const legacy = JSON.stringify({
      currentOfficeId: 'office-0',
      offices: [
        { id: 'x', index: 7, name: 'L', workingDirectory: '.', createdAt: 1, layout: 'default', seatedAgents: [] },
      ],
    });
    const restored = deserializeOffices(legacy);
    expect((restored.offices[0] as Record<string, unknown>).index).toBeUndefined();
  });

  it('preserves customAgents / customReserveAgents verbatim', () => {
    const custom = JSON.stringify({
      currentOfficeId: 'office-0',
      offices: [
        {
          id: 'office-0',
          name: 'X',
          workingDirectory: '.',
          createdAt: 1,
          layout: 'default',
          seatedAgents: [],
          customAgents: [{ id: 'custom-a' }],
          customReserveAgents: { foo: { id: 'foo' } },
        },
      ],
    });
    const restored = deserializeOffices(custom);
    expect((restored.offices[0] as Record<string, unknown>).customAgents).toEqual([{ id: 'custom-a' }]);
    expect((restored.offices[0] as Record<string, unknown>).customReserveAgents).toEqual({
      foo: { id: 'foo' },
    });
  });

  it('coerces invalid layout strings to "default"', () => {
    const bad = JSON.stringify({
      currentOfficeId: 'office-0',
      offices: [{ id: 'x', name: 'L', workingDirectory: '.', createdAt: 1, layout: 'not-a-layout' }],
    });
    expect(deserializeOffices(bad).offices[0].layout).toBe('default');
  });

  it('honors a valid fleet-vteam layout', () => {
    const fleet = JSON.stringify({
      currentOfficeId: 'office-0',
      offices: [{ id: 'x', name: 'F', workingDirectory: '.', createdAt: 1, layout: 'fleet-vteam' }],
    });
    expect(deserializeOffices(fleet).offices[0].layout).toBe('fleet-vteam');
  });

  it('filters malformed seatedAgents entries', () => {
    const mixed = JSON.stringify({
      currentOfficeId: 'office-0',
      offices: [
        {
          id: 'x',
          name: 'L',
          workingDirectory: '.',
          createdAt: 1,
          seatedAgents: [
            { deskId: 'd1', agentId: 'gene' },
            { deskId: 'no-agent' },
            null,
            'string',
            { deskId: 'd2', agentId: 'dan' },
          ],
        },
      ],
    });
    const restored = deserializeOffices(mixed);
    expect(restored.offices[0].seatedAgents).toEqual([
      { deskId: 'd1', agentId: 'gene' },
      { deskId: 'd2', agentId: 'dan' },
    ]);
  });

  it('falls back to office-0 when currentOfficeId references a missing office', () => {
    const mismatch = JSON.stringify({
      currentOfficeId: 'office-999',
      offices: [{ id: 'whatever', name: 'L', workingDirectory: '.', createdAt: 1 }],
    });
    expect(deserializeOffices(mismatch).currentOfficeId).toBe('office-0');
  });
});

describe('office/officePersistence.createNoopPersistencePort', () => {
  it('returns a port whose methods resolve without side effects', async () => {
    const port = createNoopPersistencePort();
    await expect(port.loadDurable()).resolves.toBeNull();
    await expect(port.saveDurable('{}')).resolves.toBeUndefined();
    await expect(port.createOfficeSession('office-0')).resolves.toBeUndefined();
    await expect(port.deleteOfficeSession('office-0')).resolves.toBeUndefined();
  });
});
