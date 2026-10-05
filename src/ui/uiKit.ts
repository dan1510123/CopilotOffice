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
    /* Friendlier UI font — single source for all DOM chrome. Terminal/xterm and
       any explicitly-monospace surface keep their own font-family. */
    :root { --co-font-ui: 'Trebuchet MS', 'Segoe UI', system-ui, -apple-system, sans-serif; }
    body { font-family: var(--co-font-ui); }
    .ui-btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      font-family: var(--co-font-ui);
      font-size: 12px;
      font-weight: 600;
      line-height: 1;
      padding: 7px 13px;
      border-radius: 9px;
      border: 1px solid var(--co-border);
      background: var(--co-bg-raised);
      color: var(--co-text);
      cursor: pointer;
      white-space: nowrap;
      user-select: none;
      transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .15s ease, transform .06s ease;
    }
    .ui-btn:hover { background: var(--co-bg-raised-hover); border-color: color-mix(in srgb, var(--co-border) 40%, var(--co-text-secondary)); color: var(--co-text-strong); }
    .ui-btn:active { transform: translateY(1px); }
    .ui-btn:disabled { opacity: .5; cursor: default; transform: none; box-shadow: none; }
    .ui-btn__spinner {
      width: 11px;
      height: 11px;
      border: 2px solid currentColor;
      border-right-color: transparent;
      border-radius: 50%;
      animation: copilot-btn-spin .7s linear infinite;
    }

    .ui-btn--primary { background: color-mix(in srgb, var(--co-accent-strong) 15%, var(--co-bg-raised)); border-color: color-mix(in srgb, var(--co-accent-strong) 45%, var(--co-border)); color: var(--co-accent); }
    .ui-btn--primary:hover { background: color-mix(in srgb, var(--co-accent-strong) 26%, var(--co-bg-raised)); border-color: var(--co-accent-strong); color: var(--co-text-strong); box-shadow: 0 0 10px color-mix(in srgb, var(--co-accent-strong) 22%, transparent); }

    .ui-btn--success { background: color-mix(in srgb, var(--co-success) 15%, var(--co-bg-raised)); border-color: color-mix(in srgb, var(--co-success) 45%, var(--co-border)); color: var(--co-success); }
    .ui-btn--success:hover { background: color-mix(in srgb, var(--co-success) 26%, var(--co-bg-raised)); border-color: var(--co-success); color: var(--co-text-strong); box-shadow: 0 0 10px color-mix(in srgb, var(--co-success) 22%, transparent); }

    .ui-btn--danger { background: color-mix(in srgb, var(--co-danger) 15%, var(--co-bg-raised)); border-color: color-mix(in srgb, var(--co-danger) 45%, var(--co-border)); color: var(--co-danger); }
    .ui-btn--danger:hover { background: color-mix(in srgb, var(--co-danger) 26%, var(--co-bg-raised)); border-color: var(--co-danger); color: var(--co-text-strong); box-shadow: 0 0 10px color-mix(in srgb, var(--co-danger) 22%, transparent); }

    .ui-btn--amber { background: color-mix(in srgb, var(--co-amber) 15%, var(--co-bg-raised)); border-color: color-mix(in srgb, var(--co-amber) 45%, var(--co-border)); color: var(--co-amber); }
    .ui-btn--amber:hover { background: color-mix(in srgb, var(--co-amber) 26%, var(--co-bg-raised)); border-color: var(--co-amber); color: var(--co-text-strong); box-shadow: 0 0 10px color-mix(in srgb, var(--co-amber) 22%, transparent); }

    .ui-btn--teams { background: color-mix(in srgb, var(--co-accent-strong) 15%, var(--co-bg-raised)); border-color: color-mix(in srgb, var(--co-accent-strong) 45%, var(--co-border)); color: var(--co-accent); }
    .ui-btn--teams:hover { background: color-mix(in srgb, var(--co-accent-strong) 26%, var(--co-bg-raised)); border-color: var(--co-accent-strong); color: var(--co-text-strong); box-shadow: 0 0 10px color-mix(in srgb, var(--co-accent-strong) 22%, transparent); }

    .ui-btn--teams-online { background: color-mix(in srgb, var(--co-success) 15%, var(--co-bg-raised)); border-color: color-mix(in srgb, var(--co-success) 50%, var(--co-border)); color: var(--co-success); }
    .ui-btn--teams-online:hover { background: color-mix(in srgb, var(--co-success) 26%, var(--co-bg-raised)); border-color: var(--co-success); color: var(--co-text-strong); box-shadow: 0 0 10px color-mix(in srgb, var(--co-success) 28%, transparent); }

    .ui-btn--ghost { background: transparent; border-color: color-mix(in srgb, var(--co-border) 70%, transparent); color: var(--co-text-secondary); }
    .ui-btn--ghost:hover { background: var(--co-bg-raised-hover); border-color: var(--co-border); color: var(--co-text-strong); }

    /* Flag / Needs-attention toggle. --flag (outlined) = off; --flagged (filled gold) = on. */
    .ui-btn--flag { background: color-mix(in srgb, var(--co-flag) 12%, var(--co-bg-raised)); border-color: color-mix(in srgb, var(--co-flag) 45%, var(--co-border)); color: var(--co-flag); }
    .ui-btn--flag:hover { background: color-mix(in srgb, var(--co-flag) 24%, var(--co-bg-raised)); border-color: var(--co-flag); color: var(--co-text-strong); box-shadow: 0 0 10px color-mix(in srgb, var(--co-flag) 22%, transparent); }
    .ui-btn--flagged { background: var(--co-flag); border-color: var(--co-flag); color: #221a05; font-weight: 700; box-shadow: 0 0 10px color-mix(in srgb, var(--co-flag) 35%, transparent); }
    .ui-btn--flagged:hover { background: color-mix(in srgb, var(--co-flag) 85%, #fff); border-color: var(--co-flag); color: #221a05; }

    /* Dashboard agent-card motion (default layout). Kept here in the UI layer so
       the pure string-producing renderers in src/layouts can reference them. */
    @media (hover: hover) and (pointer: fine) {
      .agent-card:hover { box-shadow: 0 6px 20px rgba(0,0,0,.24); }
    }
    @keyframes copilot-ring-pulse { 0%, 100% { opacity: 0.55; } 50% { opacity: 1; } }
    @keyframes copilot-attn-bar { 0%, 100% { opacity: 0.72; } 50% { opacity: 1; } }
    @keyframes copilot-pill-pulse { 0%, 100% { transform: scale(1); } 50% { transform: scale(1.07); } }
    @keyframes copilot-btn-spin { to { transform: rotate(360deg); } }

    /* Editable session-title affordance. A muted pencil that brightens on hover /
       focus so it's clear the title is click-to-edit. Shared by the dashboard card
       title chip and the game-mode terminal card title. Implemented as ::after so
       it survives textContent updates on the title element. */
    .session-title-display::after {
      content: '✏️';
      flex-shrink: 0;
      margin-left: 6px;
      font-size: .82em;
      opacity: .6;
      filter: grayscale(.2);
      transition: opacity .15s ease, filter .15s ease;
    }
    @media (hover: hover) and (pointer: fine) {
      .session-title-display:hover::after { opacity: 1; filter: none; }
    }
    .session-title-display:focus-visible::after { opacity: 1; filter: none; }

    @media (prefers-reduced-motion: reduce) {
      [data-ring-agent], [data-attn-banner-agent] > *, [data-status-panel-agent] span, .ui-btn__spinner { animation: none !important; }
    }
  `;
  document.head.appendChild(style);
}
