import Phaser from 'phaser';
import { GlobalInputListener } from './GlobalInputListener';
import { GameInputListener } from './GameInputListener';
import { TerminalInputListener } from './TerminalInputListener';

export type FocusTarget = 'game' | 'terminal';
export type FocusFull = FocusTarget | 'none';

/**
 * Focus-gating contract (slice S1-A, baseline BL-008):
 *
 *   Switching focus toggles `scene.input.keyboard.enabled`; consumers register
 *   their own keys against the same gated instance.
 *
 * Practical consequences:
 *   - `GameInputListener` is the SOLE place that flips `scene.input.keyboard.enabled`
 *     and adds/clears Phaser keyboard captures. Do not toggle the enabled flag
 *     elsewhere (see `.github/instructions/src-input.instructions.md`).
 *   - Per-component `scene.input.keyboard.addKey(...)` calls are permitted
 *     (Player WASD, OfficeScene E/F, mini-game ESC/SPACE, DialogBox). All such
 *     keys are gated wholesale by the InputManager's enabled-flag toggle.
 *   - Two mutually exclusive focus states exist: `game` and `terminal`. `none`
 *     is a transient bootstrap/shutdown state and not a third user-facing mode.
 *   - DOM-modal overlays (settings, sprite customizer, notification settings)
 *     MUST call `suspendGameInput()` on open and `resumeGameInput()` on close
 *     so prior focus is saved and restored. Phaser-canvas mini-games
 *     (Basketball, Galaxian) stay in `game` focus and gate their own state
 *     via scene-level visibility flags.
 *   - The terminal overlay routes through `switchToTerminal()` / `switchToGame()`
 *     and uses `activateTerminalF10()` for the always-visible F10 close handler.
 */

/**
 * InputManager — central orchestrator for all keyboard focus transitions.
 *
 * Owns one instance each of:
 *   GlobalInputListener   — observational document-level logger
 *   GameInputListener     — Phaser keyboard enable/disable + canvas focus
 *   TerminalInputListener — F10 / Ctrl+Shift+N intercepts
 *
 * Public API used by OfficeScene and TerminalOverlay:
 *   switchToGame(reason)
 *   switchToTerminal(reason, callbacks)
 *   activateTerminalF10(onClose)
 *   deactivateTerminalF10()
 *   focusTerminalXterm(terminal)
 *   blurTerminalXterm(terminal)
 *   destroy()
 *
 * All transitions are logged with a [InputManager] prefix and timestamp.
 */
export class InputManager {
  readonly global: GlobalInputListener;
  readonly game: GameInputListener;
  readonly terminal: TerminalInputListener;

  private currentFocus: FocusFull = 'none';
  private suspendedFocus: FocusFull | null = null;

  constructor(scene: Phaser.Scene) {
    this.global = new GlobalInputListener();
    this.game = new GameInputListener(scene);
    this.terminal = new TerminalInputListener();

    // Install the global observational listener immediately
    this.global.install();

    console.log('[InputManager] created | time:', Date.now());
  }

  /**
   * Switch focus to the game canvas.
   * - Deactivates terminal shortcut intercepts
   * - Re-enables Phaser keyboard + restores captures
   * - Focuses canvas DOM element
   *
   * Safe to call when already in game mode (idempotent).
   */
  switchToGame(reason: string): void {
    console.log(
      `[InputManager] ── switchToGame() ──────────────────────────────────────\n` +
      `  reason  : "${reason}"\n` +
      `  from    : "${this.currentFocus}"\n` +
      `  time    : ${Date.now()}`
    );

    this.terminal.deactivateShortcuts();
    this.game.activate(reason);
    this.global.setMode('game');
    this.currentFocus = 'game';

    console.log('[InputManager] ── switchToGame() complete ──────────────────────────');
  }

  /**
   * Switch focus to the terminal pane.
   * - Deactivates Phaser keyboard (disable + clearCaptures)
   * - Activates terminal shortcut intercepts (Ctrl+Shift+N)
   *
   * Callers must also call focusTerminalXterm() after the xterm Terminal instance
   * is ready (there is a 100 ms delay before xterm accepts focus).
   *
   * @param onNewSession callback invoked when Ctrl+Shift+N is pressed
   * @param onToggleFullscreen callback invoked when Ctrl+F is pressed
   */
  switchToTerminal(reason: string, onNewSession: () => void, onToggleFullscreen?: () => void): void {
    console.log(
      `[InputManager] ── switchToTerminal() ──────────────────────────────────\n` +
      `  reason  : "${reason}"\n` +
      `  from    : "${this.currentFocus}"\n` +
      `  time    : ${Date.now()}`
    );

    this.game.deactivate(reason);
    this.terminal.activateShortcuts(onNewSession, onToggleFullscreen);
    this.global.setMode('terminal');
    this.currentFocus = 'terminal';

    console.log('[InputManager] ── switchToTerminal() complete ──────────────────────');
  }

