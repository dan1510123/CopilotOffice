import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import {
  type PtyRecord,
  readPtyRegistry,
  registerPty,
  unregisterPty,
  resetPtyRegistry,
  reapRegisteredPtys,
} from '../../../electron/terminal/pty-registry';

const START = 1_000_000;

function rec(pid: number, agentId = 'gene', startedAt = START): PtyRecord {
  return { pid, agentId, sessionId: `sess-${pid}`, startedAt };
}

/** Identity helper: process started exactly when we recorded it (still ours). */
const matchingStartTime = (startedAt = START) => () => startedAt;

describe('electron/terminal/pty-registry', () => {
  let dir: string;
  let file: string;

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pty-reg-'));
    file = path.join(dir, 'pty-pids.json');
  });

  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  describe('read/register/unregister', () => {
    it('returns [] for a missing file', () => {
      expect(readPtyRegistry(file)).toEqual([]);
    });

    it('returns [] for a malformed file (never throws)', () => {
      fs.writeFileSync(file, '{ not valid json');
      expect(readPtyRegistry(file)).toEqual([]);
    });

    it('returns [] when the JSON is not an array', () => {
      fs.writeFileSync(file, JSON.stringify({ pid: 1 }));
      expect(readPtyRegistry(file)).toEqual([]);
    });

    it('filters out records without a finite numeric pid', () => {
      fs.writeFileSync(
        file,
        JSON.stringify([rec(123), { agentId: 'x' }, { pid: 'nope' }, null]),
      );
      const records = readPtyRegistry(file);
      expect(records).toHaveLength(1);
      expect(records[0].pid).toBe(123);
    });

    it('registers a record and persists it', () => {
      registerPty(rec(111), file);
      const records = readPtyRegistry(file);
      expect(records).toHaveLength(1);
      expect(records[0]).toMatchObject({ pid: 111, agentId: 'gene', sessionId: 'sess-111' });
    });

    it('upserts by pid rather than duplicating', () => {
      registerPty(rec(111, 'gene'), file);
      registerPty(rec(111, 'dan'), file);
      const records = readPtyRegistry(file);
      expect(records).toHaveLength(1);
      expect(records[0].agentId).toBe('dan');
    });

    it('keeps multiple distinct pids', () => {
      registerPty(rec(1), file);
      registerPty(rec(2), file);
      expect(readPtyRegistry(file).map((r) => r.pid).sort()).toEqual([1, 2]);
    });

    it('unregisters a pid', () => {
      registerPty(rec(1), file);
      registerPty(rec(2), file);
      unregisterPty(1, file);
      expect(readPtyRegistry(file).map((r) => r.pid)).toEqual([2]);
    });

    it('unregister of a missing pid is a no-op', () => {
      registerPty(rec(1), file);
      unregisterPty(999, file);
      expect(readPtyRegistry(file).map((r) => r.pid)).toEqual([1]);
    });

    it('resetPtyRegistry truncates to empty', () => {
      registerPty(rec(1), file);
      resetPtyRegistry(file);
      expect(readPtyRegistry(file)).toEqual([]);
    });

    it('writes valid JSON that round-trips', () => {
      registerPty(rec(1), file);
      const raw = fs.readFileSync(file, 'utf8');
      expect(() => JSON.parse(raw)).not.toThrow();
    });
  });

  describe('reapRegisteredPtys', () => {
    it('kills only alive, identity-matched pids and prunes the rest', () => {
      registerPty(rec(1), file);
      registerPty(rec(2), file);
      registerPty(rec(3), file);
      const killed: number[] = [];

      const result = reapRegisteredPtys({
        file,
        isAlive: (pid) => pid !== 2, // pid 2 already dead
        startTimeOf: matchingStartTime(),
        kill: (pid) => {
          killed.push(pid);
          return true;
        },
      });

      expect(killed.sort()).toEqual([1, 3]);
      expect(result.reaped.sort()).toEqual([1, 3]);
      expect(result.skipped).toEqual([2]);
      expect(result.failed).toEqual([]);
      expect(readPtyRegistry(file)).toEqual([]);
    });

    it('does NOT kill a recycled PID (creation time later than startedAt)', () => {
      registerPty(rec(7, 'gene', START), file);
      const killed: number[] = [];

      const result = reapRegisteredPtys({
        file,
        isAlive: () => true,
        // Live process started well after we recorded it → PID was reused.
        startTimeOf: () => START + 60_000,
        kill: (pid) => {
          killed.push(pid);
          return true;
        },
      });

      expect(killed).toEqual([]);
      expect(result.reaped).toEqual([]);
      expect(result.skipped).toEqual([7]);
      expect(readPtyRegistry(file)).toEqual([]); // recycled record is pruned
    });

    it('kills when creation time is within the grace window', () => {
      registerPty(rec(8, 'gene', START), file);
      const killed: number[] = [];
      reapRegisteredPtys({
        file,
        isAlive: () => true,
        startTimeOf: () => START + 1_000, // within START_TIME_GRACE_MS
        kill: (pid) => {
          killed.push(pid);
          return true;
        },
      });
      expect(killed).toEqual([8]);
    });

    it('does NOT kill when creation time is unverifiable (null)', () => {
      registerPty(rec(9), file);
      const killed: number[] = [];
      const result = reapRegisteredPtys({
        file,
        isAlive: () => true,
        startTimeOf: () => null,
        kill: (pid) => {
          killed.push(pid);
          return true;
        },
      });
      expect(killed).toEqual([]);
      expect(result.skipped).toEqual([9]);
    });

    it('retains records whose kill failed for a future retry', () => {
      registerPty(rec(5), file);
      const result = reapRegisteredPtys({
        file,
        isAlive: () => true,
        startTimeOf: matchingStartTime(),
        kill: () => false, // EPERM etc.
      });
      expect(result.failed).toEqual([5]);
      expect(result.reaped).toEqual([]);
      expect(readPtyRegistry(file).map((r) => r.pid)).toEqual([5]);
    });

    it('never kills protected pids (e.g. the live process)', () => {
      registerPty(rec(process.pid), file);
      registerPty(rec(42), file);
      const killed: number[] = [];

      const result = reapRegisteredPtys({
        file,
        isAlive: () => true,
        startTimeOf: matchingStartTime(),
        kill: (pid) => {
          killed.push(pid);
          return true;
        },
        protectedPids: [42],
      });

      expect(killed).toEqual([]);
      expect(result.skipped.sort((a, b) => a - b)).toEqual(
        [42, process.pid].sort((a, b) => a - b),
      );
    });

    it('on an empty/missing registry reaps nothing', () => {
      const result = reapRegisteredPtys({ file, isAlive: () => true, kill: () => true });
      expect(result.reaped).toEqual([]);
      expect(result.skipped).toEqual([]);
      expect(result.failed).toEqual([]);
    });
  });

  describe('default isAlive (real process probe)', () => {
    it('treats the current (protected) process as alive and skips it', () => {
      // process.pid is always protected, so it is skipped (not killed) — this
      // exercises the real default isPidAlive against a known-live PID.
      registerPty(rec(process.pid), file);
      const killed: number[] = [];
      const result = reapRegisteredPtys({
        file,
        startTimeOf: matchingStartTime(),
        kill: (pid) => {
          killed.push(pid);
          return true;
        },
      });
      expect(killed).toEqual([]);
      expect(result.skipped).toEqual([process.pid]);
    });

    it('treats a since-exited PID as dead', () => {
      // Spawn a trivial process and read its pid after it has exited.
      const r = spawnSync(process.execPath, ['-e', 'process.exit(0)']);
      const deadPid = r.pid!;
      registerPty(rec(deadPid), file);
      const killed: number[] = [];
      const result = reapRegisteredPtys({
        file,
        startTimeOf: matchingStartTime(),
        kill: (pid) => {
          killed.push(pid);
          return true;
        },
      });
      expect(killed).toEqual([]);
      expect(result.skipped).toEqual([deadPid]);
    });
  });
});
