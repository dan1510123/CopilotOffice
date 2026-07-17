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

/**
 * One office as seen by the orchestrator's `list_offices` tool. Lets the
 * orchestrator orient across every office (not just the currently viewed one)
 * so it can decide whether to `switch_office` before bringing an agent online.
 * Built in the renderer from OfficeManager.getAllOffices() + per-office status.
 */
export interface OfficeSummary {
  officeId: string;
  name: string;
  layout: string;
  /** True for the office currently shown on the desktop. */
  isCurrent: boolean;
  /** Number of agents currently online (active) in this office. */
  activeAgentCount: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Spec 017 — Orchestrator Improvements (US1–US8). New shared types below.
// See specs/017-orchestrator-improvements/data-model.md for the authoritative
// definitions. Kept Node/DOM-free so both processes can import them.
// ─────────────────────────────────────────────────────────────────────────────

// ── US1: Persistent transcript (FR-001..FR-007) ──────────────────────────────

/** Where a transcript turn originated: the desktop TUI or a Teams thread. */
export type TranscriptOrigin = 'desktop' | 'teams';

/** Who/what produced a transcript turn. */
export type TranscriptRole = 'user' | 'orchestrator' | 'tool' | 'system';

/** One ordered turn in the orchestrator transcript. */
export interface TranscriptTurn {
  /** Monotonic order index within the active conversation. */
  seq: number;
  role: TranscriptRole;
  origin: TranscriptOrigin;
  /** Rendered content (assistant text, user prompt, or human-readable tool/system line). */
  text: string;
  /** Present for `role: 'tool'`: act-on tool + typed outcome + office-qualified target. */
  tool?: { name: string; outcome: string; target?: string };
  /** Epoch ms timestamp. */
  at: number;
}

/** The durable, ordered, retention-bounded record of one orchestrator conversation. */
export interface OrchestratorTranscript {
  sessionId: string;
  /** `closed` marks a user-closed (red ✕) conversation — never resurrected as active. */
  lifecycle: 'active' | 'closed';
  /** Ordered turns; bounded to the xterm scrollback window, trimmed oldest-first. */
  turns: TranscriptTurn[];
  /** Epoch ms of last append. */
  updatedAt: number;
}

// ── US2/US3: Situational awareness (FR-008..FR-010, FR-013) ───────────────────

/** Read-only view of one session-bearing agent, valid for ANY state. */
export interface ActiveAgentSnapshot {
  agentId: string;
  name: string;
  officeId: string;
  officeName: string;
  statusKey: string;
  statusLabel: string;
  activity: string;
  timeInState: string;
  awaitingInput: boolean;
  pendingQuestion?: string;
}

/**
 * The `waiting` subset returned by `list_agents_awaiting_input`, ordered
 * longest-waiting first. Same shape as `ActiveAgentSnapshot`; `pendingQuestion`
 * is expected to be present.
 */
export type AwaitingAgent = ActiveAgentSnapshot;

// ── US7: Agent recent-output window (FR-011, FR-012) ──────────────────────────

/** Bounded, read-only recent output for one target agent (peek). */
export interface AgentRecentOutput {
  agentId: string;
  officeId: string;
  /** False → "nothing recent". */
  hasOutput: boolean;
  /** Bounded recent activity window (getRecentActions / task summary), NOT scrollback. */
  lines: string[];
  /** Optional task summary to help the orchestrator relay. */
  summaryHint?: string;
}

// ── US4–US6, US8: Act-on result (FR-014..FR-023) ──────────────────────────────

/** Typed outcome returned by every gated act-on tool. */
export type ActOnOutcome =
  | 'delivered' // answer_agent success
  | 'sent' // send_prompt_to_agent success
  | 'stopped' // stop_agent success
  | 'restarted' // restart_agent success
  | 'taken-offline' // set_agent_teams_presence off / stop_agent variant
  | 'online-in-teams' // set_agent_teams_presence on
  | 'not-online' // target not online (send/answer/stop/restart/teams)
  | 'not-waiting' // answer_agent: target isn't awaiting input
  | 'invalid-target' // unknown/ineligible/orchestrator-identity/wrong-office
  | 'unavailable' // Teams feature disabled/unconfigured
  | 'denied' // user denied the gate
  | 'failed'; // execution error

/** Typed result returned by every gated act-on tool. */
export interface ActOnResult {
  agentId: string;
  officeId: string;
  outcome: ActOnOutcome;
  message: string;
  /** Present for `online-in-teams` (US8 scenario 1). */
  threadWebUrl?: string;
}

/** Outcome of the `switch_office` tool (ungated navigation). */
export type SwitchOfficeOutcome =
  | 'switched'
  | 'already-current'
  | 'invalid-target'
  | 'failed';

export interface SwitchOfficeResult {
  officeId: string;
  outcome: SwitchOfficeOutcome;
  message: string;
}
