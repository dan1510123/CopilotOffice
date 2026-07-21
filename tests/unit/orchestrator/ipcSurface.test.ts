import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PermissionRequest, PermissionRequestResult } from '@github/copilot-sdk';

// Fake SDK so the manager can "open" without a real Copilot runtime.
let createSessionCalls = 0;
const fakeSession = {
  sessionId: 'orc-session-1',
  on: vi.fn(() => () => {}),
  send: vi.fn().mockResolvedValue(undefined),
  disconnect: vi.fn().mockResolvedValue(undefined),
};

vi.mock('@github/copilot-sdk', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@github/copilot-sdk')>();
  return {
    ...actual,
    CopilotClient: class {
      start = vi.fn().mockResolvedValue(undefined);
      createSession = vi.fn(async () => {
        createSessionCalls += 1;
        return fakeSession;
      });
    },
    RuntimeConnection: { forStdio: () => ({}) },
  };
});

vi.mock('../../../electron/terminal/terminal-backend', () => ({
  resolveCopilotCliPath: () => '/fake/copilot',
}));

vi.mock('../../../electron/terminal/event-source', () => ({
  mapSdkEventToCopilotEvent: (e: unknown) => e,
}));

import { OrchestratorSessionManager, type OrchestratorEmitter } from '../../../electron/orchestrator/orchestratorSessionManager';

function makeManager() {
  const permissionRequests: Array<{ toolCallId: string }> = [];
  const emitter: OrchestratorEmitter = {
    emitEvent: () => {},
    emitPermissionRequest: (p) => permissionRequests.push({ toolCallId: p.toolCallId }),
    emitCandidatesRequest: () => {},
    emitExecuteRequest: () => {},
    emitOfficesRequest: () => {},
    emitSwitchRequest: () => {},
    emitExit: () => {},
  };
  return { manager: new OrchestratorSessionManager(emitter, '.'), permissionRequests };
}

beforeEach(() => {
  createSessionCalls = 0;
  fakeSession.on.mockClear();
  fakeSession.send.mockClear();
  fakeSession.disconnect.mockClear();
});

describe('orchestrator IPC surface / session lifecycle', () => {
  it('open() is idempotent — repeat calls reuse the single session', async () => {
    const { manager } = makeManager();
    const a = await manager.open();
    const b = await manager.open();
    expect(createSessionCalls).toBe(1);
    expect(a.sessionId).toBe('orc-session-1');
    expect(b.sessionId).toBe('orc-session-1');
  });

  it('concurrent open() calls share one in-flight session creation', async () => {
    const { manager } = makeManager();
    const [a, b] = await Promise.all([manager.open(), manager.open()]);
    expect(createSessionCalls).toBe(1);
    expect(a.sessionId).toBe(b.sessionId);
  });

  it('close() does NOT kill the session (getInfo still resolves the live session)', async () => {
    const { manager } = makeManager();
    await manager.open();
    manager.close();
    expect(manager.getInfo()?.sessionId).toBe('orc-session-1');
    // No further session was spun up by closing.
    expect(createSessionCalls).toBe(1);
  });

  it('a pending permission request resolves as deny on close', async () => {
    const { manager, permissionRequests } = makeManager();
    await manager.open();
    const handler = (manager as unknown as {
      permissionHandler: (r: PermissionRequest, i?: unknown) => Promise<PermissionRequestResult>;
    }).permissionHandler;
    const pending = handler({
      kind: 'custom-tool',
      toolName: 'bring_agent_online',
      toolCallId: 'call-1',
      toolDescription: 'x',
      args: { agentId: 'debugger' },
    } as PermissionRequest);
    expect(permissionRequests).toHaveLength(1);
    manager.close();
    await expect(pending).resolves.toEqual({ kind: 'denied-interactively-by-user' });
  });

  it('respondOffices / respondSwitch return false for an unknown requestId', async () => {
    const { manager } = makeManager();
    await manager.open();
    expect(manager.respondOffices('nope', [])).toBe(false);
    expect(
      manager.respondSwitch('nope', { officeId: 'x', outcome: 'switched', message: 'x' }),
    ).toBe(false);
  });

  it('close() keeps a pending permission open while the Teams relay is active', async () => {
    const { manager } = makeManager();
    await manager.open();
    // Simulate the orchestrator being online in a Teams thread (reachable approver).
    manager.setTeamsRelayActive(true);
    const handler = (manager as unknown as {
      permissionHandler: (r: PermissionRequest, i?: unknown) => Promise<PermissionRequestResult>;
    }).permissionHandler;
    let settled = false;
    const pending = handler({
      kind: 'custom-tool',
      toolName: 'bring_agent_online',
      toolCallId: 'call-relay',
      toolDescription: 'x',
      args: { agentId: 'debugger' },
    } as PermissionRequest).then((r) => { settled = true; return r; });
    manager.close();
    await Promise.resolve();
    // The gate is NOT auto-denied — the in-thread approver still owns it.
    expect(settled).toBe(false);
    // The relay can still approve it after the panel was minimized.
    expect(manager.respondToPermission({ toolCallId: 'call-relay', decision: 'approve' })).toBe(true);
    await expect(pending).resolves.toEqual({ kind: 'approved' });
  });

  it('endSession() disconnects the SDK session and fires exit listeners', async () => {
    const { manager } = makeManager();
    await manager.open();
    const exits: string[] = [];
    manager.onSessionExit((reason) => exits.push(reason));
    await manager.endSession();
    expect(fakeSession.disconnect).toHaveBeenCalledTimes(1);
    expect(exits).toEqual(['closed-by-user']);
    // The session is gone; a subsequent open() starts a fresh one.
    expect(manager.getInfo()).toBeNull();
    await manager.open();
    expect(createSessionCalls).toBe(2);
  });
});
