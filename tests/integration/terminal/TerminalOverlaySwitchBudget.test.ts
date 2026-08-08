import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../../../src/config/agents';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';
import { MockFitAddon, MockTerminal } from '../../setup/xterm-mock';

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));

import { TerminalOverlay } from '../../../src/ui/TerminalOverlay';
import {
  AutoStartCoordinator,
  setAutoStartCoordinator,
} from '../../../src/agents/AutoStartCoordinator';
import {
  countTerminalPerfEntries,
  resetTerminalPerf,
  setTerminalPerfEnabled,
} from '../../../src/ui/terminalPerf';

function createAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'generalist',
    name: 'Gene',
    skill: 'general',
    sprite: 'npc_generalist',
    color: 0x4488cc,
    position: { x: 4, y: 3 },
    greeting: 'hello',
    description: 'Generalist',
    workingDir: '.',
    ...overrides,
  };
}

function createSceneStub() {
  const canvas = document.createElement('canvas');
  canvas.focus = vi.fn() as unknown as () => void;
  return {
    game: { events: { emit: vi.fn(), on: vi.fn(), once: vi.fn() }, canvas },
    textures: {
      get: vi.fn(() => ({
        key: 'npc_generalist',
        getSourceImage: () => document.createElement('canvas'),
      })),
    },
  };
}

function createInputManager() {
  return {
    activateTerminalF10: vi.fn(),
    deactivateTerminalF10: vi.fn(),
    switchToTerminal: vi.fn(),
    switchToGame: vi.fn(),
    focusTerminalXterm: vi.fn(),
    blurTerminalXterm: vi.fn(),
  };
}

/** Count calls to a vitest mock whose leading args equal the given prefix. */
function callsWithArgs(mock: any, ...prefix: unknown[]): number {
  return mock.mock.calls.filter((c: unknown[]) =>
    prefix.every((v, i) => c[i] === v),
  ).length;
}

/**
 * Spec 021, Phase 1 — deterministic operation-count baselines for the agent
 * switch hot path. These lock in the Phase 0 quick-win budget (independent IPC
 * parallelized, no duplicate getSessionId round-trip) and guard against
 * regressions that re-serialize or duplicate switch IPC. No wall-clock
 * thresholds are asserted — only operation counts and perf-span presence.
 */
