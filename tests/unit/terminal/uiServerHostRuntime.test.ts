import { describe, expect, it, vi } from 'vitest';
import { UiServerHostRuntime } from '../../../electron/terminal/terminal-backend';

/**
 * Regression guard for the T037 finding: a Copilot ui-server runtime that never
 * emits its control port MUST reject `whenListening()` cleanly (not crash the
 * process via an unhandled rejection). See the defensive `.catch` in the
 * UiServerHostRuntime constructor.
 */

// Minimal fake IPty whose spawned process never emits "listening on port".
function makeFakePty() {
  const proc = {
    pid: 999_999,
    onData: (_cb: (d: string) => void) => { /* never emits */ },
    onExit: (_cb: (e: { exitCode: number }) => void) => { /* never exits */ },
    write: () => { /* noop */ },
    resize: () => { /* noop */ },
    kill: () => { /* noop */ },
  };
  return { spawn: () => proc } as unknown as typeof import('node-pty');
}

const opts = { cols: 80, rows: 24, cwd: process.cwd(), env: { PATH: '' } };

describe('UiServerHostRuntime port-discovery failure (T037 regression)', () => {
  it('rejects whenListening() with a timeout error instead of crashing', async () => {
    const runtime = new UiServerHostRuntime('office-x', makeFakePty(), 'copilot', process.cwd(), opts, 30);
    await expect(runtime.whenListening()).rejects.toThrow(/Timed out waiting for Copilot UI server port/i);
    expect(runtime.status).toBe('crashed');
  });

  it('does not raise an unhandled rejection when no one awaits whenListening()', async () => {
    const onUnhandled = vi.fn();
    process.once('unhandledRejection', onUnhandled);

    // Construct and never await — the defensive .catch must keep this safe.
    // eslint-disable-next-line no-new
    new UiServerHostRuntime('office-y', makeFakePty(), 'copilot', process.cwd(), opts, 20);
    await new Promise((r) => setTimeout(r, 80));

    expect(onUnhandled).not.toHaveBeenCalled();
    process.removeListener('unhandledRejection', onUnhandled);
  });
});
