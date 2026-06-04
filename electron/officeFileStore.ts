// Pure-Node file store for the office persistence JSON payload.
//
// Extracted from `electron/main.ts` (S2-F) so the FS path and read/write
// behaviour can be unit-tested without spinning up the electron module. The
// IPC handlers in main.ts use this store; the contract is identical to the
// prior inline implementation (returns `{ success, data? }` shaped results
// that the renderer's `OfficePersistencePort` already understands).
//
// No `electron` import here — this module must remain runnable in plain Node
// so the test environment can exercise it.

import * as fs from 'fs';
import * as path from 'path';

export interface OfficeFileStore {
  /** Read the persisted offices JSON. Returns `{ success: true, data: null }` when no file exists. */
  load(): { success: boolean; data: string | null; error?: string };
  /** Write the persisted offices JSON. Creates the data directory as needed. */
  save(data: string): { success: boolean; error?: string };
  /** Absolute path the store writes to (exposed for diagnostics + tests). */
  readonly filePath: string;
}

export interface CreateOfficeFileStoreOptions {
  /** Root directory under which `.data/copilot-offices.json` lives. Defaults to `process.cwd()`. */
  cwd?: string;
  /** Override the relative path under cwd. Tests pass a temp path; production stays on `.data`. */
  dataSubdir?: string;
  /** Override the file name. Defaults to `copilot-offices.json`. */
  fileName?: string;
}

const DEFAULT_DATA_SUBDIR = '.data';
const DEFAULT_FILE_NAME = 'copilot-offices.json';

export function createOfficeFileStore(options: CreateOfficeFileStoreOptions = {}): OfficeFileStore {
  const cwd = options.cwd ?? process.cwd();
  const dataSubdir = options.dataSubdir ?? DEFAULT_DATA_SUBDIR;
  const fileName = options.fileName ?? DEFAULT_FILE_NAME;
  const dataDir = path.join(cwd, dataSubdir);
  const filePath = path.join(dataDir, fileName);

  return {
    filePath,
    load(): { success: boolean; data: string | null; error?: string } {
      try {
        if (!fs.existsSync(filePath)) return { success: true, data: null };
        const data = fs.readFileSync(filePath, 'utf8');
        return { success: true, data };
      } catch (e: unknown) {
        return { success: false, data: null, error: String(e) };
      }
    },
    save(data: string): { success: boolean; error?: string } {
      try {
        fs.mkdirSync(dataDir, { recursive: true });
        fs.writeFileSync(filePath, data, 'utf8');
        return { success: true };
      } catch (e: unknown) {
        return { success: false, error: String(e) };
      }
    },
  };
}
