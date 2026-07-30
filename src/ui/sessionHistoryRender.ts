// Shared session-history row rendering for both history surfaces (spec 019).
// Used by TerminalOverlay and SeriousTerminalController so their popovers render
// identically (FR-014 dual-surface parity). Pure DOM builders — unit-testable in jsdom.

import type { SessionHistoryEntry } from '../../electron/terminal/protocol';

export type { SessionHistoryEntry };

/** Neutral fallback shown when an entry has no (or an empty) title (FR-005). */
export const HISTORY_FALLBACK_TITLE = 'Untitled session';

/**
 * Options controlling row interactivity (spec 020).
 *
 * - `onSelect` — when provided AND `!readOnly`, the row becomes a navigational control:
 *   it gains a pointer cursor + keyboard-activatable (Enter/Space) button semantics, and
 *   clicking/activating it calls `onSelect(entry)`. Omitted/undefined ⇒ display-only.
 * - `readOnly` — when true, rows are never clickable regardless of `onSelect` (FR-017).
 *
 * Copying the exact id never triggers `onSelect`: the id span stops propagation on
 * mousedown/click (FR-007/FR-012).
 */
export interface SessionHistoryRowOptions {
  onSelect?: (entry: SessionHistoryEntry) => void;
  readOnly?: boolean;
}

/**
 * Build one history row for a `SessionHistoryEntry`.
 *
 * - `#N` numbering span preserved (FR-013).
 * - Title rendered via `textContent` as **literal text** — never `innerHTML` (XSS-safe, FR-010).
 * - Fallback `Untitled session` when the title is absent/empty (FR-005).
 * - Exact `id` shown verbatim in a `user-select: all` span so it stays copyable (FR-007).
 * - Over-long title truncates on one line (ellipsis) with the full title on the DOM `title`
 *   attribute (hover tooltip); the row never widens/wraps/horizontally scrolls the popover
 *   (FR-012a).
 * - When `options.onSelect` is set AND not `options.readOnly`, the row is clickable/keyboard-
 *   activatable and invokes `onSelect(entry)` (spec 020, FR-003/FR-017).
 *
 * @param entry the archived session entry
 * @param displayNumber the 1-based `#N` label
 * @param options optional interactivity (spec 020)
 */
export function createSessionHistoryRow(
  entry: SessionHistoryEntry,
  displayNumber: number,
  options?: SessionHistoryRowOptions
): HTMLDivElement {
  const row = document.createElement('div');
  row.style.cssText = `
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 4px 8px;
    border-radius: 3px;
    margin-bottom: 2px;
    max-width: 100%;
    overflow: hidden;
  `;

  const num = document.createElement('span');
  num.textContent = `#${displayNumber}`;
  num.style.cssText = 'color: #555; flex: 0 0 auto;';
  row.appendChild(num);

  const hasTitle = typeof entry.title === 'string' && entry.title.trim().length > 0;
  const titleText = hasTitle ? (entry.title as string) : HISTORY_FALLBACK_TITLE;

  const titleSpan = document.createElement('span');
  // Literal text only — never interpreted as markup (FR-010).
  titleSpan.textContent = titleText;
  // Full title exposed on hover so truncation is non-destructive (FR-012a).
  titleSpan.title = titleText;
  titleSpan.style.cssText = `
    flex: 1 1 auto;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: ${hasTitle ? '#cdd6ff' : '#77839f'};
    ${hasTitle ? '' : 'font-style: italic;'}
  `;
  row.appendChild(titleSpan);

  const idSpan = document.createElement('span');
  // Verbatim, exact, copyable identifier (FR-007).
  idSpan.textContent = entry.id;
  idSpan.style.cssText = 'color: #6f7aa0; font-size: 11px; user-select: all; flex: 0 0 auto;';
  row.appendChild(idSpan);

  // Spec 020: turn the row into a navigational control when a selection handler is
  // provided and the surface is not read-only.
  const selectable = !!options?.onSelect && !options.readOnly;
  if (selectable) {
    const onSelect = options!.onSelect!;
    row.style.cursor = 'pointer';
    // Keyboard-activatable button semantics (accessibility).
    row.setAttribute('role', 'button');
    row.tabIndex = 0;
    // Selecting/copying the exact id must NOT trigger a session switch (FR-007/FR-012).
    idSpan.addEventListener('mousedown', (e) => e.stopPropagation());
    idSpan.addEventListener('click', (e) => e.stopPropagation());
    row.addEventListener('click', () => onSelect(entry));
    row.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onSelect(entry);
      }
    });
  }

  return row;
}

/**
 * Render a full history list (most-recent-first, `#N` numbered) into a fresh container.
 * Entries are stored oldest→newest; iteration is reversed for display (FR-013).
 *
 * `options` (spec 020) is threaded to every row so clicking a row can restore/switch to
 * that session; omit it (or pass `readOnly: true`) to preserve display-only behavior.
 */
export function renderSessionHistoryList(
  entries: SessionHistoryEntry[],
  options?: SessionHistoryRowOptions
): HTMLDivElement {
  const list = document.createElement('div');
  for (let i = entries.length - 1; i >= 0; i--) {
    list.appendChild(createSessionHistoryRow(entries[i], i + 1, options));
  }
  return list;
}
