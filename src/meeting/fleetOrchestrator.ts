import { MeetingPlan, TaskAssignment } from './types';

export interface FleetAgentState {
  agentId: string;
  taskTitle: string;
  state: 'pending' | 'starting' | 'working' | 'done' | 'failed';
  error: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

export type FleetEventCallback = (agentId: string, state: FleetAgentState) => void;
export type FleetCompleteCallback = (states: FleetAgentState[]) => void;

const STAGGER_DELAY_MS = 1500;
const RETRY_DELAY_MS = 2000;

interface FleetEventListeners {
  'fleet:agent:started': FleetEventCallback[];
  'fleet:agent:working': FleetEventCallback[];
  'fleet:agent:done': FleetEventCallback[];
  'fleet:agent:failed': FleetEventCallback[];
  'fleet:all:complete': FleetCompleteCallback[];
}

export class FleetOrchestrator {
  private agents: Map<string, FleetAgentState> = new Map();
  private listeners: FleetEventListeners = {
    'fleet:agent:started': [],
    'fleet:agent:working': [],
    'fleet:agent:done': [],
    'fleet:agent:failed': [],
    'fleet:all:complete': [],
  };
  private cancelled = false;
  private detached = false;

  private get bridge(): any {
    return (window as any).copilotBridge;
  }

  on(event: 'fleet:agent:started' | 'fleet:agent:working' | 'fleet:agent:done' | 'fleet:agent:failed', cb: FleetEventCallback): void;
  on(event: 'fleet:all:complete', cb: FleetCompleteCallback): void;
  on(event: string, cb: any): void {
    const list = this.listeners[event as keyof FleetEventListeners];
    if (list) {
      list.push(cb);
    }
  }

  off(event: string, cb: any): void {
    const list = this.listeners[event as keyof FleetEventListeners];
    if (list) {
      const idx = list.indexOf(cb);
      if (idx !== -1) list.splice(idx, 1);
    }
  }

  private emit(event: 'fleet:agent:started' | 'fleet:agent:working' | 'fleet:agent:done' | 'fleet:agent:failed', agentId: string, state: FleetAgentState): void;
  private emit(event: 'fleet:all:complete', states: FleetAgentState[]): void;
  private emit(event: string, ...args: any[]): void {
    const list = this.listeners[event as keyof FleetEventListeners];
    if (list) {
      list.forEach((cb: any) => cb(...args));
    }
  }

  async executePlan(plan: MeetingPlan, workingDir: string): Promise<void> {
    this.reset();
    this.cancelled = false;

    // Initialize all agents as pending
    plan.tasks.forEach((task) => {
      this.agents.set(task.agentId, {
        agentId: task.agentId,
        taskTitle: task.title,
        state: 'pending',
        error: null,
        startedAt: null,
        completedAt: null,
      });
    });

    this.attachListeners();

    // Spawn agents with staggered starts
    for (let i = 0; i < plan.tasks.length; i++) {
      if (this.cancelled) break;
      if (i > 0) {
        await delay(STAGGER_DELAY_MS);
      }
      if (this.cancelled) break;
      this.spawnAgent(plan.tasks[i], workingDir);
    }
  }

  cancel(): void {
    this.cancelled = true;
    this.detachListeners();

    const bridge = this.bridge;
    this.agents.forEach((agentState, agentId) => {
      if (agentState.state === 'starting' || agentState.state === 'working') {
        bridge.terminalKill(agentId).catch(() => {});
        this.updateAgentState(agentId, 'failed', 'Cancelled');
      }
    });
  }

  getFleetState(): FleetAgentState[] {
    const states: FleetAgentState[] = [];
    this.agents.forEach((state) => states.push({ ...state }));
    return states;
  }

  private reset(): void {
    this.detachListeners();
    this.agents.clear();
    this.cancelled = false;
  }

