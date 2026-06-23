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
  attachCustomWheelEventHandler = vi.fn();
  onData = vi.fn(() => ({ dispose: vi.fn() }));
  onSelectionChange = vi.fn(() => ({ dispose: vi.fn() }));
  dispose = vi.fn();
  buffer = {
    active: { type: 'normal' as 'normal' | 'alternate' },
  };
  parser = {
    registerCsiHandler: vi.fn(() => ({ dispose: vi.fn() })),
  };
}

export class MockFitAddon {
  fit = vi.fn();
  proposeDimensions = vi.fn(() => ({ cols: 80, rows: 24 }));
}
