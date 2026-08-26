import type { AgentConfig } from '../config/agents';
import type { OfficeConfig } from './officeManager';

/** The canonical local-shell agent id (mirrors PC_TERMINAL_ID in main.ts / OfficeScene.ts). */
export const PC_TERMINAL_AGENT_ID = 'pc-terminal';

export interface LaunchWorkingDir {
  workingDir: string;
  launchMode: 'copilot' | 'shell';
}

/**
 * Resolve the working directory an agent's terminal session should launch in,
 * scoped to a SPECIFIC office (not the ambient "current" office). This is the
 * single source of truth for launch-folder precedence so that first-open and
 * "New Session" always agree:
 *
 *   1. per-agent override on the office roster (customAgents / customReserveAgents)
 *   2. the office's own `workingDirectory` (the per-office override folder)
 *
 * Returns `undefined` only when no directory can be determined (e.g. unknown
 * office). Keeping this pure + office-scoped prevents the regression where a
 * New Session collapsed to the main/default folder because resolution read the
 * ambient current office instead of the session's actual office.
 */
export function resolveOfficeAgentWorkingDir(
  office: OfficeConfig | undefined | null,
  agentId: string,
): LaunchWorkingDir | undefined {
  if (!office) return undefined;
  const launchMode: 'copilot' | 'shell' = agentId === PC_TERMINAL_AGENT_ID ? 'shell' : 'copilot';

  const fromRoster = findRosterWorkingDir(office, agentId);
  const workingDir = fromRoster || office.workingDirectory;
  if (!workingDir) return undefined;
  return { workingDir, launchMode };
}

function findRosterWorkingDir(office: OfficeConfig, agentId: string): string | undefined {
  const core = office.customAgents?.find((a: AgentConfig) => a.id === agentId)?.workingDir;
  if (core) return core;
  if (office.customReserveAgents) {
    const reserve = Object.values(office.customReserveAgents).find(
      (a: AgentConfig) => a.id === agentId,
    )?.workingDir;
    if (reserve) return reserve;
  }
  return undefined;
}
