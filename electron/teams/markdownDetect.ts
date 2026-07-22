// Pure markdown-structure detector for the Teams auto-render feature (spec 018).
//
// This module is deliberately SIDE-EFFECT-FREE: no `fs`, no `electron`, no
// `teamsService` import — so the FR-002 heuristic is unit-testable in isolation
// and safe to call synchronously in the finalize hot path. See
// contracts/markdown-detection.md for the full truth table.
//
// The only external dependency is `extractImageMarkers` (imageMarker.ts), which
// is itself pure over strings for extraction (no fs at extraction time) — reused
// so the existing-sentinel guard agrees with the loader on what a sentinel is.

import { extractImageMarkers } from './imageMarker';

/**
 * Hardcoded, non-configurable minimum reply length (chars) to auto-render (FR-002).
 * A reply must exceed this AND contain block-level markdown structure to qualify.
 */
export const AUTO_RENDER_MIN_CHARS = 1000;

/**
 * True iff `text` contains at least one block-level structural markdown construct:
 * a fenced code block, a pipe table (row + delimiter), an ATX or setext heading, a
 * blockquote, or a list with >=2 items. Inline-only emphasis (`**bold**`, `*italic*`,
 * `` `code` ``) and lone stray `#`/`*`/`-`/`>` in prose do NOT count.
 *
 * Pure & deterministic: builds fresh regexes per call (no shared `lastIndex` state).
 */
export function hasBlockStructure(text: string): boolean {
  const src = text ?? '';
  if (!src.trim()) return false;
  const lines = src.split(/\r?\n/);

  // Fenced code block: an opening fence (``` or ~~~) with a matching closing fence.
  let fenceChar: string | null = null;
  for (const line of lines) {
    const m = /^\s*(```+|~~~+)/.exec(line);
    if (!m) continue;
    const ch = m[1][0];
    if (fenceChar === null) {
      fenceChar = ch; // opening fence
    } else if (fenceChar === ch) {
      return true; // matching closing fence found
    }
  }

  // ATX heading: `^#{1,6}\s`.
  if (lines.some((l) => /^\s*#{1,6}\s/.test(l))) return true;

  // Blockquote: `^>\s`.
  if (lines.some((l) => /^\s*>\s/.test(l))) return true;

  // Pipe table: a `|...|` row immediately followed by a delimiter row.
  const pipeRow = /^\s*\|?.*\|.*$/;
  const delimRow = /^\s*\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
  for (let i = 0; i < lines.length - 1; i++) {
    if (delimRow.test(lines[i + 1]) && lines[i].includes('|') && pipeRow.test(lines[i])) {
      return true;
    }
  }

  // Setext heading: a non-empty text line immediately followed by `=+` or `-{2,}`.
  const setextUnderline = /^\s*(=+|-{2,})\s*$/;
  for (let i = 0; i < lines.length - 1; i++) {
    if (lines[i].trim() !== '' && setextUnderline.test(lines[i + 1])) {
      // Guard: the "text" line itself must not be a table delimiter / fence.
      if (!/^\s*\|/.test(lines[i]) && !/^\s*(```|~~~)/.test(lines[i])) return true;
    }
  }

  // List with >=2 items: two or more lines matching a bullet/ordered marker.
  const listItem = /^\s*([-*+]|\d+[.)])\s+\S/;
  let listCount = 0;
  for (const l of lines) {
    if (listItem.test(l)) {
      listCount++;
      if (listCount >= 2) return true;
    }
  }

  return false;
}

/**
 * True iff `text` already contains one or more valid office-image sentinels (FR-009).
 * Reuses `extractImageMarkers` so the guard and the loader agree on what a sentinel is.
 */
export function hasExistingImageSentinel(text: string): boolean {
  return extractImageMarkers(text ?? '').paths.length > 0;
}

/**
 * The FR-002 auto-render predicate: true iff BOTH
 *   (a) hasBlockStructure(text) AND
 *   (b) text.length > AUTO_RENDER_MIN_CHARS.
 * Does NOT check the existing-sentinel guard or the settings flag — callers combine.
 */
export function shouldAutoRenderMarkdown(text: string): boolean {
  const src = text ?? '';
  return src.length > AUTO_RENDER_MIN_CHARS && hasBlockStructure(src);
}
