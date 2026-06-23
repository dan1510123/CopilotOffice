import { describe, it, expect, beforeEach } from 'vitest';
import { ensureXtermStyles, __resetXtermStylesForTesting } from '../../../src/ui/xtermStyles';

describe('ensureXtermStyles', () => {
  beforeEach(() => {
    __resetXtermStylesForTesting();
  });

  it('injects a style element with the correct ID', () => {
    ensureXtermStyles();
    const el = document.getElementById('copilot-office-xterm-styles');
    expect(el).not.toBeNull();
    expect(el?.tagName).toBe('STYLE');
  });

  it('is idempotent — calling twice does not duplicate', () => {
    ensureXtermStyles();
    ensureXtermStyles();
    const elements = document.querySelectorAll('#copilot-office-xterm-styles');
    expect(elements.length).toBe(1);
  });

  it('includes overflow-y: scroll for .xterm-viewport', () => {
    ensureXtermStyles();
    const el = document.getElementById('copilot-office-xterm-styles');
    expect(el?.textContent).toContain('overflow-y: scroll !important');
  });

  it('hides the native scrollbar via scrollbar-width: none', () => {
    ensureXtermStyles();
    const el = document.getElementById('copilot-office-xterm-styles');
    expect(el?.textContent).toContain('scrollbar-width: none');
  });

  it('hides the webkit scrollbar', () => {
    ensureXtermStyles();
    const el = document.getElementById('copilot-office-xterm-styles');
    expect(el?.textContent).toContain('::-webkit-scrollbar');
    expect(el?.textContent).toContain('width: 0');
  });

  it('includes rules for both terminal container IDs', () => {
    ensureXtermStyles();
    const el = document.getElementById('copilot-office-xterm-styles');
    expect(el?.textContent).toContain('#terminal-container .xterm');
    expect(el?.textContent).toContain('#serious-terminal-container .xterm');
  });

  it('__resetXtermStylesForTesting removes the element', () => {
    ensureXtermStyles();
    expect(document.getElementById('copilot-office-xterm-styles')).not.toBeNull();
    __resetXtermStylesForTesting();
    expect(document.getElementById('copilot-office-xterm-styles')).toBeNull();
  });
});
