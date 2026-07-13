import { describe, expect, it, vi } from 'vitest';
import { answerTransport, handlePendingUserInput, makeUserInputHandler } from '../../../electron/terminal/terminal-backend';

// spec 015 (research.md Decision 1 + summary): the server's submit-answer routing.
// SDK/ui-server backends expose `submitPrompt` → resolve the pending interaction by
// requestId via handlePendingUserInput. The raw node-pty backend omits `submitPrompt`
// → the answer is typed onto the TUI input line via keystroke injection (degraded,
// no requestId). `answerTransport` is the single source of truth for that decision.

describe('answerTransport — submit-answer backend routing (spec 015)', () => {
  it('routes a node-pty process (no submitPrompt) to keystroke injection', () => {
    const nodePty = { write: vi.fn() }; // raw PTY shape — no submitPrompt
    expect(answerTransport(nodePty as never)).toBe('keystroke');
  });

  it('routes an SDK/ui-server process (has submitPrompt) to handlePendingUserInput (sdk)', () => {
    const sdk = { submitPrompt: vi.fn() };
    expect(answerTransport(sdk as never)).toBe('sdk');
  });

  it('degraded node-pty path does NOT resolve a pending user-input for a foreign session', () => {
    // node-pty has no SDK resolver; resolving an unrelated session is a no-op and must
    // not consume the SDK session's pending interaction.
    const handler = makeUserInputHandler('sess-kf');
    void handler({ requestId: 'req-1' });
    expect(handlePendingUserInput('nodepty-sess', { answer: 'x', wasFreeform: false })).toBe(false);
    // the real SDK session is still resolvable (proving the foreign no-op didn't consume it).
    expect(handlePendingUserInput('sess-kf', { answer: 'Yes', wasFreeform: false })).toBe(true);
  });
});
