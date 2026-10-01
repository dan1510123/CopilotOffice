// Native-bridge terminal backend.
//
// Each agent gets its OWN pinned native Copilot CLI TUI under node-pty, spawned
// directly (no shell, no PATH lookup) with `--session-id=<persisted id>`,
// `--experimental` and `--extension-sdk-path`. The TUI loads the bundled
// copilot-office-bridge extension, which authenticates to the terminal server's
// shared NativeBridgeBroker with per-TUI credentials passed ONLY through this
// child's environment. Raw keystrokes, resize and output stay on the native
// PTY; programmatic prompts, session control, ask_user answers and plan
// decisions are explicit broker commands that are awaited and fail loudly.
// There is deliberately no fallback to raw-PTY keystroke injection.

import { execSync } from 'child_process';
import { randomBytes } from 'crypto';
import * as os from 'os';
import { BrokerEventSource, type CopilotEventSource } from './event-source';
import {
  NativeBridgeBroker,
  withoutNativeBridgeEnv,
  type NativeBridgeConnection,
  type NativeBridgeCredentials,
  type NativeBridgeSessionChange,
} from './native-bridge-broker';
import {
  NativeBridgeCapabilityError,
  resolveNativeBridgeCapability,
  type NativeBridgeCapability,
} from './native-bridge-capability';
import { materializeNativeBridgeExtension } from './native-bridge-extension';
import type { ControlCommand, ControlCommandName, ControlData } from './protocol';
import {
  sanitizeCopilotPath,
  type StartTerminalOptions,
  type TerminalBackend,
  type TerminalExitEvent,
  type TerminalPlanDecision,
  type TerminalProcess,
  type TerminalSessionChange,
} from './terminal-backend';

export const NATIVE_BRIDGE_BACKEND_NAME = 'native-bridge';

const DEFAULT_OFFICE_KEY = '__default__';
// Keep connect + command within the relay's 10s request budget so the caller
// receives the bridge's explicit error rather than a generic relay timeout.
const DEFAULT_CONNECT_TIMEOUT_MS = 15_000;
const DEFAULT_COMMAND_TIMEOUT_MS = 30_000;
const DEFAULT_CONTROL_TIMEOUT_MS = 120_000;

/** Broker surface the backend depends on (implemented by {@link NativeBridgeBroker}). */
export interface NativeBridgeBrokerPort {
  allocateCredentials(terminalKey: string): NativeBridgeCredentials;
  bindProcess(terminalKey: string, pid: number): void;
  waitForConnection(terminalKey: string, timeoutMs?: number): Promise<NativeBridgeConnection>;
  request(terminalKey: string, command: string, params?: unknown, timeoutMs?: number): Promise<unknown>;
  subscribe(
    terminalKey: string,
    listener: (event: unknown, connection: NativeBridgeConnection) => void,
  ): () => void;
  onSessionChange(listener: (change: NativeBridgeSessionChange) => void): () => void;
  unregister(terminalKey: string, token?: string): void;
}

/** The subset of a node-pty `IPty` the backend uses. */
export interface NativePty {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(callback: (data: string) => void): unknown;
  onExit(callback: (event: { exitCode: number; signal?: number }) => void): unknown;
  kill(signal?: string): void;
}

export type NativePtySpawn = (
  file: string,
  args: string[],
  options: { name: string; cols: number; rows: number; cwd: string; env: Record<string, string> },
) => NativePty;

export interface NativeBridgeBackendOptions {
  spawn: NativePtySpawn;
  broker: NativeBridgeBrokerPort;
  /** Pinned native CLI binary (never resolved from PATH). */
  cliPath: string;
  /** Folder passed to `--extension-sdk-path` (see NativeBridgeCapability). */
  extensionSdkPath: string;
  repoRoot?: string;
  /** How long a command waits for the bridge to (re)connect before failing. */
  connectTimeoutMs?: number;
  /** Timeout for prompt/answer/plan commands once connected. */
  commandTimeoutMs?: number;
  /** Timeout for `run-control` commands (compaction calls the model). */
  controlTimeoutMs?: number;
  /** Kill the native process tree; defaults to `taskkill /T /F` on Windows. */
  killTree?: (pty: NativePty) => void;
}

