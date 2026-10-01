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
  hostWorkingDir?: string;
  cols?: number;
  rows?: number;
  preseededPrompt?: string;
  launchMode?: 'copilot' | 'shell';
  /**
   * Main-process start (e.g. the Teams ensure-session-online seam). Starts or
   * reuses the agent's session WITHOUT claiming a renderer viewer.
   */
  background?: boolean;
  /**
   * When > 0, the response waits (bounded) for the agent's ready signal — for
   * the native bridge, its authenticated bridge connection — and reports an
   * explicit error if it does not arrive in time.
   */
  readyTimeoutMs?: number;
}

/** Response payload of `start` (carried in `SrvResponse.result`). */
export interface StartResult {
  success: boolean;
  pid?: number;
  sessionId?: string;
  reused?: boolean;
  /** Present when `readyTimeoutMs` was requested: whether the agent became ready. */
  ready?: boolean;
  error?: string;
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

// ── Session control commands (Teams slash-command interception) ─────────────────
//
// A small allow-list of Copilot CLI slash commands (`/compact`, `/usage`, `/model`)
// that Teams intercepts and executes via the SDK control plane instead of enqueueing
// them as model prompts. The SDK-backed backends run them through `session.rpc.*`
// and return structured, postable content; the node-pty fallback keystroke-injects the
// raw command into the real TUI (best-effort, no structured result).

/** Control commands that map to SDK `session.rpc.*` calls. */
export type ControlCommandName = 'compact' | 'usage' | 'model';

export interface ControlCommand {
  command: ControlCommandName;
  /** Optional argument: compaction instructions, or a model id for `/model`. */
  arg?: string;
}

/** Structured `/compact` result (`session.rpc.history.compact`). */
export interface ControlCompactData {
  kind: 'compact';
  success: boolean;
  tokensRemoved: number;
  messagesRemoved: number;
  summary?: string;
}

/** Structured `/usage` result (`session.rpc.usage.getMetrics` + `metadata.contextInfo`). */
export interface ControlUsageData {
  kind: 'usage';
  premiumRequestCost?: number;
  userRequests?: number;
  apiDurationMs?: number;
  totalTokens?: number;
  promptTokenLimit?: number;
  compactionThreshold?: number;
}

/** Structured `/model` result (`session.rpc.model.getCurrent` / `switchTo`). */
export interface ControlModelData {
  kind: 'model';
  current?: string;
  reasoningEffort?: string;
  switchedTo?: string;
}

export type ControlData = ControlCompactData | ControlUsageData | ControlModelData;

/** Response payload of `run-control-command` (carried in `SrvResponse.result`). */
export type ControlCommandResult =
  | { executed: true; via: 'sdk'; data: ControlData }
  | { executed: true; via: 'keystroke' }
  | { executed: false; error: string };

export interface MsgRunControlCommand {
  type: 'run-control-command';
  requestId: string;
  officeId: string;
  agentId: string;
  command: ControlCommandName;
  arg?: string;
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

/**
 * Decision on a pending plan-mode (`exit_plan_mode`) interaction. Resolves the blocked
 * SDK `onExitPlanModeRequest` handler (SDK/ui-server → `handlePendingPlanApproval`). The
 * node-pty backend has no SDK responder — plan approval there is resolved in the local
 * TUI, and this message reports failure so the caller keeps the plan open.
 */
export interface MsgSubmitPlanDecision {
  type: 'submit-plan-decision';
  requestId: string;
  officeId: string;
  agentId: string;
  /** SDK single-resolution key from `exit_plan_mode.requested`; '' on the node-pty path. */
  planRequestId?: string;
  approved: boolean;
  /** The chosen exit action (e.g. `interactive`, `autopilot`) when approved. */
  selectedAction?: string;
  /** Free-form feedback when the user requested changes (approved === false). */
  feedback?: string;
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

/**
 * Atomic terminal activation (spec 021 Phase 2). Collapses the serial
 * exists → start → attach → get-session-id → get-session-meta open sequence
 * into a single request/response so a warm switch costs exactly one round-trip.
 *
 * The handler:
 *  - ensures the terminal exists (cold-starts it, mirroring `start` bookkeeping),
 *  - registers the viewer via the dual-key `addAgentViewer` helper,
 *  - when `foreground === true`, serializes and AWAITS the ui-server foreground
 *    switch (preserving the input-target race guard — never fire-and-forget),
 *  - returns the authoritative session id + title, and
 *  - returns scrollback ONLY when `needScrollback` is set (a cold cache entry);
 *    a warm cached xterm has retained its rendered state, so replay is skipped.
 */
export interface MsgActivate {
  type: 'activate';
  requestId: string;
  officeId: string;
  agentId: string;
  workingDir?: string;
  hostWorkingDir?: string;
  cols?: number;
  rows?: number;
  launchMode?: 'copilot' | 'shell';
  /** True only for a genuine user "I am now viewing this agent" activation. */
  foreground?: boolean;
  /** True for a cold cache entry that needs the initial scrollback replayed. */
  needScrollback?: boolean;
}

/** Response payload of `activate` (carried in `SrvResponse.result`). */
export type ActivateResult =
  | {
      success: true;
      /** True when the terminal already existed (warm); false when cold-started. */
      existed: boolean;
      sessionId: string | null;
      title: string | null;
      /** Present only when `needScrollback` was requested. */
      scrollback?: string;
    }
  | { success: false; error: string };

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

export interface MsgRefreshOfficeBackend {
  type: 'refresh-office-backend';
  requestId: string;
  officeId: string;
}

export type RefreshOfficeBackendResult =
  | { success: true; restartedAgentIds: string[] }
  | { success: false; restartedAgentIds: string[]; error: string };

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
  | MsgSubmitPlanDecision
  | MsgSetAgentForwarding
  | MsgRunControlCommand
  | MsgResize
  | MsgKill
  | MsgAttach
  | MsgDetach
  | MsgActivate
  | MsgExists
  | MsgGetSessionId
  | MsgSetSessionId
  | MsgRestoreSession
  | MsgPopOut
  | MsgShutdown
  | MsgSetYolo
  | MsgSetAdditionalParams
  | MsgResetAllSessions
  | MsgRefreshOfficeBackend
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
  /**
   * True when the requested backend could not load and another one was used
   * instead (native-bridge → sdk, ui-server → node-pty).
   */
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
  /**
   * Owning office (spec 021 Phase 3). Lets cache-aware renderer surfaces route
   * output to the exact composite `officeId:agentId` xterm entry, so the same
   * agent id cached across two offices never crosses streams.
   */
  officeId: string;
  /**
   * Authoritative current session id for this agent at emit time — the session
   * "generation" token. Renderer surfaces drop data whose sessionId no longer
   * matches their bound entry after a New/Close/Replace session (spec 021 Phase 3/6).
   * Optional: absent when no session id has been minted yet.
   */
  sessionId?: string;
}

export interface SrvTerminalExit {
  type: 'terminal-exit';
  agentId: string;
  exitCode: number;
  /** Owning office (spec 021 Phase 3) — see {@link SrvTerminalData.officeId}. */
  officeId: string;
  /** Session generation token (spec 021 Phase 3) — see {@link SrvTerminalData.sessionId}. */
  sessionId?: string;
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

/**
 * Emitted IN ADDITION to `copilot-tool-start` when an agent presents a plan via
 * `exit_plan_mode`. SDK/ui-server backend: fields come natively from the ephemeral
 * `exit_plan_mode.requested` event (incl. the `requestId` used to resolve the plan).
 * node-pty backend: extracted from `tool.execution_start` arguments (`requestId` is ''
 * → render-only). The server stays a dumb forwarder — it does not format HTML or assign
 * selector labels.
 */
export interface SrvCopilotPlan {
  type: 'copilot-plan';
  agentId: string;
  toolId: string;
  /** SDK exit_plan_mode.requested id (single-resolution key); '' on node-pty. */
  requestId: string;
  /** Concise bullet-point plan summary (markdown). */
  summary: string;
  /** Full plan content (markdown), when available. */
  planContent: string;
  /** ORDERED available exit actions (e.g. exit_only, interactive, autopilot). */
  actions: string[];
  /** The action the runtime recommends (rendered first). */
  recommendedAction: string;
}

/**
 * Emitted when the SDK signals a resolved plan interaction (`exit_plan_mode.completed`).
 * Always forwarded (outside the viewer gate) so the main-process Teams consumer can
 * PRECISELY clear a locally-approved plan by `requestId` (first-resolver-wins). node-pty
 * has no such event (its records carry an empty `requestId`).
 */
export interface SrvCopilotPlanComplete {
  type: 'copilot-plan-complete';
  agentId: string;
  /** The resolved SDK exit_plan_mode requestId; '' when unavailable. */
  requestId: string;
  approved: boolean;
  selectedAction?: string;
  feedback?: string;
}

export interface SrvCopilotTurnEnd {
  type: 'copilot-turn-end';
  agentId: string;
  /** Owning office so concurrent agents with the same id cannot cross streams. */
  officeId?: string;
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
  officeId?: string;
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
  /**
   * `sessionId` is present when the agent's current session itself changed
   * without a restart (native bridge `/clear` or session replacement): renderer
   * surfaces rebind their terminal generation token to it so the live native
   * TUI output keeps rendering.
   */
  meta: { title: string; sessionId?: string };
  /** Owning office, when known. */
  officeId?: string;
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
  | SrvCopilotPlan
  | SrvCopilotPlanComplete
  | SrvCopilotToolComplete
  | SrvCopilotTurnEnd
  | SrvCopilotTurnStart
  | SrvCopilotUserMessage
  | SrvTerminalPreloadStatus
  | SrvBackendOnline
  | SrvBackendSessionFallback
  | SrvSessionMetaUpdated
  | SrvResponse;
