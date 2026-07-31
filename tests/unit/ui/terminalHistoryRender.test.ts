import { describe, expect, it } from 'vitest';
import {
  createSessionHistoryRow,
  renderSessionHistoryList,
  HISTORY_FALLBACK_TITLE,
} from '../../../src/ui/sessionHistoryRender';
import type { SessionHistoryEntry } from '../../../src/ui/sessionHistoryRender';

/**
 * Spec 019 — session-history row rendering.
 *
 * Both history surfaces (TerminalOverlay + SeriousTerminalController) delegate to this shared
 * renderer, so exercising it once asserts dual-surface parity (FR-014). Covers quickstart cases
 * 9, 10, 11, 12, 13.
 */
describe('spec 019 — session history row rendering (both surfaces)', () => {
  it('renders the title text and the exact id with user-select:all (case 9, FR-007)', () => {
    const entry: SessionHistoryEntry = { id: 'b1e-uuid-1', title: 'fix the terminal copy bug' };
    const row = createSessionHistoryRow(entry, 1);

    expect(row.textContent).toContain('fix the terminal copy bug');
    // Exact id shown verbatim.
    const idSpan = Array.from(row.querySelectorAll('span')).find((s) => s.textContent === 'b1e-uuid-1');
    expect(idSpan).toBeTruthy();
    expect(idSpan!.style.userSelect).toBe('all');
    // #N numbering present.
    expect(row.textContent).toContain('#1');
  });

  it('renders the "Untitled session" fallback for an untitled entry — no undefined/blank (case 10, FR-005)', () => {
    const row = createSessionHistoryRow({ id: 'c2f-uuid-2' }, 1);
    expect(row.textContent).toContain(HISTORY_FALLBACK_TITLE);
    expect(row.textContent).not.toContain('undefined');
    // id still present and exact.
    expect(row.textContent).toContain('c2f-uuid-2');
  });

  it('renders a title with markup as literal text — no DOM injection (case 11, FR-010, SC-002)', () => {
    const malicious = '<img src=x onerror="window.__xss=1">';
    const row = createSessionHistoryRow({ id: 'x1', title: malicious }, 1);

    // No <img> (or any injected element) was created from the title.
    expect(row.querySelector('img')).toBeNull();
    // The literal characters are present as text.
    const titleSpan = Array.from(row.querySelectorAll('span')).find((s) => s.textContent === malicious);
    expect(titleSpan).toBeTruthy();
    expect(titleSpan!.textContent).toBe(malicious);
    // Sanity: the onerror handler never ran.
    expect((window as unknown as { __xss?: number }).__xss).toBeUndefined();
  });

  it('preserves most-recent-first order and #N numbering (case 13, FR-013)', () => {
    // Stored oldest→newest.
    const entries: SessionHistoryEntry[] = [{ id: 'oldest' }, { id: 'middle' }, { id: 'newest' }];
    const list = renderSessionHistoryList(entries);
    const rows = Array.from(list.children) as HTMLElement[];

    expect(rows).toHaveLength(3);
    // Newest first.
    expect(rows[0].textContent).toContain('newest');
    expect(rows[0].textContent).toContain('#3');
    expect(rows[2].textContent).toContain('oldest');
    expect(rows[2].textContent).toContain('#1');
  });

  it('long title: full text on the title (tooltip) attribute + ellipsis styling, popover geometry unchanged (case 12, FR-012a)', () => {
    const longTitle = 'x'.repeat(80);
    const row = createSessionHistoryRow({ id: 'long-1', title: longTitle }, 1);
    const titleSpan = Array.from(row.querySelectorAll('span')).find((s) => s.textContent === longTitle)!;

    // Full title exposed on hover.
    expect(titleSpan.title).toBe(longTitle);
    // Ellipsis / single-line styling that prevents widening/wrapping.
    expect(titleSpan.style.textOverflow).toBe('ellipsis');
    expect(titleSpan.style.whiteSpace).toBe('nowrap');
    expect(titleSpan.style.overflow).toBe('hidden');
    // Row does not force horizontal growth: it clips overflow and the title flexes within min-width:0.
    expect(row.style.overflow).toBe('hidden');
    expect(['0px', '0']).toContain(titleSpan.style.minWidth);
  });
});
