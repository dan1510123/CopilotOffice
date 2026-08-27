import { DashboardRenderer, DashboardRenderContext, DynamicCardRegion, getDashboardTypography, DashboardTypography } from '../types';
import { teamsLabel } from '../../ui/teamsIcon';
import { STATUS_PRESENTATION, resolveStatusKey, describeActivity } from '../../config/agentStatusPresentation';
import type { AgentConfig } from '../../config/agents';

/**
 * Dynamic (activity-driven) fragments of a single agent card. These are the only
 * parts that change as an agent works; keeping them in one place lets both the
 * full render (`renderCards`) and the surgical partial refresh
 * (`renderDynamicRegions`) share identical markup so they can never drift.
 *
 * Deliberately excludes the Session Info panel — that region may host the live,
 * user-focused session-title edit input and must never be rebuilt on activity.
 */
interface AgentCardDynamics {
  colorHex: string;
  statusDot: string;
  cardBorderColor: string;
  cardBg: string;
  badgeInner: string;
  /** Attention banner (Done/Waiting). Empty string when no attention is needed. */
  bannerInner: string;
  /** Glow-ring style fragments — patched in place so a status change survives a title edit. */
  ringBorderColor: string;
  ringBoxShadow: string;
  ringAnimation: string;
  ringOpacity: string;
  /** Compact status pill shown at the right of the header. */
  statusPillInner: string;
  activityDetail: string;
  activityDetailEsc: string;
  dynamicBlockInner: string;
}

