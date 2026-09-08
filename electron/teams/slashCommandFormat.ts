// Formatting helpers for Teams slash-command results.
//
// Pure functions turning a structured `ControlData` payload (from the SDK control plane)
// into escaped, Teams-safe inner HTML. TeamsService prepends the agent label and posts
// via `safeReply`. Kept side-effect-free for unit testing.

import { escapeHtml } from './htmlText';
import { SUPPORTED_COMMANDS } from './slashCommands';
import type { ControlData, ControlCompactData, ControlUsageData, ControlModelData } from '../terminal/protocol';

function num(n: number | undefined): string {
  return typeof n === 'number' && Number.isFinite(n) ? n.toLocaleString('en-US') : '—';
}

/** `/compact` — post the compaction summary and how much was freed. */
export function formatCompact(d: ControlCompactData): string {
  if (!d.success) {
    return '🗜️ <b>Compaction did not run</b> — nothing to compact or it was interrupted.';
  }
  const lines = [
    `🗜️ <b>Context compacted</b> — freed ${escapeHtml(num(d.tokensRemoved))} tokens, removed ${escapeHtml(num(d.messagesRemoved))} messages.`,
  ];
  const summary = (d.summary ?? '').trim();
  if (summary) {
    lines.push(`<br><br><b>Summary</b><br>${escapeHtml(summary).replace(/\n/g, '<br>')}`);
  }
  return lines.join('');
}

/** `/usage` — post cost + token breakdown for the session. */
export function formatUsage(d: ControlUsageData): string {
  const rows: string[] = [];
  rows.push(`<li>Premium request cost: <b>${escapeHtml(num(d.premiumRequestCost))}</b></li>`);
  rows.push(`<li>User requests: <b>${escapeHtml(num(d.userRequests))}</b></li>`);
  if (typeof d.apiDurationMs === 'number') {
    rows.push(`<li>Model API time: <b>${escapeHtml(num(Math.round(d.apiDurationMs / 1000)))}s</b></li>`);
  }
  if (typeof d.totalTokens === 'number') {
    const limit = typeof d.promptTokenLimit === 'number' && d.promptTokenLimit > 0 ? ` / ${escapeHtml(num(d.promptTokenLimit))}` : '';
    rows.push(`<li>Context tokens: <b>${escapeHtml(num(d.totalTokens))}${limit}</b></li>`);
  }
  if (typeof d.compactionThreshold === 'number' && d.compactionThreshold > 0) {
    rows.push(`<li>Auto-compaction at: <b>${escapeHtml(num(d.compactionThreshold))}</b> tokens</li>`);
  }
  return `📊 <b>Session usage</b><ul>${rows.join('')}</ul>`;
}

/** `/model` — post the current model (and a switch confirmation when one happened). */
export function formatModel(d: ControlModelData): string {
  const current = d.current ? escapeHtml(d.current) : '—';
  const effort = d.reasoningEffort ? ` <i>(reasoning: ${escapeHtml(d.reasoningEffort)})</i>` : '';
  if (d.switchedTo) {
    return `🔀 <b>Switched model</b> → <code>${escapeHtml(d.switchedTo)}</code>${effort}`;
  }
  return `🧠 <b>Current model:</b> <code>${current}</code>${effort}`;
}

/** Dispatch on the discriminated `ControlData.kind`. */
export function formatControlData(data: ControlData): string {
  switch (data.kind) {
    case 'compact':
      return formatCompact(data);
    case 'usage':
      return formatUsage(data);
    case 'model':
      return formatModel(data);
    default: {
      const never: never = data;
      return escapeHtml(String(never));
    }
  }
}

/** `/help` — the supported-commands list. */
export function formatHelp(): string {
  const items = SUPPORTED_COMMANDS.map(
    (c) => `<li><code>${escapeHtml(c.name)}</code> — ${escapeHtml(c.desc)}</li>`,
  ).join('');
  return `💡 <b>Teams commands</b><ul>${items}</ul>`;
}
