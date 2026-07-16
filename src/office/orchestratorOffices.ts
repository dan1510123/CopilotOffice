// Orchestrator office navigation (spec 016 — list_offices / switch_office, renderer).
//
// Backs the main-process `list_offices` and `switch_office` tools via the
// `orchestrator:offices:*` / `orchestrator:switch:*` round-trips. Runs in the
// renderer because it reads OfficeManager (the source of truth for the office
// roster + per-agent status). `list_offices` is read-only; `switch_office` is
// ungated navigation — the actual desktop switch is delegated to src/main.ts
// (`switchToOffice`) since it drives Phaser + DOM re-rendering.

import { officeManager } from './officeManager';
import type { OfficeSummary, SwitchOfficeResult } from '../../electron/orchestrator/types';

/** Count agents currently online (state === 'active') in the given office. */
function countActiveAgents(officeId: string): number {
  const office = officeManager.getOffice(officeId);
  if (!office) return 0;
  let count = 0;
  for (const status of office.agents.values()) {
    if (status.state === 'active') count++;
  }
  return count;
}

/** Build the office summaries returned to the `list_offices` tool. */
export function computeOfficeSummaries(): OfficeSummary[] {
  const currentId = officeManager.currentOfficeId;
  return officeManager.getAllOffices().map((config) => ({
    officeId: config.id,
    name: config.name,
    layout: config.layout,
    isCurrent: config.id === currentId,
    activeAgentCount: countActiveAgents(config.id),
  }));
}

/**
 * Validate the target office and (when valid + not already current) perform the
 * switch via the injected delegate. Ungated: no permission gate. Returns a
 * structured outcome for the tool handler.
 */
export function resolveSwitchOffice(
  officeId: string,
  doSwitch: (officeId: string) => void,
): SwitchOfficeResult {
  const target = (officeId ?? '').trim();
  if (!target) {
    return { officeId: target, outcome: 'invalid-target', message: 'No officeId was provided.' };
  }
  if (!officeManager.getOffice(target)) {
    return {
      officeId: target,
      outcome: 'invalid-target',
      message: `No office with id "${target}" exists. Use list_offices to see valid ids.`,
    };
  }
  if (officeManager.currentOfficeId === target) {
    return {
      officeId: target,
      outcome: 'already-current',
      message: 'That office is already the one being shown.',
    };
  }
  try {
    doSwitch(target);
    const name = officeManager.getOffice(target)?.config.name ?? target;
    return { officeId: target, outcome: 'switched', message: `Switched to ${name}.` };
  } catch (err) {
    return {
      officeId: target,
      outcome: 'failed',
      message: `Failed to switch offices: ${err instanceof Error ? err.message : String(err)}`,
    };
  }
}
