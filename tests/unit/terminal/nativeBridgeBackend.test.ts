import { EventEmitter } from 'events';
import * as net from 'net';
import * as path from 'path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  NATIVE_BRIDGE_ENV,
  NativeBridgeBroker,
} from '../../../electron/terminal/native-bridge-broker';
import {
  NativeBridgeBackend,
  NativeBridgeConsentResponder,
  NativeBridgeProcess,
  buildNativeBridgeArgs,
  buildNativeBridgeEnv,
  initializeNativeBridge,
  normalizeBridgeControlData,
  selectNativeBridgeBackend,
  type NativePty,
} from '../../../electron/terminal/native-bridge-backend';
import { NativeBridgeCapabilityError } from '../../../electron/terminal/native-bridge-capability';
import { answerTransport, type StartTerminalOptions } from '../../../electron/terminal/terminal-backend';

const FIXTURE_ROOT = path.resolve('native-bridge-fixture');
const CLI_PATH = path.join(FIXTURE_ROOT, 'node_modules', '@github', 'copilot-native', 'copilot');
const EXTENSION_SDK_PATH = path.join(FIXTURE_ROOT, 'node_modules', '@github', 'copilot-sdk', 'dist');
const REPO_ROOT = path.join(FIXTURE_ROOT, 'repo');
const REPO_BIN = path.join(REPO_ROOT, 'node_modules', '.bin');
const TOOLS_DIR = path.join(FIXTURE_ROOT, 'tools');
const AGENT_CWD = path.join(FIXTURE_ROOT, 'work', 'project');
const BRIDGE_CONSENT_PROMPT = `
Extension "user:copilot-office-bridge" wants to read 3 sensitive environment variables
COPILOT_OFFICE_BRIDGE_ENDPOINT
COPILOT_OFFICE_BRIDGE_NONCE
COPILOT_OFFICE_BRIDGE_TERMINAL_KEY
❯ 1. Yes
  2. Yes, and always allow these variables in this repo
  3. No (Esc)
`;

class FakePty implements NativePty {
  readonly written: string[] = [];
  readonly resized: Array<[number, number]> = [];
  private readonly emitter = new EventEmitter();
  killed = false;

  constructor(readonly pid: number) {}

  write(data: string): void {
    this.written.push(data);
  }

  resize(cols: number, rows: number): void {
    this.resized.push([cols, rows]);
  }

  onData(callback: (data: string) => void): void {
    this.emitter.on('data', callback);
  }

  onExit(callback: (event: { exitCode: number }) => void): void {
    this.emitter.on('exit', callback);
  }

  kill(): void {
    this.killed = true;
  }

  emitData(data: string): void {
    this.emitter.emit('data', data);
  }

  emitExit(exitCode: number): void {
    this.emitter.emit('exit', { exitCode });
  }
}

interface SpawnCall {
  file: string;
  args: string[];
  options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> };
  pty: FakePty;
}

interface BridgeRequest {
  id: string;
  command: string;
  params?: unknown;
}

/** Stands in for the bundled extension running inside one native TUI. */
class FakeExtension {
  readonly socket: net.Socket;
  readonly requests: BridgeRequest[] = [];
  readonly frames: Array<{ type?: string }> = [];
  handlers: Record<string, (params: unknown) => unknown> = {};
  private buffer = Buffer.alloc(0);
  private resolveRegistered!: () => void;
  private resolveClosed!: () => void;
  readonly registered = new Promise<void>((resolve) => { this.resolveRegistered = resolve; });
  readonly closed = new Promise<void>((resolve) => { this.resolveClosed = resolve; });
  private readonly sessionId: string;

  constructor(env: Record<string, string>, sessionId: string, parentPid: number) {
    this.sessionId = sessionId;
    this.socket = net.createConnection(env[NATIVE_BRIDGE_ENV.endpoint]);
    this.socket.on('connect', () => this.send({
      type: 'register',
      terminalKey: env[NATIVE_BRIDGE_ENV.terminalKey],
      token: env[NATIVE_BRIDGE_ENV.nonce],
      sessionId,
      parentPid,
    }));
    this.socket.on('data', (chunk: Buffer) => this.onData(chunk));
    this.socket.on('error', () => undefined);
    this.socket.on('close', () => this.resolveClosed());
  }

