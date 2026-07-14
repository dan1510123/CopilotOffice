// Continuous `.data` backups — pure-Node module (no electron import) so it can
// be unit-tested and reused by the `restore-data` CLI.
//
// Concept: every time the app opens and closes, the entire `.data/` directory is
// snapshotted into a sibling `.data-backup-<timestamp>-<reason>/` folder. Backups
// older than a retention window (default 30 days) are pruned. A companion CLI
// (`npm run restore-data`) lists these snapshots and restores a chosen version.
//
// The `.data-backup-*/` naming matches the pattern already reserved in
// `.gitignore`, so user data snapshots are never committed.

import * as fs from 'fs';
import * as path from 'path';

export type BackupReason = 'open' | 'close' | 'prerestore' | 'manual';

/** Directory prefix for every snapshot. Kept in sync with `.gitignore`. */
export const BACKUP_PREFIX = '.data-backup-';

const DEFAULT_DATA_SUBDIR = '.data';
const DEFAULT_RETENTION_DAYS = 30;

export interface BackupOptions {
  /** Root under which `.data` and the `.data-backup-*` folders live. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Relative data dir name. Defaults to `.data`. */
  dataSubdir?: string;
  /** Injectable clock for deterministic tests. Defaults to `new Date()`. */
  now?: Date;
}

export interface BackupInfo {
  /** Folder name, e.g. `.data-backup-20260714-095442-close`. */
  name: string;
  /** Absolute path to the snapshot folder. */
  path: string;
  /** Reason parsed from the folder name, if recognizable. */
  reason: string;
  /** Snapshot creation time (from the folder mtime). */
  createdAt: Date;
}

/** Format a Date as `YYYYMMDD-HHmmss` in local time. */
export function formatBackupTimestamp(d: Date): string {
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

function resolvePaths(options: BackupOptions) {
  const cwd = options.cwd ?? process.cwd();
  const dataDir = path.join(cwd, options.dataSubdir ?? DEFAULT_DATA_SUBDIR);
  return { cwd, dataDir };
}

/** True when the directory exists and holds at least one entry. */
function hasContent(dir: string): boolean {
  try {
    return fs.existsSync(dir) && fs.readdirSync(dir).length > 0;
  } catch {
    return false;
  }
}

/**
 * Snapshot the `.data` directory into `.data-backup-<timestamp>-<reason>`.
 * Best-effort and non-throwing: returns the created backup path, or `null` when
 * there is nothing to back up or the copy failed.
 */
export function backupDataDir(reason: BackupReason, options: BackupOptions = {}): string | null {
  const { cwd, dataDir } = resolvePaths(options);
  try {
    if (!hasContent(dataDir)) return null;
    const stamp = formatBackupTimestamp(options.now ?? new Date());
    let dest = path.join(cwd, `${BACKUP_PREFIX}${stamp}-${reason}`);
    // Guard against same-second collisions (open+close in <1s, or repeated calls).
    let suffix = 1;
    while (fs.existsSync(dest)) {
      dest = path.join(cwd, `${BACKUP_PREFIX}${stamp}-${reason}-${suffix++}`);
    }
    fs.cpSync(dataDir, dest, { recursive: true });
    return dest;
  } catch (e) {
    console.error('[DataBackup] Failed to create backup:', e);
    return null;
  }
}

/** List every `.data-backup-*` snapshot, newest first. */
export function listBackups(options: BackupOptions = {}): BackupInfo[] {
  const { cwd } = resolvePaths(options);
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(cwd, { withFileTypes: true });
  } catch {
    return [];
  }
  const backups: BackupInfo[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(BACKUP_PREFIX)) continue;
    const full = path.join(cwd, entry.name);
    let createdAt = new Date(0);
    try {
      createdAt = fs.statSync(full).mtime;
    } catch {
      /* keep epoch fallback */
    }
    const rest = entry.name.slice(BACKUP_PREFIX.length);
    const reason = rest.split('-').slice(2).join('-') || 'unknown';
    backups.push({ name: entry.name, path: full, reason, createdAt });
  }
  return backups.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

