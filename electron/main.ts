import { app, BrowserWindow, ipcMain } from 'electron';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import * as crypto from 'crypto';
import { spawn, ChildProcess } from 'child_process';
import { EventsWatcher, CopilotEvent, formatToolStatus } from './events-watcher';

// node-pty requires dynamic import due to native module
let pty: typeof import('node-pty') | null = null;

interface PtyProcess {
  pid: number;
  process: any;
  agentId: string;
  sessionId: string;
}

// Maps agentId to EventsWatcher instance
const agentWatchers: Map<string, EventsWatcher> = new Map();

let mainWindow: BrowserWindow | null = null;
const ptyProcesses: Map<string, PtyProcess> = new Map();
let watcherProcess: ChildProcess | null = null;

// Session pool: maps agentId to the actual terminal key they're using
const agentToTerminal: Map<string, string> = new Map();

// Persistent session IDs: maps agentId to copilot session ID for resume
// Saved in the CopilotOffice folder
const SESSION_FILE = path.join(process.cwd(), 'copilot-office-sessions.json');
let agentSessionIds: Map<string, string> = new Map();

function loadSessionIds(): void {
  try {
    if (fs.existsSync(SESSION_FILE)) {
      const data = JSON.parse(fs.readFileSync(SESSION_FILE, 'utf8'));
      agentSessionIds = new Map(Object.entries(data));
      console.log('Loaded saved sessions:', agentSessionIds.size);
    }
  } catch (e) {
    console.error('Failed to load session IDs:', e);
  }
}

function saveSessionIds(): void {
  try {
    const data = Object.fromEntries(agentSessionIds);
    fs.writeFileSync(SESSION_FILE, JSON.stringify(data, null, 2));
    console.log('Saved sessions:', agentSessionIds.size);
  } catch (e) {
    console.error('Failed to save session IDs:', e);
  }
}

function startFileWatcher(): void {
  // Start esbuild in watch mode for auto-rebuild
  const copilotOfficePath = path.join(process.cwd(), 'CopilotOffice');
  
  // Only start watcher if we're in the right directory structure
  if (!fs.existsSync(path.join(copilotOfficePath, 'package.json'))) {
    // We might already be inside CopilotOffice
    if (fs.existsSync(path.join(process.cwd(), 'src', 'main.ts'))) {
      // Start watcher from current directory
      watcherProcess = spawn('npx', ['esbuild', 'src/main.ts', '--bundle', '--outfile=dist/game.bundle.js', '--platform=browser', '--format=iife', '--global-name=CopilotOffice', '--watch'], {
        cwd: process.cwd(),
        shell: true,
        stdio: 'pipe',
      });
    }
  } else {
    // Start watcher from CopilotOffice subdirectory
    watcherProcess = spawn('npx', ['esbuild', 'src/main.ts', '--bundle', '--outfile=dist/game.bundle.js', '--platform=browser', '--format=iife', '--global-name=CopilotOffice', '--watch'], {
      cwd: copilotOfficePath,
      shell: true,
      stdio: 'pipe',
    });
  }

  if (watcherProcess) {
    watcherProcess.stdout?.on('data', (data) => {
      const msg = data.toString();
      console.log('[Watcher]', msg);
      // Notify renderer when rebuild completes
      if (msg.includes('watching') || msg.includes('built')) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('build-complete');
        }
      }
    });
    watcherProcess.stderr?.on('data', (data) => {
      console.error('[Watcher Error]', data.toString());
    });
    console.log('File watcher started - auto-rebuilding on changes');
  }
}

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 2560,
    height: 1440,
    title: 'Copilot Office',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Maximize the window to fill screen
  mainWindow.maximize();

  mainWindow.loadFile(path.join(__dirname, '../../src/index.html'));

  mainWindow.on('closed', () => {
    // Kill all PTY processes when window closes
    ptyProcesses.forEach((proc) => {
      try {
        proc.process.kill();
      } catch (e) {
        // ignore
      }
    });
    ptyProcesses.clear();
    
    // Kill watcher process
    if (watcherProcess) {
      watcherProcess.kill();
      watcherProcess = null;
    }
    
    mainWindow = null;
  });
}

// Agents to preload terminals for on startup
const PRELOAD_AGENTS = [
  { id: 'admin', workingDir: 'CopilotOffice' },  // Alice - always preload
];

