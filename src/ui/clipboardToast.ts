// Spec 005: single shared toast for clipboard feedback.
//
// Prior specs relied on console.log for diagnostics. The user (rightly) does
// not want to open DevTools for normal operation, so failure modes (e.g.
// clipboard verification mismatch) were invisible — the app would lie and
// say "copied" while the OS clipboard held something else.
//
// This helper renders a small, auto-dismissing toast near the top of the
// viewport. It is intentionally minimal: one instance at a time, no queue,
// most-recent-wins. Both TerminalOverlay (game mode) and
// SeriousTerminalController (serious mode) call into it.

import { ZIndex } from '../config/zIndex';

export type ClipboardToastKind = 'success' | 'info' | 'error';

const TOAST_ID = 'copilot-office-clipboard-toast';
const TOAST_DURATION_MS = 1500;

let dismissTimer: ReturnType<typeof setTimeout> | null = null;

function ensureToastElement(): HTMLDivElement | null {
  if (typeof document === 'undefined') return null;
  let el = document.getElementById(TOAST_ID) as HTMLDivElement | null;
  if (el) return el;
  el = document.createElement('div');
  el.id = TOAST_ID;
  el.style.cssText = `
    position: fixed;
    top: 24px;
    left: 50%;
    transform: translateX(-50%);
    z-index: ${ZIndex.TERMINAL_SPRITE_CARD + 20};
    padding: 8px 16px;
    border-radius: 6px;
    font-family: 'Cascadia Code', Consolas, monospace;
    font-size: 13px;
    color: #ffffff;
    box-shadow: 0 4px 14px rgba(0, 0, 0, 0.5);
    pointer-events: none;
    opacity: 0;
    transition: opacity 120ms ease-out;
    max-width: 60vw;
    text-align: center;
  `;
  document.body.appendChild(el);
  return el;
}

const KIND_BG: Record<ClipboardToastKind, string> = {
  success: '#1f6f3a',
  info: '#27355a',
  error: '#7a2230',
};

export function showClipboardToast(message: string, kind: ClipboardToastKind = 'info'): void {
  const el = ensureToastElement();
  if (!el) return;
  el.textContent = message;
  el.style.background = KIND_BG[kind];
  el.style.opacity = '1';
  if (dismissTimer) clearTimeout(dismissTimer);
  dismissTimer = setTimeout(() => {
    el.style.opacity = '0';
  }, TOAST_DURATION_MS);
}

// Test helper: remove the toast element entirely so tests don't leak DOM.
export function __resetClipboardToastForTesting(): void {
  if (dismissTimer) {
    clearTimeout(dismissTimer);
    dismissTimer = null;
  }
  if (typeof document === 'undefined') return;
  const el = document.getElementById(TOAST_ID);
  if (el) el.remove();
}
