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
import type { BringOnlineOutcome, BringOnlineResult } from '../../electron/orchestrator/types';

export interface ExecuteBringOnlineDeps {
  /** Start an idle-seated agent (setAgentStarting + terminalStart w/ correct cwd). Resolves true on success. */
  startSeated: (officeId: string, agentId: string) => Promise<boolean>;
  /** Delegate reserve activation to OfficeScene; resolves the spawn outcome. */
  activateReserve: (deskId: string) => Promise<BringOnlineOutcome>;
}

export async function executeBringOnline(
  agentId: string,
  deps: ExecuteBringOnlineDeps,
): Promise<BringOnlineResult> {
  const officeId = officeManager.currentOfficeId;
  if (!officeId) {
    return { agentId, outcome: 'failed', message: 'No office is currently active.' };
  }

  const candidate = computeBringOnlineCandidates().find((c) => c.agentId === agentId);
  if (!candidate) {
    // Not dormant/valid: either unknown id, already active, or (reserve) no open seat.
    const status = officeManager.getAgentStatus(officeId, agentId);
    if (status?.state === 'active') {
      return { agentId, outcome: 'already-active', message: `${agentId} is already online.` };
    }
    return {
      agentId,
      outcome: 'invalid-target',
      message: `${agentId} is not a valid agent to bring online in this office.`,
    };
  }

  try {
    if (candidate.source === 'idle-seated') {
      const ok = await deps.startSeated(officeId, agentId);
      return ok
        ? { agentId, outcome: 'started', message: `${candidate.name} is coming online.` }
        : { agentId, outcome: 'failed', message: `Failed to start ${candidate.name}.` };
    }

    // Reserve: delegate to the scene.
    if (!candidate.deskId) {
      return { agentId, outcome: 'invalid-target', message: `${agentId} has no reserve desk.` };
    }
    const outcome = await deps.activateReserve(candidate.deskId);
    const message =
      outcome === 'started'
        ? `${candidate.name} is walking in.`
        : outcome === 'already-active'
          ? `${candidate.name} is already online.`
          : `Could not activate ${candidate.name}.`;
    return { agentId, outcome, message };
  } catch (err) {
    return {
      agentId,
      outcome: 'failed',
      message: `Error bringing ${agentId} online: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
