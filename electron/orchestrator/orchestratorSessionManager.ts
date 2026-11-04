// Orchestrator SDK session manager (spec 016 — T005/T006/T007/T022).
//
// Owns the single dedicated "orchestrator agent" SDK session. Unlike the office
// backends (electron/terminal/*), this session:
//   - runs in the Electron MAIN process (not the terminal child server),
//   - is a separate `RuntimeConnection.forStdio` SDK session keyed by nothing in
//     `activeAgentViewers` (it is NOT an office agent),
//   - gates writes using its own persisted Ringleader setting, independent of
//     the global agent YOLO toggle. Reads never require approval.
//
// The manager exposes candidate/execute round-trips that the two SDK tools call;
// those round-trips are resolved late by the renderer (which owns OfficeManager)
// over the `orchestrator:*` IPC surface.

import { randomUUID } from 'crypto';
import type { PermissionHandler, PermissionRequestResult } from '@github/copilot-sdk';
import { mapSdkEventToCopilotEvent } from '../terminal/event-source';
import { resolveCopilotCliPath } from '../terminal/terminal-backend';
import { buildOrchestratorTools } from './tools';
import type {
  ActiveAgentSnapshot,
  ActOnResult,
  AgentRecentOutput,
  AgentStatusLookup,
  AwaitingAgent,
  BringOnlineCandidate,
  BringOnlineResult,
  OfficeSummary,
  OrchestratorLifecycle,
  OrchestratorSessionInfo,
  OrchestratorTranscript,
  PermissionDecision,
  SwitchOfficeResult,
  TeamsAgentsPauseResult,
  TranscriptOrigin,
  TranscriptRole,
  TranscriptTurn,
} from './types';
import {
  appendTurn,
  type OrchestratorTranscriptStore,
} from './orchestratorTranscriptStore';
import type { CopilotEvent } from '../terminal/events-watcher';
import { AgentTargetError, type AgentLifecycle } from './agentLifecycle';

/** Write tools governed by the Ringleader approval setting. */
const ACT_ON_TOOLS = new Set([
  'answer_agent',
  'send_prompt_to_agent',
  'stop_agent',
  'restart_agent',
  'set_agent_teams_presence',
  'set_agent_title',
]);

/** Union of all gated tool names (baseline bring_agent_online + act-on tools + the
 *  dedicated Teams-agents-pause tool, which uses its own request/respond pair
 *  rather than the shared ActOn plumbing). */
const GATED_TOOLS = new Set(['bring_agent_online', 'switch_office', 'set_teams_agents_connection', ...ACT_ON_TOOLS]);

