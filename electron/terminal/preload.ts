import { contextBridge, ipcRenderer } from 'electron';

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
  getSessionHistory: (officeId: string, agentId: string): Promise<string[]> => {
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
  onTerminalData: (callback: (agentId: string, data: string) => void) => {
    const handler = (_event: unknown, agentId: string, data: string) => callback(agentId, data);
    ipcRenderer.on('terminal-data', handler);
    return () => ipcRenderer.removeListener('terminal-data', handler);
  },
  onTerminalExit: (callback: (agentId: string, exitCode: number) => void) => {
    const handler = (_event: unknown, agentId: string, exitCode: number) => callback(agentId, exitCode);
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
  teamsRegister: (ctx: { officeId: string; agentId: string; displayName: string; workingDir: string; officeChannelUrl?: string }): Promise<{ success: boolean; handle?: string; threadWebUrl?: string; error?: string }> => {
    return ipcRenderer.invoke('teams:register', ctx);
  },
  teamsStop: (args: { officeId: string; agentId: string }): Promise<{ success: boolean }> => {
    return ipcRenderer.invoke('teams:stop', args);
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
      terminalResize: (officeId: string, agentId: string, cols: number, rows: number) => Promise<{ success: boolean; error?: string }>;
      terminalKill: (officeId: string, agentId: string) => Promise<{ success: boolean; error?: string }>;
      setYolo: (enabled: boolean) => Promise<{ success: boolean }>;
      setAdditionalParams: (params: string) => Promise<{ success: boolean }>;
      terminalExists: (officeId: string, agentId: string) => Promise<boolean>;
      terminalAttach: (officeId: string, agentId: string, foreground?: boolean) => Promise<{ success: boolean; scrollback?: string }>;
      terminalDetach: (officeId: string, agentId: string) => Promise<{ success: boolean }>;
      terminalPopOut: (officeId: string, agentId: string) => Promise<{ success: boolean }>;
      getSessionId: (officeId: string, agentId: string) => Promise<string | null>;
      setSessionId: (officeId: string, agentId: string, sessionId: string) => Promise<{ success: boolean }>;
      resetAllSessions: (officeId: string) => Promise<{ success: boolean }>;
      resetSession: (officeId: string, agentId: string) => Promise<{ success: boolean; sessionId?: string }>;
      getSessionHistory: (officeId: string, agentId: string) => Promise<string[]>;
      clearSessionHistory: (officeId: string, agentId: string) => Promise<{ success: boolean }>;
      listActiveTerminals: () => Promise<string[]>;
      queryAgentStatuses: (officeId?: string) => Promise<Record<string, { alive: boolean; ready: boolean; inTurn: boolean }>>;
      setSessionMeta: (officeId: string, agentId: string, meta: { title?: string }) => Promise<{ success: boolean }>;
      getSessionMeta: (officeId: string, agentId: string) => Promise<{ title: string } | null>;
      getAllSessionMeta: (officeId: string) => Promise<Record<string, { title: string; sessionId?: string }>>;
      createOfficeSession: (officeId: string) => Promise<{ success: boolean }>;
      deleteOfficeSession: (officeId: string) => Promise<{ success: boolean }>;
      transferSession: (fromOfficeId: string, toOfficeId: string, agentId: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
      onTerminalData: (callback: (agentId: string, data: string) => void) => () => void;
      onTerminalExit: (callback: (agentId: string, exitCode: number) => void) => () => void;
      onTerminalPreloadStatus: (callback: (agentId: string, status: 'preloading' | 'ready' | 'failed') => void) => () => void;
      onCopilotEvent: (callback: (agentId: string, event: CopilotEventData) => void) => () => void;
      onCopilotToolStart: (callback: (agentId: string, toolName: string, toolId: string, status: string) => void) => () => void;
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
      teamsRegister: (ctx: { officeId: string; agentId: string; displayName: string; workingDir: string; officeChannelUrl?: string }) => Promise<{ success: boolean; handle?: string; threadWebUrl?: string; error?: string }>;
      teamsStop: (args: { officeId: string; agentId: string }) => Promise<{ success: boolean }>;
      teamsReconcile: () => Promise<{ success: boolean }>;
      teamsGetSettings: () => Promise<{ success: boolean; settings: TeamsSettingsShape }>;
      teamsSaveSettings: (settings: TeamsSettingsShape) => Promise<{ success: boolean; parsed?: unknown; error?: string }>;
      onTeamsStatusChanged: (callback: (status: TeamsAgentStatus) => void) => void;
      onTeamsToast: (callback: (toast: { level: string; message: string; durationMs?: number }) => void) => void;
    };
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
