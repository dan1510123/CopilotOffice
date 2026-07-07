// IPC relay between Electron renderer and the terminal server child process.
// Owns: child process lifecycle, request/response matching, ipcMain handler registration.
// main.ts creates one of these and calls spawnServer() + registerIpc().

import { ipcMain, BrowserWindow } from 'electron';
import { fork, ChildProcess, execSync } from 'child_process';
import { EventEmitter } from 'events';
import * as crypto from 'crypto';
import * as path from 'path';
import type { MainToServer, ServerToMain, MsgQueryAgentStatuses } from './protocol';
import { reapRegisteredPtys } from './pty-registry';

export class TerminalRelay {
  /**
   * Event bus for main-process consumers (e.g. the Teams service) that need
   * server→main copilot/terminal events without going through the renderer.
   * Emits: 'copilot-event' (agentId, event), 'copilot-turn-start' (agentId),
   * 'copilot-turn-end' (agentId), 'copilot-tool-start' (agentId, toolName, toolId, status),
   * 'session-meta-updated' (agentId, meta), 'terminal-exit' (agentId, exitCode).
   */
  public readonly mainEvents = new EventEmitter();

  private server: ChildProcess | null = null;
  private pendingRequests: Map<string, (result: unknown) => void> = new Map();
  private getWindow: () => BrowserWindow | null;
  /** True while a deliberate shutdown→respawn is in progress (prevents double-spawn). */
  private shuttingDown = false;
  /** Requests that arrived while the server was not connected. Flushed on ready. */
  private queuedRequests: Array<{ msg: MainToServer & { requestId: string }; resolve: (v: unknown) => void }> = [];
  /** Timeout for IPC request/response round-trips (ms). */
  private static readonly REQUEST_TIMEOUT_MS = 10_000;

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

        // If shutdown() was called deliberately (e.g. hard reload), the caller
        // already called spawnServer() — don't spawn a second one.
        if (this.shuttingDown) {
          console.log('[Relay] Deliberate shutdown — skipping auto-respawn');
          return;
        }