const ORCHESTRATOR_SYSTEM_PROMPT = [
  'You are the Office Orchestrator — a concierge that helps the user bring the right',
  'Copilot agent "online" across ALL virtual offices. You are not present in any office.',
  '',
  'Workflow for every request:',
  '1. Call the `list_office_agents` tool to see who can be brought online right now',
  '   (each candidate has an `agentId`, `name`, `skill`, and `description`).',
  '2. Rank the candidates against the user\'s natural-language need using `skill` and',
  '   `description`. The user will usually describe WHAT they need (e.g. "someone to',
  '   review my code", "help me deploy"), not an agent by name.',
  '3. When you find a good fit, call `bring_agent_online` with the concrete `agentId`',
  '   and a short `reason` explaining why it fits. State your pick clearly.',
  '   Write tools require approval unless Settings > Ringleader allows all operations.',
  '   The host enforces the current setting; do not ask for approval conversationally.',
  '3a. If the user asks to bring an agent online WITHOUT naming one ("bring someone',
  '   online", "add another agent", "spin one up"), search ALL offices. If multiple',
  '   inactive candidates fit, ask which office/agent they mean. Never default to the',
  '   currently viewed office or arbitrarily take the first candidate.',
  '4. If there is no good fit, or the candidate list is empty, DO NOT guess — tell the',
  '   user plainly that nothing matches and suggest they pick manually.',
  '',
  'Working across offices:',
  '- `list_office_agents` and `bring_agent_online` search ALL offices by default.',
  '  To target ONE office, first call `list_offices` to get its',
  '  `officeId` (each office has `officeId`, `name`, `layout`, `isCurrent`, `activeAgentCount`).',
  '- To bring an agent online in another office, you do NOT need a separate `switch_office`',
  '  call: pass that `officeId` to `list_office_agents` (to see its candidates) and to',
  '  `bring_agent_online`. Activation is background-only and NEVER switches the desktop.',
  '- The same agent NAME can exist in multiple offices (e.g. a "Rhys" in several offices).',
  '  When the user names an office, ALWAYS pass its `officeId` so you act on the right one.',
  '- `switch_office` is still available for plain navigation; it follows the write approval setting',
  '  and changes what the desktop user sees, so mention when you switch.',
  '',
  'Keep replies concise and conversational. Never invent an agentId that was not',
  'returned by `list_office_agents`, and never invent an officeId that was not returned',
  'by `list_offices`.',
  '',
  'Situational awareness & acting on agents (across ALL offices):',
  '- For any "what is everyone working on / give me a status roll-up / who is busy"',
  '  request, call `get_active_agents`. With no arguments it lists every agent with a live',
  '  session across ALL offices; when the user asks about ONE named office ("who is in',
  '  Dan\'s office", "agents in the QA office"), FIRST resolve that office to its `officeId`',
  '  via `list_offices`, then call `get_active_agents` with that `officeId` so the roll-up',
  '  is scoped to that office only. Each result carries its own `officeName`/`officeId` —',
  '  NEVER relabel agents from the unscoped (all-offices) list as belonging to one office;',
  '  if you did not pass an `officeId`, group the rows by their `officeName` and say the',
  '  list spans all offices. Report from the tool result; do not guess. When you present the',
  '  roll-up, order the columns as Office, Name, Status (then activity and time-in-state) —',
  '  lead with the office, not the raw agentId.',
  '- For "who is stuck / who needs me / is anyone waiting on me", call',
  '  `list_agents_awaiting_input` — with no arguments across all offices, or with an',
  '  `officeId` to scope to one office. It returns only the blocked agents, longest-waiting',
  '  first, each with its pending question.',
  '- For "what did X just do / summarize what X is doing", call `get_agent_transcript`',
  '  with that agent\'s `agentId` (and `officeId` if you know it). It returns a bounded,',
  '  read-only window of recent output; if there is nothing recent, say so.',
  '- When the user asks about ONE specific agent by name or id ("is Olivia online?", "is',
  '  Dan on Teams?"), prefer `get_agent_status` ({ agent }) over `get_active_agents` — it',
  '  is cheaper and resolves a fuzzy name, returning that one agent\'s session status AND',
  '  Teams presence (online + thread link). If it returns outcome:"ambiguous", ask the',
  '  user which of the listed matches they mean.',
  '- To unblock a waiting agent with the user\'s answer, call `answer_agent`',
  '  ({ agentId, answer }). To hand an already-online agent a follow-up task, call',
  '  `send_prompt_to_agent` ({ agentId, prompt }). To stop / take an agent offline call',
  '  `stop_agent`, to restart it call `restart_agent`, and to bring it online in Teams (or',
  '  take it offline there) call `set_agent_teams_presence` ({ agentId, online }). Bringing',
  '  an agent online in Teams automatically starts its session first if it is not up yet —',
  '  you do NOT need a separate step. When bringing online you may OMIT agentId (e.g. "bring',
  '  a new agent online in Teams") only when one inactive candidate exists; otherwise clarify. A',
  '  taking-offline call still needs a specific agentId. To rename an agent\'s session title call',
  '  `set_agent_title` ({ agentId, title }). If Teams is disabled the presence tool will',
  '  say so — relay that to the user.',
  '- Every act-on tool (answer/send/stop/restart/teams-presence/title) follows the Ringleader',
  '  write approval setting, so state your pick and target clearly. Only',
  '  ever use an `agentId`/`officeId` returned by a discovery/status tool — never invent',
  '  one. If a tool reports a typed outcome like `not-online`, `not-waiting`, or',
  '  `invalid-target`, relay it plainly and suggest the sensible next step.',
  '- NEVER claim an agent lacks a session, is not online, or is not connected to Teams from',
  '  memory or assumption. Before saying an action "failed" or "can\'t be done" because of',
  '  the agent\'s state, you MUST first confirm its current state — use `get_agent_status`',
  '  for a single named agent (or `get_active_agents` / `list_office_agents` when you need',
  '  the full picture) — then attempt the actual tool call (`send_prompt_to_agent`,',
  '  `set_agent_teams_presence`, etc.) and report its real, typed result. Only tell the',
  '  user to act manually (e.g. "open the terminal yourself") after a tool call has',
  '  actually failed with an outcome like `not-online`.',
  '- NEW/another-agent requests must choose an agent WITHOUT an active or starting',
  '  session. Done, busy, waiting and live-but-not-ready agents are not new candidates.',
  '  For a NEW agent to Teams call set_agent_teams_presence with requireInactive:true:',
  '  the host starts it, waits for actual readiness, then connects Teams in one operation.',
  '  For Teams-only requests targeting a named existing session omit requireInactive.',
  '  Preserve Teams pause and report paused/partial failures exactly as returned.',
].join('\n');

/** Emitters the manager uses to push to the renderer (wired by orchestratorIpc). */
export interface OrchestratorEmitter {
  emitSeatRequest?(payload: { requestId: string; officeId: string; agentId: string; deskId: string; deadline: number }): void;
  emitEvent(sessionId: string, event: CopilotEvent): void;
  emitPermissionRequest(payload: {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    args: {
      agentId?: string;
      agentName?: string;
      officeId?: string;
      answer?: string;
      prompt?: string;
      online?: boolean;
      title?: string;
      reason?: string;
      paused?: boolean;
    };
  }): void;
  emitCandidatesRequest(payload: { sessionId: string; requestId: string; officeId?: string }): void;
  emitExecuteRequest(payload: { sessionId: string; requestId: string; agentId: string; officeId?: string }): void;
  emitOfficesRequest(payload: { sessionId: string; requestId: string }): void;
  emitSwitchRequest(payload: { sessionId: string; requestId: string; officeId: string }): void;
  // ── spec 017 (new request channels) ────────────────────────────────────────
  emitActiveAgentsRequest?(payload: { sessionId: string; requestId: string; officeId?: string }): void;
  emitAwaitingAgentsRequest?(payload: { sessionId: string; requestId: string; officeId?: string }): void;
  emitAgentOutputRequest?(payload: {
    sessionId: string;
    requestId: string;
    agentId: string;
    officeId?: string;
  }): void;
  emitAgentStatusRequest?(payload: {
    sessionId: string;
    requestId: string;
    agent: string;
    officeId?: string;
  }): void;
  emitAnswerAgentRequest?(payload: {
    sessionId: string;
    requestId: string;
    agentId: string;
    officeId?: string;
    answer: string;
  }): void;
  emitSendPromptRequest?(payload: {
    sessionId: string;
    requestId: string;
    agentId: string;
    officeId?: string;
    prompt: string;
  }): void;
  emitStopAgentRequest?(payload: {
    sessionId: string;
    requestId: string;
    agentId: string;
    officeId?: string;
  }): void;
  emitRestartAgentRequest?(payload: {
    sessionId: string;
    requestId: string;
    agentId: string;
    officeId?: string;
  }): void;
  emitTeamsPresenceRequest?(payload: {
    sessionId: string;
    requestId: string;
    agentId: string;
    officeId?: string;
    online: boolean;
  }): void;
  /** Pause/resume non-orchestrator agent Teams connections (never the orchestrator's own). */
  emitTeamsAgentsPauseRequest?(payload: {
    sessionId: string;
    requestId: string;
    paused: boolean;
  }): void;
  emitSetTitleRequest?(payload: {
    sessionId: string;
    requestId: string;
    agentId: string;
    officeId?: string;
    title: string;
  }): void;
  emitExit(payload: { sessionId: string; reason: string }): void;
}

