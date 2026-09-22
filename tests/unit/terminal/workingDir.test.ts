import os from 'os';
import path from 'path';
import { describe, expect, it } from 'vitest';
import { resolveAccessibleWorkingDir, toAbsoluteWorkingDir } from '../../../electron/terminal/working-dir';

describe('terminal working-directory resolution', () => {
  it('preserves absolute Windows paths instead of joining them to the app cwd', () => {
    const requested = 'D:\\repos\\sample-repo';
    expect(toAbsoluteWorkingDir(requested, 'C:\\repos\\CopilotOffice')).toBe(path.normalize(requested));
  });

  it('resolves relative paths from the supplied base directory', () => {
    expect(toAbsoluteWorkingDir('projects\\demo', 'C:\\work')).toBe(path.resolve('C:\\work', 'projects\\demo'));
  });

  it('returns the base directory when no explicit directory is requested', async () => {
    await expect(resolveAccessibleWorkingDir(undefined, os.tmpdir())).resolves.toBe(os.tmpdir());
  });

  it('rejects an inaccessible explicit directory instead of silently falling back', async () => {
    const missing = path.join(os.tmpdir(), `copilot-office-missing-${Date.now()}`);
    await expect(resolveAccessibleWorkingDir(missing)).rejects.toThrow(/not accessible/i);
  });
});
