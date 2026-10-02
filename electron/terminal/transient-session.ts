import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import type { SessionHistoryEntry } from './protocol';
import { resolveCopilotHome } from './custom-agents';

/**
 * Persisted lease for one fleet-only session. The lease is the recovery record:
 * if the terminal server exits mid-task, the next server load restores the prior
 * current-session pointer and removes every session-state directory minted by
 * this transient lifecycle.
 */
export interface TransientSessionRecord {
  lifecycleId: string;
  sessionId: string;
  sessionIds: string[];
  previousSessionId: string | null;
  previousMeta: { title: string } | null;
  phase: 'active' | 'disposing';
}

export interface MutableTransientSessionData {
  sessionIds: Map<string, string>;
  sessionHistory: Map<string, SessionHistoryEntry[]>;
  sessionMeta: Map<string, { title: string }>;
}

export interface RestoreTransientSessionResult {
  restoredCurrent: boolean;
  restoredSessionId: string | null;
  removedHistoryEntries: number;
  transientSessionIds: string[];
}

export type ExistingTransientBeginAction = 'cleanup-first' | 'reuse' | 'reject';

/**
 * A stuck disposing lease is recoverable by any later begin. Active leases are
 * reusable only by the same lifecycle id; another active lifecycle is rejected.
 */
export function classifyExistingTransientBegin(
  record: TransientSessionRecord,
  requestedLifecycleId: string,
): ExistingTransientBeginAction {
  if (record.phase === 'disposing') return 'cleanup-first';
  return record.lifecycleId === requestedLifecycleId ? 'reuse' : 'reject';
}

/** Safely coerce an optional persisted transient record from a session file. */
export function coerceTransientSessionRecord(raw: unknown): TransientSessionRecord | null {
  if (!raw || typeof raw !== 'object') return null;
  const candidate = raw as Partial<TransientSessionRecord>;
  const lifecycleId = typeof candidate.lifecycleId === 'string' ? candidate.lifecycleId.trim() : '';
  const sessionId = typeof candidate.sessionId === 'string' ? candidate.sessionId.trim() : '';
  if (!lifecycleId || !sessionId) return null;

  const sessionIds = Array.isArray(candidate.sessionIds)
    ? candidate.sessionIds.filter((id): id is string => typeof id === 'string' && id.length > 0)
    : [];
  if (!sessionIds.includes(sessionId)) sessionIds.push(sessionId);

  const previousSessionId =
    typeof candidate.previousSessionId === 'string' && candidate.previousSessionId.length > 0
      ? candidate.previousSessionId
      : null;
  const previousMeta =
    candidate.previousMeta &&
    typeof candidate.previousMeta === 'object' &&
    typeof candidate.previousMeta.title === 'string'
      ? { title: candidate.previousMeta.title }
      : null;

  return {
    lifecycleId,
    sessionId,
    sessionIds: [...new Set(sessionIds)],
    previousSessionId,
    previousMeta,
    phase: candidate.phase === 'disposing' ? 'disposing' : 'active',
  };
}

/**
 * Atomically replace an agent's current pointer with a fresh fleet-only session
 * without archiving or overwriting the prior persistent session.
 */
export function beginTransientSessionState(
  data: MutableTransientSessionData,
  agentId: string,
  lifecycleId: string,
  title: string,
  mintId: () => string = crypto.randomUUID,
): TransientSessionRecord {
  const sessionId = mintDistinctSessionId(data, mintId);
  const previousSessionId = data.sessionIds.get(agentId) ?? null;
  const previousMeta = data.sessionMeta.has(agentId)
    ? { ...data.sessionMeta.get(agentId)! }
    : null;

  data.sessionIds.set(agentId, sessionId);
  data.sessionMeta.set(agentId, { title });

  return {
    lifecycleId,
    sessionId,
    sessionIds: [sessionId],
    previousSessionId,
    previousMeta,
    phase: 'active',
  };
}

/** Track an authoritative replacement id reported by the native bridge. */
export function trackTransientSessionId(
  record: TransientSessionRecord,
  sessionId: string,
): void {
  const normalized = sessionId.trim();
  if (!normalized) return;
  record.sessionId = normalized;
  if (!record.sessionIds.includes(normalized)) record.sessionIds.push(normalized);
}

/**
 * Restore the exact pre-fleet current pointer/title and remove only transient
 * entries from history. Repeating this operation is safe.
 */
export function restoreTransientSessionState(
  data: MutableTransientSessionData,
  agentId: string,
  record: TransientSessionRecord,
): RestoreTransientSessionResult {
  const transientIds = new Set(record.sessionIds);
  transientIds.add(record.sessionId);

  const current = data.sessionIds.get(agentId);

  const history = data.sessionHistory.get(agentId) ?? [];
  const filteredHistory = history.filter((entry) => !transientIds.has(entry.id));
  const removedHistoryEntries = history.length - filteredHistory.length;
  if (filteredHistory.length > 0) data.sessionHistory.set(agentId, filteredHistory);
  else data.sessionHistory.delete(agentId);

  const ownsCurrent = current == null || transientIds.has(current);
  if (ownsCurrent) {
    if (record.previousSessionId) data.sessionIds.set(agentId, record.previousSessionId);
    else data.sessionIds.delete(agentId);

    if (record.previousMeta) data.sessionMeta.set(agentId, { ...record.previousMeta });
    else data.sessionMeta.delete(agentId);
  }

  return {
    restoredCurrent: ownsCurrent,
    restoredSessionId: ownsCurrent ? record.previousSessionId : (current ?? null),
    removedHistoryEntries,
    transientSessionIds: [...transientIds],
  };
}

export function getSessionStateDirectory(
  sessionId: string,
  copilotHome: string = resolveCopilotHome(),
): string {
  if (
    !sessionId
    || path.basename(sessionId) !== sessionId
    || sessionId.includes('/')
    || sessionId.includes('\\')
  ) {
    throw new Error(`Invalid Copilot session id for deletion: ${JSON.stringify(sessionId)}`);
  }
  const root = path.resolve(copilotHome, 'session-state');
  const target = path.resolve(root, sessionId);
  if (path.dirname(target) !== root) {
    throw new Error(`Copilot session-state path escaped its root: ${target}`);
  }
  return target;
}

/** Delete only the session-state directories owned by this transient lease. */
export async function removeTransientSessionStateDirectories(
  record: TransientSessionRecord,
  copilotHome: string = resolveCopilotHome(),
): Promise<string[]> {
  const sessionIds = [...new Set([record.sessionId, ...record.sessionIds])];
  for (const sessionId of sessionIds) {
    await fs.promises.rm(getSessionStateDirectory(sessionId, copilotHome), {
      recursive: true,
      force: true,
    });
  }
  return sessionIds;
}

function mintDistinctSessionId(
  data: MutableTransientSessionData,
  mintId: () => string,
): string {
  const used = new Set(data.sessionIds.values());
  for (const entries of data.sessionHistory.values()) {
    for (const entry of entries) used.add(entry.id);
  }

  let sessionId = mintId();
  while (used.has(sessionId)) sessionId = mintId();
  return sessionId;
}
