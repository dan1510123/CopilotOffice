import { execSync } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { SdkEventSource, type CopilotEventSource, type SdkCopilotSession } from './event-source';
import type { PermissionHandler } from '@github/copilot-sdk';
import { loadCustomAgents } from './custom-agents';
import { resolveSkillDirectories } from './custom-skills';

// ── spec 015: ask_user (SDK user-input interaction) answer channel ──────────────
//
// Registering an `onUserInputRequest` handler on every managed SDK/ui-server session
// is a spike-verified PREREQUISITE: without it the runtime advertises the tool as
// unavailable (`requestUserInput` is false) and the model refuses to call `ask_user`.
//
// CRITICAL (spike 2026-07-13): the `onUserInputRequest` CALLBACK receives only
// `{ question, choices, allowFreeform }` — it carries NO `requestId` and NO `toolCallId`.
// The ONLY correlation the callback provides is `ctx.sessionId`. The interaction
// `requestId` exists solely on the parallel event stream (`user_input.requested` /
// `user_input.completed`), which is what Teams relays and echoes back. Therefore the
// pending resolver MUST be keyed by `sessionId` alone — keying it by the callback's
// (absent) requestId can never match the event-derived requestId, and the answer is
// dropped. `ask_user` blocks the turn, so there is at most ONE pending user-input per
// session at a time; a single-slot-per-session map is the correct and sufficient model.
// The resolver is resolved out-of-band by `handlePendingUserInput(sessionId, …)` when a
// Teams (or local) answer arrives; the agent keeps waiting until then. Keying by
// `sessionId` also makes cross-agent collision impossible and lets a torn-down session's
// resolver be GC'd (`clearPendingUserInputForSession`).

interface PendingUserInputEntry {
  resolve: (a: { answer: string; wasFreeform: boolean }) => void;
  sessionId: string;
}

/** Pending ask_user interactions keyed by `sessionId` (one blocking interaction per session). */
const pendingUserInput = new Map<string, PendingUserInputEntry>();

interface UserInputRequest {
  requestId?: unknown;
  toolCallId?: unknown;
}

/**
 * Build the SDK `onUserInputRequest` handler (spec 015 prerequisite). Registered on
 * every managed SDK/ui-server session so `ask_user` is usable. `sessionId` is the ONLY
 * correlation key (see module header) — the callback provides no requestId. Returns a
 * promise resolved LATE by {@link handlePendingUserInput} when the answer arrives.
 */
export function makeUserInputHandler(
  sessionId: string,
): (
  request: UserInputRequest,
  ctx?: { sessionId?: string },
) => Promise<{ answer: string; wasFreeform: boolean }> {
  return (_request, ctx) =>
    new Promise((resolve) => {
      // Prefer the closure sessionId (deterministic, matches the server's PtyProcess
      // sessionId used at answer time); fall back to ctx only if the closure id is empty.
      const scope = sessionId || ctx?.sessionId || '';
      const existing = pendingUserInput.get(scope);
      if (existing) {
        // ask_user blocks the turn, so a second pending interaction for the same session
        // should not occur. If it somehow does, the old resolver would leak — warn.
        console.warn(
          `[terminal-backend] makeUserInputHandler: replacing an UNRESOLVED pending user-input for session="${scope}" (its promise will never resolve)`,
        );
      }
      pendingUserInput.set(scope, { resolve, sessionId: scope });
    });
}

/**
 * Resolve the pending `ask_user` interaction for `sessionId` (spec 015). Idempotent: an
 * unknown or already-resolved session is a no-op + warn (supports the single-resolution
 * Teams/local race). Returns true only when a stored resolver actually fired. The
 * event-stream `requestId` (Teams' single-resolution key) is accepted for diagnostics
 * only — the resolver itself is correlated by session (the callback has no requestId).
 */
export function handlePendingUserInput(
  sessionId: string,
  answer: { answer: string; wasFreeform: boolean },
): boolean {
  const entry = pendingUserInput.get(sessionId);
  if (!entry) {
    console.warn(
      `[terminal-backend] handlePendingUserInput: no pending user-input for session="${sessionId}" (already resolved or unknown) — no-op`,
    );
    return false;
  }
  pendingUserInput.delete(sessionId);
  entry.resolve({ answer: answer.answer, wasFreeform: answer.wasFreeform });
  return true;
}

/**
 * GC the outstanding pending user-input interaction owned by `sessionId` (spec 015).
 * Called when a session exits/resets/is killed so an agent torn down mid-`ask_user` cannot
 * leak an unresolved resolver. Returns the number of entries dropped (0 or 1).
 */
export function clearPendingUserInputForSession(sessionId: string): number {
  return pendingUserInput.delete(sessionId) ? 1 : 0;
}

/** Test/diagnostics helper: number of outstanding pending user-input interactions. */
export function pendingUserInputCount(): number {
  return pendingUserInput.size;
}

/**
 * Decide how an `ask_user` answer is delivered for a backend process (spec 015).
 * SDK/ui-server backends expose `submitPrompt` (a real programmatic session) and resolve
 * the pending interaction by `requestId` via {@link handlePendingUserInput}. The raw
 * node-pty backend omits `submitPrompt`; there is no SDK session, so the answer is typed
 * onto the TUI's interaction input line via keystroke injection (best-effort/degraded,
 * no requestId). This is the single source of truth for the server's submit-answer routing.
 */
