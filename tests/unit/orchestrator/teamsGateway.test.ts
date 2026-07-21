import { describe, expect, it, vi } from 'vitest';
import { OrchestratorSessionGateway } from '../../../electron/teams/orchestratorSessionGateway';
import { CompositeSessionGateway } from '../../../electron/teams/compositeSessionGateway';
import {
  ORCHESTRATOR_AGENT_ID,
  ORCHESTRATOR_OFFICE_ID,
} from '../../../electron/orchestrator/orchestratorIdentity';
import type { AgentEvent, SessionGateway } from '../../../electron/teams/sessionGateway';
import type { OrchestratorSessionManager } from '../../../electron/orchestrator/orchestratorSessionManager';

type EventCb = (event: { type: string; data?: unknown }) => void;
type PermCb = (p: { toolCallId: string; toolName: string; agentId?: string; online?: boolean; reason?: string }) => void;
type ExitCb = (reason: string) => void;

function makeFakeManager(info: { sessionId: string; lifecycle: string } | null = { sessionId: 's-1', lifecycle: 'ready' }) {
  const eventCbs = new Set<EventCb>();
  const permCbs = new Set<PermCb>();
  const exitCbs = new Set<ExitCb>();
  const respondToPermission = vi.fn(() => true);
  const submitInput = vi.fn(async () => {});
  const manager = {
    getInfo: () => info,
    submitInput,
    respondToPermission,
    onSessionEvent: (cb: EventCb) => {
      eventCbs.add(cb);
      return () => eventCbs.delete(cb);
    },
    onPermissionRequested: (cb: PermCb) => {
      permCbs.add(cb);
      return () => permCbs.delete(cb);
    },
    onSessionExit: (cb: ExitCb) => {
      exitCbs.add(cb);
      return () => exitCbs.delete(cb);
    },
  } as unknown as OrchestratorSessionManager;
  return {
    manager,
    respondToPermission,
    submitInput,
    fireEvent: (e: { type: string; data?: unknown }) => eventCbs.forEach((cb) => cb(e)),
    firePermission: (p: { toolCallId: string; toolName: string; agentId?: string; online?: boolean; reason?: string }) =>
      permCbs.forEach((cb) => cb(p)),
    fireExit: (reason: string) => exitCbs.forEach((cb) => cb(reason)),
  };
}

const OK = [ORCHESTRATOR_OFFICE_ID, ORCHESTRATOR_AGENT_ID] as const;

