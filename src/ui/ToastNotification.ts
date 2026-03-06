// ToastNotification - DOM-based toast notification stack
// Shows popups when background agents complete work

export interface ToastOptions {
  agentId: string;
  agentName: string;
  agentColor: string;
  message: string;
  onClick?: () => void;
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
      z-index: 9000;
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

    const el = document.createElement('div');
    el.style.cssText = `
      pointer-events: auto;
      background: #1e1e3a;
      border: 1.5px solid ${options.agentColor}66;
      border-left: 4px solid ${options.agentColor};
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

    el.innerHTML = `
      <div style="
        width: 8px; height: 8px;
        border-radius: 50%;
        background: ${options.agentColor};
        flex-shrink: 0;
      "></div>
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
