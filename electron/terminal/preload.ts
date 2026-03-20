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
  terminalStart: (officeId: string, agentId: string, workingDir?: string, cols?: number, rows?: number, preseededPrompt?: string, launchMode?: 'copilot' | 'shell'): Promise<{ success: boolean; pid?: number; sessionId?: string; error?: string }> => {
    return ipcRenderer.invoke('terminal-start', officeId, agentId, workingDir, cols, rows, preseededPrompt, launchMode);
  },
  terminalWrite: (officeId: string, agentId: string, data: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-write', officeId, agentId, data);
  },
  terminalResize: (officeId: string, agentId: string, cols: number, rows: number): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-resize', officeId, agentId, cols, rows);
  },
  terminalKill: (officeId: string, agentId: string): Promise<{ success: boolean; error?: string }> => {
    return ipcRenderer.invoke('terminal-kill', officeId, agentId);
  },
  terminalExists: (officeId: string, agentId: string): Promise<boolean> => {
    return ipcRenderer.invoke('terminal-exists', officeId, agentId);
  },
  terminalAttach: (officeId: string, agentId: string): Promise<{ success: boolean; scrollback?: string }> => {
    return ipcRenderer.invoke('terminal-attach', officeId, agentId);
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
  resetAllSessions: (officeId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('reset-all-sessions', officeId);
  },
  resetSession: (officeId: string, agentId: string): Promise<{ success: boolean; sessionId?: string }> => {
    return ipcRenderer.invoke('terminal-reset-session', officeId, agentId);
  },
  getSessionHistory: (officeId: string, agentId: string): Promise<string[]> => {
    return ipcRenderer.invoke('terminal-get-session-history', officeId, agentId);
  },
  clearSessionHistory: (officeId: string, agentId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('terminal-clear-session-history', officeId, agentId);
  },
  listActiveTerminals: (): Promise<string[]> => {
    return ipcRenderer.invoke('list-active-terminals');
  },
  queryAgentStatuses: (officeId?: string): Promise<Record<string, { alive: boolean; ready: boolean }>> => {
    return ipcRenderer.invoke('query-agent-statuses', officeId);
  },
  
  // Session metadata
  setSessionMeta: (officeId: string, agentId: string, meta: { title?: string }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('set-session-meta', officeId, agentId, meta);
  },
  getSessionMeta: (officeId: string, agentId: string): Promise<{ title: string } | null> => {
    return ipcRenderer.invoke('get-session-meta', officeId, agentId);
  },
  getAllSessionMeta: (officeId: string): Promise<Record<string, { title: string }>> => {
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
  transferSession: (fromOfficeId: string, toOfficeId: string, agentId: string): Promise<{ success: boolean; sessionId?: string }> => {
    return ipcRenderer.invoke('transfer-session', fromOfficeId, toOfficeId, agentId);
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
      terminalStart: (officeId: string, agentId: string, workingDir?: string, cols?: number, rows?: number, preseededPrompt?: string, launchMode?: 'copilot' | 'shell') => Promise<{ success: boolean; pid?: number; sessionId?: string; error?: string }>;
      terminalWrite: (officeId: string, agentId: string, data: string) => Promise<{ success: boolean; error?: string }>;
      terminalResize: (officeId: string, agentId: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
      terminalKill: (officeId: string, agentId: string) => Promise<{ success: boolean; error?: string }>;
      terminalExists: (officeId: string, agentId: string) => Promise<boolean>;
      terminalAttach: (officeId: string, agentId: string) => Promise<{ success: boolean; scrollback?: string }>;
      terminalDetach: (officeId: string, agentId: string) => Promise<{ success: boolean }>;
      terminalPopOut: (officeId: string, agentId: string) => Promise<{ success: boolean }>;
      getSessionId: (officeId: string, agentId: string) => Promise<string | null>;
      resetAllSessions: (officeId: string) => Promise<{ success: boolean }>;
      resetSession: (officeId: string, agentId: string) => Promise<{ success: boolean; sessionId?: string }>;
      getSessionHistory: (officeId: string, agentId: string) => Promise<string[]>;
      clearSessionHistory: (officeId: string, agentId: string) => Promise<{ success: boolean }>;
      listActiveTerminals: () => Promise<string[]>;
      queryAgentStatuses: (officeId?: string) => Promise<Record<string, { alive: boolean; ready: boolean }>>;
      setSessionMeta: (officeId: string, agentId: string, meta: { title?: string }) => Promise<{ success: boolean }>;
      getSessionMeta: (officeId: string, agentId: string) => Promise<{ title: string } | null>;
      getAllSessionMeta: (officeId: string) => Promise<Record<string, { title: string }>>;
      createOfficeSession: (officeId: string) => Promise<{ success: boolean }>;
      deleteOfficeSession: (officeId: string) => Promise<{ success: boolean }>;
      transferSession: (fromOfficeId: string, toOfficeId: string, agentId: string) => Promise<{ success: boolean; sessionId?: string }>;
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
      saveOffices: (data: string) => Promise<{ success: boolean; error?: string }>;
      loadOffices: () => Promise<{ success: boolean; data: string | null; error?: string }>;
    };
  }
}
