import { DashboardRenderer, DashboardRenderContext } from '../types';

/**
 * Dashboard renderer for the fleet v-team layout.
 * Shows agent cards with status info but no session metadata panel (no terminal interaction).
 */
export const fleetDashboard: DashboardRenderer = {
  renderCards(ctx: DashboardRenderContext): string {
    const { agents, office, selectedAgentId, formatElapsed, formatRelativeTime } = ctx;
    let html = '';

    for (const agent of agents) {
      const liveStatus = office?.agents.get(agent.id);

      // Determine status label + color from state model
      let statusDot = '#555';
      let statusLabel = 'Slacking';
      let statusIcon = '💤';

      if (liveStatus) {
        if (liveStatus.state === 'active') {
          switch (liveStatus.subState) {
            case 'starting':
              statusDot = '#ff9944';
              statusLabel = 'Starting...';
              statusIcon = '🚀';
              break;
            case 'ready':
              statusDot = '#4af';
              statusLabel = 'Ready';
              statusIcon = '✓';
              break;
            case 'waiting':
              statusDot = '#ffb86c';
              statusLabel = 'Waiting for input';
              statusIcon = '⏳';
              break;
            case 'thinking':
              statusDot = '#50fa7b';
              statusLabel = liveStatus.thinkingDetail
                ? `Thinking: ${liveStatus.thinkingDetail}`
                : 'Thinking...';
              statusIcon = '⚡';
              break;
            case 'error':
              statusDot = '#f44';
              statusLabel = liveStatus.thinkingDetail
                ? `Error: ${liveStatus.thinkingDetail}`
                : 'Error';
              statusIcon = '❌';
              break;
          }
        }
      }

      const colorHex = '#' + agent.color.toString(16).padStart(6, '0');
      const isSelected = agent.id === selectedAgentId;
      const isArthur = agent.id === 'architect';
      const borderColor = isSelected ? '#4a5a7a' : '#252540';
      const bgColor = isSelected ? '#1a1e2e' : '#13131f';
      const cursor = isArthur ? 'pointer' : 'default';
      const elapsed = liveStatus?.activityStartTime ? formatElapsed(liveStatus.activityStartTime) : '';
      const recentActions = liveStatus?.recentActions || [];
      const taskSummary = liveStatus?.taskSummary || '';
      const isActive = liveStatus?.state === 'active' && liveStatus?.subState !== 'ready' && liveStatus?.subState !== 'error';

      // Elapsed time display
      const elapsedHtml = elapsed ? `<span data-elapsed-agent="${agent.id}" style="color: #8a8; font-size: 10px; margin-left: 8px;">⏱ ${elapsed}</span>` : '';

      // ── Recent Activity Log ──
      let activityLogHtml = '';
      const completedActions = recentActions.filter(a => a.type === 'completed').slice(-3).reverse();
      if (completedActions.length > 0) {
        const rows = completedActions.map(a => {
          const relTime = formatRelativeTime(a.timestamp);
          return `<div style="display: flex; gap: 8px; font-size: 10px; padding: 1px 0;" data-action-ts="${a.timestamp}">
            <span style="color: #445; flex-shrink: 0; min-width: 48px; text-align: right;">${relTime}</span>
            <span style="color: #5a5a7a;">✓ ${a.action}</span>
          </div>`;
        }).join('');
        activityLogHtml = `
          <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #1a1a30;">
            <div style="font-size: 9px; color: #3a3a5a; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.5px;">Recent Activity</div>
            ${rows}
          </div>`;
      }

      // ── Task Summary ──
      const taskSummaryHtml = taskSummary && isActive ? `
        <div style="font-size: 10px; color: #667; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          📋 ${taskSummary}
        </div>` : '';

      // ── Arthur: "View conversation" indicator ──
      const arthurHint = isArthur ? `
        <div style="font-size: 10px; color: #4af; margin-top: 4px; display: flex; align-items: center; gap: 4px;">
          💬 Open Arthur's terminal
        </div>` : '';

      html += `
        <div class="agent-card" data-agent="${agent.id}" style="
          background: ${bgColor};
          border: 1.5px solid ${borderColor};
          border-radius: 10px;
          padding: 14px 16px;
          margin-bottom: 8px;
          cursor: ${cursor};
          transition: border-color 0.15s;
          display: flex;
          align-items: flex-start;
          gap: 12px;
          position: relative;
        ">
          <div style="
            flex-shrink: 0;
            width: 52px;
            background: ${colorHex}22;
            border: 1px solid ${colorHex}44;
            border-radius: 8px;
            display: flex;
            align-items: center;
            justify-content: center;
            overflow: hidden;
            align-self: flex-start;
            margin-top: 2px;
          ">
            <canvas
              id="overview-sprite-${agent.id}"
              width="32" height="34"
              style="image-rendering: pixelated; width: 48px; height: 51px; display: block;"
            ></canvas>
          </div>
          <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 3px;">
            <div>
              <div style="font-weight: bold; color: #dde; font-size: 14px;">${agent.name}</div>
              <div style="color: #778; font-size: 10px; margin-top: 2px;">${agent.description}</div>
            </div>
            <div>
              <div style="display: flex; align-items: center; flex-wrap: wrap; margin-top: 3px;">
                <div style="
                  font-size: 11px;
                  color: ${statusDot};
                  display: flex; align-items: center; gap: 4px;
                ">
                  <span style="font-size: 8px;">●</span>
                  <span>${statusIcon} ${statusLabel}</span>
                </div>
                ${elapsedHtml}
              </div>
              ${taskSummaryHtml}
              ${arthurHint}
            </div>
            ${activityLogHtml}
          </div>
        </div>
      `;
    }

    return html;
  },
};
