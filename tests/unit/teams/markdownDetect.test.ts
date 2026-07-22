import { describe, expect, it } from 'vitest';
import {
  AUTO_RENDER_MIN_CHARS,
  hasBlockStructure,
  hasExistingImageSentinel,
  shouldAutoRenderMarkdown,
} from '../../../electron/teams/markdownDetect';

// Spec 018 FR-002 truth table — see contracts/markdown-detection.md.
// The detector is a pure module; these tests fully cover the block-structure
// heuristic, the length gate, and the existing-sentinel guard.

/** Pad `core` with plain prose so the whole string exceeds AUTO_RENDER_MIN_CHARS. */
function longWith(core: string): string {
  const filler = 'The quick brown fox jumps over the lazy dog. '.repeat(40); // > 1000 chars
  return `${core}\n\n${filler}`;
}

describe('markdownDetect — constant', () => {
  it('pins AUTO_RENDER_MIN_CHARS to 1000 (FR-002)', () => {
    expect(AUTO_RENDER_MIN_CHARS).toBe(1000);
  });
});

describe('hasBlockStructure — positive block constructs', () => {
  it('detects a fenced code block (```)', () => {
    expect(hasBlockStructure('```js\nconst x = 1;\n```')).toBe(true);
  });

  it('detects a fenced code block (~~~)', () => {
    expect(hasBlockStructure('~~~\nplain\n~~~')).toBe(true);
  });

  it('detects a pipe table (row + delimiter)', () => {
    expect(hasBlockStructure('| A | B |\n| --- | --- |\n| 1 | 2 |')).toBe(true);
  });

  it('detects a pipe table with alignment colons', () => {
    expect(hasBlockStructure('| A | B |\n|:---|---:|\n| 1 | 2 |')).toBe(true);
  });

  it('detects an ATX heading', () => {
    expect(hasBlockStructure('# Title\nsome text')).toBe(true);
    expect(hasBlockStructure('###### h6\ntext')).toBe(true);
  });

  it('detects a setext heading (= underline)', () => {
    expect(hasBlockStructure('Title\n=====\nbody')).toBe(true);
  });

  it('detects a setext heading (- underline)', () => {
    expect(hasBlockStructure('Title\n-----\nbody')).toBe(true);
  });

  it('detects a blockquote', () => {
    expect(hasBlockStructure('> quoted line\nmore')).toBe(true);
  });

  it('detects a >=2-item unordered list', () => {
    expect(hasBlockStructure('- one\n- two')).toBe(true);
    expect(hasBlockStructure('* one\n* two')).toBe(true);
    expect(hasBlockStructure('+ one\n+ two')).toBe(true);
  });

  it('detects a >=2-item ordered list', () => {
    expect(hasBlockStructure('1. one\n2. two')).toBe(true);
    expect(hasBlockStructure('1) one\n2) two')).toBe(true);
  });
});

describe('hasBlockStructure — negatives (must NOT count)', () => {
  it('inline-only bold/italic/code does not count', () => {
    expect(hasBlockStructure('This is **bold** and *italic* and `code` inline.')).toBe(false);
    expect(hasBlockStructure('An _emphasized_ word only.')).toBe(false);
  });

  it('a stray # / * / - / > in prose does not count', () => {
    expect(hasBlockStructure('the C# language is nice')).toBe(false);
    expect(hasBlockStructure('compute a * b for the product')).toBe(false);
    expect(hasBlockStructure('the result is 5 - 3 = 2')).toBe(false);
    expect(hasBlockStructure('he said > that to me')).toBe(false);
  });

  it('an ATX-looking #tag (no space) does not count', () => {
    expect(hasBlockStructure('#tag is trending')).toBe(false);
  });

  it('a single list item does not count', () => {
    expect(hasBlockStructure('- only one bullet')).toBe(false);
    expect(hasBlockStructure('1. only one item')).toBe(false);
  });

  it('a pipe row without a delimiter row does not count', () => {
    expect(hasBlockStructure('| A | B |\n| 1 | 2 |')).toBe(false);
  });

  it('empty / whitespace-only does not count', () => {
    expect(hasBlockStructure('')).toBe(false);
    expect(hasBlockStructure('   \n\t\n')).toBe(false);
  });
});

describe('shouldAutoRenderMarkdown — structure AND length gate', () => {
  it('true for a long reply (>1000) with a table', () => {
    const text = longWith('| A | B |\n| --- | --- |\n| 1 | 2 |');
    expect(text.length).toBeGreaterThan(AUTO_RENDER_MIN_CHARS);
    expect(shouldAutoRenderMarkdown(text)).toBe(true);
  });

  it('true for a long reply (>1000) with a fenced code block', () => {
    expect(shouldAutoRenderMarkdown(longWith('```\ncode\nmore\n```'))).toBe(true);
  });

  it('true for a long reply (>1000) with a >=2-item list', () => {
    expect(shouldAutoRenderMarkdown(longWith('- one\n- two\n- three'))).toBe(true);
  });

  it('false for a short (<=1000) structured reply', () => {
    const short = '| A | B |\n| --- | --- |\n| 1 | 2 |';
    expect(short.length).toBeLessThanOrEqual(AUTO_RENDER_MIN_CHARS);
    expect(shouldAutoRenderMarkdown(short)).toBe(false);
  });

  it('false for a long (>1000) pure-prose reply with no block structure', () => {
    const prose = 'plain prose. '.repeat(120); // > 1000 chars, no structure
    expect(prose.length).toBeGreaterThan(AUTO_RENDER_MIN_CHARS);
    expect(shouldAutoRenderMarkdown(prose)).toBe(false);
  });

  it('false for a long reply with only a stray marker', () => {
    expect(shouldAutoRenderMarkdown(longWith('the C# language and a * b'))).toBe(false);
  });

  it('false for empty', () => {
    expect(shouldAutoRenderMarkdown('')).toBe(false);
  });
});

describe('hasExistingImageSentinel — FR-009 guard', () => {
  it('true for a valid non-empty office-image sentinel', () => {
    expect(hasExistingImageSentinel('here <!--office-image:.office-images/x.png--> done')).toBe(true);
  });

  it('false for an empty-path sentinel', () => {
    expect(hasExistingImageSentinel('<!--office-image:-->')).toBe(false);
  });

  it('false when there is no sentinel', () => {
    expect(hasExistingImageSentinel('just some markdown # heading')).toBe(false);
  });
});
