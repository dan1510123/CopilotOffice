import { describe, expect, it, vi } from 'vitest';
import {
  elicitationTransport,
  makeElicitationHandler,
  handlePendingElicitation,
  clearPendingElicitationForSession,
  pendingElicitationCount,
} from '../../../electron/terminal/terminal-backend';

// The server's submit-elicitation routing mirrors submit-answer: native-bridge processes
// expose `submitElicitation` (bridge); SDK backends expose `submitPrompt` → resolve via
// handlePendingElicitation (sdk); the raw node-pty backend has neither → `null` (explicit
// failure, never keystrokes). The pending-resolver is keyed by sessionId (one blocking
// elicitation per session) and GC'd on session teardown.

describe('elicitationTransport — submit-elicitation backend routing', () => {
  it('reports no programmatic transport for a raw node-pty process', () => {
    const nodePty = { write: vi.fn() };
    expect(elicitationTransport(nodePty as never)).toBeNull();
  });

  it('routes an SDK process (has submitPrompt) to the sdk resolver', () => {
    expect(elicitationTransport({ submitPrompt: vi.fn() } as never)).toBe('sdk');
  });

  it('routes a native-bridge process (has submitElicitation) to its dedicated bridge command', () => {
    expect(elicitationTransport({ submitPrompt: vi.fn(), submitElicitation: vi.fn() } as never)).toBe('bridge');
  });
});

describe('SDK elicitation pending resolver (keyed by sessionId)', () => {
  it('resolves the blocked handler promise with the accepted content', async () => {
    const handler = makeElicitationHandler('sess-A');
    const pending = handler({ sessionId: 'sess-A', message: 'Q' } as never);
    expect(pendingElicitationCount()).toBeGreaterThanOrEqual(1);

    const resolved = handlePendingElicitation('sess-A', { action: 'accept', content: { scope: 'full' } });
    expect(resolved).toBe(true);
    await expect(pending).resolves.toEqual({ action: 'accept', content: { scope: 'full' } });
  });

  it('is idempotent: a second resolve for the same session is a no-op', () => {
    const handler = makeElicitationHandler('sess-B');
    void handler({ sessionId: 'sess-B', message: 'Q' } as never);
    expect(handlePendingElicitation('sess-B', { action: 'cancel' })).toBe(true);
    expect(handlePendingElicitation('sess-B', { action: 'cancel' })).toBe(false);
  });

  it('GCs an outstanding elicitation on session teardown', () => {
    const handler = makeElicitationHandler('sess-C');
    void handler({ sessionId: 'sess-C', message: 'Q' } as never);
    expect(clearPendingElicitationForSession('sess-C')).toBe(1);
    // already cleared → no resolver remains
    expect(handlePendingElicitation('sess-C', { action: 'cancel' })).toBe(false);
    expect(clearPendingElicitationForSession('sess-C')).toBe(0);
  });
});
