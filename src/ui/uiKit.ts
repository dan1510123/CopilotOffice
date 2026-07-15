// Shared UI kit — cohesive button + surface styling for the DOM overlays.
//
// The top-bar revamp (office tabs / control pills in `main.ts`) established a
// design language: rounded (8–9px) pills on a dark surface, 1px accent borders,
// subtle hover transitions, and a small accent palette. The rest of the app
// (dashboard cards, terminal-panel footer, status bar, overview header) still
// used flat 4–5px buttons with no hover states, which read as "lacking".
//
// This module is the single source of truth for that shared chrome so every
// surface picks up the same look. Rendering side effects (the injected
// stylesheet) live here in the UI layer — never in `src/config`, which must
// stay pure per its directory rules.

/** Accent + surface tokens, aligned to the top-bar palette in `main.ts`. */
export const UI = {
  surface: '#1a1e2e',
  surfaceRaised: '#1e2233',
  surfaceSel: '#1e1e3a',
  cardBase: '#13131f',
  border: '#2c2c46',
  borderSubtle: '#252540',
  accentBlue: '#6d8bff',
  accentBlueSoft: '#8fb7ff',
  accentGreen: '#46d17f',
  accentGreenSoft: '#7fd6a3',
  accentPurple: '#c9a6ff',
  accentRed: '#e0607a',
  accentAmber: '#ffb86c',
  text: '#d7defa',
  textDim: '#9a9ab8',
} as const;

export type UiButtonVariant =
  | 'default'
  | 'primary'
  | 'success'
  | 'danger'
  | 'amber'
  | 'teams'
  | 'teams-online'
  | 'ghost';

/** Class name for a shared kit button. Combine with `injectUiKit()`. */
export function uiButtonClass(variant: UiButtonVariant = 'default'): string {
  return `ui-btn ui-btn--${variant}`;
}

/**
 * One-time injection of the shared UI-kit stylesheet. Idempotent + hot-reload
 * safe (guarded by element id), mirroring `injectTopBarStyles()` in `main.ts`.
 */
export function injectUiKit(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById('ui-kit-styles')) return;
  const style = document.createElement('style');
  style.id = 'ui-kit-styles';
  style.textContent = `
    .ui-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 12px;
      font-weight: 500;
      line-height: 1;
      padding: 7px 13px;
      border-radius: 8px;
      border: 1px solid ${UI.border};
      background: ${UI.surfaceRaised};
      color: #cfd6f5;
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, transform .06s ease;
    }
    .ui-btn:hover { background: #262c40; border-color: #3a4166; color: #fff; }
    .ui-btn:active { transform: translateY(1px); }
    .ui-btn:disabled { opacity: .5; cursor: default; transform: none; box-shadow: none; }

    .ui-btn--primary { background: #20264a; border-color: #3c4d94; color: #bcccff; }
    .ui-btn--primary:hover { background: #283163; border-color: ${UI.accentBlue}; color: #eaf0ff; box-shadow: 0 0 10px rgba(109,139,255,.22); }

    .ui-btn--success { background: #16301f; border-color: #2f7a52; color: #9fe8bd; }
    .ui-btn--success:hover { background: #1c3e29; border-color: ${UI.accentGreen}; color: #e6fff0; box-shadow: 0 0 10px rgba(70,209,127,.22); }

    .ui-btn--danger { background: #341a24; border-color: #7a3550; color: #f0a9c4; }
    .ui-btn--danger:hover { background: #45222f; border-color: ${UI.accentRed}; color: #ffe6ef; box-shadow: 0 0 10px rgba(224,96,122,.22); }

    .ui-btn--amber { background: #33260f; border-color: #8a5a1f; color: #ffcf8f; }
    .ui-btn--amber:hover { background: #43310f; border-color: ${UI.accentAmber}; color: #fff2df; box-shadow: 0 0 10px rgba(255,184,108,.22); }

    .ui-btn--teams { background: #1e2a4a; border-color: #35529a; color: #a9c6ff; }
    .ui-btn--teams:hover { background: #263566; border-color: ${UI.accentBlue}; color: #eaf0ff; box-shadow: 0 0 10px rgba(109,139,255,.22); }

    .ui-btn--teams-online { background: #16301f; border-color: #3f9a6a; color: #8fffaa; }
    .ui-btn--teams-online:hover { background: #1c3e29; border-color: ${UI.accentGreen}; color: #e6fff0; box-shadow: 0 0 10px rgba(70,209,127,.28); }

    .ui-btn--ghost { background: transparent; border-color: #33334f; color: ${UI.textDim}; }
    .ui-btn--ghost:hover { background: #21213590; border-color: #45456a; color: #cfd6f5; }
  `;
  document.head.appendChild(style);
}