export function answerTransport(proc: Pick<TerminalProcess, 'submitPrompt'>): 'sdk' | 'keystroke' {
  return typeof proc.submitPrompt === 'function' ? 'sdk' : 'keystroke';
}

export interface TerminalExitEvent {
  exitCode: number;
}

export interface TerminalProcess {
  readonly pid: number;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: TerminalExitEvent) => void): void;
  kill(): void;
  /**
   * Optional: submit a full prompt to the underlying agent atomically, bypassing
   * the character-by-character line editor. Implemented by SDK-backed processes
   * (calls `session.send({ prompt, mode: 'enqueue' })` directly). Backends that
   * omit it (raw PTY) are driven via bracketed-paste `write()` instead.
   *
   * `label`, when provided, is rendered as a display-only tag in front of the
   * echoed prompt (e.g. "[Teams · Alice]"). It is NEVER included in the text
   * sent to the agent — the model receives only `text`.
   */
  submitPrompt?(text: string, label?: string): void;

  /**
   * Optional: build the {@link CopilotEventSource} for this process's agent.
   * SDK-backed processes (ui-server) return an {@link SdkEventSource} bound to the
   * live session so status/tool/turn events come from `session.on(...)` instead of
   * tailing `events.jsonl`. Backends that omit it are driven by the file watcher.
   */
  createEventSource?(): CopilotEventSource;

  /**
   * Optional: make this agent's session the one the hosted runtime's TUI renders
   * (T024). Called when a viewer attaches / the visible agent switches. Implemented
   * by the ui-server backend (`client.setForegroundSessionId`); a no-op concept for
   * backends where each agent already owns its own PTY.
   */
  setForeground?(): Promise<void>;
}

export interface StartTerminalOptions {
  sessionId: string;
  officeId?: string;
  shell: string;
  cols: number;
  rows: number;
  cwd: string;
  env: { [key: string]: string };
  /** YOLO/auto-approve posture for this session (FR-009). Defaults to false. */
  yolo?: boolean;
  /**
   * Live YOLO/auto-approve getter (ui-server backend). Unlike the `yolo` boolean
   * — captured once at session-create time and used for the node-pty `--yolo`
   * launch flag — this is evaluated on every permission request so toggling YOLO
   * takes effect on already-running ui-server sessions. Falls back to `yolo`.
   */
  isYoloEnabled?: () => boolean;
  /**
   * Extra CLI arguments from the app's "additional parameters" setting
   * (e.g. ['--model', 'gpt-5.4']). For the ui-server backend these are appended
   * to the per-office host launch (`copilot <extraArgs> --ui-server --port 0`);
   * the host is created once per office, so the args are captured from the first
   * agent that starts it. Empty/omitted = none.
   */
  extraArgs?: string[];
}

export interface TerminalBackend {
  readonly name: string;
  isAvailable(): boolean;
  start(options: StartTerminalOptions): Promise<TerminalProcess>;
}

function splitPathEntries(pathValue: string): string[] {
  return pathValue.split(path.delimiter).filter(Boolean);
}

function normalizeEntry(entry: string): string {
  return path.normalize(entry).replace(/[\\\/]+$/, '');
}

function getRepoNodeModulesBin(repoRoot: string): string {
  return normalizeEntry(path.join(repoRoot, 'node_modules', '.bin'));
}

function isRepoNodeModulesBin(entry: string, repoRoot: string): boolean {
  return normalizeEntry(entry).toLowerCase() === getRepoNodeModulesBin(repoRoot).toLowerCase();
}

export function sanitizeCopilotPath(pathValue: string | undefined, repoRoot: string): string {
  if (!pathValue) return '';
  return splitPathEntries(pathValue)
    .filter((entry) => !isRepoNodeModulesBin(entry, repoRoot))
    .join(path.delimiter);
}

/**
 * Resolve the Copilot CLI binary that ships as a transitive dependency of
 * `@github/copilot-sdk` (`@github/copilot` → `@github/copilot-<platform>-<arch>`).
 *
 * This binary is a real native `copilot` executable (not the extensionless VS
 * Code wrapper), so it can be `pty.spawn`'d directly AND can host `--ui-server`.
 * Preferring it makes CLI resolution deterministic and npm-managed instead of
 * depending on whatever `copilot` happens to be first on the user's PATH (which
 * on dev machines is often the VS Code copilot-chat shim that cannot host
 * ui-server). Returns null if the platform package isn't installed.
 */
export function resolveBundledCopilotCliPath(): string | null {
  try {
    const platformPackage = `@github/copilot-${process.platform}-${process.arch}`;
    const resolved = require.resolve(platformPackage);
    return resolved || null;
  } catch {
    return null;
  }
}

export function resolveCopilotCliPath(repoRoot: string, pathValue: string | undefined): string | null {
  const bundled = resolveBundledCopilotCliPath();
  if (bundled) {
    return bundled;
  }

  const sanitizedPath = sanitizeCopilotPath(pathValue, repoRoot);
  const env = { ...process.env, PATH: sanitizedPath };

  try {
    const command = os.platform() === 'win32' ? 'where.exe copilot' : 'which -a copilot';
    const output = execSync(command, { encoding: 'utf8', env, stdio: ['ignore', 'pipe', 'ignore'] });
    const candidates = output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .filter((candidate) => !candidate.toLowerCase().includes(`${path.sep}node_modules${path.sep}.bin${path.sep}copilot`.toLowerCase()));

    return candidates[0] || null;
  } catch {
    return null;
  }
}

