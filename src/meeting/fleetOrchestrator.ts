/**
 * FleetOrchestrator — **Spawn phase** of the fleet pipeline.
 *
 * Each assigned task runs in a server-owned transient session lease. The lease
 * keeps the native Copilot TUI/node-pty visible while active, but snapshots and
 * restores the agent's prior persistent session when the task reaches any
 * terminal state. `fleet:all:complete` is emitted only after every lease has
 * finished its idempotent server-side disposal.
 */

import { MeetingPlan, TaskAssignment } from './types';

export interface FleetAgentState {
  agentId: string;
  taskTitle: string;
  state: 'pending' | 'starting' | 'working' | 'done' | 'failed';
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
  transientSessionId: string | null;
  cleanupSettled: boolean;
}

export type FleetEventCallback = (agentId: string, state: FleetAgentState) => void;
export type FleetCompleteCallback = (states: FleetAgentState[]) => void;

const STAGGER_DELAY_MS = 1500;
const RETRY_DELAY_MS = 2000;
const CLEANUP_RETRY_DELAY_MS = 250;

interface FleetEventListeners {
  'fleet:agent:started': FleetEventCallback[];
  'fleet:agent:working': FleetEventCallback[];
  'fleet:agent:done': FleetEventCallback[];
  'fleet:agent:failed': FleetEventCallback[];
  'fleet:all:complete': FleetCompleteCallback[];
}

export function getDuplicateFleetAgentIds(plan: MeetingPlan): string[] {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  for (const task of plan.tasks) {
    if (seen.has(task.agentId)) duplicates.add(task.agentId);
    else seen.add(task.agentId);
  }
  return [...duplicates];
}

export class FleetOrchestrator {
  private agents = new Map<string, FleetAgentState>();
  private lifecycleIds = new Map<string, string>();
  private spawnPromises = new Map<string, Promise<void>>();
  private cleanupPromises = new Map<string, Promise<void>>();
  private listeners: FleetEventListeners = {
    'fleet:agent:started': [],
    'fleet:agent:working': [],
    'fleet:agent:done': [],
    'fleet:agent:failed': [],
    'fleet:all:complete': [],
  };
  private cancelled = false;
  private allCompleteEmitted = false;
  private officeId = '';
  private runVersion = 0;
  private listenerEpoch = 0;
  private cancellationPromise: Promise<void> | null = null;

  private get bridge(): Window['copilotBridge'] {
    return window.copilotBridge;
  }

  on(event: 'fleet:agent:started' | 'fleet:agent:working' | 'fleet:agent:done' | 'fleet:agent:failed', cb: FleetEventCallback): void;
  on(event: 'fleet:all:complete', cb: FleetCompleteCallback): void;
  on(event: string, cb: FleetEventCallback | FleetCompleteCallback): void {
    const list = this.listeners[event as keyof FleetEventListeners] as Array<typeof cb> | undefined;
    list?.push(cb);
  }

  off(event: string, cb: FleetEventCallback | FleetCompleteCallback): void {
    const list = this.listeners[event as keyof FleetEventListeners] as Array<typeof cb> | undefined;
    const idx = list?.indexOf(cb) ?? -1;
    if (idx >= 0) list!.splice(idx, 1);
  }

  async executePlan(plan: MeetingPlan, workingDir: string, officeId: string): Promise<void> {
    const duplicateAgentIds = getDuplicateFleetAgentIds(plan);
    if (duplicateAgentIds.length > 0) {
      throw new Error(
        `Fleet plan assigns multiple tasks to the same agent: ${duplicateAgentIds.join(', ')}`,
      );
    }
    if (this.agents.size > 0) await this.cancel('Superseded by a new fleet run');
    this.resetState();

    const version = ++this.runVersion;
    this.officeId = officeId;
    for (const task of plan.tasks) {
      this.agents.set(task.agentId, {
        agentId: task.agentId,
        taskTitle: task.title,
        state: 'pending',
        error: null,
        startedAt: null,
        completedAt: null,
        transientSessionId: null,
        cleanupSettled: false,
      });
    }

    this.attachListeners(version);

    for (let i = 0; i < plan.tasks.length; i++) {
      if (!this.isActiveRun(version)) break;
      if (i > 0) await delay(STAGGER_DELAY_MS);
      if (!this.isActiveRun(version)) break;
      this.launchSpawn(plan.tasks[i], workingDir, version);
    }
  }

