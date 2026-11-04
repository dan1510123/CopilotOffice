import { afterEach, describe, expect, it, vi } from 'vitest';
import { AgentLifecycle, type AgentLifecycleDeps, type AgentRuntimeState } from '../../../electron/orchestrator/agentLifecycle';
import { buildAgentCatalog } from '../../../src/office/agentCatalog';
import { DEFAULT_AGENTS } from '../../../src/config/agents';
import type { OfficeConfig } from '../../../src/office/officeManager';
import type { StartResult } from '../../../electron/terminal/protocol';
import { OrchestratorSessionManager, type OrchestratorEmitter } from '../../../electron/orchestrator/orchestratorSessionManager';
import type { PermissionHandler } from '@github/copilot-sdk';

function office(id: string, name: string): OfficeConfig {
  return {
    id, name, workingDirectory: `repo-${id}`, createdAt: 0, layout: 'default', seatedAgents: [],
    customAgents: [{ ...DEFAULT_AGENTS[0], id: `${id}-core`, name: 'Shared' }],
    customReserveAgents: { stool: { ...DEFAULT_AGENTS[0], id: `${id}-reserve`, name: `${name} reserve` } },
  };
}

function harness() {
  const offices = [office('office-1', 'One'), office('office-2', 'Two')];
  const states: Record<string, Record<string, AgentRuntimeState>> = {};
  const order: string[] = [];
  const deps: AgentLifecycleDeps = {
    getOffices: vi.fn(async () => offices),
    getStatuses: vi.fn(async (id) => states[id] ?? {}),
    ensureSeat: vi.fn(async () => { order.push('seat'); }),
    ensureSession: vi.fn(async (agent) => {
      order.push('ready');
      return { success: true, ready: true, sessionId: `session-${agent.agentId}` };
    }),
    teamsPreflight: vi.fn(async () => { order.push('preflight'); }),
    registerTeams: vi.fn(async () => {
      order.push('teams');
      return { success: true, state: 'online', threadWebUrl: 'thread-url' };
    }),
    stopTeams: vi.fn(async () => ({ success: true })),
  };
  return { lifecycle: new AgentLifecycle(deps), deps, offices, states, order };
}

