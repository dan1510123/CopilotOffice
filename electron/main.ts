import { app, BrowserWindow, ipcMain, Menu, Notification, safeStorage } from 'electron';
import * as path from 'path';
import * as fs from 'fs';
import { spawn, ChildProcess } from 'child_process';
import { TerminalRelay } from './terminal/ipc-relay';
import { createOfficeFileStore } from './officeFileStore';
import { runLifecycleBackup } from './dataBackup';
import { registerNonTerminalIpc } from './nonTerminalIpc';
import { reapRegisteredPtys } from './terminal/pty-registry';
import { TeamsService } from './teams/teamsService';
import { AzTokenProvider } from './teams/auth';
import { createSafeStorageTokenPersistence } from './teams/tokenCacheStore';
import { GraphClient } from './teams/graphClient';
import { TrouterClient } from './teams/trouterClient';
import { RelaySessionGateway } from './teams/sessionGateway';
import { OrchestratorSessionGateway } from './teams/orchestratorSessionGateway';
import { CompositeSessionGateway } from './teams/compositeSessionGateway';
import {
  ORCHESTRATOR_OFFICE_ID,
  ORCHESTRATOR_AGENT_ID,
  ORCHESTRATOR_DISPLAY_NAME,
} from './orchestrator/orchestratorIdentity';
import { FileTeamsOnlineStore } from './teams/onlineAgentsStore';
import { createTeamsSettingsStore } from './teams/teamsSettingsStore';
import { createAllowlistedGraphSender, allowedChannelIdSet, officeChannelOverridesFromJson, createCachedAllowedChannels } from './teams/channelAllowlist';
import { createRelaySender, type MentionResolver } from './teams/relaySender';
import { registerTeamsIpc, makeStatusEmitter, makeToastEmitter } from './teams/teamsIpc';
import { OrchestratorSessionManager } from './orchestrator/orchestratorSessionManager';
import { registerOrchestratorIpc, makeOrchestratorEmitter } from './orchestrator/orchestratorIpc';
import { FileOrchestratorTranscriptStore } from './orchestrator/orchestratorTranscriptStore';

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

  // Continuous data backups (spec: on open / on close). Snapshot the whole
  // `.data` directory before we touch it this session, then prune snapshots
  // older than 30 days. Best-effort — never blocks or fails startup.
  runLifecycleBackup('open');

  relay.registerIpc();

  // Non-terminal IPC handlers (hard reload, native notifications, office persistence).
  // See electron/nonTerminalIpc.ts — extracted in S2-F so contracts live in one place.
  const officeStore = createOfficeFileStore();
  registerNonTerminalIpc({
    getMainWindow: () => mainWindow,
    onHardReloadRequested: () => { pendingHardReload = true; },
    officeStore,
  });

  // Office Orchestrator agent (spec 016): its own always-gated, non-YOLO SDK
  // session, separate from the terminal server's office sessions. Panel/stream
  // teardown detaches only — it never kills office sessions or this session.
  const orchestratorManager = new OrchestratorSessionManager(
    makeOrchestratorEmitter(() => mainWindow),
    process.cwd(),
    // spec 017 (US1): file-backed transcript store under .data (mirrors
    // FileTeamsOnlineStore); retention bound = panel xterm scrollback (5000).
    new FileOrchestratorTranscriptStore(
      FileOrchestratorTranscriptStore.defaultPath(path.join(process.cwd(), '.data')),
    ),
    5000,
  );
  registerOrchestratorIpc({ manager: orchestratorManager });

  await relay.spawnServer(__dirname);

  // Show the UI as soon as the terminal server is ready. The Teams service below
  // starts its receive transport in the background (fire-and-forget) so its token
  // acquisition never blocks window creation.
  if (ENABLE_FILE_WATCHER) {
    startFileWatcher();
  } else {
    console.log('[Main] File watcher disabled');
  }
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });

  // ── Teams Remote Agents service ───────────────────────────────
  // Main-process background service: real-time receive (Trouter) + Graph send +
  // dispatch into existing terminal sessions. Feature-gated by settings.enabled.
  try {
    const settingsStore = createTeamsSettingsStore(process.cwd());
    // Persist cached tokens encrypted at rest (OS safeStorage/DPAPI) so a still-valid
    // token survives app restarts and skips the slow `az` cold-start. Fails safe:
    // nothing is written when OS encryption is unavailable.
    const tokenPersistence = createSafeStorageTokenPersistence(
      path.join(process.cwd(), '.data', 'teams-token.enc'),
      safeStorage,
    );
    // The token observer forwards az/token outcomes to the Teams service so it can surface
    // an actionable "run az login" toast on a hard credential failure and clear it on
    // recovery. A lazy getter is used because `teamsService` is constructed further below;
    // the observer only fires during async token acquisition, long after wiring completes.
    const tokens = new AzTokenProvider(undefined, tokenPersistence, {
      onAcquire: (resource) => teamsService?.onTokenOutcome('acquire', resource, false),
      onFailure: (resource, err, usedCache) => teamsService?.onTokenOutcome('fail', resource, usedCache, err),
    });
    // Hard outbound gate: the app may only POST to the configured channels — the
    // global default plus per-office overrides. Enforced at the GraphSender boundary
    // so every send path (threads, replies, acks, check-ins, notices) is validated.
    // Cached with a short TTL so the disk-backed settings/office reads don't run on
    // every send (and to shrink the mid-write file-lock window).
    const getAllowedChannels = createCachedAllowedChannels(() =>
      allowedChannelIdSet(
        settingsStore.load().defaultChannelUrl,
        officeChannelOverridesFromJson(officeStore.load().data),
      ),
    );
    // Short-TTL cache of the disk-backed settings so the per-send relay lookups
    // (URL + active check) don't re-read the file on every outbound post.
    let cachedTeamsSettings = settingsStore.load();
    let teamsSettingsAt = Date.now();
    const getTeamsSettingsCached = () => {
      const now = Date.now();
      if (now - teamsSettingsAt >= 2000) {
        cachedTeamsSettings = settingsStore.load();
        teamsSettingsAt = now;
      }
      return cachedTeamsSettings;
    };
    // Outbound routing: when a relay/trigger channel URL is configured it acts as a
    // feature flag — all posts go to that trigger channel so a Power Automate flow
    // re-posts them under a distinct bot identity (so the operator gets notified). The
    // relay uses a RAW GraphClient (not the allowlisted one) because the trigger channel
    // is intentionally outside the allowlist; its destination is fixed by operator
    // settings. With no URL, fall back to the allowlisted signed-in-user sender.
    const rawGraph = new GraphClient(tokens);
    const allowlistedGraph = createAllowlistedGraphSender(rawGraph, getAllowedChannels);
    // Resolve the operator's mention target to a concrete id per destination team.
    // Tags are team-scoped, so tag names resolve against the message's destination team.
    // Never throws — unresolved targets degrade to no mention.
    const resolveMention: MentionResolver = async (ref, destTeamId) => {
      try {
        if (ref.type === 'user') {
          const id = await rawGraph.findUserId(ref.value);
          return id ? { mentionType: 'user', mentionId: id } : { mentionType: 'none', mentionId: '' };
        }
        if (ref.type === 'tag') {
          // Tags are team-scoped and resolving a name → tagId needs TeamworkTag.Read,
          // which the az-CLI token may lack. So we DON'T resolve here — pass the operator's
          // configured value (a tag display name or an explicit tagId) through as-is, and
          // let the Power Automate flow resolve it via GetTags using its Teams connection
          // (which has full delegated Teams scopes). Empty ⇒ no mention.
          const raw = ref.value.trim();
          return raw ? { mentionType: 'tag', mentionId: raw } : { mentionType: 'none', mentionId: '' };
        }
      } catch {
        /* fall through to none */
      }
      return { mentionType: 'none', mentionId: '' };
    };
    const relaySender = createRelaySender({
      primary: rawGraph,
      getDumpChannelUrl: () => getTeamsSettingsCached().relayChannelUrl,
      getMention: () => ({
        type: getTeamsSettingsCached().relayMentionType,
        value: getTeamsSettingsCached().relayMentionValue,
      }),
      resolveMention,
      // The fan-out destination must satisfy the same outbound allowlist as the direct path.
      isDestinationAllowed: (channelId) => getAllowedChannels().has(channelId),
    });
    // Content ALWAYS posts directly as the signed-in user (allowlisted sender), exactly
    // as it did before the relay feature existed. The relay/Dump channel is used ONLY for
    // the end-of-response completion NOTIFICATION (a single distinct-identity Flow-bot
    // @mention), gated by notifyOnCompleteEnabled + a configured relay Dump channel URL.
    const graph = allowlistedGraph;
    const isNotifyActive = () => {
      const s = getTeamsSettingsCached();
      return s.notifyOnCompleteEnabled && !!s.relayChannelUrl.trim();
    };
    const source = new TrouterClient(tokens);
    const officeGateway = new RelaySessionGateway(relay);
    // spec 016 (Workstream B): route the synthetic orchestrator identity to the
    // main-process orchestrator session; every office agent keeps the relay path.
    const orchestratorGateway = new OrchestratorSessionGateway(orchestratorManager);
    const gateway = new CompositeSessionGateway(officeGateway, orchestratorGateway);
    const store = new FileTeamsOnlineStore(
      FileTeamsOnlineStore.defaultPath(path.join(process.cwd(), '.data')),
    );
    const emitStatus = makeStatusEmitter(() => mainWindow);
    const emitToast = makeToastEmitter(() => mainWindow);

    teamsService = new TeamsService({
      store,
      tokens,
      graph,
      notifier: relaySender,
      isNotifyActive,
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
        if (settings.enabled) {
          teamsService
            ?.start()
            .then(() => teamsService?.verifyAccess(settings))
            .catch((e) => console.error('[Main] Teams start failed:', e));
        } else {
          teamsService?.stop().catch((e) => console.error('[Main] Teams stop failed:', e));
        }
      },
    });

    // spec 016 (Workstream B): bring the Office Orchestrator online in Teams. Ensures its
    // main-process SDK session is open (so the composite gateway can resolve a sessionId),
    // then registers the synthetic identity through the normal Teams register flow.
    ipcMain.handle('teams:registerOrchestrator', async () => {
      if (!teamsService) return { success: false, error: 'Teams service unavailable.' };
      try {
        await orchestratorManager.open();
      } catch (e) {
        return { success: false, error: `Orchestrator failed to start: ${(e as Error).message}` };
      }
      const result = await teamsService.register({
        officeId: ORCHESTRATOR_OFFICE_ID,
        agentId: ORCHESTRATOR_AGENT_ID,
        displayName: ORCHESTRATOR_DISPLAY_NAME,
        workingDir: process.cwd(),
      });
      // A reachable in-thread approver now exists — let minimize keep gates open.
      if (result?.success) orchestratorManager.setTeamsRelayActive(true);
      return result;
    });

    ipcMain.handle('teams:stopOrchestrator', async () => {
      orchestratorManager.setTeamsRelayActive(false);
      if (!teamsService) return { success: true };
      return teamsService.goOffline(ORCHESTRATOR_OFFICE_ID, ORCHESTRATOR_AGENT_ID, true);
    });

    // Only spin up the receive transport when the feature is enabled.
    // Fire-and-forget: do NOT await, so token acquisition runs in the
    // background after the window is already visible.
    if (settingsStore.load().enabled) {
      teamsService.start().catch((e) => console.error('[Main] Teams start failed:', e));
    } else {
      console.log('[TeamsRemote] Feature disabled — service idle (enable it in Settings → Teams Remote).');
    }
  } catch (e) {
    console.error('[Main] Failed to initialize Teams service:', e);
  }
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
      // Snapshot the final `.data` state after the server has flushed session
      // files during shutdown, so the on-close backup captures the latest data.
      // Intentionally synchronous: `.data` is small and the snapshot must finish
      // before `app.quit()` or the final state could be lost on process exit.
      runLifecycleBackup('close');
      console.log('[Main] Relay shutdown complete — quitting');
      app.quit();                        // re-trigger quit (isShuttingDown guard skips this handler)
    });
  });
});

