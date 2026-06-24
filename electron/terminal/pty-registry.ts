// Persisted PTY PID registry.
//
// node-pty children (the shell + the copilot CLI it launches) are NOT reaped
// automatically when their parent dies on Windows, and an ungraceful Electron
// exit (Task Manager kill, crash, OS shutdown) skips the graceful
// `before-quit` → `killAllPtyProcesses()` path entirely. Those survivors hold
// per-session locks and collide when the session is reopened.
//
// To reap them deterministically we persist every spawned PTY root PID to disk.
// On the next launch the main process reads this file and force-kills any PID
// (and its process tree) that is still alive AND whose OS process-creation time
// still matches the one we recorded, then prunes it. This is the single source
// of truth — it does not depend on `wmic` (removed from modern Windows) and does
// not rely on matching an env-var tag against a command line (env vars never
// appear in a process command line).
//
// PID-reuse safety: between a crash and the next reap the OS may recycle a dead
// PTY's PID onto an unrelated process. We therefore validate process identity by
// comparing the live process's creation time against the recorded `startedAt`
// before killing — a recycled PID always has a creation time strictly later than
// our original spawn, so it is skipped. See `processIdentityMatches`.

import { execSync } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface PtyRecord {
  pid: number;
  agentId: string;
  sessionId: string;
  /** `Date.now()` captured immediately after the PTY was spawned. */
  startedAt: number;
}

/**
 * Allowed gap (ms) between our recorded `startedAt` and the live process's OS
 * creation time. Our `startedAt` is sampled synchronously right after spawn, so
 * the real creation time is at most a few hundred ms earlier. A recycled PID's
 * process always starts strictly *after* our PTY died (which is after
 * `startedAt`), so a tight window reliably distinguishes "still ours" from
 * "PID was reused".
 */
const START_TIME_GRACE_MS = 2000;

const DEFAULT_REGISTRY_FILE = path.join(process.cwd(), '.data', 'pty-pids.json');

/** Default on-disk registry location: `.data/pty-pids.json` under the cwd. */
export function defaultRegistryFile(): string {
  return DEFAULT_REGISTRY_FILE;
}

/** Read all records. Tolerant of a missing or malformed file — returns []. */
export function readPtyRegistry(file: string = DEFAULT_REGISTRY_FILE): PtyRecord[] {
  try {
    const raw = fs.readFileSync(file, 'utf8');
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (r): r is PtyRecord =>
        !!r && typeof r.pid === 'number' && Number.isFinite(r.pid),
    );
  } catch {
    return [];
  }
}

