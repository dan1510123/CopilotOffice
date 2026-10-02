import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export interface CopilotEvent {
  type: string;
  data: Record<string, unknown>;
  id: string;
  timestamp: string;
  parentId: string | null;
}

export interface ToolExecutionStart {
  toolCallId: string;
  toolName: string;
  arguments: Record<string, unknown>;
}

export interface ToolExecutionComplete {
  toolCallId: string;
  toolName?: string;
  success: boolean;
  result?: {
    content?: string;
    detailedContent?: string;
  };
}

export interface SessionStart {
  sessionId: string;
  version: number;
  producer: string;
  copilotVersion: string;
  startTime: string;
  context: {
    cwd: string;
    gitRoot?: string;
    branch?: string;
  };
}

export type EventCallback = (event: CopilotEvent, isHistorical: boolean) => void;

export interface EventsWatcherOptions {
  filePath?: string;
  maxReadChunkBytes?: number;
  yieldToEventLoop?: () => Promise<void>;
}

export class EventsWatcher {
  private sessionId: string;
  private filePath: string;
  private fileOffset: number = 0;
  private lineBuffer = Buffer.alloc(0);
  private watcher: fs.FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private fileExistsTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private callback: EventCallback | null = null;
  private stopped: boolean = false;
  private watchingFile: boolean = false;
  private initialReadComplete: boolean = false;
  private reading: boolean = false;
  private readRequested: boolean = false;
  private readonly maxReadChunkBytes: number;
  private readonly yieldToEventLoop: () => Promise<void>;

  private static readonly POLL_INTERVAL_MS = 500;
  private static readonly FILE_CHECK_INTERVAL_MS = 200;
  private static readonly MAX_FILE_WAIT_MS = 60_000;
  private static readonly DEFAULT_MAX_READ_CHUNK_BYTES = 256 * 1024;