app.whenReady().then(async () => {
  // Load saved session IDs
  loadSessionIds();
  
  // Load node-pty
  try {
    pty = require('node-pty');
    console.log('node-pty loaded successfully');
  } catch (e) {
    console.error('Failed to load node-pty:', e);
  }
  
  // Start file watcher for auto-rebuild
  startFileWatcher();
  
  createWindow();
  
  // Preload terminals for specific agents after window is ready
  setTimeout(() => {
    for (const agent of PRELOAD_AGENTS) {
      console.log(`Preloading terminal for ${agent.id}...`);
      startTerminalForAgent(agent.id, agent.workingDir);
    }
  }, 2000);

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (watcherProcess) {
    watcherProcess.kill();
  }
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

// Start a new terminal session for an agent (helper function for reuse)
async function startTerminalForAgent(agentId: string, workingDir?: string): Promise<{ success: boolean; pid?: number; sessionId?: string; reused?: boolean; error?: string }> {
  if (!pty) {
    return { success: false, error: 'node-pty not available' };
  }

  // Check if this agent already has a terminal assigned
  const existingTerminalKey = agentToTerminal.get(agentId);
  if (existingTerminalKey && ptyProcesses.has(existingTerminalKey)) {
    const existing = ptyProcesses.get(existingTerminalKey)!;
    return { success: true, pid: existing.pid, sessionId: existing.sessionId, reused: true };
  }

  // Generate a new session ID for this agent
  const sessionId = crypto.randomUUID();
  
  // No pooled session for now - create new one with explicit session ID
  const terminalKey = agentId;
  
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  let cwd = process.cwd();
  if (workingDir) {
    const customPath = path.join(process.cwd(), workingDir);
    if (fs.existsSync(customPath)) {
      cwd = customPath;
    }
  }

  try {
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: cwd,
      env: process.env as { [key: string]: string },
    });

    ptyProcesses.set(terminalKey, {
      pid: proc.pid,
      process: proc,
      agentId: terminalKey,
      sessionId: sessionId,
    });
    
    agentToTerminal.set(agentId, terminalKey);
    agentSessionIds.set(agentId, sessionId);
    saveSessionIds();

    // Create EventsWatcher for this session
    const watcher = new EventsWatcher(sessionId);
    agentWatchers.set(agentId, watcher);
    
    watcher.start((event: CopilotEvent) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        // Forward all events to renderer
        mainWindow.webContents.send('copilot-event', agentId, event);
        
        // Send specific typed events for easier handling
        if (event.type === 'tool.execution_start') {
          const data = event.data as { toolCallId: string; toolName: string; arguments: Record<string, unknown> };
          const status = formatToolStatus(data.toolName, data.arguments);
          mainWindow.webContents.send('copilot-tool-start', agentId, data.toolName, data.toolCallId, status);
        } else if (event.type === 'tool.execution_complete') {
          const data = event.data as { toolCallId: string; success: boolean };
          mainWindow.webContents.send('copilot-tool-complete', agentId, data.toolCallId, data.success);
        } else if (event.type === 'assistant.turn_end') {
          mainWindow.webContents.send('copilot-turn-end', agentId);
        } else if (event.type === 'user.message') {
          mainWindow.webContents.send('copilot-user-message', agentId);
        }
      }
    });

    // Forward data from PTY to renderer
    proc.onData((data: string) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-data', agentId, data);
      }
    });

    proc.onExit(({ exitCode }) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('terminal-exit', agentId, exitCode);
      }
      ptyProcesses.delete(terminalKey);
      
      // Stop the events watcher
      const w = agentWatchers.get(agentId);
      if (w) {
        w.stop();
        agentWatchers.delete(agentId);
      }
    });

    // Start copilot CLI with session ID
    setTimeout(() => {
      // Try to resume existing session, or start new one with our session ID
      const savedSessionId = agentSessionIds.get(agentId);
      if (savedSessionId && savedSessionId !== sessionId) {
        // Resume existing session
        console.log(`Resuming session for ${agentId}: ${savedSessionId}`);
        proc.write(`copilot --resume ${savedSessionId}\r`);
        // Update watcher to watch the resumed session
        watcher.stop();
        const resumedWatcher = new EventsWatcher(savedSessionId);
        agentWatchers.set(agentId, resumedWatcher);
        resumedWatcher.start((event: CopilotEvent) => {
          if (mainWindow && !mainWindow.isDestroyed()) {
            mainWindow.webContents.send('copilot-event', agentId, event);
            if (event.type === 'tool.execution_start') {
              const data = event.data as { toolCallId: string; toolName: string; arguments: Record<string, unknown> };
              const status = formatToolStatus(data.toolName, data.arguments);
              mainWindow.webContents.send('copilot-tool-start', agentId, data.toolName, data.toolCallId, status);
            } else if (event.type === 'tool.execution_complete') {
              const data = event.data as { toolCallId: string; success: boolean };
              mainWindow.webContents.send('copilot-tool-complete', agentId, data.toolCallId, data.success);
            } else if (event.type === 'assistant.turn_end') {
              mainWindow.webContents.send('copilot-turn-end', agentId);
            } else if (event.type === 'user.message') {
              mainWindow.webContents.send('copilot-user-message', agentId);
            }
          }
        });
      } else {
        // Start new session - copilot will create its own session ID
        // We'll detect it from session.start event
        proc.write('copilot\r');
      }
    }, 500);

    return { success: true, pid: proc.pid, sessionId };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