/**
 * Interpret the raw output of a `copilot --ui-server` probe.
 *
 * The Copilot CLI's argument parser is strict: an unrecognized flag produces
 * `error: unknown option '...'`. `--ui-server` is an undocumented-but-recognized
 * flag (TUI + local control server mode), so a CLI that supports it does NOT emit
 * that error — in a non-interactive context it falls through to a normal path
 * (e.g. "No prompt provided. Run in an interactive terminal ..."). Returns true
 * when the flag is recognized (supported), false when reported unknown.
 *
 * Pure and unit-testable — kept separate from the process-spawning probe below.
 */
export function interpretUiServerProbe(output: string): boolean {
  return !/unknown option/i.test(output);
}

const uiServerProbeCache = new Map<string, boolean>();

/**
 * Probe whether the resolved Copilot CLI supports the (undocumented) `--ui-server`
 * TUI+server mode. Runs the CLI with the flag in a non-interactive context (no TTY,
 * piped stdio) and inspects the output via {@link interpretUiServerProbe}. Results
 * are cached per `cliPath`. Never throws.
 *
 * A timeout (the CLI started a server and did not exit) is treated as supported,
 * since a hang implies the flag was accepted rather than rejected.
 */
export function probeUiServerSupport(cliPath: string | null): boolean {
  if (!cliPath) return false;
  const cached = uiServerProbeCache.get(cliPath);
  if (cached !== undefined) return cached;

  const launch = createSdkCliLaunchConfig(cliPath);
  const command = [`"${launch.cliPath}"`, ...launch.cliArgs, '--ui-server'].join(' ');

  let supported = false;
  try {
    execSync(command, { timeout: 5000, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    supported = true; // exited 0 → flag accepted
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; killed?: boolean; signal?: string };
    if (e.killed || e.signal) {
      supported = true; // timed out because a server started → flag accepted
    } else {
      supported = interpretUiServerProbe(`${e.stdout ?? ''}${e.stderr ?? ''}`);
    }
  }

  uiServerProbeCache.set(cliPath, supported);
  return supported;
}

class NodePtyProcess implements TerminalProcess {
  constructor(
    private readonly proc: {
      pid: number;
      write(data: string): void;
      resize(cols: number, rows: number): void;
      onData(callback: (data: string) => void): void;
      onExit(callback: (event: TerminalExitEvent) => void): void;
      kill(): void;
    }
  ) {}

  get pid(): number {
    return this.proc.pid;
  }

  write(data: string): void {
    this.proc.write(data);
  }

  resize(cols: number, rows: number): void {
    this.proc.resize(cols, rows);
  }

  onData(callback: (data: string) => void): void {
    this.proc.onData(callback);
  }

  onExit(callback: (event: TerminalExitEvent) => void): void {
    this.proc.onExit(callback);
  }

  kill(): void {
    try {
      if (os.platform() === 'win32') {
        try {
          execSync(`taskkill /T /F /PID ${this.proc.pid}`, { stdio: 'ignore' });
        } catch {
          this.proc.kill();
        }
      } else {
        this.proc.kill();
      }
    } catch {
      // Process is already gone.
    }
  }
}

export class NodePtyBackend implements TerminalBackend {
  readonly name = 'node-pty';

  constructor(private readonly pty: typeof import('node-pty')) {}

  static tryCreate(): NodePtyBackend | null {
    try {
      const pty = require('node-pty') as typeof import('node-pty');
      return new NodePtyBackend(pty);
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    return true;
  }

  async start(options: StartTerminalOptions): Promise<TerminalProcess> {
    const proc = this.pty.spawn(options.shell, [], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: options.env,
    });

    return new NodePtyProcess(proc);
  }
}

class CopilotSdkProcess implements TerminalProcess {
  private readonly dataListeners: Array<(data: string) => void> = [];
  private readonly exitListeners: Array<(event: TerminalExitEvent) => void> = [];
  private readonly streamedMessageIds = new Set<string>();
  private queuedSend: Promise<void> = Promise.resolve();
  private lineBuffer = '';
  private closed = false;
  private promptPending = false;

  constructor(
    readonly pid: number,
    private readonly session: any,
    private readonly disconnectSession: () => Promise<void>,
  ) {
    this.bindSessionEvents();
    queueMicrotask(() => {
      this.emitData('\x1b[36m[Copilot SDK backend connected]\x1b[0m\r\n');
      this.emitPrompt();
    });
  }

  write(data: string): void {
    if (this.closed) return;

    for (const ch of data) {
      if (ch === '\r' || ch === '\n') {
        const prompt = this.lineBuffer.trim();
        this.lineBuffer = '';
        this.emitData('\r\n');

        if (!prompt) {
          this.emitPrompt();
          continue;
        }

        this.enqueuePrompt(prompt);
        continue;
      }

      if (ch === '\b' || ch === '\x7f') {
        if (this.lineBuffer.length > 0) {
          this.lineBuffer = this.lineBuffer.slice(0, -1);
          this.emitData('\b \b');
        }
        continue;
      }

      this.lineBuffer += ch;
      this.emitData(ch);
    }
  }

  /**
   * Submit a complete prompt directly to the SDK session, bypassing the
   * line-editor. Handles multi-line prompts atomically (no premature submit on
   * embedded newlines) and echoes the prompt so it appears in the terminal as
   * if typed. This is the robust path used by programmatic drivers (e.g. Teams
   * remote dispatch) instead of racing keystrokes through `write()`.
   */
  submitPrompt(text: string, label?: string): void {
    if (this.closed) return;
    const prompt = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!prompt) return;
    // Discard any half-typed line and echo the submitted prompt. The optional
    // label is a DISPLAY-ONLY tag (dimmed cyan) — it is never sent to the agent.
    this.lineBuffer = '';
    const tag = label ? `\x1b[2;36m[${label}]\x1b[0m ` : '';
    this.emitData(`${tag}${prompt.replace(/\n/g, '\r\n')}\r\n`);
    this.enqueuePrompt(prompt);
  }

  /** Queue a prompt for the SDK session, serialized after any in-flight send. */
  private enqueuePrompt(prompt: string): void {
    this.promptPending = true;
    this.queuedSend = this.queuedSend
      .then(async () => {
        await this.session.send({ prompt, mode: 'enqueue' });
      })
      .catch((error: unknown) => {
        this.emitData(`\x1b[31m[SDK send failed: ${String(error)}]\x1b[0m\r\n`);
        this.emitPrompt();
      });
  }

  resize(_cols: number, _rows: number): void {
    // The SDK is event-driven rather than PTY-driven, so terminal resizing does not apply.
  }

  onData(callback: (data: string) => void): void {
    this.dataListeners.push(callback);
  }

  onExit(callback: (event: TerminalExitEvent) => void): void {
    this.exitListeners.push(callback);
  }

  kill(): void {
    if (this.closed) return;
    this.closed = true;

    this.disconnectSession()
      .catch((error: unknown) => {
        this.emitData(`\x1b[31m[SDK disconnect failed: ${String(error)}]\x1b[0m\r\n`);
      })
      .finally(() => {
        this.emitExit({ exitCode: 0 });
      });
  }

  private bindSessionEvents(): void {
    this.session.on((event: any) => {
      switch (event.type) {
        case 'assistant.message_delta':
          if (event.data?.messageId) {
            this.streamedMessageIds.add(String(event.data.messageId));
          }
          if (event.data?.deltaContent) {
            this.emitData(String(event.data.deltaContent));
          }
          break;

        case 'assistant.message':
          if (event.data?.messageId && this.streamedMessageIds.has(String(event.data.messageId))) {
            break;
          }
          if (event.data?.content) {
            this.emitData(String(event.data.content));
          }
          break;

        case 'tool.execution_start':
          if (event.data?.toolName) {
            this.emitData(`\r\n\x1b[2m[tool] ${String(event.data.toolName)}\x1b[0m\r\n`);
          }
          break;

        case 'tool.execution_partial_result':
          if (event.data?.partialOutput) {
            this.emitData(String(event.data.partialOutput));
          }
          break;

        case 'tool.execution_complete':
          if (event.data?.error?.message) {
            this.emitData(`\r\n\x1b[31m[tool error] ${String(event.data.error.message)}\x1b[0m\r\n`);
          }
          break;

        case 'assistant.turn_end':
        case 'session.idle':
          if (this.promptPending) {
            this.promptPending = false;
            this.emitData('\r\n');
            this.emitPrompt();
          }
          break;
      }
    });
  }

  private emitPrompt(): void {
    this.emitData('> ');
  }

  private emitData(data: string): void {
    for (const listener of this.dataListeners) {
      listener(data);
    }
  }

  private emitExit(event: TerminalExitEvent): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

export class CopilotSdkBackend implements TerminalBackend {
  readonly name = 'copilot-sdk';
  private client: any | null = null;
  private startPromise: Promise<void> | null = null;
  private nextPid = 1_000_000;

  constructor(
    private readonly CopilotClient: new (options?: Record<string, unknown>) => any,
    private readonly RuntimeConnection: { forStdio: (opts?: { path?: string; args?: readonly string[] }) => unknown },
    private readonly approveAll: unknown,
    private readonly cliPath: string,
    private readonly cliArgs: string[],
  ) {}

  static async tryCreate(cliPath: string | null): Promise<CopilotSdkBackend | null> {
    if (!cliPath) {
      return null;
    }

    try {
      const sdk = await import('@github/copilot-sdk') as {
        CopilotClient?: new (options?: Record<string, unknown>) => any;
        RuntimeConnection?: { forStdio: (opts?: { path?: string; args?: readonly string[] }) => unknown };
        approveAll?: unknown;
      };
      if (!sdk.CopilotClient || !sdk.RuntimeConnection) return null;
      const launchConfig = createSdkCliLaunchConfig(cliPath);
      return new CopilotSdkBackend(
        sdk.CopilotClient,
        sdk.RuntimeConnection,
        sdk.approveAll,
        launchConfig.cliPath,
        launchConfig.cliArgs,
      );
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    return true;
  }

  async start(options: StartTerminalOptions): Promise<TerminalProcess> {
    const client = await this.getClient();
    const session = await this.resumeOrCreateSession(client, options);

    return new CopilotSdkProcess(
      this.nextPid++,
      session,
      async () => {
        await session.disconnect();
      },
    );
  }

  private async getClient(): Promise<any> {
    if (this.client) {
      return this.client;
    }

    if (!this.startPromise) {
      // SDK 1.x: connection mode is expressed via RuntimeConnection rather than
      // the legacy cliPath/cliArgs/autoStart options. This backend spawns its own
      // headless runtime over stdio using the resolved (non-local) CLI binary.
      this.client = new this.CopilotClient({
        useLoggedInUser: true,
        connection: this.RuntimeConnection.forStdio({ path: this.cliPath, args: this.cliArgs }),
      });
      this.startPromise = this.client.start();
    }

    await this.startPromise;
    return this.client;
  }

  private async resumeOrCreateSession(client: any, options: StartTerminalOptions): Promise<any> {
    const sharedConfig: Record<string, unknown> = {
      streaming: true,
      workingDirectory: options.cwd,
      // Inject the user's custom agents (~/.copilot/agents + <cwd>/.github/agents).
      // SDK-created sessions don't auto-discover them the way the TUI does, so
      // without this "New Session" loses every custom agent. See ./custom-agents.
      customAgents: loadCustomAgents(options.cwd),
      // Inject the user's skills too (~/.copilot/skills + <cwd>/.github/skills).
      // SDK-created sessions don't auto-discover them (enableConfigDiscovery
      // defaults to false), so without this the model never loads any skill even
      // though the hosted TUI's `/` menu still lists them. See ./custom-skills.
      enableSkills: true,
      skillDirectories: resolveSkillDirectories(options.cwd),
      onPermissionRequest: this.approveAll ?? (async () => ({ kind: 'approved' })),
      // spec 015 prerequisite (forStdio path): register the user-input handler so
      // the model is told `ask_user` is available and Teams/local answers can
      // resolve the pending interaction late. See makeUserInputHandler.
      onUserInputRequest: makeUserInputHandler(options.sessionId),
    };

    try {
      return await client.resumeSession(options.sessionId, sharedConfig);
    } catch {
      return client.createSession({
        sessionId: options.sessionId,
        ...sharedConfig,
      });
    }
  }
}

type UiServerStatus = 'launching' | 'listening' | 'ready' | 'crashed' | 'stopped';

type UiServerPty = import('node-pty').IPty;

type UiServerSession = {
  send(request: { prompt: string; mode: 'enqueue' }): Promise<unknown>;
  disconnect(): Promise<void> | void;
};

type UiServerClient = {
  start(): Promise<void>;
  createSession(options: Record<string, unknown>): Promise<UiServerSession>;
  resumeSession(sessionId: string, options: Record<string, unknown>): Promise<UiServerSession>;
  setForegroundSessionId(sessionId: string): Promise<void>;
  listSessions(): Promise<unknown>;
  stop?(): Promise<void>;
};

type UiServerClientConstructor = new (options?: Record<string, unknown>) => UiServerClient;

type RuntimeConnectionForUri = {
  forUri(uri: string): unknown;
};

function buildUiServerEnv(env: { [key: string]: string }, repoRoot: string): { [key: string]: string } {
  const sanitizedPath = sanitizeCopilotPath(env.PATH ?? env.Path ?? process.env.PATH, repoRoot);
  return {
    ...env,
    PATH: sanitizedPath,
    Path: sanitizedPath,
    // TEMPORARY: suppress the CLI's "Restore interrupted sessions" home-screen
    // picker in the ui-server host. CopilotOffice owns session identity via its
    // own session-id mappings and kills agent PTYs on office-switch/close, so
    // those sessions look "interrupted" and the picker hijacks the foreground
    // TUI. This undocumented, internal COPILOT_TEST_* override short-circuits the
    // runtime's interrupted-session gate (verified in CLI 1.0.81-9's bundle:
    // `f = g && process.env.COPILOT_TEST_DISABLE_INTERRUPTED_SESSION_RESTORE !== 'true' && ...`).
    // Revisit if a documented/stable flag ships, since GitHub may remove this key.
    COPILOT_TEST_DISABLE_INTERRUPTED_SESSION_RESTORE: 'true',
  };
}

/**
 * Hosts one real Copilot TUI runtime for an office by launching
 * `copilot --ui-server --port 0` inside node-pty.
 *
 * The PTY remains the source of terminal bytes and human keystroke input; the
 * discovered local control port is used only by {@link ControlPlaneClient}.
 */
export class UiServerHostRuntime {
  private readonly proc: UiServerPty;
  private readonly listeningPromise: Promise<number>;
  private readonly listeningTimeout: NodeJS.Timeout;
  private resolveListening!: (port: number) => void;
  private rejectListening!: (error: Error) => void;
  private controlPort: number | null = null;
  private promoDismissed = false;
  private startupBuffer = '';

  status: UiServerStatus = 'launching';

  constructor(
    readonly officeId: string,
    pty: typeof import('node-pty'),
    cliPath: string,
    repoRoot: string,
    options: Pick<StartTerminalOptions, 'cols' | 'rows' | 'cwd' | 'env' | 'extraArgs' | 'yolo'>,
    listeningTimeoutMs = 15_000,
  ) {
    const launch = createSdkCliLaunchConfig(cliPath);
    this.listeningPromise = new Promise<number>((resolve, reject) => {
      this.resolveListening = resolve;
      this.rejectListening = reject;
    });
    // Defensive: guarantee the stored promise always has a handler so a
    // port-discovery timeout/exit can NEVER surface as a fatal unhandled
    // rejection that crashes the whole terminal server. Consumers still receive
    // the rejection through their own `await whenListening()`.
    this.listeningPromise.catch(() => { /* handled by awaiters */ });
    this.listeningTimeout = setTimeout(() => {
      this.status = 'crashed';
      this.rejectListening(new Error(`Timed out waiting for Copilot UI server port for office ${officeId}`));
    }, listeningTimeoutMs);

    const extraArgs = (options.extraArgs ?? []).filter((a) => a && a.trim().length > 0);
    // FR-009: under ui-server the SDK client's onPermissionRequest handler does NOT
    // reliably intercept permission prompts for the hosted runtime (esp. resumed
    // sessions), so YOLO must be enforced at the runtime itself. Launch the host
    // with `--yolo` (all tool/path/url permissions) when YOLO is on. This is
    // captured at host-creation (one host per office); toggling YOLO afterwards
    // requires the office host to respawn.
    const yoloArgs = options.yolo ? ['--yolo'] : [];
    this.proc = pty.spawn(launch.cliPath, [...launch.cliArgs, ...extraArgs, ...yoloArgs, '--ui-server', '--port', '0'], {
      name: 'xterm-256color',
      cols: options.cols,
      rows: options.rows,
      cwd: options.cwd,
      env: buildUiServerEnv(options.env, repoRoot),
    });

    this.proc.onData((data) => {
      // Parse the control port FIRST so that if a single PTY chunk ever carries
      // both late startup noise and the "listening on port" line, we never write
      // stray input into an already-live runtime.
      const match = /listening on port (\d+)/i.exec(data);
      if (match && this.controlPort === null) {
        this.controlPort = Number(match[1]);
        this.status = 'listening';
        this.startupBuffer = '';
        clearTimeout(this.listeningTimeout);
        this.resolveListening(this.controlPort);
        return;
      }

      // Before the server is listening, watch for the CLI's install-nudge
      // "install the desktop app?" promo modal, which blocks --ui-server
      // startup by waiting on stdin. It is a one-time nudge per profile —
      // gated by `appInstallNudgeResponded` in ~/.copilot/config.json — so it
      // fires on a fresh machine/user (or when a CLI upgrade adds a new
      // interstitial), not on a fixed schedule. Dismiss it once with ESC
      // (cancel/dismiss) — verified to close the nudge without triggering an
      // install and to generalize to reworded modals better than a Y/N key.
      // Detection uses a bounded rolling buffer because the prompt text can
      // straddle PTY chunk boundaries.
      if (this.controlPort === null && !this.promoDismissed) {
        this.startupBuffer = (this.startupBuffer + data).slice(-4000);
        if (/install it\?|Yes, install/i.test(this.startupBuffer)) {
          this.promoDismissed = true;
          try {
            this.proc.write('\x1b');
          } catch {
            // PTY already gone; onExit will surface the failure.
          }
        }
      }
    });

    this.proc.onExit((event) => {
      clearTimeout(this.listeningTimeout);
      if (this.status !== 'stopped') {
        this.status = 'crashed';
        this.rejectListening(new Error(`Copilot UI server exited before ready (code ${event.exitCode})`));
      }
    });
  }

  get pid(): number {
    return this.proc.pid;
  }

  get rawPty(): UiServerPty {
    return this.proc;
  }

  whenListening(): Promise<number> {
    return this.listeningPromise;
  }

  markReady(): void {
    if (this.status === 'listening') {
      this.status = 'ready';
    }
  }

  stop(): void {
    if (this.status === 'stopped') return;
    this.status = 'stopped';
    clearTimeout(this.listeningTimeout);
    try {
      if (os.platform() === 'win32') {
        try {
          execSync(`taskkill /T /F /PID ${this.proc.pid}`, { stdio: 'ignore' });
        } catch {
          this.proc.kill();
        }
      } else {
        this.proc.kill();
      }
    } catch {
      // Runtime is already gone.
    }
  }
}

/**
 * SDK control-plane client attached to an already-running UI-server runtime.
 *
 * This intentionally does not pass auth options: `RuntimeConnection.forUri`
 * connects to a hosted runtime that owns authentication and GitHub identity.
 */
export class ControlPlaneClient {
  private client: UiServerClient | null = null;
  private startPromise: Promise<void> | null = null;
  private CopilotClient: UiServerClientConstructor | null = null;
  private RuntimeConnection: RuntimeConnectionForUri | null = null;
  private approveAll: unknown;

  constructor(private readonly runtime: UiServerHostRuntime) {}

  async start(): Promise<void> {
    if (!this.startPromise) {
      this.startPromise = this.startClient();
    }

    await this.startPromise;
  }

  async createOrResumeSession(
    sessionId: string,
    cwd: string,
    isYoloEnabled: () => boolean = () => false,
  ): Promise<UiServerSession> {
    const client = await this.getStartedClient();
    // FR-009: map the app's YOLO posture onto the SDK permission handler.
    // - YOLO on  → auto-approve every request (SDK-exported `approveAll`).
    // - YOLO off → return `{ kind: 'no-result' }` so the client does NOT decide,
    //   deferring the prompt to the hosted runtime's own TUI (which the human is
    //   viewing). NOTE: the deferral path is not yet empirically verified against a
    //   live ui-server runtime in this environment — see research.md T030 note.
    // `isYoloEnabled` is evaluated PER REQUEST (not captured), so toggling YOLO in
    // the app takes effect on already-running ui-server sessions without a reopen.
    const approveAll = this.approveAll as PermissionHandler | undefined;
    const onPermissionRequest: PermissionHandler = async (request, invocation) => {
      if (isYoloEnabled()) {
        return approveAll ? approveAll(request, invocation) : { kind: 'approved' };
      }
      return { kind: 'no-result' };
    };
    const sharedConfig: Record<string, unknown> = {
      streaming: true,
      workingDirectory: cwd,
      // Inject the user's custom agents (~/.copilot/agents + <cwd>/.github/agents)
      // so SDK-created ("New Session") sessions expose them like the TUI does.
      customAgents: loadCustomAgents(cwd),
      // Inject the user's skills too (~/.copilot/skills + <cwd>/.github/skills)
      // so SDK-created ("New Session") sessions load them like the TUI does.
      // See ./custom-skills.
      enableSkills: true,
      skillDirectories: resolveSkillDirectories(cwd),
      onPermissionRequest,
      // spec 015 prerequisite: advertise `ask_user` (requestUserInput: true) and
      // provide the late-resolvable answer channel. Without this the model refuses
      // to call ask_user. The relay of the question itself rides the normal event
      // stream (user_input.requested → server watcherCallback).
      onUserInputRequest: makeUserInputHandler(sessionId),
    };

    try {
      return await client.resumeSession(sessionId, sharedConfig);
    } catch {
      return client.createSession({
        sessionId,
        ...sharedConfig,
      });
    }
  }

  async setForeground(sessionId: string): Promise<void> {
    const client = await this.getStartedClient();
    await client.setForegroundSessionId(sessionId);
  }

  async listSessions(): Promise<unknown> {
    const client = await this.getStartedClient();
    return client.listSessions();
  }

  async stop(): Promise<void> {
    if (this.client?.stop) {
      await this.client.stop();
    }
  }

  private async getStartedClient(): Promise<UiServerClient> {
    await this.start();
    if (!this.client) {
      throw new Error('Control plane client did not initialize');
    }

    return this.client;
  }

  private async startClient(): Promise<void> {
    const port = await this.runtime.whenListening();
    await this.loadSdk();
    if (!this.CopilotClient || !this.RuntimeConnection) {
      throw new Error('Copilot SDK did not expose required ui-server APIs');
    }

    this.client = new this.CopilotClient({
      connection: this.RuntimeConnection.forUri(`localhost:${port}`),
    });
    await this.client.start();
    this.runtime.markReady();
  }

  private async loadSdk(): Promise<void> {
    if (this.CopilotClient && this.RuntimeConnection) return;

    const sdk = await import('@github/copilot-sdk') as unknown as {
      CopilotClient?: UiServerClientConstructor;
      RuntimeConnection?: RuntimeConnectionForUri;
      approveAll?: unknown;
    };
    if (!sdk.CopilotClient || !sdk.RuntimeConnection?.forUri) {
      throw new Error('Installed Copilot SDK lacks RuntimeConnection.forUri support');
    }

    this.CopilotClient = sdk.CopilotClient;
    this.RuntimeConnection = sdk.RuntimeConnection;
    this.approveAll = sdk.approveAll;
  }
}

export class UiServerProcess implements TerminalProcess {
  private static nextSyntheticPid = 1_000_000;
  private readonly dataDisposables: Array<{ dispose(): void }> = [];
  private readonly exitDisposables: Array<{ dispose(): void }> = [];
  private readonly exitListeners: Array<(event: TerminalExitEvent) => void> = [];
  private queuedSend: Promise<void> = Promise.resolve();
  private closed = false;

  readonly pid: number;

  constructor(
    private readonly sessionId: string,
    private readonly session: UiServerSession,
    private readonly runtime: UiServerHostRuntime,
    private readonly client: ControlPlaneClient,
  ) {
    this.pid = UiServerProcess.nextSyntheticPid++;
  }

  write(data: string): void {
    if (this.closed || this.runtime.status === 'launching' || this.runtime.status === 'crashed' || this.runtime.status === 'stopped') {
      return;
    }

    this.runtime.rawPty.write(data);
  }

  resize(cols: number, rows: number): void {
    if (this.closed) return;
    this.runtime.rawPty.resize(cols, rows);
  }

  onData(callback: (data: string) => void): void {
    const disposable = this.runtime.rawPty.onData(callback);
    this.dataDisposables.push(disposable);
  }

  onExit(callback: (event: TerminalExitEvent) => void): void {
    this.exitListeners.push(callback);
    const disposable = this.runtime.rawPty.onExit((event) => {
      callback({ exitCode: event.exitCode });
    });
    this.exitDisposables.push(disposable);
  }

  /**
   * Submit a full prompt through the SDK control plane. The optional label is
   * intentionally not sent; server/UI wiring may render it separately later.
   */
  submitPrompt(text: string, _label?: string): void {
    if (this.closed) return;
    const prompt = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').trim();
    if (!prompt) return;

    this.queuedSend = this.queuedSend
      .then(async () => {
        await this.session.send({ prompt, mode: 'enqueue' });
      })
      .catch((error: unknown) => {
        console.warn(`[UiServerProcess] Failed to submit prompt for ${this.sessionId}: ${String(error)}`);
      });
  }

  kill(): void {
    if (this.closed) return;
    this.closed = true;
    for (const disposable of this.dataDisposables) {
      disposable.dispose();
    }
    for (const disposable of this.exitDisposables) {
      disposable.dispose();
    }

    Promise.resolve(this.session.disconnect())
      .catch((error: unknown) => {
        console.warn(`[UiServerProcess] Failed to disconnect session ${this.sessionId}: ${String(error)}`);
      })
      .finally(() => {
        this.emitExit({ exitCode: 0 });
      });
  }

  setForeground(): Promise<void> {
    return this.client.setForeground(this.sessionId);
  }

  /**
   * Build the SDK-backed event source for this agent (T011). Status/tool/turn
   * events flow from `session.on(...)` via {@link SdkEventSource}, normalized to
   * the shared `CopilotEvent` shape, instead of tailing `events.jsonl`.
   */
  createEventSource(): CopilotEventSource {
    return new SdkEventSource(this.sessionId, this.session as unknown as SdkCopilotSession);
  }

  private emitExit(event: TerminalExitEvent): void {
    for (const listener of this.exitListeners) {
      listener(event);
    }
  }
}

type UiServerOfficeEntry = {
  runtime: UiServerHostRuntime;
  client: ControlPlaneClient;
};

const DEFAULT_UI_SERVER_OFFICE_ID = '__default__';

/**
 * Terminal backend for SDK Control Plane Variant 1: one shared Copilot
 * TUI+server runtime per office, with per-agent SDK sessions multiplexed onto
 * that runtime.
 *
 * Wired into server.ts: backend selection + start-time fallback (T008/T039),
 * SDK event source (T011), and foreground-switch on viewer attach (T024).
 */
export class UiServerBackend implements TerminalBackend {
  readonly name = 'ui-server';
  private readonly offices = new Map<string, UiServerOfficeEntry>();

  constructor(
    private readonly pty: typeof import('node-pty'),
    private readonly cliPath: string | null,
    private readonly repoRoot = process.cwd(),
  ) {}

  static tryCreate(cliPath: string | null, repoRoot = process.cwd()): UiServerBackend | null {
    try {
      const pty = require('node-pty') as typeof import('node-pty');
      return new UiServerBackend(pty, cliPath, repoRoot);
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    return probeUiServerSupport(this.cliPath);
  }

  async start(options: StartTerminalOptions): Promise<TerminalProcess> {
    if (!this.cliPath) {
      throw new Error('Cannot start ui-server backend without a resolved Copilot CLI path');
    }

    const officeId = options.officeId ?? DEFAULT_UI_SERVER_OFFICE_ID;
    const entry = this.getOrCreateOfficeEntry(officeId, options);
    try {
      await entry.client.start();
      const session = await entry.client.createOrResumeSession(
        options.sessionId,
        options.cwd,
        options.isYoloEnabled ?? (() => options.yolo ?? false),
      );
      const process = new UiServerProcess(options.sessionId, session, entry.runtime, entry.client);
      await process.setForeground();
      return process;
    } catch (error) {
      // Any failure bringing the office runtime online (e.g. the resolved CLI
      // does not emit a control port) must not leave a half-broken cached entry
      // or a stray PTY. Tear it down and rethrow so the server can return a
      // clean failure (and the app can fall back to node-pty).
      try { void Promise.resolve(entry.client.stop()).catch(() => { /* best effort */ }); } catch { /* best effort */ }
      try { entry.runtime.stop(); } catch { /* best effort */ }
      this.offices.delete(officeId);
      throw error instanceof Error ? error : new Error(String(error));
    }
  }

  private getOrCreateOfficeEntry(officeId: string, options: StartTerminalOptions): UiServerOfficeEntry {
    const existing = this.offices.get(officeId);
    if (existing && existing.runtime.status !== 'crashed' && existing.runtime.status !== 'stopped') {
      return existing;
    }

    const runtime = new UiServerHostRuntime(officeId, this.pty, this.cliPath!, this.repoRoot, options);
    const client = new ControlPlaneClient(runtime);
    const entry = { runtime, client };
    this.offices.set(officeId, entry);
    return entry;
  }
}

function createSdkCliLaunchConfig(cliPath: string): { cliPath: string; cliArgs: string[] } {
  if (os.platform() === 'win32' && /\.(bat|cmd)$/i.test(cliPath)) {
    const commandProcessor = process.env.ComSpec || path.join(process.env.WINDIR || 'C:\\Windows', 'System32', 'cmd.exe');
    return {
      cliPath: commandProcessor,
      cliArgs: ['/c', cliPath],
    };
  }

  return { cliPath, cliArgs: [] };
}
