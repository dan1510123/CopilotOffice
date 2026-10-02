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
  // User-applied "Flagged / Needs attention" marker (orthogonal to status). When
  // set it paints its own amber-gold chrome that takes precedence over the
  // status attention chrome, and adds a flag pill beside the status pill.
  const isFlagged = ctx.flaggedAgentIds?.has(agent.id) ?? false;
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
  // Flag chrome (amber-gold) wins the border/bg over selection + attention so a
  // flagged card always reads as "come back to me". Otherwise selection wins the
  // border; failing that, attention paints it solid in the status color.
  const cardBorderColor = isFlagged
    ? 'var(--co-flag)'
    : (isSelected
        ? 'var(--co-sel-border)'
        : (isAttention ? statusDot : 'var(--co-border-subtle)'));
  const cardBg = isFlagged
    ? `linear-gradient(115deg, color-mix(in srgb, var(--co-flag) 13%, transparent) 0%, ${isSelected ? 'var(--co-bg-card-sel)' : 'var(--co-bg-card)'} 48%), ${isSelected ? 'var(--co-bg-card-sel)' : 'var(--co-bg-card)'}`
    : (isAttention
        ? `linear-gradient(115deg, ${statusDot}18 0%, var(--co-bg-card) 45%), var(--co-bg-card)`
        : (isSelected ? 'var(--co-bg-card-sel)' : 'var(--co-bg-card)'));
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
  // which already opens the session to review output / reply). A user flag takes
  // precedence over the status attention banner (confirmed precedence). ──
  let bannerInner = '';
  if (isFlagged) {
    bannerInner = `
        <div style="
          background: linear-gradient(90deg, var(--co-flag), color-mix(in srgb, var(--co-flag) 30%, transparent));
          color: #0c0c16; font-size: 11px; font-weight: 800; letter-spacing: 0.4px;
          padding: 6px 16px; display: flex; align-items: center; gap: 8px;
          animation: copilot-attn-bar 2s ease-in-out infinite;
        "><span style="font-size: 13px;">🚩</span>FLAGGED · NEEDS ATTENTION</div>`;
  } else if (isAttention) {
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
  // ── Status + flag pills (header right). Emphasis is adaptive so exactly one
  // chip leads:
  //   • When the status itself is an attention state (Done/Waiting), the status
  //     pill leads — bigger + pulsing + glowing — and the flag rides as a compact
  //     secondary marker (so the blue Done chip stays the star).
  //   • When the status is quiet (thinking/ready/slacking/etc.), a present flag
  //     becomes the lead chip — bigger + pulsing + glowing — and the status pill
  //     shrinks to the secondary slot (so after you open a Done agent and it folds
  //     to Ready, the amber Flagged marker is what pops).
  // `flagLeads` is only true when flagged AND the status isn't itself attention.
  const flagLeads = isFlagged && !isAttention;
  // Status pill sizing/emphasis: full when it leads (isAttention), reduced when a
  // flag has taken the lead, default otherwise.
  const statusPillFont = isAttention
    ? `calc(${t.statusText} + 2px)`
    : (flagLeads ? t.statusText : `calc(${t.statusText} + 1px)`);
  const statusPillPad = isAttention ? '8px 16px' : (flagLeads ? '5px 10px' : '6px 13px');
  const statusPillIconSize = isAttention ? '17px' : (flagLeads ? '13px' : '15px');
  const statusPillAnim = isAttention
    ? `animation: copilot-pill-pulse 1.25s ease-in-out infinite; box-shadow: 0 0 14px -2px ${statusDot};`
    : (flagLeads ? '' : (isPulse ? 'animation: copilot-pill-pulse 1.9s ease-in-out infinite;' : ''));
  const statusPill = `
        <span style="
          display: inline-flex; align-items: center; gap: 7px; transform-origin: center;
          font-size: ${statusPillFont}; font-weight: 800; line-height: 1;
          padding: ${statusPillPad}; border-radius: 999px; white-space: nowrap;
          background: ${statusDot}1f; color: ${statusDot}; border: 1.5px solid ${statusDot}77;
          ${statusPillAnim}
        ">
          <span style="font-size: ${statusPillIconSize}; line-height: 1;">${statusPres.icon}</span>
          ${statusLabel}${elapsedSpan}${queueSpan}
        </span>`;
  // Flag pill: full emphasis (bigger + pulsing + glowing) when it leads; compact +
  // quiet when the status pill leads.
  const flagPill = !isFlagged ? '' : (flagLeads ? `
        <span style="
          display: inline-flex; align-items: center; gap: 7px; transform-origin: center;
          font-size: calc(${t.statusText} + 2px); font-weight: 800; line-height: 1;
          padding: 8px 16px; border-radius: 999px; white-space: nowrap;
          background: color-mix(in srgb, var(--co-flag) 18%, transparent);
          color: var(--co-flag); border: 1.5px solid color-mix(in srgb, var(--co-flag) 60%, transparent);
          box-shadow: 0 0 14px -2px var(--co-flag);
          animation: copilot-pill-pulse 1.25s ease-in-out infinite;
        "><span style="font-size: 17px; line-height: 1;">🚩</span>Flagged</span>` : `
        <span style="
          display: inline-flex; align-items: center; gap: 5px; transform-origin: center;
          font-size: ${t.statusText}; font-weight: 800; line-height: 1;
          padding: 5px 10px; border-radius: 999px; white-space: nowrap;
          background: color-mix(in srgb, var(--co-flag) 16%, transparent);
          color: var(--co-flag); border: 1.5px solid color-mix(in srgb, var(--co-flag) 55%, transparent);
        "><span style="font-size: 13px; line-height: 1;">🚩</span>Flagged</span>`);
  // Lead chip first, secondary chip trailing.
  const statusPillInner = `
        <span style="display: inline-flex; align-items: center; gap: 8px;">
        ${flagLeads ? flagPill + statusPill : statusPill + flagPill}
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
    const teamsPending = ctx.teamsPendingActions ?? new Map<string, 'connecting' | 'disconnecting'>();
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
      const isTeamsOnline = teamsOnline.has(agent.id);
      const pendingTeamsAction = teamsPending.get(agent.id);
      const teamsButtonLabel = pendingTeamsAction
        ? `<span class="ui-btn__spinner" aria-hidden="true"></span>${pendingTeamsAction === 'disconnecting' ? 'Disconnecting…' : 'Connecting…'}`
        : teamsLabel(isTeamsOnline ? 'Teams Online' : 'Teams Remote');
      const teamsButtonTitle = pendingTeamsAction
        ? (pendingTeamsAction === 'disconnecting' ? 'Taking this agent offline in Teams' : 'Bringing this agent online in Teams')
        : (isTeamsOnline ? 'Take this agent offline in Teams' : 'Bring this agent online in a Teams channel thread');

      // ── Session Metadata Panel (right side) ──
      const meta = cachedSessionMeta[agent.id];
      const hasSession = liveStatus?.state === 'active';
      const isFlagged = ctx.flaggedAgentIds?.has(agent.id) ?? false;
      // Flag toggle: available whether or not the agent has a live session, so the
      // user can mark a slacking agent to revisit too. The label describes the
      // action (not the state — the pill/banner already say "Flagged"), so it
      // reads "🚩 Flag" when off and "✓ Resolve" (filled gold) when on.
      const flagBtnHtml = `<button class="session-flag-btn ui-btn ${isFlagged ? 'ui-btn--flagged' : 'ui-btn--flag'}" data-agent="${agent.id}"
              title="${isFlagged ? 'Resolve — clear the Needs Attention flag' : 'Flag this agent — Needs attention (come back to it)'}">${isFlagged ? '✓ Resolve' : '🚩 Flag'}</button>`;
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
            display: inline-flex; align-items: center; justify-content: center; text-align: center;
            font-family: ui-monospace, Menlo, Consolas, monospace;
            font-size: 9px; line-height: 1.3; color: var(--co-accent-link);
            background: var(--co-bg-badge-inset); border: 1px solid var(--co-border-badge-inset);
            padding: 3px 6px; border-radius: 4px;
            cursor: pointer; user-select: text;
            max-width: 100%; overflow: hidden; word-break: break-all;
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
          </div>
          <div style="display: flex; align-items: center; gap: 8px; flex-shrink: 0;">
            ${flagBtnHtml}
            <button class="session-new-btn ui-btn ui-btn--primary" data-agent="${agent.id}"
              title="Start a new session for this agent">🔄 New Session</button>
            <button class="session-close-btn ui-btn ui-btn--danger" data-agent="${agent.id}"
              title="Close this agent's session (agent returns to slacking)">✖ Close Session</button>
            ${teamsEnabled ? `<button class="session-teams-btn ui-btn ${isTeamsOnline ? 'ui-btn--teams-online' : 'ui-btn--teams'}" data-agent="${agent.id}"
              title="${teamsButtonTitle}"${pendingTeamsAction ? ' disabled aria-busy="true"' : ''}>${teamsButtonLabel}</button>` : ''}
            <button class="session-edit-btn ui-btn ui-btn--ghost" data-agent="${agent.id}" style="
              padding: 5px 9px;
            " title="Edit session title">✏️</button>
          </div>
        </div>
      ` : `
        <div style="
          margin-top: 13px; padding-top: 13px;
          border-top: 1px solid var(--co-bg-divider);
          display: flex; align-items: center; gap: 14px;
        ">
          <div style="flex: 1; min-width: 0;">
            <div style="font-size: ${t.sessionLabel}; color: var(--co-text-faint); text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 5px;">Status</div>
            <div data-activity-detail-agent="${agent.id}" style="
              height: 18px; line-height: 18px;
              font-size: ${t.taskSummary}; color: var(--co-text-faint); font-style: italic;
              overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
            " title="${d.activityDetailEsc}">${d.activityDetail || 'No active session'}</div>
          </div>
          <div style="display: flex; align-items: center; flex-shrink: 0;">
            ${flagBtnHtml}
          </div>
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
          <div style="padding: 15px 17px; flex: 1 1 auto; min-height: 0; display: flex; flex-direction: row; align-items: stretch; gap: 16px; overflow: hidden;">

            <div style="display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 8px; flex-shrink: 0; width: 88px; border-right: 1px solid ${d.statusDot}1e; padding-right: 14px;">
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

            <div style="flex: 1 1 auto; min-width: 0; display: flex; flex-direction: column; overflow: hidden;">
              <div style="flex: 1 1 auto; min-height: 0; display: flex; align-items: center; gap: 12px; overflow: hidden;">
                <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; align-items: flex-start; gap: 5px;">
                  ${titleChipHtml}
                  ${sessionIdBadgeHtml}
                </div>
                <div data-status-panel-agent="${agent.id}" style="flex-shrink: 0;">${d.statusPillInner}</div>
              </div>
              <div data-dynamic-agent="${agent.id}" style="display: flex; flex-direction: column; flex: 0 0 auto; max-height: 52px; overflow: hidden;">${d.dynamicBlockInner}</div>
              <div style="flex: 0 0 auto;">${sessionPanelHtml}</div>
            </div>
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
