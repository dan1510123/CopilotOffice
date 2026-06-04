// Per-office session map repair (feature 002, V3 in data-model.md).
//
// Pure helper extracted from `electron/terminal/server.ts` so the V3 invariant
// can be unit-tested without spinning up the whole terminal server bundle.
// No filesystem, no process state — caller passes the in-memory map and the
// function rewrites duplicates in place.

import * as crypto from 'crypto';

export interface MutableOfficeSessionData {
  sessionIds: Map<string, string>;
}

export interface RepairLogger {
  warn: (msg: string) => void;
}

/**
 * Scan a freshly loaded office session map for duplicate sessionIds across
 * agentId keys. Keep the first occurrence; re-mint distinct UUIDs for any
 * later collisions. Emits a `[TermServer] Repaired duplicate sessionId …`
 * warning per repair. Returns true if any entry was rewritten (caller should
 * persist).
 *
 * V3 invariant: values of `data.sessionIds` MUST be pairwise distinct.
 */
export function repairDuplicateSessionIds(
  officeId: string,
  data: MutableOfficeSessionData,
  options: { logger?: RepairLogger; mintId?: () => string } = {},
): boolean {
  const logger = options.logger ?? { warn: (msg) => console.warn(msg) };
  const mintId = options.mintId ?? (() => crypto.randomUUID());
  const seen = new Map<string, string>(); // sessionId → first-seen agentId
  let repaired = false;
  for (const [agentId, sessionId] of data.sessionIds.entries()) {
    const firstAgent = seen.get(sessionId);
    if (firstAgent === undefined) {
      seen.set(sessionId, agentId);
      continue;
    }
    let fresh = mintId();
    // Defensive: the mint function might collide with an existing UUID in
    // pathological test setups. Loop until we find an unused id.
    while (seen.has(fresh) || data.sessionIds.get(agentId) === fresh) {
      fresh = mintId();
    }
    data.sessionIds.set(agentId, fresh);
    seen.set(fresh, agentId);
    logger.warn(
      `[TermServer] Repaired duplicate sessionId for officeId=${officeId} agentId=${agentId} from=${sessionId} to=${fresh}`,
    );
    repaired = true;
  }
  return repaired;
}
