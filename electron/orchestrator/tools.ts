// Orchestrator SDK tools (spec 016 — T008, contracts/orchestrator-tools.md).
//
// Two in-process tools registered on the orchestrator SDK session:
//   - list_office_agents  (read-only, skipPermission) — discovery
//   - bring_agent_online  (gated) — the single mutation
//
// Both handlers round-trip to the renderer (which owns OfficeManager) via the
// manager's request helpers; the renderer resolves them late over IPC.

import { defineTool } from '@github/copilot-sdk';
import type { Tool } from '@github/copilot-sdk';
import type { BringOnlineCandidate, BringOnlineResult } from './types';

export interface OrchestratorToolDeps {
  requestCandidates: () => Promise<BringOnlineCandidate[]>;
  requestExecute: (agentId: string) => Promise<BringOnlineResult>;
  /** Reserved for future use; officeId is currently derived from candidates. */
  getOfficeId: () => string;
}

export function buildOrchestratorTools(deps: OrchestratorToolDeps): Tool<any>[] {
  const listTool = defineTool('list_office_agents', {
    description:
      'List the dormant agents that can be brought online in the currently viewed ' +
      'office, so you can rank them against the user\'s request. Returns each ' +
      'candidate\'s agentId, name, skill, and description. Takes no arguments.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    skipPermission: true,
    handler: async () => {
      const candidates = await deps.requestCandidates();
      const officeId = candidates[0]?.officeId ?? deps.getOfficeId();
      return { officeId, candidates };
    },
  });

  const bringOnlineTool = defineTool('bring_agent_online', {
    description:
      'Bring a specific dormant agent online in the current office. Only call this ' +
      'with an agentId returned by list_office_agents. This action is gated: the ' +
      'user must approve it before it takes effect.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description: 'Candidate agentId from list_office_agents.',
        },
        reason: {
          type: 'string',
          description: 'Short rationale for why this agent fits the request.',
        },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    handler: async (args: { agentId: string; reason?: string }) => {
      // Reached only AFTER the permission gate approves.
      return deps.requestExecute(args.agentId);
    },
  });

  return [listTool, bringOnlineTool];
}
