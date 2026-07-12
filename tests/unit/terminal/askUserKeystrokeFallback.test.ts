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

  it('degraded node-pty path does NOT resolve a pending user-input by requestId', () => {
    // On node-pty there is no requestId; a spurious handlePendingUserInput('') is a no-op.
    const handler = makeUserInputHandler();
    void handler({ requestId: 'req-1' });
    expect(handlePendingUserInput('', { answer: 'x', wasFreeform: false })).toBe(false);
    // the real SDK requestId is still resolvable (proving the '' no-op didn't consume it).
    expect(handlePendingUserInput('req-1', { answer: 'Yes', wasFreeform: false })).toBe(true);
  });
});
