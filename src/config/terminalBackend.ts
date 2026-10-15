/**
 * Terminal backend choices for launching and controlling Copilot agent sessions.
 */
export type TerminalBackendKind = 'native-bridge' | 'node-pty' | 'ui-server' | 'sdk';

/**
 * Default terminal backend. `ui-server` runs one `copilot --ui-server --port 0`
 * TUI per office with an SDK session per agent; switching agent is a foreground
 * switch. When its startup probe fails the server reports the reason and falls
 * back to `native-bridge` (one pinned native TUI per agent + extension bridge),
 * then to `sdk` (one headless host per office + custom renderer). node-pty is
 * reserved for shell mode or an explicit `COPILOT_TERMINAL_BACKEND=node-pty`.
 */
export const DEFAULT_TERMINAL_BACKEND: TerminalBackendKind = 'ui-server';

const TERMINAL_BACKEND_ALIASES: Record<string, TerminalBackendKind> = {
  'native-bridge': 'native-bridge',
  native_bridge: 'native-bridge',
  nativebridge: 'native-bridge',
  native: 'native-bridge',
  bridge: 'native-bridge',
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
 * - `ui-server`: one real TUI per office via `--ui-server`, SDK session per
 *   agent; the default. Falls back to native-bridge, then sdk.
 * - `native-bridge`: one native Copilot TUI per agent under node-pty, with
 *   programmatic control through the authenticated SDK extension bridge.
 * - `node-pty`: legacy render/control path and shell backend.
 * - `sdk`: one spawned headless CLI host per office; the selectable
 *   headless/custom-renderer backend and the native-bridge fallback.
 *
 * The parser trims, lowercases, accepts known aliases, and never throws. Empty
 * or unknown input falls back to `DEFAULT_TERMINAL_BACKEND`.
 */
export function parseTerminalBackend(value: string | undefined): TerminalBackendKind {
  const normalized = value?.trim().toLowerCase();
  if (!normalized) return DEFAULT_TERMINAL_BACKEND;
  return TERMINAL_BACKEND_ALIASES[normalized] ?? DEFAULT_TERMINAL_BACKEND;
}

/**
 * True when the requested backend could not load and the server runs another
 * one instead (ui-server → native-bridge → sdk). Drives the
 * renderer's fallback notice; `loaded` is the server's loaded backend name.
 */
export function didTerminalBackendFallBack(requested: TerminalBackendKind, loaded: string): boolean {
  if (requested === 'native-bridge') return loaded !== 'native-bridge';
  if (requested === 'ui-server') return loaded !== 'ui-server';
  return false;
}