  async cancel(reason = 'Cancelled'): Promise<void> {
    if (this.cancellationPromise) return this.cancellationPromise;
    this.cancelled = true;
    this.detachListeners();

    this.cancellationPromise = (async () => {
      const cleanup: Promise<void>[] = [];
      for (const [agentId, state] of this.agents) {
        if (state.state === 'pending') {
          this.finishWithoutLease(agentId, 'failed', reason);
        } else if (
          state.state === 'working'
          || (state.state === 'starting' && state.transientSessionId !== null)
        ) {
          cleanup.push(this.settleAgent(agentId, 'failed', reason, this.runVersion));
        }
      }

      await Promise.allSettled([...this.spawnPromises.values(), ...cleanup]);

      // A begin request can complete after cancellation. spawnAgent observes the
      // cancellation and disposes it, but this final pass closes any remaining gap.
      for (const [agentId, state] of this.agents) {
        if (state.state !== 'done' && state.state !== 'failed') {
          await this.settleAgent(agentId, 'failed', reason, this.runVersion);
        }
      }
      await Promise.allSettled([...this.cleanupPromises.values()]);
      this.checkAllComplete();
    })().finally(() => {
      this.cancellationPromise = null;
    });

    return this.cancellationPromise;
  }

  /** Orchestrator teardown is cancellation plus awaited transient disposal. */
  async dispose(): Promise<void> {
    await this.cancel('Orchestrator disposed');
    this.detachListeners();
  }

  getFleetState(): FleetAgentState[] {
    return [...this.agents.values()].map((state) => ({ ...state }));
  }

  private emit(
    event: 'fleet:agent:started' | 'fleet:agent:working' | 'fleet:agent:done' | 'fleet:agent:failed',
    agentId: string,
    state: FleetAgentState,
  ): void;
  private emit(event: 'fleet:all:complete', states: FleetAgentState[]): void;
  private emit(event: keyof FleetEventListeners, ...args: unknown[]): void {
    for (const cb of this.listeners[event] as Array<(...values: unknown[]) => void>) {
      cb(...args);
    }
  }

  private resetState(): void {
    this.detachListeners();
    this.agents.clear();
    this.lifecycleIds.clear();
    this.spawnPromises.clear();
    this.cleanupPromises.clear();
    this.cancelled = false;
    this.allCompleteEmitted = false;
    this.cancellationPromise = null;
  }

  private isActiveRun(version: number): boolean {
    return !this.cancelled && version === this.runVersion;
  }

  private launchSpawn(task: TaskAssignment, workingDir: string, version: number): void {
    const promise = this.spawnAgent(task, workingDir, version);
    this.spawnPromises.set(task.agentId, promise);
    void promise.finally(() => {
      if (this.spawnPromises.get(task.agentId) === promise) {
        this.spawnPromises.delete(task.agentId);
      }
      this.checkAllComplete();
    });
  }

  private attachListeners(version: number): void {
    const bridge = this.bridge;
    const epoch = ++this.listenerEpoch;
    const accepts = (
      agentId: string,
      eventOfficeId?: string,
      eventLifecycleId?: string,
    ): boolean =>
      epoch === this.listenerEpoch
      && version === this.runVersion
      && this.agents.has(agentId)
      && (!eventOfficeId || eventOfficeId === this.officeId)
      && !!eventLifecycleId
      && eventLifecycleId === this.lifecycleIds.get(agentId);

    bridge.onTerminalPreloadStatus((agentId, status, eventOfficeId, sessionId, lifecycleId) => {
      if (!accepts(agentId, eventOfficeId, lifecycleId)) return;
      if (!this.bindSessionEvent(agentId, sessionId)) return;
      if (status === 'ready') {
        const current = this.agents.get(agentId)!;
        if (current.state !== 'starting') return;
        this.updateAgentState(agentId, 'working');
        this.emit('fleet:agent:working', agentId, { ...this.agents.get(agentId)! });
      } else if (status === 'failed') {
        void this.settleAgent(agentId, 'failed', 'Terminal preload failed', version);
      }
    });

    bridge.onTerminalExit((agentId, exitCode, eventOfficeId, sessionId, lifecycleId) => {
      if (!accepts(agentId, eventOfficeId, lifecycleId)) return;
      if (!this.bindSessionEvent(agentId, sessionId)) return;
      const current = this.agents.get(agentId)!;
      if (current.state === 'done' || current.state === 'failed') return;
      void this.settleAgent(
        agentId,
        exitCode === 0 ? 'done' : 'failed',
        exitCode === 0 ? undefined : `Exited with code ${exitCode}`,
        version,
      );
    });

    bridge.onCopilotTurnEnd((agentId, eventOfficeId, sessionId, lifecycleId) => {
      if (!accepts(agentId, eventOfficeId, lifecycleId)) return;
      if (!this.bindSessionEvent(agentId, sessionId)) return;
      if (this.agents.get(agentId)?.state !== 'working') return;
      void this.settleAgent(agentId, 'done', undefined, version);
    });
  }

  private detachListeners(): void {
    this.listenerEpoch++;
  }

  private bindSessionEvent(agentId: string, sessionId?: string): boolean {
    const current = this.agents.get(agentId);
    if (!current) return false;
    if (!sessionId) return true;
    // Native bridge registration may replace the initial id before readiness.
    // Server-side lifecycleId ownership remains authoritative, so update the
    // generation token rather than rejecting that legitimate replacement.
    current.transientSessionId = sessionId;
    return true;
  }

