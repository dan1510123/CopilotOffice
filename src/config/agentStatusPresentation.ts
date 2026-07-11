// Canonical agent-status presentation — the single source of truth for how each
// agent status is shown across ALL surfaces (Phaser sprite badge, the Default and
// Fleet dashboards, and status-bearing notifications).
//
// Spec 014 (Agent Status Tracking Revamp): before this module, each surface kept
// its own label/color/icon table, which drifted (e.g. `thinking` showed 🧠 on the
// badge but ⚡ on the dashboards). Every surface MUST derive its presentation from
// `STATUS_PRESENTATION[resolveStatusKey(status)]` so they can no longer diverge.
//
// This module is renderer-agnostic: no DOM, no Phaser imports. Pure functions +
// data so it can be unit-tested in isolation.

import type { AgentStatus } from '../office/officeManager';

/**
 * The set of presentation keys. This is a superset of `ActiveSubState`: it adds the
 * derived `done` key (a `ready` agent whose completion is unacknowledged) and the
 * idle `slacking` key. It intentionally does NOT change the underlying state model
 * in `officeManager.ts` — `done` and `slacking` are presentation-only folds.
 */
export type StatusKey =
  | 'slacking'
  | 'starting'
  | 'ready'
  | 'done'
  | 'waiting'
  | 'thinking'
  | 'error';

export interface StatusPresentation {
  readonly key: StatusKey;
  /** Canonical human-readable name, identical on every surface. */
  readonly label: string;
  /** Compact form for tight surfaces (badge tooltips, narrow cards). */
  readonly shortLabel: string;
  /** DOM color (dashboards, notifications). */
  readonly colorHex: string;
  /** Phaser badge fill color. */
  readonly colorNum: number;
  /** Phaser badge stroke color. */
  readonly strokeNum: number;
  /** Single canonical icon/emoji shared by all surfaces. */
  readonly icon: string;
  /** Badge motion for this key. */
  readonly badgeAnimation: 'none' | 'pulse';
  /** True for in-progress keys — eligible for the live timer and stall detection. */
  readonly isActive: boolean;
}

/**
 * Canonical presentation table. Every value `resolveStatusKey` can return MUST have
 * an entry here (enforced by unit test). Colors mirror the pre-revamp values so the
 * visual language is preserved; the fix is that they now live in ONE place.
 */
export const STATUS_PRESENTATION: Record<StatusKey, StatusPresentation> = {
  slacking: {
    key: 'slacking',
    label: 'Slacking',
    shortLabel: 'Slacking',
    colorHex: '#555555',
    colorNum: 0x555555,
    strokeNum: 0x666666,
    icon: '💤',
    badgeAnimation: 'none',
    isActive: false,
  },
  starting: {
    key: 'starting',
    label: 'Starting…',
    shortLabel: 'Starting',
    colorHex: '#ff9944',
    colorNum: 0xff9944,
    strokeNum: 0xffbb66,
    icon: '🚀',
    badgeAnimation: 'pulse',
    isActive: true,
  },
  ready: {
    key: 'ready',
    label: 'Ready',
    shortLabel: 'Ready',
    colorHex: '#ffffff',
    colorNum: 0xffffff,
    strokeNum: 0xdddddd,
    icon: '📭',
    badgeAnimation: 'none',
    isActive: false,
  },
  done: {
    key: 'done',
    label: 'Done',
    shortLabel: 'Done',
    colorHex: '#4a78ff',
    colorNum: 0x4a78ff,
    strokeNum: 0x6b90ff,
    icon: '📬',
    badgeAnimation: 'none',
    isActive: false,
  },
  waiting: {
    key: 'waiting',
    label: 'Waiting for input',
    shortLabel: 'Waiting',
    colorHex: '#ffb86c',
    colorNum: 0xffb86c,
    strokeNum: 0xffcc88,
    icon: '⏳',
    badgeAnimation: 'none',
    isActive: true,
  },
  thinking: {
    key: 'thinking',
    label: 'Thinking…',
    shortLabel: 'Thinking…',
    colorHex: '#50fa7b',
    colorNum: 0x50fa7b,
    strokeNum: 0x66ff99,
    icon: '🧠',
    badgeAnimation: 'pulse',
    isActive: true,
  },
  error: {
    key: 'error',
    label: 'Error',
    shortLabel: 'Error',
    colorHex: '#ff4444',
    colorNum: 0xff4444,
    strokeNum: 0xff6666,
    icon: '❌',
    badgeAnimation: 'none',
    isActive: true,
  },
};

/**
 * The threshold after which an agent that has stayed in the same active state with
 * no progress is flagged as a possible stall (spec 014 clarification Q2).
 */
export const STALL_THRESHOLD_MS = 60_000;

/** Target bounded delay for displayed status to reflect a state change (SC-005). */
export const STATUS_DELAY_TARGET_MS = 1_000;

