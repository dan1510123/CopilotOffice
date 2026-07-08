/**
 * Terminal backend choices for launching and controlling Copilot agent sessions.
 */
export type TerminalBackendKind = 'node-pty' | 'ui-server' | 'sdk';

/**
 * Legacy node-pty backend. This remains the default behavior and permanent
 * fallback when an experimental backend is unavailable.
 */
export const DEFAULT_TERMINAL_BACKEND: TerminalBackendKind = 'node-pty';

const TERMINAL_BACKEND_ALIASES: Record<string, TerminalBackendKind> = {
  'node-pty': 'node-pty',
  nodepty: 'node-pty',
  pty: 'node-pty',
  legacy: 'node-pty',
  'ui-server': 'ui-server',
  ui_server: 'ui-server',
  'ui server': 'ui-server',
  ui: 'ui-server',
  sdk: 'sdk',
  headless: 'sdk',
};

/**
 * Parse a user/config/env value into a supported terminal backend kind.
 *
 * Values:
 * - `node-pty`: legacy render/control path; default and permanent fallback.
 * - `ui-server`: Variant-1 SDK control plane where node-pty hosts the real TUI
 *   via `--ui-server`; T008 handles the capability probe and auto-fallback.
 * - `sdk`: existing headless SDK backend retained for compatibility.
 *
 * The parser trims, lowercases, accepts known aliases, and never throws. Empty
 * or unknown input falls back to `DEFAULT_TERMINAL_BACKEND`.
 */
export function parseTerminalBackend(value: string | undefined): TerminalBackendKind {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_TERMINAL_BACKEND;
  return TERMINAL_BACKEND_ALIASES[normalized] ?? DEFAULT_TERMINAL_BACKEND;
}
