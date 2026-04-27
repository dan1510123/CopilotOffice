import { vi } from 'vitest';

class MockResizeObserver {
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

let installed = false;
let localStorageStore = new Map<string, string>();

function ensureLocalStorageMock(): void {
  const storageLike = (globalThis as { localStorage?: Partial<Storage> }).localStorage;
  const hasStorageApi =
    typeof storageLike?.getItem === 'function' &&
    typeof storageLike?.setItem === 'function' &&
    typeof storageLike?.removeItem === 'function' &&
    typeof storageLike?.clear === 'function';

  if (hasStorageApi) return;

  localStorageStore = new Map<string, string>();
  const mockStorage: Storage = {
    get length() {
      return localStorageStore.size;
    },
    clear() {
      localStorageStore.clear();
    },
    getItem(key: string) {
      return localStorageStore.has(key) ? localStorageStore.get(key)! : null;
    },
    key(index: number) {
      return Array.from(localStorageStore.keys())[index] ?? null;
    },
    removeItem(key: string) {
      localStorageStore.delete(key);
    },
    setItem(key: string, value: string) {
      localStorageStore.set(String(key), String(value));
    },
  };

  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    writable: true,
    value: mockStorage,
  });
}

export function installBrowserMocks(): void {
  if (installed) return;
  ensureLocalStorageMock();

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

  if (typeof globalThis.matchMedia !== 'function') {
    globalThis.matchMedia = ((query: string): MediaQueryList => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(() => false),
    })) as typeof matchMedia;
  }

  installed = true;
}

export function resetBrowserState(): void {
  ensureLocalStorageMock();
  document.body.innerHTML = '';
  localStorage.clear();
}

