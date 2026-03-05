// Office Manager - handles multiple offices with separate sessions
// Each office has its own working directory and set of agents

export interface OfficeConfig {
  id: string;
  name: string;
  workingDirectory: string;
  createdAt: number;
}

export interface AgentStatus {
  agentId: string;
  currentTool: string | null;
  isWaiting: boolean;
  bubbleType: 'permission' | 'waiting' | null;
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

  setAgentActive(officeId: string, agentId: string, toolName: string | null, status: string | null): void {
    const office = this.offices.get(officeId);
    if (!office) return;
    const existing = office.agents.get(agentId) ?? { agentId, currentTool: null, isWaiting: false, bubbleType: null };
    existing.currentTool = toolName;
    existing.isWaiting = false;
    existing.bubbleType = null;
    office.agents.set(agentId, existing);
  }

  setAgentWaiting(officeId: string, agentId: string): void {
    const office = this.offices.get(officeId);
    if (!office) return;
    const existing = office.agents.get(agentId) ?? { agentId, currentTool: null, isWaiting: false, bubbleType: null };
    existing.currentTool = null;
    existing.isWaiting = true;
    existing.bubbleType = 'waiting';
    office.agents.set(agentId, existing);
  }

  clearAgentBubble(officeId: string, agentId: string): void {
    const office = this.offices.get(officeId);
    if (!office) return;
    const existing = office.agents.get(agentId);
    if (existing) {
      existing.bubbleType = null;
      existing.isWaiting = false;
    }
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
