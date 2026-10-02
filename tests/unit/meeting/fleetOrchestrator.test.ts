import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FleetOrchestrator } from '../../../src/meeting/fleetOrchestrator';
import type { MeetingPlan } from '../../../src/meeting/types';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';

interface CapturedListeners {
  preloadStatus:
    | ((agentId: string, status: 'preloading' | 'ready' | 'failed', officeId?: string, sessionId?: string, lifecycleId?: string) => void)
    | null;
  terminalExit:
    | ((agentId: string, exitCode: number, officeId?: string, sessionId?: string, lifecycleId?: string) => void)
    | null;
  turnEnd:
    | ((agentId: string, officeId?: string, sessionId?: string, lifecycleId?: string) => void)
    | null;
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function setupBridge() {
  const captured: CapturedListeners = {
    preloadStatus: null,
    terminalExit: null,
    turnEnd: null,
  };

  const bridge = installMockCopilotBridge({
    terminalBeginTransientSession: vi.fn(
      async (_officeId: string, agentId: string) => ({
        success: true as const,
        sessionId: `transient-${agentId}`,
        previousSessionId: `persistent-${agentId}`,
        pid: 1,
      }),
    ) as any,
    onTerminalPreloadStatus: vi.fn((cb) => {
      captured.preloadStatus = cb;
      return () => {};
    }) as any,
    onTerminalExit: vi.fn((cb) => {
      captured.terminalExit = cb;
      return () => {};
    }) as any,
    onCopilotTurnEnd: vi.fn((cb) => {
      captured.turnEnd = cb;
      return () => {};
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

const OFFICE_ID = 'office-fleet-1';

function lifecycleFor(
  bridge: Window['copilotBridge'],
  agentId: string,
): string {
  const call = (bridge.terminalBeginTransientSession as any).mock.calls.find(
    (entry: unknown[]) => entry[1] === agentId,
  );
  return call?.[2]?.lifecycleId;
}

describe('meeting/fleetOrchestrator — transient lifecycle contract', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('starts each task through a fresh transient API and never reuses terminalStart', async () => {
    const { bridge } = setupBridge();
    const orch = new FleetOrchestrator();

    void orch.executePlan(PLAN, '.', OFFICE_ID);
    await vi.advanceTimersByTimeAsync(1500);

    expect(bridge.terminalBeginTransientSession).toHaveBeenCalledTimes(2);
    expect(bridge.terminalBeginTransientSession).toHaveBeenNthCalledWith(
      1,
      OFFICE_ID,
      'generalist',
      expect.objectContaining({
        title: 'do x',
        workingDir: '.',
        preseededPrompt: 'p1',
        lifecycleId: expect.stringContaining('fleet-'),
      }),
    );
    expect(bridge.terminalBeginTransientSession).toHaveBeenNthCalledWith(
      2,
      OFFICE_ID,
      'debugger',
      expect.objectContaining({
        title: 'fix y',
        workingDir: '.',
        preseededPrompt: 'p2',
      }),
    );
    expect(bridge.terminalStart).not.toHaveBeenCalled();
    expect(orch.getFleetState().map((state) => state.transientSessionId)).toEqual([
      'transient-generalist',
      'transient-debugger',
    ]);
  });

  it('rejects duplicate agent assignments before starting any transient lease', async () => {
    const { bridge } = setupBridge();
    const orch = new FleetOrchestrator();
    const duplicatePlan: MeetingPlan = {
      plan: 'bad',
      tasks: [
        PLAN.tasks[0],
        { ...PLAN.tasks[0], title: 'second task', prompt: 'p2' },
      ],
    };

    await expect(orch.executePlan(duplicatePlan, '.', OFFICE_ID)).rejects.toThrow(
      'multiple tasks to the same agent',
    );
    expect(bridge.terminalBeginTransientSession).not.toHaveBeenCalled();
  });

  it('disposes on turn end and waits for restoration before all-complete', async () => {
    const { bridge, captured } = setupBridge();
    const dispose = deferred<{
      success: true;
      disposed: true;
      restoredSessionId: string;
      removedSessionIds: string[];
    }>();
    (bridge.terminalDisposeTransientSession as any).mockReturnValue(dispose.promise);
    const orch = new FleetOrchestrator();
    const done: string[] = [];
    const complete: unknown[] = [];
    orch.on('fleet:agent:done', (agentId) => done.push(agentId));
    orch.on('fleet:all:complete', (states) => complete.push(states));

    void orch.executePlan({ plan: 'p', tasks: [PLAN.tasks[0]] }, '.', OFFICE_ID);
    await vi.advanceTimersByTimeAsync(0);
    const lifecycleId = lifecycleFor(bridge, 'generalist');
    captured.preloadStatus?.('generalist', 'ready', OFFICE_ID, 'transient-generalist', lifecycleId);
    captured.turnEnd?.('generalist', OFFICE_ID, 'transient-generalist', lifecycleId);
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.terminalDisposeTransientSession).toHaveBeenCalledTimes(1);
    expect(done).toEqual([]);
    expect(complete).toEqual([]);

    dispose.resolve({
      success: true,
      disposed: true,
      restoredSessionId: 'persistent-generalist',
      removedSessionIds: ['transient-generalist'],
    });
    await vi.advanceTimersByTimeAsync(0);

    expect(done).toEqual(['generalist']);
    expect(complete).toHaveLength(1);
    expect(orch.getFleetState()[0]).toMatchObject({
      state: 'done',
      cleanupSettled: true,
    });
  });

  it('disposes on terminal failure before emitting failed', async () => {
    const { bridge, captured } = setupBridge();
    const orch = new FleetOrchestrator();
    const failed: string[] = [];
    orch.on('fleet:agent:failed', (agentId) => failed.push(agentId));

    void orch.executePlan({ plan: 'p', tasks: [PLAN.tasks[0]] }, '.', OFFICE_ID);
    await vi.advanceTimersByTimeAsync(0);
    const lifecycleId = lifecycleFor(bridge, 'generalist');
    captured.preloadStatus?.('generalist', 'ready', OFFICE_ID, 'transient-generalist', lifecycleId);
    captured.terminalExit?.('generalist', 17, OFFICE_ID, 'transient-generalist', lifecycleId);
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.terminalDisposeTransientSession).toHaveBeenCalledTimes(1);
    expect(failed).toEqual(['generalist']);
    expect(orch.getFleetState()[0]).toMatchObject({
      state: 'failed',
      error: 'Exited with code 17',
      cleanupSettled: true,
    });
  });

  it('duplicate turn-end plus terminal-exit events do not double-clean', async () => {
    const { bridge, captured } = setupBridge();
    const orch = new FleetOrchestrator();
    const complete: unknown[] = [];
    orch.on('fleet:all:complete', (states) => complete.push(states));

    void orch.executePlan({ plan: 'p', tasks: [PLAN.tasks[0]] }, '.', OFFICE_ID);
    await vi.advanceTimersByTimeAsync(0);
    const lifecycleId = lifecycleFor(bridge, 'generalist');
    captured.preloadStatus?.('generalist', 'ready', OFFICE_ID, 'transient-generalist', lifecycleId);
    captured.turnEnd?.('generalist', OFFICE_ID, 'transient-generalist', lifecycleId);
    captured.terminalExit?.('generalist', 0, OFFICE_ID, 'transient-generalist', lifecycleId);
    captured.turnEnd?.('generalist', OFFICE_ID, 'transient-generalist', lifecycleId);
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.terminalDisposeTransientSession).toHaveBeenCalledTimes(1);
    expect(complete).toHaveLength(1);
  });

  it('ignores a late terminal event from an older lifecycle for the same office and agent', async () => {
    const { bridge, captured } = setupBridge();
    const orch = new FleetOrchestrator();

    void orch.executePlan({ plan: 'p', tasks: [PLAN.tasks[0]] }, '.', OFFICE_ID);
    await vi.advanceTimersByTimeAsync(0);
    const lifecycleId = lifecycleFor(bridge, 'generalist');
    captured.preloadStatus?.(
      'generalist',
      'ready',
      OFFICE_ID,
      'transient-generalist',
      lifecycleId,
    );
    captured.terminalExit?.(
      'generalist',
      1,
      OFFICE_ID,
      'old-transient',
      'older-fleet-lifecycle',
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.terminalDisposeTransientSession).not.toHaveBeenCalled();
    expect(orch.getFleetState()[0].state).toBe('working');

    captured.turnEnd?.(
      'generalist',
      OFFICE_ID,
      'transient-generalist',
      lifecycleId,
    );
    await vi.advanceTimersByTimeAsync(0);
    expect(bridge.terminalDisposeTransientSession).toHaveBeenCalledTimes(1);
  });

  it('retries a start failure and requests idempotent cleanup before failing', async () => {
    const { bridge } = setupBridge();
    (bridge.terminalBeginTransientSession as any)
      .mockResolvedValueOnce({ success: false, error: 'spawn failed' })
      .mockResolvedValueOnce({ success: false, error: 'spawn failed again' });
    const orch = new FleetOrchestrator();
    const failed: string[] = [];
    orch.on('fleet:agent:failed', (agentId) => failed.push(agentId));

    void orch.executePlan({ plan: 'p', tasks: [PLAN.tasks[0]] }, '.', OFFICE_ID);
    await vi.advanceTimersByTimeAsync(2500);

    expect(bridge.terminalBeginTransientSession).toHaveBeenCalledTimes(2);
    expect(bridge.terminalDisposeTransientSession).toHaveBeenCalledTimes(1);
    expect(failed).toEqual(['generalist']);
  });

  it('cancel during an in-flight start waits for the late lease to be disposed and stops staggered starts', async () => {
    const { bridge } = setupBridge();
    const begin = deferred<{
      success: true;
      sessionId: string;
      previousSessionId: string;
    }>();
    (bridge.terminalBeginTransientSession as any).mockReturnValue(begin.promise);
    const orch = new FleetOrchestrator();
    const complete: unknown[] = [];
    orch.on('fleet:all:complete', (states) => complete.push(states));

    void orch.executePlan(PLAN, '.', OFFICE_ID);
    await vi.advanceTimersByTimeAsync(0);
    const cancelPromise = orch.cancel();
    await vi.advanceTimersByTimeAsync(5000);
    expect(bridge.terminalBeginTransientSession).toHaveBeenCalledTimes(1);
    expect(complete).toEqual([]);

    begin.resolve({
      success: true,
      sessionId: 'transient-generalist',
      previousSessionId: 'persistent-generalist',
    });
    await vi.advanceTimersByTimeAsync(0);
    await cancelPromise;

    expect(bridge.terminalDisposeTransientSession).toHaveBeenCalledTimes(1);
    expect(complete).toHaveLength(1);
    expect(orch.getFleetState().every((state) => state.state === 'failed')).toBe(true);
    expect(orch.getFleetState().every((state) => state.cleanupSettled)).toBe(true);
  });

  it('ignores lifecycle events from another office', async () => {
    const { bridge, captured } = setupBridge();
    const orch = new FleetOrchestrator();

    void orch.executePlan({ plan: 'p', tasks: [PLAN.tasks[0]] }, '.', OFFICE_ID);
    await vi.advanceTimersByTimeAsync(0);
    const lifecycleId = lifecycleFor(bridge, 'generalist');
    captured.preloadStatus?.('generalist', 'ready', 'other-office', 'transient-generalist', lifecycleId);
    captured.turnEnd?.('generalist', 'other-office', 'transient-generalist', lifecycleId);
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.terminalDisposeTransientSession).not.toHaveBeenCalled();
    expect(orch.getFleetState()[0].state).toBe('starting');
  });
});
