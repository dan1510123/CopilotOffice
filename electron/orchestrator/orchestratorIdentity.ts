// Orchestrator Teams identity (spec 016 — Workstream B, B1).
//
// The Office Orchestrator is a MAIN-process SDK session, not an office terminal
// session, so it has no natural `(officeId, agentId)` key. To bring it online in
// Teams (reusing the spec-011 register/route/reply machinery, which keys every
// binding by `(officeId, agentId)`), we give it a SYNTHETIC identity that can
// never collide with a real office or agent id. `TeamsService` treats this key
// like any other agent; a composite gateway routes it to the orchestrator manager
// instead of the terminal relay.

/** Synthetic officeId for the orchestrator's Teams binding (never a real office). */
export const ORCHESTRATOR_OFFICE_ID = '__orchestrator__';

/** Synthetic agentId for the orchestrator's Teams binding. */
export const ORCHESTRATOR_AGENT_ID = 'orchestrator';

/** Display name used for the orchestrator's Teams thread + @handle base. */
export const ORCHESTRATOR_DISPLAY_NAME = 'Office Orchestrator';

/** True when the given key is the synthetic orchestrator identity. */
export function isOrchestratorKey(officeId: string, agentId: string): boolean {
  return officeId === ORCHESTRATOR_OFFICE_ID && agentId === ORCHESTRATOR_AGENT_ID;
}
