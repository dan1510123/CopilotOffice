// Teams slash-command registry.
//
// Intercepts a small ALLOW-LIST of Copilot CLI slash commands sent to an online agent
// over Teams and classifies them so TeamsService can execute them via the control plane
// instead of enqueueing the slash text as a model prompt. Anything not on the allow-list
// returns null and falls through to normal prompt dispatch — so skill invocations and
// arbitrary slashes still reach the model untouched.

import type { ControlCommandName } from '../terminal/protocol';

export type SlashCommandKind = 'offline' | 'reset' | 'control' | 'help';

export interface SlashCommand {
  /** Canonical command name without the leading slash (e.g. `compact`). */
  name: string;
  kind: SlashCommandKind;
  /** Set when `kind === 'control'`. */
  control?: ControlCommandName;
  /** Set when `kind === 'reset'`. */
  resetMode?: 'new' | 'clear';
  /** Trailing text after the command token (e.g. a model id, or compaction instructions). */
  args?: string;
}

interface Entry {
  kind: SlashCommandKind;
  control?: ControlCommandName;
  resetMode?: 'new' | 'clear';
}

/** The complete allow-list. Keys are the lowercase command tokens (no slash). */
const REGISTRY: Record<string, Entry> = {
  stop: { kind: 'offline' },
  new: { kind: 'reset', resetMode: 'new' },
  clear: { kind: 'reset', resetMode: 'clear' },
  compact: { kind: 'control', control: 'compact' },
  usage: { kind: 'control', control: 'usage' },
  model: { kind: 'control', control: 'model' },
  help: { kind: 'help' },
};

/** Commands surfaced by `/help`, in display order. */
export const SUPPORTED_COMMANDS: { name: string; desc: string }[] = [
  { name: '/compact', desc: 'Compact the context window and post the summary here' },
  { name: '/usage', desc: 'Show token usage and cost for this session' },
  { name: '/model [id]', desc: 'Show the current model, or switch to [id]' },
  { name: '/new', desc: 'Start a fresh session for this agent' },
  { name: '/clear', desc: 'Clear this session and start fresh' },
  { name: '/stop', desc: 'Take this agent offline in Teams' },
  { name: '/help', desc: 'Show this list' },
];

/**
 * Resolve a Teams message to a known slash command, or null if it is not an
 * allow-listed command (in which case it should be dispatched as a normal prompt).
 *
 * Matching rules: the trimmed message must start with `/`; the first whitespace-
 * delimited token (case-insensitive) must be an allow-listed command; everything after
 * it is captured as `args` (trimmed). A bare `/` or an unknown `/xyz` returns null.
 */
export function resolveSlashCommand(content: string): SlashCommand | null {
  const trimmed = (content ?? '').trim();
  if (!trimmed.startsWith('/')) return null;

  const firstSpace = trimmed.search(/\s/);
  const token = (firstSpace === -1 ? trimmed : trimmed.slice(0, firstSpace)).slice(1).toLowerCase();
  const rest = firstSpace === -1 ? '' : trimmed.slice(firstSpace + 1).trim();

  const entry = REGISTRY[token];
  if (!entry) return null;

  return {
    name: token,
    kind: entry.kind,
    control: entry.control,
    resetMode: entry.resetMode,
    args: rest || undefined,
  };
}
