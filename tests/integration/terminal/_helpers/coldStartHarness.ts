// Cold-start test helpers (feature 002, T005).
//
// Lightweight utilities for testing the terminal server's cold-start
// invariants without spinning up a full PTY backend. Test-only — never
// imported from production code.

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

/**
 * Create a temporary `.data/` directory under `os.tmpdir()` for one test.
 * Returns the absolute path of the root tmp directory (so callers can also
 * use it as a fake CWD) plus a `cleanup()` callback.
 */
export function withTempDataDir(prefix: string = 'copilot-cold-start-'): {
  root: string;
  dataDir: string;
  cleanup: () => void;
} {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const dataDir = path.join(root, '.data');
  fs.mkdirSync(dataDir, { recursive: true });
  return {
    root,
    dataDir,
    cleanup: () => {
      fs.rmSync(root, { recursive: true, force: true });
    },
  };
}

/**
 * Minimal mock of the terminal backend used by `electron/terminal/server.ts`.
 * `start()` resolves immediately with a unique pid so the cold-start path can
 * be exercised without spawning real PTYs.
 */
export function mockTerminalBackend(): {
  name: string;
  isAvailable: () => boolean;
  startedSessions: string[];
  start: (opts: { sessionId: string }) => Promise<{
    pid: number;
    write: (data: string) => void;
    resize: (cols: number, rows: number) => void;
    kill: () => void;
    onData: (cb: (chunk: string) => void) => void;
    onExit: (cb: () => void) => void;
  }>;
} {
  const startedSessions: string[] = [];
  let nextPid = 10000;
  return {
    name: 'mock-test-backend',
    isAvailable: () => true,
    startedSessions,
    start: async ({ sessionId }) => {
      startedSessions.push(sessionId);
      return {
        pid: nextPid++,
        write: () => {},
        resize: () => {},
        kill: () => {},
        onData: () => {},
        onExit: () => {},
      };
    },
  };
}

/**
 * Write a pre-populated office sessions JSON file (matches the on-disk format
 * read by `loadOfficeSessionFile`). Useful for seeding the V3 duplicate-repair
 * code path with a forged collision.
 */
export function seedOfficeSessions(
  dataDir: string,
  officeId: string,
  map: Record<string, string>,
): string {
  const filePath = path.join(dataDir, `${officeId}.sessions.json`);
  const payload = {
    current: map,
    history: {},
    metadata: {},
  };
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2));
  return filePath;
}