describe('global office-independent agent acquisition', () => {
  afterEach(() => vi.useRealTimers());
  it('uses each office custom roster, not the displayed global roster', async () => {
    const h = harness();
    const candidates = await h.lifecycle.candidates('office-2');
    expect(candidates.map((c) => c.agentId)).toEqual(['office-2-core', 'office-2-reserve']);
    expect(candidates.every((c) => c.officeId === 'office-2')).toBe(true);
    expect(buildAgentCatalog(h.offices).filter((c) => c.source === 'reserve')).toHaveLength(2);
  });

  it('excludes both live and starting sessions but not inactive persisted histories', async () => {
    const h = harness();
    h.states['office-1'] = {
      'office-1-core': { alive: true, ready: true, inTurn: false },
      'office-1-reserve': { alive: false, ready: false, inTurn: false, starting: true },
    };
    expect((await h.lifecycle.candidates()).map((c) => c.agentId)).toEqual(['office-2-core', 'office-2-reserve']);
  });

  it('rejects ambiguous names across offices and invalid explicit offices before mutation', async () => {
    const h = harness();
    expect((await h.lifecycle.bringOnline('Shared')).outcome).toBe('ambiguous-target');
    expect((await h.lifecycle.bringOnline('Shared', 'unknown')).outcome).toBe('invalid-target');
    expect(h.deps.ensureSession).not.toHaveBeenCalled();
    expect(h.deps.ensureSeat).not.toHaveBeenCalled();
  });

  it('does not default unnamed acquisition to the first candidate', async () => {
    const h = harness();
    expect((await h.lifecycle.bringOnline('')).outcome).toBe('ambiguous-target');
    expect(h.deps.ensureSession).not.toHaveBeenCalled();
  });

  it('starts an inactive reserve then awaits actual readiness before Teams in one operation', async () => {
    const h = harness();
    let ready!: (value: StartResult) => void;
    h.deps.ensureSession = vi.fn(() => new Promise((resolve) => { ready = resolve; }));
    const pending = h.lifecycle.run({ agentId: 'office-2-reserve', officeId: 'office-2', online: true, requireInactive: true });
    await vi.waitFor(() => expect(h.deps.ensureSession).toHaveBeenCalledTimes(1));
    expect(h.deps.registerTeams).not.toHaveBeenCalled();
    ready({ success: true, ready: true, sessionId: 'session-new' });
    const result = await pending;
    expect(result).toMatchObject({ outcome: 'online-in-teams', officeId: 'office-2', ready: true, activated: true });
    expect(h.order).toEqual(['preflight', 'seat', 'teams']);
    expect(h.deps.registerTeams).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'office-2-reserve' }), 'session-new', expect.any(Number));
    expect(h.deps.ensureSession).toHaveBeenCalledWith(expect.objectContaining({ officeId: 'office-2' }), true, expect.any(Number));
  });

  it('does not restart an already-active agent or repurpose it as a new agent to Teams', async () => {
    const h = harness();
    h.states['office-1'] = { 'office-1-core': { alive: true, ready: true, inTurn: true } };
    expect((await h.lifecycle.bringOnline('office-1-core', 'office-1')).outcome).toBe('already-active');
    expect((await h.lifecycle.run({ agentId: 'office-1-core', officeId: 'office-1', online: true, requireInactive: true })).outcome)
      .toBe('target-became-active');
    expect(h.deps.ensureSession).not.toHaveBeenCalled();
    expect(h.deps.registerTeams).not.toHaveBeenCalled();
  });

  it('Teams-only can reuse a named existing session', async () => {
    const h = harness();
    h.states['office-1'] = { 'office-1-core': { alive: true, ready: true, inTurn: false } };
    h.deps.ensureSession = vi.fn(async () => ({ success: true, ready: true, sessionId: 'existing', reused: true }));
    const result = await h.lifecycle.run({ agentId: 'office-1-core', online: true });
    expect(result).toMatchObject({ outcome: 'online-in-teams', activated: false, sessionId: 'existing' });
    expect(h.deps.ensureSession).toHaveBeenCalledWith(expect.anything(), false, expect.any(Number));
  });

  it('does not accept a saved ID or create a Teams thread after readiness failure', async () => {
    const h = harness();
    h.deps.ensureSession = vi.fn(async () => ({ success: true, ready: false, sessionId: 'persisted' }));
    const result = await h.lifecycle.run({ agentId: 'office-2-core', online: true, requireInactive: true });
    expect(result.outcome).toBe('failed');
    expect(h.deps.registerTeams).not.toHaveBeenCalled();
  });

  it('coalesces identical acquisitions without a second session or thread', async () => {
    const h = harness();
    let ready!: (value: StartResult) => void;
    h.deps.ensureSession = vi.fn(() => new Promise((resolve) => { ready = resolve; }));
    const args = { agentId: 'office-2-reserve', officeId: 'office-2', online: true, requireInactive: true };
    const one = h.lifecycle.run(args);
    const two = h.lifecycle.run(args);
    await vi.waitFor(() => expect(h.deps.ensureSession).toHaveBeenCalledTimes(1));
    ready({ success: true, ready: true, sessionId: 'one' });
    expect(await one).toEqual(await two);
    expect(h.deps.ensureSeat).toHaveBeenCalledTimes(1);
    expect(h.deps.registerTeams).toHaveBeenCalledTimes(1);
  });

  it('reports pause and preserves the valid session on Teams failure', async () => {
    const h = harness();
    h.deps.registerTeams = vi.fn(async () => ({ success: true, state: 'paused', threadWebUrl: 'thread-url' }));
    expect((await h.lifecycle.run({ agentId: 'office-2-core', online: true })).outcome).toBe('paused');
    h.deps.registerTeams = vi.fn(async () => ({ success: false, error: 'Graph unavailable' }));
    const failed = await h.lifecycle.run({ agentId: 'office-2-core', online: true });
    expect(failed).toMatchObject({ outcome: 'failed', ready: true, sessionId: 'session-office-2-core' });
    expect(failed.message).toContain('Session ready; Teams registration failed');
  });

  it('does not guess inactive state when the server is unavailable', async () => {
    const h = harness();
    h.deps.getStatuses = vi.fn(async () => { throw new Error('Server unavailable'); });
    await expect(h.lifecycle.candidates()).rejects.toThrow('Server unavailable');
    expect((await h.lifecycle.bringOnline('office-1-core')).outcome).toBe('failed');
    expect(h.deps.ensureSession).not.toHaveBeenCalled();
  });

  it('reports unavailable Teams configuration before starting an inactive agent', async () => {
    const h = harness();
    h.deps.teamsPreflight = vi.fn(async () => { throw new Error('Teams is disabled'); });
    const result = await h.lifecycle.run({ agentId: 'office-2-reserve', online: true, requireInactive: true });
    expect(result).toMatchObject({ outcome: 'unavailable', message: expect.stringContaining('Teams is disabled') });
    expect(h.deps.ensureSeat).not.toHaveBeenCalled();
    expect(h.deps.ensureSession).not.toHaveBeenCalled();
  });

  it('a later Teams disconnect prevents a pending startup from registering Teams', async () => {
    const h = harness();
    let ready!: (value: StartResult) => void;
    h.deps.ensureSession = vi.fn(() => new Promise((resolve) => { ready = resolve; }));
    const pending = h.lifecycle.run({ agentId: 'office-2-core', online: true, requireInactive: true });
    await vi.waitFor(() => expect(h.deps.ensureSession).toHaveBeenCalledTimes(1));
    expect((await h.lifecycle.run({ agentId: 'office-2-core', online: false })).outcome).toBe('taken-offline');
    ready({ success: true, ready: true, sessionId: 'ready-after-disconnect' });
    expect((await pending).outcome).toBe('failed');
    expect(h.deps.registerTeams).not.toHaveBeenCalled();
  });

  it('deadline expiry cannot lead to late Teams registration', async () => {
    vi.useFakeTimers();
    const h = harness();
    let ready!: (value: StartResult) => void;
    h.deps.ensureSession = vi.fn(() => new Promise((resolve) => { ready = resolve; }));
    const pending = h.lifecycle.run({ agentId: 'office-2-core', online: true, requireInactive: true });
    await vi.advanceTimersByTimeAsync(1);
    expect(h.deps.ensureSession).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect((await pending).outcome).toBe('failed');
    ready({ success: true, ready: true, sessionId: 'too-late' });
    await vi.advanceTimersByTimeAsync(1);
    expect(h.deps.registerTeams).not.toHaveBeenCalled();
  });
});