/** Amber stall treatment layered over an active state's base color. */
const STALL_COLOR_HEX = '#ffb020';
const STALL_COLOR_NUM = 0xffb020;
const STALL_STROKE_NUM = 0xffc857;

export interface StallInfo {
  readonly isStalled: boolean;
  readonly stallColorHex: string;
  readonly stallColorNum: number;
  readonly stallStrokeNum: number;
}

const NOT_STALLED: StallInfo = {
  isStalled: false,
  stallColorHex: STALL_COLOR_HEX,
  stallColorNum: STALL_COLOR_NUM,
  stallStrokeNum: STALL_STROKE_NUM,
};

/**
 * Resolve an `AgentStatus` to its canonical presentation key. This is the ONE place
 * that folds `ready + completionPendingAck` into `done` and idle into `slacking`;
 * replaces the three inline `switch` blocks that previously drifted.
 *
 * Note: the `ask_user` race-guard lives upstream in `util/toolStatus.ts`; by the time
 * a status reaches here, `subState === 'waiting'` already reflects that guard, so we
 * simply honor it.
 */
export function resolveStatusKey(
  status: Pick<AgentStatus, 'state' | 'subState' | 'completionPendingAck'> | undefined | null
): StatusKey {
  if (!status || status.state === 'slacking') return 'slacking';

  switch (status.subState) {
    case 'starting':
      return 'starting';
    case 'ready':
      return status.completionPendingAck ? 'done' : 'ready';
    case 'waiting':
      return 'waiting';
    case 'thinking':
      return 'thinking';
    case 'error':
      return 'error';
    default:
      // Defensive: active with null/unknown subState — treat as slacking rather
      // than inventing a state.
      return 'slacking';
  }
}

/** Convenience: the full presentation record for a status. */
export function presentationFor(status: AgentStatus | undefined | null): StatusPresentation {
  return STATUS_PRESENTATION[resolveStatusKey(status)];
}

/**
 * Compute whether an agent is in a possible-stall condition. Stall is a derived
 * *decoration* on the existing active state — NOT a new state — so the base key
 * stays stable (spec 014 clarification Q4).
 *
 * An agent is stalled when it is in an active presentation state and has been in
 * that state (per `activityStartTime`) for at least `STALL_THRESHOLD_MS`. `error`
 * is active for timer purposes but is a terminal signal, not a stall, so it is
 * excluded here.
 */
export function computeStall(
  status: AgentStatus | undefined | null,
  now: number = Date.now()
): StallInfo {
  if (!status || !status.activityStartTime) return NOT_STALLED;
  const key = resolveStatusKey(status);
  const pres = STATUS_PRESENTATION[key];
  if (!pres.isActive || key === 'error') return NOT_STALLED;
  if (now - status.activityStartTime < STALL_THRESHOLD_MS) return NOT_STALLED;
  return {
    isStalled: true,
    stallColorHex: STALL_COLOR_HEX,
    stallColorNum: STALL_COLOR_NUM,
    stallStrokeNum: STALL_STROKE_NUM,
  };
}

/**
 * Human-readable description of what an active agent is currently doing. Used ONLY
 * for a secondary detail line / tooltip — never concatenated into the primary label
 * (which must stay the concise state name so dashboard cards keep a fixed height).
 *
 * `thinking` is intentionally excluded: its label already reads "Thinking…" and the
 * per-step tool/process detail was noisy churn on the card, so thinking shows the
 * single-line label with no secondary detail (spec 014 follow-up).
 */
export function describeActivity(status: AgentStatus | undefined | null): string {
  if (!status) return '';
  // Only waiting/starting expose a "what it's doing" detail. thinking (label says it
  // all) and ready/done/error/slacking return '' so the fixed detail slot stays blank.
  const key = resolveStatusKey(status);
  if (key !== 'waiting' && key !== 'starting') return '';
  const detail = status.thinkingDetail?.trim();
  if (detail) return detail;
  const tool = status.currentTool?.trim();
  if (tool) return friendlyToolName(tool);
  return key === 'waiting' ? 'Waiting for your answer' : 'Working…';
}

function friendlyToolName(tool: string): string {
  const normalized = tool.trim().toLowerCase();
  const map: Record<string, string> = {
    ask_user: 'Waiting for your answer',
    edit: 'Editing a file',
    create: 'Creating a file',
    view: 'Reading a file',
    grep: 'Searching',
    glob: 'Finding files',
    powershell: 'Running a command',
    bash: 'Running a command',
  };
  return map[normalized] ?? tool;
}

/**
 * Format elapsed time since `startTime` as `m:ss` (e.g. "0:07", "1:23", "12:05").
 * Replaces the previous `"7s" / "1m 23s"` format with a live ticking clock display
 * (spec 014 clarification Q3).
 */
export function formatElapsedMmSs(
  startTime: number | null | undefined,
  now: number = Date.now()
): string {
  if (!startTime) return '';
  const totalSeconds = Math.max(0, Math.floor((now - startTime) / 1000));
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}
