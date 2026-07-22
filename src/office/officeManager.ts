// Office Manager - handles multiple offices with separate sessions
// Each office has its own working directory and set of agents

import type { AgentConfig } from '../config/agents';
import { generateRandomOfficeAgents } from '../config/agents';
import { logLifecycleTransition, type LifecycleState } from '../util/lifecycleLog';
import type { ToolEntry } from '../util/toolStatus';
import {
  createBridgePersistencePort,
  deserializeOffices,
  normalizeWorkingDir,
  serializeOffices,
  type OfficePersistencePort,
} from './officePersistence';

export type OfficeLayout = 'default' | 'fleet-vteam';

export interface SeatedAgent {
  deskId: string;
  agentId: string;
}

export interface OfficeConfig {
  id: string;
  name: string;
  workingDirectory: string;
  createdAt: number;
  layout: OfficeLayout;
  seatedAgents: SeatedAgent[];
  customAgents?: AgentConfig[];
  customReserveAgents?: Record<string, AgentConfig>;
  /** Optional per-office override Teams channel deep-link (falls back to global default). */
  teamsChannelUrl?: string;
  /**
   * Optional per-office override for the relay @mention target used in Teams completion
   * notifications. Falls back to the global mention when type is 'none' or value is empty.
   */
  teamsMentionType?: 'user' | 'tag' | 'none';
  teamsMentionValue?: string;
}

export type AgentState = 'slacking' | 'active';
export type ActiveSubState = 'starting' | 'ready' | 'waiting' | 'thinking' | 'error';

// Effective state combines state + subState into a single key for transition validation.
// 'slacking' when state is slacking; otherwise the subState value.
type EffectiveState = 'slacking' | ActiveSubState;

// Valid state transitions — each key maps to the set of states it can transition TO.
// Transitions not listed here will log a warning but still execute (backward compat).
const VALID_TRANSITIONS: Record<EffectiveState, Set<EffectiveState>> = {
  slacking: new Set(['starting', 'ready']),
  starting: new Set(['ready', 'error', 'slacking']),
  ready:    new Set(['thinking', 'waiting', 'slacking']),
  thinking: new Set(['ready', 'waiting', 'thinking', 'slacking']),
  waiting:  new Set(['thinking', 'ready', 'slacking']),
  error:    new Set(['slacking', 'starting']),
};

export interface RecentAction {
  action: string;      // e.g. "edit", "grep", "ask_user"
  type: 'started' | 'completed';
  timestamp: number;   // Date.now()
}

const MAX_RECENT_ACTIONS = 8;

export interface AgentStatus {
  agentId: string;
  state: AgentState;
  subState: ActiveSubState | null;   // null when slacking
  thinkingDetail: string | null;     // what agent is doing when thinking
  currentTool: string | null;        // raw tool name for backward compat
  completionPendingAck?: boolean;    // true when latest completed response is unacknowledged
  // Enhanced tracking fields
  unreadCount: number;               // notifications unseen by user
  lastEvent: string | null;          // last notable event description
  activityStartTime: number | null;  // Date.now() when entering thinking/waiting
  lastCompletedAction: string | null; // e.g. "edit on src/main.ts"
  // Activity history
  recentActions: RecentAction[];     // ring buffer of recent tool actions
  taskSummary: string | null;        // persistent task context across tools
}

export interface OfficeData {
  config: OfficeConfig;
  agents: Map<string, AgentStatus>;
  agentTools: Map<string, ToolEntry[]>;
}

export class OfficeManager {
  private offices: Map<string, OfficeData> = new Map();
  private sessionToOffice: Map<string, string> = new Map(); // sessionId → officeId
  private _currentOfficeId: string | null = null;
  private readonly persistence: OfficePersistencePort;

  // Spec 008 (2026-06-12): durable load is async but renderer boot triggers
  // saves (status updates, agent registrations) almost immediately. Without
  // gating, those saves serialize the localStorage-only state and clobber
  // the multi-office file on disk before the durable load can hydrate. We
  // hold all durable writes until loadFromStorage's async path settles, then
  // flush whatever the most-recent state was. localStorage writes are NOT
  // gated — they're fast, synchronous, and only matter for next cold boot.
  private durableLoadSettled = false;
  private pendingDurableWrite = false;

