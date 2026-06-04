import { app, BrowserWindow, ipcMain, Menu, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, execSync, ChildProcess } from 'child_process';
import { TerminalRelay } from './terminal/ipc-relay';
import { createOfficeFileStore } from './officeFileStore';
import { registerNonTerminalIpc } from './nonTerminalIpc';

// ── Feature Flags ───────────────────────────────────────────────
// Defaults preserve existing local workflow. Installed CLI launcher sets both to "0".
const OPEN_DEVTOOLS_ON_START = process.env.COPILOT_OFFICE_OPEN_DEVTOOLS !== '0';
const ENABLE_FILE_WATCHER = process.env.COPILOT_OFFICE_ENABLE_WATCHER !== '0';

// ── Orphan Cleanup ──────────────────────────────────────────────
// Kill stale processes tagged with COPILOT_OFFICE_PROCESS from previous
// crashed sessions. Best-effort — startup must not fail if none exist.

function killOrphanedProcesses(): void {
  try {
    if (process.platform === 'win32') {
      // wmic returns lines like "ProcessId\r\n1234\r\n5678\r\n"
      const out = execSync(
        'wmic process where "CommandLine like \'%COPILOT_OFFICE_PROCESS%\'" get ProcessId',
        { encoding: 'utf8', stdio: ['pipe', 'pipe', 'ignore'] }
      );
      const pids = out.split(/\r?\n/)
        .map((l) => parseInt(l.trim(), 10))
        .filter((n) => !isNaN(n) && n !== process.pid);
      if (pids.length > 0) {
        console.log(`[Main] Killing ${pids.length} orphaned COPILOT_OFFICE processes:`, pids);
        for (const pid of pids) {
          try { execSync(`taskkill /T /F /PID ${pid}`, { stdio: 'ignore' }); } catch { /* ignore */ }
        }
      }
    } else {
      const out = execSync('pgrep -f COPILOT_OFFICE_PROCESS || true', {
        encoding: 'utf8',
        stdio: ['pipe', 'pipe', 'ignore'],
      });
      const pids = out.split(/\r?\n/)
        .map((l) => parseInt(l.trim(), 10))
        .filter((n) => !isNaN(n) && n !== process.pid);
      if (pids.length > 0) {
        console.log(`[Main] Killing ${pids.length} orphaned COPILOT_OFFICE processes:`, pids);        for (const pid of pids) {
          try { process.kill(pid, 'SIGKILL'); } catch { /* ignore */ }
        }
      }
    }
  } catch {
    // Best-effort — don't block startup
  }
}

// ── State ───────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let watcherProcess: ChildProcess | null = null;
const relay = new TerminalRelay(() => mainWindow);
/** Set by renderer before Ctrl+Shift+R hard reload to signal server restart. */
let pendingHardReload = false;

// ── File Watcher ────────────────────────────────────────────────

function startFileWatcher(): void {
  const copilotOfficePath = path.join(process.cwd(), 'CopilotOffice');

  if (!fs.existsSync(path.join(copilotOfficePath, 'package.json'))) {
    if (fs.existsSync(path.join(process.cwd(), 'src', 'main.ts'))) {
      watcherProcess = spawn('npx', ['esbuild', 'src/main.ts', '--bundle', '--outfile=dist/game.bundle.js', '--platform=browser', '--format=iife', '--global-name=CopilotOffice', '--watch'], {
        cwd: process.cwd(),
        shell: true,
        stdio: 'pipe',
      });
    }
  } else {
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
      if (msg.includes('watching') || msg.includes('built')) {
        if (mainWindow && !mainWindow.isDestroyed()) {
          mainWindow.webContents.send('build-complete');
        }
      }
    });
    watcherProcess.stderr?.on('data', (data) => {
      console.error('[Watcher Error]', data.toString());
    });
    console.log('File watcher started');
  }
}

// ── Window ──────────────────────────────────────────────────────

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 2560,
    height: 1440,
    title: 'Copilot Office',
    webPreferences: {
      preload: path.join(__dirname, 'terminal', 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
    },
  });

  mainWindow.maximize();
  mainWindow.loadFile(path.join(__dirname, '../../src/index.html'));

  if (OPEN_DEVTOOLS_ON_START) {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  mainWindow.webContents.on('did-start-navigation', (_event, _url, isInPlace) => {
    if (isInPlace && pendingHardReload) {
      console.log('[Main] Hard reload — restarting terminal server');
      pendingHardReload = false;
      relay.shutdown().then(() =>
        relay.spawnServer(__dirname)
      ).catch((e) =>
        console.error('[Main] Failed to respawn after reload:', e)
      );
    } else if (isInPlace) {
      console.log('[Main] Soft reload — keeping terminal server alive');
    }
  });

  mainWindow.on('closed', () => {
    // Cleanup is handled by 'before-quit' — just clear the reference.
    if (watcherProcess) {
      watcherProcess.kill();
      watcherProcess = null;
    }
    mainWindow = null;
  });
}

// ── App Lifecycle ───────────────────────────────────────────────

app.whenReady().then(async () => {
  // Remove default menu so OS-level shortcuts like F10 (menu focus) don't
  // consume keydown events before the renderer can handle them.
  Menu.setApplicationMenu(null);

  killOrphanedProcesses();

  relay.registerIpc();

  // Non-terminal IPC handlers (hard reload, native notifications, office persistence).
  // See electron/nonTerminalIpc.ts — extracted in S2-F so contracts live in one place.
  const officeStore = createOfficeFileStore();
  registerNonTerminalIpc({
    getMainWindow: () => mainWindow,
    onHardReloadRequested: () => { pendingHardReload = true; },
    officeStore,
  });

  await relay.spawnServer(__dirname);
  if (ENABLE_FILE_WATCHER) {
    startFileWatcher();
  } else {
    console.log('[Main] File watcher disabled');
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (watcherProcess) watcherProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

let isShuttingDown = false;
app.on('before-quit', (event) => {
  if (isShuttingDown) return;          // already running — let quit proceed
  isShuttingDown = true;
  event.preventDefault();              // hold quit until PTYs are cleaned up
  console.log('[Main] Awaiting relay shutdown before quit…');
  relay.shutdown().finally(() => {
    console.log('[Main] Relay shutdown complete — quitting');
    app.quit();                        // re-trigger quit (isShuttingDown guard skips this handler)
  });
});

