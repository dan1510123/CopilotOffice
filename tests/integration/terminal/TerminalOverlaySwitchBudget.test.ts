import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../../../src/config/agents';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';
import { MockFitAddon, MockTerminal } from '../../setup/xterm-mock';

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));

import { TerminalOverlay } from '../../../src/ui/TerminalOverlay';
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

  it('warm switch to an existing session performs a single attach + single getSessionId, no duplicate meta', async () => {
    // First agent is cold (start); the switch target already exists (warm attach).
    const existsFor = new Set<string>(); // agentIds that already exist
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn((_office: string, agentId: string) =>
        Promise.resolve(existsFor.has(agentId)),
      ),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-A' }),
      terminalAttach: vi.fn().mockResolvedValue({ success: true, scrollback: 'xyz' }),
      getSessionId: vi.fn().mockResolvedValue('sess-B'),
      getSessionMeta: vi.fn().mockResolvedValue({ title: 'T' }),
    });

    overlay = new TerminalOverlay(createSceneStub() as any, createInputManager() as any, () => 'office-0');

    // Show agent A (cold).
    await overlay.show(createAgent({ id: 'generalist' }), vi.fn());
    // Mark B as already existing so the switch is a warm attach.
    existsFor.add('debugger');

    // Reset counters to isolate the switch's IPC budget.
    (bridge.terminalAttach as any).mockClear();
    (bridge.getSessionId as any).mockClear();
    (bridge.getSessionMeta as any).mockClear();
    (bridge.terminalDetach as any).mockClear();
    (bridge.terminalExists as any).mockClear();

    // Switch to agent B (warm).
    await overlay.show(createAgent({ id: 'debugger', name: 'Dan', sprite: 'npc_debugger', position: { x: 13, y: 3 } }), vi.fn());

    // Previous agent detached exactly once.
    expect(callsWithArgs(bridge.terminalDetach, 'office-0', 'generalist')).toBe(1);
    // Target existence checked once.
    expect(callsWithArgs(bridge.terminalExists, 'office-0', 'debugger')).toBe(1);
    // Attach happens exactly once (foreground=true).
    expect(callsWithArgs(bridge.terminalAttach, 'office-0', 'debugger', true)).toBe(1);
    // getSessionId happens exactly once for the target — NOT duplicated.
    expect(callsWithArgs(bridge.getSessionId, 'office-0', 'debugger')).toBe(1);
    // Metadata fetched exactly once for the target.
    expect(callsWithArgs(bridge.getSessionMeta, 'office-0', 'debugger')).toBe(1);

    // Perf spans recorded exactly once for this switch target.
    const target = 'office-0:debugger';
    expect(countTerminalPerfEntries('switch:request', { target })).toBe(1);
    expect(countTerminalPerfEntries('switch:detach-done', { target: 'office-0:generalist' })).toBe(1);
    expect(countTerminalPerfEntries('switch:meta-done', { target })).toBe(1);
    expect(countTerminalPerfEntries('switch:activate-done', { target })).toBe(1);
    expect(countTerminalPerfEntries('switch:first-ready', { target })).toBe(1);
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
