// Message protocol between Electron main process and the terminal server child process.
// Shared by both sides — import types only, no runtime code.

import { CopilotEvent } from './events-watcher';

// ── Main → Server ───────────────────────────────────────────────

export interface MsgStart {
  type: 'start';
  requestId: string;
  officeId: string;
  agentId: string;
  workingDir?: string;
  cols?: number;
  rows?: number;
  preseededPrompt?: string;
  launchMode?: 'copilot' | 'shell';
}

export interface MsgWrite {
  type: 'write';
  requestId: string;
  officeId: string;
  agentId: string;
  data: string;
}

export interface MsgSubmitPrompt {
  type: 'submit-prompt';
  requestId: string;
  officeId: string;
  agentId: string;
  prompt: string;
  /** Optional display-only tag echoed before the prompt (never sent to the agent). */
  label?: string;
}

export interface MsgSetAgentForwarding {
  type: 'set-agent-forwarding';
  officeId: string;
  agentId: string;
  /** When true, copilot-event payloads are mirrored to main even without an active viewer. */
  enabled: boolean;
}

/**
 * Answer to a pending `ask_user` interaction (spec 015). Distinct from
 * `submit-prompt`: this resolves the pending user-input interaction (SDK/ui-server
 * → `handlePendingUserInput(requestId)`) or injects keystrokes (node-pty). Never
 * enqueues a new prompt.
 */
export interface MsgSubmitAnswer {
  type: 'submit-answer';
  requestId: string;
  officeId: string;
  agentId: string;
  /** SDK single-resolution key; empty/undefined on the node-pty degraded path. */
  answerRequestId?: string;
  answer: string;
  wasFreeform: boolean;
}

export interface MsgResize {
  type: 'resize';
  officeId: string;
  agentId: string;
  cols: number;
  rows: number;
}

export interface MsgKill {
  type: 'kill';
  requestId: string;
  officeId: string;
  agentId: string;
}

export interface MsgAttach {
  type: 'attach';
  requestId: string;
  officeId: string;
  agentId: string;
  /**
   * True only for a genuine user "I am now viewing this agent" attach (the
   * SeriousTerminalController panel or the TerminalOverlay popup). Under the
   * shared ui-server host this is what claims the single host foreground: the
   * agent whose rawPty renders and whose session receives keyboard input.
   *
   * Background attaches (reconnect-on-focus, fleetTracker, teams) OMIT this so
   * they only subscribe to the agent's copilot-events for badges/status and can
   * NEVER hijack the foreground away from the agent the user is actually viewing.
   */
  foreground?: boolean;
}

export interface MsgDetach {
  type: 'detach';
  officeId: string;
  agentId: string;
}

export interface MsgExists {
  type: 'exists';
  requestId: string;
  officeId: string;
  agentId: string;
}

export interface MsgGetSessionId {
  type: 'get-session-id';
  requestId: string;
  officeId: string;
  agentId: string;
}

export interface MsgSetSessionId {
  type: 'set-session-id';
  requestId: string;
  officeId: string;
  agentId: string;
  sessionId: string;
}

/**
 * Restore/switch an agent's active session to a previously-archived session (spec 020).
 * `sessionId` is the target archived session id to promote to current — it MUST exist in
 * this agent's history. The response travels on the existing `SrvResponse` envelope with a
 * `RestoreSessionResult` payload.
 */
export interface MsgRestoreSession {
  type: 'restore-session';
  requestId: string;
  officeId: string;
  agentId: string;
  sessionId: string;
}

/** Response payload of `restore-session` (carried in `SrvResponse.result`). */
export type RestoreSessionResult =
  | { success: true; sessionId: string; resumeContextUncertain?: boolean }
  | { success: false; error: string };

export interface MsgPopOut {
  type: 'pop-out';
  requestId: string;
  officeId: string;
  agentId: string;
}

export interface MsgShutdown {
  type: 'shutdown';
}

export interface MsgSetYolo {
  type: 'set-yolo';
  enabled: boolean;
}

export interface MsgSetAdditionalParams {
  type: 'set-additional-params';
  /** Effective parameter string to append to copilot launches (empty = none). */
  params: string;
}

export interface MsgResetAllSessions {
  type: 'reset-all-sessions';
  requestId: string;
  officeId: string;
}

