import { describe, it, expect } from 'vitest';
import { sanitizeTerminalSelection } from '../../../src/ui/terminalSelection';

describe('sanitizeTerminalSelection', () => {
  it('returns empty/undefined-ish input unchanged', () => {
    expect(sanitizeTerminalSelection('')).toBe('');
  });

  it('leaves a normal single line unchanged', () => {
    expect(sanitizeTerminalSelection('npm run build')).toBe('npm run build');
  });

  it('leaves a normal multi-line selection byte-for-byte unchanged', () => {
    const text = 'line one\nconst x = 1;\n  indented\n';
    expect(sanitizeTerminalSelection(text)).toBe(text);
  });

  it('strips a trailing full-block scrollbar glyph and its padding', () => {
    expect(sanitizeTerminalSelection('git status         █')).toBe('git status');
  });

  it('strips a trailing light-vertical scrollbar glyph', () => {
    expect(sanitizeTerminalSelection('echo hello   │')).toBe('echo hello');
  });

  it.each(['\u2502', '\u2503', '\u258C', '\u2590', '\u258F', '\u2595', '\u2591', '\u2592', '\u2593'])(
    'strips trailing scrollbar glyph U+%s',
    (glyph) => {
      expect(sanitizeTerminalSelection(`cmd  ${glyph}`)).toBe('cmd');
    },
  );

  it('strips the scrollbar glyph on each line of a multi-line selection', () => {
    const input = 'first command      █\nsecond command     ▌\nthird              │';
    expect(sanitizeTerminalSelection(input)).toBe('first command\nsecond command\nthird');
  });

  it('only strips the trailing glyph, not glyphs in the middle of a line', () => {
    expect(sanitizeTerminalSelection('a │ b')).toBe('a │ b');
  });

  it('does not strip ordinary punctuation at the end of a line', () => {
    expect(sanitizeTerminalSelection('let x = arr[i];')).toBe('let x = arr[i];');
    expect(sanitizeTerminalSelection('echo "done"')).toBe('echo "done"');
  });

  it('preserves CRLF line endings while stripping the glyph', () => {
    expect(sanitizeTerminalSelection('cmd one   █\r\ncmd two   │\r\n')).toBe('cmd one\r\ncmd two\r\n');
  });

  it('preserves a lone trailing glyph with no padding gap (likely real content)', () => {
    expect(sanitizeTerminalSelection('tightcontent█')).toBe('tightcontent█');
  });

  it('strips a tight (no-padding) trailing glyph when a cross-line scrollbar signal is present', () => {
    // Thumb row abuts content, but the surrounding lines establish a right-edge bar.
    const input = 'first line       │\nthumbcontenthere█\nthird line       │';
    expect(sanitizeTerminalSelection(input)).toBe('first line\nthumbcontenthere\nthird line');
  });

  it('does not strip a single isolated content line ending in a block glyph', () => {
    expect(sanitizeTerminalSelection('progress 100% ████')).toBe('progress 100% ████');
  });

  it('does not strip a tight content glyph when candidate lines are only a 50/50 tie (not a majority)', () => {
    const input = 'left ok   │\nvalue█\nplain\nplain2';
    expect(sanitizeTerminalSelection(input)).toBe('left ok\nvalue█\nplain\nplain2');
  });

  it('does not corrupt a box-drawing table (single-space border, no scrollbar gap)', () => {
    const table = '│ key │\n│ val │';
    expect(sanitizeTerminalSelection(table)).toBe(table);
  });

  it('preserves a trailing newline', () => {
    expect(sanitizeTerminalSelection('hello\n')).toBe('hello\n');
  });

  it('reduces a line that is only padding + glyph to empty', () => {
    expect(sanitizeTerminalSelection('     █')).toBe('');
  });
});