  /**
   * Switch focus to a neutral dashboard mode.
   * - Deactivates Phaser keyboard
   * - Deactivates terminal shortcut intercepts
   * - Leaves global listener in 'none' mode
   */
  switchToNone(reason: string): void {
    console.log(
      `[InputManager] ── switchToNone() ──────────────────────────────────────\n` +
      `  reason  : "${reason}"\n` +
      `  from    : "${this.currentFocus}"\n` +
      `  time    : ${Date.now()}`
    );

    this.terminal.deactivateShortcuts();
    this.game.deactivate(reason);
    this.global.setMode('none');
    this.currentFocus = 'none';

    console.log('[InputManager] ── switchToNone() complete ───────────────────────────');
  }

  /**
   * Install the F10-to-close handler.  Should be called whenever a terminal
   * becomes visible (regardless of which side has keyboard focus — F10 always
   * closes the terminal).
   */
  activateTerminalF10(onClose: () => void): void {
    console.log(`[InputManager] activateTerminalF10() | time: ${Date.now()}`);
    this.terminal.activateF10(onClose);
  }

  /** Remove the F10 handler (call when terminal is hidden). */
  deactivateTerminalF10(): void {
    console.log(`[InputManager] deactivateTerminalF10() | time: ${Date.now()}`);
    this.terminal.deactivateF10();
  }

  /**
   * Focus the xterm Terminal instance.  Calls focus() synchronously for
   * immediate keyboard capture, then verifies after a short delay and retries
   * if the DOM wasn't ready (e.g. display transition still in flight).
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  focusTerminalXterm(terminal: any): void {
    // Synchronous focus — ensures keyboard events reach xterm immediately
    terminal?.focus();

    // Verification + retry: if the textarea didn't actually receive focus
    // (e.g. parent was still display:none at call time), retry with backoff.
    const verify = (n: number, delay: number) => {
      setTimeout(() => {
        const textarea = terminal?.textarea as HTMLTextAreaElement | undefined;
        if (textarea && document.activeElement !== textarea) {
          terminal?.focus();
          if (n < 3) verify(n + 1, delay * 2);
        }
      }, delay);
    };
    verify(1, 50);
  }

  /** Blur the xterm Terminal instance (return DOM focus away from xterm). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blurTerminalXterm(terminal: any): void {
    terminal?.blur();
  }

  /** Enable or disable verbose per-keydown logging in GlobalInputListener. */
  setDebugInput(enabled: boolean): void {
    this.global.setDebug(enabled);
  }

  /** Current focus target (for debugging / assertions). */
  getCurrentFocus(): FocusFull {
    return this.currentFocus;
  }

  /**
   * Temporarily deactivate game input for a modal overlay (settings, dialogs).
   * Saves the current focus state so it can be restored by `resumeGameInput()`.
   * Safe to call when already suspended (idempotent — won't overwrite saved state).
   */
  suspendGameInput(reason: string): void {
    console.log(
      `[InputManager] ── suspendGameInput() ──────────────────────────────────\n` +
      `  reason  : "${reason}"\n` +
      `  from    : "${this.currentFocus}"\n` +
      `  time    : ${Date.now()}`
    );

    if (this.suspendedFocus === null) {
      this.suspendedFocus = this.currentFocus;
    }
    this.game.deactivate(reason);
    this.global.setMode('game');
  }

  /**
   * Restore game input after a modal overlay is closed.
   * If the saved focus was 'game', re-activates Phaser keyboard.
   * If the saved focus was 'terminal', leaves game input deactivated.
   * Safe to call when not suspended (no-op).
   */
  resumeGameInput(reason: string): void {
    const savedFocus = this.suspendedFocus;
    this.suspendedFocus = null;

    console.log(
      `[InputManager] ── resumeGameInput() ──────────────────────────────────\n` +
      `  reason  : "${reason}"\n` +
      `  restoring : "${savedFocus}"\n` +
      `  time    : ${Date.now()}`
    );

    if (savedFocus === null) return;

    if (savedFocus === 'game' || savedFocus === 'none') {
      this.game.activate(reason);
    }
    // If savedFocus was 'terminal', game stays deactivated — terminal still owns keyboard
  }

  /** Tear down all listeners. Call when the scene is destroyed. */
  destroy(): void {
    console.log(`[InputManager] destroy() | time: ${Date.now()}`);
    this.terminal.deactivateAll();
    this.game.deactivate('InputManager.destroy()');
    this.global.uninstall();
    this.currentFocus = 'none';
  }
}
