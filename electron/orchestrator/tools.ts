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
import type {
  ActiveAgentSnapshot,
  ActOnResult,
  AgentRecentOutput,
  AwaitingAgent,
  BringOnlineCandidate,
  BringOnlineResult,
  OfficeSummary,
  SwitchOfficeResult,
} from './types';

export interface OrchestratorToolDeps {
  requestCandidates: () => Promise<BringOnlineCandidate[]>;
  requestExecute: (agentId: string) => Promise<BringOnlineResult>;
  requestOffices: () => Promise<OfficeSummary[]>;
  requestSwitch: (officeId: string) => Promise<SwitchOfficeResult>;
  /** Reserved for future use; officeId is currently derived from candidates. */
  getOfficeId: () => string;
  // ── spec 017: situational awareness (read-only) ────────────────────────────
  requestActiveAgents: () => Promise<ActiveAgentSnapshot[]>;
  requestAwaitingAgents: () => Promise<AwaitingAgent[]>;
  requestAgentOutput: (agentId: string, officeId?: string) => Promise<AgentRecentOutput>;
  // ── spec 017: act-on tools (gated) ─────────────────────────────────────────
  requestAnswerAgent: (a: { agentId: string; officeId?: string; answer: string }) => Promise<ActOnResult>;
  requestSendPrompt: (a: { agentId: string; officeId?: string; prompt: string }) => Promise<ActOnResult>;
  requestStopAgent: (a: { agentId: string; officeId?: string }) => Promise<ActOnResult>;
  requestRestartAgent: (a: { agentId: string; officeId?: string }) => Promise<ActOnResult>;
  requestTeamsPresence: (a: { agentId: string; officeId?: string; online: boolean }) => Promise<ActOnResult>;
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

  const listOfficesTool = defineTool('list_offices', {
    description:
      'List every virtual office (not just the one currently shown), so you can tell ' +
      'whether the agent the user needs might live in a different office. Returns each ' +
      'office\'s officeId, name, layout, whether it is the current office, and how many ' +
      'agents are online there. Takes no arguments.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    skipPermission: true,
    handler: async () => {
      const offices = await deps.requestOffices();
      return { offices };
    },
  });

  const switchOfficeTool = defineTool('switch_office', {
    description:
      'Switch the desktop to a different office by officeId (use one returned by ' +
      'list_offices). Do this before bringing an agent online when the right agent lives ' +
      'in another office. This is a reversible navigation action and is NOT gated. After ' +
      'switching, call list_office_agents again — the candidate list is scoped to the ' +
      'newly-selected office.',
    parameters: {
      type: 'object',
      properties: {
        officeId: {
          type: 'string',
          description: 'Target officeId from list_offices.',
        },
      },
      required: ['officeId'],
      additionalProperties: false,
    },
    skipPermission: true,
    handler: async (args: { officeId: string }) => {
      return deps.requestSwitch(args.officeId);
    },
  });

  // ── spec 017: read-only situational-awareness tools ────────────────────────

  const getActiveAgentsTool = defineTool('get_active_agents', {
    description:
      'List every agent that currently has a live session across ALL offices — ' +
      'including agents that are done/awaiting-ack, waiting on input, and thinking — ' +
      "with each agent's office, status, current activity, and how long it has been in " +
      "that state. Use for any \"what's everyone working on / status roll-up / who is " +
      'busy" request. Takes no arguments.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    skipPermission: true,
    handler: async () => {
      const agents = await deps.requestActiveAgents();
      return { agents };
    },
  });

  const listAwaitingTool = defineTool('list_agents_awaiting_input', {
    description:
      'List only the agents that are blocked waiting for user input, with each one\'s ' +
      'pending question and how long it has been waiting, longest first. Use for "who ' +
      'needs me / is anyone stuck?" Takes no arguments.',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    skipPermission: true,
    handler: async () => {
      const agents = await deps.requestAwaitingAgents();
      return { agents };
    },
  });