describe('integration/TerminalOverlay switch operation budget (baseline)', () => {
  let overlay: TerminalOverlay | null = null;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="game-container">
        <div id="office-panel"></div>
        <div id="terminal-panel"></div>
      </div>
    `;
    localStorage.clear();
    resetTerminalPerf();
    setTerminalPerfEnabled(true);
  });

  afterEach(() => {
    setTerminalPerfEnabled(false);
    resetTerminalPerf();
    overlay?.destroy();
    overlay = null;
  });

  it('cache-cold switch to an existing server session uses one atomic activation (no attach/getSessionId), and the return switch is a warm no-replay hit', async () => {
    // First agent is cold; the switch target already exists on the server but is
    // a COLD cache entry on first view (one activation + one-time scrollback).
    const existsFor = new Set<string>(); // agentIds that already exist on the server
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn((_office: string, agentId: string) =>
        Promise.resolve(existsFor.has(agentId)),
      ),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-A' }),
      terminalActivate: vi.fn().mockResolvedValue({
        success: true, existed: true, sessionId: 'sess-B', title: 'T', scrollback: 'xyz',
      }),
      getSessionMeta: vi.fn().mockResolvedValue({ title: 'T' }),
    });

    overlay = new TerminalOverlay(createSceneStub() as any, createInputManager() as any, () => 'office-0');

    // Show agent A (cold cache + cold server → start).
    await overlay.show(createAgent({ id: 'generalist' }), vi.fn());
    // Mark B as already existing on the server so its first view replays once.
    existsFor.add('debugger');

    // Reset counters to isolate the switch's IPC budget.
    (bridge.terminalActivate as any).mockClear();
    (bridge.terminalAttach as any).mockClear();
    (bridge.getSessionId as any).mockClear();
    (bridge.getSessionMeta as any).mockClear();
    (bridge.terminalDetach as any).mockClear();
    (bridge.terminalExists as any).mockClear();

    // Switch to agent B — cold CACHE entry, existing server session.
    const danAgent = createAgent({ id: 'debugger', name: 'Dan', sprite: 'npc_debugger', position: { x: 13, y: 3 } });
    await overlay.show(danAgent, vi.fn());

    // Spec 021 Phase 5 (retain-while-cached): previous agent is NOT detached.
    expect(callsWithArgs(bridge.terminalDetach, 'office-0', 'generalist')).toBe(0);
    // Cold cache entry checks server existence once, then activates atomically.
    expect(callsWithArgs(bridge.terminalExists, 'office-0', 'debugger')).toBe(1);
    expect(
      (bridge.terminalActivate as any).mock.calls.filter(
        (c: unknown[]) => c[0] === 'office-0' && c[1] === 'debugger' && (c[2] as any)?.needScrollback === true,
      ).length,
    ).toBe(1);
    // Legacy attach / getSessionId are gone from the switch path.
    expect(callsWithArgs(bridge.terminalAttach, 'office-0', 'debugger', true)).toBe(0);
    expect(callsWithArgs(bridge.getSessionId, 'office-0', 'debugger')).toBe(0);
    // Metadata fetched exactly once for the target.
    expect(callsWithArgs(bridge.getSessionMeta, 'office-0', 'debugger')).toBe(1);

    // Perf spans recorded exactly once for this switch target.
    const target = 'office-0:debugger';
    expect(countTerminalPerfEntries('switch:request', { target })).toBe(1);
    expect(countTerminalPerfEntries('switch:meta-done', { target })).toBe(1);
    expect(countTerminalPerfEntries('switch:activate-done', { target })).toBe(1);
    expect(countTerminalPerfEntries('switch:first-ready', { target })).toBe(1);

    // Now switch BACK to generalist — a warm cache hit: no exists check, no
    // scrollback replay, a single foreground-only activation.
    (bridge.terminalActivate as any).mockClear();
    (bridge.terminalExists as any).mockClear();
    (bridge.terminalDetach as any).mockClear();

    await overlay.show(createAgent({ id: 'generalist' }), vi.fn());

    expect(callsWithArgs(bridge.terminalExists, 'office-0', 'generalist')).toBe(0);
    expect(callsWithArgs(bridge.terminalDetach, 'office-0', 'debugger')).toBe(0);
    const warmActivations = (bridge.terminalActivate as any).mock.calls.filter(
      (c: unknown[]) => c[0] === 'office-0' && c[1] === 'generalist',
    );
    expect(warmActivations.length).toBe(1);
    expect((warmActivations[0][2] as any)?.needScrollback).toBe(false);
  });

  it('cold switch to a non-existent session starts once and does not attach', async () => {
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-A' }),
      getSessionMeta: vi.fn().mockResolvedValue(null),
    });

    overlay = new TerminalOverlay(createSceneStub() as any, createInputManager() as any, () => 'office-0');
    await overlay.show(createAgent({ id: 'generalist' }), vi.fn());

    (bridge.terminalStart as any).mockClear();
    (bridge.terminalAttach as any).mockClear();

    await overlay.show(createAgent({ id: 'debugger', name: 'Dan', sprite: 'npc_debugger', position: { x: 13, y: 3 } }), vi.fn());

    // Cold target: started once, never attached.
    expect(callsWithArgs(bridge.terminalStart, 'office-0', 'debugger')).toBe(1);
    expect(callsWithArgs(bridge.terminalAttach, 'office-0', 'debugger', true)).toBe(0);
    expect(countTerminalPerfEntries('switch:activate-done', { target: 'office-0:debugger' })).toBe(1);
  });
});

/**
 * Spec 021 session-action budget — the New Session action must NOT make a
 * redundant getSessionId round-trip: the server-side reset already mints and
 * returns the new session id, which the coordinator now threads back through
 * replaceSession(). This locks in that saving and records session-action spans.
 */
describe('integration/TerminalOverlay New Session action budget', () => {
  let overlay: TerminalOverlay | null = null;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="game-container">
        <div id="office-panel"></div>
        <div id="terminal-panel"></div>
      </div>
    `;
    localStorage.clear();
    resetTerminalPerf();
    setTerminalPerfEnabled(true);
  });

  afterEach(() => {
    setAutoStartCoordinator(null as any);
    setTerminalPerfEnabled(false);
    resetTerminalPerf();
    overlay?.destroy();
    overlay = null;
  });

  it('uses the reset-minted session id and performs zero getSessionId round-trips', async () => {
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-old' }),
      resetSession: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-fresh-42' }),
      getSessionMeta: vi.fn().mockResolvedValue(null),
    });

    // Wire a real coordinator whose resetSession dep threads the bridge's minted id.
    const coordinator = new AutoStartCoordinator({
      getCurrentOfficeId: () => 'office-0',
      getCanonicalAgentIds: () => ['generalist'],
      getSessionMeta: async () => ({}),
      getCurrentSessionId: async () => null,
      getAgentLaunchConfig: () => ({ workingDir: '.', launchMode: 'copilot' }),
      resetSession: async (oid, aid) => {
        const r = await bridge.resetSession(oid, aid);
        return r?.sessionId ?? null;
      },
      warmAgentSession: async () => { /* no-op for this test */ },
      getSettings: () => ({ autoStartKnownAgents: true }),
    });
    setAutoStartCoordinator(coordinator);

    overlay = new TerminalOverlay(createSceneStub() as any, createInputManager() as any, () => 'office-0');
    await overlay.show(createAgent({ id: 'generalist' }), vi.fn());

    // Isolate the New Session action's IPC budget.
    (bridge.getSessionId as any).mockClear();
    (bridge.resetSession as any).mockClear();

    await (overlay as any).handleNewSession();

    // Reset happened once; getSessionId was NOT called (id came from reset).
    expect(callsWithArgs(bridge.resetSession, 'office-0', 'generalist')).toBe(1);
    expect((bridge.getSessionId as any).mock.calls.length).toBe(0);

    // UI shows the freshly-minted id.
    const sessionDisplay = document.querySelector('.session-id-display') as HTMLElement;
    expect(sessionDisplay?.textContent).toBe('sess-fresh-42');

    // Session-action perf spans recorded once.
    const target = 'office-0:generalist';
    expect(countTerminalPerfEntries('session:new-request', { target })).toBe(1);
    expect(countTerminalPerfEntries('session:new-done', { target })).toBe(1);
  });
});
