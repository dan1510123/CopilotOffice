/**
 * FleetVisualizer — **Visualize phase** of the fleet pipeline.
 *
 * Bridge between {@link FleetTracker} (data) and OfficeScene (Phaser visuals).
 * Subscribes to FleetTracker state updates and emits game events that
 * OfficeScene listens to for NPC seat assignment, badge updates, walk-out
 * animations, and fleet completion.
 *
 * Pipeline position:
 *   FleetOrchestrator (spawn) → FleetTracker (track) → **FleetVisualizer (visualize)** → Teardown
 *
 * Event contract (all prefixed with `fleet:`):
 *   fleet:assign            — batch assignment after 2s debounce (assigned seat mappings)
 *   fleet:dismiss-unassigned — unassigned agents should walk out
 *   fleet:agent:badge       — per-agent badge update
 *   fleet:agent:exit        — agent completed/failed, walk out
 *   fleet:agent:late-spawn  — single agent arriving after initial batch
 *   fleet:status            — aggregate { total, completed, failed, active }
 *   fleet:complete          — all sub-agents finished
 *
 * Boundaries:
 *   - Visualizer never mutates tracker state, never talks to copilotBridge
 *     directly, and never creates/destroys terminals. All it does is map
 *     FleetTracker deltas onto Phaser events.
 *   - Teardown is the caller's responsibility: dispose the FleetTracker and
 *     unsubscribe the visualizer when the fleet completes or the scene unmounts.
 */

import * as Phaser from 'phaser';
import { FleetTracker, FleetState, SubAgentTracker } from './fleetTracker';

interface FleetNPCMapping {
  toolCallId: string;
  agentId: string;         // fleet-1, fleet-2, etc.
  seatIndex: number;
  taskDescription: string;
  walkOutScheduled: boolean;
}

interface AgentStatus {
  agentId: string;
  state: 'slacking' | 'active';
  subState: 'starting' | 'ready' | 'waiting' | 'thinking' | 'error' | null;
  thinkingDetail: string | null;
  currentTool: string | null;
}

// Seat index reserved for Arthur (orchestrator) — not assignable to sub-agents
const ARTHUR_SEAT_INDEX = 7;

export class FleetVisualizer {
  private mappings = new Map<string, FleetNPCMapping>();  // toolCallId → mapping
  private assignedSeatIndices = new Set<number>();
  private debounceTimer: number | null = null;
  private pendingSpawns: SubAgentTracker[] = [];
  private initialFlushDone = false;
  private unsubscribe: (() => void) | null = null;
  private scene: Phaser.Scene | null = null;

  constructor(
    private tracker: FleetTracker,
    private gameEvents: Phaser.Events.EventEmitter,
    private maxAgents: number = 14
  ) {}

  /** Start visualizing fleet activity. Call after FleetTracker.startTracking(). */
  start(scene: Phaser.Scene): void {
    this.scene = scene;
    this.unsubscribe = this.tracker.onUpdate((state) => this.handleUpdate(state));
  }

  /** Clean up listeners and timers. */
  dispose(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
    if (this.debounceTimer !== null) {
      clearTimeout(this.debounceTimer);
      this.debounceTimer = null;
    }
    this.mappings.clear();
    this.assignedSeatIndices.clear();
    this.pendingSpawns = [];
    this.scene = null;
  }

  // ── Core update handler ─────────────────────────────────────────────────

  private handleUpdate(state: FleetState): void {
    state.subAgents.forEach((tracker, toolCallId) => {
      const mapping = this.mappings.get(toolCallId);

      if (!mapping) {
        // New sub-agent — queue for assignment
        if (tracker.state === 'dispatched' || tracker.state === 'running') {
          this.queueSpawn(tracker);
        }
        return;
      }

      // Existing sub-agent — update badge
      this.updateNPCBadge(mapping, tracker);

      // Handle completion — schedule walk-out
      if ((tracker.state === 'completed' || tracker.state === 'failed') && !mapping.walkOutScheduled) {
        mapping.walkOutScheduled = true;
        this.scheduleWalkOut(mapping, tracker);
      }
    });

    // Emit aggregate status
    this.emitAggregateStatus(state);

    // Check for fleet completion
    if (!state.isActive && this.mappings.size > 0) {
      this.gameEvents.emit('fleet:complete');
    }
  }

  // ── Seat Assignment ─────────────────────────────────────────────────────

  /** Pick a random unassigned seat index (excluding Arthur's seat). */
  private pickRandomSeat(): number | null {
    const available: number[] = [];
    for (let i = 0; i < this.maxAgents; i++) {
      if (i !== ARTHUR_SEAT_INDEX && !this.assignedSeatIndices.has(i)) {
        available.push(i);
      }
    }
    if (available.length === 0) return null;
    return available[Math.floor(Math.random() * available.length)];
  }

