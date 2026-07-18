// Orchestrator situational-awareness compute (spec 017 — US2/US3, renderer).
//
// Backs the read-only `get_active_agents` / `list_agents_awaiting_input` tools via
// the `orchestrator:active-agents:*` / `orchestrator:awaiting-agents:*` round-trips.
// Runs in the renderer because it reads OfficeManager (the source of truth for the
// office roster + per-agent status). Status/labels derive ONLY from
// `agentStatusPresentation` (Principle V — no hardcoded labels/colors).

import { AGENTS, RESERVE_AGENTS } from '../config/agents';
import { officeManager } from './officeManager';
import { getPendingAskUser } from './askUserRegistry';
import type { AgentStatus } from './officeManager';
import {
  resolveStatusKey,
  presentationFor,
  friendlyToolName,
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

/**
 * Describe what an agent is doing for the orchestrator roll-up (US2). Unlike the
 * badge's `describeActivity` (which deliberately blanks non-waiting states to keep
 * the in-world card from reflowing, spec 014), the orchestrator surface reports a
 * meaningful activity for EVERY active state, composed from data OfficeManager
 * already holds (thinkingDetail / currentTool / lastCompletedAction / recentActions).
 */
function describeOrchestratorActivity(status: AgentStatus): string {
  const detail = status.thinkingDetail?.trim();
  const tool = status.currentTool?.trim();
  const lastDone = status.lastCompletedAction?.trim();
  const lastRecent = mostRecentActionLabel(status);
  const toolLabel = tool ? friendlyToolName(tool) : '';
  switch (resolveStatusKey(status)) {
    case 'thinking':
      return detail || toolLabel || lastRecent || 'Working…';
    case 'waiting':
      return detail || toolLabel || 'Waiting for your answer';
    case 'starting':
      return detail || 'Starting up';
    case 'done':
      return lastDone || lastRecent || 'Finished its last task';
    case 'ready':
      return lastDone || lastRecent || 'Idle — ready for work';
    case 'error':
      return detail || 'Hit an error';
    default:
      return '';
  }
}

/** Human phrase for the most recent tool action in the ring buffer, or '' if none. */
function mostRecentActionLabel(status: AgentStatus): string {
  const actions = status.recentActions;
  if (!actions || actions.length === 0) return '';
  const last = actions[actions.length - 1];
  return last?.action ? friendlyToolName(last.action) : '';
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
  const activity = describeOrchestratorActivity(status);
  const awaitingInput = statusKey === 'waiting';
  // Prefer the REAL ask_user question captured from the copilot-ask-user relay
  // (authoritative, not subject to tool_start/ask_user event ordering), then the
  // status task-summary, then activity detail / a generic notice.
  const capturedQuestion = getPendingAskUser(agentId)?.question?.trim() || status.taskSummary?.trim();
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
      // TEMP DIAGNOSTIC (spec 017 roll-up activity): log the raw activity-bearing
      // fields so we can tell whether worked agents' data is empty or misattributed.
      console.log(
        `[rollup-diag] office=${config.id} agent=${agentId} key=${resolveStatusKey(status)} ` +
          `recent=${status.recentActions?.length ?? 0} lastDone=${JSON.stringify(status.lastCompletedAction)} ` +
          `think=${JSON.stringify(status.thinkingDetail)} tool=${JSON.stringify(status.currentTool)} ` +
          `activity=${JSON.stringify(describeOrchestratorActivity(status))}`,
      );
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
