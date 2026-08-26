// Orchestrator bring-online execution (spec 016 — T016, renderer).
//
// Given an APPROVED agentId (the permission gate has already fired in main), this
// resolves the target against the current candidate set and performs the actual
// bring-online. It owns the idle-seated path directly (OfficeManager is in scope
// here). Reserve activation MUST be delegated to OfficeScene, because
// `spawnReserveAgent(deskId)` is a private scene method that builds the NPC,
// physics collider, and walk-in animation and cannot run from an OfficeManager-
// owned module — hence the injected `activateReserve` delegate (which the wiring
// in src/main.ts backs with a `game.events` round-trip to the scene).

import { computeBringOnlineCandidates } from './orchestratorCandidates';
import { officeManager } from './officeManager';
import type { BringOnlineCandidate, BringOnlineOutcome, BringOnlineResult } from '../../electron/orchestrator/types';

/**
 * Resolve the identifier the orchestrator passed to `bring_agent_online` to a
 * concrete candidate. The model frequently passes a display NAME (e.g. "Rhys")
 * instead of the agentId (e.g. "office-6-reserve-4"), which previously fell
 * straight through to `invalid-target`. Match by exact id, then case-insensitive
 * id, then exact name, then a unique fuzzy name. When the identifier is blank /
 * omitted, default to the next dormant agent in the office's list (the first
 * candidate) so "bring someone online" works without naming an agent.
 */
function resolveCandidate(
  query: string | undefined | null,
  candidates: BringOnlineCandidate[],
): BringOnlineCandidate | null {
  const q = (query ?? '').trim();
  if (!q) return candidates[0] ?? null;
  const lc = q.toLowerCase();
  const byId = candidates.find((c) => c.agentId === q)
    ?? candidates.find((c) => c.agentId.toLowerCase() === lc);
  if (byId) return byId;
  const byName = candidates.find((c) => c.name.toLowerCase() === lc);
  if (byName) return byName;
  const fuzzy = candidates.filter(
    (c) => c.name.toLowerCase().includes(lc) || lc.includes(c.name.toLowerCase()),
  );
  return fuzzy.length === 1 ? fuzzy[0] : null;
}

export interface ExecuteBringOnlineDeps {
  /** Start an idle-seated agent (setAgentStarting + terminalStart w/ correct cwd). Resolves true on success. */
  startSeated: (officeId: string, agentId: string) => Promise<boolean>;
  /** Delegate reserve activation to OfficeScene; resolves the spawn outcome. */
  activateReserve: (deskId: string) => Promise<BringOnlineOutcome>;
  /**
   * Switch the desktop to `officeId` and resolve once the scene has settled.
   * Required because reserve activation (`spawnReserveAgent`) is bound to the
   * CURRENTLY rendered office — an agent in a non-current office can only be
   * brought online after that office is in view. Optional so existing callers
   * (which always target the current office) need no change.
   */
  switchOffice?: (officeId: string) => Promise<void>;
  /**
   * True only when the agent has a LIVE PTY session server-side. Used to
   * distinguish a genuinely-online agent from one the renderer merely marks
   * `active` while its session is dead (a dropped or half-completed restart).
   * Optional so existing callers/tests default to the prior status-only behavior.
   */
  isSessionAlive?: (officeId: string, agentId: string) => Promise<boolean>;
}

/**
 * Bring a dormant agent online. `targetOfficeId` names the office the agent lives
 * in; when it differs from the current office we auto-switch first (via the
 * injected `switchOffice` delegate) so the roster + scene reflect the target,
 * otherwise reserve spawn and candidate computation would run against the wrong
 * office and return `invalid-target`. Defaults to the current office.
 */
export async function executeBringOnline(
  agentId: string,
  deps: ExecuteBringOnlineDeps,
  targetOfficeId?: string,
): Promise<BringOnlineResult> {
  // Auto-switch to the target office before computing candidates / spawning.
  if (targetOfficeId && targetOfficeId !== officeManager.currentOfficeId && deps.switchOffice) {
    try {
      await deps.switchOffice(targetOfficeId);
    } catch (err) {
      return {
        agentId,
        outcome: 'failed',
        message: `Could not switch to the target office: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  const officeId = targetOfficeId ?? officeManager.currentOfficeId;
  if (!officeId) {
    return { agentId, outcome: 'failed', message: 'No office is currently active.' };
  }

  const candidate = resolveCandidate(agentId, computeBringOnlineCandidates(officeId));
  if (!candidate) {
    // Not dormant/valid: either unknown id/name, already active, or (reserve) no open seat.
    const status = officeManager.getAgentStatus(officeId, agentId);
    if (status?.state === 'active') {
      // The renderer marks it active — but that can be stale while the PTY is
      // dead (a dropped or half-completed restart). Only report "already online"
      // when a LIVE session actually exists; otherwise re-warm the seated agent
      // so a desynced agent can be restored instead of being permanently stuck.
      const alive = deps.isSessionAlive ? await deps.isSessionAlive(officeId, agentId) : true;
      if (alive) {
        return { agentId, outcome: 'already-active', message: `${agentId} is already online.` };
      }
      const ok = await deps.startSeated(officeId, agentId);
      return ok
        ? { agentId, outcome: 'started', message: `${agentId} is coming back online.` }
        : { agentId, outcome: 'failed', message: `Failed to restore ${agentId}'s session.` };
    }
    return {
      agentId,
      outcome: 'invalid-target',
      message: `${agentId} is not a valid agent to bring online in this office.`,
    };
  }

  // Use the resolved canonical id from here on (the caller may have passed a name).
  const resolvedId = candidate.agentId;

  try {
    if (candidate.source === 'idle-seated') {
      const ok = await deps.startSeated(officeId, resolvedId);
      return ok
        ? { agentId: resolvedId, outcome: 'started', message: `${candidate.name} is coming online.` }
        : { agentId: resolvedId, outcome: 'failed', message: `Failed to start ${candidate.name}.` };
    }

    // Reserve: delegate to the scene.
    if (!candidate.deskId) {
      return { agentId: resolvedId, outcome: 'invalid-target', message: `${candidate.name} has no open reserve seat.` };
    }
    const outcome = await deps.activateReserve(candidate.deskId);
    const message =
      outcome === 'started'
        ? `${candidate.name} is walking in.`
        : outcome === 'already-active'
          ? `${candidate.name} is already online.`
          : `Could not activate ${candidate.name}.`;
    return { agentId: resolvedId, outcome, message };
  } catch (err) {
    return {
      agentId: resolvedId,
      outcome: 'failed',
      message: `Error bringing ${candidate.name} online: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
