// ToastNotification - DOM-based toast notification stack
// Shows popups when background agents complete work

import { ZIndex } from '../config/zIndex';

export interface ToastOptions {
  agentId: string;
  agentName: string;
  agentColor: string;
  message: string;
  onClick?: () => void;
  /** Canonical status icon (spec 014) — shown as the leading badge when provided. */
  statusIcon?: string;
  /** Canonical status color (spec 014) — used for the accent when provided, so
   *  notifications match the badge/dashboard color for the same state. */
  statusColorHex?: string;
}

interface ActiveToast {
  element: HTMLDivElement;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_VISIBLE = 3;
const AUTO_DISMISS_MS = 5000;
const ANIMATION_MS = 300;
const RATE_LIMIT_WINDOW_MS = 2000;
const RATE_LIMIT_MAX = 5; // max toasts within the rate limit window

export class ToastNotificationManager {
  private container: HTMLDivElement;
  private toasts: ActiveToast[] = [];
  private recentTimestamps: number[] = [];

  constructor(parentElement: HTMLElement) {
    this.container = document.createElement('div');
    this.container.id = 'toast-container';
    this.container.style.cssText = `
      position: fixed;
      top: 80px;
      left: 16px;
      width: calc(50% - 32px);
      z-index: ${ZIndex.TOAST};
      pointer-events: none;
      display: flex;
      flex-direction: column;
      gap: 8px;
    `;
    parentElement.appendChild(this.container);
  }

  show(options: ToastOptions): void {
    // Rate limiting — drop if too many toasts in the recent window
    const now = Date.now();
    this.recentTimestamps = this.recentTimestamps.filter(t => now - t < RATE_LIMIT_WINDOW_MS);
    if (this.recentTimestamps.length >= RATE_LIMIT_MAX) {
      return;
    }
    this.recentTimestamps.push(now);

    // Evict oldest if at max
    while (this.toasts.length >= MAX_VISIBLE) {
      this.dismiss(this.toasts[0]);
    }

    const accentColor = options.statusColorHex ?? options.agentColor;
    const el = document.createElement('div');
    el.style.cssText = `
      pointer-events: auto;
      background: #1e1e3a;
      border: 1.5px solid ${accentColor}66;
      border-left: 4px solid ${accentColor};
      border-radius: 8px;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      gap: 12px;
      cursor: pointer;
      font-family: 'Cascadia Code', Consolas, monospace;
      box-shadow: 0 4px 16px rgba(0,0,0,0.5);
      transform: translateX(-120%);
      opacity: 0;
      transition: transform ${ANIMATION_MS}ms ease, opacity ${ANIMATION_MS}ms ease;
    `;

    // Leading marker: canonical status icon when provided, else the agent-color dot.
    const markerHtml = options.statusIcon
      ? `<div style="font-size: 16px; line-height: 1; flex-shrink: 0;">${options.statusIcon}</div>`
      : `<div style="
          width: 8px; height: 8px;
          border-radius: 50%;
          background: ${accentColor};
          flex-shrink: 0;
        "></div>`;

    el.innerHTML = `
      ${markerHtml}
      <div style="flex: 1; min-width: 0;">
        <div style="font-size: 12px; font-weight: bold; color: #dde;">${options.agentName}</div>
        <div style="font-size: 11px; color: #889; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${options.message}</div>
      </div>
      <div class="toast-dismiss" style="
        color: #556;
        font-size: 14px;
        padding: 2px 6px;
        flex-shrink: 0;
      ">✕</div>
    `;

    this.container.appendChild(el);

    // Animate in
    requestAnimationFrame(() => {
      el.style.transform = 'translateX(0)';
      el.style.opacity = '1';
    });

    const toast: ActiveToast = {
      element: el,
      timer: setTimeout(() => this.dismiss(toast), AUTO_DISMISS_MS),
    };
    this.toasts.push(toast);

    // Click to open agent terminal
    el.addEventListener('click', (e) => {
      if ((e.target as HTMLElement).classList.contains('toast-dismiss')) {
        this.dismiss(toast);
        return;
      }
      options.onClick?.();
      this.dismiss(toast);
    });
  }

  private dismiss(toast: ActiveToast): void {
    const idx = this.toasts.indexOf(toast);
    if (idx === -1) return;

    clearTimeout(toast.timer);
    this.toasts.splice(idx, 1);

    toast.element.style.transform = 'translateX(-120%)';
    toast.element.style.opacity = '0';
    setTimeout(() => toast.element.remove(), ANIMATION_MS);
  }

  destroy(): void {
    for (const toast of [...this.toasts]) {
      clearTimeout(toast.timer);
      toast.element.remove();
    }
    this.toasts = [];
    this.container.remove();
  }
}
