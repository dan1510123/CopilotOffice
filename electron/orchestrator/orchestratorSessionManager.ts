// Orchestrator SDK session manager (spec 016 — T005/T006/T007/T022).
//
// Owns the single dedicated "orchestrator agent" SDK session. Unlike the office
// backends (electron/terminal/*), this session:
//   - runs in the Electron MAIN process (not the terminal child server),
//   - is a separate `RuntimeConnection.forStdio` SDK session keyed by nothing in
//     `activeAgentViewers` (it is NOT an office agent),
//   - is ALWAYS permission-gated: its `onPermissionRequest` NEVER consults
//     `isYoloEnabled()`, so `bring_agent_online` is structurally gated regardless
//     of the global YOLO toggle (contracts/orchestrator-tools.md).
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
  BringOnlineCandidate,
  BringOnlineResult,
  OfficeSummary,
  OrchestratorLifecycle,
  OrchestratorSessionInfo,
  PermissionDecision,
  SwitchOfficeResult,
} from './types';
import type { CopilotEvent } from '../terminal/events-watcher';

const ORCHESTRATOR_SYSTEM_PROMPT = [
  'You are the Office Orchestrator — a concierge that helps the user bring the right',
  'Copilot agent "online" in the currently viewed virtual office.',
  '',
  'Workflow for every request:',
  '1. Call the `list_office_agents` tool to see who can be brought online right now',
  '   (each candidate has an `agentId`, `name`, `skill`, and `description`).',
  '2. Rank the candidates against the user\'s natural-language need using `skill` and',
  '   `description`. The user will usually describe WHAT they need (e.g. "someone to',
  '   review my code", "help me deploy"), not an agent by name.',
  '3. When you find a good fit, call `bring_agent_online` with the concrete `agentId`',
  '   and a short `reason` explaining why it fits. This action is always gated: the',
  '   user must approve it before it takes effect, so state your pick clearly.',
  '4. If there is no good fit, or the candidate list is empty, DO NOT guess — tell the',
  '   user plainly that nothing matches and suggest they pick manually.',
  '',
  'Working across offices:',
  '- The candidate list from `list_office_agents` is scoped to the office currently shown',
  '  on the desktop. If nothing fits there, call `list_offices` to see all offices (each',
  '  has an `officeId`, `name`, `layout`, `isCurrent`, and `activeAgentCount`).',
  '- If a better office exists, call `switch_office` with its `officeId`, then call',
  '  `list_office_agents` again to re-evaluate candidates in that office. Switching is a',
  '  reversible navigation action and is not gated; it also changes what the desktop user',
  '  sees, so mention when you switch.',
  '',
  'Keep replies concise and conversational. Never invent an agentId that was not',
  'returned by `list_office_agents`, and never invent an officeId that was not returned',
  'by `list_offices`.',
].join('\n');

/** Emitters the manager uses to push to the renderer (wired by orchestratorIpc). */
export interface OrchestratorEmitter {
  emitEvent(sessionId: string, event: CopilotEvent): void;
  emitPermissionRequest(payload: {
    sessionId: string;
    toolCallId: string;
    toolName: string;
    args: { agentId?: string; reason?: string };
  }): void;
  emitCandidatesRequest(payload: { sessionId: string; requestId: string }): void;
  emitExecuteRequest(payload: { sessionId: string; requestId: string; agentId: string }): void;
  emitOfficesRequest(payload: { sessionId: string; requestId: string }): void;
  emitSwitchRequest(payload: { sessionId: string; requestId: string; officeId: string }): void;
  emitExit(payload: { sessionId: string; reason: string }): void;
}

interface SdkModule {
  CopilotClient: new (options?: Record<string, unknown>) => any;
  RuntimeConnection: { forStdio: (opts?: { path?: string; args?: readonly string[] }) => unknown };
}

export class OrchestratorSessionManager {
  private client: any | null = null;
  private session: any | null = null;
  private unsubscribe: (() => void) | null = null;
  private lifecycle: OrchestratorLifecycle = 'idle';
  private openPromise: Promise<OrchestratorSessionInfo> | null = null;

  private readonly pendingPermissions = new Map<string, (result: PermissionRequestResult) => void>();
  private readonly pendingCandidates = new Map<string, (candidates: BringOnlineCandidate[]) => void>();
  private readonly pendingExecute = new Map<string, (result: BringOnlineResult) => void>();
  private readonly pendingOffices = new Map<string, (offices: OfficeSummary[]) => void>();
  private readonly pendingSwitch = new Map<string, (result: SwitchOfficeResult) => void>();

  // ── Tap listeners (spec 016 Workstream B) — a secondary subscription surface so
  // the Teams OrchestratorSessionGateway can observe the SAME stream/permission/exit
  // signals the IPC emitter pushes to the renderer, without a second SDK session.
  private readonly eventListeners = new Set<(event: CopilotEvent) => void>();
  private readonly permissionListeners = new Set<
    (payload: { toolCallId: string; toolName: string; agentId?: string; reason?: string }) => void
  >();
  private readonly exitListeners = new Set<(reason: string) => void>();

