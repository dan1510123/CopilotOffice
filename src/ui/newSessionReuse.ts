// "New Session" fast path — reuse a live native TUI via the `/new` slash command.
//
// Clicking "New Session" (or Ctrl+Shift+N) normally runs the coordinator's
// close+respawn chain: the server kills the agent's PTY, re-mints a session id,
// and a brand-new native Copilot TUI process is launched. When the agent's TUI
// is ALREADY running we can instead reuse that live process by sending the
// native `/new` slash command: the bridge re-forks the extension onto a fresh
// session on the SAME PTY and emits `session-meta-updated`, which both terminal
// controllers already handle (their `/clear` rebind path) to resync the session
// id + cache generation token. This avoids a full process teardown/relaunch.
//
// Only valid for the native-bridge backend rendering a real TUI in copilot mode:
//   * `sdk` backend has no keyboard-driven TUI to accept a slash command;
//   * `node-pty` shell mode is a plain shell where `/new` is meaningless;
//   * a dead PTY must take the normal cold-start path.

type NewSessionBridge = {
  getBackendInfo?: () => Promise<{ name: string } | null>;
  queryAgentStatuses: (officeId?: string) => Promise<Record<string, { alive: boolean }>>;
  terminalWrite: (officeId: string, agentId: string, data: string) => Promise<{ success: boolean; error?: string }>;
};

// Ctrl-U (\x15) clears any half-typed input line before submitting so a pending
// keystroke can't corrupt the command; `\r` submits it. Mirrors the sequence the
// native-bridge smoke harness uses to drive an in-place session replacement.
const NEW_SESSION_SEQUENCE = '\x15/new\r';

// The loaded backend is decided once at server startup and never changes during
// a renderer session, so memoize the lookup (a single in-flight promise avoids a
// duplicate IPC under concurrent callers).
let backendNamePromise: Promise<string | null> | null = null;

function resolveBackendName(bridge: NewSessionBridge): Promise<string | null> {
  if (!backendNamePromise) {
    backendNamePromise = (async () => {
      try {
        const info = await bridge.getBackendInfo?.();
        return info?.name ?? null;
      } catch {
        return null;
      }
    })();
  }
  return backendNamePromise;
}

/** Test seam: forget the memoized backend name (also used if a retry is wanted). */
export function resetNewSessionBackendCache(): void {
  backendNamePromise = null;
}

/**
 * True when "New Session" can reuse the agent's already-running native TUI via
 * `/new` instead of a full close+respawn. Requires the native-bridge backend,
 * copilot (not shell) launch mode, and a live PTY for this agent. Never throws.
 */
export async function canReuseLivePtyForNewSession(
  bridge: NewSessionBridge | undefined,
  officeId: string,
  agentId: string,
  launchMode: 'copilot' | 'shell',
): Promise<boolean> {
  if (!bridge) return false;
  if (launchMode === 'shell') return false;
  const backend = await resolveBackendName(bridge);
  if (backend !== 'native-bridge') return false;
  try {
    const statuses = await bridge.queryAgentStatuses(officeId);
    return statuses?.[agentId]?.alive === true;
  } catch {
    return false;
  }
}

/**
 * Send `/new` to the agent's live native TUI. Returns true when the write was
 * accepted; a false/throw lets the caller fall back to the full reset path.
 */
export async function reuseLivePtyForNewSession(
  bridge: NewSessionBridge,
  officeId: string,
  agentId: string,
): Promise<boolean> {
  try {
    const res = await bridge.terminalWrite(officeId, agentId, NEW_SESSION_SEQUENCE);
    return res?.success !== false;
  } catch {
    return false;
  }
}