  emitEvent(event: unknown): void {
    this.send({ type: 'event', event });
  }

  close(): void {
    this.socket.destroy();
  }

  private send(value: unknown): void {
    this.socket.write(`${JSON.stringify(value)}\n`);
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (true) {
      const newline = this.buffer.indexOf(0x0a);
      if (newline === -1) return;
      const message = JSON.parse(this.buffer.subarray(0, newline).toString('utf8')) as {
        type?: string;
      } & BridgeRequest;
      this.buffer = this.buffer.subarray(newline + 1);
      this.frames.push(message);
      if (message.type === 'registered') {
        this.send({ type: 'ready', sessionId: this.sessionId });
      } else if (message.type === 'ready-ack') {
        this.resolveRegistered();
      }
      if (message.type !== 'request') continue;
      this.requests.push(message);
      void this.respond(message);
    }
  }

  private async respond(request: BridgeRequest): Promise<void> {
    const handler = this.handlers[request.command];
    try {
      if (!handler) throw new Error(`Unsupported bridge command: ${request.command}`);
      const result = await handler(request.params);
      this.send({ type: 'response', id: request.id, ok: true, result });
    } catch (error) {
      this.send({ type: 'response', id: request.id, ok: false, error: (error as Error).message });
    }
  }
}

const brokers: NativeBridgeBroker[] = [];
const extensions: FakeExtension[] = [];

afterEach(async () => {
  for (const extension of extensions.splice(0)) extension.close();
  for (const broker of brokers.splice(0)) await broker.close();
});

function startOptions(overrides: Partial<StartTerminalOptions> = {}): StartTerminalOptions {
  return {
    sessionId: 'session-a',
    officeId: 'office-a',
    terminalKey: 'office-a:generalist',
    shell: 'powershell.exe',
    cols: 120,
    rows: 30,
    cwd: AGENT_CWD,
    env: {
      PATH: [REPO_BIN, TOOLS_DIR].join(path.delimiter),
      COPILOT_OFFICE_AGENT: 'generalist',
      COPILOT_OFFICE_BRIDGE_ENDPOINT: 'stale-outer-office-endpoint',
      copilot_office_bridge_nonce: 'stale-outer-token',
    },
    yolo: true,
    extraArgs: ['--model', 'gpt-5.4'],
    ...overrides,
  };
}

async function createHarness(options: { connectTimeoutMs?: number } = {}) {
  const broker = await NativeBridgeBroker.create({ requestTimeoutMs: 2_000 });
  brokers.push(broker);
  const spawnCalls: SpawnCall[] = [];
  let nextPid = 41_000;
  const killTree = vi.fn((pty: NativePty) => (pty as FakePty).kill());
  const backend = new NativeBridgeBackend({
    spawn: (file, args, spawnOptions) => {
      const pty = new FakePty(nextPid++);
      spawnCalls.push({ file, args, options: spawnOptions, pty });
      return pty;
    },
    broker,
    cliPath: CLI_PATH,
    extensionSdkPath: EXTENSION_SDK_PATH,
    repoRoot: REPO_ROOT,
    connectTimeoutMs: options.connectTimeoutMs ?? 2_000,
    killTree,
  });
  const connect = (call: SpawnCall, sessionId: string, parentPid = call.pty.pid) => {
    const extension = new FakeExtension(call.options.env, sessionId, parentPid);
    extensions.push(extension);
    return extension;
  };
  return { broker, backend, spawnCalls, killTree, connect };
}

