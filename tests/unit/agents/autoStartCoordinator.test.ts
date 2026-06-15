import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AutoStartCoordinator,
  WarmedOfficeRegistry,
  type AutoStartCoordinatorDeps,
} from '../../../src/agents/AutoStartCoordinator';
import type { AgentAutoStartSettings } from '../../../src/config/agentAutoStart';

interface HarnessOptions {
  settings?: AgentAutoStartSettings;
  currentOfficeId?: string | null;
  roster?: Record<string, string[]>;
  meta?: Record<string, Record<string, { title: string }>>;
  sessionIds?: Record<string, Record<string, string | null>>;
  warmAgentSessionImpl?: (officeId: string, agentId: string) => Promise<void>;
  resetSessionImpl?: (officeId: string, agentId: string) => Promise<void>;
  launchConfig?: { workingDir: string; launchMode: 'copilot' | 'shell' };}

interface Harness {
  coordinator: AutoStartCoordinator;
  deps: AutoStartCoordinatorDeps;
  warmCalls: Array<[string, string]>;
  resetCalls: Array<[string, string]>;
  settings: AgentAutoStartSettings;
}

function buildHarness(opts: HarnessOptions = {}): Harness {
  const settings: AgentAutoStartSettings = opts.settings ?? { autoStartKnownAgents: true };
  const currentOfficeId = opts.currentOfficeId === undefined ? 'office-0' : opts.currentOfficeId;
  const roster = opts.roster ?? {};
  const meta = opts.meta ?? {};
  const sessionIds = opts.sessionIds ?? {};
  const warmCalls: Array<[string, string]> = [];
  const resetCalls: Array<[string, string]> = [];
  const launchConfig = opts.launchConfig ?? { workingDir: '/tmp', launchMode: 'shell' as const };

  const deps: AutoStartCoordinatorDeps = {
    getCurrentOfficeId: () => currentOfficeId,
    getCanonicalAgentIds: (oid) => roster[oid] || [],
    getSessionMeta: async (oid) => meta[oid] || {},
    getCurrentSessionId: async (oid, aid) => (sessionIds[oid] ? sessionIds[oid][aid] ?? null : null),
    getAgentLaunchConfig: () => launchConfig,
    resetSession: async (oid, aid) => {
      resetCalls.push([oid, aid]);
      if (opts.resetSessionImpl) return opts.resetSessionImpl(oid, aid);
    },
    warmAgentSession: async (oid, aid) => {
      warmCalls.push([oid, aid]);
      if (opts.warmAgentSessionImpl) return opts.warmAgentSessionImpl(oid, aid);
    },
    getSettings: () => settings,
  };

  const coordinator = new AutoStartCoordinator(deps);
  return { coordinator, deps, warmCalls, resetCalls, settings };
}

beforeEach(() => {
  try {
    sessionStorage.clear();
    localStorage.clear();
  } catch {
    /* ignore */
  }
});

async function flushMicrotasks(): Promise<void> {
  // Multiple ticks to settle scheduled spawn promises.
  for (let i = 0; i < 5; i++) {
    await Promise.resolve();
  }
}