  // Callbacks for UI updates
  onOfficeChanged: ((officeId: string) => void) | null = null;
  onOfficesUpdated: (() => void) | null = null;

  constructor(persistence: OfficePersistencePort = createBridgePersistencePort()) {
    this.persistence = persistence;
    this.loadFromStorage();
  }
  
  get currentOfficeId(): string | null {
    return this._currentOfficeId;
  }
  
  get currentOffice(): OfficeData | null {
    if (!this._currentOfficeId) return null;
    return this.offices.get(this._currentOfficeId) || null;
  }
  
  getAllOffices(): OfficeConfig[] {
    return Array.from(this.offices.values()).map(o => o.config);
  }
  
  getOffice(officeId: string): OfficeData | undefined {
    return this.offices.get(officeId);
  }
  
  // Create a new office
  createOffice(name: string, workingDirectory: string, layout: OfficeLayout = 'default'): OfficeData {
    workingDirectory = normalizeWorkingDir(workingDirectory);
    const existingIndices = Array.from(this.offices.values()).map(o => parseInt(o.config.id.replace('office-', ''), 10));
    const nextIndex = existingIndices.length > 0 ? Math.max(...existingIndices) + 1 : 0;
    const id = `office-${nextIndex}`;
    const config: OfficeConfig = {
      id,
      name,
      workingDirectory,
      createdAt: Date.now(),
      layout,
      seatedAgents: [],
    };

    // Generate random agents for non-primary offices with default layout
    if (id !== 'office-0' && layout === 'default') {
      const { coreAgents, reserveAgents } = generateRandomOfficeAgents(id);
      config.customAgents = coreAgents;
      config.customReserveAgents = reserveAgents;
    }
    
    const data: OfficeData = {
      config,
      agents: new Map(),
      agentTools: new Map(),
    };
    
    this.offices.set(id, data);
    
    // If this is the first office, make it current
    if (!this._currentOfficeId) {
      this._currentOfficeId = id;
    }
    
    this.saveToStorage();

    // Create per-office session file eagerly via the persistence port.
    void this.persistence.createOfficeSession(id);

    this.onOfficesUpdated?.();
    
    return data;
  }
  
  // Delete an office (office at index 0 cannot be deleted)
  deleteOffice(officeId: string): boolean {
    const office = this.offices.get(officeId);
    if (!office) return false;

    if (officeId === 'office-0') {
      console.warn('[OfficeManager] Cannot delete the primary office (office-0)');
      return false;
    }
    
    // Remove all sessions for this office
    for (const [sessionId, oid] of this.sessionToOffice) {
      if (oid === officeId) {
        this.sessionToOffice.delete(sessionId);
      }
    }
    
    this.offices.delete(officeId);

    // Delete per-office session file via the persistence port.
    void this.persistence.deleteOfficeSession(officeId);

    // If we deleted the current office, switch to another
    if (this._currentOfficeId === officeId) {
      // Always switch to Main Office (office-0) which is protected from deletion
      this._currentOfficeId = this.offices.has('office-0') ? 'office-0' : (this.offices.keys().next().value || null);
      if (this._currentOfficeId) {
        this.onOfficeChanged?.(this._currentOfficeId);
      }
    }
    
    this.saveToStorage();
    this.onOfficesUpdated?.();
    return true;
  }
  
  // Switch to a different office
  switchOffice(officeId: string): boolean {
    if (!this.offices.has(officeId)) return false;
    if (this._currentOfficeId === officeId) return true;
    
    this._currentOfficeId = officeId;
    this.onOfficeChanged?.(officeId);
    this.saveToStorage();
    return true;
  }
  
