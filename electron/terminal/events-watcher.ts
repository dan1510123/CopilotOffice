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

export type EventCallback = (event: CopilotEvent) => void;

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
    // Read any existing content first
    this.readNewLines();

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
            this.callback(event);
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
