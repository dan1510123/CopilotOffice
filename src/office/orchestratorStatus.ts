// Orchestrator situational-awareness compute (spec 017 — US2/US3, renderer).
//
// Backs the read-only `get_active_agents` / `list_agents_awaiting_input` tools via
// the `orchestrator:active-agents:*` / `orchestrator:awaiting-agents:*` round-trips.
// Runs in the renderer because it reads OfficeManager (the source of truth for the
// office roster + per-agent status). Status/labels derive ONLY from
// `agentStatusPresentation` (Principle V — no hardcoded labels/colors).

import { AGENTS, RESERVE_AGENTS } from '../config/agents';
import { officeManager } from './officeManager';
import type { AgentStatus } from './officeManager';
import {
  resolveStatusKey,
  presentationFor,
  describeActivity,
  formatElapsedMmSs,
} from '../config/agentStatusPresentation';
import type { ActiveAgentSnapshot, AwaitingAgent } from '../../electron/orchestrator/types';

/** Resolve an agent's display name from office custom roster → default → reserve. */
function resolveAgentName(officeId: string, agentId: string): string {
  const local = resolveInOffice(officeId, agentId);
  if (local) return local;
  const seated = AGENTS.find((a) => a.id === agentId);
  if (seated) return seated.name;
  for (const reserve of Object.values(RESERVE_AGENTS)) {
    if (reserve.id === agentId) return reserve.name;
  }
  // Fall back to any office's custom roster: a session-bearing agent can be
  // rolled up under a different office than the one that owns its config
  // (e.g. `office-5-agent-0` surfacing while the current office is `office-0`).
  for (const config of officeManager.getAllOffices()) {
    if (config.id === officeId) continue;
    const found = resolveInOffice(config.id, agentId);
    if (found) return found;
  }
  return agentId;
}

/** Look up a display name in a single office's custom + custom-reserve rosters. */
function resolveInOffice(officeId: string, agentId: string): string | undefined {
  const office = officeManager.getOffice(officeId)?.config;
  const custom = office?.customAgents?.find((a) => a.id === agentId);
  if (custom) return custom.name;
  const customReserve = office?.customReserveAgents
    ? Object.values(office.customReserveAgents).find((a) => a.id === agentId)
    : undefined;
  if (customReserve) return customReserve.name;
  return undefined;
}

/** Build one snapshot for a session-bearing agent (any active state). */
function buildSnapshot(
  officeId: string,
  officeName: string,
  agentId: string,
  status: AgentStatus,
  now: number,
): ActiveAgentSnapshot {
  const statusKey = resolveStatusKey(status);
  const presentation = presentationFor(status);
  const activity = describeActivity(status);
  const awaitingInput = statusKey === 'waiting';
  // Prefer the actual ask_user question (captured on tool_start into taskSummary)
  // so the orchestrator can relay real context, not just the generic label. Fall
  // back to the activity detail / thinkingDetail / a generic notice.
  const capturedQuestion = status.taskSummary?.trim();
  const pendingQuestion = awaitingInput
    ? capturedQuestion || activity || status.thinkingDetail?.trim() || 'Waiting for your answer'
    : undefined;
  return {
    agentId,
    name: resolveAgentName(officeId, agentId),
    officeId,
    officeName,
    statusKey,
    statusLabel: presentation.label,
    activity,
    timeInState: formatElapsedMmSs(status.activityStartTime, now),
    awaitingInput,
    ...(pendingQuestion !== undefined ? { pendingQuestion } : {}),
  };
}

/**
 * Enumerate every session-bearing agent across ALL offices (FR-008/013). A
 * session-bearing agent is one whose status is `active` (i.e. starting/ready/
 * done/waiting/thinking/error) — `slacking` agents have no live session and are
 * excluded. `done`/idle-online agents are NOT omitted.
 */
export function computeActiveAgents(now: number = Date.now()): ActiveAgentSnapshot[] {
  const snapshots: ActiveAgentSnapshot[] = [];
  for (const config of officeManager.getAllOffices()) {
    const office = officeManager.getOffice(config.id);
    if (!office) continue;
    for (const [agentId, status] of office.agents) {
      if (status.state !== 'active') continue; // no live session
      snapshots.push(buildSnapshot(config.id, config.name, agentId, status, now));
    }
  }
  return snapshots;
}

/**
 * The `waiting` subset (FR-010), longest-waiting first. Reuses the US2 snapshot
 * builder, filtered to `awaitingInput` and sorted by time-in-state descending
 * (i.e. oldest `activityStartTime` first).
 */
export function computeAwaitingAgents(now: number = Date.now()): AwaitingAgent[] {
  const waiting: Array<{ snapshot: AwaitingAgent; startedAt: number }> = [];
  for (const config of officeManager.getAllOffices()) {
    const office = officeManager.getOffice(config.id);
    if (!office) continue;
    for (const [agentId, status] of office.agents) {
      if (status.state !== 'active') continue;
      if (resolveStatusKey(status) !== 'waiting') continue;
      waiting.push({
        snapshot: buildSnapshot(config.id, config.name, agentId, status, now),
        startedAt: status.activityStartTime ?? now,
      });
    }
  }
  // Longest-waiting first → smallest (oldest) activityStartTime first.
  waiting.sort((a, b) => a.startedAt - b.startedAt);
  return waiting.map((w) => w.snapshot);
}
