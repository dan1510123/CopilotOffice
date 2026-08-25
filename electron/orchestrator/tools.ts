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
  AgentStatusLookup,
  AwaitingAgent,
  BringOnlineCandidate,
  BringOnlineResult,
  OfficeSummary,
  SwitchOfficeResult,
} from './types';

export interface OrchestratorToolDeps {
  requestCandidates: (officeId?: string) => Promise<BringOnlineCandidate[]>;
  requestExecute: (agentId: string, officeId?: string) => Promise<BringOnlineResult>;
  requestOffices: () => Promise<OfficeSummary[]>;
  requestSwitch: (officeId: string) => Promise<SwitchOfficeResult>;
  /** Reserved for future use; officeId is currently derived from candidates. */
  getOfficeId: () => string;
  // ── spec 017: situational awareness (read-only) ────────────────────────────
  requestActiveAgents: (officeId?: string) => Promise<ActiveAgentSnapshot[]>;
  requestAwaitingAgents: (officeId?: string) => Promise<AwaitingAgent[]>;
  requestAgentOutput: (agentId: string, officeId?: string) => Promise<AgentRecentOutput>;
  /** Cheap single-agent status + Teams presence lookup by fuzzy name or agentId. */
  requestAgentStatus: (agent: string, officeId?: string) => Promise<AgentStatusLookup>;
  // ── spec 017: act-on tools (gated) ─────────────────────────────────────────
  requestAnswerAgent: (a: { agentId: string; officeId?: string; answer: string }) => Promise<ActOnResult>;
  requestSendPrompt: (a: { agentId: string; officeId?: string; prompt: string }) => Promise<ActOnResult>;
  requestStopAgent: (a: { agentId: string; officeId?: string }) => Promise<ActOnResult>;
  requestRestartAgent: (a: { agentId: string; officeId?: string }) => Promise<ActOnResult>;
  requestTeamsPresence: (a: { agentId: string; officeId?: string; online: boolean }) => Promise<ActOnResult>;
  requestSetTitle: (a: { agentId: string; officeId?: string; title: string }) => Promise<ActOnResult>;
}

