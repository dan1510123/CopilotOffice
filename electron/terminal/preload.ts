import { contextBridge, ipcRenderer } from 'electron';
import type { SessionHistoryEntry } from './protocol';

// Copilot event types
export interface CopilotEvent {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
}

// Spec 008-smoke: expose the e2e mode flag to the renderer so src/main.ts can
// gate installing window.__copilotOfficeDebug without touching process.env
// directly (contextIsolation hides Node globals from renderer code).
contextBridge.exposeInMainWorld('__copilotOfficeE2E', process.env.COPILOT_E2E === '1');

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('copilotBridge', {
  // Terminal management
  terminalStart: (officeId: string, agentId: string, workingDir?: string, cols?: number, rows?: number, preseededPrompt?: string, launchMode?: 'copilot' | 'shell'): Promise<{ success: boolean; pid?: number; sessionId?: string; error?: string }> => {
    return ipcRenderer.invoke('terminal-start', officeId, agentId, workingDir, cols, rows, preseededPrompt, launchMode);
  },
  terminalWrite: (officeId: string, agentId: string, data: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-write', officeId, agentId, data);
  },
  terminalSubmitAnswer: (
    officeId: string,
    agentId: string,
    a: { requestId?: string; answer: string; wasFreeform: boolean },
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-submit-answer', officeId, agentId, a);
  },
  terminalSubmitPrompt: (
    officeId: string,
    agentId: string,
    prompt: string,
    label?: string,
  ): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-submit-prompt', officeId, agentId, prompt, label);
  },
  terminalResize: (officeId: string, agentId: string, cols: number, rows: number): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-resize', officeId, agentId, cols, rows);
  },
  terminalKill: (officeId: string, agentId: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-kill', officeId, agentId);
  },
  // YOLO mode: push global flag to the PTY server so new copilot sessions launch with --yolo.
  setYolo: (enabled: boolean): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('set-yolo', enabled);
  },
  // Additional parameters: push the effective param string (empty = none) to the PTY server.
  setAdditionalParams: (params: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('set-additional-params', params);
  },
  terminalExists: (officeId: string, agentId: string): Promise<boolean> => {
    return ipcRenderer.invoke('terminal-exists', officeId, agentId);
  },
  terminalAttach: (officeId: string, agentId: string, foreground?: boolean): Promise<{ success: boolean; scrollback?: string }> => {
    return ipcRenderer.invoke('terminal-attach', officeId, agentId, foreground);
  },
  terminalActivate: (
    officeId: string,
    agentId: string,
    opts?: {
      workingDir?: string;
      cols?: number;
      rows?: number;
      launchMode?: 'copilot' | 'shell';
      foreground?: boolean;
      needScrollback?: boolean;
    },
  ): Promise<
    | { success: true; existed: boolean; sessionId: string | null; title: string | null; scrollback?: string }
    | { success: false; error: string }
  > => {
    return ipcRenderer.invoke('terminal-activate', officeId, agentId, opts);
  },
  terminalDetach: (officeId: string, agentId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('terminal-detach', officeId, agentId);
  },
  terminalPopOut: (officeId: string, agentId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('terminal-pop-out', officeId, agentId);
  },
  
  // Session persistence (server is the single source of truth for session IDs)
  getSessionId: (officeId: string, agentId: string): Promise<string | null> => {
    return ipcRenderer.invoke('get-session-id', officeId, agentId);
  },
  setSessionId: (officeId: string, agentId: string, sessionId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('set-session-id', officeId, agentId, sessionId);
  },
  resetAllSessions: (officeId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('reset-all-sessions', officeId);
  },
  resetSession: (officeId: string, agentId: string): Promise<{ success: boolean; sessionId?: string }> => {
    return ipcRenderer.invoke('terminal-reset-session', officeId, agentId);
  },
  restoreSession: (
    officeId: string,
    agentId: string,
    sessionId: string
  ): Promise<{ success: boolean; sessionId?: string; resumeContextUncertain?: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-restore-session', officeId, agentId, sessionId);
  },
  getSessionHistory: (officeId: string, agentId: string): Promise<SessionHistoryEntry[]> => {
    return ipcRenderer.invoke('terminal-get-session-history', officeId, agentId);
  },
  clearSessionHistory: (officeId: string, agentId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('terminal-clear-session-history', officeId, agentId);
  },
  listActiveTerminals: (): Promise<string[]> => {
    return ipcRenderer.invoke('list-active-terminals');
  },
  queryAgentStatuses: (officeId?: string): Promise<Record<string, { alive: boolean; ready: boolean; inTurn: boolean }>> => {
    return ipcRenderer.invoke('query-agent-statuses', officeId);
  },
  
  // Session metadata
  setSessionMeta: (officeId: string, agentId: string, meta: { title?: string }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('set-session-meta', officeId, agentId, meta);
  },
  getSessionMeta: (officeId: string, agentId: string): Promise<{ title: string } | null> => {
    return ipcRenderer.invoke('get-session-meta', officeId, agentId);
  },
  getAllSessionMeta: (officeId: string): Promise<Record<string, { title: string; sessionId?: string }>> => {
    return ipcRenderer.invoke('get-all-session-meta', officeId);
  },

  // Office session file management
  createOfficeSession: (officeId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('create-office-session', officeId);
  },
  deleteOfficeSession: (officeId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('delete-office-session', officeId);
  },

  // Transfer a session (ID, metadata, PTY alias) from one office to another
  transferSession: (fromOfficeId: string, toOfficeId: string, agentId: string): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    return ipcRenderer.invoke('transfer-session', fromOfficeId, toOfficeId, agentId);
  },

  // Office file persistence
  saveOffices: (data: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('save-offices', data);
  },
  loadOffices: (): Promise<{ success: boolean; data: string | null; error?: string }> => {
    return ipcRenderer.invoke('load-offices');
  },
  
  // Terminal event listeners. Each returns an unsubscribe function that removes
  // ONLY this registration (not every listener on the channel), so a controller
  // can dispose its own listener before re-registering. This prevents duplicate
  // registrations from writing the same PTY byte to xterm more than once (the
  // classic "double characters" bug). Callers may ignore the return value.
  onTerminalData: (callback: (agentId: string, data: string, officeId?: string, sessionId?: string) => void) => {
    const handler = (_event: unknown, agentId: string, data: string, officeId?: string, sessionId?: string) => callback(agentId, data, officeId, sessionId);
    ipcRenderer.on('terminal-data', handler);
    return () => ipcRenderer.removeListener('terminal-data', handler);
  },
  onTerminalExit: (callback: (agentId: string, exitCode: number, officeId?: string, sessionId?: string) => void) => {
    const handler = (_event: unknown, agentId: string, exitCode: number, officeId?: string, sessionId?: string) => callback(agentId, exitCode, officeId, sessionId);
    ipcRenderer.on('terminal-exit', handler);
    return () => ipcRenderer.removeListener('terminal-exit', handler);
  },
  onTerminalPreloadStatus: (callback: (agentId: string, status: 'preloading' | 'ready' | 'failed') => void) => {
    const handler = (_event: unknown, agentId: string, status: 'preloading' | 'ready' | 'failed') => callback(agentId, status);
    ipcRenderer.on('terminal-preload-status', handler);
    return () => ipcRenderer.removeListener('terminal-preload-status', handler);
  },
  
  // Copilot activity event listeners
  onCopilotEvent: (callback: (agentId: string, event: CopilotEvent) => void) => {
    const handler = (_event: unknown, agentId: string, copilotEvent: CopilotEvent) => callback(agentId, copilotEvent);
    ipcRenderer.on('copilot-event', handler);
    return () => ipcRenderer.removeListener('copilot-event', handler);
  },
  onCopilotToolStart: (callback: (agentId: string, toolName: string, toolId: string, status: string) => void) => {
    const handler = (_event: unknown, agentId: string, toolName: string, toolId: string, status: string) => callback(agentId, toolName, toolId, status);
    ipcRenderer.on('copilot-tool-start', handler);
    return () => ipcRenderer.removeListener('copilot-tool-start', handler);
  },
  // spec 015: additive ask_user relay (renderer parity — no Phaser consumer required).
  onCopilotAskUser: (callback: (agentId: string, toolId: string, requestId: string, question: string, options: { text: string }[], freeform: boolean) => void) => {
    const handler = (_event: unknown, agentId: string, toolId: string, requestId: string, question: string, options: { text: string }[], freeform: boolean) => callback(agentId, toolId, requestId, question, options, freeform);
    ipcRenderer.on('copilot-ask-user', handler);
    return () => ipcRenderer.removeListener('copilot-ask-user', handler);
  },
  onCopilotToolComplete: (callback: (agentId: string, toolId: string, success: boolean) => void) => {
    const handler = (_event: unknown, agentId: string, toolId: string, success: boolean) => callback(agentId, toolId, success);
    ipcRenderer.on('copilot-tool-complete', handler);
    return () => ipcRenderer.removeListener('copilot-tool-complete', handler);
  },
  onCopilotTurnEnd: (callback: (agentId: string) => void) => {
    const handler = (_event: unknown, agentId: string) => callback(agentId);
    ipcRenderer.on('copilot-turn-end', handler);
    return () => ipcRenderer.removeListener('copilot-turn-end', handler);
  },
  onCopilotTurnStart: (callback: (agentId: string) => void) => {
    const handler = (_event: unknown, agentId: string) => callback(agentId);
    ipcRenderer.on('copilot-turn-start', handler);
    return () => ipcRenderer.removeListener('copilot-turn-start', handler);
  },
  onCopilotUserMessage: (callback: (agentId: string) => void) => {
    const handler = (_event: unknown, agentId: string) => callback(agentId);
    ipcRenderer.on('copilot-user-message', handler);
    return () => ipcRenderer.removeListener('copilot-user-message', handler);
  },
  onSessionMetaUpdated: (callback: (agentId: string, meta: { title: string }) => void) => {
    const handler = (_event: unknown, agentId: string, meta: { title: string }) => callback(agentId, meta);
    ipcRenderer.on('session-meta-updated', handler);
    return () => ipcRenderer.removeListener('session-meta-updated', handler);
  },
  
  removeTerminalListeners: () => {
    ipcRenderer.removeAllListeners('terminal-data');
    ipcRenderer.removeAllListeners('terminal-exit');
  },
  removeCopilotListeners: () => {
    ipcRenderer.removeAllListeners('copilot-event');
    ipcRenderer.removeAllListeners('copilot-tool-start');
    ipcRenderer.removeAllListeners('copilot-ask-user');
    ipcRenderer.removeAllListeners('copilot-tool-complete');
    ipcRenderer.removeAllListeners('copilot-turn-end');
    ipcRenderer.removeAllListeners('copilot-turn-start');
    ipcRenderer.removeAllListeners('copilot-user-message');
    ipcRenderer.removeAllListeners('session-meta-updated');
  },
  
  // Signal the main process that the next reload should restart the terminal server
  requestHardReload: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('request-hard-reload');
  },

  // Native OS notifications
  showNativeNotification: (title: string, body: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('show-native-notification', title, body);
  },

  // Terminal backend selection (ui-server / node-pty / sdk).
  getBackendInfo: (): Promise<{ name: string; requested: string; fellBack: boolean; reason?: string } | null> => {
    return ipcRenderer.invoke('terminal-backend-info');
  },
  onBackendFallback: (callback: (info: { name: string; requested: string; fellBack: boolean; reason?: string }) => void) => {
    ipcRenderer.on('backend-fallback', (_event, info) => callback(info));
  },
  onBackendOnline: (callback: (officeId: string, backend: string) => void) => {
    ipcRenderer.on('backend-online', (_event, officeId, backend) => callback(officeId, backend));
  },
  onBackendSessionFallback: (callback: (officeId: string, agentId: string, reason: string) => void) => {
    ipcRenderer.on('backend-session-fallback', (_event, officeId, agentId, reason) => callback(officeId, agentId, reason));
  },

  // Spec 003 follow-up: write to OS clipboard via Electron main process.
  // Bypasses Permissions API + focus restrictions that make
  // navigator.clipboard.writeText unreliable in xterm-focused contexts.
  clipboardWriteText: (text: string): Promise<{ success: boolean; verified?: boolean; error?: string }> => {
    return ipcRenderer.invoke('clipboard-write-text', text);
  },

  // Spec 004: read OS clipboard via Electron main. Renderer pairs this with
  // terminalWrite to implement Paste in the terminal context menu.
  clipboardReadText: (): Promise<{ success: boolean; text: string; error?: string }> => {
    return ipcRenderer.invoke('clipboard-read-text');
  },

  // ── Teams Remote Agents (011) ────────────────────────────────
  teamsStatus: (args?: { officeId?: string; agentId?: string }): Promise<{ success: boolean; connected: boolean; bindings: unknown[] }> => {
    return ipcRenderer.invoke('teams:status', args ?? {});
  },
  teamsRegister: (ctx: { officeId: string; agentId: string; displayName: string; workingDir: string; officeChannelUrl?: string; officeMentionType?: 'user' | 'tag' | 'none'; officeMentionValue?: string }): Promise<{ success: boolean; handle?: string; threadWebUrl?: string; error?: string }> => {
    return ipcRenderer.invoke('teams:register', ctx);
  },
  teamsStop: (args: { officeId: string; agentId: string }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('teams:stop', args);
  },
  teamsRegisterOrchestrator: (): Promise<{ success: boolean; handle?: string; threadWebUrl?: string; error?: string }> => {
    return ipcRenderer.invoke('teams:registerOrchestrator');
  },
  teamsStopOrchestrator: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('teams:stopOrchestrator');
  },
  teamsReconcile: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('teams:reconcile');
  },
  teamsGetSettings: (): Promise<{ success: boolean; settings: unknown }> => {
    return ipcRenderer.invoke('teams:getSettings');
  },
  teamsSaveSettings: (settings: unknown): Promise<{ success: boolean; parsed?: unknown; error?: string }> => {
    return ipcRenderer.invoke('teams:saveSettings', { settings });
  },
  onTeamsStatusChanged: (callback: (status: unknown) => void) => {
    ipcRenderer.on('teams:status:changed', (_event, status) => callback(status));
  },
  onTeamsToast: (callback: (toast: unknown) => void) => {
    ipcRenderer.on('teams:toast', (_event, toast) => callback(toast));
  },

  // ── Office Orchestrator (spec 016) ─────────────────────────────
  orchestratorOpen: (): Promise<{ sessionId: string; lifecycle: string; error?: string }> => {
    return ipcRenderer.invoke('orchestrator:open');
  },
  orchestratorInput: (sessionId: string, text: string): Promise<{ ok: boolean; error?: string }> => {
    return ipcRenderer.invoke('orchestrator:input', { sessionId, text });
  },
  orchestratorRespondPermission: (sessionId: string, toolCallId: string, decision: 'approve' | 'deny'): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:permission:respond', { sessionId, toolCallId, decision });
  },
  orchestratorClose: (sessionId: string): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:close', { sessionId });
  },
  orchestratorEnd: (sessionId: string): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:end', { sessionId });
  },
  orchestratorRespondCandidates: (requestId: string, candidates: unknown[]): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:candidates:respond', { requestId, candidates });
  },
  orchestratorRespondExecute: (requestId: string, result: unknown): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:execute:respond', { requestId, result });
  },
  orchestratorRespondOffices: (requestId: string, offices: unknown[]): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:offices:respond', { requestId, offices });
  },
  orchestratorRespondSwitch: (requestId: string, result: unknown): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:switch:respond', { requestId, result });
  },
  // ── spec 017: situational-awareness + act-on respond invokers ──────────────
  orchestratorRespondActiveAgents: (requestId: string, agents: unknown[]): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:active-agents:respond', { requestId, agents });
  },
  orchestratorRespondAwaitingAgents: (requestId: string, agents: unknown[]): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:awaiting-agents:respond', { requestId, agents });
  },
  orchestratorRespondAgentOutput: (requestId: string, output: unknown): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:agent-output:respond', { requestId, output });
  },
  orchestratorRespondAgentStatus: (requestId: string, lookup: unknown): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:agent-status:respond', { requestId, lookup });
  },
  orchestratorRespondAnswerAgent: (requestId: string, result: unknown): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:answer-agent:respond', { requestId, result });
  },
  orchestratorRespondSendPrompt: (requestId: string, result: unknown): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:send-prompt:respond', { requestId, result });
  },
  orchestratorRespondStopAgent: (requestId: string, result: unknown): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:stop-agent:respond', { requestId, result });
  },
  orchestratorRespondRestartAgent: (requestId: string, result: unknown): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:restart-agent:respond', { requestId, result });
  },
  orchestratorRespondTeamsPresence: (requestId: string, result: unknown): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:teams-presence:respond', { requestId, result });
  },
  orchestratorRespondSetTitle: (requestId: string, result: unknown): Promise<{ ok: boolean }> => {
    return ipcRenderer.invoke('orchestrator:set-title:respond', { requestId, result });
  },
  orchestratorGetTranscript: (sessionId?: string): Promise<{ transcript: OrchestratorTranscriptData | null }> => {
    return ipcRenderer.invoke('orchestrator:transcript:get', { sessionId });
  },
  onOrchestratorEvent: (callback: (payload: { sessionId: string; event: CopilotEvent }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; event: CopilotEvent }) => callback(payload);
    ipcRenderer.on('orchestrator:event', handler);
    return () => ipcRenderer.removeListener('orchestrator:event', handler);
  },
  onOrchestratorPermissionRequest: (callback: (payload: { sessionId: string; toolCallId: string; toolName: string; args: { agentId?: string; agentName?: string; officeId?: string; answer?: string; prompt?: string; online?: boolean; title?: string; reason?: string } }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; toolCallId: string; toolName: string; args: { agentId?: string; agentName?: string; officeId?: string; answer?: string; prompt?: string; online?: boolean; title?: string; reason?: string } }) => callback(payload);
    ipcRenderer.on('orchestrator:permission:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:permission:request', handler);
  },
  onOrchestratorCandidatesRequest: (callback: (payload: { sessionId: string; requestId: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string }) => callback(payload);
    ipcRenderer.on('orchestrator:candidates:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:candidates:request', handler);
  },
  onOrchestratorExecuteRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string; agentId: string }) => callback(payload);
    ipcRenderer.on('orchestrator:execute:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:execute:request', handler);
  },
  onOrchestratorOfficesRequest: (callback: (payload: { sessionId: string; requestId: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string }) => callback(payload);
    ipcRenderer.on('orchestrator:offices:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:offices:request', handler);
  },
  onOrchestratorSwitchRequest: (callback: (payload: { sessionId: string; requestId: string; officeId: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string; officeId: string }) => callback(payload);
    ipcRenderer.on('orchestrator:switch:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:switch:request', handler);
  },
  // ── spec 017: situational-awareness + act-on request listeners ─────────────
  onOrchestratorActiveAgentsRequest: (callback: (payload: { sessionId: string; requestId: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string }) => callback(payload);
    ipcRenderer.on('orchestrator:active-agents:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:active-agents:request', handler);
  },
  onOrchestratorAwaitingAgentsRequest: (callback: (payload: { sessionId: string; requestId: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string }) => callback(payload);
    ipcRenderer.on('orchestrator:awaiting-agents:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:awaiting-agents:request', handler);
  },
  onOrchestratorAgentOutputRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string; agentId: string; officeId?: string }) => callback(payload);
    ipcRenderer.on('orchestrator:agent-output:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:agent-output:request', handler);
  },
  onOrchestratorAgentStatusRequest: (callback: (payload: { sessionId: string; requestId: string; agent: string; officeId?: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string; agent: string; officeId?: string }) => callback(payload);
    ipcRenderer.on('orchestrator:agent-status:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:agent-status:request', handler);
  },
  onOrchestratorAnswerAgentRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; answer: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; answer: string }) => callback(payload);
    ipcRenderer.on('orchestrator:answer-agent:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:answer-agent:request', handler);
  },
  onOrchestratorSendPromptRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; prompt: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; prompt: string }) => callback(payload);
    ipcRenderer.on('orchestrator:send-prompt:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:send-prompt:request', handler);
  },
  onOrchestratorStopAgentRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string; agentId: string; officeId?: string }) => callback(payload);
    ipcRenderer.on('orchestrator:stop-agent:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:stop-agent:request', handler);
  },
  onOrchestratorRestartAgentRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string; agentId: string; officeId?: string }) => callback(payload);
    ipcRenderer.on('orchestrator:restart-agent:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:restart-agent:request', handler);
  },
  onOrchestratorTeamsPresenceRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; online: boolean }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; online: boolean }) => callback(payload);
    ipcRenderer.on('orchestrator:teams-presence:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:teams-presence:request', handler);
  },
  onOrchestratorSetTitleRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; title: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; title: string }) => callback(payload);
    ipcRenderer.on('orchestrator:set-title:request', handler);
    return () => ipcRenderer.removeListener('orchestrator:set-title:request', handler);
  },
  onOrchestratorExit: (callback: (payload: { sessionId: string; reason: string }) => void) => {
    const handler = (_event: unknown, payload: { sessionId: string; reason: string }) => callback(payload);
    ipcRenderer.on('orchestrator:exit', handler);
    return () => ipcRenderer.removeListener('orchestrator:exit', handler);
  },
});

