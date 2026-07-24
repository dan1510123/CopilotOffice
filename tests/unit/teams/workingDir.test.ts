import { describe, expect, it } from 'vitest';
import { normalizeWorkingDir } from '../../../electron/teams/workingDir';

describe('normalizeWorkingDir', () => {
  it('strips a single pair of wrapping double quotes (Windows "Copy as path")', () => {
    expect(normalizeWorkingDir('"C:\\Users\\me\\repos\\proj"')).toBe('C:\\Users\\me\\repos\\proj');
  });

  it('strips wrapping single quotes', () => {
    expect(normalizeWorkingDir("'C:\\a\\b'")).toBe('C:\\a\\b');
  });

  it('leaves an unquoted path untouched', () => {
    expect(normalizeWorkingDir('C:\\a\\b')).toBe('C:\\a\\b');
  });

  it('does not strip quotes that only appear mid-string', () => {
    expect(normalizeWorkingDir('C:\\a"b')).toBe('C:\\a"b');
  });

  it('trims surrounding whitespace (outside and inside the quotes)', () => {
    expect(normalizeWorkingDir('  " C:\\a\\b "  ')).toBe('C:\\a\\b');
  });

  it('handles empty / nullish input', () => {
    expect(normalizeWorkingDir('')).toBe('');
    expect(normalizeWorkingDir(undefined as unknown as string)).toBe('');
  });

  it('does not strip a lone unmatched quote', () => {
    expect(normalizeWorkingDir('"C:\\a\\b')).toBe('"C:\\a\\b');
  });
});
