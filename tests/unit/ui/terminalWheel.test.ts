import { describe, it, expect } from 'vitest';
import { wheelToPtySequence } from '../../../src/ui/terminalWheel';

const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';

describe('wheelToPtySequence', () => {
  it('returns empty string for zero delta', () => {
    expect(wheelToPtySequence(0)).toBe('');
  });

  it('maps negative deltaY (scroll up) to PageUp', () => {
    expect(wheelToPtySequence(-100)).toBe(PAGE_UP);
  });

  it('maps positive deltaY (scroll down) to PageDown', () => {
    expect(wheelToPtySequence(100)).toBe(PAGE_DOWN);
  });

  it('repeats the sequence per pagesPerNotch', () => {
    expect(wheelToPtySequence(50, { pagesPerNotch: 3 })).toBe(PAGE_DOWN.repeat(3));
    expect(wheelToPtySequence(-50, { pagesPerNotch: 2 })).toBe(PAGE_UP.repeat(2));
  });

  it('clamps pagesPerNotch to at least 1', () => {
    expect(wheelToPtySequence(10, { pagesPerNotch: 0 })).toBe(PAGE_DOWN);
    expect(wheelToPtySequence(10, { pagesPerNotch: -5 })).toBe(PAGE_DOWN);
  });

  it('rounds fractional pagesPerNotch', () => {
    expect(wheelToPtySequence(10, { pagesPerNotch: 2.4 })).toBe(PAGE_DOWN.repeat(2));
  });
});