interface SdkModule {
  CopilotClient: new (options?: Record<string, unknown>) => any;
  RuntimeConnection: { forStdio: (opts?: { path?: string; args?: readonly string[] }) => unknown };
}

export class OrchestratorSessionManager {
  private agentLifecycle: AgentLifecycle | null = null;
  private readonly approvedTargets = new Map<string, { agentId: string; officeId: string; requireInactive: boolean }>();
  private readonly pendingSeats = new Map<string, (result: { success: boolean; error?: string }) => void>();
  private permissionEpoch = 0;

  setAgentLifecycle(lifecycle: AgentLifecycle): void {
    this.agentLifecycle = lifecycle;
  }

  ensureSeat(officeId: string, agentId: string, deskId: string, deadline: number): Promise<void> {
    const requestId = randomUUID();
    return new Promise<{ success: boolean; error?: string }>((resolve) => {
      this.trackRoundTrip(this.pendingSeats, requestId, resolve, { success: false, error: 'Seat synchronization timed out.' },
        Math.max(1, Math.min(10_000, deadline - Date.now())));
      this.emitter.emitSeatRequest?.({ requestId, officeId, agentId, deskId, deadline });
    }).then((result) => {
      if (!result.success) throw new Error(result.error ?? 'Could not persist the agent seat.');
    });
  }

  respondSeat(requestId: string, result: { success: boolean; error?: string }): boolean {
    const resolve = this.pendingSeats.get(requestId);
    if (!resolve) return false;
    resolve(result);
    return true;
  }

  private trackRoundTrip<T>(map: Map<string, (value: T) => void>, id: string,
    resolve: (value: T) => void, failure: T, timeoutMs = 15_000): void {
    const timer = setTimeout(() => {
      console.warn(`[Ringleader] Renderer request ${id} timed out.`);
      map.get(id)?.(failure);
    }, timeoutMs);
    map.set(id, (value) => {
      clearTimeout(timer);
      map.delete(id);
      resolve(value);
    });
  }
  private client: any | null = null;
  private session: any | null = null;
  private unsubscribe: (() => void) | null = null;
  private lifecycle: OrchestratorLifecycle = 'idle';
  private openPromise: Promise<OrchestratorSessionInfo> | null = null;
  /** True while the orchestrator is online in a Teams thread (a remote approver exists). */
  private teamsRelayActive = false;
  private allowAllOperations = false;

  private readonly pendingPermissions = new Map<string, (result: PermissionRequestResult) => void>();
  private readonly pendingCandidates = new Map<string, (candidates: BringOnlineCandidate[]) => void>();
  private readonly pendingExecute = new Map<string, (result: BringOnlineResult) => void>();
  private readonly pendingOffices = new Map<string, (offices: OfficeSummary[]) => void>();
  private readonly pendingSwitch = new Map<string, (result: SwitchOfficeResult) => void>();

  // ── spec 017: new read-only + act-on round-trips ───────────────────────────
  private readonly pendingActiveAgents = new Map<string, (agents: ActiveAgentSnapshot[]) => void>();
  private readonly pendingAwaitingAgents = new Map<string, (agents: AwaitingAgent[]) => void>();
  private readonly pendingAgentOutput = new Map<string, (output: AgentRecentOutput) => void>();
  private readonly pendingAgentStatus = new Map<string, (lookup: AgentStatusLookup) => void>();
  private readonly pendingActOn = new Map<string, (result: ActOnResult) => void>();
  /** Dedicated pending map for set_teams_agents_connection (distinct ActOnResult shape — no agentId). */
  private readonly pendingTeamsAgentsPause = new Map<string, (result: TeamsAgentsPauseResult) => void>();

  /** agentId → resolved display name (office-custom aware), populated by read tools. */
  private readonly agentNameCache = new Map<string, string>();

  // ── spec 017: persistent transcript (US1) ──────────────────────────────────
  private transcript: OrchestratorTranscript | null = null;
  /** Origin applied to tap-captured turns until the next user turn changes it. */
  private currentOrigin: TranscriptOrigin = 'desktop';

  // ── Tap listeners (spec 016 Workstream B) — a secondary subscription surface so
  // the Teams OrchestratorSessionGateway can observe the SAME stream/permission/exit
  // signals the IPC emitter pushes to the renderer, without a second SDK session.
  private readonly eventListeners = new Set<(event: CopilotEvent) => void>();
  private readonly permissionListeners = new Set<
    (payload: { toolCallId: string; toolName: string; agentId?: string; agentName?: string; online?: boolean; title?: string; reason?: string; paused?: boolean }) => void
  >();
  private readonly exitListeners = new Set<(reason: string) => void>();

  // spec 017: notified whenever an APPROVED send_prompt_to_agent is dispatched, so the
  // Teams service can attribute the resulting ambient turn to the orchestrator (not a
  // local human) in the target agent's thread. Wired from the main process.
  private sendPromptObserver: ((agentId: string, officeId?: string) => void) | null = null;

  constructor(
    private readonly emitter: OrchestratorEmitter,
    private readonly workingDirectory: string,
    /** Optional persisted transcript store (spec 017 US1). Absent → no persistence. */
    private readonly transcriptStore: OrchestratorTranscriptStore | null = null,
    /** Retention bound = panel xterm scrollback window (spec 017 T002 = 5000). */
    private readonly transcriptBound: number = 5000,
  ) {}

  setAllowAllOperations(enabled: boolean): void {
    this.allowAllOperations = enabled;
  }

