import { vi } from 'vitest';

export class MockTerminal {
  textarea = document.createElement('textarea');
  focus = vi.fn();
  blur = vi.fn();
  write = vi.fn();
  writeln = vi.fn();
  clear = vi.fn();
  open = vi.fn();
  loadAddon = vi.fn();
  paste = vi.fn();
  attachCustomKeyEventHandler = vi.fn();
  onData = vi.fn();
  dispose = vi.fn();
}

export class MockFitAddon {
  fit = vi.fn();
  proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
}