export interface MsgResetSession {
  type: 'reset-session';
  requestId: string;
  officeId: string;
  agentId: string;
}

/**
 * One archived session in an agent's history (spec 019).
 *
 * The response payload of `get-session-history` is `SessionHistoryEntry[]`
 * (previously `string[]`). Legacy on-disk bare-string entries are coerced to
 * `{ id }` at load time; see `coerceHistory` in `server.ts`.
 */
export interface SessionHistoryEntry {
  /** Opaque, stable session identifier — the sole identifier, always present & copyable. */
  id: string;
  /**
   * Human-readable title snapshotted from sessionMeta at archive time.
   * Optional: absent for legacy (pre-019) records and sessions archived with no title.
   */
  title?: string;
}

export interface MsgGetSessionHistory {
  type: 'get-session-history';
  requestId: string;
  officeId: string;
  agentId: string;
  /** Response payload type: `SessionHistoryEntry[]` (spec 019; was `string[]`). */
}

export interface MsgClearSessionHistory {
  type: 'clear-session-history';
  requestId: string;
  officeId: string;
  agentId: string;
}

export interface MsgListActive {
  type: 'list-active';
  requestId: string;
}

export interface MsgQueryAgentStatuses {
  type: 'query-agent-statuses';
  requestId: string;
  officeId?: string;
}

export interface MsgSetSessionMeta {
  type: 'set-session-meta';
  requestId: string;
  officeId: string;
  agentId: string;
  meta: { title?: string };
}

export interface MsgGetSessionMeta {
  type: 'get-session-meta';
  requestId: string;
  officeId: string;
  agentId: string;
}

export interface MsgGetAllSessionMeta {
  type: 'get-all-session-meta';
  requestId: string;
  officeId: string;
}

export interface MsgCreateOfficeSession {
  type: 'create-office-session';
  requestId: string;
  officeId: string;
}

export interface MsgDeleteOfficeSession {
  type: 'delete-office-session';
  requestId: string;
  officeId: string;
}

export interface MsgTransferSession {
  type: 'transfer-session';
  requestId: string;
  fromOfficeId: string;
  toOfficeId: string;
  agentId: string;
}

export type MainToServer =
  | MsgStart
  | MsgWrite
  | MsgSubmitPrompt
  | MsgSubmitAnswer
  | MsgSetAgentForwarding
  | MsgResize
  | MsgKill
  | MsgAttach
  | MsgDetach
  | MsgExists
  | MsgGetSessionId
  | MsgSetSessionId
  | MsgRestoreSession
  | MsgPopOut
  | MsgShutdown
  | MsgSetYolo
  | MsgSetAdditionalParams
  | MsgResetAllSessions
  | MsgResetSession
  | MsgGetSessionHistory
  | MsgClearSessionHistory
  | MsgListActive
  | MsgQueryAgentStatuses
  | MsgSetSessionMeta
  | MsgGetSessionMeta
  | MsgGetAllSessionMeta
  | MsgCreateOfficeSession
  | MsgDeleteOfficeSession
  | MsgTransferSession;

// ── Server → Main ───────────────────────────────────────────────

/** Result of terminal-backend selection at server startup (T008). */
export interface BackendSelectionInfo {
  /** The backend actually loaded (e.g. 'node-pty' | 'ui-server' | 'sdk'). */
  name: string;
  /** The backend that was requested via COPILOT_TERMINAL_BACKEND. */
  requested: string;
  /** True when a non-default backend was requested but we fell back to node-pty. */
  fellBack: boolean;
  /** Human-readable reason for the fallback, when one occurred. */
  reason?: string;
}

export interface SrvReady {
  type: 'ready';
  /** Backend selection outcome, so the renderer can surface a fallback notice. */
  backend?: BackendSelectionInfo;
}

export interface SrvTerminalData {
  type: 'terminal-data';
  agentId: string;
  data: string;
}

export interface SrvTerminalExit {
  type: 'terminal-exit';
  agentId: string;
  exitCode: number;
}

export interface SrvCopilotEvent {
  type: 'copilot-event';
  agentId: string;
  event: CopilotEvent;
  /**
   * When true, the relay mirrors this event to main-process consumers (e.g. the
   * Teams service) but does NOT forward it to the renderer. Used to deliver
   * assistant.message events to Teams-online agents that currently have no active
   * viewer, without causing the renderer to render output for an unviewed session.
   */
  mainOnly?: boolean;
}

