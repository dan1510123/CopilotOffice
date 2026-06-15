import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOfficeFileStore } from '../../../electron/officeFileStore';

describe('electron/officeFileStore', () => {
  let tmpRoot: string;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'office-store-'));
  });

  afterEach(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('exposes an absolute filePath under {cwd}/{dataSubdir}/{fileName}', () => {
    const store = createOfficeFileStore({ cwd: tmpRoot, dataSubdir: '.data', fileName: 'x.json' });
    expect(store.filePath).toBe(path.join(tmpRoot, '.data', 'x.json'));
  });

  it('load() returns { success: true, data: null } when the file does not exist', () => {
    const store = createOfficeFileStore({ cwd: tmpRoot });
    const result = store.load();
    expect(result).toEqual({ success: true, data: null });
  });

  it('save() then load() round-trips arbitrary JSON', () => {
    const store = createOfficeFileStore({ cwd: tmpRoot });
    const payload = JSON.stringify({ currentOfficeId: 'office-0', offices: [{ id: 'office-0' }] });
    const saveResult = store.save(payload);
    expect(saveResult).toEqual({ success: true });

    const loadResult = store.load();
    expect(loadResult.success).toBe(true);
    expect(loadResult.data).toBe(payload);
  });

  it('save() creates the data directory if it does not exist', () => {
    const store = createOfficeFileStore({ cwd: tmpRoot, dataSubdir: 'nested/path/.data' });
    expect(fs.existsSync(path.dirname(store.filePath))).toBe(false);

    const result = store.save('{}');
    expect(result.success).toBe(true);
    expect(fs.existsSync(store.filePath)).toBe(true);
  });

  it('load() returns { success: false, error } on filesystem error', () => {
    const store = createOfficeFileStore({ cwd: tmpRoot });
    // Create a directory at the file path so reading it throws EISDIR.
    fs.mkdirSync(path.dirname(store.filePath), { recursive: true });
    fs.mkdirSync(store.filePath);

    const result = store.load();
    expect(result.success).toBe(false);
    expect(result.data).toBeNull();
    expect(result.error).toBeTruthy();
  });

  it('uses defaults when no options are passed', () => {
    const store = createOfficeFileStore();
    // Path uses process.cwd(); just assert structural shape.
    expect(store.filePath.endsWith(path.join('.data', 'copilot-offices.json'))).toBe(true);
  });
});
