import { describe, expect, it, vi } from 'vitest';
import { TerminalInputListener } from '../../../src/input/TerminalInputListener';

function dispatchKeyboardEvent(event: KeyboardEvent): void {
  document.dispatchEvent(event);
}

describe('input/TerminalInputListener', () => {
  it('handles F10 close shortcut', () => {
    const listener = new TerminalInputListener();
    const onClose = vi.fn();
    listener.activateF10(onClose);

    const event = new KeyboardEvent('keydown', { key: 'F10', bubbles: true, cancelable: true });
    const stopSpy = vi.fn();
    Object.defineProperty(event, 'stopImmediatePropagation', {
      value: stopSpy,
      configurable: true,
    });

    dispatchKeyboardEvent(event);
    expect(event.defaultPrevented).toBe(true);
    expect(stopSpy).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    listener.deactivateAll();
  });

  it('handles Ctrl+Shift+N and Ctrl+F only when shortcuts active', () => {
    const listener = new TerminalInputListener();
    const onNewSession = vi.fn();
    const onToggleFullscreen = vi.fn();

    listener.activateShortcuts(onNewSession, onToggleFullscreen);

    const newSessionEvent = new KeyboardEvent('keydown', {
      key: 'N',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    dispatchKeyboardEvent(newSessionEvent);
    expect(onNewSession).toHaveBeenCalledTimes(1);

    const fullscreenEvent = new KeyboardEvent('keydown', {
      key: 'f',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    dispatchKeyboardEvent(fullscreenEvent);
    expect(onToggleFullscreen).toHaveBeenCalledTimes(1);

    listener.deactivateAll();
  });
});

