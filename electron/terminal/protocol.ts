// Message protocol between Electron main process and the terminal server child process.
// Shared by both sides — import types only, no runtime code.

import { CopilotEvent } from './events-watcher';

// ── Main → Server ───────────────────────────────────────────────

export interface MsgStart {
  type: 'start';
  requestId: string;
  agentId: string;
  workingDir?: string;
  cols?: number;
  rows?: number;
}

export interface MsgWrite {
  type: 'write';
  agentId: string;
  data: string;
}

export interface MsgResize {
  type: 'resize';
  agentId: string;
  cols: number;
  rows: number;
}

export interface MsgKill {
  type: 'kill';
  requestId: string;
  agentId: string;
}

export interface MsgAttach {
  type: 'attach';
  requestId: string;
  agentId: string;
}

export interface MsgDetach {
  type: 'detach';
  agentId: string;
}

export interface MsgExists {
  type: 'exists';
  requestId: string;
  agentId: string;
}

export interface MsgGetSessionId {
  type: 'get-session-id';
  requestId: string;
  agentId: string;
}

export interface MsgPopOut {
  type: 'pop-out';
  requestId: string;
  agentId: string;
}

export interface MsgShutdown {
  type: 'shutdown';
}

export interface MsgResetAllSessions {
  type: 'reset-all-sessions';
  requestId: string;
}

export interface MsgResetSession {
  type: 'reset-session';
  requestId: string;
  agentId: string;
}

export interface MsgGetSessionHistory {
  type: 'get-session-history';
  requestId: string;
  agentId: string;
}

export interface MsgClearSessionHistory {
  type: 'clear-session-history';
  requestId: string;
  agentId: string;
}

export interface MsgListActive {
  type: 'list-active';
  requestId: string;
}

export interface MsgQueryAgentStatuses {
  type: 'query-agent-statuses';
  requestId: string;
}

export type MainToServer =
  | MsgStart
  | MsgWrite
  | MsgResize
  | MsgKill
  | MsgAttach
  | MsgDetach
  | MsgExists
  | MsgGetSessionId
  | MsgPopOut
  | MsgShutdown
  | MsgResetAllSessions
  | MsgResetSession
  | MsgGetSessionHistory
  | MsgClearSessionHistory
  | MsgListActive
  | MsgQueryAgentStatuses;

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
  | SrvResponse;