/** Atomically overwrite the registry. Never throws — best-effort persistence. */
function writePtyRegistry(records: PtyRecord[], file: string = DEFAULT_REGISTRY_FILE): void {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    // Unique temp name so a write from another process (or a reap running
    // alongside a spawn) cannot clobber our temp file before the rename.
    const tmp = `${file}.${process.pid}.${crypto.randomBytes(4).toString('hex')}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(records, null, 2));
    fs.renameSync(tmp, file);
  } catch {
    // Persistence is best-effort; a failure here must never break PTY spawn/exit.
  }
}

/** Record a freshly spawned PTY root PID (upsert by pid). Never throws. */
export function registerPty(record: PtyRecord, file: string = DEFAULT_REGISTRY_FILE): void {
  const records = readPtyRegistry(file).filter((r) => r.pid !== record.pid);
  records.push(record);
  writePtyRegistry(records, file);
}

/** Remove a PID from the registry once its PTY has exited/been killed. Never throws. */
export function unregisterPty(pid: number, file: string = DEFAULT_REGISTRY_FILE): void {
  const records = readPtyRegistry(file);
  const next = records.filter((r) => r.pid !== pid);
  if (next.length !== records.length) {
    writePtyRegistry(next, file);
  }
}

/** Truncate the registry to empty. Never throws. */
export function resetPtyRegistry(file: string = DEFAULT_REGISTRY_FILE): void {
  writePtyRegistry([], file);
}

/** True if a PID is currently alive (and signalable, or alive-but-EPERM). */
function isPidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException)?.code === 'EPERM';
  }
}

/**
 * Best-effort read of a process's OS creation time in epoch ms, or null if it
 * cannot be determined (process gone, query failed). Platform-aware.
 */
function processStartTimeMs(pid: number): number | null {
  try {
    if (os.platform() === 'win32') {
      const cmd =
        `powershell -NoProfile -NonInteractive -Command ` +
        `"$p = Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}'; ` +
        `if ($p) { [DateTimeOffset]::new($p.CreationDate).ToUnixTimeMilliseconds() }"`;
      const out = execSync(cmd, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      const ms = parseInt(out, 10);
      return Number.isFinite(ms) ? ms : null;
    }
    // Unix: lstart gives a human date we can parse to ms.
    const out = execSync(`ps -o lstart= -p ${pid}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    if (!out) return null;
    const ms = Date.parse(out);
    return Number.isNaN(ms) ? null : ms;
  } catch {
    return null;
  }
}

/**
 * Confirm the live process at `record.pid` is still the PTY we spawned, by
 * checking its OS creation time has not drifted past our recorded `startedAt`.
 * If the creation time cannot be read, we conservatively report NO match (do
 * not kill) — better to leak an orphan than to kill an unrelated process.
 */
function processIdentityMatches(
  record: PtyRecord,
  startTimeOf: (pid: number) => number | null,
): boolean {
  const startMs = startTimeOf(record.pid);
  if (startMs == null) return false;
  // Recycled PIDs start strictly after our PTY died (> startedAt). Allow a small
  // grace for clock/sampling skew on the "still ours" side.
  return startMs <= record.startedAt + START_TIME_GRACE_MS;
}

/** Force-kill a PID and its entire process tree. Returns true on apparent success. */
function killTree(pid: number): boolean {
  try {
    if (os.platform() === 'win32') {
      execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' });
    } else {
      // node-pty's forkpty() makes the child a session/process-group leader, so
      // the negative PID targets the whole group (shell + copilot CLI). Fall
      // back to the bare PID if the group send fails.
      try {
        process.kill(-pid, 'SIGKILL');
      } catch {
        process.kill(pid, 'SIGKILL');
      }
    }
    return true;
  } catch {
    // Already dead, or insufficient permissions.
    return false;
  }
}

export interface ReapOptions {
  file?: string;
  /** Override for tests. Defaults to {@link isPidAlive}. */
  isAlive?: (pid: number) => boolean;
  /** Override for tests. Defaults to {@link killTree}. Returns success. */
  kill?: (pid: number) => boolean;
  /** Override for tests. Defaults to {@link processStartTimeMs}. */
  startTimeOf?: (pid: number) => number | null;
  /** Pids that must never be killed (e.g. the live server/main process). */
  protectedPids?: number[];
}

export interface ReapResult {
  /** PIDs we force-killed. */
  reaped: number[];
  /** PIDs we left alone (dead, recycled, protected, or unverifiable). */
  skipped: number[];
  /** PIDs we tried to kill but couldn't (kept in the registry for a retry). */
  failed: number[];
}

/**
 * Reap orphaned PTY process trees recorded by a previous run. A record is
 * killed only when its PID is alive, not protected, and its process identity
 * still matches (creation time). Dead/recycled/protected/killed records are
 * pruned; records whose kill failed are retained for a future retry.
 */
export function reapRegisteredPtys(options: ReapOptions = {}): ReapResult {
  const file = options.file ?? DEFAULT_REGISTRY_FILE;
  const isAlive = options.isAlive ?? isPidAlive;
  const kill = options.kill ?? killTree;
  const startTimeOf = options.startTimeOf ?? processStartTimeMs;
  const protectedPids = new Set([process.pid, ...(options.protectedPids ?? [])]);

  const records = readPtyRegistry(file);
  const reaped: number[] = [];
  const skipped: number[] = [];
  const failed: number[] = [];
  const survivors: PtyRecord[] = [];

  for (const record of records) {
    const { pid } = record;
    if (protectedPids.has(pid) || !isAlive(pid)) {
      skipped.push(pid); // protected or already dead — prune
      continue;
    }
    if (!processIdentityMatches(record, startTimeOf)) {
      skipped.push(pid); // PID reused by an unrelated process — never kill, prune
      continue;
    }
    if (kill(pid)) {
      reaped.push(pid); // killed — prune
    } else {
      failed.push(pid); // couldn't kill — keep for next time
      survivors.push(record);
    }
  }

  writePtyRegistry(survivors, file);
  return { reaped, skipped, failed };
}
