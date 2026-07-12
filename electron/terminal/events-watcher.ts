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

export class EventsWatcher {
  private sessionId: string;
  private filePath: string;
  private fileOffset: number = 0;
  private lineBuffer: string = '';
  private watcher: fs.FSWatcher | null = null;
  private pollTimer: NodeJS.Timeout | null = null;
  private fileExistsTimer: NodeJS.Timeout | null = null;
  private heartbeatTimer: NodeJS.Timeout | null = null;
  private callback: EventCallback | null = null;
  private stopped: boolean = false;
  private watchingFile: boolean = false;
  private initialReadComplete: boolean = false;

  private static readonly POLL_INTERVAL_MS = 500;
  private static readonly FILE_CHECK_INTERVAL_MS = 200;
  private static readonly MAX_FILE_WAIT_MS = 60_000;

  constructor(sessionId: string) {
    this.sessionId = sessionId;
    this.filePath = path.join(
      os.homedir(),
      '.copilot',
      'session-state',
      sessionId,
      'events.jsonl'
    );
  }

  getSessionId(): string {
    return this.sessionId;
  }

  getFilePath(): string {
    return this.filePath;
  }

  start(onEvent: EventCallback): void {
    this.callback = onEvent;
    this.stopped = false;

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
    console.log(`[EventsWatcher] Started watching: ${this.filePath}`);
    // Read any existing content first (these events are marked as historical)
    this.readNewLines();
    this.initialReadComplete = true;

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
  }

  /** Synchronous read — no reading guard needed, every trigger processes immediately. */
  readNewLines(): void {
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size <= this.fileOffset) return;

      const bytesToRead = stat.size - this.fileOffset;
      const buf = Buffer.alloc(bytesToRead);
      const fd = fs.openSync(this.filePath, 'r');
      fs.readSync(fd, buf, 0, buf.length, this.fileOffset);
      fs.closeSync(fd);
      this.fileOffset = stat.size;

      const text = this.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      this.lineBuffer = lines.pop() || '';

      let eventCount = 0;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as CopilotEvent;
          eventCount++;
          if (this.callback) {
            this.callback(event, !this.initialReadComplete);
          }
        } catch (e) {
          console.log(`[EventsWatcher] Failed to parse line: ${e}`);
        }
      }
      if (eventCount > 0) {
        console.log(`[EventsWatcher] Read ${eventCount} event(s), +${bytesToRead}B, offset now ${this.fileOffset}`);
      }
    } catch (e) {
      // File may not exist or be locked — next poll will retry
    }
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
 * SDK/ui-server backend does not use this; its fields arrive natively in
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
 * - SDK/ui-server backend: `user_input.requested` carries the payload natively
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
