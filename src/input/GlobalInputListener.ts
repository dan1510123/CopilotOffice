/**
 * GlobalInputListener — single document-level capture-phase listener.
 *
 * This listener is installed once at startup and remains active for the full
 * lifetime of the application.  Its sole job is to log every keydown that
 * arrives at the document and to record the current focus mode so callers can
 * inspect it for debugging.
 *
 * It does NOT preventDefault or stopPropagation — it is purely observational.
 * Actual interception is done by GameInputListener and TerminalInputListener.
 *
 * Ownership: InputManager creates this class.
 */
export type FocusMode = 'game' | 'terminal' | 'none';

/** Called before every page reload to clean up server-side terminal state. */
function preReloadCleanup(): void {
  if (typeof window === 'undefined' || !window.copilotBridge) return;
  try {
    window.copilotBridge.removeTerminalListeners();
    window.copilotBridge.removeCopilotListeners();
  } catch { /* best-effort */ }
}

export class GlobalInputListener {
  private currentMode: FocusMode = 'none';
  private boundHandler: (e: KeyboardEvent) => void;
  private installed: boolean = false;
  private debugEnabled: boolean = false;

  constructor() {
    this.boundHandler = this.onKeydown.bind(this);
  }

  /** Enable or disable verbose per-keydown logging. */
  setDebug(enabled: boolean): void {
    this.debugEnabled = enabled;
    console.log(`[GlobalInput] debug mode ${enabled ? 'ON' : 'OFF'}`);
  }

  getDebug(): boolean {
    return this.debugEnabled;
  }

  /** Install the global listener. Call once at startup. */
  install(): void {
    if (this.installed) {
      console.warn('[GlobalInput] install() called but already installed — skipping');
      return;
    }
    document.addEventListener('keydown', this.boundHandler, true);
    this.installed = true;
    console.log('[GlobalInput] global keydown listener installed (capture phase)');
  }

  /** Remove the global listener. Call on cleanup. */
  uninstall(): void {
    if (!this.installed) return;
    document.removeEventListener('keydown', this.boundHandler, true);
    this.installed = false;
    console.log('[GlobalInput] global keydown listener removed');
  }

  /** Update the current mode so log output is meaningful. */
  setMode(mode: FocusMode): void {
    const prev = this.currentMode;
    this.currentMode = mode;
    if (prev !== mode) {
      console.log(
        `[GlobalInput] mode updated: "${prev}" → "${mode}" | time: ${Date.now()}`
      );
    }
  }

  getMode(): FocusMode {
    return this.currentMode;
  }

  private onKeydown(e: KeyboardEvent): void {
    // Verbose log of every key seen at the document level.
    // Helps diagnose which listener consumes a given key.
    const modifiers = [
      e.ctrlKey && 'Ctrl',
      e.shiftKey && 'Shift',
      e.altKey && 'Alt',
      e.metaKey && 'Meta',
    ]
      .filter(Boolean)
      .join('+');

    const keyDesc = modifiers ? `${modifiers}+${e.key}` : e.key;
    if (this.debugEnabled) {
      console.log(
        `[GlobalInput] keydown "${keyDesc}" | mode: ${this.currentMode} | target: ${
          (e.target as HTMLElement)?.tagName ?? 'unknown'
        } | time: ${Date.now()}`
      );
    }

    // Ctrl+Shift+R — hard reload: restart terminal server + reload page
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'r') {
      e.preventDefault();
      e.stopPropagation();
      console.log('[GlobalInput] Ctrl+Shift+R — hard reload (restart terminal server)');
      preReloadCleanup();
      if (window.copilotBridge) {
        window.copilotBridge.requestHardReload().finally(() => {
          window.location.reload();
        });
      } else {
        window.location.reload();
      }
      return;
    }

    // Ctrl+R — soft reload: keep terminal server alive, only reload UI
    if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
      e.preventDefault();
      e.stopPropagation();
      console.log('[GlobalInput] Ctrl+R — soft reload (keeping terminal server)');
      preReloadCleanup();
      window.location.reload();
    }
  }
}
