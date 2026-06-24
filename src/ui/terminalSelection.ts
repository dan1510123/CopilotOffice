// Sanitizes text extracted from an xterm selection before it reaches the OS
// clipboard.
//
// Why this exists: the Copilot CLI renders a scroll-position indicator as cell
// content in the terminal's rightmost column (a TUI scrollbar). xterm's
// getSelection() returns grid cell contents, so a full-width selection includes
// that last-column glyph on every line, polluting copied commands. The user
// wants the indicator to stay VISIBLE on screen but NOT be copied.
//
// Strategy (deliberately conservative to avoid breaking normal copy):
//   - Only a *trailing* glyph from a focused allowlist of vertical-bar /
//     block-drawing characters is treated as a scrollbar artifact.
//   - When found, the glyph and the run of padding spaces immediately before it
//     (the gap the CLI leaves between content and the right edge) are removed.
//   - Any line that does not end in an allowlisted glyph is returned unchanged.
//
// Ordinary text/code lines essentially never end in a lone block-drawing glyph,
// so this cannot alter normal selections. We intentionally do NOT trimEnd every
// line or reimplement xterm's selection-to-text logic.

// Vertical-bar and block-drawing glyphs the CLI may use to draw a right-edge
// scrollbar / thumb. Kept focused on column-fill glyphs.
const SCROLLBAR_GLYPHS = new Set<string>([
  '\u2502', // │ BOX DRAWINGS LIGHT VERTICAL
  '\u2503', // ┃ BOX DRAWINGS HEAVY VERTICAL
  '\u2506', // ┆ BOX DRAWINGS LIGHT TRIPLE DASH VERTICAL
  '\u2507', // ┇
  '\u250A', // ┊
  '\u250B', // ┋
  '\u2580', // ▀ UPPER HALF BLOCK
  '\u2584', // ▄ LOWER HALF BLOCK
  '\u2588', // █ FULL BLOCK
  '\u2589', // ▉
  '\u258A', // ▊
  '\u258B', // ▋
  '\u258C', // ▌ LEFT HALF BLOCK
  '\u258D', // ▍
  '\u258E', // ▎
  '\u258F', // ▏ LEFT ONE EIGHTH BLOCK
  '\u2590', // ▐ RIGHT HALF BLOCK
  '\u2591', // ░ LIGHT SHADE
  '\u2592', // ▒ MEDIUM SHADE
  '\u2593', // ▓ DARK SHADE
  '\u2594', // ▔ UPPER ONE EIGHTH BLOCK
  '\u2595', // ▕ RIGHT ONE EIGHTH BLOCK
]);

function endsWithScrollbarGlyph(line: string): boolean {
  return line.length > 0 && SCROLLBAR_GLYPHS.has(line.charAt(line.length - 1));
}

// Minimum number of padding spaces between content and a trailing glyph for it
// to count as a scrollbar "gap". A box-drawing table border (e.g. "│ key │")
// has exactly one interior space, so requiring >= 2 distinguishes a right-edge
// scrollbar (content sits far from the bar) from table/box borders.
const MIN_SCROLLBAR_GAP = 2;

// Counts the run of padding spaces immediately before a trailing scrollbar
// glyph. Returns -1 if the line does not end in an allowlisted glyph.
function trailingGlyphGap(line: string): number {
  if (!endsWithScrollbarGlyph(line)) return -1;
  let gap = 0;
  let i = line.length - 2;
  while (i >= 0 && line.charAt(i) === ' ') {
    gap += 1;
    i -= 1;
  }
  return gap;
}

function stripTrailingScrollbar(line: string): string {
  // Remove the glyph, then the run of padding spaces that sat between the real
  // content and the right-edge scrollbar.
  let end = line.length - 1;
  while (end > 0 && line.charAt(end - 1) === ' ') {
    end -= 1;
  }
  return line.slice(0, end);
}

/**
 * Removes a trailing CLI scrollbar glyph (and its padding) from the lines of a
 * terminal selection.
 *
 * To avoid corrupting legitimate selections that merely happen to end in a
 * block/vertical-bar glyph (e.g. box-drawing tables, progress bars), stripping
 * requires evidence of a right-edge scrollbar — namely a padding gap of at
 * least MIN_SCROLLBAR_GAP spaces between content and the glyph. A line is
 * stripped when EITHER:
 *   - it has that gap itself, OR
 *   - a cross-line scrollbar signal is present: >= 2 lines end in an
 *     allowlisted glyph, at least one of those lines has the padding gap (so it
 *     is a scrollbar, not a 1-space table border), and they form a majority of
 *     the non-empty lines (a bar rendered down the right edge). In that case
 *     even tight thumb/full-width rows in the block are stripped.
 *
 * Lines that aren't stripped are returned byte-for-byte unchanged. Original
 * line endings (\n and \r\n) are preserved.
 */
export function sanitizeTerminalSelection(text: string): string {
  if (!text) return text;

  // Split on \n while preserving \r so CRLF round-trips. We analyse the content
  // portion of each segment (everything before an optional trailing \r).
  const segments = text.split('\n').map((segment) => {
    const hasCr = segment.endsWith('\r');
    return { content: hasCr ? segment.slice(0, -1) : segment, hasCr };
  });

  const nonEmpty = segments.filter((s) => s.content.length > 0);
  const gaps = nonEmpty.map((s) => trailingGlyphGap(s.content));
  const candidateCount = gaps.filter((g) => g >= 0).length;
  const hasGapEvidence = gaps.some((g) => g >= MIN_SCROLLBAR_GAP);
  const crossLineSignal =
    candidateCount >= 2 && hasGapEvidence && candidateCount * 2 > nonEmpty.length;

  return segments
    .map(({ content, hasCr }) => {
      const gap = trailingGlyphGap(content);
      let cleaned = content;
      if (gap >= 0 && (crossLineSignal || gap >= MIN_SCROLLBAR_GAP)) {
        cleaned = stripTrailingScrollbar(content);
      }
      return hasCr ? `${cleaned}\r` : cleaned;
    })
    .join('\n');
}