describe('agents/AutoStartCoordinator — tryWarmCurrentOffice', () => {
  it('FR-018: setting OFF short-circuits to [] without invoking deps', async () => {
    const h = buildHarness({
      settings: { autoStartKnownAgents: false },
      roster: { 'office-0': ['a'] },
      meta: { 'office-0': { a: { title: 'A' } } },
      sessionIds: { 'office-0': { a: 'uuid-a' } },
    });
    const r = await h.coordinator.tryWarmCurrentOffice();
    expect(r).toEqual([]);
    await flushMicrotasks();
    expect(h.warmCalls).toHaveLength(0);
  });

  it('short-circuits when getCurrentOfficeId() is null', async () => {
    const h = buildHarness({
      currentOfficeId: null,
      roster: { 'office-0': ['a'] },
      meta: { 'office-0': { a: { title: 'A' } } },
      sessionIds: { 'office-0': { a: 'uuid-a' } },
    });
    const r = await h.coordinator.tryWarmCurrentOffice();
    expect(r).toEqual([]);
    await flushMicrotasks();
    expect(h.warmCalls).toHaveLength(0);
  });

  it('FR-008: short-circuits when office already in WarmedOfficeRegistry', async () => {
    const h = buildHarness({
      roster: { 'office-0': ['a'] },
      meta: { 'office-0': { a: { title: 'A' } } },
      sessionIds: { 'office-0': { a: 'uuid-a' } },
    });
    const first = await h.coordinator.tryWarmCurrentOffice();
    expect(first).toEqual(['a']);
    await flushMicrotasks();
    const second = await h.coordinator.tryWarmCurrentOffice();
    expect(second).toEqual([]);
    await flushMicrotasks();
    expect(h.warmCalls).toHaveLength(1);
  });

  it('FR-005: qualifying filter — only titled AND has current sessionId', async () => {
    const h = buildHarness({
      roster: { 'office-0': ['titled-with-id', 'titled-no-id', 'untitled-with-id', 'empty-title'] },
      meta: {
        'office-0': {
          'titled-with-id': { title: 'Has Title' },
          'titled-no-id': { title: 'Also Titled' },
          'untitled-with-id': { title: '' },
          'empty-title': { title: '   ' },
        },
      },
      sessionIds: {
        'office-0': {
          'titled-with-id': 'uuid-1',
          'titled-no-id': null,
          'untitled-with-id': 'uuid-2',
        },
      },
    });
    const r = await h.coordinator.tryWarmCurrentOffice();
    expect(r).toEqual(['titled-with-id']);
    await flushMicrotasks();
    expect(h.warmCalls).toEqual([['office-0', 'titled-with-id']]);
  });

  it('FR-020: fleet sub-agents excluded because getCanonicalAgentIds excludes them', async () => {
    // Simulate caller already filtering: the roster does not include fleet ids.
    const h = buildHarness({
      roster: { 'office-0': ['arthur'] }, // would-be fleet sub-agents not present
      meta: { 'office-0': { arthur: { title: 'Lead' } } },
      sessionIds: { 'office-0': { arthur: 'uuid-arthur' } },
    });
    const r = await h.coordinator.tryWarmCurrentOffice();
    expect(r).toEqual(['arthur']);
    await flushMicrotasks();
    expect(h.warmCalls).toEqual([['office-0', 'arthur']]);
    // None of the fleet sub-agent ids should appear in warm calls.
    expect(h.warmCalls.find(([, id]) => id !== 'arthur')).toBeUndefined();
  });

  it('FR-007: one warmAgentSession rejection does not abort the others', async () => {
    const failing = new Set(['b']);
    const h = buildHarness({
      roster: { 'office-0': ['a', 'b', 'c'] },
      meta: {
        'office-0': {
          a: { title: 'A' },
          b: { title: 'B' },
          c: { title: 'C' },
        },
      },
      sessionIds: { 'office-0': { a: 'ua', b: 'ub', c: 'uc' } },
      warmAgentSessionImpl: async (_oid, aid) => {
        if (failing.has(aid)) throw new Error('boom');
      },
    });
    const r = await h.coordinator.tryWarmCurrentOffice();
    expect(r).toEqual(['a', 'b', 'c']);
    await flushMicrotasks();
    // All three were attempted; failure isolated.
    expect(h.warmCalls.map(([, id]) => id).sort()).toEqual(['a', 'b', 'c']);
  });

  it('warmedOfficeIds is marked BEFORE the spawn loop (re-entry safety)', async () => {
    let markedSnapshotDuringWarm: boolean | null = null;
    const h = buildHarness({
      roster: { 'office-0': ['a'] },
      meta: { 'office-0': { a: { title: 'A' } } },
      sessionIds: { 'office-0': { a: 'uuid-a' } },
      warmAgentSessionImpl: async () => {
        markedSnapshotDuringWarm = h.coordinator.warmedOffices.has('office-0');
      },
    });
    await h.coordinator.tryWarmCurrentOffice();
    await flushMicrotasks();
    expect(markedSnapshotDuringWarm).toBe(true);
  });

  it('WarmedOfficeRegistry rehydrates from sessionStorage on construction and writes back on mark', () => {
    sessionStorage.setItem('copilot-office-auto-start:warmed', JSON.stringify(['office-X']));
    const reg = new WarmedOfficeRegistry();
    expect(reg.has('office-X')).toBe(true);
    expect(reg.has('office-Y')).toBe(false);
    reg.mark('office-Y');
    const raw = sessionStorage.getItem('copilot-office-auto-start:warmed');
    expect(raw).not.toBeNull();
    const parsed = JSON.parse(raw!);
    expect(new Set(parsed)).toEqual(new Set(['office-X', 'office-Y']));
  });

  // ── US2 (T401) ────────────────────────────────────────────────────
  it('US2: second call for same office returns [] and does not respawn (FR-008)', async () => {
    const h = buildHarness({
      roster: { 'office-0': ['a'] },
      meta: { 'office-0': { a: { title: 'A' } } },
      sessionIds: { 'office-0': { a: 'uuid-a' } },
    });
    await h.coordinator.tryWarmCurrentOffice();
    await flushMicrotasks();
    const second = await h.coordinator.tryWarmCurrentOffice();
    expect(second).toEqual([]);
    await flushMicrotasks();
    expect(h.warmCalls).toHaveLength(1);
  });

  it('US2: switching getCurrentOfficeId triggers a fresh warm pass for THAT office only', async () => {
    let curOffice = 'office-0';
    const warmCalls: Array<[string, string]> = [];
    const deps: AutoStartCoordinatorDeps = {
      getCurrentOfficeId: () => curOffice,
      getCanonicalAgentIds: (oid) => (oid === 'office-0' ? ['a'] : ['b']),
      getSessionMeta: async (oid) =>
        oid === 'office-0' ? { a: { title: 'A' } } : { b: { title: 'B' } },
      getCurrentSessionId: async (oid, aid) => `${oid}:${aid}`,
      getAgentLaunchConfig: () => ({ workingDir: '/tmp', launchMode: 'shell' }),
      resetSession: async () => {},
      warmAgentSession: async (oid, aid) => {
        warmCalls.push([oid, aid]);
      },
      getSettings: () => ({ autoStartKnownAgents: true }),
    };
    const coord = new AutoStartCoordinator(deps);
    await coord.tryWarmCurrentOffice();
    await flushMicrotasks();
    curOffice = 'office-1';
    await coord.tryWarmCurrentOffice();
    await flushMicrotasks();
    expect(warmCalls).toEqual([
      ['office-0', 'a'],
      ['office-1', 'b'],
    ]);
  });
});

