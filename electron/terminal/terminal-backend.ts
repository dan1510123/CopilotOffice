import { execSync, spawn, type ChildProcessWithoutNullStreams, type SpawnOptions } from 'child_process';
import * as os from 'os';
import * as path from 'path';
import { SdkEventSource, type CopilotEventSource, type SdkCopilotSession } from './event-source';
import type { ExitPlanModeHandler, ExitPlanModeResult } from '@github/copilot-sdk';
import type { ControlCommand, ControlData } from './protocol';
import { loadCustomAgents } from './custom-agents';
import { resolveSkillDirectories } from './custom-skills';

// ── spec 015: ask_user (SDK user-input interaction) answer channel ──────────────
//
// Registering an `onUserInputRequest` handler on every managed SDK session
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
 * every managed SDK session so `ask_user` is usable. `sessionId` is the ONLY
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

/** Programmatic transport that can resolve an `ask_user` answer. */
export type AnswerTransport = 'bridge' | 'sdk';

/**
 * Decide how an `ask_user` answer is delivered for a backend process (spec 015).
 * Native-bridge processes expose `submitAnswer`: the pending interaction lives in the
 * TUI's bridge extension, so the answer is routed over the authenticated broker.
 * SDK backends expose `submitPrompt` (a real programmatic session) and resolve
 * the pending interaction by `requestId` via {@link handlePendingUserInput}. The raw
 * node-pty backend omits both and has no programmatic session: returns `null`, and
 * the caller must report an explicit failure (answers are never typed as keystrokes).
 * This is the single source of truth for the server's submit-answer routing.
 */
export function answerTransport(
  proc: Pick<TerminalProcess, 'submitPrompt' | 'submitAnswer'>,
): AnswerTransport | null {
  if (typeof proc.submitAnswer === 'function') return 'bridge';
  return typeof proc.submitPrompt === 'function' ? 'sdk' : null;
}

/** Kinds of programmatic input the server may route to an agent's session. */
export type ProgrammaticInputKind = 'prompt' | 'control' | 'answer';

const PROGRAMMATIC_INPUT_NOUN: Record<ProgrammaticInputKind, string> = {
  prompt: 'programmatic prompts',
  control: 'control commands',
  answer: 'ask_user answers',
};

/**
 * Explicit error for programmatic input sent to a process without a programmatic
 * session (the raw node-pty backend). Programmatic input is never synthesized as
 * keystrokes; raw `write()` stays reserved for human typing and shell input.
 */
export function programmaticInputUnsupportedError(kind: ProgrammaticInputKind): string {
  return `${PROGRAMMATIC_INPUT_NOUN[kind]} require the SDK/native-bridge backend`;
}

// ── plan mode (SDK exit_plan_mode interaction) approval channel ─────────────────
//
// Mirrors the ask_user (spec 015) machinery above. When a managed SDK session
// enters plan mode and the agent calls `exit_plan_mode`, the SDK invokes the registered
// `onExitPlanModeRequest` handler and BLOCKS the turn on the promise it returns. Like
// `onUserInputRequest`, the callback carries no requestId — the parallel event stream
// (`exit_plan_mode.requested` / `.completed`) carries the `requestId` that Teams relays
// and echoes back — so the pending resolver is keyed by `sessionId` alone (at most one
// blocking plan approval per session at a time). The resolver is fired out-of-band by
// {@link handlePendingPlanApproval} when a Teams reply arrives; a local TUI approval
// resolves the runtime directly and surfaces as `exit_plan_mode.completed`, which the
// Teams consumer uses to clear its pending record (first-resolver-wins). node-pty has no
// SDK client and therefore never registers this handler — plan approval there stays a
// native TUI selector (render-only in Teams).

interface PendingPlanApprovalEntry {
  resolve: (r: ExitPlanModeResult) => void;
  sessionId: string;
}

/** Pending plan approvals keyed by `sessionId` (one blocking plan interaction per session). */
const pendingPlanApproval = new Map<string, PendingPlanApprovalEntry>();

/**
 * Build the SDK `onExitPlanModeRequest` handler. Registered on every managed
 * SDK session so a Teams-online agent's plan can be approved/rejected from the
 * thread. Returns a promise resolved LATE by {@link handlePendingPlanApproval} when the
 * decision arrives. The relay of the plan itself rides the normal event stream
 * (`exit_plan_mode.requested` → server watcherCallback), NOT this callback.
 */
