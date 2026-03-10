/**
 * FleetTracker — Renderer-side state machine for tracking sub-agent activity.
 *
 * Uses ONLY existing copilotBridge APIs (onCopilotEvent, onCopilotToolStart, etc.)
 * No modifications to server.ts, protocol.ts, or preload.ts required.
 *
 * Usage:
 *   const tracker = new FleetTracker('architect');
 *   tracker.startTracking();
 *   tracker.onUpdate((state) => updateUI(state));
 *   // ... later
 *   tracker.dispose();
 */

// Re-declare the bridge event shape locally to avoid importing from electron/
interface CopilotEvent {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
}

// ── Sub-agent lifecycle states ──────────────────────────────────────────────

export type SubAgentState = 'dispatched' | 'running' | 'completed' | 'failed';

export interface SubAgentTracker {
  toolCallId: string;
  agentType: string;            // "general-purpose", "explore", etc.
  agentDisplayName: string | null;
  taskDescription: string;      // short title from task tool args.description
  taskPrompt: string;           // full prompt from task tool args.prompt
  state: SubAgentState;
  dispatchedAt: number;
  startedAt: number | null;
  completedAt: number | null;
  error: string | null;
  notificationAgentId: string | null; // "agent-N" parsed from system.notification
}

// ── Aggregate fleet state ───────────────────────────────────────────────────

export interface FleetState {
  /** All tracked sub-agents keyed by toolCallId */
  subAgents: ReadonlyMap<string, Readonly<SubAgentTracker>>;
  /** Number of tool calls currently in flight (aggregate across all sub-agents) */
  activeToolCount: number;
  /** Total tool calls completed since tracking started */
  totalToolsCompleted: number;
  /** Whether any sub-agents are still running */
  isActive: boolean;
  /** Counts by state */
  counts: { dispatched: number; running: number; completed: number; failed: number };
}

export type FleetUpdateListener = (state: FleetState) => void;

// ── FleetTracker ────────────────────────────────────────────────────────────

export class FleetTracker {
  private subAgents = new Map<string, SubAgentTracker>();
  private activeToolCount = 0;
  private totalToolsCompleted = 0;
  private listeners: FleetUpdateListener[] = [];
  private tracking = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private get bridge(): any | null {
    return typeof window !== 'undefined' && (window as any).copilotBridge
      ? (window as any).copilotBridge
      : null;
  }

