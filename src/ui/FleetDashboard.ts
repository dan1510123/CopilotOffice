import type { FleetState, SubAgentTracker } from '../meeting/fleetTracker';

const STATE_ICONS: Record<string, string> = {
  dispatched: '⏳',
  running: '🧠',
  completed: '✅',
  failed: '❌',
};

const STATE_SORT_ORDER: Record<string, number> = {
  running: 0,
  dispatched: 1,
  completed: 2,
  failed: 3,
};

const STYLES = `
.fleet-dashboard {
  display: none;
  flex-direction: column;
  height: 100%;
  background: #1e1e2e;
  color: #e6e6e6;
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 13px;
  overflow: hidden;
}
.fleet-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 14px 20px;
  background: #141424;
  border-bottom: 2px solid #2a2a4a;
  flex-shrink: 0;
}
.fleet-title {
  font-size: 16px;
  font-weight: bold;
  color: #8af;
}
.fleet-progress-text {
  font-size: 12px;
  color: #888;
}
.fleet-progress-bar {
  height: 4px;
  background: #2a2a4a;
  flex-shrink: 0;
}
.fleet-progress-fill {
  height: 100%;
  background: #4488cc;
  transition: width 0.3s ease, background-color 0.3s ease;
  width: 0%;
}
.fleet-agent-list {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}
.fleet-agent-row {
  display: flex;
  align-items: center;
  padding: 8px 20px;
  border-bottom: 1px solid #1a1a2e;
  border-left: 3px solid transparent;
  gap: 10px;
}
.fleet-agent-row[data-state="running"] {
  border-left-color: #44cc44;
}
.fleet-agent-row[data-state="failed"] {
  border-left-color: #cc4444;
}
.fleet-agent-row[data-state="completed"] {
  opacity: 0.6;
}
.fleet-agent-status {
  flex-shrink: 0;
  width: 24px;
  text-align: center;
}
.fleet-agent-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: #ccc;
}
.fleet-agent-type {
  flex-shrink: 0;
  font-size: 11px;
  color: #666;
  padding: 2px 6px;
  background: #252540;
  border-radius: 3px;
}
.fleet-agent-time {
  flex-shrink: 0;
  width: 48px;
  text-align: right;
  font-size: 11px;
  color: #888;
}
.fleet-aggregate {
  padding: 10px 20px;
  font-size: 11px;
  color: #666;
  border-top: 1px solid #2a2a4a;
  background: #141424;
  flex-shrink: 0;
  text-align: center;
}
`;

export class FleetDashboard {
  private container: HTMLElement;
  private headerEl: HTMLElement;
  private progressTextEl: HTMLElement;
  private progressFillEl: HTMLElement;
  private agentListEl: HTMLElement;
  private aggregateEl: HTMLElement;
  private styleEl: HTMLStyleElement;
  private visible = false;

  constructor(parentEl: HTMLElement) {
    // Inject styles
    this.styleEl = document.createElement('style');
    this.styleEl.textContent = STYLES;
    document.head.appendChild(this.styleEl);

    // Container
    this.container = document.createElement('div');
    this.container.className = 'fleet-dashboard';
    parentEl.appendChild(this.container);

    // Header
    this.headerEl = document.createElement('div');
    this.headerEl.className = 'fleet-header';
    this.container.appendChild(this.headerEl);

    const titleEl = document.createElement('span');
    titleEl.className = 'fleet-title';
    titleEl.textContent = '🚀 Fleet Active';
    this.headerEl.appendChild(titleEl);

    this.progressTextEl = document.createElement('span');
    this.progressTextEl.className = 'fleet-progress-text';
    this.progressTextEl.textContent = '0 of 0 complete';
    this.headerEl.appendChild(this.progressTextEl);

    // Progress bar
    const progressBarEl = document.createElement('div');
    progressBarEl.className = 'fleet-progress-bar';
    this.container.appendChild(progressBarEl);

    this.progressFillEl = document.createElement('div');
    this.progressFillEl.className = 'fleet-progress-fill';
    progressBarEl.appendChild(this.progressFillEl);

    // Agent list
    this.agentListEl = document.createElement('div');
    this.agentListEl.className = 'fleet-agent-list';
    this.container.appendChild(this.agentListEl);

    // Aggregate footer
    this.aggregateEl = document.createElement('div');
    this.aggregateEl.className = 'fleet-aggregate';
    this.aggregateEl.textContent = '0 tools active | 0 tools completed';
    this.container.appendChild(this.aggregateEl);
  }

  show(): void {
    this.visible = true;
    this.container.style.display = 'flex';
  }

