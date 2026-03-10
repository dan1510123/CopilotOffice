import { app, BrowserWindow, ipcMain, Menu, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, execSync, ChildProcess } from 'child_process';
import { TerminalRelay } from './terminal/ipc-relay';

// ── Feature Flags ───────────────────────────────────────────────
const OPEN_DEVTOOLS_ON_START = true;

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
    relay.shutdown();
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
  ipcMain.handle('request-hard-reload', () => {
    console.log('[Main] Hard reload requested by renderer');
    pendingHardReload = true;
    return { success: true };
  });

  // Native OS notification support
  ipcMain.handle('show-native-notification', (_event, title: string, body: string) => {
    if (!Notification.isSupported()) return { success: false };
    const notification = new Notification({ title, body });
    notification.on('click', () => {
      // Bring the app window to front when notification is clicked
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
      }
    });
    notification.show();
    return { success: true };
  });

  // Office file persistence — save/load office configs to copilot-offices.json
  const officesFilePath = path.join(process.cwd(), 'copilot-offices.json');

  ipcMain.handle('save-offices', (_event, data: string) => {
    try {
      fs.writeFileSync(officesFilePath, data, 'utf8');
      return { success: true };
    } catch (e: unknown) {
      console.warn('[Main] Failed to save offices:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle('load-offices', () => {
    try {
      if (!fs.existsSync(officesFilePath)) return { success: true, data: null };
      const data = fs.readFileSync(officesFilePath, 'utf8');
      return { success: true, data };
    } catch (e: unknown) {
      console.warn('[Main] Failed to load offices:', e);
      return { success: false, error: String(e), data: null };
    }
  });
  await relay.spawnServer(__dirname);
  startFileWatcher();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  relay.shutdown();
  if (watcherProcess) watcherProcess.kill();
  if (process.platform !== 'darwin') app.quit();
});

app.on('will-quit', () => {
  console.log('[Main] App quitting');
  relay.shutdown();
});

