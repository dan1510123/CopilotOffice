import { vi } from 'vitest';

export type MockCopilotBridge = Window['copilotBridge'];

export function createMockCopilotBridge(
  overrides: Partial<MockCopilotBridge> = {}
): MockCopilotBridge {
  const bridge: Partial<MockCopilotBridge> = {
    terminalStart: vi.fn().mockResolvedValue({ success: true, pid: 1, sessionId: 'session-1' }),
    terminalWrite: vi.fn().mockResolvedValue({ success: true }),
    terminalSubmitAnswer: vi.fn().mockResolvedValue({ success: true }),
    terminalSubmitPrompt: vi.fn().mockResolvedValue({ success: true }),
    terminalResize: vi.fn().mockResolvedValue({ success: true }),
    terminalKill: vi.fn().mockResolvedValue({ success: true }),
    terminalExists: vi.fn().mockResolvedValue(false),
    terminalAttach: vi.fn().mockResolvedValue({ success: true, scrollback: '' }),
    terminalDetach: vi.fn().mockResolvedValue({ success: true }),
    terminalPopOut: vi.fn().mockResolvedValue({ success: true }),
    getSessionId: vi.fn().mockResolvedValue(null),
    setSessionId: vi.fn().mockResolvedValue({ success: true }),
    resetAllSessions: vi.fn().mockResolvedValue({ success: true }),
    resetSession: vi.fn().mockResolvedValue({ success: true, sessionId: 'session-1' }),
    // spec 019: resolves to SessionHistoryEntry[] (default []). Populated-history tests
    // pass entry objects, e.g. mockResolvedValue([{ id: 'u1', title: 'T' }, { id: 'u2' }]).
    getSessionHistory: vi.fn().mockResolvedValue([] as { id: string; title?: string }[]),
    clearSessionHistory: vi.fn().mockResolvedValue({ success: true }),
    listActiveTerminals: vi.fn().mockResolvedValue([]),
    queryAgentStatuses: vi.fn().mockResolvedValue({}),
    setSessionMeta: vi.fn().mockResolvedValue({ success: true }),
    getSessionMeta: vi.fn().mockResolvedValue(null),
    getAllSessionMeta: vi.fn().mockResolvedValue({}),
    createOfficeSession: vi.fn().mockResolvedValue({ success: true }),
    deleteOfficeSession: vi.fn().mockResolvedValue({ success: true }),
    transferSession: vi.fn().mockResolvedValue({ success: true }),
    onTerminalData: vi.fn(),
    onTerminalExit: vi.fn(),
    onTerminalPreloadStatus: vi.fn(),
    onCopilotEvent: vi.fn(),
    onCopilotToolStart: vi.fn(),
    onCopilotToolComplete: vi.fn(),
    onCopilotAskUser: vi.fn(),
    onCopilotTurnEnd: vi.fn(),
    onCopilotTurnStart: vi.fn(),
    onCopilotUserMessage: vi.fn(),
    onSessionMetaUpdated: vi.fn(),
    removeTerminalListeners: vi.fn(),
    removeCopilotListeners: vi.fn(),
    requestHardReload: vi.fn().mockResolvedValue({ success: true }),
    showNativeNotification: vi.fn().mockResolvedValue({ success: true }),
    getBackendInfo: vi.fn().mockResolvedValue(null),
    onBackendFallback: vi.fn(),
    onBackendOnline: vi.fn(),
    onBackendSessionFallback: vi.fn(),
    clipboardWriteText: vi.fn().mockResolvedValue({ success: true, verified: true }),
    clipboardReadText: vi.fn().mockResolvedValue({ success: true, text: '' }),
    saveOffices: vi.fn().mockResolvedValue({ success: true }),
    loadOffices: vi.fn().mockResolvedValue({ success: false, data: null }),
  };

  return { ...bridge, ...overrides } as MockCopilotBridge;
}

export function installMockCopilotBridge(
  overrides: Partial<MockCopilotBridge> = {}
): MockCopilotBridge {
  const bridge = createMockCopilotBridge(overrides);
  Object.defineProperty(window, 'copilotBridge', {
    value: bridge,
    configurable: true,
    writable: true,
  });
  return bridge;
}

