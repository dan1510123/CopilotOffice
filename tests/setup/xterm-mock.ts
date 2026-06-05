import { vi } from 'vitest';

export class MockTerminal {
  cols = 80;
  rows = 24;
  textarea = document.createElement('textarea');
  focus = vi.fn();
  blur = vi.fn();
  write = vi.fn();
  writeln = vi.fn();
  clear = vi.fn();
  reset = vi.fn();
  refresh = vi.fn();
  open = vi.fn();
  loadAddon = vi.fn();
  paste = vi.fn();
  hasSelection = vi.fn(() => false);
  getSelection = vi.fn(() => '');
  attachCustomKeyEventHandler = vi.fn();
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  // Spec 005: capture the onSelectionChange callback so tests can fire it
  // to drive the renderer's cachedSelection field. Returns a disposable.
  selectionListeners: Array<() => void> = [];
  onSelectionChange = vi.fn((cb: () => void) => {
    this.selectionListeners.push(cb);
    return { dispose: vi.fn() };
  });
  /** Test helper: simulate xterm firing onSelectionChange after a user selection. */
  fireSelectionChange(text: string): void {
    this.hasSelection.mockReturnValue(text.length > 0);
    this.getSelection.mockReturnValue(text);
    for (const cb of this.selectionListeners) cb();
  }
  dispose = vi.fn();
}

export class MockFitAddon {
  fit = vi.fn();
  proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
}
