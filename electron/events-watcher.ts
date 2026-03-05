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
  private callback: EventCallback | null = null;
  private stopped: boolean = false;

  private static readonly POLL_INTERVAL_MS = 500;
  private static readonly FILE_CHECK_INTERVAL_MS = 200;

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

    // Check if file exists
    if (fs.existsSync(this.filePath)) {
      this.startWatching();
    } else {
      // Poll for file to appear
      console.log(`[EventsWatcher] Waiting for events.jsonl: ${this.filePath}`);
      this.fileExistsTimer = setInterval(() => {
        if (this.stopped) {
          if (this.fileExistsTimer) clearInterval(this.fileExistsTimer);
          return;
        }
        if (fs.existsSync(this.filePath)) {
          console.log(`[EventsWatcher] Found events.jsonl`);
          if (this.fileExistsTimer) clearInterval(this.fileExistsTimer);
          this.fileExistsTimer = null;
          this.startWatching();
        }
      }, EventsWatcher.FILE_CHECK_INTERVAL_MS);
    }
  }

  private startWatching(): void {
    // Read any existing content first
    this.readNewLines();

    // Primary: fs.watch
    try {
      this.watcher = fs.watch(this.filePath, () => {
        if (!this.stopped) this.readNewLines();
      });
    } catch (e) {
      console.log(`[EventsWatcher] fs.watch failed: ${e}`);
    }

    // Secondary: polling fallback
    this.pollTimer = setInterval(() => {
      if (!this.stopped) this.readNewLines();
    }, EventsWatcher.POLL_INTERVAL_MS);
  }

  private readNewLines(): void {
    try {
      const stat = fs.statSync(this.filePath);
      if (stat.size <= this.fileOffset) return;

      const buf = Buffer.alloc(stat.size - this.fileOffset);
      const fd = fs.openSync(this.filePath, 'r');
      fs.readSync(fd, buf, 0, buf.length, this.fileOffset);
      fs.closeSync(fd);
      this.fileOffset = stat.size;

      const text = this.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      this.lineBuffer = lines.pop() || '';

      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const event = JSON.parse(line) as CopilotEvent;
          if (this.callback) {
            this.callback(event);
          }
        } catch (e) {
          // Ignore malformed lines
          console.log(`[EventsWatcher] Failed to parse line: ${e}`);
        }
      }
    } catch (e) {
      // File may not exist or be locked
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
    
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
    
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