  private async spawnAgent(
    task: TaskAssignment,
    workingDir: string,
    version: number,
  ): Promise<void> {
    if (version !== this.runVersion) return;
    const { agentId } = task;
    const lifecycleId = createLifecycleId(version, agentId);
    this.lifecycleIds.set(agentId, lifecycleId);
    this.updateAgentState(agentId, 'starting');
    this.emit('fleet:agent:started', agentId, { ...this.agents.get(agentId)! });

    const start = () =>
      this.bridge
        .terminalBeginTransientSession(this.officeId, agentId, {
          lifecycleId,
          title: task.title,
          workingDir,
          preseededPrompt: task.prompt,
        })
        .catch((error: unknown) => ({
          success: false as const,
          error: String((error as Error)?.message ?? error),
        }));

    let result = await start();
    if (!result.success && this.isActiveRun(version)) {
      await delay(RETRY_DELAY_MS);
      if (this.isActiveRun(version)) result = await start();
    }

    if (!result.success) {
      await this.settleAgent(
        agentId,
        'failed',
        `Failed to start transient terminal after retry: ${result.error}`,
        version,
      );
      return;
    }

    const state = this.agents.get(agentId);
    if (!state || version !== this.runVersion) {
      await this.disposeLease(agentId, lifecycleId);
      return;
    }
    state.transientSessionId = result.sessionId;

    if (this.cancelled) {
      await this.settleAgent(agentId, 'failed', 'Cancelled', version);
    }
  }

  private settleAgent(
    agentId: string,
    terminalState: 'done' | 'failed',
    error: string | undefined,
    version: number,
  ): Promise<void> {
    const existing = this.cleanupPromises.get(agentId);
    if (existing) return existing;

    const current = this.agents.get(agentId);
    if (!current || current.cleanupSettled || version !== this.runVersion) {
      return Promise.resolve();
    }

    const lifecycleId = this.lifecycleIds.get(agentId);
    const cleanup = (async () => {
      let cleanupError: string | undefined;
      if (lifecycleId) {
        const result = await this.disposeLease(agentId, lifecycleId);
        if (!result.success) cleanupError = result.error;
      }

      const finalState: 'done' | 'failed' = cleanupError ? 'failed' : terminalState;
      const finalError = cleanupError
        ? [error, `Transient cleanup failed: ${cleanupError}`].filter(Boolean).join('; ')
        : error;
      this.updateAgentState(agentId, finalState, finalError);
      const settled = this.agents.get(agentId);
      if (!settled) return;
      settled.cleanupSettled = true;
      this.emit(
        finalState === 'done' ? 'fleet:agent:done' : 'fleet:agent:failed',
        agentId,
        { ...settled },
      );
    })();

    this.cleanupPromises.set(agentId, cleanup);
    return cleanup.finally(() => {
      if (this.cleanupPromises.get(agentId) === cleanup) {
        this.cleanupPromises.delete(agentId);
      }
      this.checkAllComplete();
    });
  }

  private async disposeLease(agentId: string, lifecycleId: string) {
    let result = await this.bridge
      .terminalDisposeTransientSession(this.officeId, agentId, lifecycleId)
      .catch((error: unknown) => ({
        success: false as const,
        error: String((error as Error)?.message ?? error),
      }));
    if (!result.success) {
      await delay(CLEANUP_RETRY_DELAY_MS);
      result = await this.bridge
        .terminalDisposeTransientSession(this.officeId, agentId, lifecycleId)
        .catch((error: unknown) => ({
          success: false as const,
          error: String((error as Error)?.message ?? error),
        }));
    }
    return result;
  }

  private finishWithoutLease(
    agentId: string,
    state: 'done' | 'failed',
    error?: string,
  ): void {
    const current = this.agents.get(agentId);
    if (!current || current.cleanupSettled) return;
    this.updateAgentState(agentId, state, error);
    current.cleanupSettled = true;
    this.emit(
      state === 'done' ? 'fleet:agent:done' : 'fleet:agent:failed',
      agentId,
      { ...current },
    );
  }

  private updateAgentState(
    agentId: string,
    state: FleetAgentState['state'],
    error?: string,
  ): void {
    const current = this.agents.get(agentId);
    if (!current) return;
    current.state = state;
    if (error !== undefined) current.error = error;
    if (state === 'starting' && !current.startedAt) current.startedAt = Date.now();
    if (state === 'done' || state === 'failed') current.completedAt = Date.now();
  }

  private checkAllComplete(): void {
    if (this.allCompleteEmitted || this.agents.size === 0) return;
    const allSettled = [...this.agents.values()].every(
      (agent) =>
        (agent.state === 'done' || agent.state === 'failed') &&
        agent.cleanupSettled,
    );
    if (!allSettled || this.cleanupPromises.size > 0) return;
    this.allCompleteEmitted = true;
    this.detachListeners();
    this.emit('fleet:all:complete', this.getFleetState());
  }
}

function createLifecycleId(version: number, agentId: string): string {
  const uuid = globalThis.crypto?.randomUUID?.()
    ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `fleet-${version}-${agentId}-${uuid}`;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
