import { vi } from 'vitest';

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

let installed = false;

export function installBrowserMocks(): void {
  if (installed) return;

  if (!globalThis.ResizeObserver) {
    globalThis.ResizeObserver = MockResizeObserver as unknown as typeof ResizeObserver;
  }

  Object.defineProperty(HTMLCanvasElement.prototype, 'getContext', {
    configurable: true,
    writable: true,
    value: () => ({
      imageSmoothingEnabled: false,
      drawImage: vi.fn(),
      clearRect: vi.fn(),
    }),
  });

  globalThis.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    return setTimeout(() => cb(Date.now()), 16) as unknown as number;
  }) as typeof requestAnimationFrame;

  globalThis.cancelAnimationFrame = ((id: number) => {
    clearTimeout(id as unknown as ReturnType<typeof setTimeout>);
  }) as typeof cancelAnimationFrame;

  installed = true;
}

export function resetBrowserState(): void {
  document.body.innerHTML = '';
  localStorage.clear();
}

