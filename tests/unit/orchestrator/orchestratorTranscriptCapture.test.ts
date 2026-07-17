// spec 017 — T008. Unit tests for transcript capture inside the session manager:
// user turns carry their origin (desktop/teams), tap-captured orchestrator/tool
// turns inherit the current origin, the record persists through the injected
// store, the retention bound trims oldest-first, and endSession closes the record
// (FR-005: the next open starts a fresh conversation).

import { describe, expect, it, vi } from 'vitest';
import {
  OrchestratorSessionManager,
  type OrchestratorEmitter,
} from '../../../electron/orchestrator/orchestratorSessionManager';
import { InMemoryOrchestratorTranscriptStore } from '../../../electron/orchestrator/orchestratorTranscriptStore';
import type { CopilotEvent } from '../../../electron/orchestrator/types';

function makeEmitter(): OrchestratorEmitter {
  return {
    emitEvent: () => {},
    emitPermissionRequest: () => {},
    emitCandidatesRequest: () => {},
    emitExecuteRequest: () => {},
    emitExit: () => {},
  };
}

interface Privates {
  initTranscript(sessionId: string): void;
  captureStreamEvent(event: CopilotEvent): void;
  session: unknown;
}
function priv(m: OrchestratorSessionManager): Privates {
  return m as unknown as Privates;
}

function make(store = new InMemoryOrchestratorTranscriptStore(), bound = 5000) {
  const m = new OrchestratorSessionManager(makeEmitter(), '.', store, bound);
  priv(m).initTranscript('s1');
  // Inject a fake SDK session so submitInput can run without a real runtime.
  priv(m).session = { sessionId: 's1', send: vi.fn().mockResolvedValue(undefined) };
  return { m, store };
}

describe('transcript capture', () => {
  it('captures a desktop user turn with origin=desktop', async () => {
    const { m } = make();
    await m.submitInput('hello', 'desktop');
    const t = m.getTranscript();
    expect(t?.turns).toHaveLength(1);
    expect(t?.turns[0]).toMatchObject({ role: 'user', origin: 'desktop', text: 'hello', seq: 0 });
  });

  it('tags a Teams-originated user turn with origin=teams', async () => {
    const { m } = make();
    await m.submitInput('do it', 'teams');
    expect(m.getTranscript()?.turns[0]).toMatchObject({ role: 'user', origin: 'teams' });
  });

  it('tap-captured orchestrator/tool turns inherit the current origin', async () => {
    const { m } = make();
    await m.submitInput('via teams', 'teams');
    priv(m).captureStreamEvent({ type: 'assistant.message', data: { content: 'on it' } } as CopilotEvent);
    priv(m).captureStreamEvent({ type: 'tool.execution_start', data: { toolName: 'get_active_agents' } } as CopilotEvent);
    const turns = m.getTranscript()?.turns ?? [];
    expect(turns.map((t) => t.role)).toEqual(['user', 'orchestrator', 'tool']);
    // Response turns inherit the origin of the driving prompt.
    expect(turns[1].origin).toBe('teams');
    expect(turns[2].tool).toMatchObject({ name: 'get_active_agents', outcome: 'started' });
    expect(turns.map((t) => t.seq)).toEqual([0, 1, 2]);
  });

  it('persists every turn to the injected store', async () => {
    const { m, store } = make();
    await m.submitInput('remember me', 'desktop');
    expect(store.load()?.turns).toHaveLength(1);
    expect(store.load()?.turns[0].text).toBe('remember me');
  });

  it('trims oldest-first to the retention bound', async () => {
    const { m } = make(new InMemoryOrchestratorTranscriptStore(), 3);
    for (let i = 0; i < 6; i++) await m.submitInput(`m${i}`, 'desktop');
    const turns = m.getTranscript()?.turns ?? [];
    expect(turns).toHaveLength(3);
    expect(turns.map((t) => t.text)).toEqual(['m3', 'm4', 'm5']);
  });

  it('endSession closes the record so the next getTranscript starts clean (FR-005)', async () => {
    const { m, store } = make();
    await m.submitInput('hi', 'desktop');
    await m.endSession();
    // Closed + cleared → no active conversation to replay.
    expect(m.getTranscript()).toBeNull();
    expect(store.load()).toBeNull();
  });

  it('treats a persisted CLOSED record as no active conversation', () => {
    const store = new InMemoryOrchestratorTranscriptStore({
      sessionId: 'old',
      lifecycle: 'closed',
      turns: [{ seq: 0, role: 'user', origin: 'desktop', text: 'old', at: 1 }],
      updatedAt: 1,
    });
    const m = new OrchestratorSessionManager(makeEmitter(), '.', store, 5000);
    // Direct read (no session) must not resurrect a closed record.
    expect(m.getTranscript()).toBeNull();
    // And a fresh init starts empty rather than reloading the closed turns.
    priv(m).initTranscript('s2');
    expect(m.getTranscript()?.turns).toHaveLength(0);
  });
});