  /** Subscribe to the orchestrator's mapped CopilotEvent stream (main-process tap). */
  onSessionEvent(cb: (event: CopilotEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  /** Subscribe to gated tool-approval requests (the always-on permission gate). */
  onPermissionRequested(
    cb: (payload: { toolCallId: string; toolName: string; agentId?: string; agentName?: string; online?: boolean; title?: string; reason?: string; paused?: boolean }) => void,
  ): () => void {
    this.permissionListeners.add(cb);
    return () => this.permissionListeners.delete(cb);
  }

  /** Subscribe to session-exit signals (error/ended/failed-to-start). */
  onSessionExit(cb: (reason: string) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  /**
   * Register a single observer notified whenever an APPROVED `send_prompt_to_agent`
   * is dispatched to a target agent. Used by the Teams service to label the target
   * agent's next ambient turn as orchestrator-initiated instead of a local human
   * request (spec 017).
   */
  setSendPromptObserver(cb: ((agentId: string, officeId?: string) => void) | null): void {
    this.sendPromptObserver = cb;
  }

  getInfo(): OrchestratorSessionInfo | null {
    if (!this.session) return null;
    return { sessionId: String(this.session.sessionId), lifecycle: this.lifecycle };
  }

  // ── spec 017: transcript capture (US1) ─────────────────────────────────────

  /**
   * Read the persisted transcript for the panel to replay (pure read; MUST NOT
   * create/resume/mutate a session — ipc-v2 invariant 4). Returns null when the
   * last record was user-closed (FR-005) so the panel starts clean.
   */
  getTranscript(): OrchestratorTranscript | null {
    // Prefer the live in-memory record when a session is active.
    if (this.transcript && this.transcript.lifecycle === 'active') return this.transcript;
    const loaded = this.transcriptStore?.load() ?? null;
    if (loaded && loaded.lifecycle === 'closed') return null;
    return loaded;
  }

  /** Load/initialize the transcript bound to the current session on session start. */
  private initTranscript(sessionId: string): void {
    if (!this.transcriptStore) {
      this.transcript = { sessionId, lifecycle: 'active', turns: [], updatedAt: Date.now() };
      return;
    }
    const loaded = this.transcriptStore.load();
    // A closed record is treated as "no active conversation" → fresh (FR-005).
    if (loaded && loaded.lifecycle === 'active') {
      this.transcript = { ...loaded, sessionId };
    } else {
      this.transcript = { sessionId, lifecycle: 'active', turns: [], updatedAt: Date.now() };
    }
    this.persistTranscript();
  }

  /** Append a turn to the in-memory transcript and persist (best-effort). */
  private captureTurn(role: TranscriptRole, text: string, extra?: Partial<TranscriptTurn>): void {
    if (!this.transcript || this.transcript.lifecycle !== 'active') return;
    if (!text && role !== 'tool') return;
    const turn: Omit<TranscriptTurn, 'seq'> = {
      role,
      origin: extra?.origin ?? this.currentOrigin,
      text,
      at: extra?.at ?? Date.now(),
      ...(extra?.tool ? { tool: extra.tool } : {}),
    };
    this.transcript = appendTurn(this.transcript, turn, this.transcriptBound);
    this.persistTranscript();
  }

  private persistTranscript(): void {
    if (!this.transcriptStore || !this.transcript) return;
    // FR-025: a failed save is swallowed inside the store and must not block turns.
    this.transcriptStore.save(this.transcript);
  }

  /**
   * Start (or reattach to) the orchestrator session. Idempotent: repeated calls
   * return the same live session without creating a second one.
   */
  async open(): Promise<OrchestratorSessionInfo> {
    if (this.session) {
      return { sessionId: String(this.session.sessionId), lifecycle: this.lifecycle };
    }
    if (this.openPromise) return this.openPromise;

    this.lifecycle = 'starting';
    this.openPromise = this.startSession()
      .then((info) => {
        this.openPromise = null;
        return info;
      })
      .catch((err) => {
        this.openPromise = null;
        this.lifecycle = 'error';
        const reason = err instanceof Error ? err.message : String(err);
        this.emitter.emitExit({ sessionId: 'orchestrator', reason: `Failed to start: ${reason}` });
        throw err;
      });
    return this.openPromise;
  }

  private async startSession(): Promise<OrchestratorSessionInfo> {
    const sdk = (await import('@github/copilot-sdk')) as unknown as Partial<SdkModule>;
    if (!sdk.CopilotClient || !sdk.RuntimeConnection) {
      throw new Error('Installed Copilot SDK lacks CopilotClient/RuntimeConnection');
    }
    const cliPath = resolveCopilotCliPath(process.cwd(), process.env.PATH);
    if (!cliPath) {
      throw new Error('Could not resolve a Copilot CLI binary for the orchestrator session');
    }

    if (!this.client) {
      this.client = new sdk.CopilotClient({
        useLoggedInUser: true,
        connection: sdk.RuntimeConnection.forStdio({ path: cliPath }),
      });
      await this.client.start();
    }

    const tools = buildOrchestratorTools({
      approvedTarget: (toolCallId) => this.approvedTargets.get(toolCallId),
      requestCandidates: async (officeId?: string) => this.cacheAgentNames(await this.requestCandidates(officeId)),
      requestExecute: (agentId, officeId, toolCallId) => {
        if (toolCallId) this.approvedTargets.delete(toolCallId);
        return this.requestExecute(agentId, officeId);
      },
      requestOffices: () => this.requestOffices(),
      requestSwitch: (officeId) => this.requestSwitch(officeId),
      getOfficeId: () => this.lastOfficeId,
      requestActiveAgents: async (officeId) => this.cacheAgentNames(await this.requestActiveAgents(officeId)),
      requestAwaitingAgents: async (officeId) => this.cacheAgentNames(await this.requestAwaitingAgents(officeId)),
      requestAgentOutput: (agentId, officeId) => this.requestAgentOutput(agentId, officeId),
      requestAgentStatus: (agent, officeId) => this.requestAgentStatus(agent, officeId),
      requestAnswerAgent: (a) => this.requestActOn('answer_agent', a),
      requestSendPrompt: (a) => this.requestActOn('send_prompt_to_agent', a),
      requestStopAgent: (a) => this.requestActOn('stop_agent', a),
      requestRestartAgent: (a) => this.requestActOn('restart_agent', a),
      requestTeamsPresence: (a) => {
        if (a.toolCallId) this.approvedTargets.delete(a.toolCallId);
        return this.agentLifecycle ? this.agentLifecycle.run(a) : this.requestActOn('set_agent_teams_presence', a);
      },
      requestSetTitle: (a) => this.requestActOn('set_agent_title', a),
      requestTeamsAgentsPause: (paused) => this.requestTeamsAgentsPause(paused),
    });

    this.session = await this.client.createSession({
      workingDirectory: this.workingDirectory,
      streaming: true,
      tools,
      onPermissionRequest: this.permissionHandler,
      systemMessage: { mode: 'append', content: ORCHESTRATOR_SYSTEM_PROMPT },
    });

    const sessionId = String(this.session.sessionId);
    this.initTranscript(sessionId);
    this.attachStream(sessionId);
    this.lifecycle = 'ready';
    return { sessionId, lifecycle: this.lifecycle };
  }

  private attachStream(sessionId: string): void {
    this.detachStream();
    this.unsubscribe = this.session.on((evt: unknown) => {
      const event = mapSdkEventToCopilotEvent(evt);
      this.emitter.emitEvent(sessionId, event);
      for (const cb of this.eventListeners) cb(event);
      this.captureStreamEvent(event);
      if (event.type === 'session.error' || event.type === 'session.ended') {
        this.emitter.emitExit({ sessionId, reason: event.type });
        for (const cb of this.exitListeners) cb(event.type);
      }
    });
  }

  /** Fold a mapped session-tap event into the transcript (orchestrator/tool turns). */
  private captureStreamEvent(event: CopilotEvent): void {
    const data = (event.data ?? {}) as Record<string, unknown>;
    switch (event.type) {
      case 'assistant.message': {
        if (typeof data.content === 'string' && data.content.trim()) {
          this.captureTurn('orchestrator', data.content);
        }
        break;
      }
      case 'tool.execution_start': {
        if (typeof data.toolName === 'string' && data.toolName) {
          this.captureTurn('tool', `[tool] ${data.toolName}`, {
            tool: { name: data.toolName, outcome: 'started' },
          });
        }
        break;
      }
      default:
        break;
    }
  }

  private detachStream(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /**
   * Submit user chat text as a prompt (default mode — no enqueue/interrupt override).
   * `origin` tags the transcript turn: 'desktop' for the panel, 'teams' when driven
   * from a Teams thread via the OrchestratorSessionGateway (FR-002). The origin also
   * carries to the tap-captured response turns until the next submit.
   */
  async submitInput(text: string, origin: TranscriptOrigin = 'desktop'): Promise<void> {
    if (!this.session) throw new Error('Orchestrator session is not open');
    this.currentOrigin = origin;
    this.captureTurn('user', text, { origin });
    await this.session.send(text);
  }

  /**
   * Detach the panel view (minimize / dismiss overlay). MUST NOT kill the SDK
   * session, any office session, or mutate activeAgentViewers, and MUST NOT
   * detach the event stream: keeping the stream alive lets a Teams-online
   * orchestrator keep answering in-thread while its desktop overlay is minimized,
   * and lets a reopened panel resume streaming without reattaching. Pending
   * permission gates are denied UNLESS the orchestrator is actually online in a
   * Teams thread (`teamsRelayActive`), in which case the gate is left open so the
   * in-thread approver can still respond within its own timeout. (The raw
   * `permissionListeners` set is always non-empty while the Teams feature is
   * running, so it is NOT a reliable "reachable approver" signal.)
   */
  close(): void {
    if (!this.teamsRelayActive) {
      this.rejectAllPending();
    }
  }

  /**
   * Set whether the orchestrator is currently online in a Teams thread (i.e. a
   * remote approver can answer relayed permission gates). Wired from the main
   * process register/goOffline flow. Governs whether `close()` (minimize) denies
   * outstanding gates.
   */
  setTeamsRelayActive(active: boolean): void {
    this.teamsRelayActive = active;
  }

  /**
   * Fully end the orchestrator session (the panel's red ✕). Denies any pending
   * gates, resolves any in-flight renderer round-trips, tears down the stream,
   * disconnects the SDK session, and fires exit listeners with `closed-by-user`
   * so a Teams-online orchestrator goes offline — the exit chain posts the closing
   * notice to the thread and removes the binding. After this the next `open()`
   * starts a fresh session.
   */
  async endSession(): Promise<void> {
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    // Mark the persisted record closed so the next open starts a fresh conversation
    // (FR-005). A closed record is never resurrected as active.
    if (this.transcript) {
      this.transcript = { ...this.transcript, lifecycle: 'closed', updatedAt: Date.now() };
      this.persistTranscript();
    }
    this.transcriptStore?.clearActive();
    this.transcript = null;
    this.currentOrigin = 'desktop';
    this.rejectAllPending();
    this.clearPendingRoundTrips();
    this.detachStream();
    this.teamsRelayActive = false;
    const session = this.session;
    this.session = null;
    this.openPromise = null;
    this.lifecycle = 'idle';
    if (session) {
      try {
        await session.disconnect?.();
      } catch {
        /* best-effort teardown — disconnect failures must not block exit signalling */
      }
    }
    this.emitter.emitExit({ sessionId, reason: 'closed-by-user' });
    for (const cb of this.exitListeners) cb('closed-by-user');
  }

  private rejectAllPending(): void {
    this.permissionEpoch++;
    for (const [, resolve] of this.pendingPermissions) {
      resolve({ kind: 'reject' });
    }
    this.pendingPermissions.clear();
  }

  /**
   * Resolve and drop any in-flight renderer round-trips (candidates/execute/offices/
   * switch) so an awaiting tool call unblocks and no resolver is retained after the
   * session ends. Only called on full teardown — NOT on minimize, where the session
   * (and any in-flight tool round-trip) continues.
   */
  private clearPendingRoundTrips(): void {
    this.approvedTargets.clear();
    for (const resolve of this.pendingSeats.values()) resolve({ success: false, error: 'Orchestrator session ended.' });
    this.pendingSeats.clear();
    const ended = 'Orchestrator session ended';
    for (const [, resolve] of this.pendingCandidates) resolve([]);
    this.pendingCandidates.clear();
    for (const [, resolve] of this.pendingExecute) {
      resolve({ agentId: '', outcome: 'failed', message: ended });
    }
    this.pendingExecute.clear();
    for (const [, resolve] of this.pendingOffices) resolve([]);
    this.pendingOffices.clear();
    for (const [, resolve] of this.pendingSwitch) {
      resolve({ officeId: '', outcome: 'failed', message: ended });
    }
    this.pendingSwitch.clear();
    // spec 017: read-only round-trips → empty; act-on round-trips → typed failed.
    for (const [, resolve] of this.pendingActiveAgents) resolve([]);
    this.pendingActiveAgents.clear();
    for (const [, resolve] of this.pendingAwaitingAgents) resolve([]);
    this.pendingAwaitingAgents.clear();
    for (const [, resolve] of this.pendingAgentOutput) {
      resolve({ agentId: '', officeId: '', hasOutput: false, lines: [] });
    }
    this.pendingAgentOutput.clear();
    for (const [, resolve] of this.pendingAgentStatus) {
      resolve({ query: '', outcome: 'not-found', message: ended });
    }
    this.pendingAgentStatus.clear();
    for (const [, resolve] of this.pendingActOn) {
      resolve({ agentId: '', officeId: '', outcome: 'failed', message: ended });
    }
    this.pendingActOn.clear();
    for (const [, resolve] of this.pendingTeamsAgentsPause) {
      resolve({ outcome: 'failed', count: 0, message: ended });
    }
    this.pendingTeamsAgentsPause.clear();
  }

  // ── Permission gate (independent of agent YOLO) ─────────────────────────
  private async prepareLifecyclePermission(
    request: Parameters<PermissionHandler>[0], invocation: Parameters<PermissionHandler>[1],
  ): Promise<Awaited<ReturnType<PermissionHandler>>> {
    const epoch = this.permissionEpoch;
    if (this.agentLifecycle && request.kind === 'custom-tool'
      && (request.toolName === 'bring_agent_online' || request.toolName === 'set_agent_teams_presence')) {
      const args = (request.args ?? {}) as { agentId?: string; officeId?: string; online?: boolean; requireInactive?: boolean };
      try {
        if (request.toolName === 'set_agent_teams_presence' && args.online === false && !args.agentId?.trim()) {
          return { kind: 'reject', feedback: 'Taking an agent offline requires a specific target.' };
        }
        const requireInactive = request.toolName === 'bring_agent_online'
          || (args.online !== false && (args.requireInactive === true || !args.agentId?.trim()));
        const target = await this.agentLifecycle.resolve(args.agentId ?? '', args.officeId, requireInactive);
        if (epoch !== this.permissionEpoch) return { kind: 'reject', feedback: 'The request was cancelled during target resolution.' };
        if (!request.toolCallId) return { kind: 'reject', feedback: 'Missing tool call identity. No action was executed.' };
        this.approvedTargets.set(request.toolCallId, { agentId: target.agentId, officeId: target.officeId, requireInactive });
        this.agentNameCache.set(target.agentId, `${target.name} (${target.office.name})`);
        request = { ...request, args: { ...args, agentId: target.agentId, officeId: target.officeId, requireInactive } };
      } catch (error) {
        return { kind: 'reject', feedback: error instanceof Error ? error.message : String(error) };
      }
    }
    return this.permissionGate(request, invocation);
  }

  private readonly permissionHandler: PermissionHandler = (request, invocation) => {
      if (this.agentLifecycle && request.kind === 'custom-tool'
        && (request.toolName === 'bring_agent_online' || request.toolName === 'set_agent_teams_presence')) {
        return this.prepareLifecyclePermission(request, invocation);
      }
      return this.permissionGate(request, invocation);
  };

  private readonly permissionGate: PermissionHandler = (request, _invocation) => {
    if (request.kind === 'custom-tool' && GATED_TOOLS.has(request.toolName)) {
      if (this.allowAllOperations) {
        this.captureTurn('tool', `[gate] ${request.toolName} approved by Ringleader settings`, {
          tool: { name: request.toolName, outcome: 'approved' },
        });
        return { kind: 'approved' };
      }
      const toolName = request.toolName;
      const toolCallId = request.toolCallId ?? randomUUID();
      const args = (request.args ?? {}) as {
        agentId?: string;
        officeId?: string;
        answer?: string;
        prompt?: string;
        online?: boolean;
        title?: string;
        reason?: string;
        paused?: boolean;
      };
      const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
      const agentName = args.agentId ? this.agentNameCache.get(args.agentId) : undefined;
      return new Promise<PermissionRequestResult>((resolve) => {
        // Wrap so we can record the approve/deny decision to the transcript (FR-023).
        this.trackRoundTrip(this.pendingPermissions, toolCallId, (result) => {
          const approved = result.kind === 'approved';
          if (!approved) this.approvedTargets.delete(toolCallId);
          this.captureTurn('tool', `[gate] ${toolName} ${approved ? 'approved' : 'denied'}`, {
            tool: {
              name: toolName,
              outcome: approved ? 'approved' : 'denied',
              target: args.agentId,
            },
          });
          resolve(result);
        }, { kind: 'reject', feedback: 'Approval expired. No action was executed.' }, 90_000);
        this.emitter.emitPermissionRequest({
          sessionId,
          toolCallId,
          toolName,
          args: {
            agentId: args.agentId,
            agentName,
            officeId: args.officeId,
            answer: args.answer,
            prompt: args.prompt,
            online: args.online,
            title: args.title,
            reason: args.reason,
            paused: args.paused,
          },
        });
        for (const cb of this.permissionListeners) {
          cb({ toolCallId, toolName, agentId: args.agentId, agentName, online: args.online, title: args.title, reason: args.reason, paused: args.paused });
        }
      });
    }
    // Any other kind (should not occur for this toolset) denies by default.
    return { kind: 'reject' };
  };

  /** Record agentId → display name from read-tool results so the gate can label the action. */
  private cacheAgentNames<T extends { agentId: string; name: string }>(items: T[]): T[] {
    for (const item of items) {
      if (item.agentId && item.name) this.agentNameCache.set(item.agentId, item.name);
    }
    return items;
  }

  respondToPermission(decision: PermissionDecision): boolean {
    const resolve = this.pendingPermissions.get(decision.toolCallId);
    if (!resolve) return false;
    this.pendingPermissions.delete(decision.toolCallId);
    resolve(
      decision.decision === 'approve'
        ? { kind: 'approved' }
        : {
            kind: 'reject',
            feedback: 'Approval was denied or expired. The action was not executed. Do not retry unless the user asks.',
          },
    );
    return true;
  }

  // ── Renderer round-trips (candidate compute + execution live in the renderer) ─
  private lastOfficeId = '';

  private requestCandidates(officeId?: string): Promise<BringOnlineCandidate[]> {
    if (this.agentLifecycle) return this.agentLifecycle.candidates(officeId);
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<BringOnlineCandidate[]>((resolve) => {
      this.trackRoundTrip(this.pendingCandidates, requestId, resolve, []);
      this.emitter.emitCandidatesRequest({ sessionId, requestId, officeId });
    });
  }

  respondCandidates(requestId: string, candidates: BringOnlineCandidate[]): boolean {
    const resolve = this.pendingCandidates.get(requestId);
    if (!resolve) return false;
    this.pendingCandidates.delete(requestId);
    if (candidates[0]?.officeId) this.lastOfficeId = candidates[0].officeId;
    resolve(candidates);
    return true;
  }

  private requestExecute(agentId: string, officeId?: string): Promise<BringOnlineResult> {
    if (this.agentLifecycle) return this.agentLifecycle.bringOnline(agentId, officeId);
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<BringOnlineResult>((resolve) => {
      this.trackRoundTrip(this.pendingExecute, requestId, resolve, { agentId, outcome: 'failed', message: 'Renderer activation timed out.' });
      this.emitter.emitExecuteRequest({ sessionId, requestId, agentId, officeId });
    });
  }

  respondExecute(requestId: string, result: BringOnlineResult): boolean {
    const resolve = this.pendingExecute.get(requestId);
    if (!resolve) return false;
    this.pendingExecute.delete(requestId);
    resolve(result);
    return true;
  }

  private requestOffices(): Promise<OfficeSummary[]> {
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<OfficeSummary[]>((resolve) => {
      this.trackRoundTrip(this.pendingOffices, requestId, resolve, []);
      this.emitter.emitOfficesRequest({ sessionId, requestId });
    });
  }

  respondOffices(requestId: string, offices: OfficeSummary[]): boolean {
    const resolve = this.pendingOffices.get(requestId);
    if (!resolve) return false;
    this.pendingOffices.delete(requestId);
    resolve(offices);
    return true;
  }

  private requestSwitch(officeId: string): Promise<SwitchOfficeResult> {
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<SwitchOfficeResult>((resolve) => {
      this.trackRoundTrip(this.pendingSwitch, requestId, resolve, { officeId, outcome: 'failed', message: 'Office switching timed out.' });
      this.emitter.emitSwitchRequest({ sessionId, requestId, officeId });
    });
  }

  respondSwitch(requestId: string, result: SwitchOfficeResult): boolean {
    const resolve = this.pendingSwitch.get(requestId);
    if (!resolve) return false;
    this.pendingSwitch.delete(requestId);
    resolve(result);
    return true;
  }

  // ── spec 017: read-only situational-awareness round-trips ──────────────────

  private requestActiveAgents(officeId?: string): Promise<ActiveAgentSnapshot[]> {
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<ActiveAgentSnapshot[]>((resolve) => {
      this.trackRoundTrip(this.pendingActiveAgents, requestId, resolve, []);
      this.emitter.emitActiveAgentsRequest?.({ sessionId, requestId, officeId });
    });
  }

  respondActiveAgents(requestId: string, agents: ActiveAgentSnapshot[]): boolean {
    const resolve = this.pendingActiveAgents.get(requestId);
    if (!resolve) return false;
    this.pendingActiveAgents.delete(requestId);
    resolve(agents);
    return true;
  }

  private requestAwaitingAgents(officeId?: string): Promise<AwaitingAgent[]> {
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<AwaitingAgent[]>((resolve) => {
      this.trackRoundTrip(this.pendingAwaitingAgents, requestId, resolve, []);
      this.emitter.emitAwaitingAgentsRequest?.({ sessionId, requestId, officeId });
    });
  }

  respondAwaitingAgents(requestId: string, agents: AwaitingAgent[]): boolean {
    const resolve = this.pendingAwaitingAgents.get(requestId);
    if (!resolve) return false;
    this.pendingAwaitingAgents.delete(requestId);
    resolve(agents);
    return true;
  }

  private requestAgentOutput(agentId: string, officeId?: string): Promise<AgentRecentOutput> {
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<AgentRecentOutput>((resolve) => {
      this.trackRoundTrip(this.pendingAgentOutput, requestId, resolve, { agentId, officeId: officeId ?? '', hasOutput: false, lines: [] });
      this.emitter.emitAgentOutputRequest?.({ sessionId, requestId, agentId, officeId });
    });
  }

  respondAgentOutput(requestId: string, output: AgentRecentOutput): boolean {
    const resolve = this.pendingAgentOutput.get(requestId);
    if (!resolve) return false;
    this.pendingAgentOutput.delete(requestId);
    resolve(output);
    return true;
  }

  private async requestAgentStatus(agent: string, officeId?: string): Promise<AgentStatusLookup> {
    if (!this.agentLifecycle) return this.requestRendererAgentStatus(agent, officeId);
    try {
      const target = await this.agentLifecycle.resolve(agent, officeId);
      const detail = await this.requestRendererAgentStatus(target.agentId, target.officeId);
      return this.agentLifecycle.status(target, { ...detail, query: agent });
    } catch (error) {
      if (!(error instanceof AgentTargetError)) throw error;
      return {
        query: agent, outcome: error.outcome === 'ambiguous-target' ? 'ambiguous' : 'not-found', message: error.message,
        matches: error.matches.map((a) => ({ agentId: a.agentId, officeId: a.officeId, name: a.name, officeName: a.office.name })),
      };
    }
  }

  private requestRendererAgentStatus(agent: string, officeId?: string): Promise<AgentStatusLookup> {
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<AgentStatusLookup>((resolve) => {
      this.trackRoundTrip(this.pendingAgentStatus, requestId, resolve, { query: agent, outcome: 'not-found', message: 'Status request timed out.' });
      this.emitter.emitAgentStatusRequest?.({ sessionId, requestId, agent, officeId });
    });
  }

  respondAgentStatus(requestId: string, lookup: AgentStatusLookup): boolean {
    const resolve = this.pendingAgentStatus.get(requestId);
    if (!resolve) return false;
    this.pendingAgentStatus.delete(requestId);
    resolve(lookup);
    return true;
  }

  // ── spec 017: gated act-on round-trips ─────────────────────────────────────
  // A single map keyed by requestId serves all act-on tools; the tool name is
  // captured in the closure so the outcome can be recorded to the transcript.

  private requestActOn(
    toolName: string,
    args: { agentId: string; officeId?: string; answer?: string; prompt?: string; online?: boolean; title?: string },
  ): Promise<ActOnResult> {
    // Reached only AFTER the permission gate approves (the SDK will not invoke the
    // tool handler on denial). Emit the matching request channel.
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<ActOnResult>((resolve) => {
      this.trackRoundTrip(this.pendingActOn, requestId, (result) => {
        // Feed the act-on outcome (incl. failure) to the transcript (FR-023).
        this.captureTurn('tool', `[${toolName}] ${result.outcome}: ${result.message}`, {
          tool: { name: toolName, outcome: result.outcome, target: result.agentId || args.agentId },
        });
        resolve(result);
      }, { agentId: args.agentId, officeId: args.officeId ?? '', outcome: 'failed', message: 'Agent operation timed out.' }, 45_000);
      switch (toolName) {
        case 'answer_agent':
          this.emitter.emitAnswerAgentRequest?.({
            sessionId,
            requestId,
            agentId: args.agentId,
            officeId: args.officeId,
            answer: args.answer ?? '',
          });
          break;
        case 'send_prompt_to_agent':
          this.sendPromptObserver?.(args.agentId, args.officeId);
          this.emitter.emitSendPromptRequest?.({
            sessionId,
            requestId,
            agentId: args.agentId,
            officeId: args.officeId,
            prompt: args.prompt ?? '',
          });
          break;
        case 'stop_agent':
          this.emitter.emitStopAgentRequest?.({
            sessionId,
            requestId,
            agentId: args.agentId,
            officeId: args.officeId,
          });
          break;
        case 'restart_agent':
          this.emitter.emitRestartAgentRequest?.({
            sessionId,
            requestId,
            agentId: args.agentId,
            officeId: args.officeId,
          });
          break;
        case 'set_agent_teams_presence':
          this.emitter.emitTeamsPresenceRequest?.({
            sessionId,
            requestId,
            agentId: args.agentId,
            officeId: args.officeId,
            online: args.online ?? false,
          });
          break;
        case 'set_agent_title':
          this.emitter.emitSetTitleRequest?.({
            sessionId,
            requestId,
            agentId: args.agentId,
            officeId: args.officeId,
            title: args.title ?? '',
          });
          break;
        default:
          // Unknown act-on tool — resolve failed so the call never hangs.
          this.pendingActOn.delete(requestId);
          resolve({
            agentId: args.agentId,
            officeId: args.officeId ?? '',
            outcome: 'failed',
            message: `Unknown act-on tool "${toolName}".`,
          });
          break;
      }
    });
  }

  respondActOn(requestId: string, result: ActOnResult): boolean {
    const resolve = this.pendingActOn.get(requestId);
    if (!resolve) return false;
    this.pendingActOn.delete(requestId);
    resolve(result);
    return true;
  }

  // ── Pause/resume non-orchestrator agent Teams connections (gated) ─────────
  requestTeamsAgentsPause(paused: boolean): Promise<TeamsAgentsPauseResult> {
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<TeamsAgentsPauseResult>((resolve) => {
      this.trackRoundTrip(this.pendingTeamsAgentsPause, requestId, (result) => {
        this.captureTurn('tool', `[set_teams_agents_connection] ${result.outcome}: ${result.message}`, {
          tool: { name: 'set_teams_agents_connection', outcome: result.outcome },
        });
        resolve(result);
      }, { outcome: 'failed', count: 0, message: 'Teams pause/resume timed out.' }, 45_000);
      this.emitter.emitTeamsAgentsPauseRequest?.({ sessionId, requestId, paused });
    });
  }

  respondTeamsAgentsPause(requestId: string, result: TeamsAgentsPauseResult): boolean {
    const resolve = this.pendingTeamsAgentsPause.get(requestId);
    if (!resolve) return false;
    this.pendingTeamsAgentsPause.delete(requestId);
    resolve(result);
    return true;
  }
}
