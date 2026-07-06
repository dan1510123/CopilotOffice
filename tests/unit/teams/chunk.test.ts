import { describe, expect, it } from 'vitest';
import { chunkReply } from '../../../electron/teams/chunk';

describe('chunkReply', () => {
  it('returns a single chunk for short text (no prefix)', () => {
    const out = chunkReply('hello world', 3500);
    expect(out).toEqual(['hello world']);
  });

  it('returns [""] for empty input', () => {
    expect(chunkReply('', 3500)).toEqual(['']);
  });

  it('splits long text into ordered (i/N) chunks that cover the whole input', () => {
    const line = 'x'.repeat(90) + '\n';
    const text = line.repeat(200); // ~18k chars
    const chunks = chunkReply(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => {
      expect(c.startsWith(`(${i + 1}/${chunks.length}) `)).toBe(true);
    });
    // Full delivery: stripping the prefixes reconstructs all original chars.
    const reassembled = chunks.map((c) => c.replace(/^\(\d+\/\d+\) /, '')).join('\n');
    expect(reassembled.replace(/\n/g, '').length).toBe(text.replace(/\n/g, '').length);
  });

  it('hard-splits a single very long line', () => {
    const text = 'y'.repeat(10000);
    const chunks = chunkReply(text, 1000);
    expect(chunks.length).toBeGreaterThan(1);
    const reassembled = chunks.map((c) => c.replace(/^\(\d+\/\d+\) /, '')).join('');
    expect(reassembled.length).toBe(text.length);
  });
});
