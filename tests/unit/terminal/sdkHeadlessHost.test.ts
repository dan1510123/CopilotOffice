import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import { describe, expect, it, vi } from 'vitest';
import {
  buildHeadlessHostArgs,
  CopilotSdkBackend,
  HeadlessPortParser,
  type StartTerminalOptions,
} from '../../../electron/terminal/terminal-backend';

function createMockProcess() {
  const proc = new EventEmitter() as EventEmitter & {
    stdout: PassThrough;
    stderr: PassThrough;
    stdin: PassThrough;
    killed: boolean;
    kill: ReturnType<typeof vi.fn>;
  };
  proc.stdout = new PassThrough();
  proc.stderr = new PassThrough();
  proc.stdin = new PassThrough();
  proc.killed = false;
  proc.kill = vi.fn(() => {
    proc.killed = true;
    return true;
  });
  return proc;
}

function startOptions(officeId: string, sessionId: string): StartTerminalOptions {
  return {
    officeId,
    sessionId,
    shell: 'powershell.exe',
    cols: 120,
    rows: 30,
    cwd: 'C:\\office',
    hostCwd: 'C:\\office',
    env: { PATH: 'C:\\tools', COPILOT_AUTO_UPDATE: 'true' },
  };
}

describe('headless SDK host', () => {
  it('parses a port announcement split across buffered chunks', () => {
    const parser = new HeadlessPortParser();
    expect(parser.push('booting\nCLI server listen')).toBeNull();
    expect(parser.push('ing on port 43127\n')).toBe(43127);
  });

  it('builds the headless CLI arguments without a foreground/TUI mode', () => {
    expect(buildHeadlessHostArgs(['--model', 'gpt-5.4'])).toEqual([
      '--model',
      'gpt-5.4',
      '--headless',
      '--port',
      '0',
      '--no-auto-update',
    ]);
  });

  it('reuses one spawned host and one client per office', async () => {
    const processes: ReturnType<typeof createMockProcess>[] = [];
    const spawnMock = vi.fn(() => {
      const proc = createMockProcess();
      processes.push(proc);
      queueMicrotask(() => {
        proc.stderr.write('CLI server listening ');
        proc.stderr.write('on port 45678\n');
      });
      return proc;
    });
    const sessions = new Map<string, { sessionId: string; disconnect: ReturnType<typeof vi.fn>; on: () => () => void }>();
    const clients: MockClient[] = [];
    class MockClient {
      start = vi.fn(async () => {});
      stop = vi.fn(async () => []);
      resumeSession = vi.fn(async (sessionId: string) => {
        throw new Error(`missing ${sessionId}`);
      });
      createSession = vi.fn(async (config: Record<string, unknown>) => {
        if (config.sessionId === 'session-bad') {
          throw new Error('isolated session failure');
        }
        const session = {
          sessionId: String(config.sessionId),
          disconnect: vi.fn(async () => {}),
          on: () => () => {},
          send: vi.fn(async () => {}),
        };
        sessions.set(session.sessionId, session);
        return session;
      });
      constructor(readonly options: Record<string, unknown>) {
        clients.push(this);
      }
    }
    const forUri = vi.fn((uri: string) => ({ uri }));
    const backend = new CopilotSdkBackend(
      MockClient,
      { forUri },
      async () => ({ kind: 'approved' }),
      'C:\\tools\\copilot.exe',
      'C:\\repo',
      spawnMock as never,
    );

    const firstProcess = await backend.start(startOptions('office-a', 'session-a'));
    await backend.start(startOptions('office-a', 'session-b'));

    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(clients).toHaveLength(1);
    expect(clients[0].start).toHaveBeenCalledTimes(1);
    expect(clients[0].createSession).toHaveBeenCalledTimes(2);
    expect(forUri).toHaveBeenCalledWith('localhost:45678');
    expect(spawnMock).toHaveBeenCalledWith(
      'C:\\tools\\copilot.exe',
      ['--headless', '--port', '0', '--no-auto-update'],
      expect.objectContaining({
        shell: false,
        cwd: 'C:\\office',
        env: expect.objectContaining({ COPILOT_AUTO_UPDATE: 'false' }),
      }),
    );

    await expect(backend.start(startOptions('office-a', 'session-bad')))
      .rejects.toThrow('isolated session failure');
    await backend.start(startOptions('office-a', 'session-c'));
    expect(spawnMock).toHaveBeenCalledTimes(1);
    expect(clients[0].stop).not.toHaveBeenCalled();

    const exitListener = vi.fn();
    firstProcess.onExit(exitListener);
    processes[0].emit('exit', 1, null);
    await Promise.resolve();
    expect(exitListener).toHaveBeenCalledWith({ exitCode: 1 });
    expect(clients[0].stop).toHaveBeenCalledTimes(1);
  });
});
