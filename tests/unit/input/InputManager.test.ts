import { describe, expect, it, vi } from 'vitest';
import { InputManager } from '../../../src/input/InputManager';
import { createMockScene } from '../../setup/phaser-mocks';

describe('input/InputManager', () => {
  it('switches between game and terminal focus', () => {
    const scene = createMockScene();
    const manager = new InputManager(scene as any);

    const onNewSession = vi.fn();
    const onToggleFullscreen = vi.fn();

    manager.switchToTerminal('test', onNewSession, onToggleFullscreen);
    expect(scene.input.keyboard.enabled).toBe(false);
    expect(manager.getCurrentFocus()).toBe('terminal');

    manager.switchToGame('restore');
    expect(scene.input.keyboard.enabled).toBe(true);
    expect(scene.input.keyboard.addCapture).toHaveBeenCalled();
    expect(manager.getCurrentFocus()).toBe('game');
    manager.destroy();
  });

  it('focuses xterm with retry when focus does not initially stick', () => {
    vi.useFakeTimers();
    const scene = createMockScene();
    const manager = new InputManager(scene as any);

    const textarea = document.createElement('textarea');
    document.body.appendChild(textarea);

    let attempts = 0;
    const terminal = {
      textarea,
      focus: vi.fn(() => {
        attempts += 1;
        if (attempts >= 3) textarea.focus();
      }),
      blur: vi.fn(),
    };

    manager.focusTerminalXterm(terminal);
    vi.advanceTimersByTime(100 + 200 + 400);

    expect(terminal.focus).toHaveBeenCalledTimes(3);
    expect(document.activeElement).toBe(textarea);
    manager.destroy();
  });

  it('supports input suspension and resume for overlays', () => {
    const scene = createMockScene();
    const manager = new InputManager(scene as any);

    manager.switchToGame('start');
    manager.suspendGameInput('modal');
    expect(scene.input.keyboard.enabled).toBe(false);

    manager.resumeGameInput('modal-close');
    expect(scene.input.keyboard.enabled).toBe(true);
    manager.destroy();
  });
});