  hide(): void {
    this.visible = false;
    this.container.style.display = 'none';
  }

  updateState(state: FleetState): void {
    const { counts } = state;
    const total = counts.dispatched + counts.running + counts.completed + counts.failed;
    const done = counts.completed + counts.failed;

    // Header progress text
    this.progressTextEl.textContent = `${counts.completed} of ${total} complete`;

    // Progress bar
    const pct = total > 0 ? (done / total) * 100 : 0;
    this.progressFillEl.style.width = `${pct}%`;
    this.progressFillEl.style.backgroundColor =
      pct >= 100 ? '#44cc44' : '#4488cc';

    // Aggregate footer
    this.aggregateEl.textContent =
      `${state.activeToolCount} tools active | ${state.totalToolsCompleted} tools completed`;

    // Collect and sort agents
    const agents: SubAgentTracker[] = [];
    state.subAgents.forEach((agent) => agents.push(agent));
    agents.sort((a, b) => {
      const orderDiff = (STATE_SORT_ORDER[a.state] ?? 9) - (STATE_SORT_ORDER[b.state] ?? 9);
      if (orderDiff !== 0) return orderDiff;
      return a.dispatchedAt - b.dispatchedAt;
    });

    // Update or create rows
    const now = Date.now();
    const seenIds = new Set<string>();

    agents.forEach((agent) => {
      seenIds.add(agent.toolCallId);
      let row = this.agentListEl.querySelector<HTMLElement>(
        `[data-toolcallid="${CSS.escape(agent.toolCallId)}"]`
      );

      if (!row) {
        row = this.createAgentRow(agent);
        this.agentListEl.appendChild(row);
      }

      this.updateAgentRow(row, agent, now);
    });

    // Remove stale rows
    this.agentListEl.querySelectorAll<HTMLElement>('[data-toolcallid]').forEach((row) => {
      const id = row.getAttribute('data-toolcallid');
      if (id && !seenIds.has(id)) {
        row.remove();
      }
    });

    // Re-sort DOM order
    agents.forEach((agent) => {
      const row = this.agentListEl.querySelector<HTMLElement>(
        `[data-toolcallid="${CSS.escape(agent.toolCallId)}"]`
      );
      if (row) {
        this.agentListEl.appendChild(row);
      }
    });
  }

  destroy(): void {
    this.container.remove();
    this.styleEl.remove();
  }

  private createAgentRow(agent: SubAgentTracker): HTMLElement {
    const row = document.createElement('div');
    row.className = 'fleet-agent-row';
    row.setAttribute('data-toolcallid', agent.toolCallId);

    const statusEl = document.createElement('span');
    statusEl.className = 'fleet-agent-status';
    row.appendChild(statusEl);

    const nameEl = document.createElement('span');
    nameEl.className = 'fleet-agent-name';
    row.appendChild(nameEl);

    const typeEl = document.createElement('span');
    typeEl.className = 'fleet-agent-type';
    row.appendChild(typeEl);

    const timeEl = document.createElement('span');
    timeEl.className = 'fleet-agent-time';
    row.appendChild(timeEl);

    return row;
  }

  private updateAgentRow(row: HTMLElement, agent: SubAgentTracker, now: number): void {
    row.setAttribute('data-state', agent.state);

    const statusEl = row.querySelector<HTMLElement>('.fleet-agent-status')!;
    statusEl.textContent = STATE_ICONS[agent.state] ?? '❓';

    const nameEl = row.querySelector<HTMLElement>('.fleet-agent-name')!;
    nameEl.textContent = agent.taskDescription || 'Unnamed task';
    nameEl.title = agent.taskDescription || '';

    const typeEl = row.querySelector<HTMLElement>('.fleet-agent-type')!;
    typeEl.textContent = agent.agentType;

    const timeEl = row.querySelector<HTMLElement>('.fleet-agent-time')!;
    timeEl.textContent = this.formatElapsed(agent, now);
  }

  private formatElapsed(agent: SubAgentTracker, now: number): string {
    let ms: number;
    if (agent.completedAt) {
      const start = agent.startedAt ?? agent.dispatchedAt;
      ms = agent.completedAt - start;
    } else {
      const start = agent.startedAt ?? agent.dispatchedAt;
      ms = now - start;
    }
    const seconds = Math.floor(ms / 1000);
    if (seconds < 60) return `${seconds}s`;
    const minutes = Math.floor(seconds / 60);
    const remaining = seconds % 60;
    return `${minutes}m${remaining.toString().padStart(2, '0')}s`;
  }
}
