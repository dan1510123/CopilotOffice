import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TeamsService, type TeamsServiceDeps } from '../../../electron/teams/teamsService';
import type { AgentEvent, SessionGateway } from '../../../electron/teams/sessionGateway';
import type { OnlineAgentBinding } from '../../../electron/teams/types';
import {
  ORCHESTRATOR_AGENT_ID,
  ORCHESTRATOR_OFFICE_ID,
} from '../../../electron/orchestrator/orchestratorIdentity';

// Exercises the spec-016 Workstream B permission relay: a `permission-request`
// AgentEvent posts an Approve/Deny prompt to the thread, an in-thread reply routes
// to gateway.respondPermission, and an unanswered gate auto-denies after the timeout.

function makeBinding(): OnlineAgentBinding {
  return {
    agentId: ORCHESTRATOR_AGENT_ID,
    officeId: ORCHESTRATOR_OFFICE_ID,
    sessionId: 'orch-session-1',
    handle: 'orchestrator',
    displayName: 'Office Orchestrator',
    workingDir: '.',
    sessionTitle: 'Office Orchestrator',
    teamId: 'team-1',
    channelId: 'chan-1',
    tenantId: 'tenant-1',
    threadRootId: 'root-1',
    online: true,
    lastConnected: 0,
  };
}

function makeDeps(): {
  deps: TeamsServiceDeps;
  respondPermission: ReturnType<typeof vi.fn>;
  replyToThread: ReturnType<typeof vi.fn>;
  fireEvent: (e: AgentEvent) => void;
} {
  let eventCb: ((e: AgentEvent) => void) | null = null;
  const respondPermission = vi.fn(async () => {});
  const replyToThread = vi.fn(async () => ({ id: 'reply-1' }));
  const gateway = {
    getSessionId: vi.fn(async () => 'orch-session-1'),
    getSessionMeta: vi.fn(async () => ({ title: 'Office Orchestrator' })),
    isAgentReady: vi.fn(async () => true),
    submitPrompt: vi.fn(async () => {}),
    submitAnswer: vi.fn(async () => {}),
    setForwarding: vi.fn(() => {}),
    respondPermission,
    onAgentEvent: vi.fn((cb: (e: AgentEvent) => void) => {
      eventCb = cb;
      return () => {};
    }),
    onSessionExit: vi.fn(() => () => {}),
  } as unknown as SessionGateway;

  const deps: TeamsServiceDeps = {
    store: { load: vi.fn(async () => ({ bindings: [], knownThreads: [] })), save: vi.fn(async () => {}) } as unknown as TeamsServiceDeps['store'],
    tokens: {} as TeamsServiceDeps['tokens'],
    graph: { replyToThread, createThread: vi.fn(), getChannel: undefined } as unknown as TeamsServiceDeps['graph'],
    source: { start: vi.fn(async () => {}), stop: vi.fn(async () => {}), health: 'connected' } as unknown as TeamsServiceDeps['source'],
    gateway,
    getSettings: () => ({ enabled: true, ackEnabled: false }) as unknown as ReturnType<TeamsServiceDeps['getSettings']>,
    emitStatus: vi.fn(),
    emitToast: vi.fn(),
    now: () => 1000,
  };

  return { deps, respondPermission, replyToThread, fireEvent: (e) => eventCb?.(e) };
}

const PERM_EVENT: AgentEvent = {
  agentId: ORCHESTRATOR_AGENT_ID,
  kind: 'permission-request',
  permission: { toolCallId: 'tc-42', toolName: 'bring_agent_online', summary: 'Bring an agent online (debugger) — fix a bug' },
};

describe('TeamsService orchestrator permission relay (spec 016 B)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  async function startWithBinding() {
    const h = makeDeps();
    const svc = new TeamsService(h.deps);
    await svc.start();
    (svc as unknown as { bindings: OnlineAgentBinding[] }).bindings.push(makeBinding());
    return { svc, ...h };
  }

  it('posts an Approve/Deny prompt when a permission-request event arrives', async () => {
    const { fireEvent, replyToThread } = await startWithBinding();
    fireEvent(PERM_EVENT);
    await vi.advanceTimersByTimeAsync(0);
    expect(replyToThread).toHaveBeenCalledTimes(1);
    const html = (replyToThread.mock.calls[0][0] as { html: string }).html ?? JSON.stringify(replyToThread.mock.calls[0][0]);
    expect(html.toLowerCase()).toContain('approv');
    expect(html.toLowerCase()).toContain('deny');
  });

  it('routes an in-thread "approve" reply to respondPermission(approve)', async () => {
    const { svc, fireEvent, respondPermission } = await startWithBinding();
    fireEvent(PERM_EVENT);
    await vi.advanceTimersByTimeAsync(0);
    const record = (svc as unknown as { pendingApprovals: Map<string, unknown> }).pendingApprovals.get(ORCHESTRATOR_AGENT_ID);
    await (svc as unknown as { resolveApproval: (r: unknown, t: string) => Promise<void> }).resolveApproval(record, 'approve');
    expect(respondPermission).toHaveBeenCalledWith(ORCHESTRATOR_OFFICE_ID, ORCHESTRATOR_AGENT_ID, 'tc-42', 'approve');
  });

  it('routes an in-thread "D" reply to respondPermission(deny)', async () => {
    const { svc, fireEvent, respondPermission } = await startWithBinding();
    fireEvent(PERM_EVENT);
    await vi.advanceTimersByTimeAsync(0);
    const record = (svc as unknown as { pendingApprovals: Map<string, unknown> }).pendingApprovals.get(ORCHESTRATOR_AGENT_ID);
    await (svc as unknown as { resolveApproval: (r: unknown, t: string) => Promise<void> }).resolveApproval(record, 'D');
    expect(respondPermission).toHaveBeenCalledWith(ORCHESTRATOR_OFFICE_ID, ORCHESTRATOR_AGENT_ID, 'tc-42', 'deny');
  });

  it('auto-denies when nobody replies within the timeout', async () => {
    const { fireEvent, respondPermission } = await startWithBinding();
    fireEvent(PERM_EVENT);
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(5 * 60 * 1000 + 10);
    expect(respondPermission).toHaveBeenCalledWith(ORCHESTRATOR_OFFICE_ID, ORCHESTRATOR_AGENT_ID, 'tc-42', 'deny');
  });

  it('an unrecognized reply leaves the gate pending (no decision)', async () => {
    const { svc, fireEvent, respondPermission } = await startWithBinding();
    fireEvent(PERM_EVENT);
    await vi.advanceTimersByTimeAsync(0);
    const record = (svc as unknown as { pendingApprovals: Map<string, unknown> }).pendingApprovals.get(ORCHESTRATOR_AGENT_ID);
    await (svc as unknown as { resolveApproval: (r: unknown, t: string) => Promise<void> }).resolveApproval(record, 'maybe');
    expect(respondPermission).not.toHaveBeenCalled();
    expect((svc as unknown as { pendingApprovals: Map<string, unknown> }).pendingApprovals.has(ORCHESTRATOR_AGENT_ID)).toBe(true);
  });
});
