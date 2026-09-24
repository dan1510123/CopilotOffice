import fs from 'fs';
import path from 'path';

export function toAbsoluteWorkingDir(requested: string, baseDir = process.cwd()): string {
  return path.isAbsolute(requested) ? path.normalize(requested) : path.resolve(baseDir, requested);
}

export async function resolveAccessibleWorkingDir(
  requested: string | undefined,
  baseDir = process.cwd(),
): Promise<string> {
  if (!requested) return baseDir;
  const resolved = toAbsoluteWorkingDir(requested, baseDir);
  try {
    await fs.promises.access(resolved, fs.constants.F_OK);
  } catch {
    throw new Error(`Working directory is not accessible: "${requested}" (resolved="${resolved}")`);
  }
  return resolved;
}
