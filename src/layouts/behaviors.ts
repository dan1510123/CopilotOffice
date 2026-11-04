import type { LayoutBehaviors, OfficeLayout } from './types';

const behaviors: Record<OfficeLayout, LayoutBehaviors> = {
  default: {
    supportsReserveAgents: true,
    restrictsInteractionToArchitect: false,
    hasPlayerPcTerminal: true,
    supportsFleetExecution: false,
  },
  'fleet-vteam': {
    supportsReserveAgents: false,
    restrictsInteractionToArchitect: true,
    hasPlayerPcTerminal: false,
    supportsFleetExecution: true,
  },
};

export function getLayoutBehaviors(layout: OfficeLayout): LayoutBehaviors {
  return behaviors[layout] ?? behaviors.default;
}
