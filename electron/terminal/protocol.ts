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

export interface MsgGetSessionHistory {
  type: 'get-session-history';
  requestId: string;
  officeId: string;
  agentId: string;
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
  | MsgSetAgentForwarding
  | MsgResize
  | MsgKill
  | MsgAttach
  | MsgDetach
  | MsgExists
  | MsgGetSessionId
  | MsgSetSessionId
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

export interface SrvReady {
  type: 'ready';
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

export interface SrvCopilotToolComplete {
  type: 'copilot-tool-complete';
  agentId: string;
  toolId: string;
  success: boolean;
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
}

export interface SrvTerminalPreloadStatus {
  type: 'terminal-preload-status';
  agentId: string;
  status: 'preloading' | 'ready' | 'failed';
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
  | SrvCopilotToolComplete
  | SrvCopilotTurnEnd
  | SrvCopilotTurnStart
  | SrvCopilotUserMessage
  | SrvTerminalPreloadStatus
  | SrvSessionMetaUpdated
  | SrvResponse;