// IPC handler that calls the helper function
ipcMain.handle('terminal-start', async (_event, agentId: string, workingDir?: string) => {
  return startTerminalForAgent(agentId, workingDir);
});

// Helper to start a new pooled session
function startNewPooledSession() {
  if (!pty || ptyProcesses.has('__pool__')) return;
  
  console.log('Starting new pooled session...');
  const shell = os.platform() === 'win32' ? 'powershell.exe' : 'bash';
  
  try {
    const proc = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd: process.cwd(),
      env: process.env as { [key: string]: string },
    });

    ptyProcesses.set('__pool__', {
      pid: proc.pid,
      process: proc,
      agentId: '__pool__',
    });

    proc.onData((data: string) => {
      // Pool doesn't forward data until assigned
    });

    proc.onExit(() => {
      ptyProcesses.delete('__pool__');
    });

    // Start copilot CLI
    setTimeout(() => {
      proc.write('copilot\r');
    }, 500);
    
    console.log('Pooled session ready');
  } catch (e) {
    console.error('Failed to start pooled session:', e);
  }
}

// Helper to get terminal key for an agent
function getTerminalKey(agentId: string): string | null {
  // Check if agent has an assigned terminal
  const assignedKey = agentToTerminal.get(agentId);
  if (assignedKey && ptyProcesses.has(assignedKey)) {
    return assignedKey;
  }
  // Check if agent has a direct terminal
  if (ptyProcesses.has(agentId)) {
    return agentId;
  }
  return null;
}

// Write to terminal
ipcMain.handle('terminal-write', async (_event, agentId: string, data: string) => {
  const terminalKey = getTerminalKey(agentId);
  if (!terminalKey) {
    return { success: false, error: 'No terminal for this agent' };
  }
  const proc = ptyProcesses.get(terminalKey);
  if (!proc) {
    return { success: false, error: 'No terminal for this agent' };
  }
  proc.process.write(data);
  return { success: true };
});

// Resize terminal
ipcMain.handle('terminal-resize', async (_event, agentId: string, cols: number, rows: number) => {
  const terminalKey = getTerminalKey(agentId);
  if (!terminalKey) {
    return { success: false, error: 'No terminal for this agent' };
  }
  const proc = ptyProcesses.get(terminalKey);
  if (!proc) {
    return { success: false, error: 'No terminal for this agent' };
  }
  proc.process.resize(cols, rows);
  return { success: true };
});

// Kill terminal
ipcMain.handle('terminal-kill', async (_event, agentId: string) => {
  const terminalKey = getTerminalKey(agentId);
  if (!terminalKey) {
    return { success: false, error: 'No terminal for this agent' };
  }
  const proc = ptyProcesses.get(terminalKey);
  if (!proc) {
    return { success: false, error: 'No terminal for this agent' };
  }
  try {
    proc.process.kill();
    ptyProcesses.delete(terminalKey);
    agentToTerminal.delete(agentId);
    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
});

// Check if terminal exists for agent
ipcMain.handle('terminal-exists', async (_event, agentId: string) => {
  return getTerminalKey(agentId) !== null;
});

// Save session ID for an agent (called from renderer when session ID is detected)
ipcMain.handle('save-session-id', async (_event, agentId: string, sessionId: string) => {
  agentSessionIds.set(agentId, sessionId);
  saveSessionIds();
  console.log(`Saved session for ${agentId}: ${sessionId}`);
  return { success: true };
});

// Get saved session ID for an agent
ipcMain.handle('get-session-id', async (_event, agentId: string) => {
  return agentSessionIds.get(agentId) || null;
});