export function makeExitPlanModeHandler(sessionId: string): ExitPlanModeHandler {
  return (_request, ctx) =>
    new Promise<ExitPlanModeResult>((resolve) => {
      const scope = sessionId || ctx?.sessionId || '';
      const existing = pendingPlanApproval.get(scope);
      if (existing) {
        // exit_plan_mode blocks the turn, so a second pending approval for the same
        // session should not occur. If it somehow does, the old resolver would leak — warn.
        console.warn(
          `[terminal-backend] makeExitPlanModeHandler: replacing an UNRESOLVED pending plan approval for session="${scope}" (its promise will never resolve)`,
        );
      }
      pendingPlanApproval.set(scope, { resolve, sessionId: scope });
    });
}

/**
 * Resolve the pending plan approval for `sessionId`. Idempotent: an unknown or
 * already-resolved session is a no-op + warn (supports the single-resolution Teams/local
 * race). Returns true only when a stored resolver actually fired.
 */
export function handlePendingPlanApproval(sessionId: string, result: ExitPlanModeResult): boolean {
  const entry = pendingPlanApproval.get(sessionId);
  if (!entry) {
    console.warn(
      `[terminal-backend] handlePendingPlanApproval: no pending plan approval for session="${sessionId}" (already resolved or unknown) — no-op`,
    );
    return false;
  }
  pendingPlanApproval.delete(sessionId);
  entry.resolve(result);
  return true;
}

/**
 * GC the outstanding pending plan approval owned by `sessionId`. Called when a session
 * exits/resets/is killed so an agent torn down mid-plan cannot leak an unresolved
 * resolver. Returns the number of entries dropped (0 or 1).
 */
export function clearPendingPlanApprovalForSession(sessionId: string): number {
  return pendingPlanApproval.delete(sessionId) ? 1 : 0;
}

/** Test/diagnostics helper: number of outstanding pending plan approvals. */
export function pendingPlanApprovalCount(): number {
  return pendingPlanApproval.size;
}

export interface TerminalExitEvent {
  exitCode: number;
}

/** A bridge registration observed for a process's native TUI (initial connect or replacement). */
export interface TerminalSessionChange {
  /** Session the TUI is attached to now — authoritative over any persisted id. */
  sessionId: string;
  /** Session the bridge was attached to before this registration, if any. */
  previousSessionId?: string;
}

/** Decision on a pending plan-mode (`exit_plan_mode`) interaction. */
export interface TerminalPlanDecision {
  requestId?: string;
  approved: boolean;
  selectedAction?: string;
  feedback?: string;
}

export interface TerminalProcess {
  readonly pid: number;
  /** Current authoritative session id for reconnecting backends (native bridge). */
  getSessionId?(): string;
  write(data: string): void;
  resize(cols: number, rows: number): void;
  onData(callback: (data: string) => void): void;
  onExit(callback: (event: TerminalExitEvent) => void): void;
  kill(): void;
  /**
   * Optional: submit a full prompt to the underlying agent atomically, bypassing
   * the character-by-character line editor. Implemented by SDK-backed processes
   * (calls `session.send({ prompt, mode: 'enqueue' })` directly). Backends that
   * omit it (raw node-pty) do not accept programmatic prompts — callers report an
   * explicit failure instead of typing keystrokes. May return a promise (native
   * bridge) that settles once the agent accepted the prompt or rejects with an
   * explicit error; callers must await it.
   *
   * `label`, when provided, is rendered as a display-only tag in front of the
   * echoed prompt (e.g. "[Teams · Alice]"). It is NEVER included in the text
   * sent to the agent — the model receives only `text`.
   */
  submitPrompt?(text: string, label?: string): void | Promise<void>;

  /**
   * Optional: answer the session's pending `ask_user` interaction through a
   * dedicated control channel (native bridge). Rejects with an explicit error
   * when there is no pending interaction or the channel is unavailable.
   */
  submitAnswer?(answer: { requestId?: string; answer: string; wasFreeform: boolean }): Promise<void>;

  /**
   * Optional: resolve the session's pending plan-mode decision through a
   * dedicated control channel (native bridge). Rejects with an explicit error
   * when there is no pending plan or the channel is unavailable.
   */
  submitPlanDecision?(decision: TerminalPlanDecision): Promise<void>;

  /**
   * Optional: resolves once the process's programmatic control channel is
   * connected (native bridge registration); rejects after `timeoutMs`.
   */
  whenReady?(timeoutMs?: number): Promise<void>;

