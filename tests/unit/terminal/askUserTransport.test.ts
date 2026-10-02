import { describe, expect, it, vi } from 'vitest';
import { answerTransport } from '../../../electron/terminal/terminal-backend';

// spec 015 (research.md Decision 1 + summary): the server's submit-answer routing.
// Native-bridge processes expose `submitAnswer` (bridge); SDK backends expose
// `submitPrompt` → resolve the pending interaction via handlePendingUserInput (sdk).
// The raw node-pty backend has no programmatic session → `null`, and the server
// answers with an explicit failure instead of typing the answer as keystrokes.
// `answerTransport` is the single source of truth for that decision.

describe('answerTransport — submit-answer backend routing (spec 015)', () => {
  it('reports no programmatic transport for a raw node-pty process (no keystroke fallback)', () => {
    const nodePty = { write: vi.fn() }; // raw PTY shape — no submitPrompt / submitAnswer
    expect(answerTransport(nodePty as never)).toBeNull();
    expect(nodePty.write).not.toHaveBeenCalled();
  });

  it('routes an SDK process (has submitPrompt) to handlePendingUserInput (sdk)', () => {
    const sdk = { submitPrompt: vi.fn() };
    expect(answerTransport(sdk as never)).toBe('sdk');
  });

  it('routes a native-bridge process (has submitAnswer) to its dedicated bridge command', () => {
    const bridge = { submitPrompt: vi.fn(), submitAnswer: vi.fn() };
    expect(answerTransport(bridge as never)).toBe('bridge');
  });
});