  constructor(
    private readonly emitter: OrchestratorEmitter,
    private readonly workingDirectory: string,
  ) {}

  /** Subscribe to the orchestrator's mapped CopilotEvent stream (main-process tap). */
  onSessionEvent(cb: (event: CopilotEvent) => void): () => void {
    this.eventListeners.add(cb);
    return () => this.eventListeners.delete(cb);
  }

  /** Subscribe to gated tool-approval requests (the always-on permission gate). */
  onPermissionRequested(
    cb: (payload: { toolCallId: string; toolName: string; agentId?: string; reason?: string }) => void,
  ): () => void {
    this.permissionListeners.add(cb);
    return () => this.permissionListeners.delete(cb);
  }

  /** Subscribe to session-exit signals (error/ended/failed-to-start). */
  onSessionExit(cb: (reason: string) => void): () => void {
    this.exitListeners.add(cb);
    return () => this.exitListeners.delete(cb);
  }

  getInfo(): OrchestratorSessionInfo | null {
    if (!this.session) return null;
    return { sessionId: String(this.session.sessionId), lifecycle: this.lifecycle };
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
      requestCandidates: () => this.requestCandidates(),
      requestExecute: (agentId) => this.requestExecute(agentId),
      requestOffices: () => this.requestOffices(),
      requestSwitch: (officeId) => this.requestSwitch(officeId),
      getOfficeId: () => this.lastOfficeId,
    });

    this.session = await this.client.createSession({
      workingDirectory: this.workingDirectory,
      streaming: true,
      tools,
      onPermissionRequest: this.permissionHandler,
      systemMessage: { mode: 'append', content: ORCHESTRATOR_SYSTEM_PROMPT },
    });

    const sessionId = String(this.session.sessionId);
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
      if (event.type === 'session.error' || event.type === 'session.ended') {
        this.emitter.emitExit({ sessionId, reason: event.type });
        for (const cb of this.exitListeners) cb(event.type);
      }
    });
  }

  private detachStream(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  /** Submit user chat text as a prompt (default mode — no enqueue/interrupt override). */
  async submitInput(text: string): Promise<void> {
    if (!this.session) throw new Error('Orchestrator session is not open');
    await this.session.send(text);
  }

  /**
   * Detach the panel/stream. MUST NOT kill the SDK session, any office session,
   * or mutate activeAgentViewers. Resolves any still-pending permission requests
   * as deny (dismiss-while-pending).
   */
  close(): void {
    this.detachStream();
    this.rejectAllPending();
  }

  private rejectAllPending(): void {
    for (const [, resolve] of this.pendingPermissions) {
      resolve({ kind: 'denied-interactively-by-user' });
    }
    this.pendingPermissions.clear();
  }

  // ── Permission gate (non-YOLO, always gated) ─────────────────────────────
  private readonly permissionHandler: PermissionHandler = (request, _invocation) => {
    // NOTE: deliberately never consults isYoloEnabled(). The orchestrator session
    // is always gated, independent of the global YOLO toggle (spec 016 FR-002).
    if (request.kind === 'custom-tool' && request.toolName === 'bring_agent_online') {
      const toolCallId = request.toolCallId ?? randomUUID();
      const args = (request.args ?? {}) as { agentId?: string; reason?: string };
      const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
      return new Promise<PermissionRequestResult>((resolve) => {
        this.pendingPermissions.set(toolCallId, resolve);
        this.emitter.emitPermissionRequest({
          sessionId,
          toolCallId,
          toolName: request.toolName,
          args: { agentId: args.agentId, reason: args.reason },
        });
        for (const cb of this.permissionListeners) {
          cb({ toolCallId, toolName: request.toolName, agentId: args.agentId, reason: args.reason });
        }
      });
    }
    // Any other kind (should not occur for this toolset) denies by default.
    return { kind: 'denied-interactively-by-user' };
  };

  respondToPermission(decision: PermissionDecision): boolean {
    const resolve = this.pendingPermissions.get(decision.toolCallId);
    if (!resolve) return false;
    this.pendingPermissions.delete(decision.toolCallId);
    resolve(
      decision.decision === 'approve'
        ? { kind: 'approved' }
        : { kind: 'denied-interactively-by-user' },
    );
    return true;
  }

  // ── Renderer round-trips (candidate compute + execution live in the renderer) ─
  private lastOfficeId = '';

  private requestCandidates(): Promise<BringOnlineCandidate[]> {
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<BringOnlineCandidate[]>((resolve) => {
      this.pendingCandidates.set(requestId, resolve);
      this.emitter.emitCandidatesRequest({ sessionId, requestId });
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

  private requestExecute(agentId: string): Promise<BringOnlineResult> {
    const sessionId = this.session ? String(this.session.sessionId) : 'orchestrator';
    const requestId = randomUUID();
    return new Promise<BringOnlineResult>((resolve) => {
      this.pendingExecute.set(requestId, resolve);
      this.emitter.emitExecuteRequest({ sessionId, requestId, agentId });
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
      this.pendingOffices.set(requestId, resolve);
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
      this.pendingSwitch.set(requestId, resolve);
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
}
