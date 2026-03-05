import Phaser from 'phaser';

/**
 * GameInputListener — wraps Phaser's keyboard input system.
 *
 * Responsibilities:
 *  - Enable / re-add captures for arrow keys + space when game has focus
 *  - Disable and clear captures when terminal takes focus
 *  - Focus the Phaser canvas element on activation
 *
 * Ownership: InputManager creates and drives this class.
 */
export class GameInputListener {
  private scene: Phaser.Scene;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  /**
   * Activate game input: re-enable Phaser keyboard, restore key captures,
   * and hand DOM focus to the canvas.
   */
  activate(reason: string): void {
    console.log(
      `[GameInput] activate() — reason: "${reason}" | time: ${Date.now()}`
    );

    if (this.scene.input.keyboard) {
      // Re-add captures that createCursorKeys() needs so arrow keys and space
      // are not dispatched to the page (Phaser preventDefault()s them).
      this.scene.input.keyboard.addCapture([
        Phaser.Input.Keyboard.KeyCodes.UP,
        Phaser.Input.Keyboard.KeyCodes.DOWN,
        Phaser.Input.Keyboard.KeyCodes.LEFT,
        Phaser.Input.Keyboard.KeyCodes.RIGHT,
        Phaser.Input.Keyboard.KeyCodes.SPACE,
      ]);
      this.scene.input.keyboard.enabled = true;
      console.log(
        '[GameInput] Phaser keyboard enabled, captures restored (UP DOWN LEFT RIGHT SPACE)'
      );
    } else {
      console.warn('[GameInput] activate() — scene.input.keyboard is null, skipping');
    }

    // Give DOM focus to the canvas so Phaser receives keyboard events
    const canvas = this.scene.game.canvas;
    if (canvas) {
      canvas.focus();
      console.log('[GameInput] canvas.focus() called');
    }
  }

  /**
   * Deactivate game input: disable Phaser keyboard and clear all captures
   * so Phaser does not intercept keys while the terminal is active.
   */
  deactivate(reason: string): void {
    console.log(
      `[GameInput] deactivate() — reason: "${reason}" | time: ${Date.now()}`
    );

    if (this.scene.input.keyboard) {
      this.scene.input.keyboard.enabled = false;
      this.scene.input.keyboard.clearCaptures();
      console.log('[GameInput] Phaser keyboard disabled, captures cleared');
    } else {
      console.warn('[GameInput] deactivate() — scene.input.keyboard is null, skipping');
    }
  }
}