describe('OrchestratorSessionGateway', () => {
  it('reports session id / readiness only for the synthetic key', async () => {
    const { manager } = makeFakeManager({ sessionId: 's-9', lifecycle: 'ready' });
    const gw = new OrchestratorSessionGateway(manager);
    expect(await gw.getSessionId(...OK)).toBe('s-9');
    expect(await gw.isAgentReady(...OK)).toBe(true);
    expect(await gw.getSessionId('office-0', 'generalist')).toBeNull();
    expect(await gw.isAgentReady('office-0', 'generalist')).toBe(false);
  });

  it('returns null session id when the manager has no live session', async () => {
    const { manager } = makeFakeManager(null);
    const gw = new OrchestratorSessionGateway(manager);
    expect(await gw.getSessionId(...OK)).toBeNull();
    expect(await gw.isAgentReady(...OK)).toBe(false);
  });

  it('submitPrompt forwards to manager.submitInput for the synthetic key', async () => {
    const { manager, submitInput } = makeFakeManager();
    const gw = new OrchestratorSessionGateway(manager);
    await gw.submitPrompt(...OK, 'bring up a debugger');
    // spec 017 (T011): Teams-driven prompts are tagged with the 'teams' origin so
    // the persisted transcript can attribute who spoke.
    expect(submitInput).toHaveBeenCalledWith('bring up a debugger', 'teams');
  });

  it('submitAnswer is unsupported (throws)', async () => {
    const { manager } = makeFakeManager();
    const gw = new OrchestratorSessionGateway(manager);
    await expect(gw.submitAnswer(...OK, { answer: 'x', wasFreeform: true })).rejects.toThrow(/ask_user/i);
  });

  it('respondPermission routes decision to manager.respondToPermission', async () => {
    const { manager, respondToPermission } = makeFakeManager();
    const gw = new OrchestratorSessionGateway(manager);
    await gw.respondPermission(...OK, 'tool-7', 'approve');
    expect(respondToPermission).toHaveBeenCalledWith({ toolCallId: 'tool-7', decision: 'approve' });
    respondToPermission.mockClear();
    await gw.respondPermission('office-0', 'generalist', 'tool-8', 'deny');
    expect(respondToPermission).not.toHaveBeenCalled();
  });

  it('maps manager events to AgentEvents', () => {
    const fake = makeFakeManager();
    const gw = new OrchestratorSessionGateway(fake.manager);
    const events: AgentEvent[] = [];
    const off = gw.onAgentEvent((e) => events.push(e));

    fake.fireEvent({ type: 'assistant.message', data: { content: 'hello from the orchestrator' } });
    fake.fireEvent({ type: 'assistant.turn_start' });
    fake.fireEvent({ type: 'assistant.turn_end' });
    fake.fireEvent({ type: 'tool.execution_start', data: { toolName: 'bring_agent_online' } });

    expect(events).toEqual([
      { agentId: ORCHESTRATOR_AGENT_ID, kind: 'message', content: 'hello from the orchestrator' },
      { agentId: ORCHESTRATOR_AGENT_ID, kind: 'turn-start' },
      { agentId: ORCHESTRATOR_AGENT_ID, kind: 'turn-end' },
      { agentId: ORCHESTRATOR_AGENT_ID, kind: 'tool-start', toolName: 'bring_agent_online' },
    ]);

    off();
    events.length = 0;
    fake.fireEvent({ type: 'assistant.turn_start' });
    expect(events).toHaveLength(0);
  });

  it('relays permission requests as permission-request AgentEvents', () => {
    const fake = makeFakeManager();
    const gw = new OrchestratorSessionGateway(fake.manager);
    const events: AgentEvent[] = [];
    gw.onAgentEvent((e) => events.push(e));

    fake.firePermission({ toolCallId: 'tc-1', toolName: 'bring_agent_online', agentId: 'debugger', reason: 'fix a bug' });

    expect(events).toHaveLength(1);
    const e = events[0];
    expect(e.kind).toBe('permission-request');
    expect(e.permission?.toolCallId).toBe('tc-1');
    expect(e.permission?.toolName).toBe('bring_agent_online');
    // agentId 'debugger' now resolves to the friendly display name "Dan".
    expect(e.permission?.summary).toContain('Dan');
    expect(e.permission?.summary).toContain('online');
    expect(e.permission?.summary).toContain('fix a bug');
  });

  it('maps each gated tool to a matching approval summary', () => {
    const fake = makeFakeManager();
    const gw = new OrchestratorSessionGateway(fake.manager);
    const events: AgentEvent[] = [];
    gw.onAgentEvent((e) => events.push(e));

    const cases: Array<{ toolName: string; online?: boolean; expected: string }> = [
      { toolName: 'answer_agent', expected: "Answer Dan's question" },
      { toolName: 'send_prompt_to_agent', expected: 'Send a follow-up prompt to Dan' },
      { toolName: 'stop_agent', expected: 'Stop Dan' },
      { toolName: 'restart_agent', expected: 'Restart Dan' },
      { toolName: 'set_agent_teams_presence', online: true, expected: 'Bring Dan online in Teams' },
      { toolName: 'set_agent_teams_presence', online: false, expected: 'Take Dan offline in Teams' },
    ];
    for (const [i, c] of cases.entries()) {
      events.length = 0;
      fake.firePermission({ toolCallId: `tc-${i}`, toolName: c.toolName, agentId: 'debugger', online: c.online });
      expect(events[0]?.permission?.summary).toContain(c.expected);
    }
  });

  it('onSessionExit reports the synthetic agent id', () => {
    const fake = makeFakeManager();
    const gw = new OrchestratorSessionGateway(fake.manager);
    const exits: string[] = [];
    gw.onSessionExit((id) => exits.push(id));
    fake.fireExit('session.ended');
    expect(exits).toEqual([ORCHESTRATOR_AGENT_ID]);
  });
});

function makeSpyGateway(tag: string): SessionGateway & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    getSessionId: vi.fn(async () => `${tag}-sid`),
    getSessionMeta: vi.fn(async () => ({ title: tag })),
    isAgentReady: vi.fn(async () => true),
    submitPrompt: vi.fn(async () => {
      calls.push(`${tag}:submitPrompt`);
    }),
    submitAnswer: vi.fn(async () => {
      calls.push(`${tag}:submitAnswer`);
    }),
    setForwarding: vi.fn(() => {
      calls.push(`${tag}:setForwarding`);
    }),
    respondPermission: vi.fn(async () => {
      calls.push(`${tag}:respondPermission`);
    }),
    onAgentEvent: vi.fn(() => () => {}),
    onSessionExit: vi.fn(() => () => {}),
  } as unknown as SessionGateway & { calls: string[] };
}

describe('CompositeSessionGateway routing', () => {
  it('routes the synthetic key to the orchestrator gateway and everything else to the office gateway', async () => {
    const office = makeSpyGateway('office');
    const orch = makeSpyGateway('orch');
    const gw = new CompositeSessionGateway(office, orch);

    await gw.submitPrompt(...OK, 'hi');
    await gw.respondPermission(...OK, 'tc', 'approve');
    await gw.submitPrompt('office-0', 'generalist', 'yo');

    expect(orch.calls).toEqual(['orch:submitPrompt', 'orch:respondPermission']);
    expect(office.calls).toEqual(['office:submitPrompt']);
  });

  it('fans in event + exit subscriptions from both gateways', () => {
    const office = makeSpyGateway('office');
    const orch = makeSpyGateway('orch');
    const gw = new CompositeSessionGateway(office, orch);
    const off = gw.onAgentEvent(() => {});
    gw.onSessionExit(() => {});
    expect(office.onAgentEvent).toHaveBeenCalled();
    expect(orch.onAgentEvent).toHaveBeenCalled();
    expect(office.onSessionExit).toHaveBeenCalled();
    expect(orch.onSessionExit).toHaveBeenCalled();
    off();
  });
});
