import Phaser from 'phaser';
import { GlobalInputListener } from './GlobalInputListener';
import { GameInputListener } from './GameInputListener';
import { TerminalInputListener } from './TerminalInputListener';

export type FocusTarget = 'game' | 'terminal';

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

  private currentFocus: FocusTarget | 'none' = 'none';

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
   */
  switchToTerminal(reason: string, onNewSession: () => void): void {
    console.log(
      `[InputManager] ── switchToTerminal() ──────────────────────────────────\n` +
      `  reason  : "${reason}"\n` +
      `  from    : "${this.currentFocus}"\n` +
      `  time    : ${Date.now()}`
    );

    this.game.deactivate(reason);
    this.terminal.activateShortcuts(onNewSession);
    this.global.setMode('terminal');
    this.currentFocus = 'terminal';

    console.log('[InputManager] ── switchToTerminal() complete ──────────────────────');
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
   * Focus the xterm Terminal instance.  Includes the 100 ms delay required
   * for reliable focus transfer after the DOM has updated.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  focusTerminalXterm(terminal: any): void {
    console.log(`[InputManager] focusTerminalXterm() scheduled (+100ms) | time: ${Date.now()}`);
    setTimeout(() => {
      terminal?.focus();
      console.log(`[InputManager] focusTerminalXterm() executed | time: ${Date.now()}`);
    }, 100);
  }

  /** Blur the xterm Terminal instance (return DOM focus away from xterm). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  blurTerminalXterm(terminal: any): void {
    console.log(`[InputManager] blurTerminalXterm() | time: ${Date.now()}`);
    terminal?.blur();
  }

  /** Current focus target (for debugging / assertions). */
  getCurrentFocus(): FocusTarget | 'none' {
    return this.currentFocus;
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