        const win = this.getWindow();
        if (win && !win.isDestroyed()) {
          // The crashed server abandoned its PTY children (node-pty does not
          // reap them on parent death). Reap the recorded survivors before the
          // fresh server starts, so they don't linger holding session locks.
          try {
            const { reaped } = reapRegisteredPtys();
            if (reaped.length > 0) {
              console.log(`[Relay] Reaped ${reaped.length} orphaned PTY tree(s) from crashed server:`, reaped);
            }
          } catch (e) {
            console.error('[Relay] Failed to reap orphaned PTYs after crash:', e);
          }
          console.log('[Relay] Respawning terminal server...');
          this.spawnServer(distDir).catch((e) =>
            console.error('[Relay] Failed to respawn:', e)
          );
        }
      });
    });
  }

  shutdown(): Promise<void> {
    this.shuttingDown = true;
    const oldServer = this.server;
    this.server = null;

    if (!oldServer) {
      this.pendingRequests.clear();
      this.queuedRequests = [];
      return Promise.resolve();
    }

    // Remove all listeners from old server so its exit handler doesn't
    // interfere with a newly spawned server.
    oldServer.removeAllListeners('exit');
    oldServer.removeAllListeners('message');

    // Ask the server to gracefully kill PTYs and exit.
    // Do NOT call oldServer.kill() here — on Windows it's equivalent to
    // SIGKILL and terminates the server before it can process the shutdown
    // message.  The 3-second timeout below is the safety net.
    if (oldServer.connected) {
      try { oldServer.send({ type: 'shutdown' } as MainToServer); } catch { /* ignore */ }
    }

    // Reject any pending requests
    this.pendingRequests.forEach((cb) =>
      cb({ success: false, error: 'Terminal server shut down' })
    );
    this.pendingRequests.clear();
    this.queuedRequests = [];

    // Wait for the old server to actually exit (or timeout after 3s)
    const oldPid = oldServer.pid;
    return new Promise<void>((resolve) => {
      const onExit = () => {
        clearTimeout(timeout);
        resolve();
      };
      oldServer.once('exit', onExit);

      const timeout = setTimeout(() => {
        oldServer.removeListener('exit', onExit);
        // Final safety net: force-kill by PID if still alive
        if (oldPid) {
          try {
            process.kill(oldPid, 0); // throws if already dead
            console.log(`[Relay] Server PID ${oldPid} still alive after timeout — force killing`);
            if (process.platform === 'win32') {
              execSync(`taskkill /T /F /PID ${oldPid}`, { stdio: 'ignore' });
            } else {
              process.kill(oldPid, 'SIGKILL');
            }
          } catch {
            // Process already dead — expected
          }
        }
        resolve();
      }, 3000);
    });
  }

  // ── Internal Helpers ─────────────────────────────────────────

  private send(msg: MainToServer): void {
    if (this.server?.connected) {
      this.server.send(msg);
    }
  }

  private request(msg: MainToServer & { requestId: string }): Promise<unknown> {
    // If the server isn't connected (e.g. during a hard-reload restart), queue
    // the request so it's sent as soon as the new server is ready.
    if (!this.server?.connected) {
      console.log(`[Relay] Server not connected — queuing request ${msg.type} (${msg.requestId})`);
      return new Promise((resolve) => {
        this.queuedRequests.push({ msg, resolve });
      });
    }
    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        if (this.pendingRequests.delete(msg.requestId)) {
          console.warn(`[Relay] Request ${msg.type} (${msg.requestId}) timed out after ${TerminalRelay.REQUEST_TIMEOUT_MS}ms`);
          resolve({ success: false, error: 'Request timed out' });
        }
      }, TerminalRelay.REQUEST_TIMEOUT_MS);

      this.pendingRequests.set(msg.requestId, (result) => {
        clearTimeout(timeout);
        resolve(result);
      });
      this.send(msg);
    });
  }

  private id(): string {
    return crypto.randomUUID();
  }

  // ── Main-process gateway (for the Teams service) ──────────────
  // These let a main-process consumer talk to the terminal server directly,
  // reusing the same request/response plumbing as the renderer IPC handlers.

  mainGetSessionId(officeId: string, agentId: string): Promise<string | null> {
    return this.request({ type: 'get-session-id', requestId: this.id(), officeId, agentId }) as Promise<string | null>;
  }

  /** True only when the agent's PTY is alive AND the CLI has signalled ready. */
  mainIsAgentReady(officeId: string, agentId: string): Promise<boolean> {
    return (
      this.request({ type: 'query-agent-statuses', requestId: this.id(), officeId }) as Promise<
        Record<string, { alive: boolean; ready: boolean; inTurn: boolean }>
      >
    ).then((statuses) => {
      const s = statuses?.[agentId];
      return !!(s && s.alive && s.ready);
    });
  }

  mainGetSessionMeta(officeId: string, agentId: string): Promise<{ title?: string } | null> {
    return this.request({ type: 'get-session-meta', requestId: this.id(), officeId, agentId }) as Promise<{ title?: string } | null>;
  }

  mainWrite(officeId: string, agentId: string, data: string): Promise<{ success: boolean; error?: string }> {
    return this.request({ type: 'write', requestId: this.id(), officeId, agentId, data }) as Promise<{ success: boolean; error?: string }>;
  }

  mainSubmitPrompt(officeId: string, agentId: string, prompt: string, label?: string): Promise<{ success: boolean; error?: string }> {
    return this.request({ type: 'submit-prompt', requestId: this.id(), officeId, agentId, prompt, label }) as Promise<{ success: boolean; error?: string }>;
  }

  /** Fire-and-forget: control whether copilot-events are mirrored to main for an agent without a viewer. */
  mainSetAgentForwarding(officeId: string, agentId: string, enabled: boolean): void {
    this.send({ type: 'set-agent-forwarding', officeId, agentId, enabled });
  }

  private handleServerMessage(
    msg: ServerToMain,
    readyTimeout: ReturnType<typeof setTimeout>,
    onReady: () => void
  ): void {
    // ready + response don't need a live window
    if (msg.type === 'ready') {
      clearTimeout(readyTimeout);
      this.shuttingDown = false;
      console.log('[Relay] Terminal server ready');

      // Flush any requests that arrived while the server was down
      if (this.queuedRequests.length > 0) {
        console.log(`[Relay] Flushing ${this.queuedRequests.length} queued request(s)`);
        for (const queued of this.queuedRequests) {
          this.pendingRequests.set(queued.msg.requestId, queued.resolve);
          this.send(queued.msg);
        }
        this.queuedRequests = [];
      }

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
    // First, mirror them to main-process consumers (e.g. the Teams service),
    // which must receive events even when no renderer window is present.
    switch (msg.type) {
      case 'copilot-event':
        this.mainEvents.emit('copilot-event', msg.agentId, msg.event);
        break;
      case 'copilot-turn-start':
        this.mainEvents.emit('copilot-turn-start', msg.agentId);
        break;
      case 'copilot-turn-end':
        this.mainEvents.emit('copilot-turn-end', msg.agentId);
        break;
      case 'copilot-tool-start':
        this.mainEvents.emit('copilot-tool-start', msg.agentId, msg.toolName, msg.toolId, msg.status);
        break;
      case 'session-meta-updated':
        this.mainEvents.emit('session-meta-updated', msg.agentId, msg.meta);
        break;
      case 'terminal-exit':
        this.mainEvents.emit('terminal-exit', msg.agentId, msg.exitCode);
        break;
    }

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
        if (!msg.mainOnly) win.webContents.send('copilot-event', msg.agentId, msg.event);
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
      case 'copilot-turn-start':
        win.webContents.send('copilot-turn-start', msg.agentId);
        break;
      case 'copilot-user-message':
        win.webContents.send('copilot-user-message', msg.agentId);
        break;
      case 'session-meta-updated':
        win.webContents.send('session-meta-updated', msg.agentId, msg.meta);
        break;
      case 'terminal-preload-status':
        win.webContents.send('terminal-preload-status', msg.agentId, msg.status);
        break;
    }
  }

  // ── IPC Handler Registration ──────────────────────────────────

  registerIpc(): void {
    ipcMain.handle('terminal-start', (_event, officeId: string, agentId: string, workingDir?: string, cols?: number, rows?: number, preseededPrompt?: string, launchMode?: 'copilot' | 'shell') =>
      this.request({ type: 'start', requestId: this.id(), officeId, agentId, workingDir, cols, rows, preseededPrompt, launchMode })
    );

    ipcMain.handle('terminal-attach', (_event, officeId: string, agentId: string) =>
      this.request({ type: 'attach', requestId: this.id(), officeId, agentId })
    );

    ipcMain.handle('terminal-detach', (_event, officeId: string, agentId: string) => {
      this.send({ type: 'detach', officeId, agentId });
      return { success: true };
    });

    // Request/response so the renderer knows if the write actually reached a PTY
    ipcMain.handle('terminal-write', (_event, officeId: string, agentId: string, data: string) =>
      this.request({ type: 'write', requestId: this.id(), officeId, agentId, data })
    );

    ipcMain.handle('terminal-resize', (_event, officeId: string, agentId: string, cols: number, rows: number) => {
      this.send({ type: 'resize', officeId, agentId, cols, rows });
      return { success: true };
    });

    ipcMain.handle('set-yolo', (_event, enabled: boolean) => {
      this.send({ type: 'set-yolo', enabled: !!enabled });
      return { success: true };
    });

    ipcMain.handle('set-additional-params', (_event, params: string) => {
      this.send({ type: 'set-additional-params', params: String(params ?? '') });
      return { success: true };
    });

    ipcMain.handle('terminal-kill', (_event, officeId: string, agentId: string) =>
      this.request({ type: 'kill', requestId: this.id(), officeId, agentId })
    );

    ipcMain.handle('terminal-exists', (_event, officeId: string, agentId: string) =>
      this.request({ type: 'exists', requestId: this.id(), officeId, agentId })
    );

    ipcMain.handle('terminal-pop-out', (_event, officeId: string, agentId: string) =>
      this.request({ type: 'pop-out', requestId: this.id(), officeId, agentId })
    );

    ipcMain.handle('get-session-id', (_event, officeId: string, agentId: string) =>
      this.request({ type: 'get-session-id', requestId: this.id(), officeId, agentId })
    );

    ipcMain.handle('set-session-id', (_event, officeId: string, agentId: string, sessionId: string) =>
      this.request({ type: 'set-session-id', requestId: this.id(), officeId, agentId, sessionId })
    );

    ipcMain.handle('reset-all-sessions', (_event, officeId: string) =>
      this.request({ type: 'reset-all-sessions', requestId: this.id(), officeId })
    );

    ipcMain.handle('terminal-reset-session', (_event, officeId: string, agentId: string) =>
      this.request({ type: 'reset-session', requestId: this.id(), officeId, agentId })
    );

    ipcMain.handle('terminal-get-session-history', (_event, officeId: string, agentId: string) =>
      this.request({ type: 'get-session-history', requestId: this.id(), officeId, agentId })
    );

    ipcMain.handle('terminal-clear-session-history', (_event, officeId: string, agentId: string) =>
      this.request({ type: 'clear-session-history', requestId: this.id(), officeId, agentId })
    );

    ipcMain.handle('list-active-terminals', () =>
      this.request({ type: 'list-active', requestId: this.id() })
    );

    ipcMain.handle('query-agent-statuses', (_event, officeId?: string) =>
      this.request({ type: 'query-agent-statuses', requestId: this.id(), officeId } as MsgQueryAgentStatuses)
    );

    ipcMain.handle('set-session-meta', (_event, officeId: string, agentId: string, meta: { title?: string; description?: string }) =>
      this.request({ type: 'set-session-meta', requestId: this.id(), officeId, agentId, meta })
    );

    ipcMain.handle('get-session-meta', (_event, officeId: string, agentId: string) =>
      this.request({ type: 'get-session-meta', requestId: this.id(), officeId, agentId })
    );

    ipcMain.handle('get-all-session-meta', (_event, officeId: string) =>
      this.request({ type: 'get-all-session-meta', requestId: this.id(), officeId })
    );

    ipcMain.handle('create-office-session', (_event, officeId: string) =>
      this.request({ type: 'create-office-session', requestId: this.id(), officeId })
    );

    ipcMain.handle('delete-office-session', (_event, officeId: string) =>
      this.request({ type: 'delete-office-session', requestId: this.id(), officeId })
    );

    ipcMain.handle('transfer-session', (_event, fromOfficeId: string, toOfficeId: string, agentId: string) =>
      this.request({ type: 'transfer-session', requestId: this.id(), fromOfficeId, toOfficeId, agentId })
    );
  }
}