describe('native bridge launch contract', () => {
  it('recognizes only the exact bundled-extension environment consent prompt', () => {
    const responder = new NativeBridgeConsentResponder();

    expect(responder.push('\x1b[2JExtension "user:copilot-office-bridge" wants to read 3 sens')).toBe(false);
    expect(responder.push(`itive environment variables${BRIDGE_CONSENT_PROMPT.slice(
      BRIDGE_CONSENT_PROMPT.indexOf('\nCOPILOT_OFFICE_BRIDGE_ENDPOINT'),
    )}\x1b[0m`)).toBe(true);

    expect(responder.push(BRIDGE_CONSENT_PROMPT)).toBe(false);
    responder.arm();
    expect(responder.push(BRIDGE_CONSENT_PROMPT)).toBe(true);
  });

  it('does not approve other extensions, variable sets, or folder trust prompts', () => {
    const responder = new NativeBridgeConsentResponder();

    expect(responder.push(BRIDGE_CONSENT_PROMPT.replace(
      'user:copilot-office-bridge',
      'project:unknown-extension',
    ))).toBe(false);
    expect(responder.push(BRIDGE_CONSENT_PROMPT.replace(
      'COPILOT_OFFICE_BRIDGE_NONCE',
      'GITHUB_TOKEN',
    ))).toBe(false);
    expect(responder.push('Do you trust the files in this folder?\n❯ 1. Yes\n 2. No')).toBe(false);
  });

  it('builds the pinned native CLI arguments with the persisted session id', () => {
    expect(buildNativeBridgeArgs('session-a', EXTENSION_SDK_PATH, {
      yolo: true,
      extraArgs: ['--model', 'gpt-5.4', '  '],
    })).toEqual([
      '--session-id=session-a',
      '--experimental',
      '--extension-sdk-path',
      EXTENSION_SDK_PATH,
      '--secret-env-vars=COPILOT_OFFICE_BRIDGE_ENDPOINT,COPILOT_OFFICE_BRIDGE_TERMINAL_KEY,COPILOT_OFFICE_BRIDGE_NONCE',
      '--no-auto-update',
      '--yolo',
      '--model',
      'gpt-5.4',
    ]);
    expect(buildNativeBridgeArgs('session-b', EXTENSION_SDK_PATH)).not.toContain('--yolo');
  });

  it('builds a child env with fresh credentials only, a sanitized PATH and the auto-update pin', () => {
    const env = buildNativeBridgeEnv(
      {
        PATH: [REPO_BIN, TOOLS_DIR].join(path.delimiter),
        Path: 'unsanitized-duplicate',
        COPILOT_OFFICE_BRIDGE_TERMINAL_KEY: 'inherited',
        Copilot_Office_Bridge_Nonce: 'inherited-token',
        COPILOT_AUTO_UPDATE: 'true',
        KEEP: 'me',
      },
      {
        [NATIVE_BRIDGE_ENV.enabled]: '1',
        [NATIVE_BRIDGE_ENV.endpoint]: 'pipe',
        [NATIVE_BRIDGE_ENV.terminalKey]: 'key',
        [NATIVE_BRIDGE_ENV.nonce]: 'token',
      },
      REPO_ROOT,
      'win32',
    );

    expect(env).toEqual({
      KEEP: 'me',
      PATH: TOOLS_DIR,
      Path: TOOLS_DIR,
      COPILOT_AUTO_UPDATE: 'false',
      [NATIVE_BRIDGE_ENV.enabled]: '1',
      [NATIVE_BRIDGE_ENV.endpoint]: 'pipe',
      [NATIVE_BRIDGE_ENV.terminalKey]: 'key',
      [NATIVE_BRIDGE_ENV.nonce]: 'token',
    });
  });

  it('spawns the pinned binary directly under its own PTY and binds credentials to that pid', async () => {
    const { backend, broker, spawnCalls } = await createHarness();
    const bindSpy = vi.spyOn(broker, 'bindProcess');

    const proc = await backend.start(startOptions());

    expect(spawnCalls).toHaveLength(1);
    const [call] = spawnCalls;
    expect(call.file).toBe(CLI_PATH);
    expect(call.args).toEqual(buildNativeBridgeArgs('session-a', EXTENSION_SDK_PATH, {
      yolo: true,
      extraArgs: ['--model', 'gpt-5.4'],
    }));
    expect(call.options).toMatchObject({ name: 'xterm-256color', cols: 120, rows: 30, cwd: AGENT_CWD });
    expect(call.options.env.COPILOT_AUTO_UPDATE).toBe('false');
    expect(call.options.env[NATIVE_BRIDGE_ENV.enabled]).toBe('1');
    expect(call.options.env.COPILOT_OFFICE_AGENT).toBe('generalist');
    expect(call.options.env.PATH).toBe(TOOLS_DIR);
    expect(call.options.env[NATIVE_BRIDGE_ENV.endpoint]).toBe(broker.endpoint);
    expect(call.options.env[NATIVE_BRIDGE_ENV.terminalKey]).toMatch(/^office-a:generalist#[0-9a-f]{12}$/);
    expect(call.options.env[NATIVE_BRIDGE_ENV.nonce]).not.toBe('stale-outer-token');
    expect(call.options.env.copilot_office_bridge_nonce).toBeUndefined();
    expect(bindSpy).toHaveBeenCalledWith(call.options.env[NATIVE_BRIDGE_ENV.terminalKey], call.pty.pid);
    expect(proc.pid).toBe(call.pty.pid);
    expect(process.env[NATIVE_BRIDGE_ENV.endpoint]).toBeUndefined();
    expect(process.env[NATIVE_BRIDGE_ENV.nonce]).toBeUndefined();
  });

  it('keeps raw input, resize and output on the native PTY', async () => {
    const { backend, spawnCalls } = await createHarness();
    const proc = await backend.start(startOptions());
    const pty = spawnCalls[0].pty;
    const output = vi.fn();
    proc.onData(output);

    proc.write('/clear\r');
    proc.resize(100, 40);
    pty.emitData('\x1b[1mnative tui\x1b[0m');

    expect(pty.written).toEqual(['/clear\r']);
    expect(pty.resized).toEqual([[100, 40]]);
    expect(output).toHaveBeenCalledWith('\x1b[1mnative tui\x1b[0m');
  });

  it('accepts the exact bridge environment prompt for the current session', async () => {
    const { backend, spawnCalls } = await createHarness();
    const proc = await backend.start(startOptions());
    const pty = spawnCalls[0].pty;
    const output = vi.fn();
    proc.onData(output);

    pty.emitData(BRIDGE_CONSENT_PROMPT);

    expect(pty.written).toEqual(['\r']);
    expect(output).toHaveBeenCalledWith(BRIDGE_CONSENT_PROMPT);
  });
});

describe('native bridge programmatic routing', () => {
  it('awaits SDK prompt submission through the authenticated bridge', async () => {
    const { backend, spawnCalls, connect } = await createHarness();
    const proc = await backend.start(startOptions());
    const extension = connect(spawnCalls[0], 'session-a');
    extension.handlers.send = () => 'message-1';
    await extension.registered;

    await expect(proc.submitPrompt!('  line one\r\nline two  ', 'Teams · Alice')).resolves.toBeUndefined();

    expect(extension.requests).toEqual([
      expect.objectContaining({ command: 'send', params: { prompt: 'line one\nline two' } }),
    ]);
    expect(spawnCalls[0].pty.written).toEqual([]);
  });

  it('returns explicit errors when the bridge rejects or is not connected', async () => {
    const { backend, spawnCalls, connect } = await createHarness({ connectTimeoutMs: 50 });
    const proc = await backend.start(startOptions());

    await expect(proc.submitPrompt!('hello')).rejects.toThrow(/Copilot bridge is not connected/);
    expect(spawnCalls[0].pty.written).toEqual([]);

    const extension = connect(spawnCalls[0], 'session-a');
    extension.handlers.send = () => {
      throw new Error('session is busy');
    };
    await extension.registered;
    await expect(proc.submitPrompt!('hello')).rejects.toThrow('Copilot bridge send failed: session is busy');
  });

  it('routes session control and returns Teams ControlData', async () => {
    const { backend, spawnCalls, connect } = await createHarness();
    const proc = await backend.start(startOptions());
    const extension = connect(spawnCalls[0], 'session-a');
    extension.handlers['run-control'] = (params) => {
      const { command } = params as { command: string };
      if (command === 'usage') {
        return { kind: 'usage', premiumRequestCost: 2, userRequests: 3, totalTokens: 1200, injected: '<b>' };
      }
      if (command === 'model') return { kind: 'model', current: 'gpt-5.4', switchedTo: 'gpt-5.4' };
      return { kind: 'usage' };
    };
    await extension.registered;

    await expect(proc.runControl!({ command: 'usage' })).resolves.toEqual({
      kind: 'usage',
      premiumRequestCost: 2,
      userRequests: 3,
      totalTokens: 1200,
    });
    await expect(proc.runControl!({ command: 'model', arg: 'gpt-5.4' })).resolves.toEqual({
      kind: 'model',
      current: 'gpt-5.4',
      switchedTo: 'gpt-5.4',
    });
    await expect(proc.runControl!({ command: 'compact' })).rejects.toThrow('returned a usage result for /compact');
    expect(extension.requests.map((request) => request.params)).toEqual([
      { command: 'usage' },
      { command: 'model', arg: 'gpt-5.4' },
      { command: 'compact' },
    ]);
  });

  it('routes ask_user answers and plan decisions to their dedicated bridge commands', async () => {
    const { backend, spawnCalls, connect } = await createHarness();
    const proc = await backend.start(startOptions());
    const extension = connect(spawnCalls[0], 'session-a');
    let pendingAnswer = true;
    extension.handlers['submit-answer'] = () => {
      if (!pendingAnswer) throw new Error('No pending user-input request');
      pendingAnswer = false;
      return { resolved: true };
    };
    extension.handlers['submit-plan-decision'] = () => ({ resolved: true });
    await extension.registered;

    expect(answerTransport(proc)).toBe('bridge');
    await proc.submitAnswer!({ requestId: 'ask-1', answer: 'Yes', wasFreeform: false });
    await expect(proc.submitAnswer!({ requestId: 'ask-1', answer: 'again', wasFreeform: true }))
      .rejects.toThrow('No pending user-input request');
    await proc.submitPlanDecision!({ requestId: 'plan-1', approved: false, feedback: 'split step 2' });

    expect(extension.requests.map(({ command, params }) => ({ command, params }))).toEqual([
      { command: 'submit-answer', params: { requestId: 'ask-1', answer: 'Yes', wasFreeform: false } },
      { command: 'submit-answer', params: { requestId: 'ask-1', answer: 'again', wasFreeform: true } },
      { command: 'submit-plan-decision', params: { requestId: 'plan-1', approved: false, feedback: 'split step 2' } },
    ]);
  });

  it('keeps agent TUIs independent: separate PTYs, credentials and routing', async () => {
    const { backend, spawnCalls, connect } = await createHarness();
    const gene = await backend.start(startOptions());
    const dan = await backend.start(startOptions({
      sessionId: 'session-b',
      terminalKey: 'office-a:debugger',
      cwd: path.join(FIXTURE_ROOT, 'work', 'other'),
    }));
    const geneExtension = connect(spawnCalls[0], 'session-a');
    const danExtension = connect(spawnCalls[1], 'session-b');
    geneExtension.handlers.send = () => 'gene';
    danExtension.handlers.send = () => 'dan';
    await Promise.all([geneExtension.registered, danExtension.registered]);

    await gene.submitPrompt!('for gene');
    await dan.submitPrompt!('for dan');

    expect(gene.pid).not.toBe(dan.pid);
    expect(spawnCalls[0].options.env[NATIVE_BRIDGE_ENV.nonce])
      .not.toBe(spawnCalls[1].options.env[NATIVE_BRIDGE_ENV.nonce]);
    expect(spawnCalls[1].options.cwd).toBe(path.join(FIXTURE_ROOT, 'work', 'other'));
    expect(geneExtension.requests.map((request) => request.params)).toEqual([{ prompt: 'for gene' }]);
    expect(danExtension.requests.map((request) => request.params)).toEqual([{ prompt: 'for dan' }]);
  });

  it('rejects a nested CLI that inherited the TUI credentials but is not its direct child', async () => {
    const { backend, spawnCalls, connect } = await createHarness({ connectTimeoutMs: 50 });
    const proc = await backend.start(startOptions());
    const sessionChanges = vi.fn();
    proc.onSessionChange!(sessionChanges);

    const nested = connect(spawnCalls[0], 'nested-session', spawnCalls[0].pty.pid + 1);
    await nested.closed;

    expect(nested.frames).toEqual([{ type: 'registration-error', error: 'authentication failed' }]);
    expect(sessionChanges).not.toHaveBeenCalled();
    await expect(proc.whenReady!(50)).rejects.toThrow(/Timed out/);
  });
});

describe('native bridge session lifecycle', () => {
  it('treats readiness as a live bridge connection, not a latched PTY state', async () => {
    const { backend, spawnCalls, connect } = await createHarness();
    const proc = await backend.start(startOptions());
    const first = connect(spawnCalls[0], 'session-a');
    await first.registered;
    await expect(proc.whenReady!(100)).resolves.toBeUndefined();

    first.close();
    await first.closed;
    await new Promise((resolve) => setTimeout(resolve, 20));
    await expect(proc.whenReady!(30)).rejects.toThrow(/Timed out/);

    const reconnected = connect(spawnCalls[0], 'session-a');
    await reconnected.registered;
    await expect(proc.whenReady!(100)).resolves.toBeUndefined();
  });

  it('reports the authoritative session on connect and on /clear replacement, routing only to the new generation', async () => {
    const { backend, spawnCalls, connect } = await createHarness();
    const proc = await backend.start(startOptions());
    const changes: unknown[] = [];
    proc.onSessionChange!((change) => changes.push(change));

    const first = connect(spawnCalls[0], 'session-a');
    first.handlers.send = () => 'stale';
    await first.registered;
    await proc.whenReady!(1_000);

    const second = connect(spawnCalls[0], 'session-cleared');
    second.handlers.send = () => 'current';
    await second.registered;
    await first.closed;
    await proc.submitPrompt!('after clear');

    expect(changes).toEqual([
      { sessionId: 'session-a' },
      { sessionId: 'session-cleared', previousSessionId: 'session-a' },
    ]);
    expect(first.frames).toContainEqual({ type: 'replaced' });
    expect(first.requests).toHaveLength(0);
    expect(second.requests).toHaveLength(1);
    expect((proc as NativeBridgeProcess).getSessionId()).toBe('session-cleared');

    const late = vi.fn();
    proc.onSessionChange!(late);
    expect(late).toHaveBeenCalledWith({ sessionId: 'session-cleared', previousSessionId: 'session-a' });
  });

  it('maps bridge events through the shared CopilotEvent contract', async () => {
    const { backend, spawnCalls, connect } = await createHarness();
    const proc = await backend.start(startOptions());
    const source = proc.createEventSource!();
    const onEvent = vi.fn();
    source.start(onEvent);
    const extension = connect(spawnCalls[0], 'session-a');
    await extension.registered;

    extension.emitEvent({
      type: 'tool.execution_start',
      id: 'evt-1',
      timestamp: '2026-10-01T12:00:00.000Z',
      parentId: null,
      data: { toolName: 'task', toolCallId: 'tool-1', arguments: { prompt: 'scan' } },
    });
    extension.emitEvent({ type: 'subagent.started', data: { toolCallId: 'tool-1', agentName: 'Scout' } });
    await vi.waitFor(() => expect(onEvent).toHaveBeenCalledTimes(2));

    expect(onEvent).toHaveBeenNthCalledWith(1, {
      type: 'tool.execution_start',
      id: 'evt-1',
      timestamp: '2026-10-01T12:00:00.000Z',
      parentId: null,
      data: { toolName: 'task', toolCallId: 'tool-1', arguments: { prompt: 'scan' } },
    }, false);
    expect(onEvent.mock.calls[1][0]).toMatchObject({
      type: 'subagent.started',
      data: { toolCallId: 'tool-1', agentName: 'Scout' },
      parentId: null,
    });
    expect(source.getSessionId()).toBe('session-a');

    source.stop();
    extension.emitEvent({ type: 'assistant.message', data: { content: 'ignored' } });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(onEvent).toHaveBeenCalledTimes(2);
  });

  it('kill revokes the bridge credentials and kills the native process tree', async () => {
    const { backend, spawnCalls, connect, killTree } = await createHarness({ connectTimeoutMs: 50 });
    const proc = await backend.start(startOptions());
    const extension = connect(spawnCalls[0], 'session-a');
    await extension.registered;

    proc.kill();

    expect(killTree).toHaveBeenCalledWith(spawnCalls[0].pty);
    await extension.closed;
    await expect(proc.submitPrompt!('after kill')).rejects.toThrow(/closed/);
    const late = connect(spawnCalls[0], 'session-a');
    await late.closed;
    expect(late.frames).toEqual([{ type: 'registration-error', error: 'authentication failed' }]);
  });

  it('a late exit of an earlier TUI never revokes a newer launch for the same agent', async () => {
    const { backend, spawnCalls, connect } = await createHarness();
    await backend.start(startOptions());
    const replacement = await backend.start(startOptions());
    spawnCalls[0].pty.emitExit(0);

    const extension = connect(spawnCalls[1], 'session-a');
    extension.handlers.send = () => 'ok';
    await extension.registered;
    await expect(replacement.submitPrompt!('still routed')).resolves.toBeUndefined();
    expect(spawnCalls[0].options.env[NATIVE_BRIDGE_ENV.terminalKey])
      .not.toBe(spawnCalls[1].options.env[NATIVE_BRIDGE_ENV.terminalKey]);
  });
});

describe('normalizeBridgeControlData', () => {
  it('normalizes compact results and rejects malformed payloads', () => {
    expect(normalizeBridgeControlData('compact', {
      kind: 'compact',
      success: true,
      tokensRemoved: 10,
      messagesRemoved: 'x',
      summary: 'done',
    })).toEqual({ kind: 'compact', success: true, tokensRemoved: 10, messagesRemoved: 0, summary: 'done' });
    expect(() => normalizeBridgeControlData('usage', null)).toThrow('no result for /usage');
  });
});

describe('initializeNativeBridge', () => {
  it('reports an explicit capability failure without materializing or opening the broker', async () => {
    const materializeExtension = vi.fn();
    const createBroker = vi.fn();

    const result = await initializeNativeBridge({
      resolveCapability: async () => {
        throw new NativeBridgeCapabilityError('CLI_FLAGS_MISSING', 'Pinned Copilot CLI lacks required native bridge flags: --extension-sdk-path');
      },
      materializeExtension,
      createBroker,
      loadPty: () => ({ spawn: vi.fn() }),
    });

    expect(result).toEqual({
      ok: false,
      reason: 'CLI_FLAGS_MISSING: Pinned Copilot CLI lacks required native bridge flags: --extension-sdk-path',
    });
    expect(materializeExtension).not.toHaveBeenCalled();
    expect(createBroker).not.toHaveBeenCalled();
  });

  it('reports broker startup failures explicitly', async () => {
    const result = await initializeNativeBridge({
      resolveCapability: async () => ({
        cliPath: CLI_PATH,
        extensionExportPath: 'x',
        sdkPackageDir: 'y',
        extensionSdkPath: EXTENSION_SDK_PATH,
      }),
      materializeExtension: async () => ({ extensionPath: 'ext.mjs' }),
      createBroker: async () => {
        throw new Error('pipe busy');
      },
      loadPty: () => ({ spawn: vi.fn() }),
    });

    expect(result).toEqual({ ok: false, reason: 'could not start the bridge broker: pipe busy' });
  });

  it('wires the pinned CLI and SDK extension path into a native-bridge backend', async () => {
    const broker = await NativeBridgeBroker.create();
    brokers.push(broker);
    const spawn = vi.fn(() => new FakePty(52_000));

    const result = await initializeNativeBridge({
      repoRoot: REPO_ROOT,
      resolveCapability: async () => ({
        cliPath: CLI_PATH,
        extensionExportPath: 'x',
        sdkPackageDir: 'y',
        extensionSdkPath: EXTENSION_SDK_PATH,
      }),
      materializeExtension: async () => ({ extensionPath: 'ext.mjs' }),
      createBroker: async () => broker,
      loadPty: () => ({ spawn }),
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.backend.name).toBe('native-bridge');
    expect(result.broker).toBe(broker);
    const proc = await result.backend.start(startOptions());
    expect(spawn).toHaveBeenCalledWith(CLI_PATH, expect.arrayContaining(['--extension-sdk-path', EXTENSION_SDK_PATH]), expect.any(Object));
    expect(proc.pid).toBe(52_000);
    // No stop()/kill(): the default tree-kill would target a real OS pid.
  });
});

describe('selectNativeBridgeBackend (server default + global fallback)', () => {
  it('uses the native bridge and hands the shared broker to the server when bring-up succeeds', async () => {
    const broker = await NativeBridgeBroker.create();
    brokers.push(broker);
    const backend = new NativeBridgeBackend({
      spawn: vi.fn(),
      broker,
      cliPath: CLI_PATH,
      extensionSdkPath: EXTENSION_SDK_PATH,
    });
    const createSdkFallback = vi.fn();

    const selection = await selectNativeBridgeBackend({
      initialize: async () => ({
        ok: true,
        backend,
        broker,
        capability: { cliPath: CLI_PATH, extensionExportPath: 'x', sdkPackageDir: 'y', extensionSdkPath: EXTENSION_SDK_PATH },
        extensionPath: 'ext.mjs',
      }),
      createSdkFallback,
    });

    expect(selection.backend).toBe(backend);
    expect(selection.broker).toBe(broker);
    expect(selection.fallbackReason).toBeUndefined();
    expect(createSdkFallback).not.toHaveBeenCalled();
  });

  it('falls back globally to the SDK backend with the explicit reason, never node-pty', async () => {
    const sdkBackend = { name: 'sdk', isAvailable: () => true, start: vi.fn() };

    const selection = await selectNativeBridgeBackend({
      initialize: async () => ({ ok: false, reason: 'CLI_FLAGS_MISSING: Pinned Copilot CLI lacks --extension-sdk-path' }),
      createSdkFallback: async () => sdkBackend,
    });

    expect(selection.backend).toBe(sdkBackend);
    expect(selection.broker).toBeNull();
    expect(selection.fallbackReason)
      .toBe('Native Copilot bridge unavailable (CLI_FLAGS_MISSING: Pinned Copilot CLI lacks --extension-sdk-path)');
  });

  it('reports both failures when the SDK fallback cannot start either', async () => {
    const unavailable = await selectNativeBridgeBackend({
      initialize: async () => ({ ok: false, reason: 'could not start the bridge broker: pipe busy' }),
      createSdkFallback: async () => null,
    });
    const failed = await selectNativeBridgeBackend({
      initialize: async () => ({ ok: false, reason: 'SDK_EXTENSION_NOT_FOUND: missing export' }),
      createSdkFallback: async () => {
        throw new Error('host exited');
      },
    });

    expect(unavailable).toEqual({
      backend: null,
      broker: null,
      fallbackReason: 'Native Copilot bridge unavailable (could not start the bridge broker: pipe busy); SDK backend could not initialize',
    });
    expect(failed.fallbackReason)
      .toBe('Native Copilot bridge unavailable (SDK_EXTENSION_NOT_FOUND: missing export); SDK backend failed: host exited');
  });
});