/**
 * Delete snapshots older than `maxAgeDays` (default 30). Best-effort and
 * non-throwing. Returns the folder names that were removed.
 */
export function pruneOldBackups(
  options: BackupOptions & { maxAgeDays?: number } = {},
): string[] {
  const maxAgeDays = options.maxAgeDays ?? DEFAULT_RETENTION_DAYS;
  const cutoff = (options.now ?? new Date()).getTime() - maxAgeDays * 24 * 60 * 60 * 1000;
  const removed: string[] = [];
  for (const b of listBackups(options)) {
    if (b.createdAt.getTime() >= cutoff) continue;
    try {
      fs.rmSync(b.path, { recursive: true, force: true });
      removed.push(b.name);
    } catch (e) {
      console.error(`[DataBackup] Failed to prune ${b.name}:`, e);
    }
  }
  return removed;
}

/**
 * Restore a named snapshot into `.data`. The current `.data` is first snapshotted
 * as a `prerestore` backup so the operation is reversible, then replaced with the
 * chosen snapshot's contents. Throws on failure so the CLI can surface the error.
 */
export function restoreDataBackup(
  name: string,
  options: BackupOptions = {},
): { restoredFrom: string; safetyBackup: string | null } {
  const { cwd, dataDir } = resolvePaths(options);
  const src = path.join(cwd, name);
  if (!name.startsWith(BACKUP_PREFIX) || !fs.existsSync(src) || !fs.statSync(src).isDirectory()) {
    throw new Error(`Backup not found: ${name}`);
  }
  // Full copy of the current `.data` first, so the restore is reversible.
  const safetyBackup = backupDataDir('prerestore', options);
  // Restore is done in two phases so a failed copy can never leave `.data`
  // destroyed: stage the snapshot into a temp dir, then swap it in. On any
  // failure we roll the previous `.data` back and rethrow.
  const staging = path.join(cwd, `.data-restore-tmp-${Date.now()}`);
  const previous = path.join(cwd, `.data-restore-old-${Date.now()}`);
  try {
    fs.rmSync(staging, { recursive: true, force: true });
    fs.cpSync(src, staging, { recursive: true });
    if (fs.existsSync(dataDir)) fs.renameSync(dataDir, previous);
    fs.renameSync(staging, dataDir);
  } catch (e) {
    // Roll back: if the swap left `.data` missing but the old copy survives, put it back.
    try {
      if (!fs.existsSync(dataDir) && fs.existsSync(previous)) {
        fs.renameSync(previous, dataDir);
      }
    } catch {
      /* previous also failed — the safety backup below is the recovery path */
    }
    fs.rmSync(staging, { recursive: true, force: true });
    const hint = safetyBackup ? ` (previous data preserved at ${path.basename(safetyBackup)})` : '';
    throw new Error(`Restore failed${hint}: ${e instanceof Error ? e.message : String(e)}`);
  }
  // Restore succeeded — clean up the swapped-out copy best-effort. A failure here
  // (e.g. transient file lock) must NOT be reported as a restore failure.
  try {
    fs.rmSync(previous, { recursive: true, force: true });
  } catch {
    /* orphaned previous dir is harmless; ignore */
  }
  return { restoredFrom: src, safetyBackup };
}

/**
 * Convenience used by the app lifecycle: create a snapshot for `reason` and prune
 * expired ones in a single best-effort call. Logs a concise summary.
 */
export function runLifecycleBackup(reason: BackupReason, options: BackupOptions = {}): string | null {
  const created = backupDataDir(reason, options);
  if (created) {
    console.log(`[DataBackup] Snapshot on ${reason}: ${path.basename(created)}`);
  }
  const removed = pruneOldBackups(options);
  if (removed.length > 0) {
    console.log(`[DataBackup] Pruned ${removed.length} backup(s) older than ${DEFAULT_RETENTION_DAYS} days`);
  }
  return created;
}
