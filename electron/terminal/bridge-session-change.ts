// Bridge session-change helper (native-bridge backend).
//
// The native TUI's bridge registration reports the session the TUI is actually
// attached to. That id is authoritative: `/clear` (or a foreground session
// replacement inside the TUI) re-forks the extension on a NEW session while the
// same PTY keeps running. This pure helper applies such a change to an office's
// in-memory session data so server.ts only has to persist and broadcast it.
// Same pattern as session-history.ts / session-repair.ts (no server.ts import).

import type { SessionHistoryEntry } from './protocol';
import { normalizeTitle, promoteHistoryEntry, pushArchivedEntry } from './session-history';

export interface BridgeSessionData {
  sessionIds: Map<string, string>;
  sessionHistory: Map<string, SessionHistoryEntry[]>;
  sessionMeta: Map<string, { title: string }>;
}

export type BridgeSessionChangeResult =
  | { changed: false }
  | {
      changed: true;
      sessionId: string;
      previousSessionId?: string;
      /** Title now associated with the agent's current session ('' when untitled). */
      title: string;
      /** True when the new session was an archived entry promoted back to current. */
      restoredFromHistory: boolean;
      /** Another agent in the same office that already claims this session id. */
      collidesWithAgentId?: string;
    };

function normalizeSessionId(id: string | undefined): string {
  return (id ?? '').trim().toLowerCase();
}

/**
 * Make `bridgeSessionId` the agent's current session.
 *
 * - No-op when it already is current (case-insensitive), so a reconnect of the
 *   same extension never archives anything.
 * - Archives the previous current session exactly once (title snapshot; the
 *   history helper dedupes by id).
 * - If the new session was previously archived, it is promoted out of history
 *   and its title restored; otherwise the new session starts untitled.
 */
export function applyBridgeSessionChange(
  data: BridgeSessionData,
  agentId: string,
  bridgeSessionId: string,
): BridgeSessionChangeResult {
  const sessionId = bridgeSessionId.trim();
  const target = normalizeSessionId(sessionId);
  if (!target) return { changed: false };

  const previousSessionId = data.sessionIds.get(agentId);
  if (normalizeSessionId(previousSessionId) === target) return { changed: false };

  const history = data.sessionHistory.get(agentId) ?? [];
  if (previousSessionId) {
    pushArchivedEntry(history, previousSessionId, data.sessionMeta.get(agentId)?.title);
  }
  const archived = history.find((entry) => normalizeSessionId(entry.id) === target);
  const promoted = archived ? promoteHistoryEntry(history, archived.id) : undefined;
  data.sessionHistory.set(agentId, history);
  data.sessionIds.set(agentId, sessionId);

  const title = normalizeTitle(promoted?.title) ?? '';
  if (title) data.sessionMeta.set(agentId, { title });
  else data.sessionMeta.delete(agentId);

  let collidesWithAgentId: string | undefined;
  for (const [otherAgentId, otherSessionId] of data.sessionIds) {
    if (otherAgentId !== agentId && normalizeSessionId(otherSessionId) === target) {
      collidesWithAgentId = otherAgentId;
      break;
    }
  }

  return {
    changed: true,
    sessionId,
    ...(previousSessionId ? { previousSessionId } : {}),
    title,
    restoredFromHistory: !!promoted,
    ...(collidesWithAgentId ? { collidesWithAgentId } : {}),
  };
}