/** Builds the activity-driven fragments shared by full and partial rendering. */
function buildAgentDynamics(
  agent: AgentConfig,
  ctx: DashboardRenderContext,
  t: DashboardTypography,
): AgentCardDynamics {
  const { office, selectedAgentId, agentTools, formatElapsed, formatRelativeTime } = ctx;
  const liveStatus = office?.agents.get(agent.id);
  const tools = agentTools.get(agent.id) || [];

  // Canonical status presentation (shared across badge, dashboards, notifications).
  const statusKey = resolveStatusKey(liveStatus);
  const statusPres = STATUS_PRESENTATION[statusKey];
  const statusDot = statusPres.colorHex;
  const statusLabel = statusPres.label;
  const isPulse = statusPres.badgeAnimation === 'pulse'; // thinking / starting
  // Done + Waiting are the two "your turn" states — they share one loud visual
  // language (banner + solid border + wash) distinct from working/idle.
  const isAttention = statusKey === 'done' || statusKey === 'waiting';
  // FR-011/FR-015: the "what it's doing" detail is rendered on its own fixed
  // slot (never concatenated into the label), so it cannot grow the card.
  // The bottom "Now doing" line shows the single most recent activity: the live
  // detail (waiting/starting) when present, otherwise the latest completed action
  // (e.g. "✓ powershell"). thinking exposes no live detail, so this keeps the
  // line meaningful without the separate middle activity block.
  const liveDetail = describeActivity(liveStatus);
  const lastCompleted = (liveStatus?.recentActions || [])
    .filter(a => a.type === 'completed')
    .slice(-1)[0];
  const activityDetail = liveDetail || (lastCompleted ? `✓ ${lastCompleted.action}` : '');
  const activityDetailEsc = activityDetail.replace(/"/g, '&quot;');

  const colorHex = '#' + agent.color.toString(16).padStart(6, '0');
  const isSelected = agent.id === selectedAgentId;
  // Selection wins the border; otherwise attention paints it solid in the status color.
  const cardBorderColor = isSelected
    ? 'var(--co-sel-border)'
    : (isAttention ? statusDot : 'var(--co-border-subtle)');
  const cardBg = isAttention
    ? `linear-gradient(115deg, ${statusDot}18 0%, var(--co-bg-card) 45%), var(--co-bg-card)`
    : (isSelected ? 'var(--co-bg-card-sel)' : 'var(--co-bg-card)');
  const elapsed = liveStatus?.activityStartTime ? formatElapsed(liveStatus.activityStartTime) : '';
  const toolCount = tools.length;

  // ── Glow-ring (avatar surround). Pulses while working; a slower pulse signals
  // attention; otherwise dimmed and still. ──
  const ringBorderColor = statusDot;
  const ringBoxShadow = `0 0 14px -2px ${statusDot}`;
  const ringAnimation = isPulse
    ? 'copilot-ring-pulse 1.8s ease-in-out infinite'
    : (isAttention ? 'copilot-ring-pulse 1.5s ease-in-out infinite' : 'none');
  const ringOpacity = (isPulse || isAttention) ? '1' : '0.5';

  // ── Attention banner (signal only — the whole card remains the click target,
  // which already opens the session to review output / reply). ──
  let bannerInner = '';
  if (isAttention) {
    const bannerText = statusKey === 'done'
      ? 'DONE — open to review the output'
      : 'NEEDS YOU — reply to unblock this agent';
    bannerInner = `
        <div style="
          background: linear-gradient(90deg, ${statusDot}, ${statusDot}55);
          color: #0c0c16; font-size: 11px; font-weight: 800; letter-spacing: 0.4px;
          padding: 6px 16px; display: flex; align-items: center; gap: 8px;
          animation: copilot-attn-bar 2s ease-in-out infinite;
        "><span style="font-size: 13px;">${statusPres.icon}</span>${bannerText}</div>`;
  }

  // Badge (unread count) — DISABLED for now: the Done/Waiting status pill and the
  // attention banner already signal "needs you", so the red badge was redundant.
  // The empty slot wrapper is still emitted (see renderCards) so it can be
  // re-enabled later without markup churn.
  const badgeInner = '';

  // ── Compact status pill (header right). The live elapsed timer keeps its own
  // `data-elapsed-agent` element so the per-second ticker can patch it. ──
  const elapsedSpan = elapsed
    ? ` <span style="opacity: 0.5;">·</span> <span data-elapsed-agent="${agent.id}">⏱ ${elapsed}</span>`
    : '';
  const queueSpan = toolCount > 1
    ? ` <span style="opacity: 0.5;">·</span> ${toolCount} tools`
    : '';
  // ── Status pill (header right). Bigger + pulsing for the states where the
  // user should act (waiting/done) or is actively watching (thinking/starting),
  // so "action needed" reads at a glance. The live elapsed timer keeps its own
  // `data-elapsed-agent` element so the per-second ticker can patch it. ──
  const pillFont = isAttention ? `calc(${t.statusText} + 2px)` : `calc(${t.statusText} + 1px)`;
  const pillPad = isAttention ? '8px 16px' : '6px 13px';
  const pillIconSize = isAttention ? '17px' : '15px';
  const pillAnim = isAttention
    ? `animation: copilot-pill-pulse 1.25s ease-in-out infinite; box-shadow: 0 0 14px -2px ${statusDot};`
    : (isPulse ? 'animation: copilot-pill-pulse 1.9s ease-in-out infinite;' : '');
  const statusPillInner = `
        <span style="
          display: inline-flex; align-items: center; gap: 7px; transform-origin: center;
          font-size: ${pillFont}; font-weight: 800; line-height: 1;
          padding: ${pillPad}; border-radius: 999px; white-space: nowrap;
          background: ${statusDot}1f; color: ${statusDot}; border: 1.5px solid ${statusDot}77;
          ${pillAnim}
        ">
          <span style="font-size: ${pillIconSize}; line-height: 1;">${statusPres.icon}</span>
          ${statusLabel}${elapsedSpan}${queueSpan}
        </span>`;

  // ── Dynamic block ── (intentionally empty: the single most recent activity now
  // lives in the footer "Now doing" line, so there is no separate middle block of
  // task summary / tool pipeline / recent-activity that could crowd the card).
  // The wrapper + dynamic region are kept so surfaces can re-enable content later.
  const dynamicBlockInner = '';

  return {
    colorHex,
    statusDot,
    cardBorderColor,
    cardBg,
    badgeInner,
    bannerInner,
    ringBorderColor,
    ringBoxShadow,
    ringAnimation,
    ringOpacity,
    statusPillInner,
    activityDetail,
    activityDetailEsc,
    dynamicBlockInner,
  };
}

/**
 * Dashboard renderer for the default (main) office layout.
 * Renders full agent cards with status, tools, activity, and session metadata.
 */
export const defaultDashboard: DashboardRenderer = {
  renderCards(ctx: DashboardRenderContext): string {
    const { agents, office, selectedAgentId, cachedSessionMeta } = ctx;
    const teamsEnabled = ctx.teamsEnabled ?? false;
    const teamsOnline = ctx.teamsOnlineAgentIds ?? new Set<string>();
    const t = getDashboardTypography();
    let html = '';

    const pcCardSelected = selectedAgentId === 'pc-terminal';
    html += `
      <div class="agent-card" data-agent="pc-terminal" style="
        background: ${pcCardSelected ? 'var(--co-bg-card-sel)' : 'var(--co-bg-card)'};
        border: 1.5px solid ${pcCardSelected ? 'var(--co-sel-border)' : 'var(--co-border-subtle)'};
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
          background: var(--co-pc-sprite-bg);
          border: 1px solid var(--co-pc-sprite-border);
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
          <div style="font-weight: bold; color: var(--co-text-strong); font-size: ${t.cardTitle};">PC TERMINAL</div>
          <div style="color: var(--co-text-muted); font-size: ${t.cardDescription}; margin-top: 2px;">Local shell</div>
        </div>
      </div>
    `;

    for (const agent of agents) {
      const liveStatus = office?.agents.get(agent.id);
      const d = buildAgentDynamics(agent, ctx, t);

      // ── Session Metadata Panel (right side) ──
      const meta = cachedSessionMeta[agent.id];
      const hasSession = liveStatus?.state === 'active';
      const metaTitle = meta?.title || '';
      const metaSessionId = meta?.sessionId || '';
      // The title chip persists on cached session meta, decoupled from the live
      // `hasSession` gate: when a task completes and the PTY exits the agent flips
      // to 'slacking', but the user should still see the session title (and be able
      // to click it) until they open the terminal or start a new session. Gating on
      // live state made the chip flash out and vanish on completion.
      const showTitleChip = hasSession || !!metaTitle || !!metaSessionId;
      const sessionIdBadgeHtml = metaSessionId
        ? `<div class="session-id-badge" data-agent="${agent.id}" data-session-id="${metaSessionId}" title="Click to copy: ${metaSessionId}" style="
            display: inline-flex; align-items: center; align-self: flex-start;
            font-family: ui-monospace, Menlo, Consolas, monospace;
            font-size: 10px; color: var(--co-accent-link);
            background: var(--co-bg-badge-inset); border: 1px solid var(--co-border-badge-inset);
            padding: 2px 7px; border-radius: 4px;
            cursor: pointer; user-select: text;
            max-width: 100%; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          ">${metaSessionId}</div>`
        : '';
      const titleChipHtml = showTitleChip ? `
        <span class="session-title-display" data-agent="${agent.id}" title="${metaTitle ? metaTitle.replace(/"/g, '&quot;') : 'Click to set a session title'}" style="
          display: inline-flex; align-items: flex-start; gap: 6px;
          flex: 0 1 auto; min-width: 0; max-width: 100%;
          font-weight: 700; font-size: ${t.sessionTitleLg}; line-height: 1.3;
          color: ${metaTitle ? 'var(--co-text)' : 'var(--co-text-faint)'};
          background: var(--co-bg-badge-inset); border: 1px solid var(--co-border-subtle);
          padding: 4px 11px; border-radius: 8px; cursor: text; overflow: hidden;
          ${metaTitle ? '' : 'font-style: italic;'}
        ">📝 <span style="min-width: 0; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow-wrap: anywhere;">${metaTitle || 'Untitled session'}</span></span>` : '';

      const sessionPanelHtml = hasSession ? `
        <div class="session-meta-panel" data-agent="${agent.id}" style="
          margin-top: 13px; padding-top: 13px;
          border-top: 1px solid ${d.statusDot}1e;
          display: flex; align-items: center; gap: 14px;
        ">
          <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 5px;">
            <div style="font-size: ${t.sessionLabel}; color: var(--co-text-faint); text-transform: uppercase; letter-spacing: 0.5px;">Now doing</div>
            <div data-activity-detail-agent="${agent.id}" style="
              height: 18px; line-height: 18px;
              font-size: ${t.taskSummary}; color: var(--co-text-secondary);
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            " title="${d.activityDetailEsc}">${d.activityDetail}</div>
            ${sessionIdBadgeHtml}
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            <button class="session-new-btn ui-btn ui-btn--primary" data-agent="${agent.id}"
              title="Start a new session for this agent">🔄 New Session</button>
            <button class="session-close-btn ui-btn ui-btn--danger" data-agent="${agent.id}"
              title="Close this agent's session (agent returns to slacking)">✖ Close Session</button>
            ${teamsEnabled ? `<button class="session-teams-btn ui-btn ${teamsOnline.has(agent.id) ? 'ui-btn--teams-online' : 'ui-btn--teams'}" data-agent="${agent.id}"
              title="${teamsOnline.has(agent.id) ? 'Take this agent offline in Teams' : 'Bring this agent online in a Teams channel thread'}">${teamsLabel(teamsOnline.has(agent.id) ? 'Teams Online' : 'Teams Remote')}</button>` : ''}
            <button class="session-edit-btn ui-btn ui-btn--ghost" data-agent="${agent.id}" style="
              padding: 5px 9px;
            " title="Edit session title">✏️</button>
          </div>
        </div>
      ` : `
        <div style="
          margin-top: 13px; padding-top: 13px;
          border-top: 1px solid var(--co-bg-divider);
        ">
          <div style="font-size: ${t.sessionLabel}; color: var(--co-text-faint); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">Status</div>
          <div data-activity-detail-agent="${agent.id}" style="
            height: 18px; line-height: 18px;
            font-size: ${t.taskSummary}; color: var(--co-text-faint); font-style: italic;
            overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
          " title="${d.activityDetailEsc}">${d.activityDetail || 'No active session'}</div>
        </div>
      `;

      html += `
        <div class="agent-card" data-agent="${agent.id}" style="
          background: ${d.cardBg};
          border: 1.5px solid ${d.cardBorderColor};
          border-radius: 13px;
          margin-bottom: 10px;
          cursor: pointer;
          transition: border-color 0.15s;
          position: relative;
          overflow: hidden;
          height: 208px;
          display: flex;
          flex-direction: column;
        ">
          <div data-attn-banner-agent="${agent.id}" style="flex: 0 0 auto;">${d.bannerInner}</div>
          <div data-badge-slot-agent="${agent.id}" style="position: absolute; top: 8px; right: 8px; z-index: 3;">${d.badgeInner}</div>
          <div style="padding: 15px 17px; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; overflow: hidden;">
            <div style="flex: 1 1 auto; min-height: 0; display: flex; flex-direction: column; justify-content: center; overflow: hidden;">
              <div style="display: flex; align-items: center; gap: 16px; flex: 0 0 auto;">
              <div style="display: flex; flex-direction: column; align-items: center; gap: 6px; flex-shrink: 0; width: 72px;">
                <div style="position: relative; width: 56px; height: 56px;">
                  <div data-ring-agent="${agent.id}" style="
                    position: absolute; inset: 0; border-radius: 50%;
                    border: 2px solid ${d.ringBorderColor};
                    box-shadow: ${d.ringBoxShadow};
                    animation: ${d.ringAnimation};
                    opacity: ${d.ringOpacity};
                  "></div>
                  <div style="
                    position: absolute; inset: 5px; border-radius: 12px;
                    background: ${d.colorHex}22;
                    display: flex; align-items: center; justify-content: center; overflow: hidden;
                  ">
                    <canvas
                      id="overview-sprite-${agent.id}"
                      width="32" height="34"
                      style="image-rendering: pixelated; width: 40px; height: 42px; display: block;"
                    ></canvas>
                  </div>
                </div>
                <span style="
                  font-weight: 800; color: var(--co-text-strong); font-size: ${t.cardTitle};
                  letter-spacing: 0.2px; max-width: 100%; text-align: center;
                  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
                ">${agent.name}</span>
              </div>
              <div style="flex: 1; min-width: 0;">
                ${titleChipHtml}
              </div>
              <div data-status-panel-agent="${agent.id}" style="flex-shrink: 0;">${d.statusPillInner}</div>
              </div>
            </div>
            <div data-dynamic-agent="${agent.id}" style="display: flex; flex-direction: column; flex: 0 0 auto; max-height: 52px; overflow: hidden;">${d.dynamicBlockInner}</div>
            <div style="flex: 0 0 auto;">${sessionPanelHtml}</div>
          </div>
        </div>
      `;
    }

    return html;
  },

  /**
   * Surgical partial refresh: describes updates for only the activity-driven
   * regions of each already-rendered card. The Session Info panel is never
   * included, so a live session-title edit input survives an activity refresh.
   */
  renderDynamicRegions(ctx: DashboardRenderContext): DynamicCardRegion[] {
    const t = getDashboardTypography();
    const regions: DynamicCardRegion[] = [];
    for (const agent of ctx.agents) {
      const d = buildAgentDynamics(agent, ctx, t);
      regions.push({
        selector: `.agent-card[data-agent="${agent.id}"]`,
        style: { borderColor: d.cardBorderColor, background: d.cardBg },
      });
      regions.push({
        selector: `[data-attn-banner-agent="${agent.id}"]`,
        html: d.bannerInner,
      });
      regions.push({
        selector: `[data-badge-slot-agent="${agent.id}"]`,
        html: d.badgeInner,
      });
      regions.push({
        selector: `[data-ring-agent="${agent.id}"]`,
        style: {
          borderColor: d.ringBorderColor,
          boxShadow: d.ringBoxShadow,
          animation: d.ringAnimation,
          opacity: d.ringOpacity,
        },
      });
      regions.push({
        selector: `[data-status-panel-agent="${agent.id}"]`,
        html: d.statusPillInner,
      });
      regions.push({
        selector: `[data-activity-detail-agent="${agent.id}"]`,
        html: d.activityDetail,
        attrs: { title: d.activityDetailEsc },
      });
      regions.push({
        selector: `[data-dynamic-agent="${agent.id}"]`,
        html: d.dynamicBlockInner,
      });
    }
    return regions;
  },
};
