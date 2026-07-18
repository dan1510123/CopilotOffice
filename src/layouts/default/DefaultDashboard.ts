import { DashboardRenderer, DashboardRenderContext, getDashboardTypography } from '../types';
import { teamsLabel } from '../../ui/teamsIcon';
import { STATUS_PRESENTATION, resolveStatusKey, describeActivity } from '../../config/agentStatusPresentation';

/**
 * Dashboard renderer for the default (main) office layout.
 * Renders full agent cards with status, tools, activity, and session metadata.
 */
export const defaultDashboard: DashboardRenderer = {
  renderCards(ctx: DashboardRenderContext): string {
    const { agents, office, selectedAgentId, cachedSessionMeta, agentTools, formatElapsed, formatRelativeTime } = ctx;
    const teamsEnabled = ctx.teamsEnabled ?? false;
    const teamsOnline = ctx.teamsOnlineAgentIds ?? new Set<string>();
    const t = getDashboardTypography();
    let html = '';

    const pcCardSelected = selectedAgentId === 'pc-terminal';
    html += `
      <div class="agent-card" data-agent="pc-terminal" style="
        background: ${pcCardSelected ? '#1e1e3a' : '#13131f'};
        border: 1.5px solid ${pcCardSelected ? '#6677ff' : '#252540'};
        border-radius: 10px;
        padding: 14px 16px;
        margin-bottom: 10px;
        cursor: pointer;
        transition: border-color 0.15s;
        display: flex;
        align-items: center;
        gap: 12px;
        min-height: 108px;
      ">
        <div style="
          width: 64px;
          background: #5da9ff22;
          border: 1px solid #5da9ff44;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
          flex-shrink: 0;
        ">
          <canvas
            id="overview-sprite-pc-terminal"
            width="32" height="32"
            style="image-rendering: pixelated; width: 48px; height: 48px; display: block;"
          ></canvas>
        </div>
        <div style="min-width: 0;">
          <div style="font-weight: bold; color: #dde; font-size: ${t.cardTitle};">PC TERMINAL</div>
          <div style="color: #778; font-size: ${t.cardDescription}; margin-top: 2px;">Local shell</div>
        </div>
      </div>
    `;

    for (const agent of agents) {
      const liveStatus = office?.agents.get(agent.id);
      const tools = agentTools.get(agent.id) || [];

      // Canonical status presentation (shared across badge, dashboards, notifications).
      // The primary label stays concise (e.g. "Thinking"); any activity detail is
      // shown separately so it cannot change the card height.
      const statusPres = STATUS_PRESENTATION[resolveStatusKey(liveStatus)];
      const statusDot = statusPres.colorHex;
      const statusLabel = statusPres.label;
      const statusIcon = statusPres.icon;
      // FR-011/FR-015: the "what it's doing" detail is rendered on its own fixed
      // slot (never concatenated into the label), so it cannot grow the card.
      const activityDetail = describeActivity(liveStatus);
      const activityDetailEsc = activityDetail.replace(/"/g, '&quot;');

      const colorHex = '#' + agent.color.toString(16).padStart(6, '0');
      const isSelected = agent.id === selectedAgentId;
      const borderColor = isSelected ? '#6677ff' : '#252540';
      const bgColor = isSelected ? '#1e1e3a' : '#13131f';
      const unread = liveStatus?.unreadCount || 0;
      const elapsed = liveStatus?.activityStartTime ? formatElapsed(liveStatus.activityStartTime) : '';
      const toolCount = tools.length;
      const recentActions = liveStatus?.recentActions || [];
      const taskSummary = liveStatus?.taskSummary || '';
      const isActive = liveStatus?.state === 'active' && liveStatus?.subState !== 'ready' && liveStatus?.subState !== 'error';

      // Badge HTML (unread count)
      const badgeHtml = unread > 0 ? `
        <div style="
          position: absolute; top: -4px; right: -4px;
          background: #e55; color: #fff;
          font-size: ${t.badge}; font-weight: bold;
          min-width: 18px; height: 18px;
          border-radius: 9px;
          display: flex; align-items: center; justify-content: center;
          padding: 0 4px;
          box-shadow: 0 1px 4px rgba(0,0,0,0.4);
        ">${unread}</div>` : '';

      // Elapsed and queued tools are shown inside the status panel under the sprite.
      const elapsedHtml = elapsed ? `<div data-elapsed-agent="${agent.id}" style="color: #8a8; font-size: ${t.elapsed}; margin-top: 4px;">⏱ ${elapsed}</div>` : '';
      const queueHtml = toolCount > 1 ? `<div style="
        background: #334; color: #aac; font-size: ${t.queue};
        padding: 2px 8px; border-radius: 8px; margin-top: 4px;
      ">${toolCount} tools queued</div>` : '';

      // ── Tool Pipeline Section ──
      let toolPipelineHtml = '';
      if (tools.length > 0) {
        const toolRows = tools.map((tool, i) => {
          const isLast = i === tools.length - 1;
          const icon = isLast ? '▸' : '◦';
          const color = isLast ? '#8af' : '#556';
          const statusText = isLast ? tool.status : '(queued)';
          return `<div style="font-size: ${t.toolRow}; color: ${color}; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; padding: 1px 0;">
            ${icon} <span style="color: #9ab;">${tool.name}</span> <span style="color: #556;">— ${statusText}</span>
          </div>`;
        }).join('');
        toolPipelineHtml = `
          <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #1a1a30;">
            ${toolRows}
          </div>`;
      }

      // ── Recent Activity Log ──
      let activityLogHtml = '';
      const completedActions = recentActions.filter(a => a.type === 'completed').slice(-5).reverse();
      if (completedActions.length > 0) {
        const rows = completedActions.map(a => {
          const relTime = formatRelativeTime(a.timestamp);
          return `<div style="display: flex; gap: 8px; font-size: ${t.activityRow}; padding: 1px 0;" data-action-ts="${a.timestamp}">
            <span style="color: #445; flex-shrink: 0; min-width: 48px; text-align: right;">${relTime}</span>
            <span style="color: #5a5a7a;">✓ ${a.action}</span>
          </div>`;
        }).join('');
        activityLogHtml = `
          <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #1a1a30;">
            <div style="font-size: ${t.sectionLabel}; color: #3a3a5a; margin-bottom: 3px; text-transform: uppercase; letter-spacing: 0.5px;">Recent Activity</div>
            ${rows}
          </div>`;
      } else if (liveStatus?.state !== 'slacking') {
        activityLogHtml = `
          <div style="margin-top: 6px; padding-top: 6px; border-top: 1px solid #1a1a30;">
            <div style="font-size: ${t.emptyState}; color: #333; font-style: italic;">No recent activity</div>
          </div>`;
      }

      // ── Task Summary ──
      const taskSummaryHtml = taskSummary && isActive ? `
        <div style="font-size: ${t.taskSummary}; color: #667; margin-top: 4px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">
          📋 ${taskSummary}
        </div>` : '';

      // ── Session Metadata Panel (right side) ──
      const meta = cachedSessionMeta[agent.id];
      const hasSession = liveStatus?.state === 'active';
      const metaTitle = meta?.title || '';
      const metaSessionId = meta?.sessionId || '';
      const sessionIdBadgeHtml = metaSessionId
        ? `<div class="session-id-badge" data-agent="${agent.id}" data-session-id="${metaSessionId}" title="Click to copy: ${metaSessionId}" style="
            display: inline-block; align-self: flex-start;
            font-family: ui-monospace, Menlo, Consolas, monospace;
            font-size: 10px; color: #8ec3ff;
            background: #1a2030; border: 1px solid #2a3550;
            padding: 1px 6px; border-radius: 3px;
            cursor: pointer; user-select: text;
            max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          ">${metaSessionId}</div>`
        : '';
      const sessionPanelHtml = hasSession ? `
        <div class="session-meta-panel" data-agent="${agent.id}" style="
          flex: 2; min-width: 0;
          border-left: 1px solid #252540;
          padding-left: 14px;
          display: flex; flex-direction: column; gap: 6px;
          align-self: stretch;
          justify-content: center;
        ">
          <div style="font-size: ${t.sessionLabel}; color: #3a3a5a; text-transform: uppercase; letter-spacing: 0.5px;">Session Info</div>
          <div class="session-title-display" data-agent="${agent.id}" style="
            font-weight: bold; color: ${metaTitle ? '#ccd' : '#444'}; font-size: ${t.sessionTitleLg};
            cursor: text; min-height: 18px; line-height: 1.4;
            overflow: hidden; text-overflow: ellipsis;
            display: -webkit-box; -webkit-line-clamp: 3; -webkit-box-orient: vertical;
          " title="${metaTitle ? metaTitle.replace(/"/g, '&quot;') : 'Click to set title'}">${metaTitle || 'Untitled session'}</div>
          ${sessionIdBadgeHtml}
          <button class="session-new-btn ui-btn ui-btn--primary" data-agent="${agent.id}" style="
            margin-top: 2px; align-self: flex-start;
          " title="Start a new session for this agent">🔄 New Session</button>
          <button class="session-close-btn ui-btn ui-btn--danger" data-agent="${agent.id}" style="
            align-self: flex-start;
          " title="Close this agent's session (agent returns to slacking)">✖ Close Session</button>
          ${teamsEnabled ? `<button class="session-teams-btn ui-btn ${teamsOnline.has(agent.id) ? 'ui-btn--teams-online' : 'ui-btn--teams'}" data-agent="${agent.id}" style="
            align-self: flex-start;
          " title="${teamsOnline.has(agent.id) ? 'Take this agent offline in Teams' : 'Bring this agent online in a Teams channel thread'}">${teamsLabel(teamsOnline.has(agent.id) ? 'Teams Online' : 'Teams Remote')}</button>` : ''}
          <div style="display: flex; justify-content: flex-end;">
            <button class="session-edit-btn ui-btn ui-btn--ghost" data-agent="${agent.id}" style="
              padding: 5px 9px;
            " title="Edit session title">✏️</button>
          </div>
        </div>
      ` : `
        <div style="
          flex: 2; min-width: 0;
          border-left: 1px solid #1a1a30;
          padding-left: 14px;
          display: flex; flex-direction: column;
          align-self: stretch;
          justify-content: center;
          opacity: 0.4;
        ">
          <div style="font-size: ${t.emptyState}; color: #444; font-style: italic;">No active session</div>
        </div>
      `;

      html += `
        <div class="agent-card" data-agent="${agent.id}" style="
          background: ${bgColor};
          border: 1.5px solid ${borderColor};
          border-radius: 10px;
          padding: 20px 18px;
          margin-bottom: 10px;
          cursor: pointer;
          transition: border-color 0.15s;
          display: flex;
          align-items: flex-start;
          gap: 14px;
          position: relative;
          min-height: 236px;
        ">
          ${badgeHtml}
          <div style="flex-shrink: 0; width: 96px; display: flex; flex-direction: column; align-items: stretch; gap: 10px;">
            <div style="
              width: 96px;
              background: ${colorHex}22;
              border: 1px solid ${colorHex}44;
              border-radius: 10px;
              display: flex;
              align-items: center;
              justify-content: center;
              overflow: hidden;
              align-self: flex-start;
              padding: 6px 0;
            ">
              <canvas
                id="overview-sprite-${agent.id}"
                width="32" height="34"
                style="image-rendering: pixelated; width: 72px; height: 76px; display: block;"
              ></canvas>
            </div>
            <div style="
              border: 1px solid ${statusDot}66;
              background: ${statusDot}22;
              border-radius: 10px;
              padding: 8px 6px;
              display: flex;
              flex-direction: column;
              align-items: center;
              text-align: center;
              min-height: 96px;
              justify-content: center;
            ">
              <div style="font-size: ${t.statusPanelIcon}; line-height: 1;">${statusIcon}</div>
              <div style="
                margin-top: 6px;
                font-size: ${t.statusPanelText};
                color: ${statusDot};
                line-height: 1.15;
                font-weight: 700;
                white-space: normal;
                word-break: break-word;
              ">${statusLabel}</div>
              ${elapsedHtml}
              ${queueHtml}
            </div>
          </div>
          <div style="flex: 3; min-width: 0; display: flex; flex-direction: column; gap: 4px;">
            <div>
              <div style="font-weight: bold; color: #dde; font-size: ${t.cardTitleLg};">${agent.name}</div>
              <div style="color: #778; font-size: ${t.cardDescription}; margin-top: 3px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${agent.description}</div>
            </div>
            <div data-activity-detail-agent="${agent.id}" style="
              height: 18px; line-height: 18px;
              font-size: ${t.taskSummary}; color: #7f88b0;
              white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
            " title="${activityDetailEsc}">${activityDetail}</div>
            <div>
              ${taskSummaryHtml}
            </div>
            ${toolPipelineHtml}
            ${activityLogHtml}
          </div>
          ${sessionPanelHtml}
        </div>
      `;
    }

    return html;
  },
};
