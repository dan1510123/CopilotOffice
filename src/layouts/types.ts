import { AgentConfig } from '../config/agents';
import { AgentStatus, OfficeData, OfficeLayout } from '../office/officeManager';

/** Context passed to dashboard renderers for building agent card HTML. */
export interface DashboardRenderContext {
  agents: AgentConfig[];
  office: OfficeData | null;
  selectedAgentId: string | null;
  cachedSessionMeta: Record<string, { title: string }>;
  agentTools: Map<string, { toolId: string; name: string; status: string }[]>;
  formatElapsed: (startTime: number | null) => string;
  formatRelativeTime: (timestamp: number) => string;
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
  }): void;
}

/** Composite layout definition combining all layout-specific behaviors. */
export interface LayoutDefinition {
  agents: AgentConfig[];
  dashboard: DashboardRenderer;
  clickHandler: CardClickHandler;
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
