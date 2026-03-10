import { LayoutDefinition, OfficeLayout } from './types';
import { AGENTS, FLEET_AGENTS } from '../config/agents';
import { defaultDashboard } from './default/DefaultDashboard';
import { defaultClickHandler } from './default/DefaultClickHandler';
import { fleetDashboard } from './fleet/FleetDashboard';
import { fleetClickHandler } from './fleet/FleetClickHandler';

const layouts: Record<OfficeLayout, LayoutDefinition> = {
  'default': {
    agents: AGENTS,
    dashboard: defaultDashboard,
    clickHandler: defaultClickHandler,
  },
  'fleet-vteam': {
    agents: FLEET_AGENTS,
    dashboard: fleetDashboard,
    clickHandler: fleetClickHandler,
  },
};

/** Get the layout definition for the given office layout type. */
export function getLayout(layout: OfficeLayout): LayoutDefinition {
  return layouts[layout] ?? layouts['default'];
}
