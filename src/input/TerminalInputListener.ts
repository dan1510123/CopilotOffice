/**
 * TerminalInputListener — handles keyboard intercepts while the terminal pane is focused.
 *
 * Responsibilities:
 *  - Intercept F10  → close terminal
 *  - Intercept Ctrl+Shift+N → new session
 *  - Leave ALL other keys un-stopped so they reach xterm's textarea
 *
 * Two separate capture-phase listeners are used:
 *   f10Handler     — installed for the entire lifetime the terminal is visible
 *   shortcutHandler — installed while terminal has keyboard focus (focusTerminal)
 *
 * Ownership: InputManager creates and drives this class.
 */
export class TerminalInputListener {
  private f10Handler: ((e: KeyboardEvent) => void) | null = null;
  private shortcutHandler: ((e: KeyboardEvent) => void) | null = null;

  /** Called when terminal becomes visible. Sets up F10 close handler. */
  activateF10(onClose: () => void): void {
    this.deactivateF10(); // remove any stale handler first

    this.f10Handler = (e: KeyboardEvent) => {
      if (e.key === 'F10') {
        console.log(
          `[TerminalInput] F10 pressed — closing terminal | time: ${Date.now()}`
        );
        e.preventDefault();
        e.stopImmediatePropagation();
        onClose();
      }
    };

    document.addEventListener('keydown', this.f10Handler, true);
    console.log('[TerminalInput] F10 handler installed (capture phase)');
  }

  /** Remove the F10 handler (called when terminal is hidden). */
  deactivateF10(): void {
    if (this.f10Handler) {
      document.removeEventListener('keydown', this.f10Handler, true);
      this.f10Handler = null;
      console.log('[TerminalInput] F10 handler removed');
    }
  }

  /**
   * Activate shortcut intercepts for terminal keyboard focus.
   * Intercepts: Ctrl+Shift+N (new session).
   * Does NOT stop propagation for other keys — xterm must receive them.
   */
  activateShortcuts(onNewSession: () => void): void {
    this.deactivateShortcuts(); // idempotent

    this.shortcutHandler = (event: KeyboardEvent) => {
      // Skip if F10 — handled by f10Handler
      if (event.key === 'F10') return;

      if (event.ctrlKey && event.shiftKey && event.key === 'N') {
        console.log(
          `[TerminalInput] Ctrl+Shift+N intercepted — new session | time: ${Date.now()}`
        );
        event.preventDefault();
        event.stopImmediatePropagation();
        onNewSession();
        return;
      }

      // All other keys pass through to xterm without interference.
      // Log only if verbose debugging is useful (uncomment below):
      // console.log(`[TerminalInput] key "${event.key}" passing through to xterm`);
    };

    document.addEventListener('keydown', this.shortcutHandler, true);
    console.log(
      '[TerminalInput] shortcut handler installed (capture phase) — intercepts: Ctrl+Shift+N'
    );
  }

  /** Remove shortcut intercepts (called when terminal loses keyboard focus). */
  deactivateShortcuts(): void {
    if (this.shortcutHandler) {
      document.removeEventListener('keydown', this.shortcutHandler, true);
      this.shortcutHandler = null;
      console.log('[TerminalInput] shortcut handler removed');
    }
  }

  /** Tear down everything — call on terminal destroy. */
  deactivateAll(): void {
    console.log('[TerminalInput] deactivateAll()');
    this.deactivateF10();
    this.deactivateShortcuts();
  }
}