  constructor(sessionId: string, options: EventsWatcherOptions = {}) {
    this.sessionId = sessionId;
    this.filePath = options.filePath ?? path.join(
      os.homedir(),
      '.copilot',
      'session-state',
      sessionId,
      'events.jsonl'
    );
    this.maxReadChunkBytes = options.maxReadChunkBytes
      ?? EventsWatcher.DEFAULT_MAX_READ_CHUNK_BYTES;
    if (!Number.isSafeInteger(this.maxReadChunkBytes) || this.maxReadChunkBytes <= 0) {
      throw new Error('EventsWatcher maxReadChunkBytes must be a positive integer');
    }
    this.yieldToEventLoop = options.yieldToEventLoop
      ?? (() => new Promise<void>((resolve) => setImmediate(resolve)));
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getFilePath(): string {
    return this.filePath;
  }

  start(onEvent: EventCallback): void {
    this.stop();
    this.callback = onEvent;
    this.stopped = false;
    this.initialReadComplete = false;
    this.readRequested = false;

    // Check if file exists (sync for immediate startup)
    try {
      fs.accessSync(this.filePath, fs.constants.F_OK);
      this.startWatching();
    } catch {
      // Poll for file to appear, with a max wait
      console.log(`[EventsWatcher] Waiting for events.jsonl: ${this.filePath}`);
      const startTime = Date.now();
      this.fileExistsTimer = setInterval(() => {
        if (this.stopped) {
          if (this.fileExistsTimer) clearInterval(this.fileExistsTimer);
          return;
        }
        if (Date.now() - startTime > EventsWatcher.MAX_FILE_WAIT_MS) {
          console.warn(`[EventsWatcher] Timed out waiting for events.jsonl after ${EventsWatcher.MAX_FILE_WAIT_MS / 1000}s`);
          if (this.fileExistsTimer) clearInterval(this.fileExistsTimer);
          this.fileExistsTimer = null;
          return;
        }
        try {
          fs.accessSync(this.filePath, fs.constants.F_OK);
          console.log(`[EventsWatcher] Found events.jsonl`);
          if (this.fileExistsTimer) clearInterval(this.fileExistsTimer);
          this.fileExistsTimer = null;
          this.startWatching();
        } catch { /* not yet */ }
      }, EventsWatcher.FILE_CHECK_INTERVAL_MS);
    }
  }

  private startWatching(): void {
    if (this.stopped || this.watcher || this.watchingFile || this.pollTimer) return;
    console.log(`[EventsWatcher] Started watching: ${this.filePath}`);

    // Primary: fs.watch (event-driven, fast but unreliable on some platforms)
    try {
      this.watcher = fs.watch(this.filePath, () => {
        if (!this.stopped) this.readNewLines();
      });
    } catch (e) {
      console.log(`[EventsWatcher] fs.watch failed: ${e}`);
    }

    // Secondary: fs.watchFile (stat-based polling, reliable on all platforms)
    try {
      fs.watchFile(this.filePath, { interval: EventsWatcher.POLL_INTERVAL_MS }, () => {
        if (!this.stopped) this.readNewLines();
      });
      this.watchingFile = true;
    } catch (e) {
      console.log(`[EventsWatcher] fs.watchFile failed: ${e}`);
    }

    // Tertiary: manual poll as last resort
    this.pollTimer = setInterval(() => {
      if (!this.stopped) this.readNewLines();
    }, EventsWatcher.POLL_INTERVAL_MS);

    // Heartbeat: log every 60s so a live-but-idle watcher is distinguishable from a dead one
    this.heartbeatTimer = setInterval(() => {
      if (!this.stopped) {
        console.log(`[EventsWatcher] Heartbeat — alive, watching ${this.filePath} (offset: ${this.fileOffset})`);
      }
    }, 60000);

    // Snapshot and replay existing history asynchronously. Watchers are already
    // installed so appends during replay are coalesced into a follow-up read.
    void this.readInitialHistory();
  }

  /** Coalesce watch/poll triggers behind one bounded asynchronous reader. */
  readNewLines(): void {
    if (this.stopped) return;
    this.readRequested = true;
    if (this.initialReadComplete && !this.reading) {
      void this.drainRequestedReads();
    }
  }

  private async readInitialHistory(): Promise<void> {
    if (this.reading || this.stopped) return;
    this.reading = true;
    try {
      const stat = await fs.promises.stat(this.filePath);
      await this.readThroughOffset(stat.size, true);
    } catch {
      // File may not exist or be locked — next poll will retry
    } finally {
      this.initialReadComplete = true;
      this.reading = false;
      if (!this.stopped) {
        // Always perform one follow-up pass. The file can grow after the initial
        // stat but before fs.watch begins delivering reliably.
        this.readRequested = true;
        void this.drainRequestedReads();
      }
    }
  }

  private async drainRequestedReads(): Promise<void> {
    if (this.reading || this.stopped || !this.initialReadComplete) return;
    this.reading = true;
    try {
      while (this.readRequested && !this.stopped) {
        this.readRequested = false;
        try {
          const stat = await fs.promises.stat(this.filePath);
          await this.readThroughOffset(stat.size, false);
        } catch {
          // File may be rotating or locked. A watcher/poll trigger retries.
        }
      }
    } finally {
      this.reading = false;
      if (this.readRequested && !this.stopped) {
        void this.drainRequestedReads();
      }
    }
  }

  private async readThroughOffset(targetOffset: number, isHistorical: boolean): Promise<void> {
    if (targetOffset < this.fileOffset) {
      this.fileOffset = 0;
      this.lineBuffer = Buffer.alloc(0);
    }
    if (targetOffset <= this.fileOffset || this.stopped) return;

    const handle = await fs.promises.open(this.filePath, 'r');
    let bytesReadTotal = 0;
    let eventCount = 0;
    try {
      while (this.fileOffset < targetOffset && !this.stopped) {
        const bytesToRead = Math.min(
          this.maxReadChunkBytes,
          targetOffset - this.fileOffset,
        );
        const chunk = Buffer.allocUnsafe(bytesToRead);
        const { bytesRead } = await handle.read(chunk, 0, bytesToRead, this.fileOffset);
        if (bytesRead === 0) break;

        this.fileOffset += bytesRead;
        bytesReadTotal += bytesRead;
        eventCount += this.processChunk(chunk.subarray(0, bytesRead), isHistorical);

        if (this.fileOffset < targetOffset && !this.stopped) {
          await this.yieldToEventLoop();
        }
      }
    } finally {
      await handle.close();
    }

    if (eventCount > 0) {
      console.log(
        `[EventsWatcher] Read ${eventCount} event(s), +${bytesReadTotal}B, offset now ${this.fileOffset}`,
      );
    }
  }

  private processChunk(chunk: Buffer, isHistorical: boolean): number {
    const data = this.lineBuffer.length > 0
      ? Buffer.concat([this.lineBuffer, chunk])
      : chunk;
    let lineStart = 0;
    let eventCount = 0;

    while (lineStart < data.length) {
      const newlineIndex = data.indexOf(0x0a, lineStart);
      if (newlineIndex === -1) break;
      const line = data.subarray(lineStart, newlineIndex).toString('utf8').trim();
      lineStart = newlineIndex + 1;
      if (!line) continue;

      try {
        const event = JSON.parse(line) as CopilotEvent;
        eventCount++;
        try {
          this.callback?.(event, isHistorical);
        } catch (error) {
          console.error(`[EventsWatcher] Event callback failed: ${String(error)}`);
        }
      } catch (error) {
        console.warn(`[EventsWatcher] Failed to parse line: ${String(error)}`);
      }
    }

    this.lineBuffer = lineStart < data.length
      ? Buffer.from(data.subarray(lineStart))
      : Buffer.alloc(0);
    return eventCount;
  }

  stop(): void {
    this.stopped = true;
    
    if (this.fileExistsTimer) {
      clearInterval(this.fileExistsTimer);
      this.fileExistsTimer = null;
    }
    
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }

    if (this.watchingFile) {
      try { fs.unwatchFile(this.filePath); } catch { /* ignore */ }
      this.watchingFile = false;
    }
    
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }

    if (this.heartbeatTimer) { clearInterval(this.heartbeatTimer); this.heartbeatTimer = null; }
    
    this.callback = null;
    this.readRequested = false;
  }
}

// Helper to format tool status for display
export function formatToolStatus(toolName: string, args: Record<string, unknown>): string {
  const base = (p: unknown) => typeof p === 'string' ? path.basename(p) : '';
  
  switch (toolName) {
    case 'view':
      return `Reading ${base(args.path)}`;
    case 'edit':
      return `Editing ${base(args.path)}`;
    case 'create':
      return `Creating ${base(args.path)}`;
    case 'powershell':
      const cmd = (args.command as string) || '';
      return `Running: ${cmd.length > 40 ? cmd.slice(0, 40) + '…' : cmd}`;
    case 'glob':
      return `Finding files: ${args.pattern || ''}`;
    case 'grep':
      return `Searching: ${args.pattern || ''}`;
    case 'web_fetch':
      return `Fetching: ${args.url || ''}`;
    case 'task':
      return `Subtask: ${args.description || 'running'}`;
    case 'ask_user':
      return 'Waiting for your answer';
    case 'report_intent':
      return `${args.intent || 'Working'}`;
    case 'sql':
      return `Query: ${args.description || 'running'}`;
    default:
      return `Using ${toolName}`;
  }
}

/**
 * Normalize `ask_user` tool arguments to `{ question, options: {text}[], freeform }`
 * regardless of upstream key names (spec 015, node-pty/degraded path only). Handles
 * `question`/`prompt`, `options`/`choices` as `string[]` or `{label,value}[]`/`{text}[]`,
 * and the freeform flag under several aliases. This does NOT touch {@link formatToolStatus}
 * — the static `'Waiting for your answer'` label stays byte-for-byte (FR-016). The
 * SDK-backed sessions do not use this; their fields arrive natively in
 * `user_input.requested`.
 */
export function normalizeAskUserArgs(args: Record<string, unknown> | undefined): {
  question: string;
  options: { text: string }[];
  freeform: boolean;
} {
  const a = args ?? {};
  const questionRaw = a.question ?? a.prompt ?? a.message ?? a.text ?? '';
  const question = typeof questionRaw === 'string' ? questionRaw : String(questionRaw ?? '');

  const rawOptions = a.options ?? a.choices ?? a.answers ?? a.selections ?? [];
  const options: { text: string }[] = [];
  if (Array.isArray(rawOptions)) {
    for (const opt of rawOptions) {
      if (typeof opt === 'string') {
        options.push({ text: opt });
      } else if (opt && typeof opt === 'object') {
        const o = opt as Record<string, unknown>;
        const text = o.text ?? o.label ?? o.value ?? o.name ?? '';
        options.push({ text: typeof text === 'string' ? text : String(text ?? '') });
      }
    }
  }

  const freeformRaw =
    a.freeform ?? a.allowFreeform ?? a.allowFreeText ?? a.allowCustom ?? a.freeText ?? false;
  const freeform = Boolean(freeformRaw);

  return { question, options, freeform };
}

