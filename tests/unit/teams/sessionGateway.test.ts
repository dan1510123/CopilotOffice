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
});