  /**
   * Optional: observe bridge registrations for this process's TUI — the first
   * connect and every later session replacement (e.g. `/clear`). The listener
   * is invoked synchronously, before any event from the new registration is
   * delivered. Returns an unsubscribe function.
   */
  onSessionChange?(listener: (change: TerminalSessionChange) => void): () => void;

  /**
   * Optional: run a session control command (`/compact`, `/usage`, `/model`) via the
   * SDK control plane (`session.rpc.*`) and return structured, postable data. Implemented
   * by SDK-backed and native-bridge processes; the raw node-pty backend omits it (the
   * server reports the command as unsupported). Rejects if the session's RPC surface
   * does not support the requested command.
   */
  runControl?(cmd: ControlCommand): Promise<ControlData>;

  /**
   * Optional: build the {@link CopilotEventSource} for this process's agent.
   * SDK-backed processes return an {@link SdkEventSource} bound to the
   * live session so status/tool/turn events come from `session.on(...)` instead of
   * tailing `events.jsonl`. Backends that omit it are driven by the file watcher.
   */
  createEventSource?(): CopilotEventSource;
}

export interface StartTerminalOptions {
  sessionId: string;
  officeId?: string;
  /**
   * Stable identity of the terminal being started (the server's composite
   * `${officeId}:${agentId}` key). Backends that allocate per-terminal
   * resources (native bridge credentials) use it as a readable prefix.
   */
  terminalKey?: string;
  shell: string;
  cols: number;
  rows: number;
  cwd: string;
  /** Office-level cwd for the shared per-office SDK host; session cwd may be agent-specific. */
  hostCwd?: string;
  env: { [key: string]: string };
  /** YOLO/auto-approve posture for this session (FR-009). Defaults to false. */
  yolo?: boolean;
  /**
   * Extra CLI arguments from the app's "additional parameters" setting
   * (e.g. ['--model', 'gpt-5.4']). For the sdk backend these are appended
   * to the per-office headless host launch; the host is created once per office,
   * so the args are captured from the first agent that starts it. Empty/omitted = none.
   */
  extraArgs?: string[];
}

export interface TerminalBackend {
  readonly name: string;
  isAvailable(): boolean;
  start(options: StartTerminalOptions): Promise<TerminalProcess>;
  restartOffice?(officeId: string): Promise<void>;
  stop?(): Promise<void>;
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
 * Code wrapper), so it can be spawned directly (headless host / native TUI).
 * Preferring it makes CLI resolution deterministic and npm-managed instead of
 * depending on whatever `copilot` happens to be first on the user's PATH (which
 * on dev machines is often the VS Code copilot-chat shim). Returns null if the
 * platform package isn't installed.
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

// ── Session control (Teams slash-command execution via the SDK control plane) ────
//
// The managed SDK session is a full `CopilotSession` exposing a typed
// `rpc` surface. `/compact`, `/usage` and `/model` map to real RPC calls that return
// structured, postable content — so Teams can execute them instead of enqueueing the
// slash text as a model prompt. Only the narrow subset used here is typed; each call
// site guards for method presence so an older runtime degrades to a clear error
// (which the server turns into a graceful Teams notice) rather than throwing opaquely.

type ControlSession = {
  rpc?: {
    history?: {
      compact?(params?: { instructions?: string }): Promise<{
        success?: boolean;
        tokensRemoved?: number;
        messagesRemoved?: number;
        summaryContent?: string;
      }>;
    };
    usage?: {
      getMetrics?(): Promise<{
        totalPremiumRequestCost?: number;
        totalUserRequests?: number;
        totalApiDurationMs?: number;
      }>;
    };
    metadata?: {
      contextInfo?(params: {
        promptTokenLimit: number;
        outputTokenLimit: number;
        selectedModel?: string;
      }): Promise<{
        contextInfo?: { totalTokens?: number; promptTokenLimit?: number; compactionThreshold?: number } | null;
      }>;
    };
    model?: {
      getCurrent?(): Promise<{ modelId?: string; reasoningEffort?: string }>;
      switchTo?(params: { modelId: string }): Promise<{ modelId?: string }>;
    };
  };
};

/**
 * Execute a control command against an SDK-backed session's RPC surface. Used by
 * {@link CopilotSdkProcess}. Rejects with a descriptive
 * error when the session lacks the required RPC method.
 */
