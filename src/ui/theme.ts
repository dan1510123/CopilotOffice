// App-wide dark / light theme system.
//
// Mechanism: a single injected stylesheet defines CSS custom properties
// (`--co-*`) with DARK values as the default on `:root`, and a `body.co-theme-light`
// override block for LIGHT. Every DOM surface (top bar, panels, dashboard cards,
// status bar, overlays) reads these variables — including the dashboard renderers,
// whose inline-style strings emit `var(--co-*)`. Because everything is driven by
// CSS variables, switching themes is an instant body-class swap; no re-render of
// the dashboard is required.
//
// Dark = the app's original palette (default). Light = a warm cream / burnt-orange
// palette inspired by shiori.sh. Rendering side effects live here in the UI layer
// (never in `src/config`, which must stay pure).

export type ThemeName = 'dark' | 'light';

const THEME_STORAGE_KEY = 'agencyOffice:theme';
const LIGHT_BODY_CLASS = 'co-theme-light';
const THEME_STYLE_ID = 'co-theme-styles';

/**
 * Semantic token -> color for each theme. Keys become CSS custom properties as
 * `--co-<key>`. Keep this the single source of truth: add a token here, use it
 * everywhere as `var(--co-<key>)`.
 */
const DARK: Record<string, string> = {
  // Backgrounds
  'bg-app': '#171724',
  'bg-panel': '#1e1e2e',
  'bg-header': '#141424',
  'bg-card': '#13131f',
  'bg-card-sel': '#1e1e3a',
  'bg-raised': '#1e1e30',
  'bg-raised-hover': '#262c40',
  'bg-inset': '#12141f',
  'bg-tab-active': '#232342',
  'bg-badge-inset': '#1a2030',
  'bg-statusbar': 'rgba(20,23,36,0.5)',
  'bg-overlay-scrim': 'rgba(0,0,0,0.7)',
  'bg-divider': '#1a1a30',

  // Borders
  border: '#2c2c46',
  'border-subtle': '#252540',
  'border-strong': '#333333',
  'border-header': '#2a2a4a',
  'border-badge-inset': '#2a3550',
  'sel-border': '#6677ff',

  // Text
  text: '#d7defa',
  'text-strong': '#dddeef',
  'text-secondary': '#9a9ab8',
  'text-muted': '#777788',
  'text-faint': '#555566',
  heading: '#88aaff',

  // Accents
  accent: '#8fb7ff',
  'accent-strong': '#6d8bff',
  'accent-soft': '#5da9ff',
  'accent-link': '#8ec3ff',
  success: '#46d17f',
  danger: '#e0607a',
  amber: '#ffb86c',

  // Accent-tinted surfaces (fixed alpha; can't append alpha to a var())
  'pc-sprite-bg': 'rgba(93,169,255,0.13)',
  'pc-sprite-border': 'rgba(93,169,255,0.27)',
};

const LIGHT: Record<string, string> = {
  // Backgrounds — warm cream / paper (shiori.sh inspired)
  'bg-app': '#f3e8d6',
  'bg-panel': '#fbf4ea',
  'bg-header': '#efe3d1',
  'bg-card': '#fffdf9',
  'bg-card-sel': '#fbe7d3',
  'bg-raised': '#f6ecdd',
  'bg-raised-hover': '#efe0cb',
  'bg-inset': '#f1e6d5',
  'bg-tab-active': '#fbe7d3',
  'bg-badge-inset': '#f2e7d6',
  'bg-statusbar': 'rgba(239,227,209,0.82)',
  'bg-overlay-scrim': 'rgba(74,58,38,0.35)',
  'bg-divider': '#eaddc8',

  // Borders — warm tan
  border: '#e3d2b8',
  'border-subtle': '#eaddc8',
  'border-strong': '#d8c4a6',
  'border-header': '#e3d2b8',
  'border-badge-inset': '#e0ccae',
  'sel-border': '#e08a3c',

  // Text — warm dark brown
  text: '#4a3f30',
  'text-strong': '#2e2416',
  'text-secondary': '#746551',
  'text-muted': '#97876f',
  'text-faint': '#b3a385',
  heading: '#cf7a2b',

  // Accents — burnt orange
  accent: '#d97a2b',
  'accent-strong': '#c26a1e',
  'accent-soft': '#e0954a',
  'accent-link': '#c26a1e',
  success: '#3f9a5f',
  danger: '#cf4f68',
  amber: '#d98a2a',

  // Accent-tinted surfaces
  'pc-sprite-bg': 'rgba(224,149,74,0.15)',
  'pc-sprite-border': 'rgba(224,149,74,0.34)',
};

function toVarBlock(tokens: Record<string, string>): string {
  return Object.entries(tokens)
    .map(([k, v]) => `  --co-${k}: ${v};`)
    .join('\n');
}

/**
 * One-time injection of the theme stylesheet. Idempotent + hot-reload safe
 * (guarded by element id), mirroring `injectTopBarStyles()` / `injectUiKit()`.
 */
export function injectThemeStyles(): void {
  if (typeof document === 'undefined') return;
  if (document.getElementById(THEME_STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = THEME_STYLE_ID;
  style.textContent = `
:root {
${toVarBlock(DARK)}
}
body.${LIGHT_BODY_CLASS} {
${toVarBlock(LIGHT)}
}
`;
  document.head.appendChild(style);
}

function sanitizeTheme(raw: string | null): ThemeName {
  return raw === 'light' ? 'light' : 'dark';
}

/** The active theme (defaults to dark, or the persisted choice). */
export function getTheme(): ThemeName {
  if (typeof localStorage === 'undefined') return 'dark';
  return sanitizeTheme(localStorage.getItem(THEME_STORAGE_KEY));
}

/** Apply a theme: toggle the body class and (optionally) persist the choice. */
export function applyTheme(name: ThemeName, persist = true): void {
  if (typeof document !== 'undefined' && document.body) {
    document.body.classList.toggle(LIGHT_BODY_CLASS, name === 'light');
  }
  if (persist && typeof localStorage !== 'undefined') {
    try { localStorage.setItem(THEME_STORAGE_KEY, name); } catch { /* ignore */ }
  }
}

/** Flip between dark and light, persist, and return the new theme. */
export function toggleTheme(): ThemeName {
  const next: ThemeName = getTheme() === 'light' ? 'dark' : 'light';
  applyTheme(next);
  return next;
}

/** Inject the stylesheet and apply the persisted theme. Call once on boot. */
export function initTheme(): ThemeName {
  injectThemeStyles();
  const theme = getTheme();
  applyTheme(theme, false);
  return theme;
}
