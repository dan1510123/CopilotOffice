// Orchestrator agent peek (spec 017 — US7, renderer).
//
// Backs the read-only `get_agent_transcript` tool via the
// `orchestrator:agent-output:*` round-trip. Returns a BOUNDED, read-only recent-
// output window for one office-qualified agent sourced from
// `officeManager.getRecentActions` / the agent's task summary — NOT live PTY/xterm
// scraping (implementation note 2). No gate, no session mutation.

import { officeManager } from './officeManager';
import type { RecentAction } from './officeManager';
import type { AgentRecentOutput } from '../../electron/orchestrator/types';

/** Human-readable line for one recent action (e.g. "edit (started)"). */
function formatAction(a: RecentAction): string {
  return `${a.action} (${a.type})`;
}

/**
 * Resolve the office that hosts `agentId`. Disambiguation order (contract): the
 * current office first, then all offices. Returns the first office that has a
 * status entry for the agent, or null when none / ambiguous-but-unknown.
 */
function resolveOfficeForAgent(agentId: string, officeId?: string): string | null {
  if (officeId) {
    return officeManager.getAgentStatus(officeId, agentId) ? officeId : null;
  }
  const current = officeManager.currentOfficeId;
  if (current && officeManager.getAgentStatus(current, agentId)) return current;
  for (const config of officeManager.getAllOffices()) {
    if (officeManager.getAgentStatus(config.id, agentId)) return config.id;
  }
  return null;
}

/**
 * Compute the bounded recent-output window for one agent (US7). Ungated, read-only.
 * `hasOutput:false` ⇒ "nothing recent" (or unknown/ambiguous target).
 */
export function computeAgentRecentOutput(agentId: string, officeId?: string): AgentRecentOutput {
  const target = (agentId ?? '').trim();
  if (!target) {
    return { agentId: '', officeId: officeId ?? '', hasOutput: false, lines: [] };
  }

  const resolvedOffice = resolveOfficeForAgent(target, officeId);
  if (!resolvedOffice) {
    return {
      agentId: target,
      officeId: officeId ?? '',
      hasOutput: false,
      lines: [],
      summaryHint: `No agent "${target}" with recent activity was found${
        officeId ? ` in office "${officeId}"` : ''
      }.`,
    };
  }

  const status = officeManager.getAgentStatus(resolvedOffice, target);
  const actions = officeManager.getRecentActions(resolvedOffice, target);
  const lines = actions.map(formatAction);
  const summaryHint = status?.taskSummary?.trim() || undefined;
  const hasOutput = lines.length > 0 || !!summaryHint;

  return {
    agentId: target,
    officeId: resolvedOffice,
    hasOutput,
    lines,
    ...(summaryHint ? { summaryHint } : {}),
  };
}
