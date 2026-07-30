import { describe, expect, it, vi } from 'vitest';
import {
  createSessionHistoryRow,
  renderSessionHistoryList,
} from '../../../src/ui/sessionHistoryRender';
import type { SessionHistoryEntry } from '../../../src/ui/sessionHistoryRender';

/**
 * Spec 020 — clickable history rows (contracts/restore-session.md §6).
 *
 * The shared renderer turns a display-only row into a navigational control when `onSelect`
 * is provided and the surface is not read-only. Both surfaces delegate here, so these tests
 * assert the interaction contract once (FR-003/FR-007/FR-010/FR-017).
 */
describe('spec 020 — session history row onSelect wiring', () => {
  it('clicking a row invokes onSelect(entry) exactly once', () => {
    const entry: SessionHistoryEntry = { id: 'sess-a', title: 'Alpha' };
    const onSelect = vi.fn();
    const row = createSessionHistoryRow(entry, 1, { onSelect });

    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(entry);
  });

  it('is keyboard-activatable via Enter and Space (button semantics)', () => {
    const entry: SessionHistoryEntry = { id: 'sess-a', title: 'Alpha' };
    const onSelect = vi.fn();
    const row = createSessionHistoryRow(entry, 1, { onSelect });

    expect(row.getAttribute('role')).toBe('button');
    expect(row.tabIndex).toBe(0);
    expect(row.style.cursor).toBe('pointer');

    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    row.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true }));
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it('mousedown/click on the copyable id span does NOT fire onSelect (FR-007)', () => {
    const entry: SessionHistoryEntry = { id: 'sess-a', title: 'Alpha' };
    const onSelect = vi.fn();
    const row = createSessionHistoryRow(entry, 1, { onSelect });
    const idSpan = Array.from(row.querySelectorAll('span')).find((s) => s.textContent === 'sess-a')!;

    idSpan.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    idSpan.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('readOnly:true renders no clickable affordance and never fires onSelect (FR-017)', () => {
    const entry: SessionHistoryEntry = { id: 'sess-a', title: 'Alpha' };
    const onSelect = vi.fn();
    const row = createSessionHistoryRow(entry, 1, { onSelect, readOnly: true });

    expect(row.getAttribute('role')).toBeNull();
    expect(row.style.cursor).not.toBe('pointer');
    row.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    row.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('no onSelect ⇒ display-only (no role/pointer, no throw on click) — backward compatible', () => {
    const row = createSessionHistoryRow({ id: 'sess-a', title: 'Alpha' }, 1);
    expect(row.getAttribute('role')).toBeNull();
    expect(row.style.cursor).not.toBe('pointer');
    expect(() => row.dispatchEvent(new MouseEvent('click', { bubbles: true }))).not.toThrow();
  });

  it('title is rendered as literal textContent (XSS-safe) even when clickable', () => {
    const malicious = '<img src=x onerror="window.__xss2=1">';
    const onSelect = vi.fn();
    const row = createSessionHistoryRow({ id: 'x1', title: malicious }, 1, { onSelect });
    expect(row.querySelector('img')).toBeNull();
    const titleSpan = Array.from(row.querySelectorAll('span')).find((s) => s.textContent === malicious);
    expect(titleSpan).toBeTruthy();
    expect((window as unknown as { __xss2?: number }).__xss2).toBeUndefined();
  });

  it('renderSessionHistoryList threads onSelect to every row (clicking any row fires it)', () => {
    const entries: SessionHistoryEntry[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const onSelect = vi.fn();
    const list = renderSessionHistoryList(entries, { onSelect });
    const rows = Array.from(list.children) as HTMLElement[];
    rows.forEach((r) => r.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelect).toHaveBeenCalledTimes(3);
    // Most-recent-first: first row is the newest entry ('c').
    expect(onSelect).toHaveBeenNthCalledWith(1, { id: 'c' });
  });

  it('renderSessionHistoryList with readOnly:true renders non-clickable rows', () => {
    const entries: SessionHistoryEntry[] = [{ id: 'a' }, { id: 'b' }];
    const onSelect = vi.fn();
    const list = renderSessionHistoryList(entries, { onSelect, readOnly: true });
    const rows = Array.from(list.children) as HTMLElement[];
    rows.forEach((r) => r.dispatchEvent(new MouseEvent('click', { bubbles: true })));
    expect(onSelect).not.toHaveBeenCalled();
    expect(rows[0].getAttribute('role')).toBeNull();
  });
});
