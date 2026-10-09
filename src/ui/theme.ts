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
  // Backgrounds — softer, warmer-neutral slate (less pure-black, friendlier)
  'bg-app': '#1b1c28',
  'bg-panel': '#20212f',
  'bg-header': '#1c1d29',
  'bg-card': '#272837',
  'bg-card-sel': '#303047',
  'bg-raised': '#303141',
  'bg-raised-hover': '#3a3c50',
  'bg-inset': '#212230',
  'bg-tab-active': '#303047',
  'bg-badge-inset': '#242636',
  'bg-statusbar': 'rgba(28,29,41,0.72)',
  'bg-overlay-scrim': 'rgba(0,0,0,0.7)',
  'bg-divider': '#2a2c3e',

  // Borders — lighter, lower-contrast edges
  border: '#3b3d51',
  'border-subtle': '#36384b',
  'border-strong': '#54586f',
  'border-header': '#34364c',
  'border-badge-inset': '#343852',
  'sel-border': '#a8a2ed',

  // Text — slightly warmer off-white; brighter muted tiers for readability
  text: '#e0e1ee',
  'text-strong': '#f4f1fa',
  'text-secondary': '#b5b7cf',
  'text-muted': '#a3a7bf',
  'text-faint': '#7b819b',
  heading: '#c7befa',

  // Accents — calmer lavender / mint instead of hard electric blue
  accent: '#b8b0f4',
  'accent-strong': '#a69aec',
  'accent-soft': '#a9b8f5',
  'accent-link': '#b0b8f6',
  success: '#8cd8b3',
  danger: '#ee92a6',
  amber: '#ffb86c',
  // User "Flagged / Needs attention" marker. Deliberately distinct from every
  // status color (esp. waiting=#ffb86c) so a manual flag never reads as a status.
  flag: '#f5b93d',

  // Accent-tinted surfaces (fixed alpha; can't append alpha to a var())
  'pc-sprite-bg': 'rgba(168,162,237,0.14)',
  'pc-sprite-border': 'rgba(168,162,237,0.30)',
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
  'text-muted': '#7d6c55',
  'text-faint': '#99886d',
  heading: '#cf7a2b',

  // Accents — burnt orange
  accent: '#d97a2b',
  'accent-strong': '#c26a1e',
  'accent-soft': '#e0954a',
  'accent-link': '#c26a1e',
  success: '#3f9a5f',
  danger: '#cf4f68',
  amber: '#d98a2a',
  flag: '#c9871a',

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
