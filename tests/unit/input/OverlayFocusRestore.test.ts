/**
 * Slice S1-A — overlay focus save/restore coverage (BL-008).
 *
 * Exercises the suspendGameInput / resumeGameInput contract used by DOM-modal
 * overlays (Settings, SpriteCustomizer, NotificationSettings). The transition
 * sequence mirrors what OfficeScene wires on the `settings:open` /
 * `settings:close` event bus.
 */
import { describe, expect, it, vi } from 'vitest';
import { InputManager } from '../../../src/input/InputManager';
import { SpriteCustomizerPanel } from '../../../src/ui/SpriteCustomizerPanel';
import { createMockScene } from '../../setup/phaser-mocks';

describe('input/Overlay focus save & restore (S1-A)', () => {
  it('restores game focus after a modal overlay closes (was in game)', () => {
    const scene = createMockScene();
    const manager = new InputManager(scene as any);
    manager.switchToGame('start');
    expect(scene.input.keyboard.enabled).toBe(true);

    manager.suspendGameInput('overlay:open');
    expect(scene.input.keyboard.enabled).toBe(false);

    manager.resumeGameInput('overlay:close');
    expect(scene.input.keyboard.enabled).toBe(true);
    expect(manager.getCurrentFocus()).toBe('game');
    manager.destroy();
  });

  it('keeps game input disabled after an overlay closes if terminal had focus', () => {
    const scene = createMockScene();
    const manager = new InputManager(scene as any);

    manager.switchToTerminal('open-terminal', vi.fn(), vi.fn());
    expect(scene.input.keyboard.enabled).toBe(false);
    expect(manager.getCurrentFocus()).toBe('terminal');

    manager.suspendGameInput('overlay:open');
    expect(scene.input.keyboard.enabled).toBe(false);

    manager.resumeGameInput('overlay:close');
    // Terminal still owns the keyboard — game input must remain disabled.
    expect(scene.input.keyboard.enabled).toBe(false);
    manager.destroy();
  });

  it('is idempotent under repeated suspend/resume calls', () => {
    const scene = createMockScene();
    const manager = new InputManager(scene as any);
    manager.switchToGame('start');

    manager.suspendGameInput('first');
    manager.suspendGameInput('duplicate');
    expect(scene.input.keyboard.enabled).toBe(false);

    manager.resumeGameInput('close');
    expect(scene.input.keyboard.enabled).toBe(true);

    // Resume when nothing is suspended — no-op, no state corruption.
    manager.resumeGameInput('extra-close');
    expect(scene.input.keyboard.enabled).toBe(true);
    expect(manager.getCurrentFocus()).toBe('game');
    manager.destroy();
  });

  it('SpriteCustomizerPanel fires onOpen / onClose hooks for InputManager wiring', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const panel = new SpriteCustomizerPanel({
      onColorsChanged: vi.fn(),
      onOpen,
      onClose,
    });

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);

    panel.show(anchor);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onClose).not.toHaveBeenCalled();

    panel.hide();
    expect(onClose).toHaveBeenCalledTimes(1);

    // Re-opening then closing fires exactly one onOpen and one onClose.
    panel.show(anchor);
    panel.hide();
    expect(onOpen).toHaveBeenCalledTimes(2);
    expect(onClose).toHaveBeenCalledTimes(2);

    anchor.remove();
  });

  it('SpriteCustomizerPanel does not double-fire hooks on redundant hide()', () => {
    const onOpen = vi.fn();
    const onClose = vi.fn();
    const panel = new SpriteCustomizerPanel({
      onColorsChanged: vi.fn(),
      onOpen,
      onClose,
    });

    panel.hide(); // never opened — must not fire onClose
    expect(onClose).not.toHaveBeenCalled();

    const anchor = document.createElement('button');
    document.body.appendChild(anchor);
    panel.show(anchor);
    panel.hide();
    panel.hide(); // already closed — must not fire onClose again
    expect(onClose).toHaveBeenCalledTimes(1);

    anchor.remove();
  });
});
