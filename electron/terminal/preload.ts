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
  terminalAttach: (agentId: string): Promise<{ success: boolean; scrollback?: string[] }> => {
    return ipcRenderer.invoke('terminal-attach', agentId);
  },
  terminalDetach: (agentId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('terminal-detach', agentId);
  },
  terminalPopOut: (agentId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('terminal-pop-out', agentId);
  },
  
  // Session persistence
  saveSessionId: (agentId: string, sessionId: string): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('save-session-id', agentId, sessionId);
  },
  getSessionId: (agentId: string): Promise<string | null> => {
    return ipcRenderer.invoke('get-session-id', agentId);
  },
  resetAllSessions: (): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('reset-all-sessions');
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
  onCopilotUserMessage: (callback: (agentId: string) => void) => {
    ipcRenderer.on('copilot-user-message', (_event, agentId) => callback(agentId));
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
    ipcRenderer.removeAllListeners('copilot-user-message');
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
      terminalAttach: (agentId: string) => Promise<{ success: boolean; scrollback?: string[] }>;
      terminalDetach: (agentId: string) => Promise<{ success: boolean }>;
      terminalPopOut: (agentId: string) => Promise<{ success: boolean }>;
      saveSessionId: (agentId: string, sessionId: string) => Promise<{ success: boolean }>;
      getSessionId: (agentId: string) => Promise<string | null>;
      resetAllSessions: () => Promise<{ success: boolean }>;
      onTerminalData: (callback: (agentId: string, data: string) => void) => void;
      onTerminalExit: (callback: (agentId: string, exitCode: number) => void) => void;
      onTerminalPreloadStatus: (callback: (agentId: string, status: 'preloading' | 'ready' | 'failed') => void) => void;
      onCopilotEvent: (callback: (agentId: string, event: CopilotEventData) => void) => void;
      onCopilotToolStart: (callback: (agentId: string, toolName: string, toolId: string, status: string) => void) => void;
      onCopilotToolComplete: (callback: (agentId: string, toolId: string, success: boolean) => void) => void;
      onCopilotTurnEnd: (callback: (agentId: string) => void) => void;
      onCopilotUserMessage: (callback: (agentId: string) => void) => void;
      removeTerminalListeners: () => void;
      removeCopilotListeners: () => void;
    };
  }
}
