// Shared mouse-wheel → PTY translation for the terminal surfaces.
//
// Root cause (see specs/010 plan): Copilot CLI runs in the xterm ALTERNATE
// screen buffer, which has no scrollback. In that buffer xterm's default wheel
// handler converts wheel ticks into bare cursor arrow keys — which the CLI does
// not scroll on — so the mouse wheel appears dead while PageUp/PageDown work.
//
// Because the CLI only pages (PageUp/PageDown) in the alt buffer, one wheel
// notch = one page is the coarsest-but-only native unit. To scroll *slower*
// than a page per notch we accumulate normalized wheel movement and emit a page
// only once enough has built up. WheelPager owns that accumulator so both
// TerminalOverlay and SeriousTerminalController stay in sync (Constitution VI
// rule 4).

// VT220 PageUp / PageDown sequences (CSI 5 ~ / CSI 6 ~).
const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';

// Wheel "notches" that must accumulate before emitting one page. Higher = slower
// scrolling. ~1 notch ≈ one physical mouse-wheel detent (see normalizeToNotches).
export const DEFAULT_NOTCHES_PER_PAGE = 3;

// DOM WheelEvent.deltaMode values.
const DELTA_MODE_PIXEL = 0;
const DELTA_MODE_LINE = 1;
const DELTA_MODE_PAGE = 2;

// Convert a raw wheel delta into "notches" (≈ physical detents) so behavior is
// consistent across mice (pixel/line deltas) and trackpads (many small pixels).
export function normalizeToNotches(deltaY: number, deltaMode: number = DELTA_MODE_PIXEL): number {
  switch (deltaMode) {
    case DELTA_MODE_LINE:
      return deltaY / 3; // ~3 lines per detent
    case DELTA_MODE_PAGE:
      return deltaY; // already page-granularity
    case DELTA_MODE_PIXEL:
    default:
      return deltaY / 100; // ~100px per detent
  }
}

export interface WheelToPtyOptions {
  // Number of page sequences to emit per wheel notch. 1 = one page per notch.
  pagesPerNotch?: number;
}

/**
 * Translate a wheel deltaY into a PTY byte sequence of PageUp/PageDown presses.
 * Returns '' when there is no vertical movement (delta 0), so callers can decide
 * whether to suppress xterm's default handling.
 *
 * Pure, stateless. Kept for callers/tests that want immediate (non-accumulated)
 * translation; interactive scrolling uses WheelPager for slower, smoother feel.
 */
export function wheelToPtySequence(deltaY: number, opts: WheelToPtyOptions = {}): string {
  if (!deltaY) return '';
  const pages = Math.max(1, Math.round(opts.pagesPerNotch ?? 1));
  const key = deltaY < 0 ? PAGE_UP : PAGE_DOWN;
  return key.repeat(pages);
}

export interface WheelEventLike {
  deltaY: number;
  deltaMode?: number;
}

/**
 * Accumulates wheel movement and emits PageUp/PageDown only once enough notches
 * have built up, yielding scrolling slower than one page per notch.
 *
 * Stateful but DOM-free, so it is unit-testable. One instance per terminal
 * surface; the accumulator resets when the scroll direction reverses so a flick
 * up then down doesn't carry stale momentum.
 */
export class WheelPager {
  private accumulator = 0;
  private readonly notchesPerPage: number;

  constructor(notchesPerPage: number = DEFAULT_NOTCHES_PER_PAGE) {
    this.notchesPerPage = Math.max(1, notchesPerPage);
  }

  /** Feed a wheel event; returns the PTY sequence to send (possibly ''). */
  feed(event: WheelEventLike): string {
    if (!event.deltaY) return '';
    const notches = normalizeToNotches(event.deltaY, event.deltaMode ?? DELTA_MODE_PIXEL);
    if (!notches) return '';

    // Reset on direction reversal so opposite movement doesn't blend.
    if (Math.sign(notches) !== Math.sign(this.accumulator)) {
      this.accumulator = 0;
    }
    this.accumulator += notches;

    const pages = Math.trunc(this.accumulator / this.notchesPerPage);
    if (pages === 0) return '';
    this.accumulator -= pages * this.notchesPerPage;

    const key = pages < 0 ? PAGE_UP : PAGE_DOWN;
    return key.repeat(Math.abs(pages));
  }

  /** Discard any partial accumulation (e.g. when the terminal is hidden). */
  reset(): void {
    this.accumulator = 0;
  }
}
