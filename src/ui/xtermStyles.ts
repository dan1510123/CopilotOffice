// Shared xterm.js CSS injection — single source of truth for both
// TerminalOverlay and SeriousTerminalController.
//
// Constitution VI rule 4: both surfaces must be updated in the same change.
// This module ensures identical xterm styles regardless of which surface
// initializes first, eliminating the previous race on a shared element ID.

const STYLE_ID = 'copilot-office-xterm-styles';

export function ensureXtermStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(STYLE_ID)) return;

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    .xterm {
      height: 100%;
    }
    .xterm-viewport {
      overflow-y: scroll !important;
      background-color: #0a0a14 !important;
      scrollbar-width: none;
      scrollbar-gutter: auto;
    }
    .xterm-viewport::-webkit-scrollbar {
      width: 0 !important;
      height: 0 !important;
      display: none !important;
    }
    #terminal-container .xterm {
      height: 100%;
    }
    #serious-terminal-container .xterm {
      height: 100%;
    }
  `;
  document.head.appendChild(style);
}

// Test helper: remove the style element so tests don't leak DOM state.
export function __resetXtermStylesForTesting(): void {
  if (typeof document === 'undefined') return;
  const el = document.getElementById(STYLE_ID);
  if (el) el.remove();
}