  // Update office config
  updateOffice(officeId: string, updates: Partial<Pick<OfficeConfig, 'name' | 'workingDirectory' | 'layout' | 'teamsChannelUrl' | 'teamsMentionType' | 'teamsMentionValue'>>): boolean {
    const office = this.offices.get(officeId);
    if (!office) return false;
    
    if (updates.name !== undefined) office.config.name = updates.name;
    if (updates.workingDirectory !== undefined) office.config.workingDirectory = normalizeWorkingDir(updates.workingDirectory);
    if (updates.layout !== undefined) office.config.layout = updates.layout;
    if (updates.teamsChannelUrl !== undefined) office.config.teamsChannelUrl = updates.teamsChannelUrl;
    if (updates.teamsMentionType !== undefined) office.config.teamsMentionType = updates.teamsMentionType;
    if (updates.teamsMentionValue !== undefined) office.config.teamsMentionValue = updates.teamsMentionValue;
    
    this.saveToStorage();
    this.onOfficesUpdated?.();
    return true;
  }
  
  // Session management
  assignSessionToOffice(sessionId: string, officeId: string): void {
    this.sessionToOffice.set(sessionId, officeId);
  }
  
  getOfficeForSession(sessionId: string): string | undefined {
    return this.sessionToOffice.get(sessionId);
  }
  
  removeSession(sessionId: string): void {
    const officeId = this.sessionToOffice.get(sessionId);
    if (officeId) {
      const office = this.offices.get(officeId);
      if (office) {
        office.agents.delete(sessionId);
        office.agentTools.delete(sessionId);
      }
    }
    this.sessionToOffice.delete(sessionId);
  }
  
  // Get working directory for current office (for spawning new sessions)
  getCurrentWorkingDirectory(): string {
    const office = this.currentOffice;
    return office?.config.workingDirectory || '.';
  }

  // Seated agent persistence helpers
  addSeatedAgent(officeId: string, deskId: string, agentId: string): void {
    const office = this.offices.get(officeId);
    if (!office) return;
    // Avoid duplicates
    if (office.config.seatedAgents.some(s => s.deskId === deskId)) return;
    office.config.seatedAgents.push({ deskId, agentId });
    this.saveToStorage();
  }

  removeSeatedAgent(officeId: string, agentId: string): void {
    const office = this.offices.get(officeId);
    if (!office) return;
    office.config.seatedAgents = office.config.seatedAgents.filter(s => s.agentId !== agentId);
    this.saveToStorage();
  }

  getSeatedAgents(officeId: string): SeatedAgent[] {
    const office = this.offices.get(officeId);
    return office?.config.seatedAgents ?? [];
  }
  
  // Persistence — saves to both localStorage (fast) and durable file via port.
  private saveToStorage(): void {
    const json = serializeOffices({
      currentOfficeId: this._currentOfficeId,
      offices: Array.from(this.offices.values()).map((o) => o.config),
    });

    try {
      localStorage.setItem('copilot-offices', json);
    } catch (e) {
      console.warn('[OfficeManager] Failed to save to localStorage:', e);
    }

    // Spec 008 boot-race guard: don't touch the durable file until the
    // initial loadDurable() has resolved (or failed). Mark a pending flush
    // and we'll write the latest state in flushPendingDurableWrite().
    if (!this.durableLoadSettled) {
      this.pendingDurableWrite = true;
      return;
    }

    // Fire-and-forget durable write via the persistence port.
    void this.persistence.saveDurable(json);
  }

  private flushPendingDurableWrite(): void {
    if (!this.pendingDurableWrite) return;
    this.pendingDurableWrite = false;
    const json = serializeOffices({
      currentOfficeId: this._currentOfficeId,
      offices: Array.from(this.offices.values()).map((o) => o.config),
    });
    void this.persistence.saveDurable(json);
  }

  private loadFromStorage(): void {
    // Load from localStorage first (synchronous, always available).
    this.applyStoredState(localStorage.getItem('copilot-offices'));

    // Then kick off an async durable load via the port — newer data overrides.
    void this.persistence
      .loadDurable()
      .then((data) => {
        if (data) {
          console.log('[OfficeManager] Loaded offices from durable persistence');
          this.applyStoredState(data);
          this.onOfficesUpdated?.();
        }
      })
      .catch((e: unknown) => {
        console.warn('[OfficeManager] Failed to load from durable persistence:', e);
      })
      .finally(() => {
        // Always release the gate even on failure, so subsequent saves can
        // proceed (we'd rather risk overwriting with the in-memory state
        // than wedge persistence forever).
        this.durableLoadSettled = true;
        this.flushPendingDurableWrite();
      });
  }

