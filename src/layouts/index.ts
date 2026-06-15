import { LayoutDefinition, LayoutBehaviors, OfficeLayout } from './types';
import { AGENTS, FLEET_AGENTS } from '../config/agents';
import { defaultDashboard } from './default/DefaultDashboard';
import { defaultClickHandler } from './default/DefaultClickHandler';
import { fleetDashboard } from './fleet/FleetDashboard';
import { fleetClickHandler } from './fleet/FleetClickHandler';

const defaultBehaviors: LayoutBehaviors = {
  supportsReserveAgents: true,
  restrictsInteractionToArchitect: false,
  hasPlayerPcTerminal: true,
  supportsFleetExecution: false,
};

const fleetBehaviors: LayoutBehaviors = {
  supportsReserveAgents: false,
  restrictsInteractionToArchitect: true,
  hasPlayerPcTerminal: false,
  supportsFleetExecution: true,
};

const layouts: Record<OfficeLayout, LayoutDefinition> = {
  'default': {
    agents: AGENTS,
    dashboard: defaultDashboard,
    clickHandler: defaultClickHandler,
    behaviors: defaultBehaviors,
  },
  'fleet-vteam': {
    agents: FLEET_AGENTS,
    dashboard: fleetDashboard,
    clickHandler: fleetClickHandler,
    behaviors: fleetBehaviors,
  },
};

/** Get the layout definition for the given office layout type. Unknown layouts
 * fall back to `default` so callers always get a valid LayoutDefinition. */
export function getLayout(layout: OfficeLayout): LayoutDefinition {
  return layouts[layout] ?? layouts['default'];
}
