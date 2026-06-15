import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetOrchestrator } from '../../../src/meeting/fleetOrchestrator';
import type { MeetingPlan } from '../../../src/meeting/types';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';

interface CapturedListeners {
  preloadStatus: ((agentId: string, status: string) => void) | null;
  terminalExit: ((agentId: string, exitCode: number) => void) | null;
  turnEnd: ((agentId: string) => void) | null;
}

function setupBridge() {
  const captured: CapturedListeners = {
    preloadStatus: null,
    terminalExit: null,
    turnEnd: null,
  };

  const bridge = installMockCopilotBridge({
    onTerminalPreloadStatus: vi.fn((cb) => {
      captured.preloadStatus = cb;
    }) as any,
    onTerminalExit: vi.fn((cb) => {
      captured.terminalExit = cb;
    }) as any,
    onCopilotTurnEnd: vi.fn((cb) => {
      captured.turnEnd = cb;
    }) as any,
  });
  return { bridge, captured };
}

const PLAN: MeetingPlan = {
  plan: 'Test plan',
  tasks: [
    { agentId: 'generalist', title: 'do x', description: 'd', prompt: 'p1' },
    { agentId: 'debugger', title: 'fix y', description: 'd', prompt: 'p2' },
  ],
};

describe('meeting/fleetOrchestrator — spawn/track/teardown contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('initializes all agents as pending then transitions to starting on spawn', async () => {
    const { bridge } = setupBridge();
    const orch = new FleetOrchestrator();

    const startedAgents: string[] = [];
    orch.on('fleet:agent:started', (agentId) => {
      startedAgents.push(agentId);
    });

    void orch.executePlan(PLAN, '.');
    // First spawn fires immediately; the stagger delay is mocked.
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.terminalStart).toHaveBeenCalledWith('generalist', '.');
    expect(startedAgents).toEqual(['generalist']);

    // After stagger delay, second spawn fires.
    await vi.advanceTimersByTimeAsync(1500);
    expect(bridge.terminalStart).toHaveBeenCalledWith('debugger', '.');
    expect(startedAgents).toEqual(['generalist', 'debugger']);
  });

  it('transitions to working when preload status fires ready', async () => {
    const { captured } = setupBridge();
    const orch = new FleetOrchestrator();
    const workingAgents: string[] = [];
    orch.on('fleet:agent:working', (agentId) => workingAgents.push(agentId));

    void orch.executePlan(PLAN, '.');
    await vi.advanceTimersByTimeAsync(0);

    captured.preloadStatus?.('generalist', 'ready');
    expect(workingAgents).toContain('generalist');
  });

  it('transitions to done on turnEnd while in working state', async () => {
    const { captured } = setupBridge();
    const orch = new FleetOrchestrator();
    const doneAgents: string[] = [];
    orch.on('fleet:agent:done', (agentId) => doneAgents.push(agentId));

    void orch.executePlan(PLAN, '.');
    await vi.advanceTimersByTimeAsync(0);
    captured.preloadStatus?.('generalist', 'ready');
    captured.turnEnd?.('generalist');

    expect(doneAgents).toEqual(['generalist']);
  });

  it('marks agent failed on non-zero terminal exit and emits fleet:agent:failed', async () => {
    const { captured } = setupBridge();
    const orch = new FleetOrchestrator();
    const failed: string[] = [];
    orch.on('fleet:agent:failed', (agentId) => failed.push(agentId));

    void orch.executePlan(PLAN, '.');
    await vi.advanceTimersByTimeAsync(0);
    captured.preloadStatus?.('generalist', 'ready');
    captured.terminalExit?.('generalist', 1);

    expect(failed).toEqual(['generalist']);
  });

  it('retries spawn once on terminalStart failure then marks failed if retry also fails', async () => {
    const { bridge } = setupBridge();
    (bridge.terminalStart as any)
      .mockResolvedValueOnce({ success: false })
      .mockResolvedValueOnce({ success: false });
    const orch = new FleetOrchestrator();
    const failed: string[] = [];
    orch.on('fleet:agent:failed', (agentId) => failed.push(agentId));

    // Single-task plan keeps the assertion focused on the retry path
    // (multi-task would also fire a stagger spawn within the retry window).
    void orch.executePlan(
      { plan: 'p', tasks: [PLAN.tasks[0]] },
      '.'
    );
    await vi.advanceTimersByTimeAsync(2500); // retry delay = 2000ms

    expect(bridge.terminalStart).toHaveBeenCalledTimes(2);
    expect(failed).toEqual(['generalist']);
  });

  it('cancel() kills in-flight terminals and stops further spawns', async () => {
    const { bridge, captured } = setupBridge();
    const orch = new FleetOrchestrator();

    void orch.executePlan(PLAN, '.');
    await vi.advanceTimersByTimeAsync(0);
    // First spawn issued; mark it working then cancel.
    captured.preloadStatus?.('generalist', 'ready');

    orch.cancel();

    expect(bridge.terminalKill).toHaveBeenCalledWith('generalist');

    // Subsequent stagger ticks must NOT issue further spawns.
    const callsBefore = (bridge.terminalStart as any).mock.calls.length;
    await vi.advanceTimersByTimeAsync(5000);
    expect((bridge.terminalStart as any).mock.calls.length).toBe(callsBefore);
  });

  it('emits fleet:all:complete once every agent finishes', async () => {
    const { captured } = setupBridge();
    const orch = new FleetOrchestrator();
    const completeStates: any[] = [];
    orch.on('fleet:all:complete', (states) => completeStates.push(states));

    void orch.executePlan(PLAN, '.');
    await vi.advanceTimersByTimeAsync(0);
    captured.preloadStatus?.('generalist', 'ready');
    captured.turnEnd?.('generalist');

    await vi.advanceTimersByTimeAsync(1500);
    captured.preloadStatus?.('debugger', 'ready');
    captured.turnEnd?.('debugger');

    expect(completeStates).toHaveLength(1);
    expect(completeStates[0]).toHaveLength(2);
    expect(completeStates[0].every((s: any) => s.state === 'done')).toBe(true);
  });
});
