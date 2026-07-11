import { AgentConfig } from '../config/agents';
import { AgentStatus, OfficeData, OfficeLayout } from '../office/officeManager';
import type { ToolEntry } from '../util/toolStatus';

/** Per-agent session snapshot displayed in the dashboard's session info panel. */
export interface SessionMetaSnapshot {
  title: string;
  /** Current session uuid (the value in `current[agentId]` on disk). Optional
   * because (a) old clients may not pass it and (b) an agent with metadata
   * but no minted session yet legitimately has no id. */
  sessionId?: string;
}

/** Context passed to dashboard renderers for building agent card HTML. */
export interface DashboardRenderContext {
  agents: AgentConfig[];
  office: OfficeData | null;
  selectedAgentId: string | null;
  cachedSessionMeta: Record<string, SessionMetaSnapshot>;
  agentTools: Map<string, ToolEntry[]>;
  formatElapsed: (startTime: number | null) => string;
  formatRelativeTime: (timestamp: number) => string;
  /** Teams Remote (011): whether the feature flag is enabled (gates the tile button). */
  teamsEnabled?: boolean;
  /** Teams Remote (011): agent ids currently online in Teams (for button state). */
  teamsOnlineAgentIds?: Set<string>;
}

/** Renders the right-pane agent overview cards for a specific layout. */
export interface DashboardRenderer {
  renderCards(ctx: DashboardRenderContext): string;
}

/** Handles click events on agent cards. Returns true if the click was handled. */
export interface CardClickHandler {
  handleCardClick(agentId: string, context: {
    setSelectedAgent: (id: string) => void;
    clearUnread: (agentId: string) => void;
    updateContent: () => void;
    emitOpenTerminal: (agentId: string) => void;
  }): void;

  handleMetaPanelClick(target: HTMLElement, agentId: string, context: {
    startSessionMetaEdit: (agentId: string) => void;
    startNewSession: (agentId: string) => void;
    closeSession: (agentId: string) => void;
    /** Teams Remote (011): toggle the agent online/offline in Teams. */
    toggleTeamsRemote?: (agentId: string) => void;
  }): void;
}

/** Composite layout definition combining all layout-specific behaviors. */
export interface LayoutDefinition {
  agents: AgentConfig[];
  dashboard: DashboardRenderer;
  clickHandler: CardClickHandler;
  /** Static, declarative behavior flags so scene code can ask the layout what
   * it supports instead of string-comparing layout ids. Lets new layouts opt
   * into capabilities without modifying every `currentLayout === 'X'` check. */
  behaviors: LayoutBehaviors;
}

/**
 * Declarative capability flags. Default to the most restrictive value so a
 * new layout that omits a flag won't accidentally inherit specialty behavior.
 */
export interface LayoutBehaviors {
  /** Reserve agents can be seated/dismissed (default layout only). */
  supportsReserveAgents: boolean;
  /** Player↔E-key interaction is restricted to the architect NPC only (fleet only). */
  restrictsInteractionToArchitect: boolean;
  /** The clickable PC terminal node is rendered and interactable (default only). */
  hasPlayerPcTerminal: boolean;
  /** /fleet command is accepted from the architect and dismiss-unassigned UI runs (fleet only). */
  supportsFleetExecution: boolean;
}

export interface DashboardTypography {
  cardTitle: string;
  cardTitleLg: string;
  cardDescription: string;
  statusText: string;
  statusPanelText: string;
  statusPanelIcon: string;
  statusDot: string;
  elapsed: string;
  badge: string;
  queue: string;
  toolRow: string;
  sectionLabel: string;
  activityRow: string;
  taskSummary: string;
  sessionLabel: string;
  sessionTitle: string;
  sessionTitleLg: string;
  sessionButton: string;
  emptyState: string;
  arthurHint: string;
}

const DESKTOP_DASHBOARD_TYPOGRAPHY: DashboardTypography = {
  cardTitle: '15px',
  cardTitleLg: '18px',
  cardDescription: '11px',
  statusText: '11px',
  statusPanelText: '13px',
  statusPanelIcon: '26px',
  statusDot: '8px',
  elapsed: '10px',
  badge: '10px',
  queue: '9px',
  toolRow: '10px',
  sectionLabel: '9px',
  activityRow: '10px',
  taskSummary: '10px',
  sessionLabel: '9px',
  sessionTitle: '13px',
  sessionTitleLg: '15px',
  sessionButton: '11px',
  emptyState: '11px',
  arthurHint: '10px',
};

const MOBILE_DASHBOARD_TYPOGRAPHY: DashboardTypography = {
  cardTitle: '19px',
  cardTitleLg: '24px',
  cardDescription: '15px',
  statusText: '16px',
  statusPanelText: '18px',
  statusPanelIcon: '34px',
  statusDot: '11px',
  elapsed: '14px',
  badge: '13px',
  queue: '13px',
  toolRow: '14px',
  sectionLabel: '13px',
  activityRow: '14px',
  taskSummary: '14px',
  sessionLabel: '13px',
  sessionTitle: '17px',
  sessionTitleLg: '20px',
  sessionButton: '14px',
  emptyState: '14px',
  arthurHint: '14px',
};

export function getDashboardTypography(): DashboardTypography {
  const isMobile = typeof window !== 'undefined' && window.__copilotOfficeMobileModeActive?.() === true;
  return isMobile ? MOBILE_DASHBOARD_TYPOGRAPHY : DESKTOP_DASHBOARD_TYPOGRAPHY;
}

// Re-export for convenience
export type { AgentConfig, AgentStatus, OfficeData, OfficeLayout };
