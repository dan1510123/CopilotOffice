import { CardClickHandler } from '../types';

/**
 * Click handler for the fleet v-team layout.
 * Most fleet agents are read-only — clicking does nothing.
 * Arthur (the Architect) is the exception: clicking his card opens a read-only terminal view.
 */
export const fleetClickHandler: CardClickHandler = {
  handleCardClick(agentId, context) {
    if (agentId === 'architect') {
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
