import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  BACKUP_PREFIX,
  backupDataDir,
  formatBackupTimestamp,
  listBackups,
  pruneOldBackups,
  restoreDataBackup,
} from '../../../electron/dataBackup';

describe('electron/dataBackup', () => {
  let tmpRoot: string;
  let dataDir: string;

  const seedData = (contents: Record<string, string>) => {
    fs.mkdirSync(dataDir, { recursive: true });
    for (const [name, value] of Object.entries(contents)) {
      fs.writeFileSync(path.join(dataDir, name), value, 'utf8');
    }
  };

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'data-backup-'));
    dataDir = path.join(tmpRoot, '.data');
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('formatBackupTimestamp produces a zero-padded YYYYMMDD-HHmmss string', () => {
    const stamp = formatBackupTimestamp(new Date(2026, 6, 14, 9, 5, 3));
    expect(stamp).toBe('20260714-090503');
  });

  it('backupDataDir copies the whole .data directory into a reason-tagged snapshot', () => {
    seedData({ 'a.json': '{"x":1}', 'b.txt': 'hello' });
    const dest = backupDataDir('open', { cwd: tmpRoot, now: new Date(2026, 6, 14, 9, 5, 3) });
    expect(dest).toBe(path.join(tmpRoot, `${BACKUP_PREFIX}20260714-090503-open`));
    expect(fs.readFileSync(path.join(dest!, 'a.json'), 'utf8')).toBe('{"x":1}');
    expect(fs.readFileSync(path.join(dest!, 'b.txt'), 'utf8')).toBe('hello');
  });

  it('backupDataDir returns null when .data is missing or empty', () => {
    expect(backupDataDir('open', { cwd: tmpRoot })).toBeNull();
    fs.mkdirSync(dataDir, { recursive: true });
    expect(backupDataDir('close', { cwd: tmpRoot })).toBeNull();
  });

  it('backupDataDir avoids clobbering an existing same-second snapshot', () => {
    seedData({ 'a.json': '1' });
    const now = new Date(2026, 6, 14, 9, 5, 3);
    const first = backupDataDir('open', { cwd: tmpRoot, now });
    const second = backupDataDir('open', { cwd: tmpRoot, now });
    expect(first).not.toBe(second);
    expect(fs.existsSync(first!)).toBe(true);
    expect(fs.existsSync(second!)).toBe(true);
  });

  it('listBackups returns snapshots newest first with parsed reasons', () => {
    seedData({ 'a.json': '1' });
    const older = backupDataDir('open', { cwd: tmpRoot, now: new Date(2026, 6, 14, 8, 0, 0) })!;
    const newer = backupDataDir('close', { cwd: tmpRoot, now: new Date(2026, 6, 14, 9, 0, 0) })!;
    // Force mtimes so ordering is deterministic regardless of FS timing.
    fs.utimesSync(older, new Date(2026, 6, 14, 8, 0, 0), new Date(2026, 6, 14, 8, 0, 0));
    fs.utimesSync(newer, new Date(2026, 6, 14, 9, 0, 0), new Date(2026, 6, 14, 9, 0, 0));
    const list = listBackups({ cwd: tmpRoot });
    expect(list).toHaveLength(2);
    expect(list[0].name).toBe(path.basename(newer));
    expect(list[0].reason).toBe('close');
    expect(list[1].reason).toBe('open');
  });

  it('pruneOldBackups removes snapshots older than the retention window and keeps fresh ones', () => {
    seedData({ 'a.json': '1' });
    const fresh = backupDataDir('open', { cwd: tmpRoot, now: new Date(2026, 6, 14, 9, 0, 0) })!;
    const stale = backupDataDir('close', { cwd: tmpRoot, now: new Date(2026, 4, 1, 9, 0, 0) })!;
    const staleTime = new Date(2026, 4, 1, 9, 0, 0);
    fs.utimesSync(stale, staleTime, staleTime);

    const removed = pruneOldBackups({ cwd: tmpRoot, maxAgeDays: 30, now: new Date(2026, 6, 14, 9, 0, 0) });
    expect(removed).toContain(path.basename(stale));
    expect(fs.existsSync(stale)).toBe(false);
    expect(fs.existsSync(fresh)).toBe(true);
  });

  it('restoreDataBackup replaces .data and snapshots the previous state first', () => {
    seedData({ 'a.json': 'v1' });
    const snapshot = backupDataDir('open', { cwd: tmpRoot, now: new Date(2026, 6, 14, 9, 0, 0) })!;

    // Mutate .data after the snapshot was taken.
    fs.writeFileSync(path.join(dataDir, 'a.json'), 'v2-current', 'utf8');
    fs.writeFileSync(path.join(dataDir, 'c.json'), 'new-file', 'utf8');

    const result = restoreDataBackup(path.basename(snapshot), {
      cwd: tmpRoot,
      now: new Date(2026, 6, 14, 9, 5, 0),
    });

    expect(fs.readFileSync(path.join(dataDir, 'a.json'), 'utf8')).toBe('v1');
    // The file added after the snapshot is gone after restore.
    expect(fs.existsSync(path.join(dataDir, 'c.json'))).toBe(false);
    // A safety backup of the pre-restore state was created and still holds v2.
    expect(result.safetyBackup).not.toBeNull();
    expect(fs.readFileSync(path.join(result.safetyBackup!, 'a.json'), 'utf8')).toBe('v2-current');
  });

  it('restoreDataBackup throws on an unknown backup name', () => {
    expect(() => restoreDataBackup('.data-backup-nope', { cwd: tmpRoot })).toThrow(/not found/i);
  });
});
