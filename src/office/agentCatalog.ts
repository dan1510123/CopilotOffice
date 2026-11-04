import { DEFAULT_AGENTS, DEFAULT_RESERVE_MAP, FLEET_AGENTS, type AgentConfig } from '../config/agents';
import { getLayoutBehaviors } from '../layouts/behaviors';
import type { OfficeConfig } from './officeManager';
import type { BringOnlineCandidate } from '../../electron/orchestrator/types';

export interface CatalogAgent extends BringOnlineCandidate {
  config: AgentConfig;
  office: OfficeConfig;
}

export function buildAgentCatalog(offices: readonly OfficeConfig[]): CatalogAgent[] {
  return offices.flatMap((office) => {
    const supportsReserve = getLayoutBehaviors(office.layout).supportsReserveAgents;
    const defaults = supportsReserve ? DEFAULT_AGENTS : FLEET_AGENTS;
    const core = office.id === 'office-0' || !office.customAgents?.length ? defaults : office.customAgents;
    const reserves = office.id === 'office-0' || !office.customAgents?.length
      ? DEFAULT_RESERVE_MAP : office.customReserveAgents ?? {};
    const result: CatalogAgent[] = core.map((config) => ({
      agentId: config.id, name: config.name, skill: config.skill, description: config.description,
      source: 'idle-seated', deskId: null, officeId: office.id, config, office,
    }));
    if (!supportsReserve) return result;
    for (const [deskId, config] of Object.entries(reserves)) {
      if (result.some((a) => a.agentId === config.id)) continue;
      const seat = office.seatedAgents.find((s) => s.deskId === deskId);
      if (seat && seat.agentId !== config.id) continue;
      result.push({
        agentId: config.id, name: config.name, skill: config.skill, description: config.description,
        source: seat ? 'idle-seated' : 'reserve', deskId, officeId: office.id, config, office,
      });
    }
    return result;
  });
}

export function matchCatalogAgents(catalog: readonly CatalogAgent[], query: string, officeId?: string): CatalogAgent[] {
  const scope = officeId ? catalog.filter((a) => a.officeId === officeId) : [...catalog];
  const q = query.trim().toLowerCase();
  if (!q) return scope;
  const exactId = scope.filter((a) => a.agentId.toLowerCase() === q);
  if (exactId.length) return exactId;
  const exactName = scope.filter((a) => a.name.toLowerCase() === q);
  if (exactName.length) return exactName;
  return scope.filter((a) => a.name.toLowerCase().includes(q));
}
