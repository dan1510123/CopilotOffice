// Orchestrator candidate computation (spec 016 — T015, renderer).
//
// Computes the set of dormant agents the orchestrator may propose to bring
// online in the currently viewed office. Runs in the renderer because it reads
// OfficeManager (the source of truth for currentOfficeId + per-agent status) and
// the agents.ts registries. Backs the main-process `list_office_agents` tool via
// the `orchestrator:candidates:*` round-trip.
//
// Candidate rules (data-model.md):
//   - idle-seated: current office roster (AGENTS) whose status is slacking/absent.
//   - reserve: only when the layout supports reserve agents — RESERVE_AGENTS whose
//     config is not already seated (not in AGENTS).
//   - agents currently active (starting/ready/waiting/thinking/error) are excluded.

import { AGENTS, RESERVE_AGENTS } from '../config/agents';
import { officeManager } from './officeManager';
import { getLayout } from '../layouts';
import type { BringOnlineCandidate } from '../../electron/orchestrator/types';

export function computeBringOnlineCandidates(targetOfficeId?: string): BringOnlineCandidate[] {
  const officeId = targetOfficeId ?? officeManager.currentOfficeId;
  if (!officeId) return [];

  const candidates: BringOnlineCandidate[] = [];

  // Idle-seated: agents in the current office roster that are dormant.
  for (const agent of AGENTS) {
    const status = officeManager.getAgentStatus(officeId, agent.id);
    const isActive = status?.state === 'active';
    if (isActive) continue;
    candidates.push({
      agentId: agent.id,
      name: agent.name,
      skill: agent.skill,
      description: agent.description,
      source: 'idle-seated',
      deskId: null,
      officeId,
    });
  }

  // Reserve: only when the current layout supports reserve agents.
  const layout = officeManager.getOffice(officeId)?.config.layout ?? 'default';
  const supportsReserve = getLayout(layout).behaviors.supportsReserveAgents;
  if (supportsReserve) {
    const seated = new Set(AGENTS.map((a) => a.id));
    for (const [deskId, reserve] of Object.entries(RESERVE_AGENTS)) {
      if (seated.has(reserve.id)) continue; // already spawned/seated
      candidates.push({
        agentId: reserve.id,
        name: reserve.name,
        skill: reserve.skill,
        description: reserve.description,
        source: 'reserve',
        deskId,
        officeId,
      });
    }
  }

  return candidates;
}