  private applyStoredState(stored: string | null): void {
    const { currentOfficeId, offices } = deserializeOffices(stored);
    if (offices.length === 0 && currentOfficeId === null) return;

    for (const config of offices) {
      // Preserve existing runtime state (agents, tools) if office already loaded.
      const existing = this.offices.get(config.id);
      const officeData: OfficeData = {
        config,
        agents: existing?.agents ?? new Map(),
        agentTools: existing?.agentTools ?? new Map(),
      };
      this.offices.set(config.id, officeData);
    }

    if (currentOfficeId && this.offices.has(currentOfficeId)) {
      this._currentOfficeId = currentOfficeId;
    } else if (this.offices.size > 0) {
      this._currentOfficeId = this.offices.keys().next().value ?? null;
    }
  }
  
  // Agent status helpers
  getAgentStatus(officeId: string, agentId: string): AgentStatus | undefined {
    return this.offices.get(officeId)?.agents.get(agentId);
  }

  private getOrCreateStatus(officeId: string, agentId: string): AgentStatus | null {
    const office = this.offices.get(officeId);
    if (!office) return null;
    let status = office.agents.get(agentId);
    if (!status) {
      status = { agentId, state: 'slacking', subState: null, thinkingDetail: null, currentTool: null, completionPendingAck: false, unreadCount: 0, lastEvent: null, activityStartTime: null, lastCompletedAction: null, recentActions: [], taskSummary: null };
      office.agents.set(agentId, status);
    }
    if (status.completionPendingAck === undefined) {
      status.completionPendingAck = false;
    }
    return status;
  }

  private getEffectiveState(status: AgentStatus): EffectiveState {
    return status.state === 'slacking' ? 'slacking' : (status.subState || 'ready');
  }

  private validateTransition(agentId: string, status: AgentStatus, target: EffectiveState): void {
    const from = this.getEffectiveState(status);
    if (from === target) return; // self-transition always ok
    if (!VALID_TRANSITIONS[from]?.has(target)) {
      console.warn(`[OfficeManager] Invalid transition: ${agentId} ${from} → ${target}`);
    }
  }

  /**
   * Emit a structured lifecycle telemetry entry for a transition that has
   * already been applied to `status`. Callers pass the pre-mutation effective
   * state captured before mutating. Safe additive observability — never mutates
   * state and self-transitions are suppressed by the helper.
   */
  private emitLifecycleTransition(
    officeId: string,
    agentId: string,
    status: AgentStatus,
    from: EffectiveState,
    reason?: string,
    detail?: string,
  ): void {
    const to = this.getEffectiveState(status);
    logLifecycleTransition({
      agentId,
      officeId,
      from: from as LifecycleState,
      to: to as LifecycleState,
      reason,
      detail,
    });
  }

  setAgentSlacking(officeId: string, agentId: string, reason?: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    const from = this.getEffectiveState(status);
    this.validateTransition(agentId, status, 'slacking');
    status.state = 'slacking';
    status.subState = null;
    status.thinkingDetail = null;
    status.currentTool = null;
    status.completionPendingAck = false;
    status.activityStartTime = null;
    status.recentActions = [];
    status.taskSummary = null;
    this.emitLifecycleTransition(officeId, agentId, status, from, reason);
  }

  setAgentStarting(officeId: string, agentId: string, reason?: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    if (status.subState === 'starting') return; // already starting — dedup
    const from = this.getEffectiveState(status);
    this.validateTransition(agentId, status, 'starting');
    status.state = 'active';
    status.subState = 'starting';
    status.thinkingDetail = null;
    status.currentTool = null;
    status.completionPendingAck = false;
    status.activityStartTime = Date.now();
    this.emitLifecycleTransition(officeId, agentId, status, from, reason);
  }

