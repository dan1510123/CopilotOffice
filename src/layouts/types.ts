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
  }): void;
}

/** Composite layout definition combining all layout-specific behaviors. */
export interface LayoutDefinition {
  agents: AgentConfig[];
  dashboard: DashboardRenderer;
  clickHandler: CardClickHandler;
}

// Re-export for convenience
export type { AgentConfig, AgentStatus, OfficeData, OfficeLayout };
