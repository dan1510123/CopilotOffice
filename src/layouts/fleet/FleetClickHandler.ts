import { CardClickHandler } from '../types';

/**
 * Click handler for the fleet v-team layout.
 * Clicking an agent card does nothing — fleet agents don't open terminals.
 */
export const fleetClickHandler: CardClickHandler = {
  handleCardClick(_agentId, _context) {
    // No-op: fleet agents do not open terminals
  },

  handleMetaPanelClick(_target, _agentId, _context) {
    // No-op: fleet agents have no session metadata
  },
};
