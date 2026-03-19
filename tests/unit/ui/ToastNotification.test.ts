import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ToastNotificationManager } from '../../../src/ui/ToastNotification';

describe('ui/ToastNotificationManager', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '';
  });

  function createManager() {
    const parent = document.createElement('div');
    document.body.appendChild(parent);
    return new ToastNotificationManager(parent);
  }

  it('renders a toast and supports click callback', () => {
    const manager = createManager();
    const onClick = vi.fn();

    manager.show({
      agentId: 'generalist',
      agentName: 'Gene',
      agentColor: '#4488cc',
      message: 'hello',
      onClick,
    });

    vi.advanceTimersByTime(20);
    const toast = document.querySelector('#toast-container > div') as HTMLDivElement;
    expect(toast).toBeTruthy();
    toast.click();

    expect(onClick).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(300);
    expect(document.querySelector('#toast-container')?.children.length).toBe(0);
    manager.destroy();
  });

  it('auto-dismisses after timeout', () => {
    const manager = createManager();
    manager.show({
      agentId: 'generalist',
      agentName: 'Gene',
      agentColor: '#4488cc',
      message: 'auto',
    });

    expect(document.querySelector('#toast-container')?.children.length).toBe(1);
    vi.advanceTimersByTime(5000 + 300);
    expect(document.querySelector('#toast-container')?.children.length).toBe(0);
    manager.destroy();
  });

  it('limits to 3 visible toasts', () => {
    const manager = createManager();
    for (let i = 0; i < 4; i += 1) {
      manager.show({
        agentId: `a-${i}`,
        agentName: `Agent ${i}`,
        agentColor: '#4488cc',
        message: `msg-${i}`,
      });
      vi.advanceTimersByTime(20);
    }

    // The evicted toast remains briefly for slide-out animation.
    vi.advanceTimersByTime(300);
    expect(document.querySelector('#toast-container')?.children.length).toBe(3);
    manager.destroy();
  });

  it('rate-limits the 6th toast within 2 seconds', () => {
    const manager = createManager();

    for (let i = 0; i < 5; i += 1) {
      manager.show({
        agentId: `a-${i}`,
        agentName: `Agent ${i}`,
        agentColor: '#4488cc',
        message: `msg-${i}`,
      });
      vi.advanceTimersByTime(20);
      const dismiss = document.querySelector('#toast-container .toast-dismiss') as HTMLDivElement;
      dismiss.click();
      vi.advanceTimersByTime(300);
    }

    expect(document.querySelector('#toast-container')?.children.length).toBe(0);

    manager.show({
      agentId: 'a-6',
      agentName: 'Agent 6',
      agentColor: '#4488cc',
      message: 'blocked',
    });
    vi.advanceTimersByTime(20);

    expect(document.querySelector('#toast-container')?.children.length).toBe(0);
    manager.destroy();
  });
});