export interface SrvCopilotToolStart {
  type: 'copilot-tool-start';
  agentId: string;
  toolName: string;
  toolId: string;
  status: string;
}

/**
 * Emitted IN ADDITION to `copilot-tool-start` when an agent raises an `ask_user`
 * user-input interaction (spec 015). SDK/ui-server backend: fields come natively
 * from `user_input.requested`. node-pty backend: normalized from
 * `tool.execution_start` arguments (`requestId` is ''). The server stays a dumb
 * forwarder — it does NOT assign selector labels or format HTML.
 */
export interface SrvCopilotAskUser {
  type: 'copilot-ask-user';
  agentId: string;
  toolId: string;
  /** SDK user_input.requested id (single-resolution key); '' on node-pty. */
  requestId: string;
  question: string;
  /** ORDERED; original display text, verbatim. */
  options: { text: string }[];
  /** Whether a non-listed answer is accepted (allowFreeform). */
  freeform: boolean;
}

export interface SrvCopilotToolComplete {
  type: 'copilot-tool-complete';
  agentId: string;
  toolId: string;
  success: boolean;
}

/**
 * Emitted when the SDK signals a resolved `ask_user` interaction
 * (`user_input.completed`) — spec 015 hardening (h1). Always forwarded (outside the
 * viewer gate) so the main-process Teams consumer can PRECISELY clear a locally-answered
 * pending question by `requestId`, rather than relying on a "any subsequent event"
 * heuristic. node-pty has no such event (its records carry an empty `requestId`).
 */
export interface SrvCopilotAskUserComplete {
  type: 'copilot-ask-user-complete';
  agentId: string;
  /** The resolved SDK user_input requestId; '' when unavailable. */
  requestId: string;
}

export interface SrvCopilotTurnEnd {
  type: 'copilot-turn-end';
  agentId: string;
}

export interface SrvCopilotTurnStart {
  type: 'copilot-turn-start';
  agentId: string;
}

export interface SrvCopilotUserMessage {
  type: 'copilot-user-message';
  agentId: string;
  /**
   * Raw prompt text the user submitted (the CLI's `user.message` → `data.content`).
   * Optional for backward compatibility; empty when the CLI omitted it. Consumed by
   * the Teams service to mirror locally-typed requests into the online thread.
   */
  text?: string;
}

export interface SrvTerminalPreloadStatus {
  type: 'terminal-preload-status';
  agentId: string;
  status: 'preloading' | 'ready' | 'failed';
}

/**
 * Emitted once per office the first time a ui-server (SDK control-plane) session
 * starts successfully for it — i.e. the `copilot --ui-server` host is online and
 * the SDK client attached. Lets the renderer surface a confirmation toast.
 * NOT emitted when a session falls back to node-pty (T039).
 */
export interface SrvBackendOnline {
  type: 'backend-online';
  officeId: string;
  /** The backend that came online (always 'ui-server' for this message). */
  backend: string;
}

/**
 * Emitted when a specific agent session was requested on ui-server but its start
 * failed and it fell back to node-pty (T039). Lets the renderer surface a toast
 * so a broken SDK attach is never silent.
 */
export interface SrvBackendSessionFallback {
  type: 'backend-session-fallback';
  officeId: string;
  agentId: string;
  reason: string;
}

export interface SrvSessionMetaUpdated {
  type: 'session-meta-updated';
  agentId: string;
  meta: { title: string };
}

export interface SrvResponse {
  type: 'response';
  requestId: string;
  result: unknown;
}

export type ServerToMain =
  | SrvReady
  | SrvTerminalData
  | SrvTerminalExit
  | SrvCopilotEvent
  | SrvCopilotToolStart
  | SrvCopilotAskUser
  | SrvCopilotAskUserComplete
  | SrvCopilotToolComplete
  | SrvCopilotTurnEnd
  | SrvCopilotTurnStart
  | SrvCopilotUserMessage
  | SrvTerminalPreloadStatus
  | SrvBackendOnline
  | SrvBackendSessionFallback
  | SrvSessionMetaUpdated
  | SrvResponse;
