import { contextBridge, ipcRenderer } from 'electron';

// Copilot event types
export interface CopilotEvent {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
}

// Expose protected methods to the renderer process
contextBridge.exposeInMainWorld('copilotBridge', {
  // Terminal management
  terminalStart: (agentId: string, workingDir?: string, cols?: number, rows?: number): Promise<{ success: boolean; pid?: number; sessionId?: string; error?: string }> => {
    return ipcRenderer.invoke('terminal-start', agentId, workingDir, cols, rows);
  },
  terminalWrite: (agentId: string, data: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-write', agentId, data);
  },
  terminalResize: (agentId: string, cols: number, rows: number): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-resize', agentId, cols, rows);
  },
  terminalKill: (agentId: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-kill', agentId);
  },
  terminalExists: (agentId: string): Promise<boolean> => {
    return ipcRenderer.invoke('terminal-exists', agentId);
  },
  terminalAttach: (agentId: string): Promise<{ success: boolean; scrollback?: string }> => {
    return ipcRenderer.invoke('terminal-attach', agentId);
  },
  terminalDetach: (agentId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('terminal-detach', agentId);
  },
  terminalPopOut: (agentId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('terminal-pop-out', agentId);
  },
  
  // Session persistence (server is the single source of truth for session IDs)
  getSessionId: (agentId: string): Promise<string | null> => {
    return ipcRenderer.invoke('get-session-id', agentId);
  },
  resetAllSessions: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('reset-all-sessions');
  },
  resetSession: (agentId: string): Promise<{ success: boolean; sessionId?: string }> => {
    return ipcRenderer.invoke('terminal-reset-session', agentId);
  },
  getSessionHistory: (agentId: string): Promise<string[]> => {
    return ipcRenderer.invoke('terminal-get-session-history', agentId);
  },
  clearSessionHistory: (agentId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('terminal-clear-session-history', agentId);
  },
  listActiveTerminals: (): Promise<string[]> => {
    return ipcRenderer.invoke('list-active-terminals');
  },
  queryAgentStatuses: (): Promise<Record<string, { alive: boolean; ready: boolean }>> => {
    return ipcRenderer.invoke('query-agent-statuses');
  },
  
  // Session metadata
  setSessionMeta: (agentId: string, meta: { title?: string }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('set-session-meta', agentId, meta);
  },
  getSessionMeta: (agentId: string): Promise<{ title: string } | null> => {
    return ipcRenderer.invoke('get-session-meta', agentId);
  },
  getAllSessionMeta: (): Promise<Record<string, { title: string }>> => {
    return ipcRenderer.invoke('get-all-session-meta');
  },

  // Office file persistence
  saveOffices: (data: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('save-offices', data);
  },
  loadOffices: (): Promise<{ success: boolean; data: string | null; error?: string }> => {
    return ipcRenderer.invoke('load-offices');
  },
  
  // Terminal event listeners
  onTerminalData: (callback: (agentId: string, data: string) => void) => {
    ipcRenderer.on('terminal-data', (_event, agentId, data) => callback(agentId, data));
  },
  onTerminalExit: (callback: (agentId: string, exitCode: number) => void) => {
    ipcRenderer.on('terminal-exit', (_event, agentId, exitCode) => callback(agentId, exitCode));
  },
  onTerminalPreloadStatus: (callback: (agentId: string, status: 'preloading' | 'ready' | 'failed') => void) => {
    ipcRenderer.on('terminal-preload-status', (_event, agentId, status) => callback(agentId, status));
  },
  
  // Copilot activity event listeners
  onCopilotEvent: (callback: (agentId: string, event: CopilotEvent) => void) => {
    ipcRenderer.on('copilot-event', (_event, agentId, copilotEvent) => callback(agentId, copilotEvent));
  },
  onCopilotToolStart: (callback: (agentId: string, toolName: string, toolId: string, status: string) => void) => {
    ipcRenderer.on('copilot-tool-start', (_event, agentId, toolName, toolId, status) => callback(agentId, toolName, toolId, status));
  },
  onCopilotToolComplete: (callback: (agentId: string, toolId: string, success: boolean) => void) => {
    ipcRenderer.on('copilot-tool-complete', (_event, agentId, toolId, success) => callback(agentId, toolId, success));
  },
  onCopilotTurnEnd: (callback: (agentId: string) => void) => {
    ipcRenderer.on('copilot-turn-end', (_event, agentId) => callback(agentId));
  },
  onCopilotTurnStart: (callback: (agentId: string) => void) => {
    ipcRenderer.on('copilot-turn-start', (_event, agentId) => callback(agentId));
  },
  onCopilotUserMessage: (callback: (agentId: string) => void) => {
    ipcRenderer.on('copilot-user-message', (_event, agentId) => callback(agentId));
  },
  onSessionMetaUpdated: (callback: (agentId: string, meta: { title: string }) => void) => {
    ipcRenderer.on('session-meta-updated', (_event, agentId, meta) => callback(agentId, meta));
  },
  
  removeTerminalListeners: () => {
    ipcRenderer.removeAllListeners('terminal-data');
    ipcRenderer.removeAllListeners('terminal-exit');
  },
  removeCopilotListeners: () => {
    ipcRenderer.removeAllListeners('copilot-event');
    ipcRenderer.removeAllListeners('copilot-tool-start');
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
  
  interface Window {
    copilotBridge: {
      terminalStart: (agentId: string, workingDir?: string, cols?: number, rows?: number) => Promise<{ success: boolean; pid?: number; sessionId?: string; error?: string }>;
      terminalWrite: (agentId: string, data: string) => Promise<{ success: boolean; error?: string }>;
      terminalResize: (agentId: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
      terminalKill: (agentId: string) => Promise<{ success: boolean; error?: string }>;
      terminalExists: (agentId: string) => Promise<boolean>;
      terminalAttach: (agentId: string) => Promise<{ success: boolean; scrollback?: string }>;
      terminalDetach: (agentId: string) => Promise<{ success: boolean }>;
      terminalPopOut: (agentId: string) => Promise<{ success: boolean }>;
      getSessionId: (agentId: string) => Promise<string | null>;
      resetAllSessions: () => Promise<{ success: boolean }>;
      resetSession: (agentId: string) => Promise<{ success: boolean; sessionId?: string }>;
      getSessionHistory: (agentId: string) => Promise<string[]>;
      clearSessionHistory: (agentId: string) => Promise<{ success: boolean }>;
      listActiveTerminals: () => Promise<string[]>;
      queryAgentStatuses: () => Promise<Record<string, { alive: boolean; ready: boolean }>>;
      setSessionMeta: (agentId: string, meta: { title?: string }) => Promise<{ success: boolean }>;
      getSessionMeta: (agentId: string) => Promise<{ title: string } | null>;
      getAllSessionMeta: () => Promise<Record<string, { title: string }>>;
      onTerminalData: (callback: (agentId: string, data: string) => void) => void;
      onTerminalExit: (callback: (agentId: string, exitCode: number) => void) => void;
      onTerminalPreloadStatus: (callback: (agentId: string, status: 'preloading' | 'ready' | 'failed') => void) => void;
      onCopilotEvent: (callback: (agentId: string, event: CopilotEventData) => void) => void;
      onCopilotToolStart: (callback: (agentId: string, toolName: string, toolId: string, status: string) => void) => void;
      onCopilotToolComplete: (callback: (agentId: string, toolId: string, success: boolean) => void) => void;
      onCopilotTurnEnd: (callback: (agentId: string) => void) => void;
      onCopilotTurnStart: (callback: (agentId: string) => void) => void;
      onCopilotUserMessage: (callback: (agentId: string) => void) => void;
      onSessionMetaUpdated: (callback: (agentId: string, meta: { title: string }) => void) => void;
      removeTerminalListeners: () => void;
      removeCopilotListeners: () => void;
      requestHardReload: () => Promise<{ success: boolean }>;
      showNativeNotification: (title: string, body: string) => Promise<{ success: boolean }>;
    };
  }
}
