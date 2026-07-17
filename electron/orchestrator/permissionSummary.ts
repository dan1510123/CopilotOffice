// spec 017 — shared, tool-aware human summary for the orchestrator's gated
// act-on permission prompts. Both the desktop panel (src/ui/OrchestratorPanel)
// and the Teams relay (electron/teams/orchestratorSessionGateway) render the
// SAME phrasing from this single source, so the approval text always matches the
// action the user actually triggered (never a hardcoded "Bring an agent online").

/** Arguments that influence the summary phrasing. */
export interface PermissionSummaryArgs {
  agentId?: string;
  online?: boolean;
}

/**
 * Produce a concise, human-readable description of the gated action for an
 * approval prompt, e.g. "Send a follow-up prompt to Alice". Falls back to the
 * agentId, then a generic "an agent", when no display name is available.
 */
export function describeOrchestratorPermission(
  toolName: string,
  args: PermissionSummaryArgs = {},
  agentName?: string,
): string {
  const who = (agentName || args.agentId || 'an agent').trim();
  switch (toolName) {
    case 'bring_agent_online':
      return `Bring ${who} online`;
    case 'answer_agent':
      return `Answer ${who}'s question`;
    case 'send_prompt_to_agent':
      return `Send a follow-up prompt to ${who}`;
    case 'stop_agent':
      return `Stop ${who}`;
    case 'restart_agent':
      return `Restart ${who}`;
    case 'set_agent_teams_presence':
      return args.online === false
        ? `Take ${who} offline in Teams`
        : `Bring ${who} online in Teams`;
    default:
      return `Run ${toolName} on ${who}`;
  }
}
