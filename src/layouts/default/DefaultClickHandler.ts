import { CardClickHandler } from '../types';

/**
 * Click handler for the default (main) office layout.
 * Clicking an agent card opens the terminal overlay.
 */
export const defaultClickHandler: CardClickHandler = {
  handleCardClick(agentId, context) {
    context.setSelectedAgent(agentId);
    if (agentId !== 'pc-terminal') {
      context.clearUnread(agentId);
    }
    context.updateContent();
    context.emitOpenTerminal(agentId);
  },

  handleMetaPanelClick(target, agentId, context) {
    if (target.closest('.session-close-btn')) {
      context.closeSession(agentId);
      return;
    }
    if (target.closest('.session-new-btn')) {
      context.startNewSession(agentId);
      return;
    }
    if (target.closest('.session-edit-btn') || target.closest('.session-title-display')) {
      context.startSessionMetaEdit(agentId);
    }
  },
};