/**
 * spec 015 — pure relay translator. Given a copilot event and the active backend
 * name, return the normalized ask_user payload to relay as `copilot-ask-user`, or
 * `null` when the event is not an ask_user surface for this backend.
 *
 * - SDK-backed sessions: `user_input.requested` carries the payload natively
 *   (incl. the `requestId` single-resolution key).
 * - node-pty backend: `tool.execution_start` with `toolName === 'ask_user'`,
 *   normalized best-effort from arguments (`requestId` unavailable → '').
 *
 * The caller still emits the unchanged `copilot-tool-start` separately (FR-016).
 */
export function buildAskUserRelay(
  event: { type: string; data: Record<string, unknown> },
  backendName: string,
): { toolId: string; requestId: string; question: string; options: { text: string }[]; freeform: boolean } | null {
  const d = event.data ?? {};
  if (event.type === 'user_input.requested') {
    const options = Array.isArray(d.choices)
      ? d.choices.map((c) => ({
          text:
            typeof c === 'string'
              ? c
              : String((c as Record<string, unknown>)?.text ?? (c as Record<string, unknown>)?.label ?? (c as Record<string, unknown>)?.value ?? ''),
        }))
      : [];
    return {
      toolId: String(d.toolCallId ?? ''),
      requestId: String(d.requestId ?? ''),
      question: String(d.question ?? ''),
      options,
      freeform: Boolean(d.allowFreeform),
    };
  }
  if (event.type === 'tool.execution_start' && d.toolName === 'ask_user' && backendName === 'node-pty') {
    const norm = normalizeAskUserArgs(d.arguments as Record<string, unknown> | undefined);
    return {
      toolId: String(d.toolCallId ?? ''),
      requestId: '',
      question: norm.question,
      options: norm.options,
      freeform: norm.freeform,
    };
  }
  return null;
}

/** Normalized plan-mode payload relayed as `copilot-plan`. */
export interface PlanRelay {
  toolId: string;
  /** SDK single-resolution key (`exit_plan_mode.requested`); '' on the node-pty path. */
  requestId: string;
  summary: string;
  planContent: string;
  actions: string[];
  recommendedAction: string;
}

/**
 * Pure relay translator for Copilot plan mode. Given a copilot event and the active
 * backend name, return the normalized plan payload to relay as `copilot-plan`, or `null`
 * when the event is not a plan surface for this backend. Mirrors {@link buildAskUserRelay}.
 *
 * - SDK-backed sessions: the ephemeral `exit_plan_mode.requested` event carries the
 *   payload natively (incl. the `requestId` used to resolve via the SDK handler).
 * - node-pty backend: `tool.execution_start` with `toolName === 'exit_plan_mode'`,
 *   from arguments (`requestId` unavailable → ''); render-only (no SDK responder).
 */
export function buildPlanRelay(
  event: { type: string; data: Record<string, unknown> },
  backendName: string,
): PlanRelay | null {
  const d = event.data ?? {};
  const toArr = (v: unknown): string[] =>
    Array.isArray(v) ? v.map((x) => String(x ?? '')).filter((s) => s.length > 0) : [];
  if (event.type === 'exit_plan_mode.requested') {
    return {
      toolId: String(d.toolCallId ?? ''),
      requestId: String(d.requestId ?? ''),
      summary: String(d.summary ?? ''),
      planContent: String(d.planContent ?? ''),
      actions: toArr(d.actions),
      recommendedAction: String(d.recommendedAction ?? ''),
    };
  }
  if (event.type === 'tool.execution_start' && d.toolName === 'exit_plan_mode' && backendName === 'node-pty') {
    const a = (d.arguments ?? {}) as Record<string, unknown>;
    return {
      toolId: String(d.toolCallId ?? ''),
      requestId: '',
      summary: String(a.summary ?? ''),
      planContent: String(a.planContent ?? ''),
      actions: toArr(a.actions),
      recommendedAction: String(a.recommendedAction ?? ''),
    };
  }
  return null;
}