describe('agents/AutoStartCoordinator — replaceSession', () => {
  it('FR-014: when in-flight, returns the existing promise without re-invoking deps', async () => {
    let resolveReset!: () => void;
    const h = buildHarness({
      resetSessionImpl: () =>
        new Promise<void>((resolve) => {
          resolveReset = resolve;
        }),
    });
    const p1 = h.coordinator.replaceSession('office-0', 'a');
    const p2 = h.coordinator.replaceSession('office-0', 'a');
    expect(p2).toBe(p1);
    expect(h.resetCalls).toHaveLength(1);
    expect(h.warmCalls).toHaveLength(0);
    resolveReset();
    await p1;
  });

  it('happy path with setting ON: resetSession then warmAgentSession, once each, in order', async () => {
    const order: string[] = [];
    const h = buildHarness({
      resetSessionImpl: async () => {
        order.push('reset');
      },
      warmAgentSessionImpl: async () => {
        order.push('warm');
      },
    });
    await h.coordinator.replaceSession('office-0', 'a');
    expect(order).toEqual(['reset', 'warm']);
    expect(h.resetCalls).toEqual([['office-0', 'a']]);
    expect(h.warmCalls).toEqual([['office-0', 'a']]);
  });

  it('FR-017: setting OFF — resetSession only, skips warmAgentSession', async () => {
    const h = buildHarness({ settings: { autoStartKnownAgents: false } });
    await h.coordinator.replaceSession('office-0', 'a');
    expect(h.resetCalls).toEqual([['office-0', 'a']]);
    expect(h.warmCalls).toEqual([]);
  });

  it('FR-015: tracker entry cleared in finally even when warmAgentSession rejects', async () => {
    const h = buildHarness({
      warmAgentSessionImpl: async () => {
        throw new Error('warm failed');
      },
    });
    await expect(h.coordinator.replaceSession('office-0', 'a')).rejects.toThrow('warm failed');
    expect(h.coordinator.replaceTracker.has('a')).toBe(false);
    // Next click is unblocked.
    await h.coordinator.replaceSession('office-0', 'a').catch(() => {});
    expect(h.resetCalls).toHaveLength(2);
  });

  it('FR-015: tracker entry cleared in finally on resetSession rejection', async () => {
    const h = buildHarness({
      resetSessionImpl: async () => {
        throw new Error('reset failed');
      },
    });
    await expect(h.coordinator.replaceSession('office-0', 'a')).rejects.toThrow('reset failed');
    expect(h.coordinator.replaceTracker.has('a')).toBe(false);
  });
});
