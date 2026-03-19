import type { AgentStatus } from '../../src/office/officeManager';

export function createAgentStatus(
  agentId: string,
  overrides: Partial<AgentStatus> = {}
): AgentStatus {
  return {
    agentId,
    state: 'slacking',
    subState: null,
    thinkingDetail: null,
    currentTool: null,
    unreadCount: 0,
    lastEvent: null,
    activityStartTime: null,
    lastCompletedAction: null,
    recentActions: [],
    taskSummary: null,
    ...overrides,
  };
}

