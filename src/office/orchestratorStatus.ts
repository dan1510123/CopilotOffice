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
import type {
  ActiveAgentSnapshot,
  AgentLookupMatch,
  AgentStatusLookup,
  AwaitingAgent,
} from '../../electron/orchestrator/types';

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
 * Enumerate every session-bearing agent across ALL offices (FR-008/013), or —
 * when `officeId` is provided — only that one office. A session-bearing agent is
 * one whose status is `active` (i.e. starting/ready/done/waiting/thinking/error)
 * — `slacking` agents have no live session and are excluded. `done`/idle-online
 * agents are NOT omitted.
 */
export function computeActiveAgents(
  now: number = Date.now(),
  officeId?: string,
): ActiveAgentSnapshot[] {
  const scope = officeId?.trim() || undefined;
  const snapshots: ActiveAgentSnapshot[] = [];
  for (const config of officeManager.getAllOffices()) {
    if (scope && config.id !== scope) continue;
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
 * The `waiting` subset (FR-010), longest-waiting first, across all offices or —
 * when `officeId` is provided — scoped to that one office. Reuses the US2 snapshot
 * builder, filtered to `awaitingInput` and sorted by time-in-state descending
 * (i.e. oldest `activityStartTime` first).
 */
export function computeAwaitingAgents(
  now: number = Date.now(),
  officeId?: string,
): AwaitingAgent[] {
  const scope = officeId?.trim() || undefined;
  const waiting: Array<{ snapshot: AwaitingAgent; startedAt: number }> = [];
  for (const config of officeManager.getAllOffices()) {
    if (scope && config.id !== scope) continue;
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

// ── Single-agent status lookup (get_agent_status) ────────────────────────────

interface AgentMatch extends AgentLookupMatch {
  hasSession: boolean;
  status?: AgentStatus;
  /** True when the query matched the agentId or name exactly (case-insensitive). */
  exact: boolean;
}

/**
 * Resolve a fuzzy name OR agentId to concrete agent(s). Session-bearing agents
 * (across ALL offices) are matched first — they are the authoritative live
 * instances. Then office-specific dormant agents (custom + custom-reserve) across
 * all offices, then default/reserve agents scoped to the hint/current office only
 * (they exist in every office, so scanning them everywhere would be needlessly
 * ambiguous). Every match is office-qualified and deduped by `officeId::agentId`;
 * the same agentId in two offices stays as two matches so the caller can detect
 * genuine cross-office ambiguity.
 */
function collectAgentMatches(query: string, officeHint?: string): AgentMatch[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  const seen = new Set<string>();
  const raw: AgentMatch[] = [];

  const consider = (
    officeId: string,
    officeName: string,
    agentId: string,
    name: string,
    status: AgentStatus | undefined,
  ): void => {
    const key = `${officeId}::${agentId}`;
    if (seen.has(key)) return;
    const idHit = agentId.toLowerCase() === q;
    const nameLc = name.toLowerCase();
    const nameExact = nameLc === q;
    const nameFuzzy = nameLc.includes(q) || q.includes(nameLc);
    if (!idHit && !nameExact && !nameFuzzy) return;
    seen.add(key);
    raw.push({
      agentId,
      name,
      officeId,
      officeName,
      hasSession: status?.state === 'active',
      status,
      exact: idHit || nameExact,
    });
  };

  // Pass A: session-bearing agents across all offices.
  for (const config of officeManager.getAllOffices()) {
    const office = officeManager.getOffice(config.id);
    if (!office) continue;
    for (const [agentId, status] of office.agents) {
      if (status.state !== 'active') continue;
      consider(config.id, config.name, agentId, resolveAgentName(config.id, agentId), status);
    }
  }

  // Pass B: office-specific dormant agents (custom + custom-reserve) across all offices.
  for (const config of officeManager.getAllOffices()) {
    const office = officeManager.getOffice(config.id);
    const officeSpecific = [
      ...(config.customAgents ?? []),
      ...Object.values(config.customReserveAgents ?? {}),
    ];
    for (const a of officeSpecific) {
      consider(config.id, config.name, a.id, a.name, office?.agents.get(a.id));
    }
  }

  // Pass C: default + reserve agents, scoped to a VALID hint office, else the
  // current office. A bogus officeHint must not synthesize matches for a
  // non-existent office, so resolve it against the real roster first.
  const all = officeManager.getAllOffices();
  let scopeConfig = officeHint ? all.find((c) => c.id === officeHint) : undefined;
  if (!scopeConfig && officeManager.currentOfficeId) {
    scopeConfig = all.find((c) => c.id === officeManager.currentOfficeId);
  }
  if (scopeConfig) {
    const office = officeManager.getOffice(scopeConfig.id);
    for (const a of [...AGENTS, ...Object.values(RESERVE_AGENTS)]) {
      consider(scopeConfig.id, scopeConfig.name, a.id, a.name, office?.agents.get(a.id));
    }
  }

  // NOTE: no collapse-by-agentId here. `consider` already dedups by
  // `officeId::agentId`, so the same agentId living in TWO offices yields two
  // distinct office-qualified matches — which must stay separate so the lookup
  // can report genuine cross-office ambiguity rather than an arbitrary pick.
  return raw;
}

/** Build the found-agent snapshot; works for any state (dormant → slacking presentation). */
function buildLookupSnapshot(
  match: AgentMatch,
  now: number,
): ActiveAgentSnapshot & { hasSession: boolean } {
  if (match.status) {
    return { ...buildSnapshot(match.officeId, match.officeName, match.agentId, match.status, now), hasSession: match.hasSession };
  }
  // Known-but-never-tracked agent: no status object → dormant/slacking presentation.
  return {
    agentId: match.agentId,
    name: match.name,
    officeId: match.officeId,
    officeName: match.officeName,
    statusKey: resolveStatusKey(undefined),
    statusLabel: presentationFor(undefined).label,
    activity: '',
    timeInState: '',
    awaitingInput: false,
    hasSession: false,
  };
}

/**
 * Resolve ONE agent by fuzzy name or agentId and report its session status. The
 * caller (renderer resolver) fills in `teams` presence via the Teams bridge; this
 * compute is pure over OfficeManager. Returns `not-found` / `ambiguous` / `found`.
 */
export function computeAgentStatusLookup(
  query: string,
  officeHint?: string,
  now: number = Date.now(),
): AgentStatusLookup {
  const trimmed = (query ?? '').trim();
  if (!trimmed) {
    return { query: trimmed, outcome: 'not-found', message: 'No agent name or id was provided.' };
  }
  const matches = collectAgentMatches(trimmed, officeHint);
  if (matches.length === 0) {
    return {
      query: trimmed,
      outcome: 'not-found',
      message: `No agent matching "${trimmed}" was found.`,
    };
  }
  // Prefer exact id/name matches when present, then prefer a live session so a
  // single online instance wins over dormant seats of the same agent elsewhere.
  const exacts = matches.filter((m) => m.exact);
  let pool = exacts.length > 0 ? exacts : matches;
  if (pool.length > 1) {
    const live = pool.filter((m) => m.hasSession);
    if (live.length >= 1) pool = live;
  }
  if (pool.length > 1) {
    return {
      query: trimmed,
      outcome: 'ambiguous',
      matches: pool.map((m) => ({ agentId: m.agentId, name: m.name, officeId: m.officeId, officeName: m.officeName })),
      message: `"${trimmed}" matches ${pool.length} agents — specify which one (by agentId or office).`,
    };
  }
  const match = pool[0];
  const snapshot = buildLookupSnapshot(match, now);
  const where = snapshot.officeName || snapshot.officeId;
  const message = snapshot.hasSession
    ? `${snapshot.name} (${where}) is online — ${snapshot.statusLabel}.`
    : `${snapshot.name} (${where}) is known but has no live session.`;
  return { query: trimmed, outcome: 'found', agent: snapshot, message };
}