export async function runSessionControl(session: ControlSession, cmd: ControlCommand): Promise<ControlData> {
  const rpc = session?.rpc;
  if (!rpc) throw new Error('SDK session exposes no rpc control surface');

  switch (cmd.command) {
    case 'compact': {
      if (!rpc.history?.compact) throw new Error('compaction is not supported by this session');
      const r = await rpc.history.compact(cmd.arg ? { instructions: cmd.arg } : undefined);
      return {
        kind: 'compact',
        success: !!r?.success,
        tokensRemoved: r?.tokensRemoved ?? 0,
        messagesRemoved: r?.messagesRemoved ?? 0,
        summary: r?.summaryContent,
      };
    }
    case 'usage': {
      if (!rpc.usage?.getMetrics) throw new Error('usage metrics are not supported by this session');
      const m = await rpc.usage.getMetrics();
      let ctx: { totalTokens?: number; promptTokenLimit?: number; compactionThreshold?: number } | undefined;
      try {
        const info = await rpc.metadata?.contextInfo?.({ promptTokenLimit: 0, outputTokenLimit: 0 });
        ctx = info?.contextInfo ?? undefined;
      } catch {
        ctx = undefined; // context breakdown is best-effort — usage metrics alone still post.
      }
      return {
        kind: 'usage',
        premiumRequestCost: m?.totalPremiumRequestCost,
        userRequests: m?.totalUserRequests,
        apiDurationMs: m?.totalApiDurationMs,
        totalTokens: ctx?.totalTokens,
        promptTokenLimit: ctx?.promptTokenLimit,
        compactionThreshold: ctx?.compactionThreshold,
      };
    }
    case 'model': {
      if (!rpc.model?.getCurrent) throw new Error('model control is not supported by this session');
      let switchedTo: string | undefined;
      if (cmd.arg && rpc.model.switchTo) {
        const s = await rpc.model.switchTo({ modelId: cmd.arg });
        switchedTo = s?.modelId ?? cmd.arg;
      }
      const cur = await rpc.model.getCurrent();
      return { kind: 'model', current: cur?.modelId, reasoningEffort: cur?.reasoningEffort, switchedTo };
    }
    default: {
      const never: never = cmd.command;
      throw new Error(`unknown control command: ${String(never)}`);
    }
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
    private readonly sessionId: string,
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

  /** Run a control command (`/compact`, `/usage`, `/model`) via the SDK RPC surface. */
  runControl(cmd: ControlCommand): Promise<ControlData> {
    return runSessionControl(this.session as unknown as ControlSession, cmd);
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

  handleHostExit(error: Error): void {
    if (this.closed) return;
    this.closed = true;
    this.emitData(`\r\n\x1b[31m[SDK host exited: ${error.message}]\x1b[0m\r\n`);
    this.emitExit({ exitCode: 1 });
  }

  createEventSource(): CopilotEventSource {
    return new SdkEventSource(
      this.sessionId,
      this.session as unknown as SdkCopilotSession,
    );
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

type HeadlessHostStatus = 'launching' | 'listening' | 'crashed' | 'stopped';

type HeadlessSpawn = (
  command: string,
  args: readonly string[],
  options: SpawnOptions,
) => ChildProcessWithoutNullStreams;

const spawnHeadless: HeadlessSpawn = (command, args, options) =>
  spawn(command, [...args], options) as ChildProcessWithoutNullStreams;

const HEADLESS_PORT_PATTERN = /CLI server listening on port\s+(\d+)/i;

/** Incremental parser for the headless CLI's buffered port announcement. */
export class HeadlessPortParser {
  private buffer = '';

  push(chunk: string | Buffer): number | null {
    this.buffer = (this.buffer + chunk.toString()).slice(-64 * 1024);
    const match = HEADLESS_PORT_PATTERN.exec(this.buffer);
    if (!match) return null;
    const port = Number(match[1]);
    return Number.isInteger(port) && port > 0 && port <= 65_535 ? port : null;
  }
}

export function buildHeadlessHostArgs(extraArgs: readonly string[] = []): string[] {
  return [...extraArgs, '--headless', '--port', '0', '--no-auto-update'];
}

function buildHeadlessHostEnv(
  env: { [key: string]: string },
  repoRoot: string,
): { [key: string]: string } {
  const sanitizedPath = sanitizeCopilotPath(env.PATH ?? env.Path ?? process.env.PATH, repoRoot);
  return {
    ...env,
    PATH: sanitizedPath,
    Path: sanitizedPath,
    COPILOT_AUTO_UPDATE: 'false',
  };
}

export class HeadlessCliHost {
  private readonly proc: ChildProcessWithoutNullStreams;
  private readonly listeningPromise: Promise<number>;
  private readonly exitListeners = new Set<(error: Error) => void>();
  private statusValue: HeadlessHostStatus = 'launching';

  constructor(
    readonly officeId: string,
    cliPath: string,
    repoRoot: string,
    options: Pick<StartTerminalOptions, 'cwd' | 'hostCwd' | 'env' | 'extraArgs'>,
    spawnProcess: HeadlessSpawn = spawnHeadless,
    listeningTimeoutMs = 15_000,
  ) {
    let settle!: (port: number) => void;
    let fail!: (error: Error) => void;
    this.listeningPromise = new Promise<number>((resolve, reject) => {
      settle = resolve;
      fail = reject;
    });
    void this.listeningPromise.catch(() => { /* caller observes via whenListening */ });

    const parser = new HeadlessPortParser();
    let settled = false;
    const resolvePort = (chunk: string | Buffer) => {
      if (settled) return;
      const port = parser.push(chunk);
      if (port === null) return;
      settled = true;
      this.statusValue = 'listening';
      clearTimeout(timeout);
      settle(port);
    };
    const rejectStartup = (error: Error) => {
      if (settled) return;
      settled = true;
      this.statusValue = 'crashed';
      clearTimeout(timeout);
      fail(error);
    };

    this.proc = spawnProcess(
      cliPath,
      buildHeadlessHostArgs(options.extraArgs),
      {
        cwd: options.hostCwd ?? options.cwd,
        env: buildHeadlessHostEnv(options.env, repoRoot),
        shell: false,
        windowsHide: true,
        stdio: 'pipe',
      },
    );
    const timeout = setTimeout(() => {
      rejectStartup(new Error(`Timed out waiting for headless Copilot host for office ${officeId}`));
      this.stop();
    }, listeningTimeoutMs);

    this.proc.stdout.on('data', resolvePort);
    this.proc.stderr.on('data', resolvePort);
    this.proc.once('error', (error) => rejectStartup(error));
    this.proc.once('exit', (code, signal) => {
      if (this.statusValue !== 'stopped') this.statusValue = 'crashed';
      const error = new Error(
        `Headless Copilot host for office ${officeId} exited (code=${String(code)}, signal=${String(signal)})`,
      );
      rejectStartup(error);
      if (this.statusValue === 'crashed') {
        for (const listener of this.exitListeners) listener(error);
      }
    });
  }

  get status(): HeadlessHostStatus {
    return this.statusValue;
  }

  whenListening(): Promise<number> {
    return this.listeningPromise;
  }

  onExit(callback: (error: Error) => void): () => void {
    this.exitListeners.add(callback);
    return () => this.exitListeners.delete(callback);
  }

  stop(): void {
    if (this.statusValue === 'stopped') return;
    this.statusValue = 'stopped';
    if (this.proc.killed) return;
    if (os.platform() === 'win32' && typeof this.proc.pid === 'number') {
      try {
        execSync(`taskkill /T /F /PID ${this.proc.pid}`, { stdio: 'ignore' });
        return;
      } catch {
        // Fall through to the direct child kill if tree termination fails.
      }
    }
    this.proc.kill();
  }
}

type SdkHostClient = {
  start(): Promise<void>;
  createSession(options: Record<string, unknown>): Promise<any>;
  resumeSession(sessionId: string, options: Record<string, unknown>): Promise<any>;
  stop?(): Promise<unknown>;
  forceStop?(): Promise<void>;
};

type SdkHostClientConstructor = new (options?: Record<string, unknown>) => SdkHostClient;

type RuntimeConnectionForUri = {
  forUri(uri: string): unknown;
};

type SdkOfficeEntry = {
  host: HeadlessCliHost;
  client: SdkHostClient | null;
  startPromise: Promise<SdkHostClient>;
  processes: Set<CopilotSdkProcess>;
};

const DEFAULT_SDK_OFFICE_ID = '__default__';

export class CopilotSdkBackend implements TerminalBackend {
  readonly name = 'sdk';
  private readonly offices = new Map<string, SdkOfficeEntry>();
  private nextPid = 1_000_000;

  constructor(
    private readonly CopilotClient: SdkHostClientConstructor,
    private readonly RuntimeConnection: RuntimeConnectionForUri,
    private readonly approveAll: unknown,
    private readonly cliPath: string,
    private readonly repoRoot = process.cwd(),
    private readonly spawnProcess: HeadlessSpawn = spawnHeadless,
  ) {}

  static async tryCreate(cliPath: string | null): Promise<CopilotSdkBackend | null> {
    if (!cliPath) {
      return null;
    }
    // The headless host is intentionally spawned without a shell. Windows
    // command scripts require cmd.exe and therefore are not valid host binaries;
    // normal packaged installs resolve the native platform executable first.
    if (os.platform() === 'win32' && /\.(bat|cmd)$/i.test(cliPath)) {
      return null;
    }

    try {
      const sdk = await import('@github/copilot-sdk') as {
        CopilotClient?: SdkHostClientConstructor;
        RuntimeConnection?: RuntimeConnectionForUri;
        approveAll?: unknown;
      };
      if (!sdk.CopilotClient || !sdk.RuntimeConnection?.forUri) return null;
      return new CopilotSdkBackend(
        sdk.CopilotClient,
        sdk.RuntimeConnection,
        sdk.approveAll,
        cliPath,
      );
    } catch {
      return null;
    }
  }

  isAvailable(): boolean {
    return true;
  }

  async start(options: StartTerminalOptions): Promise<TerminalProcess> {
    const officeId = options.officeId ?? DEFAULT_SDK_OFFICE_ID;
    const entry = this.getOrCreateOfficeEntry(officeId, options);
    let client: SdkHostClient;
    try {
      client = await entry.startPromise;
    } catch (error) {
      await this.disposeOfficeEntry(officeId, entry);
      throw error instanceof Error ? error : new Error(String(error));
    }

    // Session creation is isolated: a bad resume/create request for one agent
    // must not tear down the shared office host and disconnect sibling agents.
    const session = await this.resumeOrCreateSession(client, options);
    const process = new CopilotSdkProcess(this.nextPid++, options.sessionId, session, async () => {
      await session.disconnect();
    });
    entry.processes.add(process);
    process.onExit(() => entry.processes.delete(process));
    return process;
  }

  async restartOffice(officeId: string): Promise<void> {
    const entry = this.offices.get(officeId);
    if (entry) await this.disposeOfficeEntry(officeId, entry);
  }

  async stop(): Promise<void> {
    const entries = [...this.offices.entries()];
    this.offices.clear();
    await Promise.all(entries.map(async ([, entry]) => {
      if (entry.client) await this.stopClient(entry.client);
      entry.host.stop();
    }));
  }

  private getOrCreateOfficeEntry(officeId: string, options: StartTerminalOptions): SdkOfficeEntry {
    const existing = this.offices.get(officeId);
    if (existing && existing.host.status !== 'crashed' && existing.host.status !== 'stopped') {
      return existing;
    }
    if (existing) {
      this.offices.delete(officeId);
      if (existing.client) void this.stopClient(existing.client);
      existing.host.stop();
    }

    const host = new HeadlessCliHost(
      officeId,
      this.cliPath,
      this.repoRoot,
      options,
      this.spawnProcess,
    );
    const startPromise = host.whenListening()
      .then(async (port) => {
        const connectedClient = new this.CopilotClient({
          connection: this.RuntimeConnection.forUri(`localhost:${port}`),
        });
        entry.client = connectedClient;
        await connectedClient.start();
        return connectedClient;
      });
    const entry: SdkOfficeEntry = { host, client: null, startPromise, processes: new Set() };
    host.onExit((error) => {
      if (this.offices.get(officeId) !== entry) return;
      this.offices.delete(officeId);
      for (const process of entry.processes) process.handleHostExit(error);
      entry.processes.clear();
      if (entry.client) void this.stopClient(entry.client);
    });
    this.offices.set(officeId, entry);
    return entry;
  }

  private async disposeOfficeEntry(officeId: string, entry: SdkOfficeEntry): Promise<void> {
    if (this.offices.get(officeId) === entry) this.offices.delete(officeId);
    if (entry.client) await this.stopClient(entry.client);
    entry.host.stop();
  }

  private async stopClient(client: SdkHostClient): Promise<void> {
    try {
      await client.stop?.();
    } catch {
      await client.forceStop?.();
    }
  }

  private async resumeOrCreateSession(client: SdkHostClient, options: StartTerminalOptions): Promise<any> {
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
      // Plan mode: register the exit_plan_mode approval handler so a Teams-online agent's
      // plan can be approved/rejected from the thread (resolved late via
      // handlePendingPlanApproval). The plan content itself relays over the event stream.
      onExitPlanModeRequest: makeExitPlanModeHandler(options.sessionId),
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