  /**
   * @param agentId   The parent agent whose sub-agents we want to track
   *                  (e.g. 'architect' for Arthur's fleet)
   * @param officeId  The office containing the agent's terminal
   */
  constructor(
    private readonly agentId: string,
    private readonly officeId: string,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Start tracking sub-agent events for this agent.
   *
   * Uses `onCopilotEvent` which requires the agent's terminal viewer to be
   * attached. Call `terminalAttach()` first if the terminal isn't visible —
   * this is the "silent attach" workaround that enables event flow without
   * showing the terminal UI.
   */
  async startTracking(): Promise<void> {
    if (this.tracking) return;

    const bridge = this.bridge;
    if (!bridge) {
      console.warn('[FleetTracker] copilotBridge not available');
      return;
    }

    // Silent attach: ensures server sends copilot-event for this agent
    // even if the terminal overlay isn't showing it.
    const attachResult = await bridge.terminalAttach(this.officeId, this.agentId);
    console.log(`[FleetTracker] terminalAttach result:`, attachResult);

    bridge.onCopilotEvent((agentId: string, event: CopilotEvent) => {
      console.log(`[FleetTracker] onCopilotEvent: agent=${agentId}, type=${event.type}`);
      if (agentId !== this.agentId) return;
      this.processEvent(event);
    });

    // Also listen to the already-explicit tool events (these fire without viewer)
    bridge.onCopilotToolStart((agentId: string, toolName: string, toolId: string, _status: string) => {
      if (agentId !== this.agentId) return;
      console.log(`[FleetTracker] toolStart: ${toolName} (${toolId})`);
      this.handleToolStart(toolName, toolId);
    });

    bridge.onCopilotToolComplete((agentId: string, toolId: string, _success: boolean) => {
      if (agentId !== this.agentId) return;
      console.log(`[FleetTracker] toolComplete: ${toolId}`);
      this.handleToolComplete(toolId);
    });

    this.tracking = true;
    console.log(`[FleetTracker] Started tracking sub-agents for "${this.agentId}"`);
  }

  /** Subscribe to fleet state changes. Returns an unsubscribe function. */
  onUpdate(cb: FleetUpdateListener): () => void {
    this.listeners.push(cb);
    return () => {
      this.listeners = this.listeners.filter(l => l !== cb);
    };
  }

  /** Get a snapshot of the current fleet state. */
  getState(): FleetState {
    const counts = { dispatched: 0, running: 0, completed: 0, failed: 0 };
    this.subAgents.forEach((sa) => {
      counts[sa.state]++;
    });

    return {
      subAgents: this.subAgents,
      activeToolCount: this.activeToolCount,
      totalToolsCompleted: this.totalToolsCompleted,
      isActive: counts.dispatched > 0 || counts.running > 0,
      counts,
    };
  }

  /** Stop tracking and clean up. Does NOT call removeCopilotListeners() to avoid
   *  interfering with other code that uses those listeners. */
  dispose(): void {
    this.tracking = false;
    this.listeners = [];
    // Detach silent viewer if we attached one
    this.bridge?.terminalDetach(this.agentId);
    console.log(`[FleetTracker] Disposed tracker for "${this.agentId}"`);
  }

  /** Reset state for a new fleet run without disposing listeners. */
  reset(): void {
    this.subAgents.clear();
    this.activeToolCount = 0;
    this.totalToolsCompleted = 0;
    this.notifyListeners();
  }

  // ── Event Processing ────────────────────────────────────────────────────

  /**
   * Process a raw CopilotEvent from the events.jsonl stream.
   * This handles sub-agent lifecycle events that aren't covered by the
   * explicit copilot-tool-start / copilot-tool-complete handlers.
   */
  private processEvent(event: CopilotEvent): void {
    switch (event.type) {
      case 'tool.execution_start':
        this.handleToolExecutionStart(event);
        break;

      case 'subagent.started':
        this.handleSubagentStarted(event);
        break;

      case 'subagent.completed':
        this.handleSubagentCompleted(event);
        break;

      case 'subagent.failed':
        this.handleSubagentFailed(event);
        break;

      case 'system.notification':
        this.handleSystemNotification(event);
        break;

      // session.mode_changed and session.plan_changed are informational —
      // we could emit them as events but they don't affect fleet state.
    }
  }

  /**
   * When a `tool.execution_start` with `toolName=task` fires, the parent
   * is dispatching a sub-agent. The `arguments` field contains the task
   * description and prompt.
   */
  private handleToolExecutionStart(event: CopilotEvent): void {
    const data = event.data as {
      toolCallId?: string;
      toolName?: string;
      arguments?: Record<string, unknown>;
    };

    if (data.toolName !== 'task' || !data.toolCallId) return;

    const args = data.arguments ?? {};
    const tracker: SubAgentTracker = {
      toolCallId: data.toolCallId,
      agentType: (args.agent_type as string) ?? 'unknown',
      agentDisplayName: null,
      taskDescription: (args.description as string) ?? 'Unnamed task',
      taskPrompt: (args.prompt as string) ?? '',
      state: 'dispatched',
      dispatchedAt: new Date(event.timestamp).getTime(),
      startedAt: null,
      completedAt: null,
      error: null,
      notificationAgentId: null,
    };

    this.subAgents.set(data.toolCallId, tracker);
    this.notifyListeners();
  }

  /**
   * `subagent.started` fires when the sub-agent process actually begins.
   * Match by toolCallId to update the tracker created in handleToolExecutionStart.
   */
  private handleSubagentStarted(event: CopilotEvent): void {
    const data = event.data as {
      toolCallId?: string;
      agentName?: string;
      agentDisplayName?: string;
    };

    if (!data.toolCallId) return;

    const tracker = this.subAgents.get(data.toolCallId);
    if (tracker) {
      tracker.state = 'running';
      tracker.startedAt = new Date(event.timestamp).getTime();
      tracker.agentDisplayName = data.agentDisplayName ?? null;
    } else {
      // subagent.started arrived before tool.execution_start (unlikely but handle it)
      this.subAgents.set(data.toolCallId, {
        toolCallId: data.toolCallId,
        agentType: data.agentName ?? 'unknown',
        agentDisplayName: data.agentDisplayName ?? null,
        taskDescription: 'Unknown task',
        taskPrompt: '',
        state: 'running',
        dispatchedAt: new Date(event.timestamp).getTime(),
        startedAt: new Date(event.timestamp).getTime(),
        completedAt: null,
        error: null,
        notificationAgentId: null,
      });
    }

    this.notifyListeners();
  }

  private handleSubagentCompleted(event: CopilotEvent): void {
    const data = event.data as { toolCallId?: string };
    if (!data.toolCallId) return;

    const tracker = this.subAgents.get(data.toolCallId);
    if (tracker) {
      tracker.state = 'completed';
      tracker.completedAt = new Date(event.timestamp).getTime();
      this.notifyListeners();
    }
  }

  private handleSubagentFailed(event: CopilotEvent): void {
    const data = event.data as { toolCallId?: string; error?: string };
    if (!data.toolCallId) return;

    const tracker = this.subAgents.get(data.toolCallId);
    if (tracker) {
      tracker.state = 'failed';
      tracker.completedAt = new Date(event.timestamp).getTime();
      tracker.error = data.error ?? 'Unknown error';
      this.notifyListeners();
    }
  }

  /**
   * Parse system.notification to extract the internal "agent-N" ID.
   * Format: 'Agent "agent-6" (general-purpose) has completed successfully.'
   */
  private handleSystemNotification(event: CopilotEvent): void {
    const content = (event.data as { content?: string }).content;
    if (!content) return;

    const match = content.match(/Agent "([^"]+)" \(([^)]+)\) has completed/);
    if (!match) return;

    const [, notifAgentId] = match;

    // Try to associate with a sub-agent. Since we can't directly map agent-N to
    // toolCallId, find the most recently completed sub-agent without a notificationAgentId.
    // Try to associate with the most recently completed sub-agent without a notificationAgentId
    let found = false;
    this.subAgents.forEach((tracker) => {
      if (!found && tracker.state === 'completed' && !tracker.notificationAgentId) {
        tracker.notificationAgentId = notifAgentId;
        found = true;
      }
    });
  }

  // ── Explicit tool event handlers (fire without viewer) ──────────────────

  private handleToolStart(_toolName: string, _toolId: string): void {
    this.activeToolCount++;
    this.notifyListeners();
  }

  private handleToolComplete(_toolId: string): void {
    this.activeToolCount = Math.max(0, this.activeToolCount - 1);
    this.totalToolsCompleted++;
    this.notifyListeners();
  }

  // ── Notification ────────────────────────────────────────────────────────

  private notifyListeners(): void {
    const state = this.getState();
    for (const cb of this.listeners) {
      try {
        cb(state);
      } catch (err) {
        console.error('[FleetTracker] Listener error:', err);
      }
    }
  }
}