  private attachListeners(): void {
    const bridge = this.bridge;
    this.detached = false;

    // Track terminal readiness — agent is working once ready
    const onPreloadStatus = (agentId: string, status: string) => {
      if (this.detached || !this.agents.has(agentId)) return;
      if (status === 'ready') {
        this.updateAgentState(agentId, 'working');
        const agentState = this.agents.get(agentId)!;
        this.emit('fleet:agent:working', agentId, { ...agentState });
      } else if (status === 'failed') {
        this.updateAgentState(agentId, 'failed', 'Terminal preload failed');
        const agentState = this.agents.get(agentId)!;
        this.emit('fleet:agent:failed', agentId, { ...agentState });
        this.checkAllComplete();
      }
    };

    // Track unexpected exits
    const onExit = (agentId: string, exitCode: number) => {
      if (this.detached || !this.agents.has(agentId)) return;
      const current = this.agents.get(agentId)!;
      if (current.state === 'done' || current.state === 'failed') return;

      if (exitCode !== 0) {
        this.updateAgentState(agentId, 'failed', `Exited with code ${exitCode}`);
        const agentState = this.agents.get(agentId)!;
        this.emit('fleet:agent:failed', agentId, { ...agentState });
      } else {
        this.updateAgentState(agentId, 'done');
        const agentState = this.agents.get(agentId)!;
        this.emit('fleet:agent:done', agentId, { ...agentState });
      }
      this.checkAllComplete();
    };

    // Copilot turn end signals task completion
    const onTurnEnd = (agentId: string) => {
      if (this.detached || !this.agents.has(agentId)) return;
      const current = this.agents.get(agentId)!;
      if (current.state !== 'working') return;

      this.updateAgentState(agentId, 'done');
      const agentState = this.agents.get(agentId)!;
      this.emit('fleet:agent:done', agentId, { ...agentState });
      this.checkAllComplete();
    };

    bridge.onTerminalPreloadStatus(onPreloadStatus);
    bridge.onTerminalExit(onExit);
    bridge.onCopilotTurnEnd(onTurnEnd);

    // Do NOT call removeTerminalListeners/removeCopilotListeners — that nukes ALL
    // ipcRenderer listeners for those channels, including main.ts's handlers.
    // Instead, set the detached flag to make callbacks no-op.
  }

  private detachListeners(): void {
    this.detached = true;
  }

  private async spawnAgent(task: TaskAssignment, workingDir: string): Promise<void> {
    const { agentId } = task;
    this.updateAgentState(agentId, 'starting');
    const agentState = this.agents.get(agentId)!;
    this.emit('fleet:agent:started', agentId, { ...agentState });

    const bridge = this.bridge;
    let result = await bridge.terminalStart(agentId, workingDir).catch(() => ({ success: false }));

    // Retry once on failure
    if (!result.success) {
      await delay(RETRY_DELAY_MS);
      if (this.cancelled) return;
      result = await bridge.terminalStart(agentId, workingDir).catch(() => ({ success: false }));
    }

    if (!result.success) {
      this.updateAgentState(agentId, 'failed', 'Failed to start terminal after retry');
      const failedState = this.agents.get(agentId)!;
      this.emit('fleet:agent:failed', agentId, { ...failedState });
      this.checkAllComplete();
      return;
    }

    // Wait briefly for the terminal to initialize, then send the prompt.
    // The preload status listener will transition state to 'working' when ready.
    bridge.terminalWrite(agentId, task.prompt + '\r');
    bridge.setSessionMeta(agentId, { title: task.title });
  }

  private updateAgentState(agentId: string, state: FleetAgentState['state'], error?: string): void {
    const current = this.agents.get(agentId);
    if (!current) return;

    current.state = state;
    if (error !== undefined) current.error = error;
    if (state === 'starting' && !current.startedAt) current.startedAt = Date.now();
    if (state === 'done' || state === 'failed') current.completedAt = Date.now();
  }

  private checkAllComplete(): void {
    let allDone = true;
    this.agents.forEach((agentState) => {
      if (agentState.state !== 'done' && agentState.state !== 'failed') {
        allDone = false;
      }
    });

    if (allDone && this.agents.size > 0) {
      this.emit('fleet:all:complete', this.getFleetState());
      this.detachListeners();
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