describe('Ringleader main-process approval boundary', () => {
  afterEach(() => vi.useRealTimers());

  function managerFor(lifecycle: AgentLifecycle) {
    const emitter: OrchestratorEmitter = {
      emitEvent: vi.fn(), emitPermissionRequest: vi.fn(), emitCandidatesRequest: vi.fn(),
      emitExecuteRequest: vi.fn(), emitOfficesRequest: vi.fn(), emitSwitchRequest: vi.fn(), emitExit: vi.fn(),
    };
    const manager = new OrchestratorSessionManager(emitter, '.');
    manager.setAgentLifecycle(lifecycle);
    const gate = (manager as unknown as { permissionHandler: PermissionHandler }).permissionHandler;
    return { manager, emitter, gate };
  }

  it('pins canonical office/agent before approval and rechecks inactive state after approval', async () => {
    const h = harness();
    const { manager, emitter, gate } = managerFor(h.lifecycle);
    const pending = gate({
      kind: 'custom-tool', toolName: 'set_agent_teams_presence', toolCallId: 'new-agent',
      toolDescription: '', args: { agentId: 'Two reserve', online: true, requireInactive: true },
    }, { sessionId: 'ringleader' });
    await vi.waitFor(() => expect(emitter.emitPermissionRequest).toHaveBeenCalledTimes(1));
    expect(emitter.emitPermissionRequest).toHaveBeenCalledWith(expect.objectContaining({
      args: expect.objectContaining({ agentId: 'office-2-reserve', officeId: 'office-2' }),
    }));
    h.states['office-2'] = { 'office-2-reserve': { alive: true, ready: true, inTurn: false } };
    manager.respondToPermission({ toolCallId: 'new-agent', decision: 'approve' });
    expect(await pending).toEqual({ kind: 'approved' });
    expect((await h.lifecycle.run({ agentId: 'office-2-reserve', officeId: 'office-2', online: true, requireInactive: true })).outcome)
      .toBe('target-became-active');
    expect(h.deps.ensureSession).not.toHaveBeenCalled();
  });

  it('rejects ambiguous global acquisition before showing a misleading approval', async () => {
    const h = harness();
    const { emitter, gate } = managerFor(h.lifecycle);
    const result = await gate({
      kind: 'custom-tool', toolName: 'bring_agent_online', toolCallId: 'ambiguous',
      toolDescription: '', args: { agentId: 'Shared' },
    }, { sessionId: 'ringleader' });
    expect(result.kind).toBe('reject');
    expect(emitter.emitPermissionRequest).not.toHaveBeenCalled();
  });

  it('rejects an already-active target before asking for bring-online approval', async () => {
    const h = harness();
    h.states['office-2'] = { 'office-2-core': { alive: true, ready: true, inTurn: false } };
    const { emitter, gate } = managerFor(h.lifecycle);
    const result = await gate({
      kind: 'custom-tool', toolName: 'bring_agent_online', toolCallId: 'active-target',
      toolDescription: '', args: { agentId: 'office-2-core', officeId: 'office-2' },
    }, { sessionId: 'ringleader' });
    expect(result.kind).toBe('reject');
    expect(emitter.emitPermissionRequest).not.toHaveBeenCalled();
    expect(h.deps.ensureSession).not.toHaveBeenCalled();
  });

  it('bounds missing renderer listeners and rejects late seat acknowledgments', async () => {
    vi.useFakeTimers();
    const h = harness();
    const { manager } = managerFor(h.lifecycle);
    const failed = manager.ensureSeat('office-2', 'office-2-reserve', 'stool', Date.now() + 100);
    const assertion = expect(failed).rejects.toThrow('timed out');
    await vi.advanceTimersByTimeAsync(100);
    await assertion;
    expect(manager.respondSeat('unknown', { success: true })).toBe(false);
  });
});