// Type declaration for the exposed API
declare global {
  interface CopilotEventData {
    type: string;
    data: Record<string, unknown>;
    id: string;
    timestamp: string;
    parentId: string | null;
  }

  // Spec 008-smoke: e2e/diagnostic surface exposed by src/main.ts only when
  // process.env.COPILOT_E2E === '1'. Production builds without the env have
  // window.__copilotOfficeDebug === undefined.
  interface CopilotOfficeDebugApi {
    getActiveMode: () => 'game' | 'serious';
    setMode: (mode: 'game' | 'serious') => void;
    getCurrentOfficeId: () => string | null;
    listAgents: () => Array<{ id: string; name: string; tileX: number; tileY: number }>;
    getActiveTerminalAgentId: () => string | null;
    openAgentTerminal: (agentId: string) => Promise<void>;
    closeActiveTerminal: () => Promise<void>;
    switchOffice: (officeId: string) => void;
    getCachedSessionMetaForRender: () => Record<string, { title: string }>;
    // Spec 008-smoke T10: snapshot of the serious-mode panel (sprite card
    // title + session-id readout). Returns null when not in serious mode or
    // when the controller is not visible.
    getSeriousPanelSnapshot: () => null | {
      activeAgentId: string | null;
      titleText: string;
      spriteName: string;
      spriteSubtitle: string;
      sessionIdText: string;
      sessionIdField: string | null;
    };
    // Spec 009: auto-startup of known agents — diagnostic surface for e2e.
    getWarmedOfficeIds: () => string[];
    getAutoStartTerminalStartCount: () => number;
    triggerAutoStartForCurrentOffice: () => Promise<string[]>;
    replaceAgentSession: (officeId: string, agentId: string) => Promise<void>;
    setAutoStartEnabled: (enabled: boolean) => void;
    getAutoStartEnabled: () => boolean;
    clearWarmedOfficeRegistry: () => void;
    getCurrentSessionIdForAgent: (officeId: string, agentId: string) => Promise<string | null>;
  }

  interface Window {
    __copilotOfficeMobileModeActive?: () => boolean;
    __copilotOfficeDebug?: CopilotOfficeDebugApi;
    __copilotOfficeE2E?: boolean;
    copilotBridge: {
      terminalStart: (officeId: string, agentId: string, workingDir?: string, cols?: number, rows?: number, preseededPrompt?: string, launchMode?: 'copilot' | 'shell') => Promise<{ success: boolean; pid?: number; sessionId?: string; error?: string }>;
      terminalWrite: (officeId: string, agentId: string, data: string) => Promise<{ success: boolean; error?: string }>;
      terminalSubmitAnswer: (officeId: string, agentId: string, a: { requestId?: string; answer: string; wasFreeform: boolean }) => Promise<{ success: boolean; error?: string }>;
      terminalSubmitPrompt: (officeId: string, agentId: string, prompt: string, label?: string) => Promise<{ success: boolean; error?: string }>;
      terminalResize: (officeId: string, agentId: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
      terminalKill: (officeId: string, agentId: string) => Promise<{ success: boolean; error?: string }>;
      setYolo: (enabled: boolean) => Promise<{ success: boolean }>;
      setAdditionalParams: (params: string) => Promise<{ success: boolean }>;
      terminalExists: (officeId: string, agentId: string) => Promise<boolean>;
      terminalAttach: (officeId: string, agentId: string, foreground?: boolean) => Promise<{ success: boolean; scrollback?: string }>;
      terminalActivate: (
        officeId: string,
        agentId: string,
        opts?: {
          workingDir?: string;
          cols?: number;
          rows?: number;
          launchMode?: 'copilot' | 'shell';
          foreground?: boolean;
          needScrollback?: boolean;
        },
      ) => Promise<
        | { success: true; existed: boolean; sessionId: string | null; title: string | null; scrollback?: string }
        | { success: false; error: string }
      >;
      terminalDetach: (officeId: string, agentId: string) => Promise<{ success: boolean }>;
      terminalPopOut: (officeId: string, agentId: string) => Promise<{ success: boolean }>;
      getSessionId: (officeId: string, agentId: string) => Promise<string | null>;
      setSessionId: (officeId: string, agentId: string, sessionId: string) => Promise<{ success: boolean }>;
      resetAllSessions: (officeId: string) => Promise<{ success: boolean }>;
      resetSession: (officeId: string, agentId: string) => Promise<{ success: boolean; sessionId?: string }>;
      restoreSession: (officeId: string, agentId: string, sessionId: string) => Promise<{ success: boolean; sessionId?: string; resumeContextUncertain?: boolean; error?: string }>;
      getSessionHistory: (officeId: string, agentId: string) => Promise<SessionHistoryEntry[]>;
      clearSessionHistory: (officeId: string, agentId: string) => Promise<{ success: boolean }>;
      listActiveTerminals: () => Promise<string[]>;
      queryAgentStatuses: (officeId?: string) => Promise<Record<string, { alive: boolean; ready: boolean; inTurn: boolean }>>;
      setSessionMeta: (officeId: string, agentId: string, meta: { title?: string }) => Promise<{ success: boolean }>;
      getSessionMeta: (officeId: string, agentId: string) => Promise<{ title: string } | null>;
      getAllSessionMeta: (officeId: string) => Promise<Record<string, { title: string; sessionId?: string }>>;
      createOfficeSession: (officeId: string) => Promise<{ success: boolean }>;
      deleteOfficeSession: (officeId: string) => Promise<{ success: boolean }>;
      transferSession: (fromOfficeId: string, toOfficeId: string, agentId: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
      onTerminalData: (callback: (agentId: string, data: string, officeId?: string, sessionId?: string) => void) => () => void;
      onTerminalExit: (callback: (agentId: string, exitCode: number, officeId?: string, sessionId?: string) => void) => () => void;
      onTerminalPreloadStatus: (callback: (agentId: string, status: 'preloading' | 'ready' | 'failed') => void) => () => void;
      onCopilotEvent: (callback: (agentId: string, event: CopilotEventData) => void) => () => void;
      onCopilotToolStart: (callback: (agentId: string, toolName: string, toolId: string, status: string) => void) => () => void;
      onCopilotAskUser: (callback: (agentId: string, toolId: string, requestId: string, question: string, options: { text: string }[], freeform: boolean) => void) => () => void;
      onCopilotToolComplete: (callback: (agentId: string, toolId: string, success: boolean) => void) => () => void;
      onCopilotTurnEnd: (callback: (agentId: string) => void) => () => void;
      onCopilotTurnStart: (callback: (agentId: string) => void) => () => void;
      onCopilotUserMessage: (callback: (agentId: string) => void) => () => void;
      onSessionMetaUpdated: (callback: (agentId: string, meta: { title: string }) => void) => () => void;
      removeTerminalListeners: () => void;
      removeCopilotListeners: () => void;
      requestHardReload: () => Promise<{ success: boolean }>;
      showNativeNotification: (title: string, body: string) => Promise<{ success: boolean }>;
      getBackendInfo: () => Promise<{ name: string; requested: string; fellBack: boolean; reason?: string } | null>;
      onBackendFallback: (callback: (info: { name: string; requested: string; fellBack: boolean; reason?: string }) => void) => void;
      onBackendOnline: (callback: (officeId: string, backend: string) => void) => void;
      onBackendSessionFallback: (callback: (officeId: string, agentId: string, reason: string) => void) => void;
      clipboardWriteText: (text: string) => Promise<{ success: boolean; verified?: boolean; error?: string }>;
      clipboardReadText: () => Promise<{ success: boolean; text: string; error?: string }>;
      saveOffices: (data: string) => Promise<{ success: boolean; error?: string }>;
      loadOffices: () => Promise<{ success: boolean; data: string | null; error?: string }>;
      teamsStatus: (args?: { officeId?: string; agentId?: string }) => Promise<{ success: boolean; connected: boolean; bindings: TeamsAgentStatus[] }>;
      teamsRegister: (ctx: { officeId: string; agentId: string; displayName: string; workingDir: string; officeChannelUrl?: string; officeMentionType?: 'user' | 'tag' | 'none'; officeMentionValue?: string }) => Promise<{ success: boolean; handle?: string; threadWebUrl?: string; error?: string }>;
      teamsStop: (args: { officeId: string; agentId: string }) => Promise<{ success: boolean }>;
      teamsRegisterOrchestrator: () => Promise<{ success: boolean; handle?: string; threadWebUrl?: string; error?: string }>;
      teamsStopOrchestrator: () => Promise<{ success: boolean }>;
      teamsReconcile: () => Promise<{ success: boolean }>;
      teamsGetSettings: () => Promise<{ success: boolean; settings: TeamsSettingsShape }>;
      teamsSaveSettings: (settings: TeamsSettingsShape) => Promise<{ success: boolean; parsed?: unknown; error?: string }>;
      onTeamsStatusChanged: (callback: (status: TeamsAgentStatus) => void) => void;
      onTeamsToast: (callback: (toast: { level: string; message: string; durationMs?: number }) => void) => void;
      orchestratorOpen: () => Promise<{ sessionId: string; lifecycle: string; error?: string }>;
      orchestratorInput: (sessionId: string, text: string) => Promise<{ ok: boolean; error?: string }>;
      orchestratorRespondPermission: (sessionId: string, toolCallId: string, decision: 'approve' | 'deny') => Promise<{ ok: boolean }>;
      orchestratorClose: (sessionId: string) => Promise<{ ok: boolean }>;
      orchestratorEnd: (sessionId: string) => Promise<{ ok: boolean }>;
      orchestratorRespondCandidates: (requestId: string, candidates: OrchestratorCandidate[]) => Promise<{ ok: boolean }>;
      orchestratorRespondExecute: (requestId: string, result: OrchestratorResult) => Promise<{ ok: boolean }>;
      orchestratorRespondOffices: (requestId: string, offices: OrchestratorOfficeSummary[]) => Promise<{ ok: boolean }>;
      orchestratorRespondSwitch: (requestId: string, result: OrchestratorSwitchResult) => Promise<{ ok: boolean }>;
      orchestratorRespondActiveAgents: (requestId: string, agents: OrchestratorActiveAgent[]) => Promise<{ ok: boolean }>;
      orchestratorRespondAwaitingAgents: (requestId: string, agents: OrchestratorActiveAgent[]) => Promise<{ ok: boolean }>;
      orchestratorRespondAgentOutput: (requestId: string, output: OrchestratorAgentOutput) => Promise<{ ok: boolean }>;
      orchestratorRespondAgentStatus: (requestId: string, lookup: OrchestratorAgentStatusLookup) => Promise<{ ok: boolean }>;
      orchestratorRespondAnswerAgent: (requestId: string, result: OrchestratorActOnResult) => Promise<{ ok: boolean }>;
      orchestratorRespondSendPrompt: (requestId: string, result: OrchestratorActOnResult) => Promise<{ ok: boolean }>;
      orchestratorRespondStopAgent: (requestId: string, result: OrchestratorActOnResult) => Promise<{ ok: boolean }>;
      orchestratorRespondRestartAgent: (requestId: string, result: OrchestratorActOnResult) => Promise<{ ok: boolean }>;
      orchestratorRespondTeamsPresence: (requestId: string, result: OrchestratorActOnResult) => Promise<{ ok: boolean }>;
      orchestratorRespondSetTitle: (requestId: string, result: OrchestratorActOnResult) => Promise<{ ok: boolean }>;
      orchestratorGetTranscript: (sessionId?: string) => Promise<{ transcript: OrchestratorTranscriptData | null }>;
      onOrchestratorEvent: (callback: (payload: { sessionId: string; event: CopilotEventData }) => void) => () => void;
      onOrchestratorPermissionRequest: (callback: (payload: { sessionId: string; toolCallId: string; toolName: string; args: { agentId?: string; agentName?: string; officeId?: string; answer?: string; prompt?: string; online?: boolean; title?: string; reason?: string } }) => void) => () => void;
      onOrchestratorCandidatesRequest: (callback: (payload: { sessionId: string; requestId: string }) => void) => () => void;
      onOrchestratorExecuteRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string }) => void) => () => void;
      onOrchestratorOfficesRequest: (callback: (payload: { sessionId: string; requestId: string }) => void) => () => void;
      onOrchestratorSwitchRequest: (callback: (payload: { sessionId: string; requestId: string; officeId: string }) => void) => () => void;
      onOrchestratorActiveAgentsRequest: (callback: (payload: { sessionId: string; requestId: string }) => void) => () => void;
      onOrchestratorAwaitingAgentsRequest: (callback: (payload: { sessionId: string; requestId: string }) => void) => () => void;
      onOrchestratorAgentOutputRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string }) => void) => () => void;
      onOrchestratorAgentStatusRequest: (callback: (payload: { sessionId: string; requestId: string; agent: string; officeId?: string }) => void) => () => void;
      onOrchestratorAnswerAgentRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; answer: string }) => void) => () => void;
      onOrchestratorSendPromptRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; prompt: string }) => void) => () => void;
      onOrchestratorStopAgentRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string }) => void) => () => void;
      onOrchestratorRestartAgentRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string }) => void) => () => void;
      onOrchestratorTeamsPresenceRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; online: boolean }) => void) => () => void;
      onOrchestratorSetTitleRequest: (callback: (payload: { sessionId: string; requestId: string; agentId: string; officeId?: string; title: string }) => void) => () => void;
      onOrchestratorExit: (callback: (payload: { sessionId: string; reason: string }) => void) => () => void;
    };
  }

  interface OrchestratorCandidate {
    agentId: string;
    name: string;
    skill: string;
    description: string;
    source: 'idle-seated' | 'reserve';
    deskId: string | null;
    officeId: string;
  }

  interface OrchestratorResult {
    agentId: string;
    outcome: 'started' | 'denied' | 'invalid-target' | 'already-active' | 'failed';
    message: string;
  }

  interface OrchestratorOfficeSummary {
    officeId: string;
    name: string;
    layout: string;
    isCurrent: boolean;
    activeAgentCount: number;
  }

  interface OrchestratorSwitchResult {
    officeId: string;
    outcome: 'switched' | 'already-current' | 'invalid-target' | 'failed';
    message: string;
  }

  interface OrchestratorActiveAgent {
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

  interface OrchestratorAgentOutput {
    agentId: string;
    officeId: string;
    hasOutput: boolean;
    lines: string[];
    summaryHint?: string;
  }

  interface OrchestratorAgentTeamsPresence {
    enabled: boolean;
    online: boolean;
    threadWebUrl?: string;
  }

  interface OrchestratorAgentStatusLookup {
    query: string;
    outcome: 'found' | 'ambiguous' | 'not-found';
    agent?: OrchestratorActiveAgent & { hasSession: boolean };
    teams?: OrchestratorAgentTeamsPresence;
    matches?: Array<{ agentId: string; name: string; officeId: string; officeName: string }>;
    message: string;
  }

  interface OrchestratorActOnResult {
    agentId: string;
    officeId: string;
    outcome:
      | 'delivered'
      | 'sent'
      | 'stopped'
      | 'restarted'
      | 'taken-offline'
      | 'online-in-teams'
      | 'title-set'
      | 'not-online'
      | 'not-waiting'
      | 'invalid-target'
      | 'unavailable'
      | 'denied'
      | 'failed';
    message: string;
    threadWebUrl?: string;
  }

  interface OrchestratorTranscriptTurn {
    seq: number;
    role: 'user' | 'orchestrator' | 'tool' | 'system';
    origin: 'desktop' | 'teams';
    text: string;
    tool?: { name: string; outcome: string; target?: string };
    at: number;
  }

  interface OrchestratorTranscriptData {
    sessionId: string;
    lifecycle: 'active' | 'closed';
    turns: OrchestratorTranscriptTurn[];
    updatedAt: number;
  }

  interface TeamsAgentStatus {
    agentId: string;
    officeId: string;
    online: boolean;
    handle: string;
    threadWebUrl?: string;
    health: 'connected' | 'disconnected' | 'error';
    workingDir: string;
  }

  interface TeamsSettingsShape {
    enabled: boolean;
    defaultChannelUrl: string;
    ackEnabled: boolean;
    checkInEnabled: boolean;
    checkInThresholdMs: number;
    checkInThrottleMs: number;
  }
}
