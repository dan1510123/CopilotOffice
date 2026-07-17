// spec 017 — T037. Gate + relay parity for the act-on tools, plus FR-025 typed
// failures. The always-on gate must raise a prompt for EVERY gated tool (never
// consulting YOLO), record the approve/deny decision to the transcript (FR-023),
// leave pending gates open on minimize only while Teams-relay is active, and
// resolve in-flight act-on round-trips as a typed `failed` on teardown (never hang).

import { describe, expect, it, vi } from 'vitest';
import {
  OrchestratorSessionManager,
  type OrchestratorEmitter,
} from '../../../electron/orchestrator/orchestratorSessionManager';
import { InMemoryOrchestratorTranscriptStore } from '../../../electron/orchestrator/orchestratorTranscriptStore';
import type { OrchestratorTranscriptStore } from '../../../electron/orchestrator/orchestratorTranscriptStore';
import type { ActOnResult } from '../../../electron/orchestrator/types';
import * as yoloMode from '../../../src/config/yoloMode';
import type { PermissionRequest, PermissionRequestResult } from '@github/copilot-sdk';

const GATED = [
  'bring_agent_online',
  'answer_agent',
  'send_prompt_to_agent',
  'stop_agent',
  'restart_agent',
  'set_agent_teams_presence',
];

interface Captured {
  toolCallId: string;
  toolName: string;
}

function makeManager(store?: OrchestratorTranscriptStore) {
  const captured: Captured[] = [];
  const emitter: OrchestratorEmitter = {
    emitEvent: () => {},
    emitPermissionRequest: (p) => captured.push({ toolCallId: p.toolCallId, toolName: p.toolName }),
    emitCandidatesRequest: () => {},
    emitExecuteRequest: () => {},
    emitExit: () => {},
    emitStopAgentRequest: () => {},
  };
  const manager = new OrchestratorSessionManager(emitter, '.', store ?? null);
  return { manager, captured };
}

function req(toolName: string): PermissionRequest {
  return {
    kind: 'custom-tool',
    toolName,
    toolCallId: `call-${toolName}`,
    toolDescription: toolName,
    args: { agentId: 'coder', reason: 'because' },
  } as PermissionRequest;
}

function handlerOf(m: OrchestratorSessionManager) {
  return (m as unknown as {
    permissionHandler: (r: PermissionRequest, i?: unknown) => PermissionRequestResult | Promise<PermissionRequestResult>;
  }).permissionHandler;
}

describe('act-on gate parity', () => {
  it('raises a prompt for EVERY gated tool without consulting YOLO', async () => {
    const yoloSpy = vi.spyOn(yoloMode, 'isYoloEnabled').mockReturnValue(true);
    const { manager, captured } = makeManager();
    const results: Array<Promise<PermissionRequestResult>> = [];
    for (const tool of GATED) {
      results.push(handlerOf(manager)(req(tool)) as Promise<PermissionRequestResult>);
    }
    expect(captured.map((c) => c.toolName).sort()).toEqual([...GATED].sort());
    expect(yoloSpy).not.toHaveBeenCalled();
    // drain
    for (const c of captured) manager.respondToPermission({ toolCallId: c.toolCallId, decision: 'approve' });
    await Promise.all(results);
    vi.restoreAllMocks();
  });

  it('records approve/deny decisions to the transcript (FR-023)', async () => {
    const store = new InMemoryOrchestratorTranscriptStore();
    const { manager } = makeManager(store);
    (manager as unknown as { initTranscript(s: string): void }).initTranscript('s1');

    const approved = handlerOf(manager)(req('answer_agent')) as Promise<PermissionRequestResult>;
    manager.respondToPermission({ toolCallId: 'call-answer_agent', decision: 'approve' });
    await approved;

    const denied = handlerOf(manager)(req('stop_agent')) as Promise<PermissionRequestResult>;
    manager.respondToPermission({ toolCallId: 'call-stop_agent', decision: 'deny' });
    await denied;

    const turns = manager.getTranscript()?.turns ?? [];
    const gateTurns = turns.filter((t) => t.role === 'tool' && t.tool?.name);
    expect(gateTurns.find((t) => t.tool?.name === 'answer_agent')?.tool?.outcome).toBe('approved');
    expect(gateTurns.find((t) => t.tool?.name === 'stop_agent')?.tool?.outcome).toBe('denied');
  });
});

describe('minimize (close) vs Teams-relay parity', () => {
  it('denies pending gates on minimize when NOT relaying to Teams', async () => {
    const { manager } = makeManager();
    const result = handlerOf(manager)(req('answer_agent')) as Promise<PermissionRequestResult>;
    manager.close();
    await expect(result).resolves.toEqual({ kind: 'denied-interactively-by-user' });
  });

  it('leaves pending gates OPEN on minimize while Teams-relay is active', async () => {
    const { manager } = makeManager();
    const result = handlerOf(manager)(req('answer_agent')) as Promise<PermissionRequestResult>;
    manager.setTeamsRelayActive(true);
    manager.close();
    // Still pending → the in-thread approver can respond after minimize.
    expect(manager.respondToPermission({ toolCallId: 'call-answer_agent', decision: 'approve' })).toBe(true);
    await expect(result).resolves.toEqual({ kind: 'approved' });
  });
});

describe('FR-025 typed failures', () => {
  it('resolves an in-flight act-on round-trip as typed failed on endSession (never hangs)', async () => {
    const { manager } = makeManager();
    const pending = (manager as unknown as {
      requestActOn(tool: string, args: { agentId: string }): Promise<ActOnResult>;
    }).requestActOn('stop_agent', { agentId: 'coder' });
    await manager.endSession();
    const res = await pending;
    expect(res.outcome).toBe('failed');
  });
});
