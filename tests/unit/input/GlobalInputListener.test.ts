import { describe, expect, it, vi } from 'vitest';
import { GlobalInputListener } from '../../../src/input/GlobalInputListener';

describe('input/GlobalInputListener', () => {
  it('tracks mode and debug flags', () => {
    const listener = new GlobalInputListener();
    expect(listener.getMode()).toBe('none');
    listener.setMode('game');
    expect(listener.getMode()).toBe('game');
    listener.setDebug(true);
    expect(listener.getDebug()).toBe(true);
  });

  it('does not block normal keys', () => {
    const listener = new GlobalInputListener();
    listener.install();

    const event = new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true });
    document.dispatchEvent(event);
    expect(event.defaultPrevented).toBe(false);
    listener.uninstall();
  });

  it('intercepts Ctrl+R and triggers soft reload cleanup', () => {
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });

    const listener = new GlobalInputListener();
    listener.install();

    const event = new KeyboardEvent('keydown', {
      key: 'r',
      ctrlKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(window.copilotBridge.removeTerminalListeners).toHaveBeenCalled();
    expect(window.copilotBridge.removeCopilotListeners).toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalled();
    vi.unstubAllGlobals();
    listener.uninstall();
  });

  it('intercepts Ctrl+Shift+R and requests hard reload', async () => {
    const reloadSpy = vi.fn();
    vi.stubGlobal('location', { ...window.location, reload: reloadSpy });

    const listener = new GlobalInputListener();
    listener.install();

    const event = new KeyboardEvent('keydown', {
      key: 'R',
      ctrlKey: true,
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    document.dispatchEvent(event);
    await Promise.resolve();

    expect(event.defaultPrevented).toBe(true);
    expect(window.copilotBridge.requestHardReload).toHaveBeenCalled();
    expect(reloadSpy).toHaveBeenCalled();
    vi.unstubAllGlobals();
    listener.uninstall();
  });
});

