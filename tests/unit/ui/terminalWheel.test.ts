import { describe, it, expect } from 'vitest';
import {
  wheelToPtySequence,
  WheelPager,
  normalizeToNotches,
  DEFAULT_NOTCHES_PER_PAGE,
} from '../../../src/ui/terminalWheel';

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

describe('normalizeToNotches', () => {
  it('treats ~100px as one notch (pixel mode)', () => {
    expect(normalizeToNotches(100, 0)).toBe(1);
    expect(normalizeToNotches(-100, 0)).toBe(-1);
  });

  it('treats ~3 lines as one notch (line mode)', () => {
    expect(normalizeToNotches(3, 1)).toBe(1);
  });

  it('treats page mode as already page-granular', () => {
    expect(normalizeToNotches(2, 2)).toBe(2);
  });

  it('defaults to pixel mode when deltaMode omitted', () => {
    expect(normalizeToNotches(100)).toBe(1);
  });
});

describe('WheelPager', () => {
  it('accumulates notches and only emits a page after the threshold', () => {
    const pager = new WheelPager(3);
    expect(pager.feed({ deltaY: 100 })).toBe(''); // 1 notch
    expect(pager.feed({ deltaY: 100 })).toBe(''); // 2 notches
    expect(pager.feed({ deltaY: 100 })).toBe(PAGE_DOWN); // 3 notches -> 1 page
  });

  it('carries the remainder across events', () => {
    const pager = new WheelPager(2);
    expect(pager.feed({ deltaY: 100 })).toBe(''); // acc=1
    expect(pager.feed({ deltaY: 100 })).toBe(PAGE_DOWN); // acc=2 -> page, acc=0
    expect(pager.feed({ deltaY: 100 })).toBe(''); // acc=1
    expect(pager.feed({ deltaY: 100 })).toBe(PAGE_DOWN); // acc=2 -> page
  });

  it('scrolls up with PageUp on negative delta', () => {
    const pager = new WheelPager(1);
    expect(pager.feed({ deltaY: -100 })).toBe(PAGE_UP);
  });

  it('emits multiple pages for a large single delta', () => {
    const pager = new WheelPager(1);
    expect(pager.feed({ deltaY: 300 })).toBe(PAGE_DOWN.repeat(3));
  });

  it('resets the accumulator when direction reverses', () => {
    const pager = new WheelPager(3);
    pager.feed({ deltaY: 100 }); // acc=1 down
    pager.feed({ deltaY: 100 }); // acc=2 down
    // reverse: stale downward accumulation is discarded
    expect(pager.feed({ deltaY: -100 })).toBe(''); // acc reset then -1
    expect(pager.feed({ deltaY: -100 })).toBe(''); // -2
    expect(pager.feed({ deltaY: -100 })).toBe(PAGE_UP); // -3 -> one page up
  });

  it('returns empty for zero delta', () => {
    const pager = new WheelPager();
    expect(pager.feed({ deltaY: 0 })).toBe('');
  });

  it('clamps a sub-1 threshold to 1 (one page per notch)', () => {
    const pager = new WheelPager(0);
    expect(pager.feed({ deltaY: 100 })).toBe(PAGE_DOWN);
  });

  it('reset() discards partial accumulation', () => {
    const pager = new WheelPager(3);
    pager.feed({ deltaY: 100 });
    pager.feed({ deltaY: 100 });
    pager.reset();
    expect(pager.feed({ deltaY: 100 })).toBe(''); // back to 1 notch, not 3
  });

  it('defaults to DEFAULT_NOTCHES_PER_PAGE notches per page', () => {
    const pager = new WheelPager();
    for (let i = 1; i < DEFAULT_NOTCHES_PER_PAGE; i += 1) {
      expect(pager.feed({ deltaY: 100 })).toBe('');
    }
    expect(pager.feed({ deltaY: 100 })).toBe(PAGE_DOWN);
  });
});
