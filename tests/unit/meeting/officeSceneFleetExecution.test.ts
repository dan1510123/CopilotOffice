import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { OfficeScene } from '../../../src/scenes/OfficeScene';
import { officeManager } from '../../../src/office/officeManager';
import type { MeetingPlan } from '../../../src/meeting/types';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';

describe('OfficeScene approved-plan fleet execution', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('transfers the prior mapping and executes the task through a transient lease', async () => {
    let preload:
      | ((agentId: string, status: 'preloading' | 'ready' | 'failed', officeId?: string, sessionId?: string, lifecycleId?: string) => void)
      | null = null;
    let turnEnd:
      | ((agentId: string, officeId?: string, sessionId?: string, lifecycleId?: string) => void)
      | null = null;
    const bridge = installMockCopilotBridge({
      onTerminalPreloadStatus: vi.fn((cb) => {
        preload = cb;
        return () => {};
      }) as any,
      onCopilotTurnEnd: vi.fn((cb) => {
        turnEnd = cb;
        return () => {};
      }) as any,
    });
    const events = { emit: vi.fn() };
    const scene = new OfficeScene();
    Object.defineProperty(scene, 'game', {
      value: { events },
      configurable: true,
    });
    vi.spyOn(officeManager, 'setAgentStarting').mockImplementation(() => {});
    vi.spyOn(officeManager, 'setAgentThinking').mockImplementation(() => {});
    vi.spyOn(officeManager, 'setAgentReady').mockImplementation(() => {});
    vi.spyOn(officeManager, 'setAgentError').mockImplementation(() => {});

    const plan: MeetingPlan = {
      plan: 'Execute one assigned task',
      tasks: [{
        agentId: 'generalist',
        title: 'Implement lifecycle',
        description: 'd',
        prompt: 'Do the work',
      }],
    };

    await (scene as any).executeApprovedFleetPlan(
      plan,
      'office-source',
      'office-fleet',
      'C:\\work\\repo',
      0,
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.transferSession).toHaveBeenCalledWith(
      'office-source',
      'office-fleet',
      'generalist',
    );
    expect(bridge.terminalBeginTransientSession).toHaveBeenCalledWith(
      'office-fleet',
      'generalist',
      expect.objectContaining({
        title: 'Implement lifecycle',
        workingDir: 'C:\\work\\repo',
        preseededPrompt: 'Do the work',
      }),
    );

    const lifecycleId = (bridge.terminalBeginTransientSession as any).mock.calls[0][2].lifecycleId;
    preload?.(
      'generalist',
      'ready',
      'office-fleet',
      'transient-session-1',
      lifecycleId,
    );
    turnEnd?.(
      'generalist',
      'office-fleet',
      'transient-session-1',
      lifecycleId,
    );
    await vi.advanceTimersByTimeAsync(0);

    expect(bridge.terminalDisposeTransientSession).toHaveBeenCalledWith(
      'office-fleet',
      'generalist',
      lifecycleId,
    );
    expect(officeManager.setAgentReady).toHaveBeenCalledWith(
      'office-fleet',
      'generalist',
      'fleet_transient_done',
    );
    expect(events.emit).toHaveBeenCalledWith('fleet:complete', {
      officeId: 'office-fleet',
    });
  });

  it('does not start a late orchestrator after scene shutdown during transfer', async () => {
    let resolveTransfer!: (value: { success: boolean }) => void;
    const transfer = new Promise<{ success: boolean }>((resolve) => {
      resolveTransfer = resolve;
    });
    const bridge = installMockCopilotBridge({
      transferSession: vi.fn().mockReturnValue(transfer),
    });
    const scene = new OfficeScene();
    Object.defineProperty(scene, 'game', {
      value: { events: { emit: vi.fn() } },
      configurable: true,
    });
    const plan: MeetingPlan = {
      plan: 'Execute one assigned task',
      tasks: [{
        agentId: 'generalist',
        title: 'Implement lifecycle',
        description: 'd',
        prompt: 'Do the work',
      }],
    };

    const execution = (scene as any).executeApprovedFleetPlan(
      plan,
      'office-source',
      'office-fleet',
      'C:\\work\\repo',
      0,
    );
    await scene.cancelFleetExecution('office-fleet');
    resolveTransfer({ success: true });
    await execution;

    expect(bridge.terminalBeginTransientSession).not.toHaveBeenCalled();
  });
});
