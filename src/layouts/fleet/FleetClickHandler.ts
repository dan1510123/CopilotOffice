import { CardClickHandler } from '../types';
import { ARCHITECT_AGENT_ID } from '../../config/agents';

/**
 * Click handler for the fleet v-team layout.
 * Most fleet agents are read-only — clicking does nothing.
 * Arthur (the Architect) is the exception: clicking his card opens a read-only terminal view.
 */
export const fleetClickHandler: CardClickHandler = {
  handleCardClick(agentId, context) {
    if (agentId === ARCHITECT_AGENT_ID) {
      context.setSelectedAgent(agentId);
      context.emitOpenTerminal(agentId);
      return;
    }
    // No-op for other fleet agents
  },

  handleMetaPanelClick(_target, _agentId, _context) {
    // No-op: fleet agents have no session metadata panel
  },
};
