// Shared mouse-wheel → PTY translation for the terminal surfaces.
//
// Root cause (see specs/010 plan): Copilot CLI runs in the xterm ALTERNATE
// screen buffer, which has no scrollback. In that buffer xterm's default wheel
// handler converts wheel ticks into bare cursor arrow keys — which the CLI does
// not scroll on — so the mouse wheel appears dead while PageUp/PageDown work.
//
// This helper maps a wheel delta to the PageUp/PageDown escape sequences the CLI
// actually pages on. Both TerminalOverlay and SeriousTerminalController use it so
// the two surfaces never diverge (Constitution VI rule 4).

// VT220 PageUp / PageDown sequences (CSI 5 ~ / CSI 6 ~).
const PAGE_UP = '\x1b[5~';
const PAGE_DOWN = '\x1b[6~';

export interface WheelToPtyOptions {
  // Number of page sequences to emit per wheel notch. 1 = one page per notch.
  pagesPerNotch?: number;
}

/**
 * Translate a wheel deltaY into a PTY byte sequence of PageUp/PageDown presses.
 * Returns '' when there is no vertical movement (delta 0), so callers can decide
 * whether to suppress xterm's default handling.
 *
 * Pure function (no DOM) so it is unit-testable.
 */
export function wheelToPtySequence(deltaY: number, opts: WheelToPtyOptions = {}): string {
  if (!deltaY) return '';
  const pages = Math.max(1, Math.round(opts.pagesPerNotch ?? 1));
  const key = deltaY < 0 ? PAGE_UP : PAGE_DOWN;
  return key.repeat(pages);
}
