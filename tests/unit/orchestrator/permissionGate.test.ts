import { afterEach, describe, expect, it, vi } from 'vitest';
import { OrchestratorSessionManager, type OrchestratorEmitter } from '../../../electron/orchestrator/orchestratorSessionManager';
import * as yoloMode from '../../../src/config/yoloMode';
import type { PermissionRequest, PermissionRequestResult } from '@github/copilot-sdk';

// The orchestrator gate is ALWAYS on (spec 016 FR-002): it must raise a prompt
// for `bring_agent_online` regardless of the global YOLO toggle, and must never
// consult isYoloEnabled(). These tests drive the private permission handler
// directly (no SDK/runtime needed).

interface Captured {
  toolCallId: string;
  args: { agentId?: string; reason?: string };
}

function makeManager(): { manager: OrchestratorSessionManager; captured: Captured[] } {
  const captured: Captured[] = [];
  const emitter: OrchestratorEmitter = {
    emitEvent: () => {},
    emitPermissionRequest: (p) => captured.push({ toolCallId: p.toolCallId, args: p.args }),
    emitCandidatesRequest: () => {},
    emitExecuteRequest: () => {},
    emitExit: () => {},
  };
  const manager = new OrchestratorSessionManager(emitter, '.');
  return { manager, captured };
}

function bringOnlineRequest(overrides: Partial<PermissionRequest> = {}): PermissionRequest {
  return {
    kind: 'custom-tool',
    toolName: 'bring_agent_online',
    toolCallId: 'call-1',
    toolDescription: 'bring an agent online',
    args: { agentId: 'debugger', reason: 'debugging' },
    ...overrides,
  } as PermissionRequest;
}

// Access the private handler in a typed-enough way for the test.
function handlerOf(manager: OrchestratorSessionManager): (req: PermissionRequest) => PermissionRequestResult | Promise<PermissionRequestResult> {
  return (manager as unknown as { permissionHandler: (req: PermissionRequest, inv?: unknown) => PermissionRequestResult | Promise<PermissionRequestResult> }).permissionHandler;
}

describe('orchestrator permission gate', () => {
  afterEach(() => vi.restoreAllMocks());

  it('raises a prompt for bring_agent_online even when YOLO is enabled, without consulting isYoloEnabled()', async () => {
    const yoloSpy = vi.spyOn(yoloMode, 'isYoloEnabled').mockReturnValue(true);
    const { manager, captured } = makeManager();
    const result = handlerOf(manager)(bringOnlineRequest());

    expect(captured).toHaveLength(1);
    expect(captured[0].args.agentId).toBe('debugger');
    expect(result).toBeInstanceOf(Promise);
    expect(yoloSpy).not.toHaveBeenCalled();

    // resolve so the pending promise doesn't leak
    manager.respondToPermission({ toolCallId: captured[0].toolCallId, decision: 'approve' });
    await result;
  });

  it('resolves as approved when the user approves', async () => {
    const { manager, captured } = makeManager();
    const result = handlerOf(manager)(bringOnlineRequest()) as Promise<PermissionRequestResult>;
    manager.respondToPermission({ toolCallId: captured[0].toolCallId, decision: 'approve' });
    await expect(result).resolves.toEqual({ kind: 'approved' });
  });

  it('resolves as denied-interactively-by-user when the user denies', async () => {
    const { manager, captured } = makeManager();
    const result = handlerOf(manager)(bringOnlineRequest()) as Promise<PermissionRequestResult>;
    manager.respondToPermission({ toolCallId: captured[0].toolCallId, decision: 'deny' });
    await expect(result).resolves.toEqual({ kind: 'denied-interactively-by-user' });
  });

  it('resolves pending requests as deny on dismiss (close)', async () => {
    const { manager } = makeManager();
    const result = handlerOf(manager)(bringOnlineRequest()) as Promise<PermissionRequestResult>;
    manager.close();
    await expect(result).resolves.toEqual({ kind: 'denied-interactively-by-user' });
  });

  it('denies any non-bring_agent_online request by default', () => {
    const { manager, captured } = makeManager();
    const other = handlerOf(manager)(bringOnlineRequest({ toolName: 'something_else' }));
    expect(other).toEqual({ kind: 'denied-interactively-by-user' });
    expect(captured).toHaveLength(0);
  });
});
