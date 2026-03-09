// Office Manager - handles multiple offices with separate sessions
// Each office has its own working directory and set of agents

export interface OfficeConfig {
  id: string;
  name: string;
  workingDirectory: string;
  createdAt: number;
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
  agentTools: Map<string, { toolId: string; name: string; status: string }[]>;
}

export class OfficeManager {
  private offices: Map<string, OfficeData> = new Map();
  private sessionToOffice: Map<string, string> = new Map(); // sessionId → officeId
  private _currentOfficeId: string | null = null;
  
  // Callbacks for UI updates
  onOfficeChanged: ((officeId: string) => void) | null = null;
  onOfficesUpdated: (() => void) | null = null;
  
  constructor() {
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
  createOffice(name: string, workingDirectory: string): OfficeData {
    const id = `office-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const config: OfficeConfig = {
      id,
      name,
      workingDirectory,
      createdAt: Date.now(),
    };
    
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
    this.onOfficesUpdated?.();
    
    return data;
  }
  
  // Delete an office
  deleteOffice(officeId: string): boolean {
    if (!this.offices.has(officeId)) return false;
    
    // Remove all sessions for this office
    for (const [sessionId, oid] of this.sessionToOffice) {
      if (oid === officeId) {
        this.sessionToOffice.delete(sessionId);
      }
    }
    
    this.offices.delete(officeId);
    
    // If we deleted the current office, switch to another
    if (this._currentOfficeId === officeId) {
      const remaining = this.offices.keys().next().value;
      this._currentOfficeId = remaining || null;
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
  updateOffice(officeId: string, updates: Partial<Pick<OfficeConfig, 'name' | 'workingDirectory'>>): boolean {
    const office = this.offices.get(officeId);
    if (!office) return false;
    
    if (updates.name !== undefined) office.config.name = updates.name;
    if (updates.workingDirectory !== undefined) office.config.workingDirectory = updates.workingDirectory;
    
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
  
  // Persistence
  private saveToStorage(): void {
    const data = {
      currentOfficeId: this._currentOfficeId,
      offices: Array.from(this.offices.values()).map(o => o.config),
    };
    
    try {
      localStorage.setItem('copilot-offices', JSON.stringify(data));
    } catch (e) {
      console.warn('[OfficeManager] Failed to save to localStorage:', e);
    }
  }
  
  private loadFromStorage(): void {
    try {
      const stored = localStorage.getItem('copilot-offices');
      if (!stored) return;
      
      const data = JSON.parse(stored);
      
      // Restore offices
      if (Array.isArray(data.offices)) {
        for (const config of data.offices) {
          const officeData: OfficeData = {
            config,
            agents: new Map(),
            agentTools: new Map(),
          };
          this.offices.set(config.id, officeData);
        }
      }
      
      // Restore current office
      if (data.currentOfficeId && this.offices.has(data.currentOfficeId)) {
        this._currentOfficeId = data.currentOfficeId;
      } else if (this.offices.size > 0) {
        this._currentOfficeId = this.offices.keys().next().value;
      }
    } catch (e) {
      console.warn('[OfficeManager] Failed to load from localStorage:', e);
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
      status = { agentId, state: 'slacking', subState: null, thinkingDetail: null, currentTool: null, unreadCount: 0, lastEvent: null, activityStartTime: null, lastCompletedAction: null, recentActions: [], taskSummary: null };
      office.agents.set(agentId, status);
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

  setAgentSlacking(officeId: string, agentId: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    this.validateTransition(agentId, status, 'slacking');
    status.state = 'slacking';
    status.subState = null;
    status.thinkingDetail = null;
    status.currentTool = null;
    status.activityStartTime = null;
    status.recentActions = [];
    status.taskSummary = null;
  }

  setAgentStarting(officeId: string, agentId: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    if (status.subState === 'starting') return; // already starting — dedup
    this.validateTransition(agentId, status, 'starting');
    status.state = 'active';
    status.subState = 'starting';
    status.thinkingDetail = null;
    status.currentTool = null;
    status.activityStartTime = Date.now();
  }

  setAgentReady(officeId: string, agentId: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    this.validateTransition(agentId, status, 'ready');
    status.state = 'active';
    status.subState = 'ready';
    status.thinkingDetail = null;
    status.currentTool = null;
    status.activityStartTime = null;
  }

  setAgentWaiting(officeId: string, agentId: string): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    this.validateTransition(agentId, status, 'waiting');
    status.state = 'active';
    status.subState = 'waiting';
    status.thinkingDetail = null;
    status.currentTool = null;
    if (!status.activityStartTime) status.activityStartTime = Date.now();
  }

  setAgentThinking(officeId: string, agentId: string, detail: string | null): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    this.validateTransition(agentId, status, 'thinking');
    status.state = 'active';
    status.subState = 'thinking';
    status.thinkingDetail = detail;
    // currentTool is derived from the agentTools stack
    const office = this.offices.get(officeId);
    const tools = office?.agentTools.get(agentId);
    status.currentTool = tools?.length ? tools[tools.length - 1].name : null;
    if (!status.activityStartTime) status.activityStartTime = Date.now();
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

  setAgentError(officeId: string, agentId: string, detail: string | null = null): void {
    const status = this.getOrCreateStatus(officeId, agentId);
    if (!status) return;
    this.validateTransition(agentId, status, 'error');
    status.state = 'active';
    status.subState = 'error';
    status.thinkingDetail = detail;
    status.currentTool = null;
    status.activityStartTime = null;
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