/** Launch arguments for one agent's native TUI. */
export function buildNativeBridgeArgs(
  sessionId: string,
  extensionSdkPath: string,
  options: Pick<StartTerminalOptions, 'yolo' | 'extraArgs'> = {},
): string[] {
  const extraArgs = (options.extraArgs ?? []).filter((arg) => arg.trim().length > 0);
  return [
    `--session-id=${sessionId}`,
    '--experimental',
    '--extension-sdk-path',
    extensionSdkPath,
    '--no-auto-update',
    ...(options.yolo ? ['--yolo'] : []),
    ...extraArgs,
  ];
}

/**
 * Child environment for one agent's native TUI: the caller's env minus any
 * inherited bridge credentials, a sanitized PATH, the auto-update pin, and this
 * TUI's freshly minted bridge credentials.
 */
export function buildNativeBridgeEnv(
  baseEnv: Record<string, string | undefined>,
  bridgeEnv: Record<string, string>,
  repoRoot: string,
  platform: NodeJS.Platform = process.platform,
): Record<string, string> {
  const env = withoutNativeBridgeEnv(baseEnv);
  const pathValue = baseEnv.PATH ?? baseEnv.Path ?? process.env.PATH;
  for (const name of Object.keys(env)) {
    if (name.toUpperCase() === 'PATH') delete env[name];
  }
  const sanitizedPath = sanitizeCopilotPath(pathValue, repoRoot);
  env.PATH = sanitizedPath;
  if (platform === 'win32') env.Path = sanitizedPath;
  env.COPILOT_AUTO_UPDATE = 'false';
  return { ...env, ...bridgeEnv };
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

/**
 * Validate a bridge `run-control` result into the `ControlData` shape Teams
 * formats. Rejects anything that is not the requested command's result.
 */
export function normalizeBridgeControlData(command: ControlCommandName, raw: unknown): ControlData {
  if (!raw || typeof raw !== 'object') {
    throw new Error(`Native bridge returned no result for /${command}`);
  }
  const data = raw as Record<string, unknown>;
  if (data.kind !== command) {
    throw new Error(`Native bridge returned a ${String(data.kind)} result for /${command}`);
  }
  switch (command) {
    case 'compact':
      return {
        kind: 'compact',
        success: data.success === true,
        tokensRemoved: optionalNumber(data.tokensRemoved) ?? 0,
        messagesRemoved: optionalNumber(data.messagesRemoved) ?? 0,
        summary: optionalString(data.summary),
      };
    case 'usage':
      return {
        kind: 'usage',
        premiumRequestCost: optionalNumber(data.premiumRequestCost),
        userRequests: optionalNumber(data.userRequests),
        apiDurationMs: optionalNumber(data.apiDurationMs),
        totalTokens: optionalNumber(data.totalTokens),
        promptTokenLimit: optionalNumber(data.promptTokenLimit),
        compactionThreshold: optionalNumber(data.compactionThreshold),
      };
    case 'model':
      return {
        kind: 'model',
        current: optionalString(data.current),
        reasoningEffort: optionalString(data.reasoningEffort),
        switchedTo: optionalString(data.switchedTo),
      };
    default: {
      const never: never = command;
      throw new Error(`Unknown control command: ${String(never)}`);
    }
  }
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function defaultKillTree(pty: NativePty): void {
  try {
    if (os.platform() === 'win32') {
      try {
        execSync(`taskkill /T /F /PID ${pty.pid}`, { stdio: 'ignore' });
      } catch {
        pty.kill();
      }
    } else {
      pty.kill();
    }
  } catch {
    // Process is already gone.
  }
}

/** One agent's native TUI plus its authenticated bridge channel. */
export class NativeBridgeProcess implements TerminalProcess {
  private closed = false;
  private sessionId: string;
  private lastChange: TerminalSessionChange | null = null;
  private lastGeneration = 0;
  private readonly sessionListeners = new Set<(change: TerminalSessionChange) => void>();
  private readonly unsubscribeSessionChanges: () => void;

  constructor(
    private readonly pty: NativePty,
    private readonly broker: NativeBridgeBrokerPort,
    readonly terminalKey: string,
    private readonly token: string,
    initialSessionId: string,
    private readonly timeouts: { connectTimeoutMs: number; commandTimeoutMs: number; controlTimeoutMs: number },
    private readonly killTree: (pty: NativePty) => void,
  ) {
    this.sessionId = initialSessionId;
    this.unsubscribeSessionChanges = broker.onSessionChange((change) => {
      if (change.terminalKey === terminalKey) this.observeConnection(change);
    });
    // The extension can register in the short interval between spawn() and this
    // wrapper subscribing. Replay the broker's current connection so startup
    // readiness and the authoritative session id cannot be lost to that race.
    void broker.waitForConnection(terminalKey, this.timeouts.connectTimeoutMs)
      .then((connection) => this.observeConnection(connection))
      .catch(() => {
        // A later broker onSessionChange notification still handles slow starts
        // such as an untrusted-folder prompt.
      });
    pty.onExit(() => this.release());
  }

  get pid(): number {
    return this.pty.pid;
  }

  /** Session the native TUI is currently attached to (bridge-authoritative). */
  getSessionId(): string {
    return this.sessionId;
  }

  write(data: string): void {
    if (this.closed) return;
    this.pty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    try {
      this.pty.resize(cols, rows);
    } catch {
      // The PTY may have exited between the check and the resize.
    }
  }

  onData(callback: (data: string) => void): void {
    this.pty.onData(callback);
  }

  onExit(callback: (event: TerminalExitEvent) => void): void {
    this.pty.onExit((event) => callback({ exitCode: event.exitCode }));
  }

  kill(): void {
    if (this.closed) return;
    this.release();
    this.killTree(this.pty);
  }

  /**
   * Submit a prompt through the extension's `session.send({ mode: 'enqueue' })`.
   * The native TUI renders it like a typed prompt. The display-only label has
   * no native TUI equivalent and is intentionally not sent to the agent.
   */
  async submitPrompt(text: string, _label?: string): Promise<void> {
    const prompt = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!prompt) return;
    await this.command('send', { prompt });
  }

  async runControl(cmd: ControlCommand): Promise<ControlData> {
    const raw = await this.command(
      'run-control',
      { command: cmd.command, ...(cmd.arg ? { arg: cmd.arg } : {}) },
      this.timeouts.controlTimeoutMs,
    );
    return normalizeBridgeControlData(cmd.command, raw);
  }

  async submitAnswer(answer: { answer: string; wasFreeform: boolean }): Promise<void> {
    await this.command('submit-answer', { answer: answer.answer, wasFreeform: answer.wasFreeform });
  }

  async submitPlanDecision(decision: TerminalPlanDecision): Promise<void> {
    await this.command('submit-plan-decision', {
      approved: decision.approved,
      ...(decision.selectedAction ? { selectedAction: decision.selectedAction } : {}),
      ...(decision.feedback ? { feedback: decision.feedback } : {}),
    });
  }

  async whenReady(timeoutMs = this.timeouts.connectTimeoutMs): Promise<void> {
    if (this.closed) throw new Error(`Native Copilot session ${this.terminalKey} is closed`);
    await this.broker.waitForConnection(this.terminalKey, timeoutMs);
  }

  onSessionChange(listener: (change: TerminalSessionChange) => void): () => void {
    this.sessionListeners.add(listener);
    // Replay the current registration so a late subscriber never misses it.
    if (this.lastChange) listener(this.lastChange);
    return () => this.sessionListeners.delete(listener);
  }

  createEventSource(): CopilotEventSource {
    return new BrokerEventSource(this.sessionId, this.terminalKey, this.broker);
  }

  private async command(name: string, params: unknown, timeoutMs = this.timeouts.commandTimeoutMs): Promise<unknown> {
    if (this.closed) {
      throw new Error(`Native Copilot session ${this.terminalKey} is closed`);
    }
    try {
      await this.broker.waitForConnection(this.terminalKey, this.timeouts.connectTimeoutMs);
    } catch (error) {
      throw new Error(
        `Copilot bridge is not connected for ${this.terminalKey}: ${asError(error).message}`,
      );
    }
    try {
      return await this.broker.request(this.terminalKey, name, params, timeoutMs);
    } catch (error) {
      throw new Error(`Copilot bridge ${name} failed: ${asError(error).message}`);
    }
  }

  private observeConnection(
    connection: NativeBridgeConnection | NativeBridgeSessionChange,
  ): void {
    if (this.closed || connection.generation <= this.lastGeneration) return;
    this.lastGeneration = connection.generation;
    const previousSessionId = this.sessionId;
    this.sessionId = connection.sessionId;
    const reportedPrevious = 'previousSessionId' in connection
      ? connection.previousSessionId
      : undefined;
    const snapshot: TerminalSessionChange = {
      sessionId: connection.sessionId,
      ...((reportedPrevious || previousSessionId !== connection.sessionId)
        ? { previousSessionId: reportedPrevious ?? previousSessionId }
        : {}),
    };
    this.lastChange = snapshot;
    for (const listener of [...this.sessionListeners]) {
      try {
        listener(snapshot);
      } catch {
        // Listener failures must not break the bridge.
      }
    }
  }

  private release(): void {
    if (this.closed) return;
    this.closed = true;
    this.unsubscribeSessionChanges();
    this.sessionListeners.clear();
    this.broker.unregister(this.terminalKey, this.token);
  }
}

export class NativeBridgeBackend implements TerminalBackend {
  readonly name = NATIVE_BRIDGE_BACKEND_NAME;
  private readonly processes = new Set<NativeBridgeProcess>();

  constructor(private readonly options: NativeBridgeBackendOptions) {}

  isAvailable(): boolean {
    return true;
  }

  async start(options: StartTerminalOptions): Promise<TerminalProcess> {
    const { broker, cliPath, extensionSdkPath } = this.options;
    const prefix = options.terminalKey ?? `${options.officeId ?? DEFAULT_OFFICE_KEY}:${options.sessionId}`;
    // Unique per launch: credentials, events and session changes of an earlier
    // TUI for the same agent can never be confused with this one.
    const terminalKey = `${prefix}#${randomBytes(6).toString('hex')}`;
    const credentials = broker.allocateCredentials(terminalKey);

    let pty: NativePty;
    try {
      pty = this.options.spawn(cliPath, buildNativeBridgeArgs(options.sessionId, extensionSdkPath, options), {
        name: 'xterm-256color',
        cols: options.cols,
        rows: options.rows,
        cwd: options.cwd,
        env: buildNativeBridgeEnv(options.env, credentials.env, this.options.repoRoot ?? process.cwd()),
      });
    } catch (error) {
      broker.unregister(terminalKey, credentials.token);
      throw new Error(`Failed to launch native Copilot CLI at ${cliPath}: ${asError(error).message}`);
    }

    try {
      broker.bindProcess(terminalKey, pty.pid);
    } catch (error) {
      broker.unregister(terminalKey, credentials.token);
      (this.options.killTree ?? defaultKillTree)(pty);
      throw new Error(`Failed to bind Copilot bridge to native CLI pid ${pty.pid}: ${asError(error).message}`);
    }

    const proc = new NativeBridgeProcess(
      pty,
      broker,
      terminalKey,
      credentials.token,
      options.sessionId,
      {
        connectTimeoutMs: this.options.connectTimeoutMs ?? DEFAULT_CONNECT_TIMEOUT_MS,
        commandTimeoutMs: this.options.commandTimeoutMs ?? DEFAULT_COMMAND_TIMEOUT_MS,
        controlTimeoutMs: this.options.controlTimeoutMs ?? DEFAULT_CONTROL_TIMEOUT_MS,
      },
      this.options.killTree ?? defaultKillTree,
    );
    this.processes.add(proc);
    proc.onExit(() => this.processes.delete(proc));
    return proc;
  }

  async stop(): Promise<void> {
    const processes = [...this.processes];
    this.processes.clear();
    for (const proc of processes) proc.kill();
  }
}

export type NativeBridgeInitResult =
  | {
      ok: true;
      backend: NativeBridgeBackend;
      broker: NativeBridgeBroker;
      capability: NativeBridgeCapability;
      extensionPath: string;
    }
  | { ok: false; reason: string };

export interface NativeBridgeInitDependencies {
  repoRoot?: string;
  resolveCapability?: () => Promise<NativeBridgeCapability>;
  materializeExtension?: () => Promise<{ extensionPath: string }>;
  createBroker?: () => Promise<NativeBridgeBroker>;
  loadPty?: () => { spawn: NativePtySpawn };
}

function describeInitFailure(stage: string, error: unknown): string {
  if (error instanceof NativeBridgeCapabilityError) return `${error.code}: ${error.message}`;
  return `${stage}: ${asError(error).message}`;
}

/**
 * Server-startup bring-up: verify the pinned CLI + SDK extension capability,
 * materialize the bundled extension, and open the shared broker. Never throws;
 * a failure returns an explicit reason so the caller can fall back globally.
 */
export async function initializeNativeBridge(
  dependencies: NativeBridgeInitDependencies = {},
): Promise<NativeBridgeInitResult> {
  let capability: NativeBridgeCapability;
  try {
    capability = await (dependencies.resolveCapability ?? (() => resolveNativeBridgeCapability()))();
  } catch (error) {
    return { ok: false, reason: describeInitFailure('capability check failed', error) };
  }

  let ptyModule: { spawn: NativePtySpawn };
  try {
    ptyModule = (dependencies.loadPty ?? (() => require('node-pty') as { spawn: NativePtySpawn }))();
  } catch (error) {
    return { ok: false, reason: describeInitFailure('node-pty is unavailable', error) };
  }

  let extensionPath: string;
  try {
    ({ extensionPath } = await (dependencies.materializeExtension ?? (() => materializeNativeBridgeExtension()))());
  } catch (error) {
    return { ok: false, reason: describeInitFailure('could not install the bridge extension', error) };
  }

  let broker: NativeBridgeBroker;
  try {
    broker = await (dependencies.createBroker ?? (() => NativeBridgeBroker.create()))();
  } catch (error) {
    return { ok: false, reason: describeInitFailure('could not start the bridge broker', error) };
  }

  const backend = new NativeBridgeBackend({
    spawn: (file, args, options) => ptyModule.spawn(file, args, options),
    broker,
    cliPath: capability.cliPath,
    extensionSdkPath: capability.extensionSdkPath,
    repoRoot: dependencies.repoRoot,
  });
  return { ok: true, backend, broker, capability, extensionPath };
}

export interface NativeBridgeSelection {
  /** Loaded backend: native-bridge, the SDK fallback, or null when neither came up. */
  backend: TerminalBackend | null;
  /** Shared broker, only when the native bridge loaded (the server owns/closes it). */
  broker: NativeBridgeBroker | null;
  /** Explicit reason the native bridge was not used (surfaced to the renderer). */
  fallbackReason?: string;
  /** Successful bring-up details for logging. */
  ready?: Extract<NativeBridgeInitResult, { ok: true }>;
}

/**
 * Select the default backend: the native bridge when its startup bring-up
 * succeeds, otherwise the headless SDK backend (custom renderer) GLOBALLY with
 * an explicit reason. Never selects an unauthenticated raw-PTY programmatic path.
 */
export async function selectNativeBridgeBackend(options: {
  createSdkFallback: () => Promise<TerminalBackend | null>;
  initialize?: () => Promise<NativeBridgeInitResult>;
}): Promise<NativeBridgeSelection> {
  const init = await (options.initialize ?? (() => initializeNativeBridge()))();
  if (init.ok) return { backend: init.backend, broker: init.broker, ready: init };

  const fallbackReason = `Native Copilot bridge unavailable (${init.reason})`;
  let backend: TerminalBackend | null = null;
  let sdkFailure = 'SDK backend could not initialize';
  try {
    backend = await options.createSdkFallback();
  } catch (error) {
    sdkFailure = `SDK backend failed: ${asError(error).message}`;
  }
  return {
    backend,
    broker: null,
    fallbackReason: backend ? fallbackReason : `${fallbackReason}; ${sdkFailure}`,
  };
}
