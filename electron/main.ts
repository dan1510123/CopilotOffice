import { app, BrowserWindow, ipcMain, Menu, Notification } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { TerminalRelay } from './terminal/ipc-relay';
import { createOfficeFileStore } from './officeFileStore';
import { registerNonTerminalIpc } from './nonTerminalIpc';
import { reapRegisteredPtys } from './terminal/pty-registry';
import { TeamsService } from './teams/teamsService';
import { AzTokenProvider } from './teams/auth';
import { GraphClient } from './teams/graphClient';
import { TrouterClient } from './teams/trouterClient';
import { RelaySessionGateway } from './teams/sessionGateway';
import { FileTeamsOnlineStore } from './teams/onlineAgentsStore';
import { createTeamsSettingsStore } from './teams/teamsSettingsStore';
import { registerTeamsIpc, makeStatusEmitter, makeToastEmitter } from './teams/teamsIpc';

// ── Feature Flags ───────────────────────────────────────────────
// Defaults preserve existing local workflow. Installed CLI launcher sets both to "0".
const OPEN_DEVTOOLS_ON_START = process.env.COPILOT_OFFICE_OPEN_DEVTOOLS !== '0';
const ENABLE_FILE_WATCHER = process.env.COPILOT_OFFICE_ENABLE_WATCHER !== '0';

// ── Orphan Cleanup ──────────────────────────────────────────────
// Reap PTY process trees (shell + copilot CLI) left alive by a previous
// session that exited ungracefully (crash, Task Manager kill, OS shutdown).
// The terminal server persists every spawned PTY root PID to .data/pty-pids.json
// (see electron/terminal/pty-registry.ts); we read that registry and force-kill
// any survivor, then reset it. This replaces the old `wmic`/`pgrep` approach,
// which was a no-op: `wmic` is removed from modern Windows, and both queries
// matched the COPILOT_OFFICE_PROCESS *env var* against the *command line*, where
// env vars never appear. Best-effort — startup must not fail if none exist.

function killOrphanedProcesses(): void {
  try {
    const { reaped, skipped } = reapRegisteredPtys();
    if (reaped.length > 0) {
      console.log(`[Main] Reaped ${reaped.length} orphaned PTY process tree(s):`, reaped);
    }
    if (skipped.length > 0) {
      console.log(`[Main] Skipped ${skipped.length} already-dead PTY record(s) from registry`);
    }
  } catch {
    // Best-effort — don't block startup
  }
}

// ── State ───────────────────────────────────────────────────────

let mainWindow: BrowserWindow | null = null;
let watcherProcess: ChildProcess | null = null;
const relay = new TerminalRelay(() => mainWindow);
let teamsService: TeamsService | null = null;
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

  // ── Teams Remote Agents service ───────────────────────────────
  // Main-process background service: real-time receive (Trouter) + Graph send +
  // dispatch into existing terminal sessions. Feature-gated by settings.enabled.
  try {
    const settingsStore = createTeamsSettingsStore(process.cwd());
    const tokens = new AzTokenProvider();
    const graph = new GraphClient(tokens);
    const source = new TrouterClient(tokens);
    const gateway = new RelaySessionGateway(relay);
    const store = new FileTeamsOnlineStore(
      FileTeamsOnlineStore.defaultPath(path.join(process.cwd(), '.data')),
    );
    const emitStatus = makeStatusEmitter(() => mainWindow);
    const emitToast = makeToastEmitter(() => mainWindow);

    teamsService = new TeamsService({
      store,
      tokens,
      graph,
      source,
      gateway,
      getSettings: () => settingsStore.load(),
      emitStatus,
      emitToast,
    });

    registerTeamsIpc({
      service: teamsService,
      settingsStore,
      getMainWindow: () => mainWindow,
      onSettingsChanged: (settings) => {
        if (settings.enabled) teamsService?.start().catch((e) => console.error('[Main] Teams start failed:', e));
        else teamsService?.stop().catch((e) => console.error('[Main] Teams stop failed:', e));
      },
    });

    // Only spin up the receive transport when the feature is enabled.
    if (settingsStore.load().enabled) {
      await teamsService.start();
    }
  } catch (e) {
    console.error('[Main] Failed to initialize Teams service:', e);
  }

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
  const teamsStop = teamsService ? teamsService.stop().catch(() => undefined) : Promise.resolve();
  Promise.resolve(teamsStop).finally(() => {
    relay.shutdown().finally(() => {
      console.log('[Main] Relay shutdown complete — quitting');
      app.quit();                        // re-trigger quit (isShuttingDown guard skips this handler)
    });
  });
});

