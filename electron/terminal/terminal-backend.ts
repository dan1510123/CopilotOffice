import { execSync } from 'child_process';
import * as os from 'os';

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
}

export interface StartTerminalOptions {
  sessionId: string;
  shell: string;
  cols: number;
  rows: number;
  cwd: string;
  env: { [key: string]: string };
}

export interface TerminalBackend {
  readonly name: string;
  isAvailable(): boolean;
  start(options: StartTerminalOptions): Promise<TerminalProcess>;
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

        this.promptPending = true;
        this.queuedSend = this.queuedSend
          .then(async () => {
            await this.session.send({ prompt, mode: 'enqueue' });
          })
          .catch((error: unknown) => {
            this.emitData(`\x1b[31m[SDK send failed: ${String(error)}]\x1b[0m\r\n`);
            this.emitPrompt();
          });
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

  constructor(private readonly CopilotClient: new (options?: Record<string, unknown>) => any) {}

  static async tryCreate(): Promise<CopilotSdkBackend | null> {
    try {
      const sdk = await import('@github/copilot-sdk') as { CopilotClient?: new (options?: Record<string, unknown>) => any };
      if (!sdk.CopilotClient) return null;
      return new CopilotSdkBackend(sdk.CopilotClient);
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
      this.client = new this.CopilotClient({
        useLoggedInUser: true,
        autoStart: false,
        cliPath: 'copilot',
      });
      this.startPromise = this.client.start();
    }

    await this.startPromise;
    return this.client;
  }

  private async resumeOrCreateSession(client: any, options: StartTerminalOptions): Promise<any> {
    const sharedConfig = {
      streaming: true,
      workingDirectory: options.cwd,
      onPermissionRequest: async () => ({ kind: 'approved' }),
      hooks: {
        onPreToolUse: async (input: any) => ({
          permissionDecision: 'allow',
          modifiedArgs: input.toolArgs,
        }),
      },
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
