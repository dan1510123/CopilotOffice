import { describe, expect, it } from 'vitest';
import type { AgentStatus } from '../../../src/office/officeManager';
import {
  STATUS_PRESENTATION,
  STALL_THRESHOLD_MS,
  resolveStatusKey,
  presentationFor,
  computeStall,
  describeActivity,
  formatElapsedMmSs,
  type StatusKey,
} from '../../../src/config/agentStatusPresentation';

/** Build a minimal valid AgentStatus for tests. */
function makeStatus(overrides: Partial<AgentStatus> = {}): AgentStatus {
  return {
    agentId: 'gene',
    state: 'active',
    subState: 'thinking',
    thinkingDetail: null,
    currentTool: null,
    completionPendingAck: false,
    unreadCount: 0,
    lastEvent: null,
    activityStartTime: null,
    lastCompletedAction: null,
    recentActions: [],
    taskSummary: null,
    ...overrides,
  };
}

const ALL_KEYS: StatusKey[] = [
  'slacking', 'starting', 'ready', 'done', 'waiting', 'thinking', 'error',
];

describe('config/agentStatusPresentation — mapping completeness', () => {
  it('has a presentation record for every StatusKey', () => {
    for (const key of ALL_KEYS) {
      expect(STATUS_PRESENTATION[key]).toBeDefined();
      expect(STATUS_PRESENTATION[key].key).toBe(key);
    }
  });

  it('record keys and object keys agree (no orphan/missing entries)', () => {
    expect(Object.keys(STATUS_PRESENTATION).sort()).toEqual([...ALL_KEYS].sort());
  });

  it('gives thinking the same canonical icon everywhere (regression: 🧠 not ⚡)', () => {
    expect(STATUS_PRESENTATION.thinking.icon).toBe('🧠');
  });

  it('marks only in-progress states as active', () => {
    expect(STATUS_PRESENTATION.starting.isActive).toBe(true);
    expect(STATUS_PRESENTATION.thinking.isActive).toBe(true);
    expect(STATUS_PRESENTATION.waiting.isActive).toBe(true);
    expect(STATUS_PRESENTATION.slacking.isActive).toBe(false);
    expect(STATUS_PRESENTATION.ready.isActive).toBe(false);
    expect(STATUS_PRESENTATION.done.isActive).toBe(false);
  });

  it('gives each active state a numeric and hex color that correspond', () => {
    for (const key of ALL_KEYS) {
      const p = STATUS_PRESENTATION[key];
      expect(p.colorHex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(p.colorNum).toBe(parseInt(p.colorHex.slice(1), 16));
    }
  });
});

describe('config/agentStatusPresentation — resolveStatusKey', () => {
  it('resolves undefined/null to slacking', () => {
    expect(resolveStatusKey(undefined)).toBe('slacking');
    expect(resolveStatusKey(null)).toBe('slacking');
  });

  it('resolves a slacking state to slacking regardless of subState', () => {
    expect(resolveStatusKey(makeStatus({ state: 'slacking', subState: null }))).toBe('slacking');
  });

  it('folds ready + completionPendingAck into done', () => {
    expect(resolveStatusKey(makeStatus({ subState: 'ready', completionPendingAck: true }))).toBe('done');
  });

  it('resolves ready without pending ack to ready', () => {
    expect(resolveStatusKey(makeStatus({ subState: 'ready', completionPendingAck: false }))).toBe('ready');
  });

  it('maps the remaining substates directly', () => {
    expect(resolveStatusKey(makeStatus({ subState: 'starting' }))).toBe('starting');
    expect(resolveStatusKey(makeStatus({ subState: 'waiting' }))).toBe('waiting');
    expect(resolveStatusKey(makeStatus({ subState: 'thinking' }))).toBe('thinking');
    expect(resolveStatusKey(makeStatus({ subState: 'error' }))).toBe('error');
  });

  it('defensively resolves active + null subState to slacking', () => {
    expect(resolveStatusKey(makeStatus({ state: 'active', subState: null }))).toBe('slacking');
  });

  it('presentationFor returns the matching record', () => {
    expect(presentationFor(makeStatus({ subState: 'thinking' }))).toBe(STATUS_PRESENTATION.thinking);
  });
});

describe('config/agentStatusPresentation — computeStall', () => {
  const now = 1_000_000;

  it('is not stalled without an activityStartTime', () => {
    expect(computeStall(makeStatus({ subState: 'thinking', activityStartTime: null }), now).isStalled).toBe(false);
  });

  it('is not stalled just before the threshold', () => {
    const start = now - (STALL_THRESHOLD_MS - 1);
    expect(computeStall(makeStatus({ subState: 'thinking', activityStartTime: start }), now).isStalled).toBe(false);
  });

  it('is stalled exactly at the threshold', () => {
    const start = now - STALL_THRESHOLD_MS;
    const stall = computeStall(makeStatus({ subState: 'thinking', activityStartTime: start }), now);
    expect(stall.isStalled).toBe(true);
    expect(stall.stallColorHex).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('does not stall a non-active (ready) state even past the threshold', () => {
    const start = now - STALL_THRESHOLD_MS * 3;
    expect(computeStall(makeStatus({ subState: 'ready', activityStartTime: start }), now).isStalled).toBe(false);
  });

  it('does not treat error as a stall (it is a terminal signal, not a stall)', () => {
    const start = now - STALL_THRESHOLD_MS * 3;
    expect(computeStall(makeStatus({ subState: 'error', activityStartTime: start }), now).isStalled).toBe(false);
  });

  it('clears the stall once the agent leaves the active state', () => {
    const start = now - STALL_THRESHOLD_MS * 2;
    expect(computeStall(makeStatus({ state: 'slacking', subState: null, activityStartTime: start }), now).isStalled).toBe(false);
  });
});

describe('config/agentStatusPresentation — describeActivity', () => {
  it('prefers thinkingDetail', () => {
    expect(describeActivity(makeStatus({ thinkingDetail: 'refactoring util' }))).toBe('refactoring util');
  });

  it('falls back to a friendly tool name', () => {
    expect(describeActivity(makeStatus({ thinkingDetail: null, currentTool: 'edit' }))).toBe('Editing a file');
  });

  it('passes through an unknown tool name', () => {
    expect(describeActivity(makeStatus({ thinkingDetail: null, currentTool: 'customtool' }))).toBe('customtool');
  });

  it('falls back to Working… when nothing is known', () => {
    expect(describeActivity(makeStatus({ thinkingDetail: null, currentTool: null }))).toBe('Working…');
  });
});

describe('config/agentStatusPresentation — formatElapsedMmSs', () => {
  const now = 1_000_000;
  it.each([
    [7, '0:07'],
    [59, '0:59'],
    [60, '1:00'],
    [83, '1:23'],
    [725, '12:05'],
    [0, '0:00'],
  ])('formats %i seconds as %s', (secs, expected) => {
    expect(formatElapsedMmSs(now - secs * 1000, now)).toBe(expected);
  });

  it('returns empty string for a null start time', () => {
    expect(formatElapsedMmSs(null, now)).toBe('');
  });

  it('never returns negative time for a future start', () => {
    expect(formatElapsedMmSs(now + 5000, now)).toBe('0:00');
  });
});
