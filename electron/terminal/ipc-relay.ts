// IPC relay between Electron renderer and the terminal server child process.
// Owns: child process lifecycle, request/response matching, ipcMain handler registration.
// main.ts creates one of these and calls spawnServer() + registerIpc().

import { ipcMain, BrowserWindow } from 'electron';
import { fork, ChildProcess } from 'child_process';
import * as crypto from 'crypto';
import * as path from 'path';
import type { MainToServer, ServerToMain } from './protocol';

export class TerminalRelay {
  private server: ChildProcess | null = null;
  private pendingRequests: Map<string, (result: unknown) => void> = new Map();
  private getWindow: () => BrowserWindow | null;

  constructor(getWindow: () => BrowserWindow | null) {
    this.getWindow = getWindow;
  }

  // ── Server Lifecycle ──────────────────────────────────────────

  spawnServer(distDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const serverPath = path.join(distDir, 'terminal', 'server.js');
      console.log('[Relay] Forking terminal server:', serverPath);

      this.server = fork(serverPath, [], {
        cwd: process.cwd(),
        stdio: ['pipe', 'inherit', 'inherit', 'ipc'],
      });

      const readyTimeout = setTimeout(() => {
        reject(new Error('Terminal server did not send ready in time'));
      }, 15_000);

      this.server.on('message', (msg: ServerToMain) => {
        this.handleServerMessage(msg, readyTimeout, resolve);
      });

      this.server.on('exit', (code, signal) => {
        console.error(`[Relay] Terminal server exited (code=${code}, signal=${signal})`);
        clearTimeout(readyTimeout);
        this.pendingRequests.forEach((cb) =>
          cb({ success: false, error: 'Terminal server crashed' })
        );
        this.pendingRequests.clear();
        this.server = null;

        const win = this.getWindow();
        if (win && !win.isDestroyed()) {
          console.log('[Relay] Respawning terminal server...');
          this.spawnServer(distDir).catch((e) =>
            console.error('[Relay] Failed to respawn:', e)
          );
        }
      });
    });
  }

  shutdown(): void {
    if (this.server?.connected) {
      this.send({ type: 'shutdown' });
    }
    this.server = null;
  }

  // ── Internal Helpers ─────────────────────────────────────────

  private send(msg: MainToServer): void {
    if (this.server?.connected) {
      this.server.send(msg);
    }
  }

  private request(msg: MainToServer & { requestId: string }): Promise<unknown> {
    return new Promise((resolve) => {
      this.pendingRequests.set(msg.requestId, resolve);
      this.send(msg);
    });
  }

  private id(): string {
    return crypto.randomUUID();
  }

  private handleServerMessage(
    msg: ServerToMain,
    readyTimeout: ReturnType<typeof setTimeout>,
    onReady: () => void
  ): void {
    // ready + response don't need a live window
    if (msg.type === 'ready') {
      clearTimeout(readyTimeout);
      console.log('[Relay] Terminal server ready');
      onReady();
      return;
    }

    if (msg.type === 'response') {
      const cb = this.pendingRequests.get(msg.requestId);
      if (cb) {
        this.pendingRequests.delete(msg.requestId);
        cb(msg.result);
      }
      return;
    }

    // All other messages forward to the renderer
    const win = this.getWindow();
    if (!win || win.isDestroyed()) return;

    switch (msg.type) {
      case 'terminal-data':
        win.webContents.send('terminal-data', msg.agentId, msg.data);
        break;
      case 'terminal-exit':
        win.webContents.send('terminal-exit', msg.agentId, msg.exitCode);
        break;
      case 'copilot-event':
        win.webContents.send('copilot-event', msg.agentId, msg.event);
        break;
      case 'copilot-tool-start':
        win.webContents.send('copilot-tool-start', msg.agentId, msg.toolName, msg.toolId, msg.status);
        break;
      case 'copilot-tool-complete':
        win.webContents.send('copilot-tool-complete', msg.agentId, msg.toolId, msg.success);
        break;
      case 'copilot-turn-end':
        win.webContents.send('copilot-turn-end', msg.agentId);
        break;
      case 'copilot-user-message':
        win.webContents.send('copilot-user-message', msg.agentId);
        break;
    }
  }

  // ── IPC Handler Registration ──────────────────────────────────

  registerIpc(): void {
    ipcMain.handle('terminal-start', (_event, agentId: string, workingDir?: string, cols?: number, rows?: number) =>
      this.request({ type: 'start', requestId: this.id(), agentId, workingDir, cols, rows })
    );

    ipcMain.handle('terminal-attach', (_event, agentId: string) =>
      this.request({ type: 'attach', requestId: this.id(), agentId })
    );

    ipcMain.handle('terminal-detach', (_event, agentId: string) => {
      this.send({ type: 'detach', agentId });
      return { success: true };
    });

    // Fire-and-forget for lowest latency
    ipcMain.handle('terminal-write', (_event, agentId: string, data: string) => {
      this.send({ type: 'write', agentId, data });
      return { success: true };
    });

    ipcMain.handle('terminal-resize', (_event, agentId: string, cols: number, rows: number) => {
      this.send({ type: 'resize', agentId, cols, rows });
      return { success: true };
    });

    ipcMain.handle('terminal-kill', (_event, agentId: string) =>
      this.request({ type: 'kill', requestId: this.id(), agentId })
    );

    ipcMain.handle('terminal-exists', (_event, agentId: string) =>
      this.request({ type: 'exists', requestId: this.id(), agentId })
    );

    ipcMain.handle('terminal-pop-out', (_event, agentId: string) =>
      this.request({ type: 'pop-out', requestId: this.id(), agentId })
    );

    ipcMain.handle('save-session-id', (_event, agentId: string, sessionId: string) =>
      this.request({ type: 'save-session-id', requestId: this.id(), agentId, sessionId })
    );

    ipcMain.handle('get-session-id', (_event, agentId: string) =>
      this.request({ type: 'get-session-id', requestId: this.id(), agentId })
    );

    ipcMain.handle('reset-all-sessions', () =>
      this.request({ type: 'reset-all-sessions', requestId: this.id() })
    );
  }
}
