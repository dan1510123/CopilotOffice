// Shared orchestrator message/entity types (spec 016 — data-model.md).
//
// Imported by BOTH the Electron main process (session manager, tools, IPC) and
// the renderer (candidate compute, execute, panel) so the `orchestrator:*` IPC
// surface has a single source of truth. Keep this file free of Node/Electron and
// browser/DOM imports so it is safe to bundle into either process.

/** Manager-local lifecycle of the single orchestrator SDK session (NOT an office AgentStatus). */
export type OrchestratorLifecycle = 'idle' | 'starting' | 'ready' | 'error';

/** Snapshot of the dedicated orchestrator SDK session (main process). */
export interface OrchestratorSessionInfo {
  sessionId: string;
  lifecycle: OrchestratorLifecycle;
}

/** How a dormant agent would be brought online. */
export type BringOnlineSource = 'idle-seated' | 'reserve';

/**
 * A dormant agent the orchestrator may propose to bring online, scoped to the
 * currently viewed office. Computed in the renderer from OfficeManager + agents.ts.
 */
export interface BringOnlineCandidate {
  agentId: string;
  name: string;
  skill: string;
  description: string;
  source: BringOnlineSource;
  /** Required when source === 'reserve' (the `unassigned-*` desk id). */
  deskId: string | null;
  officeId: string;
}

/**
 * Conceptual union of the gated tool params + the permission request's toolCallId.
 * Not marshaled as a distinct payload; documented here to mirror data-model.md.
 */
export interface BringOnlineToolCall {
  agentId: string;
  reason?: string;
  toolCallId: string;
}

/** The user's answer to a gated tool call, mapped to an SDK PermissionRequestResult. */
export interface PermissionDecision {
  toolCallId: string;
  decision: 'approve' | 'deny';
}

/** Outcome of an approved bring-online, returned to the tool handler and surfaced in the panel. */
export type BringOnlineOutcome =
  | 'started'
  | 'denied'
  | 'invalid-target'
  | 'already-active'
  | 'failed';

export interface BringOnlineResult {
  agentId: string;
  outcome: BringOnlineOutcome;
  message: string;
}

/** Payload returned to the `list_office_agents` tool. */
export interface OfficeAgentsSnapshot {
  officeId: string;
  candidates: BringOnlineCandidate[];
}
