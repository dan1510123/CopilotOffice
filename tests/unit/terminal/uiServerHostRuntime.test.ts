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

  it('transitions to crashed status when the runtime exits before listening', async () => {
    let exitCb: ((e: { exitCode: number }) => void) | undefined;
    const pty = {
      spawn: () => ({
        pid: 1,
        onData: () => { /* never */ },
        onExit: (cb: (e: { exitCode: number }) => void) => { exitCb = cb; },
        write: () => {}, resize: () => {}, kill: () => {},
      }),
    } as unknown as typeof import('node-pty');
    const runtime = new UiServerHostRuntime('office-z', pty, 'copilot', process.cwd(), opts, 5000);
    const rejected = expect(runtime.whenListening()).rejects.toThrow(/exited before ready/i);
    exitCb?.({ exitCode: 193 });
    await rejected;
    expect(runtime.status).toBe('crashed');
  });
});

/**
 * Promo-modal dismissal: the CLI's once-per-day "install the desktop app?"
 * interstitial blocks --ui-server startup by waiting on stdin. The host runtime
 * must dismiss it with "n" so the runtime proceeds to bind its port.
 */
function makeDrivablePty() {
  let dataCb: ((d: string) => void) | undefined;
  const writes: string[] = [];
  const pty = {
    spawn: () => ({
      pid: 4242,
      onData: (cb: (d: string) => void) => { dataCb = cb; },
      onExit: () => { /* never */ },
      write: (d: string) => { writes.push(d); },
      resize: () => {}, kill: () => {},
    }),
  } as unknown as typeof import('node-pty');
  return { pty, emit: (d: string) => dataCb?.(d), writes };
}

describe('UiServerHostRuntime promo-modal dismissal', () => {
  it('sends ESC once when the install promo appears, then resolves on the port', async () => {
    const { pty, emit, writes } = makeDrivablePty();
    const runtime = new UiServerHostRuntime('office-p', pty, 'copilot', process.cwd(), opts, 5000);

    emit('Now generally available! Would you like to install it?');
    expect(writes).toEqual(['\x1b']);

    // A second promo-ish chunk must NOT trigger another dismissal.
    emit('Yes, install');
    expect(writes).toEqual(['\x1b']);

    emit('listening on port 51234\r\n');
    await expect(runtime.whenListening()).resolves.toBe(51234);
    expect(runtime.status).toBe('listening');
  });

  it('detects the promo even when the prompt straddles PTY chunk boundaries', async () => {
    const { pty, emit, writes } = makeDrivablePty();
    const runtime = new UiServerHostRuntime('office-q', pty, 'copilot', process.cwd(), opts, 5000);

    emit('...would you like to inst');
    emit('all it? [Yes] [No]');
    expect(writes).toEqual(['\x1b']);

    emit('listening on port 6000\r\n');
    await expect(runtime.whenListening()).resolves.toBe(6000);
  });

  it('does not write anything when no promo appears', async () => {
    const { pty, emit, writes } = makeDrivablePty();
    const runtime = new UiServerHostRuntime('office-r', pty, 'copilot', process.cwd(), opts, 5000);

    emit('starting up...\r\n');
    emit('listening on port 7000\r\n');
    await expect(runtime.whenListening()).resolves.toBe(7000);
    expect(writes).toEqual([]);
  });

  it('does NOT dismiss if a single chunk carries both promo text and the port (server already live)', async () => {
    const { pty, emit, writes } = makeDrivablePty();
    const runtime = new UiServerHostRuntime('office-s', pty, 'copilot', process.cwd(), opts, 5000);

    // Port must win: no stray ESC injected into an already-listening runtime.
    emit('Would you like to install it?\r\nlistening on port 8080\r\n');
    await expect(runtime.whenListening()).resolves.toBe(8080);
    expect(writes).toEqual([]);
    expect(runtime.status).toBe('listening');
  });
});

/**
 * Additional-parameters passthrough: the app's override string (e.g.
 * "--model gpt-5.4") must be appended to the ui-server host launch, positioned
 * BEFORE the `--ui-server --port 0` control flags.
 */
function makeArgCapturingPty() {
  const captured: { cmd?: string; args?: string[] } = {};
  const pty = {
    spawn: (cmd: string, args: string[]) => {
      captured.cmd = cmd;
      captured.args = args;
      return {
        pid: 555,
        onData: () => { /* never emits */ },
        onExit: () => { /* never */ },
        write: () => {}, resize: () => {}, kill: () => {},
      };
    },
  } as unknown as typeof import('node-pty');
  return { pty, captured };
}

describe('UiServerHostRuntime extra-args passthrough', () => {
  it('appends extraArgs before the --ui-server control flags', () => {
    const { pty, captured } = makeArgCapturingPty();
    // eslint-disable-next-line no-new
    new UiServerHostRuntime('office-a', pty, 'copilot', process.cwd(), {
      ...opts,
      extraArgs: ['--model', 'gpt-5.4'],
    }, 5000);
    expect(captured.args).toEqual(['--model', 'gpt-5.4', '--ui-server', '--port', '0']);
  });

  it('spawns bare --ui-server flags when no extraArgs are provided', () => {
    const { pty, captured } = makeArgCapturingPty();
    // eslint-disable-next-line no-new
    new UiServerHostRuntime('office-b', pty, 'copilot', process.cwd(), opts, 5000);
    expect(captured.args).toEqual(['--ui-server', '--port', '0']);
  });

  it('filters out empty/whitespace-only extraArgs entries', () => {
    const { pty, captured } = makeArgCapturingPty();
    // eslint-disable-next-line no-new
    new UiServerHostRuntime('office-c', pty, 'copilot', process.cwd(), {
      ...opts,
      extraArgs: ['--allow-all-tools', '', '   '],
    }, 5000);
    expect(captured.args).toEqual(['--allow-all-tools', '--ui-server', '--port', '0']);
  });
});