  private queueSpawn(tracker: SubAgentTracker): void {
    const seatIndex = this.pickRandomSeat();
    if (seatIndex === null) return;

    // Create mapping immediately to prevent duplicate queuing
    const agentId = `fleet-${seatIndex + 1}`;
    const mapping: FleetNPCMapping = {
      toolCallId: tracker.toolCallId,
      agentId,
      seatIndex,
      taskDescription: tracker.taskDescription,
      walkOutScheduled: false,
    };
    this.mappings.set(tracker.toolCallId, mapping);
    this.assignedSeatIndices.add(seatIndex);

    if (this.initialFlushDone) {
      // Late arrival — assign immediately and update badge
      this.gameEvents.emit('fleet:agent:late-spawn', agentId);
      this.updateNPCBadge(mapping, tracker);
      return;
    }

    // Accumulate during debounce window
    this.pendingSpawns.push(tracker);

    if (this.debounceTimer === null) {
      // Start 2-second collection window
      this.debounceTimer = window.setTimeout(() => {
        this.flushSpawns();
      }, 2000);
    }
  }

  private flushSpawns(): void {
    this.debounceTimer = null;
    this.initialFlushDone = true;

    if (this.pendingSpawns.length === 0) return;

    // Build assignment data for the batch
    const assignments: Array<{ agentId: string; seatIndex: number; toolCallId: string; taskDescription: string }> = [];

    this.pendingSpawns.forEach((tracker) => {
      const mapping = this.mappings.get(tracker.toolCallId);
      if (mapping) {
        assignments.push({
          agentId: mapping.agentId,
          seatIndex: mapping.seatIndex,
          toolCallId: tracker.toolCallId,
          taskDescription: mapping.taskDescription,
        });
      }
    });

    // Emit assignment event — OfficeScene will light up badges for these agents
    this.gameEvents.emit('fleet:assign', { assignments });

    // Emit badge updates for each assigned agent
    this.pendingSpawns.forEach((tracker) => {
      const mapping = this.mappings.get(tracker.toolCallId);
      if (mapping) this.updateNPCBadge(mapping, tracker);
    });

    // Emit dismiss event — OfficeScene will walk out unassigned agents
    const unassignedAgentIds: string[] = [];
    for (let i = 0; i < this.maxAgents; i++) {
      if (i !== ARTHUR_SEAT_INDEX && !this.assignedSeatIndices.has(i)) {
        unassignedAgentIds.push(`fleet-${i + 1}`);
      }
    }
    if (unassignedAgentIds.length > 0) {
      this.gameEvents.emit('fleet:dismiss-unassigned', { agentIds: unassignedAgentIds });
    }

    this.pendingSpawns = [];
  }

  // ── Badge updates ───────────────────────────────────────────────────────

  private updateNPCBadge(mapping: FleetNPCMapping, tracker: SubAgentTracker): void {
    const status = this.trackerToStatus(mapping.agentId, tracker);
    this.gameEvents.emit('fleet:agent:badge', mapping.agentId, status);
  }

  private trackerToStatus(agentId: string, tracker: SubAgentTracker): AgentStatus {
    switch (tracker.state) {
      case 'dispatched':
        return {
          agentId,
          state: 'active',
          subState: 'starting',
          thinkingDetail: tracker.taskDescription,
          currentTool: null,
        };
      case 'running':
        return {
          agentId,
          state: 'active',
          subState: 'thinking',
          thinkingDetail: tracker.taskDescription,
          currentTool: null,
        };
      case 'completed':
        return {
          agentId,
          state: 'active',
          subState: 'ready',
          thinkingDetail: 'Done',
          currentTool: null,
        };
      case 'failed':
        return {
          agentId,
          state: 'active',
          subState: 'error',
          thinkingDetail: tracker.error || 'Failed',
          currentTool: null,
        };
    }
  }

  // ── Walk-out animations ─────────────────────────────────────────────────

  private scheduleWalkOut(mapping: FleetNPCMapping, _tracker: SubAgentTracker): void {
    if (!this.scene) return;

    this.scene.time.delayedCall(2000, () => {
      this.gameEvents.emit('fleet:agent:exit', mapping.agentId);
    });
  }

  // ── Aggregate status ────────────────────────────────────────────────────

  private emitAggregateStatus(state: FleetState): void {
    this.gameEvents.emit('fleet:status', {
      total: state.counts.dispatched + state.counts.running + state.counts.completed + state.counts.failed,
      completed: state.counts.completed,
      failed: state.counts.failed,
      active: state.counts.dispatched + state.counts.running,
    });
  }
}