export function buildOrchestratorTools(deps: OrchestratorToolDeps): Tool<any>[] {
  const listTool = defineTool('list_office_agents', {
    description:
      'List the dormant agents that can be brought online in an office, so you can ' +
      'rank them against the user\'s request. Returns each candidate\'s agentId, name, ' +
      'skill, and description. Defaults to the currently viewed office; pass `officeId` ' +
      '(from list_offices) to list a DIFFERENT office\'s dormant agents.',
    parameters: {
      type: 'object',
      properties: {
        officeId: {
          type: 'string',
          description: 'Optional office to list. Omit for the currently viewed office.',
        },
      },
      additionalProperties: false,
    },
    skipPermission: true,
    handler: async (args: { officeId?: string }) => {
      const candidates = await deps.requestCandidates(args.officeId);
      const officeId = args.officeId ?? candidates[0]?.officeId ?? deps.getOfficeId();
      return { officeId, candidates };
    },
  });

  const bringOnlineTool = defineTool('bring_agent_online', {
    description:
      'Bring a dormant agent online. Defaults to the currently viewed office; pass ' +
      '`officeId` (from list_offices / list_office_agents) to bring an agent online in a ' +
      'DIFFERENT office — the desktop will switch to that office automatically. Prefer ' +
      'passing an agentId returned by list_office_agents. If the user does NOT name a ' +
      'specific agent (e.g. "bring someone online", "add another agent"), you may omit ' +
      'agentId — the next dormant agent in that office\'s list is used by default. This ' +
      'action is gated: the user must approve it before it takes effect.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description:
            'Candidate agentId (or name) from list_office_agents. Omit to default to the ' +
            'next dormant agent in the office\'s list.',
        },
        officeId: {
          type: 'string',
          description:
            'Office the agent lives in (from list_offices). Omit for the currently viewed ' +
            'office; when set to a different office the desktop switches to it first.',
        },
        reason: {
          type: 'string',
          description: 'Short rationale for why this agent fits the request.',
        },
      },
      additionalProperties: false,
    },
    handler: async (args: { agentId?: string; officeId?: string; reason?: string }) => {
      // Reached only AFTER the permission gate approves. Default to the next dormant
      // agent in the office's list when the caller did not specify one.
      let agentId = (args.agentId ?? '').trim();
      if (!agentId) {
        const candidates = await deps.requestCandidates(args.officeId);
        if (candidates.length === 0) {
          return {
            agentId: '',
            outcome: 'invalid-target' as const,
            message: 'There are no dormant agents available to bring online in this office.',
          };
        }
        agentId = candidates[0].agentId;
      }
      return deps.requestExecute(agentId, args.officeId);
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
      'List agents that currently have a live session — including agents that are ' +
      'done/awaiting-ack, waiting on input, and thinking — with each agent\'s office, ' +
      'status, current activity, and how long it has been in that state. Use for any ' +
      '"what\'s everyone working on / status roll-up / who is busy" request. By default ' +
      'it spans ALL offices; pass `officeId` to scope the roll-up to a SINGLE office ' +
      '(use this whenever the user asks about one named office, e.g. "who is in Dan\'s ' +
      'office"). Get valid ids from `list_offices`.',
    parameters: {
      type: 'object',
      properties: {
        officeId: {
          type: 'string',
          description: 'Optional office id to scope the roll-up to a single office.',
        },
      },
      additionalProperties: false,
    },
    skipPermission: true,
    handler: async (args: { officeId?: string }) => {
      const agents = await deps.requestActiveAgents(args.officeId);
      return { agents };
    },
  });

  const listAwaitingTool = defineTool('list_agents_awaiting_input', {
    description:
      'List only the agents that are blocked waiting for user input, with each one\'s ' +
      'pending question and how long it has been waiting, longest first. Use for "who ' +
      'needs me / is anyone stuck?" By default it spans ALL offices; pass `officeId` to ' +
      'scope to a SINGLE office. Get valid ids from `list_offices`.',
    parameters: {
      type: 'object',
      properties: {
        officeId: {
          type: 'string',
          description: 'Optional office id to scope the list to a single office.',
        },
      },
      additionalProperties: false,
    },
    skipPermission: true,
    handler: async (args: { officeId?: string }) => {
      const agents = await deps.requestAwaitingAgents(args.officeId);
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

  const getAgentStatusTool = defineTool('get_agent_status', {
    description:
      'Check ONE specific agent by name or agentId — cheaper than get_active_agents ' +
      'when the user names a single agent. Returns whether it has a live session, its ' +
      'status/activity, and its Teams presence (whether it is already online in a Teams ' +
      'thread, with the thread link). Use this to CONFIRM an agent\'s real state before ' +
      'claiming it is offline or unreachable. `agent` may be a fuzzy name (e.g. "Olivia") ' +
      'or an exact agentId; pass `officeId` if you know it. If the name matches more than ' +
      'one agent it returns outcome:"ambiguous" with the choices.',
    parameters: {
      type: 'object',
      properties: {
        agent: { type: 'string', description: 'Agent name (fuzzy) or exact agentId to look up.' },
        officeId: { type: 'string', description: 'Optional office to scope/disambiguate the lookup.' },
      },
      required: ['agent'],
      additionalProperties: false,
    },
    skipPermission: true,
    handler: async (args: { agent: string; officeId?: string }) => {
      return deps.requestAgentStatus(args.agent, args.officeId);
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
      'Bring an agent online in Teams (activate its Teams remote) or take it offline — ' +
      'this also starts the agent\'s session first if it is not up yet, so a single call ' +
      'brings a dormant (incl. reserve) agent all the way online AND into Teams. When ' +
      'bringing online, you may omit agentId (e.g. "bring the next agent online in Teams") ' +
      'to default to the next dormant agent in the office\'s list. Taking an agent OFFLINE ' +
      'requires a specific agentId from a status tool. Gated: the user must approve. If ' +
      'Teams is disabled, the tool reports unavailable — relay that to the user.',
    parameters: {
      type: 'object',
      properties: {
        agentId: {
          type: 'string',
          description:
            'The agent whose Teams presence to change (id or name from a status tool). ' +
            'Omit when bringing online to default to the next dormant agent in the office.',
        },
        officeId: { type: 'string', description: 'Optional office to disambiguate the target.' },
        online: { type: 'boolean', description: 'true to bring online in Teams, false to take offline.' },
      },
      required: ['online'],
      additionalProperties: false,
    },
    handler: async (args: { agentId?: string; officeId?: string; online: boolean }) => {
      // Reached only AFTER the permission gate approves. Mirror bring_agent_online:
      // when bringing an agent online without a named target, default to the next
      // dormant candidate in the office. Taking an agent offline still needs an
      // explicit target (there is no meaningful "next" agent to take offline).
      let agentId = (args.agentId ?? '').trim();
      if (!agentId && args.online) {
        const candidates = await deps.requestCandidates(args.officeId);
        if (candidates.length === 0) {
          return {
            agentId: '',
            officeId: args.officeId ?? deps.getOfficeId(),
            outcome: 'invalid-target' as const,
            message: 'There are no dormant agents available to bring online in this office.',
          };
        }
        agentId = candidates[0].agentId;
      }
      return deps.requestTeamsPresence({ agentId, officeId: args.officeId, online: args.online });
    },
  });

  const setAgentTitleTool = defineTool('set_agent_title', {
    description:
      "Rename an agent's session title (the short label shown for what it is working " +
      'on). Only use an agentId returned by a discovery/status tool. Gated: the user ' +
      'must approve.',
    parameters: {
      type: 'object',
      properties: {
        agentId: { type: 'string', description: 'The agent whose session title to set.' },
        title: { type: 'string', description: 'The new session title.' },
        officeId: { type: 'string', description: 'Optional office to disambiguate the target.' },
      },
      required: ['agentId', 'title'],
      additionalProperties: false,
    },
    handler: async (args: { agentId: string; officeId?: string; title: string }) => {
      return deps.requestSetTitle(args);
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
    getAgentStatusTool,
    answerAgentTool,
    sendPromptTool,
    stopAgentTool,
    restartAgentTool,
    teamsPresenceTool,
    setAgentTitleTool,
  ];
}