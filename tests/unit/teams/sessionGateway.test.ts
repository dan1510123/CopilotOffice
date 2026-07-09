import { describe, expect, it, vi } from 'vitest';
import { EventEmitter } from 'events';
import { RelaySessionGateway, type TerminalRelayLike } from '../../../electron/teams/sessionGateway';

function makeRelay(overrides: Partial<TerminalRelayLike> = {}): TerminalRelayLike {
  const emitter = new EventEmitter();
  return {
    mainGetSessionId: vi.fn(async () => 'session-1'),
    mainGetSessionMeta: vi.fn(async () => ({ title: 'T' })),
    mainWrite: vi.fn(async () => ({ success: true })),
    mainSubmitPrompt: vi.fn(async () => ({ success: true })),
    mainSetAgentForwarding: vi.fn(() => {}),
    mainEvents: emitter as unknown as TerminalRelayLike['mainEvents'],
    ...overrides,
  };
}

describe('RelaySessionGateway.submitPrompt', () => {
  it('uses the atomic submit-prompt path, not raw write', async () => {
    const relay = makeRelay();
    const gw = new RelaySessionGateway(relay);
    await gw.submitPrompt('office-0', 'generalist', 'what is 2+2', 'Teams · Alice');
    expect(relay.mainSubmitPrompt).toHaveBeenCalledWith('office-0', 'generalist', 'what is 2+2', 'Teams · Alice');
    expect(relay.mainWrite).not.toHaveBeenCalled();
  });

  it('throws when the submit fails', async () => {
    const relay = makeRelay({ mainSubmitPrompt: vi.fn(async () => ({ success: false, error: 'No PTY' })) });
    const gw = new RelaySessionGateway(relay);
    await expect(gw.submitPrompt('o', 'a', 'hi')).rejects.toThrow(/No PTY/);
  });

  it('routes setForwarding to the relay', () => {
    const relay = makeRelay();
    const gw = new RelaySessionGateway(relay);
    gw.setForwarding('office-0', 'generalist', true);
    expect(relay.mainSetAgentForwarding).toHaveBeenCalledWith('office-0', 'generalist', true);
    gw.setForwarding('office-0', 'generalist', false);
    expect(relay.mainSetAgentForwarding).toHaveBeenCalledWith('office-0', 'generalist', false);
  });
});

describe('RelaySessionGateway.onAgentEvent', () => {
  it('maps copilot-user-message (with text) to a user-message AgentEvent', () => {
    const relay = makeRelay();
    const emitter = relay.mainEvents as unknown as EventEmitter;
    const gw = new RelaySessionGateway(relay);
    const events: unknown[] = [];
    const off = gw.onAgentEvent((e) => events.push(e));

    emitter.emit('copilot-user-message', 'generalist', 'refactor the parser');
    expect(events).toContainEqual({ agentId: 'generalist', kind: 'user-message', content: 'refactor the parser' });

    // Missing text degrades to an empty string (not undefined).
    emitter.emit('copilot-user-message', 'generalist');
    expect(events).toContainEqual({ agentId: 'generalist', kind: 'user-message', content: '' });

    off();
    events.length = 0;
    emitter.emit('copilot-user-message', 'generalist', 'after-unsub');
    expect(events).toHaveLength(0);
  });
});