  const getAgentTranscriptTool = defineTool('get_agent_transcript', {
    description:
      "Fetch a bounded window of a specific agent's recent output so you can summarize " +
      'or relay what it just did — without opening its terminal. Read-only. Provide the ' +
      'agentId (and officeId if known); if the agent has no recent output, it returns ' +
      'hasOutput:false ("nothing recent").',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'Target agentId from a status tool.' },
        officeId: { type: 'string', description: 'Optional office to disambiguate the target.' },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    skipPermission: true,
    handler: async (args: { agentId: string; officeId?: string }) => {
      return deps.requestAgentOutput(args.agentId, args.officeId);
    },
  });

  // ── spec 017: gated act-on tools (always gated, non-YOLO) ───────────────────

  const answerAgentTool = defineTool('answer_agent', {
    description:
      'Deliver the user\'s answer to an agent that is waiting for input, unblocking it. ' +
      'Only use an agentId returned by a status tool. Gated: the user must approve.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The waiting agent to answer.' },
        officeId: { type: 'string', description: 'Optional office to disambiguate the target.' },
        answer: { type: 'string', description: "The user's answer to deliver." },
      },
      required: ['agentId', 'answer'],
      additionalProperties: false,
    },
    handler: async (args: { agentId: string; officeId?: string; answer: string }) => {
      // Reached only AFTER the permission gate approves.
      return deps.requestAnswerAgent(args);
    },
  });

  const sendPromptTool = defineTool('send_prompt_to_agent', {
    description:
      'Send a follow-up prompt/task to an already-online agent (by capability or name). ' +
      'Only use an agentId returned by a status tool. Gated: the user must approve.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The online agent to prompt.' },
        officeId: { type: 'string', description: 'Optional office to disambiguate the target.' },
        prompt: { type: 'string', description: 'The follow-up prompt/task to deliver.' },
      },
      required: ['agentId', 'prompt'],
      additionalProperties: false,
    },
    handler: async (args: { agentId: string; officeId?: string; prompt: string }) => {
      return deps.requestSendPrompt(args);
    },
  });

  const stopAgentTool = defineTool('stop_agent', {
    description:
      'Stop / take an online agent offline. Destructive. Only use an agentId returned by ' +
      'a status tool. Gated: the user must approve.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent to stop / take offline.' },
        officeId: { type: 'string', description: 'Optional office to disambiguate the target.' },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    handler: async (args: { agentId: string; officeId?: string }) => {
      return deps.requestStopAgent(args);
    },
  });

  const restartAgentTool = defineTool('restart_agent', {
    description:
      "Restart an agent's session and report it ready. Only use an agentId returned by a " +
      'status tool. Gated: the user must approve.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent to restart.' },
        officeId: { type: 'string', description: 'Optional office to disambiguate the target.' },
      },
      required: ['agentId'],
      additionalProperties: false,
    },
    handler: async (args: { agentId: string; officeId?: string }) => {
      return deps.requestRestartAgent(args);
    },
  });

  const teamsPresenceTool = defineTool('set_agent_teams_presence', {
    description:
      'Bring a specific agent online in Teams (activate its Teams remote) or take it ' +
      'offline. Gated: the user must approve. If Teams is disabled, the tool reports ' +
      'unavailable — relay that to the user. Only use an agentId returned by a status tool.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent whose Teams presence to change.' },
        officeId: { type: 'string', description: 'Optional office to disambiguate the target.' },
        online: { type: 'boolean', description: 'true to bring online in Teams, false to take offline.' },
      },
      required: ['agentId', 'online'],
      additionalProperties: false,
    },
    handler: async (args: { agentId: string; officeId?: string; online: boolean }) => {
      return deps.requestTeamsPresence(args);
    },
  });

  return [
    listTool,
    listOfficesTool,
    bringOnlineTool,
    switchOfficeTool,
    getActiveAgentsTool,
    listAwaitingTool,
    getAgentTranscriptTool,
    answerAgentTool,
    sendPromptTool,
    stopAgentTool,
    restartAgentTool,
    teamsPresenceTool,
  ];
}