  setAgentReady(officeId: string, agentId: string, reason?: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    const from = this.getEffectiveState(status);
    this.validateTransition(agentId, status, 'ready');
    status.state = 'active';
    status.subState = 'ready';
    status.thinkingDetail = null;
    status.currentTool = null;
    status.completionPendingAck = false;
    status.activityStartTime = null;
    this.emitLifecycleTransition(officeId, agentId, status, from, reason);
  }

  setAgentDonePendingAck(officeId: string, agentId: string, reason?: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    const from = this.getEffectiveState(status);
    this.validateTransition(agentId, status, 'ready');
    status.state = 'active';
    status.subState = 'ready';
    status.thinkingDetail = null;
    status.currentTool = null;
    status.completionPendingAck = true;
    status.activityStartTime = null;
    this.emitLifecycleTransition(officeId, agentId, status, from, reason ?? 'done_pending_ack');
  }

  acknowledgeAgentCompletion(officeId: string, agentId: string): boolean {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status || !status.completionPendingAck) return false;
    status.completionPendingAck = false;
    return true;
  }

  setAgentWaiting(officeId: string, agentId: string, reason?: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    const from = this.getEffectiveState(status);
    this.validateTransition(agentId, status, 'waiting');
    status.state = 'active';
    status.subState = 'waiting';
    status.thinkingDetail = null;
    status.currentTool = null;
    status.completionPendingAck = false;
    if (!status.activityStartTime) status.activityStartTime = Date.now();
    this.emitLifecycleTransition(officeId, agentId, status, from, reason);
  }

  setAgentThinking(officeId: string, agentId: string, detail: string | null, reason?: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    const from = this.getEffectiveState(status);
    this.validateTransition(agentId, status, 'thinking');
    status.state = 'active';
    status.subState = 'thinking';
    status.thinkingDetail = detail;
    // currentTool is derived from the agentTools stack
    const office = this.offices.get(officeId);
    const tools = office?.agentTools.get(agentId);
    status.currentTool = tools?.length ? tools[tools.length - 1].name ?? null : null;
    status.completionPendingAck = false;
    if (!status.activityStartTime) status.activityStartTime = Date.now();
    this.emitLifecycleTransition(officeId, agentId, status, from, reason, detail ?? undefined);
  }

  clearAgentThinkingDetail(officeId: string, agentId: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    if (status.subState === 'thinking') {
      status.thinkingDetail = null;
    }
  }

  incrementUnread(officeId: string, agentId: string, event: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    status.unreadCount++;
    status.lastEvent = event;
  }

  clearUnread(officeId: string, agentId: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    status.unreadCount = 0;
    status.lastEvent = null;
  }

  setAgentError(officeId: string, agentId: string, detail: string | null = null, reason?: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    const from = this.getEffectiveState(status);
    this.validateTransition(agentId, status, 'error');
    status.state = 'active';
    status.subState = 'error';
    status.thinkingDetail = detail;
    status.currentTool = null;
    status.completionPendingAck = false;
    status.activityStartTime = null;
    this.emitLifecycleTransition(officeId, agentId, status, from, reason, detail ?? undefined);
  }

  setLastCompletedAction(officeId: string, agentId: string, action: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    status.lastCompletedAction = action;
  }

  pushRecentAction(officeId: string, agentId: string, action: string, type: 'started' | 'completed'): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    // Ensure recentActions exists (backward compat with pre-existing status objects)
    if (!status.recentActions) status.recentActions = [];
    status.recentActions.push({ action, type, timestamp: Date.now() });
    if (status.recentActions.length > MAX_RECENT_ACTIONS) {
      status.recentActions.shift();
    }
  }

  setTaskSummary(officeId: string, agentId: string, summary: string | null): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    status.taskSummary = summary;
  }

  getRecentActions(officeId: string, agentId: string): RecentAction[] {
    const status = this.getAgentStatus(officeId, agentId);
    return status?.recentActions || [];
  }

  // Ensure at least one office exists
  ensureDefaultOffice(): void {
    if (this.offices.size === 0) {
      this.createOffice('Main Office', '.');
    }
  }
}

// Singleton instance
export const officeManager = new OfficeManager();
