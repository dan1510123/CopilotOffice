import { LayoutDefinition, OfficeLayout } from './types';
import { getLayoutBehaviors } from './behaviors';
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
    behaviors: getLayoutBehaviors('default'),
  },
  'fleet-vteam': {
    agents: FLEET_AGENTS,
    dashboard: fleetDashboard,
    clickHandler: fleetClickHandler,
    behaviors: getLayoutBehaviors('fleet-vteam'),
  },
};

/** Get the layout definition for the given office layout type. Unknown layouts
 * fall back to `default` so callers always get a valid LayoutDefinition. */
export function getLayout(layout: OfficeLayout): LayoutDefinition {
  return layouts[layout] ?? layouts['default'];
}
