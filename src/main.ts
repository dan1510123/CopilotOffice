// CopilotOffice - Main Entry Point
// Phaser 3 office visualization with split terminal view

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { OfficeScene } from './scenes/OfficeScene';
import { MeetingScene } from './scenes/MeetingScene';
import { officeManager, OfficeLayout, OfficeData } from './office/officeManager';
import { AGENTS, AgentConfig, swapActiveAgents, restoreSeatedReserveAgents, ARCHITECT_AGENT_ID } from './config/agents';
import { ResponsiveLayoutKey, computeResponsiveLayout } from './config/responsiveLayout';
import { ZIndex } from './config/zIndex';
import { getLayout } from './layouts/index';
import { SessionMetaSnapshot } from './layouts/types';
import { ToastNotificationManager } from './ui/ToastNotification';
import { showClipboardToast } from './ui/clipboardToast';
import { NotificationService } from './ui/NotificationService';
import { SettingsPanel } from './ui/SettingsPanel';
import { TeamsSettingsOverlay } from './ui/TeamsSettingsOverlay';
import { SpriteCustomizerPanel } from './ui/SpriteCustomizerPanel';
import { SeriousTerminalController } from './ui/SeriousTerminalController';
import { regeneratePlayerSprite } from './sprites/SpriteGenerator';
import { isAskUserTool, nextSubStateAfterToolComplete, addActiveTool, removeCompletedTool, ToolEntry } from './util/toolStatus';
import { formatElapsedMmSs, computeStall } from './config/agentStatusPresentation';
import { decideStartupTimeoutTransition } from './util/startupTimeoutGuard';
import { AutoStartCoordinator, setAutoStartCoordinator } from './agents/AutoStartCoordinator';
import { getAgentAutoStartSettings, setAgentAutoStartSettings } from './config/agentAutoStart';
import { isYoloEnabled } from './config/yoloMode';
import { getActiveAdditionalParams } from './config/additionalParams';

// ── State ────────────────────────────────────────────────────

officeManager.ensureDefaultOffice();
recordOfficeAccess(officeManager.currentOfficeId);

/** Get the current office layout type. */
function getCurrentLayout(): OfficeLayout {
  return officeManager.currentOffice?.config.layout ?? 'default';
}

/** Return the agent list for the current office layout */
function getCurrentAgents() {
  return getLayout(getCurrentLayout()).agents;
}

/**
 * Order agent cards for the overview according to the active sort mode.
 * - 'default': the layout's configured order (unchanged).
 * - 'recent': most recently active first. Recency is the latest of the agent's
 *   in-memory activity (`activityStartTime` / `recentActions` timestamps) and
 *   the persisted last-activity timestamp for this office+agent, so the order
 *   survives an app restart. Agents with no recorded activity score 0. Stable,
 *   so equal-score agents keep config order.
 */
function sortAgentsByMode(agents: AgentConfig[], office: OfficeData | null): AgentConfig[] {
  if (agentSortMode !== 'recent' || !office) return agents;
  const persisted = getOfficeAgentActivityTimes(office.config.id);
  const recency = (id: string): number => {
    let t = persisted[id] ?? 0;
    const status = office.agents.get(id);
    if (status) {
      if ((status.activityStartTime ?? 0) > t) t = status.activityStartTime!;
      for (const action of status.recentActions) {
        if (action.timestamp > t) t = action.timestamp;
      }
    }
    return t;
  };
  return [...agents].sort((a, b) => recency(b.id) - recency(a.id));
}

function getCurrentAgentTools(): Map<string, ToolEntry[]> {
  return officeManager.currentOffice?.agentTools || new Map();
}

function syncActiveRosterForCurrentOffice(): void {
  const office = officeManager.currentOffice;
  if (!office) return;

  swapActiveAgents(office.config);
  if (office.config.layout === 'default') {
    restoreSeatedReserveAgents(officeManager.getSeatedAgents(office.config.id));
  }
}

function isDonePendingAck(status: { completionPendingAck?: boolean } | null | undefined): boolean {
  return !!status?.completionPendingAck;
}

let selectedAgentId: string | null = null;
let phaserGameRef: Phaser.Game | undefined;
let debugMode = false;
let currentZoom = parseFloat(localStorage.getItem('agencyOffice:zoomLevel') ?? '0.8');
currentZoom = (isNaN(currentZoom) || currentZoom < 0.5 || currentZoom > 2.0) ? 0.8 : currentZoom;
const RESIZE_DEBOUNCE_MS = 200;
type AppMode = 'game' | 'serious';
const APP_MODE_STORAGE_KEY = 'agencyOffice:appMode';
const SESSION_META_CACHE_STORAGE_KEY = 'agencyOffice:sessionMetaCacheByOffice';
const OVERVIEW_SPRITE_CACHE_STORAGE_KEY = 'agencyOffice:overviewSpriteCache';
const PC_TERMINAL_ID = 'pc-terminal';

// Agent card sort state (orders agent cards within the current office view)
type AgentSortMode = 'default' | 'recent';
const AGENT_SORT_STORAGE_KEY = 'agencyOffice:agentSortMode';
const OFFICE_ACCESS_TIMES_KEY = 'agencyOffice:officeAccessTimes';
// Persisted last-activity (tool/turn) timestamps so the 'recent' agent sort
// survives an app restart, when the in-memory AgentStatus map is empty.
// Shape: { [officeId]: { [agentId]: epochMs } }.
const AGENT_ACTIVITY_TIMES_KEY = 'agencyOffice:agentActivityTimes';
let agentSortMode: AgentSortMode = (localStorage.getItem(AGENT_SORT_STORAGE_KEY) as AgentSortMode) || 'default';

function getAgentActivityTimes(): Record<string, Record<string, number>> {
  try {
    const raw = localStorage.getItem(AGENT_ACTIVITY_TIMES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function getOfficeAgentActivityTimes(officeId: string): Record<string, number> {
  return getAgentActivityTimes()[officeId] ?? {};
}

function recordAgentActivity(officeId: string | null, agentId: string): void {
  if (!officeId) return;
  const all = getAgentActivityTimes();
  const office = all[officeId] ?? {};
  office[agentId] = Date.now();
  all[officeId] = office;
  try { localStorage.setItem(AGENT_ACTIVITY_TIMES_KEY, JSON.stringify(all)); } catch { /* ignore */ }
}

function getOfficeAccessTimes(): Record<string, number> {
  try {
    const raw = localStorage.getItem(OFFICE_ACCESS_TIMES_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function recordOfficeAccess(officeId: string | null): void {
  if (!officeId) return;
  const times = getOfficeAccessTimes();
  times[officeId] = Date.now();
  try { localStorage.setItem(OFFICE_ACCESS_TIMES_KEY, JSON.stringify(times)); } catch { /* ignore */ }
}

function sanitizeAppMode(value: string | null | undefined): AppMode {
  return value === 'serious' ? 'serious' : 'game';
}

let appMode: AppMode = sanitizeAppMode(localStorage.getItem(APP_MODE_STORAGE_KEY));

function persistAppMode(mode: AppMode): void {
  try {
    localStorage.setItem(APP_MODE_STORAGE_KEY, mode);
  } catch {
    // ignore storage failures
  }
}

type SessionMetaCacheByOffice = Record<string, Record<string, { title: string }>>;

function loadSessionMetaCacheByOffice(): SessionMetaCacheByOffice {
  try {
    const raw = localStorage.getItem(SESSION_META_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as SessionMetaCacheByOffice;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveSessionMetaCacheByOffice(cache: SessionMetaCacheByOffice): void {
  try {
    localStorage.setItem(SESSION_META_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage failures
  }
}

function getSessionMetaCacheForOffice(officeId: string): Record<string, { title: string }> {
  const all = loadSessionMetaCacheByOffice();
  return all[officeId] || {};
}

function setSessionMetaCacheForOffice(officeId: string, meta: Record<string, { title: string }>): void {
  const all = loadSessionMetaCacheByOffice();
  all[officeId] = meta;
  saveSessionMetaCacheByOffice(all);
}

type OverviewSpriteCache = Record<string, string>;

function loadOverviewSpriteCache(): OverviewSpriteCache {
  try {
    const raw = localStorage.getItem(OVERVIEW_SPRITE_CACHE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as OverviewSpriteCache;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function saveOverviewSpriteCache(cache: OverviewSpriteCache): void {
  try {
    localStorage.setItem(OVERVIEW_SPRITE_CACHE_STORAGE_KEY, JSON.stringify(cache));
  } catch {
    // ignore storage failures
  }
}

/** Log only when debug mode is active */
function debugLog(...args: unknown[]): void {
  if (debugMode) console.log('[Debug]', ...args);
}

// ── Agent Preload Status ────────────────────────────────────────
const agentPreloadStatus: Map<string, 'preloading' | 'ready' | 'failed'> = new Map();

// ── Debounced Updates ────────────────────────────────────────────
let pendingStatusBarUpdate = false;
let pendingTerminalContentUpdate = false;
const OVERVIEW_SPRITE_MAX_RETRY_ATTEMPTS = 5;
const OVERVIEW_SPRITE_RETRY_DELAY_MS = 120;
let overviewSpriteRetryTimer: ReturnType<typeof setTimeout> | null = null;
let overviewSpriteCache = loadOverviewSpriteCache();
const overviewSpriteImageCache: Map<string, HTMLImageElement> = new Map();

function scheduleUiUpdateWithFallback(callback: () => void): void {
  let done = false;
  const runOnce = () => {
    if (done) return;
    done = true;
    callback();
  };

  requestAnimationFrame(runOnce);
  // In background/unfocused states requestAnimationFrame may be throttled heavily.
  // Keep a timeout fallback so status updates continue to flow.
  const fallbackDelayMs = document.hidden ? 80 : 200;
  setTimeout(runOnce, fallbackDelayMs);
}

function scheduleStatusBarUpdate() {
  if (pendingStatusBarUpdate) return;
  pendingStatusBarUpdate = true;
  scheduleUiUpdateWithFallback(() => {
    pendingStatusBarUpdate = false;
    updateStatusBarNow();
  });
}

function scheduleTerminalContentUpdate() {
  if (pendingTerminalContentUpdate) return;
  pendingTerminalContentUpdate = true;
  scheduleUiUpdateWithFallback(() => {
    pendingTerminalContentUpdate = false;
    updateTerminalContentNow();
  });
}

// ── DOM Setup ────────────────────────────────────────────────────

const container = document.getElementById('game-container')!;
// Clear stale DOM on soft reload — prevents duplicate elements when main.ts re-executes
container.innerHTML = '';
container.style.cssText = 'display: flex; flex-direction: column; width: 100%; height: calc(100% - 58px);';

// Office tabs bar
const tabsBar = document.createElement('div');
tabsBar.id = 'office-tabs';
tabsBar.style.cssText = `
  display: flex;
  align-items: center;
  gap: 6px;
  background: #171724;
  border-bottom: 1px solid #26263a;
  padding: 0 12px;
  height: 60px;
  flex-shrink: 0;
  overflow: hidden;
  font-family: 'Segoe UI', system-ui, -apple-system, sans-serif;
  box-shadow: 0 2px 12px rgba(0,0,0,.28);
`;
container.appendChild(tabsBar);
injectTopBarStyles();

// Main content area (split view)
const mainContent = document.createElement('div');
mainContent.style.cssText = 'display: flex; flex: 1; min-height: 0;';
container.appendChild(mainContent);

// Left panel: Phaser renders here
const officePanel = document.createElement('div');
officePanel.id = 'office-panel';
officePanel.style.cssText = 'width: 50%; height: 100%; position: relative;';
mainContent.appendChild(officePanel);

// Right panel: dashboard by default, xterm when interacting
const terminalPanel = document.createElement('div');
terminalPanel.id = 'terminal-panel';
terminalPanel.style.cssText = `
  width: 50%;
  height: 100%;
  background: #1e1e2e;
  border-left: 2px solid #333;
  display: flex;
  flex-direction: column;
  position: relative;
`;
mainContent.appendChild(terminalPanel);

// Explicit hosts inside the right panel (mode-dependent composition)
const overviewHost = document.createElement('div');
overviewHost.id = 'overview-host';
overviewHost.style.cssText = `
  display: flex;
  flex-direction: column;
  flex: 1;
  min-height: 0;
  position: relative;
`;
terminalPanel.appendChild(overviewHost);

const terminalHost = document.createElement('div');
terminalHost.id = 'terminal-host';
terminalHost.style.cssText = 'display: none; flex: 1; min-height: 0;';
terminalPanel.appendChild(terminalHost);

const seriousPlaceholder = document.createElement('div');
seriousPlaceholder.id = 'serious-terminal-placeholder';
seriousPlaceholder.style.cssText = `
  display: none;
  flex: 1;
  min-height: 0;
  align-items: center;
  justify-content: center;
  padding: 24px;
  font-family: 'Cascadia Code', Consolas, monospace;
  text-align: center;
  color: #95a7d7;
  background: radial-gradient(circle at top, #222846 0%, #171c2f 50%, #13192a 100%);
`;
seriousPlaceholder.innerHTML = `
  <div style="max-width: 380px;">
    <div style="font-size: 34px; margin-bottom: 10px;">💻</div>
    <div style="font-size: 18px; color: #c7d7ff; font-weight: 700; margin-bottom: 8px;">No terminal selected</div>
    <div style="font-size: 12px; line-height: 1.45; color: #8fa3d6;">
      Select an agent or office PC from the overview on the left to open a command line session.
    </div>
  </div>
`;
terminalHost.appendChild(seriousPlaceholder);

let currentResponsiveLayout: ResponsiveLayoutKey = 'default';
let resizeDebounceTimer: number | null = null;

function isMobileModeActive(): boolean {
  return currentResponsiveLayout === 'portrait-dashboard';
}

function applyMobileTopBarVisibility(): void {
  const hidden = isMobileModeActive();
  const ids = ['zoom-bar', 'sprite-customizer-btn', 'debug-toggle-btn'];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (!el) continue;
    el.style.display = hidden ? 'none' : '';
  }
}

function syncMainPanelLayout(): void {
  const hideOfficePanel = currentResponsiveLayout === 'portrait-dashboard';
  if (hideOfficePanel) {
    officePanel.style.display = 'none';
    officePanel.style.flexDirection = '';
    terminalPanel.style.width = '100%';
    terminalPanel.style.borderLeft = 'none';
    return;
  }

  officePanel.style.display = appMode === 'serious' ? 'flex' : '';
  officePanel.style.flexDirection = appMode === 'serious' ? 'column' : '';
  terminalPanel.style.width = '50%';
  terminalPanel.style.borderLeft = '2px solid #333';
}

function applyResponsiveLayout(layoutKey: ResponsiveLayoutKey): void {
  if (layoutKey === currentResponsiveLayout) return;
  currentResponsiveLayout = layoutKey;

  syncMainPanelLayout();
  refreshRightPanelMode();

  if (phaserGameRef && appMode === 'game') {
    phaserGameRef.events.emit('layout:change', { layoutKey });

    if (layoutKey === 'default') {
      const width = officePanel.clientWidth || window.innerWidth / 2;
      const height = officePanel.clientHeight || window.innerHeight;
      phaserGameRef.scale.resize(width, height);
    }
  }

  applyMobileTopBarVisibility();
}

function onWindowResize(): void {
  if (resizeDebounceTimer !== null) {
    window.clearTimeout(resizeDebounceTimer);
  }
  resizeDebounceTimer = window.setTimeout(() => {
    const next = computeResponsiveLayout(window.innerWidth, window.innerHeight);
    applyResponsiveLayout(next);
    if (phaserGameRef && appMode === 'game' && currentResponsiveLayout === 'default') {
      const width = officePanel.clientWidth || window.innerWidth / 2;
      const height = officePanel.clientHeight || window.innerHeight;
      phaserGameRef.scale.resize(width, height);
    }
  }, RESIZE_DEBOUNCE_MS);
}

type ApplyAppModeOptions = {
  persist?: boolean;
  refreshTabs?: boolean;
  force?: boolean;
};

function applyAppMode(nextMode: AppMode, options: ApplyAppModeOptions = {}): void {
  const { persist = false, refreshTabs = true, force = false } = options;
  if (!force && nextMode === appMode) return;

  const previousMode = appMode;
  appMode = nextMode;
  const selectedAgentBeforeModeSwitch = selectedAgentId;

  if (previousMode === 'serious' && appMode === 'game') {
    void seriousTerminalController?.closeView({ detach: true, silent: true });
  }
  if (previousMode === 'game' && appMode === 'serious') {
    // User-reported 2026-06-12: a game-mode terminal that was open at flip
    // time stayed parented in terminalPanel (the overlay DOM is created by
    // OfficeScene.TerminalOverlay; teardownPhaserGame() destroys the scene
    // but does NOT touch the overlay's DOM container or its IPC viewer
    // attach). Hide it first so the serious panel gets a clean slate and
    // the server stops streaming PTY data to a detached viewer. hide() is
    // intentionally non-destructive — the PTY session stays alive.
    try {
      const scene = phaserGameRef?.scene.getScene('OfficeScene') as
        | { getTerminalOverlay?: () => { hide?: () => void; getIsVisible?: () => boolean } }
        | undefined;
      const overlay = scene?.getTerminalOverlay?.();
      if (overlay?.getIsVisible?.()) {
        overlay.hide?.();
      }
    } catch (err) {
      console.warn('[main] failed to hide game-mode terminal overlay on mode flip', err);
    }
  }
  if (appMode === 'serious') {
    prewarmOverviewSpriteCacheFromTextures();
    teardownPhaserGame();
  } else {
    ensurePhaserGame();
  }

  container.dataset.appMode = appMode;
  tabsBar.dataset.appMode = appMode;
  mainContent.dataset.appMode = appMode;
  officePanel.dataset.appMode = appMode;
  terminalPanel.dataset.appMode = appMode;
  overviewHost.dataset.appMode = appMode;
  terminalHost.dataset.appMode = appMode;
  syncMainPanelLayout();
  if (phaserGameRef && appMode === 'game' && currentResponsiveLayout === 'default') {
    const width = officePanel.clientWidth || window.innerWidth / 2;
    const height = officePanel.clientHeight || window.innerHeight;
    phaserGameRef.scale.resize(width, height);
  }

  if (persist) persistAppMode(appMode);
  if (refreshTabs) renderOfficeTabs();
  refreshRightPanelMode();

  updateTerminalContent();
  updateStatusBar();
  phaserGameRef?.events.emit('app:mode:changed', { mode: appMode, previousMode });

  if (appMode === 'serious' && selectedAgentBeforeModeSwitch && getSeriousLaunchConfig(selectedAgentBeforeModeSwitch)) {
    void openAgentTerminal(selectedAgentBeforeModeSwitch);
  }
}

function toggleAppMode(): void {
  const nextMode: AppMode = appMode === 'game' ? 'serious' : 'game';
  applyAppMode(nextMode, { persist: true, refreshTabs: true });
}

applyResponsiveLayout(computeResponsiveLayout(window.innerWidth, window.innerHeight));
window.addEventListener('resize', onWindowResize);
if (typeof window !== 'undefined') {
  window.__copilotOfficeMobileModeActive = isMobileModeActive;
}

// Spec 008-smoke: e2e debug hook. Only installed when the renderer was
// launched under the e2e harness (preload exposes window.__copilotOfficeE2E
// when process.env.COPILOT_E2E === '1'). Production launches leave
// window.__copilotOfficeDebug === undefined.
if (typeof window !== 'undefined' && window.__copilotOfficeE2E === true) {
  installE2eDebugHook();
}

function installE2eDebugHook(): void {
  const debugApi: CopilotOfficeDebugApi = {
    getActiveMode: () => appMode,
    setMode: (mode: 'game' | 'serious') => {
      if (mode === appMode) return;
      applyAppMode(mode, { persist: true, refreshTabs: true });
    },
    getCurrentOfficeId: () => officeManager.currentOfficeId,
    listAgents: () => {
      return getCurrentAgents().map((a) => ({
        id: a.id,
        name: a.name,
        tileX: a.position.x,
        tileY: a.position.y,
      }));
    },
    getActiveTerminalAgentId: () => {
      if (appMode === 'serious') {
        return seriousTerminalController?.getActiveAgentId?.() ?? null;
      }
      const scene = phaserGameRef?.scene.getScene('OfficeScene') as
        | { getTerminalOverlay?: () => { getActiveAgentId(): string | null; getIsVisible(): boolean } }
        | undefined;
      const overlay = scene?.getTerminalOverlay?.();
      if (!overlay || !overlay.getIsVisible()) return null;
      return overlay.getActiveAgentId();
    },
    openAgentTerminal: async (agentId: string) => {
      await openAgentTerminal(agentId);
    },
    closeActiveTerminal: async () => {
      if (appMode === 'serious') {
        await seriousTerminalController?.closeView({ detach: true });
        return;
      }
      const scene = phaserGameRef?.scene.getScene('OfficeScene') as
        | { getTerminalOverlay?: () => { hide(): void } }
        | undefined;
      scene?.getTerminalOverlay?.()?.hide();
    },
    switchOffice: (officeId: string) => {
      // Spec 008-smoke T12 diag: programmatically switch offices without
      // relying on tab DOM rendering, which may not have fired yet during
      // boot if onOfficesUpdated isn't wired.
    switchToOffice(officeId);
    },
    getCachedSessionMetaForRender: () => {
      // Returns the cachedSessionMeta the dashboard renderer is currently
      // using. Diagnostic for the "Untitled session" bug.
      return { ...cachedSessionMeta };
    },
    getSeriousPanelSnapshot: () => {
      if (appMode !== 'serious') return null;
      const snap = seriousTerminalController?.getPanelSnapshot?.();
      return snap ?? null;
    },
    getWarmedOfficeIds: () => autoStartCoordinator.warmedOffices.snapshot(),
    getAutoStartTerminalStartCount: () => autoStartTerminalStartCount,
    triggerAutoStartForCurrentOffice: () => autoStartCoordinator.tryWarmCurrentOffice(),
    replaceAgentSession: (officeId: string, agentId: string) =>
      autoStartCoordinator.replaceSession(officeId, agentId),
    setAutoStartEnabled: (enabled: boolean) => {
      setAgentAutoStartSettings({ autoStartKnownAgents: enabled });
    },
    getAutoStartEnabled: () => getAgentAutoStartSettings().autoStartKnownAgents,
    clearWarmedOfficeRegistry: () => {
      autoStartCoordinator.warmedOffices.clearAll();
    },
    getCurrentSessionIdForAgent: async (officeId: string, agentId: string) => {
      if (!window.copilotBridge?.getSessionId) return null;
      try {
        return await window.copilotBridge.getSessionId(officeId, agentId);
      } catch {
        return null;
      }
    },
  };
  window.__copilotOfficeDebug = debugApi;
  console.log('[main] Spec 008-smoke: __copilotOfficeDebug installed');
}

// ── Office Tabs ─────────────────────────────────────────────────

// Offices whose ui-server SDK runtime has come online (per `backend-online`).
// node-pty offices never emit that event, so getOfficeIndicator() also treats
// an office with any active agent session as online.
const onlineOffices = new Set<string>();

type OfficeIndicator = 'offline' | 'online' | 'working';

// Derive an office's top-bar indicator from its SDK-online flag + agent statuses.
// working = any agent actively thinking; online = SDK runtime up OR any agent
// session running (covers node-pty); otherwise offline.
function getOfficeIndicator(officeId: string): OfficeIndicator {
  const office = officeManager.getOffice(officeId);
  let anyActive = false;
  if (office) {
    for (const status of office.agents.values()) {
      if (status.subState === 'thinking') return 'working';
      if (status.state === 'active') anyActive = true;
    }
  }
  return onlineOffices.has(officeId) || anyActive ? 'online' : 'offline';
}

// Resolve the per-indicator visuals for a tab. `isActive` keeps the blue accent
// for the selected-but-offline office; green wins whenever the office is online.
function officeIndicatorStyles(indicator: OfficeIndicator, isActive: boolean): {
  dotColor: string; dotGlow: string; working: boolean; border: string; tabGlow: string;
} {
  if (indicator === 'working') {
    return { dotColor: '#46d17f', dotGlow: 'box-shadow: 0 0 8px #46d17f;', working: true, border: '#2f7a52', tabGlow: 'box-shadow: 0 0 10px rgba(70,209,127,.25);' };
  }
  if (indicator === 'online') {
    return { dotColor: '#46d17f', dotGlow: 'box-shadow: 0 0 6px #46d17f88;', working: false, border: '#2f7a52', tabGlow: '' };
  }
  // offline
  return {
    dotColor: isActive ? '#6d8bff' : '#4a4a68',
    dotGlow: isActive ? 'box-shadow: 0 0 8px #6d8bff;' : '',
    working: false,
    border: isActive ? '#3a3a6a' : 'transparent',
    tabGlow: '',
  };
}

// One-time injection of hover/active styles the inline CSS can't express.
// Guarded so hot-reload re-execution doesn't stack duplicate <style> tags.
function injectTopBarStyles() {
  if (document.getElementById('topbar-styles')) return;
  const style = document.createElement('style');
  style.id = 'topbar-styles';
  style.textContent = `
    #office-tabs .tabs-region {
      display: flex; align-items: center; gap: 4px;
      flex: 1; min-width: 0; overflow-x: auto; overflow-y: hidden;
      scrollbar-width: none; height: 100%;
    }
    #office-tabs .tabs-region::-webkit-scrollbar { display: none; }
    #office-tabs .ctrls-region {
      display: flex; align-items: center; gap: 6px; flex-shrink: 0;
    }
    #office-tabs .tb-divider {
      width: 1px; height: 26px; background: #2c2c46; margin: 0 4px; flex-shrink: 0;
    }
    #office-tabs .office-tab { transition: background .15s, border-color .15s, color .15s; }
    #office-tabs .office-tab:hover { background: #20203180; color: #cfcfea; }
    #office-tabs .office-tab .edit-office-btn {
      opacity: .85;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px; height: 20px;
      border-radius: 5px;
      transition: opacity .15s, background .15s, color .15s;
    }
    #office-tabs .office-tab:hover .edit-office-btn,
    #office-tabs .office-tab.active .edit-office-btn { opacity: 1; }
    #office-tabs .office-tab .edit-office-btn:hover { background: #3a3a5e; color: #fff; }
    #office-tabs[data-app-mode="serious"] #zoom-bar { display: none !important; }
    #office-tabs .office-tab .status-dot { transition: background .2s, box-shadow .2s; }
    #office-tabs .office-tab .status-dot.working { animation: office-dot-pulse 1.15s ease-in-out infinite; }
    @keyframes office-dot-pulse {
      0%, 100% { box-shadow: 0 0 4px #46d17f88; opacity: .85; }
      50%      { box-shadow: 0 0 11px #46d17f, 0 0 3px #46d17f; opacity: 1; }
    }
    #office-tabs .tb-pill { display: flex; align-items: center; transition: background .15s, border-color .15s, color .15s; }
    #office-tabs .tb-pill:hover { background: #26263e; color: #fff; }
    #office-tabs #new-office-btn:hover { background: #1c2a22; }
  `;
  document.head.appendChild(style);
}

function renderOfficeTabs() {
  const offices = officeManager.getAllOffices();
  const currentId = officeManager.currentOfficeId;

  let tabsHtml = '';

  for (const office of offices) {
    const isActive = office.id === currentId;
    const bgColor = isActive ? '#232342' : 'transparent';
    const ind = getOfficeIndicator(office.id);
    const iv = officeIndicatorStyles(ind, isActive);

    tabsHtml += `
      <div class="office-tab${isActive ? ' active' : ''}" data-office-id="${office.id}" style="
        padding: 8px 14px;
        background: ${bgColor};
        border: 1px solid ${iv.border};
        border-radius: 8px;
        cursor: pointer;
        color: ${isActive ? '#fff' : '#9a9ab8'};
        font-size: 15.5px;
        font-weight: 500;
        white-space: nowrap;
        flex-shrink: 0;
        display: flex;
        align-items: center;
        gap: 9px;
        ${iv.tabGlow}
      ">
        <span class="status-dot${iv.working ? ' working' : ''}" style="width: 7px; height: 7px; border-radius: 50%; background: ${iv.dotColor}; ${iv.dotGlow} flex-shrink: 0;"></span>
        <span>${office.name}</span>
        <span class="edit-office-btn" data-office-id="${office.id}" style="
          color: #b0b0d0;
          font-size: 14px;
        ">⚙</span>
      </div>
    `;
  }

  tabsHtml += `
    <div id="new-office-btn" style="
      padding: 8px 12px;
      margin-left: 2px;
      background: transparent;
      border: 1px dashed #2e4a3a;
      border-radius: 8px;
      cursor: pointer;
      color: #7fd6a3;
      font-size: 13px;
      font-weight: 500;
      white-space: nowrap;
      flex-shrink: 0;
    ">＋ New Office</div>
  `;

  const ctrlsHtml = `
    <div id="app-mode-toggle-btn" class="tb-pill" style="
      height: 36px;
      padding: 0 14px;
      gap: 6px;
      background: ${appMode === 'serious' ? '#241d33' : '#1e1e30'};
      border: 1px solid ${appMode === 'serious' ? '#5a3d8a' : '#2c2c46'};
      border-radius: 9px;
      cursor: pointer;
      color: ${appMode === 'serious' ? '#c9a6ff' : '#8fb7ff'};
      font-size: 13px;
      font-weight: 500;
      user-select: none;
    " title="Toggle app mode (game/serious)">
      ${appMode === 'serious' ? '🧠 Serious' : '🎮 Game'}
    </div>
    <div id="sprite-customizer-btn" class="tb-pill" style="
      height: 36px;
      min-width: 36px;
      justify-content: center;
      background: #1e1e30;
      border: 1px solid #2c2c46;
      border-radius: 9px;
      cursor: pointer;
      color: #b8b8d4;
      font-size: 16px;
      user-select: none;
    " title="Customize Player">🎨</div>
    <div id="zoom-bar" class="tb-pill" style="
      height: 36px;
      gap: 8px;
      padding: 0 12px;
      background: #1e1e30;
      border: 1px solid #2c2c46;
      border-radius: 9px;
      user-select: none;
    ">
      <button id="zoom-minus-btn" style="
        background: none;
        border: none;
        cursor: pointer;
        font-size: 15px;
        padding: 0 2px;
        color: #b8b8d4;
      ">\u2212</button>
      <input id="zoom-slider" type="range" min="50" max="200"
        value="${Math.round(currentZoom * 100)}"
        title="Zoom"
        style="width: 74px; cursor: pointer; accent-color: #6d8bff;" />
      <button id="zoom-plus-btn" style="
        background: none;
        border: none;
        cursor: pointer;
        font-size: 15px;
        padding: 0 2px;
        color: #b8b8d4;
      ">+</button>
      <span id="zoom-label" style="color: #8a8aa8; font-size: 12px; min-width: 32px; text-align: center;">${Math.round(currentZoom * 100)}%</span>
    </div>
    <div id="debug-toggle-btn" class="tb-pill" style="
      height: 36px;
      min-width: 36px;
      justify-content: center;
      background: ${debugMode ? '#3a2a1a' : '#1e1e30'};
      border: 1px solid ${debugMode ? '#ff8800' : '#2c2c46'};
      border-radius: 9px;
      cursor: pointer;
      color: ${debugMode ? '#ff8800' : '#b8b8d4'};
      font-size: 16px;
      user-select: none;
      ${debugMode ? 'box-shadow: 0 0 8px #ff880044;' : ''}
    " title="Toggle debug mode">🐛</div>
    <div id="settings-btn" class="tb-pill" style="
      height: 36px;
      min-width: 36px;
      justify-content: center;
      background: #1e1e30;
      border: 1px solid #2c2c46;
      border-radius: 9px;
      cursor: pointer;
      color: #b8b8d4;
      font-size: 16px;
      user-select: none;
    " title="Settings">⚙</div>
  `;

  const html = `
    <div class="tabs-region">${tabsHtml}</div>
    <div class="tb-divider"></div>
    <div class="ctrls-region">${ctrlsHtml}</div>
  `;

  tabsBar.innerHTML = html;

  // Keep the active office tab visible when the tab strip overflows.
  const activeTab = tabsBar.querySelector('.office-tab.active') as HTMLElement | null;
  activeTab?.scrollIntoView({ block: 'nearest', inline: 'nearest' });

  tabsBar.querySelectorAll('.office-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      if (target.classList.contains('edit-office-btn')) return;

      const officeId = (e.currentTarget as HTMLElement).dataset.officeId;
      if (officeId && officeId !== officeManager.currentOfficeId) {
        switchToOffice(officeId);
      }
    });
  });

  tabsBar.querySelectorAll('.edit-office-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const target = e.target as HTMLElement;
      const officeId = target.dataset.officeId;
      if (officeId) showOfficeSettingsPopover(officeId, target);
    });
  });

  document.getElementById('new-office-btn')?.addEventListener('click', showNewOfficeDialog);
  document.getElementById('app-mode-toggle-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleAppMode();
  });

  document.getElementById('debug-toggle-btn')?.addEventListener('click', () => {
    debugMode = !debugMode;
    phaserGameRef?.events.emit('debug:toggle', debugMode);
    renderOfficeTabs();
    // Return focus to the game so player movement isn't interrupted
    if (!isMobileModeActive()) {
      phaserGameRef?.events.emit('game:panel:clicked');
    }
    console.log(`[Debug] Debug mode ${debugMode ? 'ON' : 'OFF'}`);
  });

  // Zoom bar controls
  const zoomSlider = document.getElementById('zoom-slider') as HTMLInputElement | null;
  const zoomLabel = document.getElementById('zoom-label');
  const setZoom = (val: number) => {
    currentZoom = Math.round(Math.max(0.5, Math.min(2.0, val)) * 10) / 10;
    if (zoomSlider) zoomSlider.value = String(Math.round(currentZoom * 100));
    if (zoomLabel) zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
    try { localStorage.setItem('agencyOffice:zoomLevel', currentZoom.toFixed(2)); } catch { /* ignore */ }
    phaserGameRef?.events.emit('zoom:change', currentZoom);
  };

  zoomSlider?.addEventListener('input', (e) => {
    setZoom(parseInt((e.target as HTMLInputElement).value, 10) / 100);
  });
  document.getElementById('zoom-minus-btn')?.addEventListener('click', () => { setZoom(currentZoom - 0.1); });
  document.getElementById('zoom-plus-btn')?.addEventListener('click', () => { setZoom(currentZoom + 0.1); });

  document.getElementById('settings-btn')?.addEventListener('click', () => {
    settingsPanel.toggle();
  });

  document.getElementById('sprite-customizer-btn')?.addEventListener('click', (e) => {
    e.stopPropagation();
    const btn = document.getElementById('sprite-customizer-btn')!;
    spriteCustomizerPanel.toggle(btn);
    // Provide initial preview if panel just opened
    if (spriteCustomizerPanel.isOpen() && phaserGameRef) {
      const base64 = phaserGameRef.textures.getBase64('player');
      spriteCustomizerPanel.updatePreview(base64);
    }
  });

  applyMobileTopBarVisibility();
}

// Lightweight refresh of just the per-office online/working indicators. Avoids a
// full renderOfficeTabs() rebuild so it won't interrupt an in-progress zoom-slider
// drag or hover state when agent statuses change frequently.
function updateOfficeTabIndicators(): void {
  const currentId = officeManager.currentOfficeId;
  tabsBar.querySelectorAll<HTMLElement>('.office-tab').forEach(tab => {
    const officeId = tab.dataset.officeId;
    if (!officeId) return;
    const isActive = officeId === currentId;
    const iv = officeIndicatorStyles(getOfficeIndicator(officeId), isActive);
    tab.style.borderColor = iv.border;
    tab.style.boxShadow = iv.tabGlow ? iv.tabGlow.replace('box-shadow:', '').replace(';', '').trim() : '';
    const dot = tab.querySelector<HTMLElement>('.status-dot');
    if (dot) {
      dot.style.background = iv.dotColor;
      dot.style.boxShadow = iv.dotGlow ? iv.dotGlow.replace('box-shadow:', '').replace(';', '').trim() : '';
      dot.classList.toggle('working', iv.working);
    }
  });
}

function switchToOffice(officeId: string) {
  // Block switching while scene animations are in progress
  if (phaserGameRef?.registry.get('animating')) {
    console.log('[Office] Blocked: animation in progress');
    return;
  }

  selectedAgentId = null;
  void seriousTerminalController?.closeView({ detach: true });

  officeManager.switchOffice(officeId);
  recordOfficeAccess(officeId);
  cachedSessionMeta = getSessionMetaCacheForOffice(officeId);

  // Swap global agent roster before rendering dashboard
  syncActiveRosterForCurrentOffice();

  phaserGameRef?.events.emit('office:switch', officeId, officeManager.currentOffice?.config.workingDirectory);

  renderOfficeTabs();
  updateTerminalContent();
  updateStatusBar();

  // Re-link active viewers and re-sync statuses for the new office.
  // This recovers event flow if the previous office switch detached viewers.
  void reconnectAgentStatuses();
  fetchSessionMeta();

  // Spec 009 (US2): trigger auto-startup for the newly-selected office.
  // Non-blocking — fire-and-forget so the office switch stays snappy.
  // Coordinator's per-office WarmedOfficeRegistry guarantees no-double-spawn
  // if this office was already warmed earlier this session (FR-008).
  void autoStartCoordinator.tryWarmCurrentOffice();

  console.log(`[Office] Switched to office: ${officeManager.currentOffice?.config.name}`);
}

function showNewOfficeDialog() {
  // DOM-based dialog — prompt() is blocked in Electron
  phaserGameRef?.events.emit('settings:open');

  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: ${ZIndex.MODAL_DIALOG};
    display: flex; align-items: center; justify-content: center;
  `;

  const dialog = document.createElement('div');
  dialog.style.cssText = `
    background: #1e1e2e; border: 2px solid #4488ff; border-radius: 12px;
    padding: 24px 32px; min-width: 360px; font-family: monospace; color: #eee;
  `;
  dialog.innerHTML = `
    <h3 style="margin: 0 0 16px; color: #4488ff;">+ New Office</h3>
    <label style="display: block; margin-bottom: 4px; color: #aaa; font-size: 12px;">Office Name</label>
    <input id="nod-name" type="text" value="New Office" style="
      width: 100%; padding: 8px; margin-bottom: 12px; background: #2a2a3a; border: 1px solid #555;
      border-radius: 6px; color: #fff; font-family: monospace; box-sizing: border-box;
    " />
    <label style="display: block; margin-bottom: 4px; color: #aaa; font-size: 12px;">Working Directory</label>
    <input id="nod-path" type="text" value="." style="
      width: 100%; padding: 8px; margin-bottom: 12px; background: #2a2a3a; border: 1px solid #555;
      border-radius: 6px; color: #fff; font-family: monospace; box-sizing: border-box;
    " />
    <label style="display: block; margin-bottom: 4px; color: #aaa; font-size: 12px;">Layout</label>
    <div style="display: flex; gap: 8px; margin-bottom: 20px;">
      <button id="nod-layout-default" style="
        flex: 1; padding: 10px; background: #4488ff; border: 2px solid #4488ff; border-radius: 6px;
        color: #fff; cursor: pointer; font-family: monospace; font-size: 13px;
      ">🏢 Default</button>
      <button id="nod-layout-fleet" style="
        flex: 1; padding: 10px; background: #2a2a3a; border: 2px solid #555; border-radius: 6px;
        color: #ccc; cursor: pointer; font-family: monospace; font-size: 13px;
      ">🚀 Fleet V-Team</button>
    </div>
    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      <button id="nod-cancel" style="
        padding: 8px 20px; background: #333; border: 1px solid #555; border-radius: 6px;
        color: #aaa; cursor: pointer; font-family: monospace;
      ">Cancel</button>
      <button id="nod-create" style="
        padding: 8px 20px; background: #4488ff; border: none; border-radius: 6px;
        color: #fff; cursor: pointer; font-family: monospace; font-weight: bold;
      ">Create</button>
    </div>
  `;
  overlay.appendChild(dialog);
  document.body.appendChild(overlay);

  let selectedLayout: 'default' | 'fleet-vteam' = 'default';
  const defaultBtn = document.getElementById('nod-layout-default')!;
  const fleetBtn = document.getElementById('nod-layout-fleet')!;
  const nameInput = document.getElementById('nod-name') as HTMLInputElement;

  const selectLayout = (layout: 'default' | 'fleet-vteam') => {
    selectedLayout = layout;
    const active = layout === 'default' ? defaultBtn : fleetBtn;
    const inactive = layout === 'default' ? fleetBtn : defaultBtn;
    active.style.background = '#4488ff';
    active.style.borderColor = '#4488ff';
    active.style.color = '#fff';
    inactive.style.background = '#2a2a3a';
    inactive.style.borderColor = '#555';
    inactive.style.color = '#ccc';
    if (layout === 'fleet-vteam' && nameInput.value === 'New Office') {
      nameInput.value = 'Fleet V-Team #1';
    } else if (layout === 'default' && nameInput.value === 'Fleet V-Team #1') {
      nameInput.value = 'New Office';
    }
  };

  defaultBtn.addEventListener('click', () => selectLayout('default'));
  fleetBtn.addEventListener('click', () => selectLayout('fleet-vteam'));

  const close = () => {
    overlay.remove();
    phaserGameRef?.events.emit('settings:close');
  };
  document.getElementById('nod-cancel')!.addEventListener('click', close);
  overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });

  document.getElementById('nod-create')!.addEventListener('click', () => {
    const name = nameInput.value.trim() || 'New Office';
    const dir = (document.getElementById('nod-path') as HTMLInputElement).value.trim() || '.';
    const newOffice = officeManager.createOffice(name, dir, selectedLayout);
    close();
    renderOfficeTabs();
    updateTerminalContent();
    switchToOffice(newOffice.config.id);
    console.log(`[Office] Created new office: ${name} at ${dir} (layout: ${selectedLayout})`);
  });

  nameInput.focus();
  nameInput.select();
}

// ── Per-Office Settings Popover ────────────────────────────────
let activeOfficePopover: HTMLDivElement | null = null;

function closeOfficePopover() {
  if (activeOfficePopover) {
    activeOfficePopover.remove();
    activeOfficePopover = null;
    phaserGameRef?.events.emit('settings:close');
    // Ensure game canvas regains DOM focus
    phaserGameRef?.events.emit('game:panel:clicked');
  }
}

function showOfficeSettingsPopover(officeId: string, anchorEl: HTMLElement) {
  // Close any existing popover (with proper cleanup)
  closeOfficePopover();

  const office = officeManager.getOffice(officeId);
  if (!office) return;

  phaserGameRef?.events.emit('settings:open');

  const canDelete = office.config.id !== 'office-0';
  const popover = document.createElement('div');
  popover.className = 'office-settings-popover';
  popover.style.cssText = `
    position: absolute;
    background: #1e1e2e;
    border: 2px solid #4488ff;
    border-radius: 10px;
    padding: 16px 20px;
    min-width: 280px;
    font-family: 'Cascadia Code', Consolas, monospace;
    color: #eee;
    z-index: ${ZIndex.TOP_MODAL};
    box-shadow: 0 8px 24px rgba(0,0,0,0.5);
  `;

  const escapeHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  popover.innerHTML = `
    <div style="display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px;">
      <span style="font-size: 13px; font-weight: bold; color: #8af;">⚙ Office Settings</span>
      <button class="osp-close" style="background: none; border: none; color: #666; font-size: 16px; cursor: pointer; padding: 2px 6px;">✕</button>
    </div>
    <label style="display: block; margin-bottom: 3px; color: #889; font-size: 11px;">Name</label>
    <input class="osp-name" type="text" value="${escapeHtml(office.config.name)}" style="
      width: 100%; padding: 6px 8px; margin-bottom: 10px; background: #12121f; border: 1px solid #333;
      border-radius: 5px; color: #dde; font-family: inherit; font-size: 12px; box-sizing: border-box;
    " />
    <label style="display: block; margin-bottom: 3px; color: #889; font-size: 11px;">Working Directory</label>
    <input class="osp-path" type="text" value="${escapeHtml(office.config.workingDirectory)}" style="
      width: 100%; padding: 6px 8px; margin-bottom: 14px; background: #12121f; border: 1px solid #333;
      border-radius: 5px; color: #899; font-family: inherit; font-size: 11px; box-sizing: border-box;
    " />
    <label style="display: block; margin-bottom: 3px; color: #889; font-size: 11px;">Teams Channel Override <span style="color:#667;">(optional)</span></label>
    <input class="osp-teams" type="text" value="${escapeHtml(office.config.teamsChannelUrl ?? '')}" placeholder="Leave empty to use the default channel" style="
      width: 100%; padding: 6px 8px; margin-bottom: 14px; background: #12121f; border: 1px solid #333;
      border-radius: 5px; color: #899; font-family: inherit; font-size: 11px; box-sizing: border-box;
    " />
    <label style="display: block; margin-bottom: 3px; color: #889; font-size: 11px;">Teams Mention Override <span style="color:#667;">(optional)</span></label>
    <div style="display: flex; gap: 6px; margin-bottom: 14px;">
      <select class="osp-teams-mention-type" style="
        padding: 6px 8px; background: #12121f; border: 1px solid #333; border-radius: 5px;
        color: #899; font-family: inherit; font-size: 11px; box-sizing: border-box;
      ">
        <option value="none"${(office.config.teamsMentionType ?? 'none') === 'none' ? ' selected' : ''}>Default</option>
        <option value="tag"${office.config.teamsMentionType === 'tag' ? ' selected' : ''}>Tag</option>
        <option value="user"${office.config.teamsMentionType === 'user' ? ' selected' : ''}>User</option>
      </select>
      <input class="osp-teams-mention-value" type="text" value="${escapeHtml(office.config.teamsMentionValue ?? '')}" placeholder="Tag name / user (empty = use default)" style="
        flex: 1; padding: 6px 8px; background: #12121f; border: 1px solid #333; border-radius: 5px;
        color: #899; font-family: inherit; font-size: 11px; box-sizing: border-box;
      " />
    </div>
    <div style="display: flex; gap: 8px; justify-content: flex-end;">
      ${canDelete ? `<button class="osp-delete" style="
        padding: 5px 12px; background: #2a1a1a; border: 1px solid #633; border-radius: 5px;
        color: #f88; cursor: pointer; font-family: inherit; font-size: 11px; margin-right: auto;
      ">Delete</button>` : ''}
      <button class="osp-save" style="
        padding: 5px 14px; background: #1a1a3a; border: 1px solid #336; border-radius: 5px;
        color: #88f; cursor: pointer; font-family: inherit; font-size: 11px;
      ">💾 Save</button>
    </div>
  `;

  document.body.appendChild(popover);
  activeOfficePopover = popover;

  // Position below the anchor element
  const rect = anchorEl.getBoundingClientRect();
  popover.style.top = `${rect.bottom + 4}px`;
  popover.style.left = `${Math.max(4, rect.left - 80)}px`;

  // Bind events
  const nameInput = popover.querySelector('.osp-name') as HTMLInputElement;
  const pathInput = popover.querySelector('.osp-path') as HTMLInputElement;
  const teamsInput = popover.querySelector('.osp-teams') as HTMLInputElement;
  const teamsMentionTypeInput = popover.querySelector('.osp-teams-mention-type') as HTMLSelectElement;
  const teamsMentionValueInput = popover.querySelector('.osp-teams-mention-value') as HTMLInputElement;

  popover.querySelector('.osp-close')?.addEventListener('click', closeOfficePopover);

  popover.querySelector('.osp-save')?.addEventListener('click', () => {
    const newName = nameInput.value.trim();
    const newPath = pathInput.value.trim();
    if (newName) officeManager.updateOffice(officeId, { name: newName });
    if (newPath) officeManager.updateOffice(officeId, { workingDirectory: newPath });
    // Per-office Teams channel override (empty string clears it).
    officeManager.updateOffice(officeId, { teamsChannelUrl: teamsInput.value.trim() });
    // Per-office Teams relay @mention override (empty value falls back to the global mention).
    officeManager.updateOffice(officeId, {
      teamsMentionType: teamsMentionTypeInput.value as 'user' | 'tag' | 'none',
      teamsMentionValue: teamsMentionValueInput.value.trim(),
    });
    renderOfficeTabs();
    updateTerminalContent();
    closeOfficePopover();
  });

  popover.querySelector('.osp-delete')?.addEventListener('click', () => {
    if (!canDelete) return;
    if (confirm(`Delete office "${office.config.name}"? This cannot be undone.`)) {
      officeManager.deleteOffice(officeId);
      closeOfficePopover();
      switchToOffice('office-0');
    }
  });

  // Close on click outside
  const outsideClickHandler = (e: MouseEvent) => {
    if (activeOfficePopover && !activeOfficePopover.contains(e.target as Node)) {
      document.removeEventListener('click', outsideClickHandler, true);
      closeOfficePopover();
    }
  };
  // Delay to avoid the triggering click from closing immediately
  setTimeout(() => document.addEventListener('click', outsideClickHandler, true), 0);

  // Close on Escape
  const escHandler = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      document.removeEventListener('keydown', escHandler);
      closeOfficePopover();
    }
  };
  document.addEventListener('keydown', escHandler);

  nameInput.focus();
  nameInput.select();
}

renderOfficeTabs();

// Overview header
const overviewHeader = document.createElement('div');
overviewHeader.style.cssText = `
  padding: 14px 20px;
  background: #141424;
  border-bottom: 2px solid #2a2a4a;
  font-family: 'Cascadia Code', Consolas, monospace;
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;
overviewHeader.innerHTML = `
  <div>
    <div id="terminal-title" style="font-size: 18px; font-weight: bold; color: #8af; margin-bottom: 4px;">🏢 Office Overview</div>
    <div id="terminal-subtitle" style="font-size: 12px; color: #555;"></div>
  </div>
  <div style="display: flex; align-items: center; gap: 8px;">
    <button id="agent-sort-btn" style="
      padding: 6px 12px;
      background: ${agentSortMode === 'recent' ? '#2a3a5a' : '#252538'};
      color: ${agentSortMode === 'recent' ? '#8af' : '#666'};
      border: 1px solid ${agentSortMode === 'recent' ? '#4488ff' : '#444'};
      border-radius: 4px;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.2s;
    " title="Sort agents in this office">⇅ ${agentSortMode === 'recent' ? 'Recent' : 'Default'}</button>
    <button id="close-office-btn" style="
      display: none;
      padding: 6px 14px;
      background: #cc3344;
      color: #fff;
      border: none;
      border-radius: 4px;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    ">✕ Close Office</button>
  </div>
`;
overviewHost.appendChild(overviewHeader);

// Sort button handler — reorders agent cards in the current office
document.getElementById('agent-sort-btn')!.addEventListener('click', () => {
  agentSortMode = agentSortMode === 'default' ? 'recent' : 'default';
  try { localStorage.setItem(AGENT_SORT_STORAGE_KEY, agentSortMode); } catch { /* ignore */ }
  updateTerminalContent();
  // Re-render the sort button to reflect new state
  const sortBtn = document.getElementById('agent-sort-btn');
  if (sortBtn) {
    sortBtn.textContent = `⇅ ${agentSortMode === 'recent' ? 'Recent' : 'Default'}`;
    sortBtn.style.background = agentSortMode === 'recent' ? '#2a3a5a' : '#252538';
    sortBtn.style.color = agentSortMode === 'recent' ? '#8af' : '#666';
    sortBtn.style.borderColor = agentSortMode === 'recent' ? '#4488ff' : '#444';
  }
});

// Close Office button handler
document.getElementById('close-office-btn')!.addEventListener('click', () => {
  const currentId = officeManager.currentOfficeId;
  const office = officeManager.currentOffice;
  if (!currentId || !office) return;
  if (confirm(`Close office "${office.config.name}"? This cannot be undone.`)) {
    officeManager.deleteOffice(currentId);
    switchToOffice('office-0');
  }
});

// Overview content area
const overviewContent = document.createElement('div');
overviewContent.id = 'terminal-content';
overviewContent.style.cssText = `
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 13px;
  color: #ccc;
  position: relative;
`;
overviewHost.appendChild(overviewContent);

// Status bar
const statusBar = document.createElement('div');
statusBar.id = 'status-bar';
statusBar.style.cssText = `
  position: fixed;
  bottom: 0;
  left: 0;
  right: 0;
  height: 58px;
  background: #252538;
  border-top: 1px solid #333;
  display: flex;
  align-items: center;
  padding: 0 22px;
  font-family: monospace;
  font-size: 16px;
  color: #888;
  z-index: ${ZIndex.STATUS_BAR};
`;
document.body.appendChild(statusBar);

// ── Background Music State ───────────────────────────────────────
let bgmMuted = localStorage.getItem('copilot-office-bgm-muted') !== 'false';

function updateSpeakerIcon(_vol: number, _muted: boolean): void {
  // BGM controls moved to SettingsPanel — no top-bar DOM elements to update
}

// Sync state when music starts (in case OfficeScene restores saved state)
function onBgmStarted(state: { volume: number; muted: boolean }): void {
  bgmMuted = state.muted;
}

// ── Notifications ────────────────────────────────────────────────
const toastManager = new ToastNotificationManager(document.body);

function formatElapsed(startTime: number | null): string {
  if (!startTime) return '';
  // FR-012: live elapsed is always mm:ss (e.g. 0:07, 1:05, 12:05) so the timer
  // width is stable and the card never reflows as the value ticks.
  // formatElapsedMmSs does the (now - startTime) subtraction itself — pass the
  // raw start timestamp, not a pre-computed delta.
  return formatElapsedMmSs(startTime);
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.floor((Date.now() - timestamp) / 1000);
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds}s ago`;
  const mins = Math.floor(seconds / 60);
  if (mins < 60) return `${mins}m ago`;
  return `${Math.floor(mins / 60)}h ago`;
}

// Helper to find agent config by id
function getAgentConfig(agentId: string) {
  return getCurrentAgents().find(a => a.id === agentId) || AGENTS.find(a => a.id === agentId);
}

let seriousTerminalController: SeriousTerminalController | null = null;

function getSeriousLaunchConfig(agentId: string): {
  name: string;
  description: string;
  color?: number;
  workingDir?: string;
  launchMode?: 'copilot' | 'shell';
} | null {
  if (agentId === PC_TERMINAL_ID) {
    return {
      name: 'PC TERMINAL',
      description: 'Local Shell',
      color: 0x6f8ed8,
      workingDir: officeManager.getCurrentWorkingDirectory(),
      launchMode: 'shell',
    };
  }
  const agent = getAgentConfig(agentId);
  if (!agent) return null;
  return {
    name: agent.name,
    description: agent.description,
    color: agent.color,
    workingDir: agent.workingDir || officeManager.getCurrentWorkingDirectory(),
    launchMode: 'copilot',
  };
}

function refreshRightPanelMode(): void {
  const seriousDesktop = appMode === 'serious' && currentResponsiveLayout === 'default';
  const desiredOverviewParent = seriousDesktop ? officePanel : terminalPanel;
  if (overviewHost.parentElement !== desiredOverviewParent) {
    desiredOverviewParent.appendChild(overviewHost);
  }

  if (appMode === 'serious') {
    const seriousVisible = !!seriousTerminalController?.isVisible();
    if (seriousDesktop) {
      overviewHost.style.display = 'flex';
      terminalHost.style.display = 'flex';
      seriousPlaceholder.style.display = seriousVisible ? 'none' : 'flex';
      return;
    }

    if (seriousVisible) {
      overviewHost.style.display = 'none';
      terminalHost.style.display = 'flex';
      seriousPlaceholder.style.display = 'none';
      return;
    }

    overviewHost.style.display = 'flex';
    terminalHost.style.display = 'none';
    seriousPlaceholder.style.display = 'none';
    return;
  }

  overviewHost.style.display = 'flex';
  terminalHost.style.display = 'none';
  seriousPlaceholder.style.display = 'none';
}

/**
 * FR-010: single Done-clear entry point. Acknowledging completion only flips the
 * `completionPendingAck` flag off — it NEVER detaches or kills the session
 * (Constitution Principle III). Wired to every focus path: terminal open
 * (serious + game via `openAgentTerminal`), dashboard card select (through
 * `emitOpenTerminal`), notification click, and the in-world E interact (which
 * routes through `TerminalOverlay.show` → `acknowledgeCompletedWork`).
 */
function clearCompletionAck(agentId: string): void {
  const officeId = officeManager.currentOfficeId;
  if (!officeId) return;
  if (officeManager.acknowledgeAgentCompletion(officeId, agentId)) {
    phaserGameRef?.events.emit('agent:status:changed', agentId);
    updateStatusBar();
    updateTerminalContent();
  }
}

async function openAgentTerminal(agentId: string): Promise<void> {
  // Spec 008-smoke T10: unify "currently selected agent" across modes. Without
  // this, game-mode opens never touch selectedAgentId, so a game -> serious
  // flip loses the agent context and the serious panel never auto-attaches
  // (user-reported "locked to one agent" after flipping modes).
  selectedAgentId = agentId;

  // FR-010: focusing an agent's terminal clears its Done completion badge. This
  // covers serious-mode opens, dashboard card selects (via emitOpenTerminal),
  // and notification clicks. The in-world E interact clears via TerminalOverlay.
  clearCompletionAck(agentId);

  if (appMode === 'game') {
    phaserGameRef?.events.emit('open:agent:terminal', agentId);
    return;
  }

  const launchConfig = getSeriousLaunchConfig(agentId);
  if (!launchConfig || !window.copilotBridge) return;

  const officeId = officeManager.currentOfficeId || 'office-0';
  const officeStatus = officeManager.getAgentStatus(officeId, agentId);
  if (officeStatus?.state === 'slacking') {
    officeManager.setAgentStarting(officeId, agentId);
    phaserGameRef?.events.emit('agent:status:changed', agentId);
    updateStatusBar();
    updateTerminalContent();
  }

  await seriousTerminalController?.openAgentTerminal({
    officeId,
    agentId,
    ...launchConfig,
  });
  refreshRightPanelMode();
}

seriousTerminalController = new SeriousTerminalController(terminalHost, {
  onClose: () => {
    selectedAgentId = null;
    refreshRightPanelMode();
    updateStatusBar();
    updateTerminalContent();
  },
  onOverlayOpen: () => { phaserGameRef?.events.emit('settings:open'); },
  onOverlayClose: () => { phaserGameRef?.events.emit('settings:close'); },
});

// Spec 009 e2e diag: count how many times the auto-start headless warm
// helper invoked terminalStart. Used by tests/e2e/auto-startup.e2e.ts
// scenarios A3 (second-visit no respawn) and A7 (double-click coalescing).
let autoStartTerminalStartCount = 0;

// ── Spec 009: auto-startup of known agents ──────────────────────
// Headless PTY warm helper — spawns/reattaches the agent's PTY via the
// existing terminalStart bridge WITHOUT mutating selectedAgentId, emitting
// open:agent:terminal (which would pop the overlay in game mode), or
// routing through seriousTerminalController.openAgentTerminal. The
// status-badge transitions still flow through the existing per-agent
// status event channel which the dashboard subscribes to regardless of
// overlay state. (research.md §R5)
/** Warm (spawn/reattach) an agent's terminal session. Returns true only if a
 *  session was actually requested and the server reported success — callers
 *  that gate one-shot/retry logic (warmAllTeamsBoundAgents) rely on this so a
 *  no-op early-return or a soft `success:false` isn't mistaken for a real warm. */
async function warmAgentSession(
  officeId: string,
  agentId: string,
  fallback?: { workingDir: string; launchMode: 'copilot' | 'shell' },
): Promise<boolean> {
  if (!window.copilotBridge) return false;
  // getSeriousLaunchConfig resolves against the CURRENT office's active roster
  // and defaults workingDir to the current office's cwd, so it is only valid
  // for the current office. Crucially, default-layout agent IDs (generalist /
  // debugger / admin) are reused across offices, so calling it for a
  // non-current office would silently warm that binding with the WRONG working
  // directory. For any non-current office we therefore ignore it and rely on
  // the caller's fallback (the persisted Teams binding's authoritative dir).
  const isCurrentOffice = officeId === officeManager.currentOfficeId;
  const launchConfig = isCurrentOffice ? getSeriousLaunchConfig(agentId) : null;
  const workingDir = launchConfig?.workingDir ?? fallback?.workingDir;
  const launchMode = launchConfig?.launchMode ?? fallback?.launchMode ?? 'copilot';
  if (!workingDir) return false;
  // Surface the "starting" transition on the badge (FR-004). Same call the
  // manual openAgentTerminal path makes; safe to repeat — the office status
  // map tolerates idempotent transitions.
  const officeStatus = officeManager.getAgentStatus(officeId, agentId);
  if (officeStatus?.state === 'slacking') {
    officeManager.setAgentStarting(officeId, agentId);
    phaserGameRef?.events.emit('agent:status:changed', agentId);
    updateStatusBar();
    updateTerminalContent();
  }
  autoStartTerminalStartCount += 1;
  const res = await window.copilotBridge.terminalStart(
    officeId,
    agentId,
    workingDir,
    undefined,
    undefined,
    undefined,
    launchMode,
  );
  return res?.success !== false;
}

/** Cold-warm one-shot state — see warmAllTeamsBoundAgents. */
let teamsColdWarmDone = false;
let teamsColdWarmInFlight = false;
let teamsColdWarmAttempts = 0;
const TEAMS_COLD_WARM_MAX_ATTEMPTS = 5;
const TEAMS_COLD_WARM_RETRY_MS = 1500;

/** Re-arm a bounded cold-warm retry (used when the Teams service isn't ready
 *  yet, so an empty/failed status fetch doesn't permanently skip cold warm). */
function scheduleTeamsColdWarmRetry(): void {
  if (teamsColdWarmDone) return;
  if (teamsColdWarmAttempts >= TEAMS_COLD_WARM_MAX_ATTEMPTS) return;
  setTimeout(() => { void warmAllTeamsBoundAgents(); }, TEAMS_COLD_WARM_RETRY_MS);
}

/**
 * Cold-launch: warm the terminal session for EVERY persisted Teams-bound agent,
 * regardless of which office is currently in view. The per-office reconnect
 * (reconnectAgentStatuses) only warms bindings in the current office, so bound
 * agents in other offices would otherwise stay offline until the user manually
 * switched to their tab — defeating the office-agnostic Teams "online agents"
 * list. Warming spawns (or reattaches to) each binding's PTY so the main-process
 * TeamsService.reconcile() can re-online it and post its thread "reconnected"
 * notice. Server-side dedup guarantees no second PTY if one is already alive.
 *
 * Runs at most once successfully per app session (teamsColdWarmDone). The flag
 * is committed ONLY after at least one binding actually warms — because the
 * renderer's cold-boot trigger (onOfficesUpdated) can race the async
 * TeamsService.start() bindings load, neither an empty result nor an all-failed
 * warm pass may lock out cold warm. Empty/failed passes leave the flag false and
 * re-arm a bounded retry so a slow or transiently-down service is still caught,
 * while a genuinely empty binding list simply exhausts the retry budget cheaply.
 * teamsColdWarmInFlight prevents overlapping passes.
 */
async function warmAllTeamsBoundAgents(): Promise<void> {
  if (teamsColdWarmDone || teamsColdWarmInFlight) return;
  if (!window.copilotBridge?.teamsStatus) return;
  teamsColdWarmInFlight = true;
  teamsColdWarmAttempts += 1;
  try {
    const teamsRes = await window.copilotBridge.teamsStatus();
    if (!teamsRes?.success || !Array.isArray(teamsRes.bindings)) {
      scheduleTeamsColdWarmRetry();
      return;
    }
    const bindings = teamsRes.bindings as Array<{
      officeId: string;
      agentId: string;
      workingDir?: string;
    }>;
    if (bindings.length === 0) {
      // Could be genuinely empty OR the service hasn't finished loading its
      // persisted bindings yet — retry (bounded) before giving up.
      scheduleTeamsColdWarmRetry();
      return;
    }
    const results = await Promise.all(
      bindings.map(async (b) => {
        try {
          return await warmAgentSession(
            b.officeId,
            b.agentId,
            b.workingDir
              ? {
                  workingDir: b.workingDir,
                  // A raw shell can't be Teams-bound (nothing to resume), but
                  // guard defensively so PC_TERMINAL never resumes as copilot.
                  launchMode: b.agentId === PC_TERMINAL_ID ? 'shell' : 'copilot',
                }
              : undefined,
          );
        } catch (err) {
          console.warn(
            `[Teams] cold-launch warm failed for ${b.officeId}/${b.agentId}:`,
            err,
          );
          return false;
        }
      }),
    );
    if (!results.some(Boolean)) {
      // No binding actually warmed — a soft `success:false`, a missing
      // workingDir, or a transiently-down terminal server. Do NOT burn the
      // one-shot; re-arm a bounded retry so a recovered server is caught.
      scheduleTeamsColdWarmRetry();
      return;
    }
    // At least one binding warmed — commit the one-shot so a later trigger
    // can't warm again this session.
    teamsColdWarmDone = true;
    // Poke the Teams service to reconcile now so re-onlined bindings and their
    // thread "reconnected" notices surface promptly instead of on the next tick.
    try {
      await window.copilotBridge.teamsReconcile?.();
    } catch { /* best-effort */ }
    void refreshTeamsDashboardState();
  } catch (e) {
    console.warn('[Teams] warmAllTeamsBoundAgents failed:', e);
    scheduleTeamsColdWarmRetry();
  } finally {
    teamsColdWarmInFlight = false;
  }
}

function buildCanonicalAgentIdsForOffice(officeId: string): string[] {
  // For the current office the synced roster is the source of truth (it
  // reflects swapActiveAgents + customAgents + customReserveAgents). For
  // other offices we fall back to the layout's agent list + customAgents.
  // Fleet sub-agents are not part of any office's agent list (they are
  // tracked separately by FleetTracker), so this naturally satisfies
  // FR-020. PC_TERMINAL_ID is a shell — exclude it because it has no
  // persisted copilot session uuid we'd want to resume.
  const office = officeManager.currentOfficeId === officeId
    ? officeManager.currentOffice
    : null;
  if (office && officeManager.currentOfficeId === officeId) {
    return getCurrentAgents().map((a) => a.id);
  }
  // Fallback: read the office's configured roster directly.
  const layoutKey = officeManager.currentOffice?.config.layout ?? 'default';
  const layoutAgents = getLayout(layoutKey).agents.map((a) => a.id);
  const customIds = (officeManager.currentOffice?.config.customAgents ?? []).map(
    (a) => a.id,
  );
  return Array.from(new Set([...layoutAgents, ...customIds]));
}

const autoStartCoordinator = new AutoStartCoordinator({
  getCurrentOfficeId: () => officeManager.currentOfficeId,
  getCanonicalAgentIds: (oid) => buildCanonicalAgentIdsForOffice(oid),
  getSessionMeta: async (oid) => {
    // Always fetch fresh from the bridge — cachedSessionMeta in main.ts
    // is hydrated by an unawaited fetchSessionMeta() so it races our
    // cold-launch trigger.
    if (!window.copilotBridge?.getAllSessionMeta) {
      return officeManager.currentOfficeId === oid
        ? cachedSessionMeta
        : getSessionMetaCacheForOffice(oid);
    }
    try {
      const fresh = await window.copilotBridge.getAllSessionMeta(oid);
      return fresh || {};
    } catch {
      return officeManager.currentOfficeId === oid
        ? cachedSessionMeta
        : getSessionMetaCacheForOffice(oid);
    }
  },
  getCurrentSessionId: async (oid, aid) => {
    if (!window.copilotBridge?.getSessionId) return null;
    try {
      return await window.copilotBridge.getSessionId(oid, aid);
    } catch {
      return null;
    }
  },
  getAgentLaunchConfig: (_oid, aid) => {
    const cfg = getSeriousLaunchConfig(aid);
    return {
      workingDir: cfg?.workingDir ?? officeManager.getCurrentWorkingDirectory(),
      launchMode: cfg?.launchMode ?? 'copilot',
    };
  },
  resetSession: async (oid, aid) => {
    if (!window.copilotBridge) return;
    await window.copilotBridge.resetSession(oid, aid);
  },
  warmAgentSession: async (oid, aid) => {
    await warmAgentSession(oid, aid);
  },
  getSettings: () => getAgentAutoStartSettings(),
});

// T503/T504: expose for UI handleNewSession delegation.
setAutoStartCoordinator(autoStartCoordinator);

const notificationService = new NotificationService(
  toastManager,
  (agentId) => {
    const agent = getAgentConfig(agentId);
    if (!agent) return undefined;
    return { name: agent.name, color: agent.color };
  },
  (agentId) => {
    selectedAgentId = agentId;
    const oId = officeManager.currentOfficeId;
    if (oId) officeManager.clearUnread(oId, agentId);
    updateTerminalContent();
    void openAgentTerminal(agentId);
  },
);

/** Send a notification (also increments unread count). */
function notifyAgent(agentId: string, eventType: import('./config/notifications').NotificationEventType, context?: { toolName?: string }) {
  const officeId = officeManager.currentOfficeId;
  if (officeId) {
    // Build a short label for the unread badge
    const agent = getAgentConfig(agentId);
    const label = agent ? agent.name : agentId;
    officeManager.incrementUnread(officeId, agentId, label);
  }
  notificationService.notify(agentId, eventType, context, selectedAgentId);
}


const teamsSettingsOverlay = new TeamsSettingsOverlay({
  onOpen: () => { phaserGameRef?.events.emit('settings:open'); },
  onClose: () => { phaserGameRef?.events.emit('settings:close'); },
  onSaved: () => { void refreshTeamsDashboardState(); },
});

const settingsPanel = new SettingsPanel(
  notificationService,
  {
    onBgmVolumeChange: (vol) => {
      updateSpeakerIcon(vol, bgmMuted);
      phaserGameRef?.events.emit('bgm:volume', vol);
    },
    onBgmMuteChange: (muted) => {
      updateSpeakerIcon(parseFloat(localStorage.getItem('copilot-office-bgm-volume') ?? '0.5'), muted);
      phaserGameRef?.events.emit('bgm:mute', muted);
    },
    getBgmMuted: () => bgmMuted,
    setBgmMuted: (muted) => { bgmMuted = muted; },
    onOpen: () => {
      phaserGameRef?.events.emit('settings:open');
    },
    onClose: () => {
      phaserGameRef?.events.emit('settings:close');
    },
    onOpenTeamsSettings: () => { void teamsSettingsOverlay.open(); },
  },
);

// ── Sprite Customizer ────────────────────────────────────────────
const spriteCustomizerPanel = new SpriteCustomizerPanel({
  onColorsChanged: (colors) => {
    const scene = phaserGameRef?.scene.getScene('OfficeScene');
    if (scene) {
      regeneratePlayerSprite(scene, colors);
      const base64 = scene.textures.getBase64('player');
      spriteCustomizerPanel.updatePreview(base64);
    }
  },
  // Route focus through InputManager: reuse the settings:open / settings:close
  // bus that OfficeScene already wires to suspendGameInput / resumeGameInput.
  onOpen: () => {
    phaserGameRef?.events.emit('settings:open');
  },
  onClose: () => {
    phaserGameRef?.events.emit('settings:close');
  },
});

// ── Terminal Content Updates ────────────────────────────────────

let lastTerminalContentHtml = '';
let lastStatusBarHtml = '';
let cachedSessionMeta: Record<string, SessionMetaSnapshot> = {};

// ── Teams Remote (011) dashboard state ──────────────────────────
// Cached so the synchronous dashboard renderer can gate the per-tile
// "Teams Remote" button on the feature flag + per-agent online state.
let teamsFeatureEnabled = false;
const teamsOnlineAgentIds = new Set<string>();
/** All agent ids with a Teams binding (online or pending reconnect) for the current office. */
const teamsBoundAgentIds = new Set<string>();

/** Refresh the cached Teams feature flag + online set, then re-render if changed. */
async function refreshTeamsDashboardState(): Promise<void> {
  if (!window.copilotBridge?.teamsGetSettings) return;
  try {
    const settingsRes = await window.copilotBridge.teamsGetSettings();
    teamsFeatureEnabled = !!(settingsRes?.success && (settingsRes.settings as { enabled?: boolean })?.enabled);
    const statusRes = await window.copilotBridge.teamsStatus();
    teamsOnlineAgentIds.clear();
    teamsBoundAgentIds.clear();
    if (statusRes?.success) {
      for (const b of statusRes.bindings as Array<{ agentId: string; online: boolean }>) {
        teamsBoundAgentIds.add(b.agentId);
        if (b.online) teamsOnlineAgentIds.add(b.agentId);
      }
    }
  } catch { /* leave caches as-is */ }
  updateTerminalContent();
}

/**
 * Ask the Teams service to reconcile, debounced. Called when a Teams-bound agent
 * finishes starting (becomes ready) so the service re-onlines it — and posts its
 * thread "reconnected" notice — promptly, instead of waiting for the periodic tick.
 */
let teamsReconcileTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleTeamsReconcile(): void {
  if (teamsReconcileTimer) return;
  teamsReconcileTimer = setTimeout(() => {
    teamsReconcileTimer = null;
    void (async () => {
      try {
        await window.copilotBridge.teamsReconcile?.();
      } catch { /* best-effort */ }
      void refreshTeamsDashboardState();
    })();
  }, 300);
}

/** Toggle an agent online/offline in Teams from an overview dashboard tile. */
async function toggleTeamsRemoteFromOverview(agentId: string): Promise<void> {
  if (!window.copilotBridge?.teamsRegister) return;
  const officeId = officeManager.currentOfficeId || 'office-0';
  if (teamsOnlineAgentIds.has(agentId)) {
    await window.copilotBridge.teamsStop({ officeId, agentId });
    teamsOnlineAgentIds.delete(agentId);
    updateTerminalContent();
    return;
  }
  const agent = getSeriousLaunchConfig(agentId);
  if (!agent) return;
  const office = officeManager.getOffice(officeId)?.config;
  const officeChannelUrl = office?.teamsChannelUrl;
  const res = await window.copilotBridge.teamsRegister({
    officeId,
    agentId,
    displayName: agent.name,
    workingDir: agent.workingDir || officeManager.getCurrentWorkingDirectory(),
    officeChannelUrl,
    officeMentionType: office?.teamsMentionType,
    officeMentionValue: office?.teamsMentionValue,
  });
  if (res?.success) {
    teamsOnlineAgentIds.add(agentId);
    updateTerminalContent();
  } else if (res?.error === 'no-channel') {
    void teamsSettingsOverlay.open('No Teams channel is configured. Add a default channel link to bring agents online.');
  } else if (res?.error) {
    showClipboardToast(`Teams: ${res.error}`, 'error');
  }
}


// Fetch session meta from backend (fire-and-forget, updates cache + UI)
function fetchSessionMeta() {
  const officeId = officeManager.currentOfficeId || 'office-0';
  const cached = getSessionMetaCacheForOffice(officeId);
  if (Object.keys(cached).length > 0) {
    cachedSessionMeta = cached;
    updateTerminalContent();
  }
  if (!window.copilotBridge?.getAllSessionMeta) return;
  window.copilotBridge.getAllSessionMeta(officeId).then(meta => {
    cachedSessionMeta = meta || {};
    setSessionMetaCacheForOffice(officeId, cachedSessionMeta);
    updateTerminalContent();
  }).catch(() => {});
}

function updateTerminalContent() {
  scheduleTerminalContentUpdate();
}

function updateTerminalContentNow() {
  syncActiveRosterForCurrentOffice();
  const agentTools = getCurrentAgentTools();
  const office = officeManager.currentOffice;

  // Show/hide Close Office button (hidden for Main Office at index 0)
  const closeBtn = document.getElementById('close-office-btn') as HTMLButtonElement | null;
  if (closeBtn) {
    const allOffices = officeManager.getAllOffices();
    const isMainOffice = office && allOffices.length > 0 && allOffices[0].id === office.config.id;
    closeBtn.style.display = (!office || isMainOffice) ? 'none' : 'inline-block';
  }

  // Update subtitle
  const subtitle = document.getElementById('terminal-subtitle');
  if (subtitle) {
    subtitle.textContent = office
      ? `${office.config.name}  ·  ${office.config.workingDirectory}`
      : 'No office selected';
  }

  // Delegate card rendering to the layout-specific dashboard renderer
  const layout = getLayout(getCurrentLayout());
  const html = layout.dashboard.renderCards({
    agents: sortAgentsByMode(layout.agents, office || null),
    office: office || null,
    selectedAgentId,
    cachedSessionMeta,
    agentTools,
    formatElapsed,
    formatRelativeTime,
    teamsEnabled: teamsFeatureEnabled,
    teamsOnlineAgentIds,
  });

  if (html !== lastTerminalContentHtml) {
    lastTerminalContentHtml = html;
    overviewContent.innerHTML = html;
  }
  drawOverviewSprites();
  if (appMode === 'serious') {
    seriousTerminalController?.refreshCardFromOverview();
  }
}

function updateStatusBar() {
  scheduleStatusBarUpdate();
}

function clearOverviewSpriteRetry(): void {
  if (overviewSpriteRetryTimer) {
    clearTimeout(overviewSpriteRetryTimer);
    overviewSpriteRetryTimer = null;
  }
}

function drawCachedOverviewSprite(canvas: HTMLCanvasElement, textureKey: string): boolean {
  const dataUrl = overviewSpriteCache[textureKey];
  if (!dataUrl) return false;

  let img = overviewSpriteImageCache.get(textureKey);
  if (!img || img.src !== dataUrl) {
    img = new Image();
    img.src = dataUrl;
    overviewSpriteImageCache.set(textureKey, img);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return true;

  const drawNow = () => {
    if (!img) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  };

  if (!img.complete || img.naturalWidth === 0) {
    img.onload = () => drawNow();
    return true;
  }

  drawNow();
  return true;
}

function updateOverviewSpriteCacheFromCanvas(canvas: HTMLCanvasElement, textureKey: string): void {
  try {
    const dataUrl = canvas.toDataURL('image/png');
    if (overviewSpriteCache[textureKey] !== dataUrl) {
      overviewSpriteCache = { ...overviewSpriteCache, [textureKey]: dataUrl };
      saveOverviewSpriteCache(overviewSpriteCache);
      const img = new Image();
      img.src = dataUrl;
      overviewSpriteImageCache.set(textureKey, img);
    }
  } catch {
    // ignore cache write failures
  }
}

function drawTextureToOverviewCanvas(canvas: HTMLCanvasElement, textureKey: string): boolean {
  if (!phaserGameRef) {
    return drawCachedOverviewSprite(canvas, textureKey);
  }
  const texture = phaserGameRef.textures.get(textureKey);
  if (!texture || texture.key === '__MISSING') {
    return drawCachedOverviewSprite(canvas, textureKey);
  }
  const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
  if (!source) {
    return drawCachedOverviewSprite(canvas, textureKey);
  }

  const ctx = canvas.getContext('2d');
  if (!ctx) return true;

  const sourceWidth = source instanceof HTMLImageElement
    ? (source.naturalWidth || source.width)
    : source.width;
  const sourceHeight = source instanceof HTMLImageElement
    ? (source.naturalHeight || source.height)
    : source.height;

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  if (sourceWidth > canvas.width || sourceHeight > canvas.height) {
    // Sprite textures are sheets; crop the top-left frame to avoid tiny full-sheet downscales.
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height, 0, 0, canvas.width, canvas.height);
  } else {
    ctx.drawImage(source, 0, 0);
  }
  updateOverviewSpriteCacheFromCanvas(canvas, textureKey);
  return true;
}

function prewarmOverviewSpriteCacheFromTextures(): void {
  if (!phaserGameRef) return;

  const textureKeys = getCurrentAgents().map(agent => agent.sprite);
  if (!textureKeys.includes('desktop_pc')) textureKeys.push('desktop_pc');

  for (const textureKey of textureKeys) {
    const texture = phaserGameRef.textures.get(textureKey);
    if (!texture || texture.key === '__MISSING') continue;
    const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement | undefined;
    if (!source) continue;

    const scratch = document.createElement('canvas');
    scratch.width = textureKey === 'desktop_pc' ? 32 : 32;
    scratch.height = textureKey === 'desktop_pc' ? 32 : 34;
    const ctx = scratch.getContext('2d');
    if (!ctx) continue;

    const sourceWidth = source instanceof HTMLImageElement
      ? (source.naturalWidth || source.width)
      : source.width;
    const sourceHeight = source instanceof HTMLImageElement
      ? (source.naturalHeight || source.height)
      : source.height;

    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, scratch.width, scratch.height);
    if (sourceWidth > scratch.width || sourceHeight > scratch.height) {
      ctx.drawImage(source, 0, 0, scratch.width, scratch.height, 0, 0, scratch.width, scratch.height);
    } else {
      ctx.drawImage(source, 0, 0);
    }
    updateOverviewSpriteCacheFromCanvas(scratch, textureKey);
  }
}

function drawOverviewSprites(attempt = 0): void {
  clearOverviewSpriteRetry();

  requestAnimationFrame(() => {
    let missingTexture = false;

    for (const agent of getCurrentAgents()) {
      const canvas = document.getElementById(`overview-sprite-${agent.id}`) as HTMLCanvasElement | null;
      if (!canvas) continue;
      const drawn = drawTextureToOverviewCanvas(canvas, agent.sprite);
      if (!drawn) missingTexture = true;
    }

    const pcCanvas = document.getElementById('overview-sprite-pc-terminal') as HTMLCanvasElement | null;
    if (pcCanvas) {
      const drawn = drawTextureToOverviewCanvas(pcCanvas, 'desktop_pc');
      if (!drawn) missingTexture = true;
    }

    if (missingTexture && phaserGameRef && attempt < OVERVIEW_SPRITE_MAX_RETRY_ATTEMPTS) {
      overviewSpriteRetryTimer = setTimeout(() => {
        drawOverviewSprites(attempt + 1);
      }, OVERVIEW_SPRITE_RETRY_DELAY_MS);
    }
  });
}

function setupTerminalClickHandler() {
  overviewHost.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const layout = getLayout(getCurrentLayout());

    // Handle session meta panel interactions (prevent card open)
    const metaPanel = target.closest('.session-meta-panel');
    if (metaPanel) {
      e.stopPropagation();
      const agentId = (metaPanel as HTMLElement).dataset.agent;
      if (!agentId) return;
      // Session-id badge: click-to-copy short-circuits before delegating to
      // the layout handler so we never accidentally route copy clicks into
      // edit/new-session/close-session.
      const idBadge = target.closest('.session-id-badge') as HTMLElement | null;
      if (idBadge) {
        const fullId = idBadge.dataset.sessionId ?? idBadge.textContent?.trim() ?? '';
        if (fullId) {
          void navigator.clipboard?.writeText(fullId).catch(() => {});
          // Brief visual ack: swap text → "copied!" → restore after 700ms.
          const original = idBadge.textContent;
          idBadge.textContent = '✓ copied';
          setTimeout(() => { if (idBadge) idBadge.textContent = original; }, 700);
        }
        return;
      }
      layout.clickHandler.handleMetaPanelClick(target, agentId, {
        startSessionMetaEdit,
        startNewSession: (id) => { void startSessionFromOverview(id); },
        closeSession: (id) => { void closeSessionFromOverview(id); },
        toggleTeamsRemote: (id) => { void toggleTeamsRemoteFromOverview(id); },
      });
      return;
    }

    const card = target.closest('.agent-card');
    if (card) {
      const agentId = (card as HTMLElement).dataset.agent ?? null;
      if (!agentId) return;
      layout.clickHandler.handleCardClick(agentId, {
        setSelectedAgent: (id) => { selectedAgentId = id; },
        clearUnread: (id) => {
          const officeId = officeManager.currentOfficeId;
          if (officeId) officeManager.clearUnread(officeId, id);
        },
        updateContent: updateTerminalContent,
        emitOpenTerminal: (id) => { void openAgentTerminal(id); },
      });
    }
  });
}

async function startSessionFromOverview(agentId: string): Promise<void> {
  if (!window.copilotBridge) return;
  const officeId = officeManager.currentOfficeId || 'office-0';
  const launchConfig = getSeriousLaunchConfig(agentId);
  if (!launchConfig) return;

  cachedSessionMeta[agentId] = { title: '' };
  setSessionMetaCacheForOffice(officeId, cachedSessionMeta);
  updateTerminalContent();

  try {
    if (appMode === 'serious' && seriousTerminalController) {
      await seriousTerminalController.startNewSession({
        officeId,
        agentId,
        ...launchConfig,
      });
    } else {
      await window.copilotBridge.resetSession(officeId, agentId);
      await window.copilotBridge.terminalStart(
        officeId,
        agentId,
        launchConfig.workingDir,
        undefined,
        undefined,
        undefined,
        launchConfig.launchMode,
      );
    }
  } catch (error) {
    console.warn(`[Office] Failed to start new session from overview for ${agentId}:`, error);
  }

  officeManager.setAgentStarting(officeId, agentId);
  phaserGameRef?.events.emit('agent:status:changed', agentId);
  updateStatusBar();
  updateTerminalContent();
}

/** Dashboard "Close Session" button: deliberate close, no auto-restart
 * (FR-013). Distinct from "New Session" which closes+restarts. */
async function closeSessionFromOverview(agentId: string): Promise<void> {
  if (!window.copilotBridge) return;
  const officeId = officeManager.currentOfficeId || 'office-0';
  try {
    await window.copilotBridge.resetSession(officeId, agentId);
  } catch (error) {
    console.warn(`[Office] Failed to close session from overview for ${agentId}:`, error);
    return;
  }
  // Optimistic local state — the server's status event will reconcile.
  const meta = cachedSessionMeta[agentId];
  if (meta) {
    cachedSessionMeta[agentId] = { ...meta, sessionId: undefined };
    setSessionMetaCacheForOffice(officeId, cachedSessionMeta);
  }
  officeManager.setAgentSlacking(officeId, agentId);
  phaserGameRef?.events.emit('agent:status:changed', agentId);
  updateStatusBar();
  updateTerminalContent();
}

function startSessionMetaEdit(agentId: string) {
  const panel = overviewHost.querySelector(`.session-meta-panel[data-agent="${agentId}"]`);
  if (!panel) return;

  const meta = cachedSessionMeta[agentId] || { title: '' };
  const titleEl = panel.querySelector('.session-title-display') as HTMLElement | null;

  if (titleEl) {
    replaceWithInput(titleEl, meta.title, 'Session title...', 80, async (value) => {
      const officeId = officeManager.currentOfficeId || 'office-0';
      await window.copilotBridge.setSessionMeta(officeId, agentId, { title: value });
      cachedSessionMeta[agentId] = { title: value };
      setSessionMetaCacheForOffice(officeId, cachedSessionMeta);
      updateTerminalContent();
    });
  }
}

function replaceWithInput(
  el: HTMLElement,
  currentValue: string,
  placeholder: string,
  maxLength: number,
  onSave: (value: string) => Promise<void>
) {
  // Don't double-activate
  if (el.querySelector('input')) return;

  const input = document.createElement('input');
  input.type = 'text';
  input.value = currentValue;
  input.placeholder = placeholder;
  input.maxLength = maxLength;
  input.style.cssText = `
    width: 100%; background: #1a1a30; border: 1px solid #4a4a7a;
    color: #dde; font-size: ${el.style.fontSize || '12px'};
    font-family: inherit; padding: 2px 4px; border-radius: 3px;
    outline: none; box-sizing: border-box;
  `;

  const originalContent = el.innerHTML;
  el.innerHTML = '';
  el.appendChild(input);
  input.focus();
  input.select();

  let saved = false;
  const save = async () => {
    if (saved) return;
    saved = true;
    const value = input.value.trim();
    if (value !== currentValue) {
      await onSave(value);
    } else {
      el.innerHTML = originalContent;
    }
  };

  input.addEventListener('blur', save);
  input.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Enter') {
      input.blur();
    } else if (e.key === 'Escape') {
      saved = true;
      el.innerHTML = originalContent;
    }
  });
}

function stopInteraction() {
  updateTerminalContent();
  updateStatusBar();
}

// ── Copilot Event Handlers ────────────────────────────────────────

if (window.copilotBridge) {

  // Sync the persisted YOLO flag to the PTY server before any terminal launches,
  // so new copilot sessions reflect the saved setting from cold boot.
  window.copilotBridge.setYolo?.(isYoloEnabled());

  // Sync the persisted additional-parameters string for the same reason.
  window.copilotBridge.setAdditionalParams?.(getActiveAdditionalParams());

  window.copilotBridge.onCopilotToolStart((agentId, toolName, toolId, status) => {
    console.log(`[Office] Tool start: ${agentId} - ${toolName} - ${status}`);

    const officeId = officeManager.currentOfficeId;
    if (!officeId) return;

    // Guard: ignore events while agent is still starting (stale events from startup)
    const current = officeManager.getAgentStatus(officeId, agentId);
    if (current?.subState === 'starting') {
      console.log(`[Office] Ignoring tool_start for ${agentId} — still in starting state`);
      return;
    }

    const agentTools = getCurrentAgentTools();

    if (!agentTools.has(agentId)) {
      agentTools.set(agentId, []);
    }
    // FR-004: idempotent tool set — a duplicate/replayed tool_start for the same
    // toolId must not stack a second entry, or the resolved status would never
    // clear once its single completion arrives.
    const startResult = addActiveTool(agentTools.get(agentId)!, { toolId, name: toolName, status });
    if (!startResult.added) {
      console.log(`[Office] Ignoring duplicate tool_start for ${agentId} — toolId ${toolId} already active`);
      return;
    }
    agentTools.set(agentId, startResult.tools);

    // Track in recent actions history
    officeManager.pushRecentAction(officeId, agentId, toolName, 'started');
    // Persist last-activity time so the 'recent' agent sort survives restarts.
    recordAgentActivity(officeId, agentId);
    // Use tool status as task summary context
    if (status) {
      officeManager.setTaskSummary(officeId, agentId, status);
    }

    // Update agent status based on tool type
    if (isAskUserTool(toolName, status)) {
      officeManager.setAgentWaiting(officeId, agentId, 'ask_user');
      console.log(`[Office] Status: ${agentId} → waiting (ask_user)`);
      notifyAgent(agentId, 'askUser');
    } else {
      officeManager.setAgentThinking(officeId, agentId, `${toolName}`, 'tool_start');
      console.log(`[Office] Status: ${agentId} → thinking (${toolName})`);
      notifyAgent(agentId, 'toolStart', { toolName });
    }

    phaserGameRef?.events.emit('agent:tool:start', agentId, toolName, status);

    updateTerminalContent();
    updateStatusBar();
  });

  window.copilotBridge.onCopilotToolComplete((agentId, toolId, _success) => {
    console.log(`[Office] Tool complete: ${agentId} - ${toolId}`);

    const officeId = officeManager.currentOfficeId;
    if (!officeId) return;
    const agentTools = getCurrentAgentTools();

    const tools = agentTools.get(agentId);
    if (tools) {
      // FR-004: ignore completions for a toolId we never tracked (stale, replayed,
      // or out-of-order event). Acting on it would fire a phantom completion
      // notification and recompute status off a tool set that never changed.
      const completeResult = removeCompletedTool(tools, toolId);
      if (!completeResult.completed) {
        console.log(`[Office] Ignoring tool_complete for ${agentId} — unknown toolId ${toolId}`);
        return;
      }
      const completedToolName = completeResult.completed.name || 'tool';
      const remaining = completeResult.tools;
      agentTools.set(agentId, remaining);

      // Track last completed action + recent actions history
      officeManager.setLastCompletedAction(officeId, agentId, completedToolName);
      officeManager.pushRecentAction(officeId, agentId, completedToolName, 'completed');
      notifyAgent(agentId, 'toolComplete', { toolName: completedToolName });

      // Update status based on remaining tools. Uses `nextSubStateAfterToolComplete`
      // to centralize the ask_user race-guard — see src/util/toolStatus.ts.
      const next = nextSubStateAfterToolComplete(remaining);
      if (next.kind === 'idle') {
        // Keep thinking while a turn is still settling; turn_end/sync will mark ready.
        const currentStatus = officeManager.getAgentStatus(officeId, agentId);
        if (currentStatus?.subState === 'thinking') {
          officeManager.setAgentThinking(officeId, agentId, currentStatus.thinkingDetail ?? 'Processing...', 'tool_complete_settling');
        } else {
          officeManager.setAgentReady(officeId, agentId, 'tool_complete');
        }
      } else if (next.kind === 'waiting') {
        // ask_user is still active — preserve waiting state even if other tools completed
        officeManager.setAgentWaiting(officeId, agentId, 'ask_user_race_guard');
      } else {
        officeManager.setAgentThinking(officeId, agentId, next.detail, 'tool_complete');
      }
    }

    phaserGameRef?.events.emit('agent:status:changed', agentId);
    updateTerminalContent();
    updateStatusBar();
  });

  window.copilotBridge.onCopilotTurnEnd((agentId) => {
    console.log(`[Office] Turn end: ${agentId}`);
    const officeId = officeManager.currentOfficeId;
    if (officeId) {
      // FR-002 guard: a stray turn_end while the agent is still initializing must
      // not settle it to "done" — it hasn't produced a response yet. Startup
      // completion is owned by the ready signal / sweeper, not turn_end.
      const current = officeManager.getAgentStatus(officeId, agentId);
      if (current?.subState === 'starting') {
        console.log(`[Office] Ignoring turn_end for ${agentId} — still in starting state`);
        return;
      }
      const agentTools = getCurrentAgentTools();
      const activeTools = agentTools.get(agentId) || [];
      const waitingToolActive = activeTools.some(t => isAskUserTool(t.name, t.status));
      // Clear task summary and tool stack on turn end for clean state
      officeManager.setTaskSummary(officeId, agentId, null);
      if (agentTools.has(agentId)) {
        agentTools.set(agentId, []);
      }
      if (waitingToolActive) {
        officeManager.setAgentWaiting(officeId, agentId, 'turn_end_ask_user_active');
      } else {
        // Turn finished and no wait tool active: mark response done until user acknowledges.
        officeManager.setAgentDonePendingAck(officeId, agentId, 'turn_end');
      }
      notifyAgent(agentId, 'turnEnd');
    }
    phaserGameRef?.events.emit('agent:status:changed', agentId);
    updateTerminalContent();
    updateStatusBar();
  });

  window.copilotBridge.onCopilotTurnStart((agentId) => {
    console.log(`[Office] Turn start: ${agentId}`);
    const officeId = officeManager.currentOfficeId;
    if (!officeId) return;
    // Guard: ignore events while agent is still starting
    const current = officeManager.getAgentStatus(officeId, agentId);
    if (current?.subState === 'starting') {
      console.log(`[Office] Ignoring turn_start for ${agentId} — still in starting state`);
      return;
    }
    // Set task summary on turn start
    officeManager.setTaskSummary(officeId, agentId, 'Processing...');
    // Persist last-activity time so the 'recent' agent sort survives restarts.
    recordAgentActivity(officeId, agentId);
    officeManager.setAgentThinking(officeId, agentId, 'Processing...');
    console.log(`[Office] Status: ${agentId} → thinking (turn start)`);
    notifyAgent(agentId, 'turnStart');
    phaserGameRef?.events.emit('agent:status:changed', agentId);
    updateTerminalContent();
    updateStatusBar();
  });

  window.copilotBridge.onCopilotUserMessage((agentId) => {
    console.log(`[Office] User message: ${agentId}`);
    const officeId = officeManager.currentOfficeId;
    if (!officeId) return;
    // Guard: ignore events while agent is still starting
    const current = officeManager.getAgentStatus(officeId, agentId);
    if (current?.subState === 'starting') {
      console.log(`[Office] Ignoring user_message for ${agentId} — still in starting state`);
      return;
    }
    officeManager.setAgentThinking(officeId, agentId, 'Processing...');
    console.log(`[Office] Status: ${agentId} → thinking (user message)`);
    phaserGameRef?.events.emit('agent:status:changed', agentId);
    updateTerminalContent();
  });

  window.copilotBridge.onSessionMetaUpdated((agentId, meta) => {
    console.log(`[Office] Session meta updated for ${agentId}: "${meta.title}"`);
    const officeId = officeManager.currentOfficeId || 'office-0';
    cachedSessionMeta[agentId] = meta;
    setSessionMetaCacheForOffice(officeId, cachedSessionMeta);
    updateTerminalContent();
  });

  // Teams Remote Agents (011): surface service toasts (GC cleanup, auth/online).
  window.copilotBridge.onTeamsToast?.((toast: { level?: string; message?: string; durationMs?: number }) => {
    if (!toast?.message) return;
    const kind = toast.level === 'error' ? 'error' : toast.level === 'warn' ? 'error' : 'info';
    if (typeof toast.durationMs === 'number' && toast.durationMs > 0) {
      showClipboardToast(toast.message, kind, toast.durationMs);
    } else {
      showClipboardToast(toast.message, kind);
    }
  });

  // Terminal backend fallback notice (013): if a requested backend (default
  // ui-server) couldn't load and we fell back to node-pty, surface a toast.
  // Pull once on init (race-free: the server is ready before the window loads)
  // and also listen for a push (covers server respawn after a crash). Dedupe so
  // the two paths never double-toast for the same startup.
  let backendFallbackToastShown = false;
  const showBackendFallbackToast = (info: { name: string; requested: string; fellBack: boolean; reason?: string } | null) => {
    if (!info || !info.fellBack || backendFallbackToastShown) return;
    backendFallbackToastShown = true;
    const detail = info.reason ? ` (${info.reason})` : '';
    showClipboardToast(`Terminal: ${info.requested} unavailable — using ${info.name}${detail}`, 'error', 10_000);
  };
  window.copilotBridge.onBackendFallback?.((info) => showBackendFallbackToast(info));
  void window.copilotBridge.getBackendInfo?.().then((info) => showBackendFallbackToast(info));

  // Success notice (013): when the ui-server SDK control plane comes online for
  // an office (host up + SDK client attached), confirm it with a toast. Emitted
  // at most once per office by the server.
  window.copilotBridge.onBackendOnline?.((officeId: string, _backend: string) => {
    const officeName = officeManager.getOffice(officeId)?.config.name ?? officeId;
    onlineOffices.add(officeId);
    updateOfficeTabIndicators();
    showClipboardToast(`GitHub Copilot SDK server online for ${officeName}`, 'success', 10_000);
  });

  // Per-agent fallback notice (013): a specific agent was requested on ui-server
  // but its start failed and fell back to node-pty (T039). Surface it so a broken
  // SDK attach is never silent.
  window.copilotBridge.onBackendSessionFallback?.((_officeId: string, agentId: string, reason: string) => {
    const agentName = getAgentConfig(agentId)?.name ?? agentId;
    const detail = reason ? ` (${reason})` : '';
    showClipboardToast(`${agentName}: UI-server unavailable — using node-pty${detail}`, 'error', 10_000);
  });

  // Teams Remote Agents (011): keep the dashboard tile buttons in sync with
  // the service's per-agent online state.
  window.copilotBridge.onTeamsStatusChanged?.((status: { agentId?: string; online?: boolean }) => {
    if (!status?.agentId) return;
    if (status.online) teamsOnlineAgentIds.add(status.agentId);
    else teamsOnlineAgentIds.delete(status.agentId);
    updateTerminalContent();
  });

  // Initial load of the Teams feature flag + online set for the dashboard.
  void refreshTeamsDashboardState();

  window.copilotBridge.onTerminalPreloadStatus((agentId, status) => {
    console.log(`[Office] Preload status for ${agentId}: ${status}`);
    agentPreloadStatus.set(agentId, status);

    const officeId = officeManager.currentOfficeId;
    if (officeId) {
      const current = officeManager.getAgentStatus(officeId, agentId);
      if (status === 'preloading') {
        if (!current || current.state === 'slacking') {
          officeManager.setAgentStarting(officeId, agentId, 'preload');
        }
      } else if (status === 'ready') {
        // This is the ONLY path allowed to transition out of starting state
        officeManager.setAgentReady(officeId, agentId, 'preload_ready');
        // A Teams-bound agent that just became ready can now be re-onlined — poke
        // the service so it posts the thread "reconnected" notice only once the
        // agent is actually up (not merely because its session id was persisted).
        if (teamsFeatureEnabled && teamsBoundAgentIds.has(agentId)) {
          scheduleTeamsReconcile();
        }
        // Clear any stale tool state accumulated from historical events during startup
        const agentTools = getCurrentAgentTools();
        if (agentTools.has(agentId)) {
          agentTools.set(agentId, []);
        }
        notifyAgent(agentId, 'sessionReady');
      } else if (status === 'failed') {
        console.warn(`[Office] Preload FAILED for ${agentId}`);
        officeManager.setAgentError(officeId, agentId, 'Preload failed', 'preload_failed');
        notifyAgent(agentId, 'sessionError');
      }
    }

    phaserGameRef?.events.emit('agent:status:changed', agentId);
    updateStatusBar();
    updateTerminalContent();
  });

}

// ── Agent Status Sync ─────────────────────────────────────────────

/** Reconcile officeManager state with actual terminal server state. */
let syncInProgress = false;
let syncStartedAt = 0;
const SYNC_LOCK_TIMEOUT_MS = 15_000;
const STALE_IN_TURN_THINKING_TIMEOUT_MS = 90_000;
const THINKING_TO_READY_GRACE_MS = 7_000;
const SYNC_WAIT_POLL_MS = 50;

async function waitForSyncIdle(timeoutMs: number = SYNC_LOCK_TIMEOUT_MS): Promise<void> {
  const startedAt = Date.now();
  while (syncInProgress && (Date.now() - startedAt) < timeoutMs) {
    await new Promise<void>((resolve) => setTimeout(resolve, SYNC_WAIT_POLL_MS));
  }
}

async function syncAgentStatuses(force = false): Promise<void> {
  if (!window.copilotBridge) return;
  if (syncInProgress) {
    if (force) {
      await waitForSyncIdle();
      if (syncInProgress) {
        console.warn(`[Office] syncAgentStatuses lock held for >${SYNC_LOCK_TIMEOUT_MS / 1000}s during forced sync — force-releasing`);
        syncInProgress = false;
      }
    } else {
      // Safety net: if the lock has been held too long, force-release it.
      if (syncStartedAt && (Date.now() - syncStartedAt) > SYNC_LOCK_TIMEOUT_MS) {
        console.warn(`[Office] syncAgentStatuses lock held for >${SYNC_LOCK_TIMEOUT_MS / 1000}s — force-releasing`);
        syncInProgress = false;
      } else {
        return;
      }
    }
  }
  const officeId = officeManager.currentOfficeId;
  if (!officeId) return;
  syncInProgress = true;
  syncStartedAt = Date.now();
  try {
    const statuses = await window.copilotBridge.queryAgentStatuses(officeId);

    let changed = false;
    const STARTING_TIMEOUT_MS = 60_000; // 1 minute timeout for stuck starting state
    const now = Date.now();

    for (const agent of getCurrentAgents()) {
      const serverStatus = statuses[agent.id];
      const current = officeManager.getAgentStatus(officeId, agent.id);
      const activeTools = getCurrentAgentTools().get(agent.id) || [];
      const waitingToolActive = activeTools.some(t => isAskUserTool(t.name, t.status));
      const thinkingSince = current?.subState === 'thinking' ? current.activityStartTime : null;
      const thinkingAgeMs = thinkingSince ? (now - thinkingSince) : null;
      const staleInTurnThinking = Boolean(
        current?.subState === 'thinking'
        && thinkingSince
        && (now - thinkingSince) > STALE_IN_TURN_THINKING_TIMEOUT_MS
        && activeTools.length === 0
      );

      // Feature 002 (US2, C4/V4): only flip to error: 'Startup timed out' when
      // the underlying PTY is actually dead. If the PTY is alive the ready
      // signal just hasn't landed yet — recover to ready and log it.
      const decision = decideStartupTimeoutTransition({
        subState: current?.subState,
        activityStartTime: current?.activityStartTime,
        now,
        timeoutMs: STARTING_TIMEOUT_MS,
        serverAlive: serverStatus?.alive,
      });
      if (decision.kind === 'recover-to-ready') {
        console.warn(
          `[Office] Agent ${agent.id} stuck in starting past timeout but PTY alive — recovering to ready`,
        );
        officeManager.setAgentReady(officeId, agent.id);
        changed = true;
        continue;
      }
      if (decision.kind === 'transition-to-error') {
        console.warn(`[Office] Agent ${agent.id} stuck in starting for >${STARTING_TIMEOUT_MS / 1000}s — transitioning to error`);
        officeManager.setAgentError(officeId, agent.id, decision.reason);
        changed = true;
        continue;
      }

      if (serverStatus?.alive) {
        if (serverStatus.ready) {
          if (waitingToolActive) {
            // ask_user is active: always prefer waiting over thinking.
            if (!current || current.subState !== 'waiting') {
              officeManager.setAgentWaiting(officeId, agent.id);
              changed = true;
            }
          } else if (serverStatus.inTurn) {
            // Catch-up path for missed turn_start events while unfocused/backgrounded.
            // Preserve waiting state while a turn is open; don't force it back to thinking.
            if (staleInTurnThinking) {
              // Recovery path: if server inTurn is stale and there are no active tools for a long time,
              // clear the stuck thinking state so dashboard/status bar can recover.
              console.warn(`[Office] Agent ${agent.id} stale inTurn for >${STALE_IN_TURN_THINKING_TIMEOUT_MS / 1000}s — resetting to ready`);
              officeManager.setAgentReady(officeId, agent.id);
              changed = true;
            } else if (!current || (current.subState !== 'thinking' && current.subState !== 'waiting')) {
              officeManager.setTaskSummary(officeId, agent.id, 'Processing...');
              officeManager.setAgentThinking(officeId, agent.id, 'Processing...');
              changed = true;
            }
          // Agent is alive and ready — if we think it's slacking/starting/error, fix it
          } else if (!current || current.state === 'slacking' || current.subState === 'error') {
            changed = true;
            officeManager.setAgentReady(officeId, agent.id);
          } else if (current.subState === 'starting' || current.subState === 'waiting') {
            officeManager.setAgentReady(officeId, agent.id);
            changed = true;
          } else if (current.subState === 'thinking' && !serverStatus.inTurn) {
            // Avoid brief ready↔thinking flapping while turn/inTurn state propagates.
            if (thinkingAgeMs !== null && thinkingAgeMs < THINKING_TO_READY_GRACE_MS) {
              continue;
            }
            // Server says agent is idle (not in a turn) and grace elapsed:
            // recover from stuck thinking state (e.g. missed turn_end event).
            console.warn(`[Office] Agent ${agent.id} stuck in thinking but server reports idle — resetting to ready`);
            const agentTools = getCurrentAgentTools();
            if (agentTools.has(agent.id)) {
              agentTools.set(agent.id, []);
            }
            officeManager.setAgentReady(officeId, agent.id);
            changed = true;
          }
        } else {
          // Agent is alive but not yet ready — should be starting
          if (!current || current.state === 'slacking') {
            officeManager.setAgentStarting(officeId, agent.id);
            changed = true;
          }
        }
      } else {
        // Agent has no running PTY — should be slacking
        if (current && current.state === 'active') {
          officeManager.setAgentSlacking(officeId, agent.id);
          changed = true;
        }
      }
    }

    if (changed) {
      for (const agent of getCurrentAgents()) {
        phaserGameRef?.events.emit('agent:status:changed', agent.id);
      }
      updateTerminalContent();
      updateStatusBar();
    }
  } catch (e) {
    console.warn('[Office] Failed to sync agent statuses:', e);
  } finally {
    syncInProgress = false;
  }
}

// Initial sync on startup (replaces the old listActiveTerminals approach)
syncAgentStatuses();

// Periodic sync every 10 seconds to catch missed events and dead sessions
const STATUS_SYNC_INTERVAL_MS = 10_000;
setInterval(syncAgentStatuses, STATUS_SYNC_INTERVAL_MS);

function catchUpStatusViews(reason: string): void {
  console.log(`[Office] Status catch-up: ${reason}`);
  pendingStatusBarUpdate = false;
  pendingTerminalContentUpdate = false;
  updateStatusBarNow();
  updateTerminalContentNow();
  drawOverviewSprites();
  phaserGameRef?.events.emit('agent:status:changed');
  void reconnectAgentStatuses();
}

/**
 * Re-register all alive agents with the server so events flow again,
 * then reconcile renderer state. Call this after sleep/hibernate or
 * when statuses appear stale.
 */
async function reconnectAgentStatuses(): Promise<void> {
  if (!window.copilotBridge) return;
  const officeId = officeManager.currentOfficeId;
  if (!officeId) return;
  await waitForSyncIdle();
  try {
    const statuses = await window.copilotBridge.queryAgentStatuses(officeId);
    // Requirement: auto-start agents that have Teams remote on BEFORE reconnecting,
    // so their sessions are coming up and the Teams service can re-online them.
    // get-session-id alone returns the disk-persisted id, so we key off live
    // aliveness (queryAgentStatuses) and warm any bound agent that isn't running.
    try {
      const teamsRes = await window.copilotBridge.teamsStatus?.();
      if (teamsRes?.success && Array.isArray(teamsRes.bindings)) {
        for (const b of teamsRes.bindings as Array<{ officeId: string; agentId: string }>) {
          if (b.officeId !== officeId) continue;
          if (!statuses[b.agentId]?.alive) {
            await warmAgentSession(officeId, b.agentId).catch(() => {});
          }
        }
      }
    } catch { /* best-effort — Teams may be disabled */ }
    for (const [agentId, info] of Object.entries(statuses)) {
      if (info.alive) {
        await window.copilotBridge.terminalAttach(officeId, agentId).catch(() => {});
      }
    }
  } catch (e) {
    console.warn('[Office] Failed to reconnect agent viewers:', e);
  }
  // Sessions are back — poke the Teams service to reconcile now (instead of waiting
  // for its periodic tick) so per-agent Teams remote buttons reflect re-onlined
  // bindings promptly, then refresh the renderer's cached online set.
  try {
    await window.copilotBridge.teamsReconcile?.();
  } catch { /* best-effort */ }
  void refreshTeamsDashboardState();
  await syncAgentStatuses(true);
}

// ── Elapsed Time Ticker ─────────────────────────────────────────────
// Updates elapsed time displays on dashboard cards every second (DOM-only, no full re-render)
const ELAPSED_TICK_MS = 1000;
// Tracks the last emitted stall state per agent so the Phaser badge is only
// re-tweened when the stall state actually flips (FR-013).
const lastStalledState = new Map<string, boolean>();
setInterval(() => {
  const office = officeManager.currentOffice;
  if (!office) return;
  const now = Date.now();
  for (const agent of getCurrentAgents()) {
    const status = office.agents.get(agent.id);
    // Update elapsed time badge
    if (status?.activityStartTime) {
      if (status.subState === 'thinking' || status.subState === 'waiting' || status.subState === 'starting') {
        const el = document.querySelector(`[data-elapsed-agent="${agent.id}"]`) as HTMLElement | null;
        if (el) {
          el.textContent = `⏱ ${formatElapsed(status.activityStartTime)}`;
        }
      }
    }

    // ── Stall detection (FR-013) ──
    // computeStall is a pure read over status; it never mutates the state model.
    const stalled = computeStall(status, now).isStalled;
    // Dashboard card: toggle a data flag + class so the card can show the amber
    // treatment without a full re-render (and so tests can assert it).
    const card = document.querySelector(`.agent-card[data-agent="${agent.id}"]`) as HTMLElement | null;
    if (card) {
      card.classList.toggle('agent-stalled', stalled);
      card.dataset.stalled = stalled ? 'true' : 'false';
    }
    // Phaser badge: only signal on state change to avoid restarting the tween.
    if ((lastStalledState.get(agent.id) ?? false) !== stalled) {
      lastStalledState.set(agent.id, stalled);
      phaserGameRef?.events.emit('agent:stall', agent.id, stalled);
    }

    // Update relative timestamps in recent activity log
    const actionEls = document.querySelectorAll(`.agent-card[data-agent="${agent.id}"] [data-action-ts]`);
    actionEls.forEach(el => {
      const ts = parseInt((el as HTMLElement).dataset.actionTs || '0', 10);
      if (ts) {
        const timeSpan = el.querySelector('span:first-child') as HTMLElement | null;
        if (timeSpan) {
          timeSpan.textContent = formatRelativeTime(ts);
        }
      }
    });
  }
}, ELAPSED_TICK_MS);

// ── Status Bar ────────────────────────────────────────────────────

function updateStatusBarNow() {
  syncActiveRosterForCurrentOffice();
  const office = officeManager.currentOffice;
  const agents = office ? Array.from(office.agents.values()) : [];
  const officeName = officeManager.currentOffice?.config.name || 'No Office';

  // Count per state
  const slackingCount = getCurrentAgents().length - agents.filter(a => a.state === 'active').length;
  const startingCount = agents.filter(a => a.subState === 'starting').length;
  const doneCount = agents.filter(a => a.subState === 'ready' && isDonePendingAck(a)).length;
  const readyCount = agents.filter(a => a.subState === 'ready' && !isDonePendingAck(a)).length;
  const waitingCount = agents.filter(a => a.subState === 'waiting').length;
  const thinkingCount = agents.filter(a => a.subState === 'thinking').length;
  const errorCount = agents.filter(a => a.subState === 'error').length;

  const html = `
    <span style="margin-right: 29px; color: #8af;">${officeName}</span>
    <span style="margin-right: 22px; color: #555;">💤 Slacking ${slackingCount}</span>
    <span style="margin-right: 22px; color: #ff9944;">🚀 Starting ${startingCount}</span>
    ${readyCount > 0 ? `<span style="margin-right: 22px; color: #ffffff;">📭 Ready ${readyCount}</span>` : ''}
    ${doneCount > 0 ? `<span style="margin-right: 22px; color: #4a78ff;">📬 Done ${doneCount}</span>` : ''}
    <span style="margin-right: 22px; color: #50fa7b;">⚡ Thinking ${thinkingCount}</span>
    <span style="margin-right: 22px; color: #ffb86c;">⏳ Waiting ${waitingCount}</span>
    ${errorCount > 0 ? `<span style="margin-right: 22px; color: #f44;">❌ Error ${errorCount}</span>` : ''}
    <span style="flex: 1;"></span>
    <button id="reset-sessions-btn" style="
      background: #3a1a1a;
      border: 1px solid #c44;
      color: #f88;
      font-family: monospace;
      font-size: 14px;
      padding: 4px 16px;
      border-radius: 4px;
      cursor: pointer;
      margin-right: 24px;
    ">⟳ Reset All Sessions</button>
    <button id="reconnect-statuses-btn" style="
      background: #1a2a2a;
      border: 1px solid #4a8;
      color: #8f8;
      font-family: monospace;
      font-size: 14px;
      padding: 4px 16px;
      border-radius: 4px;
      cursor: pointer;
      margin-right: 24px;
    ">🔌 Re-connect Statuses</button>
    <span style="color: #666; font-size: 10px;">WASD: Walk | Shift: Run | Space: Talk | F10: Close terminal</span>
  `;

  if (html !== lastStatusBarHtml) {
    lastStatusBarHtml = html;
    statusBar.innerHTML = html;
    document.getElementById('reset-sessions-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('reset-sessions-btn') as HTMLButtonElement;
      if (btn) { btn.disabled = true; btn.textContent = '⟳ Resetting...'; }
      if (window.copilotBridge) {
        await window.copilotBridge.resetAllSessions(officeManager.currentOfficeId || 'office-0');
      }
      if (btn) { btn.disabled = false; btn.textContent = '⟳ Reset All Sessions'; }
    });
    document.getElementById('reconnect-statuses-btn')?.addEventListener('click', async () => {
      const btn = document.getElementById('reconnect-statuses-btn') as HTMLButtonElement;
      if (btn) { btn.disabled = true; btn.textContent = '🔌 Reconnecting...'; }
      await reconnectAgentStatuses();
      if (btn) { btn.disabled = false; btn.textContent = '🔌 Re-connect Statuses'; }
    });
  }
}

setupTerminalClickHandler();

type FleetDeployRequest = { officeName: string; prompt: string; sourceOfficeId: string; resolve?: () => void };
type FleetStatusSummary = { total: number; completed: number; failed: number; active: number };

function onAgentSessionClosed(agentId: string): void {
  const officeId = officeManager.currentOfficeId;
  if (officeId) officeManager.setAgentSlacking(officeId, agentId, 'session_closed');
  phaserGameRef?.events.emit('agent:status:changed', agentId);
  updateTerminalContent();
  updateStatusBar();
}

function onAgentStatusChanged(): void {
  updateTerminalContent();
  updateStatusBar();
  updateOfficeTabIndicators();
}

function onAgentReattached(agentId: string): void {
  console.log(`[Office] Agent reattached: ${agentId}`);
  void syncAgentStatuses();
}

async function onFleetOfficeCreated(officeId: string, sourceOfficeId?: string): Promise<void> {
  console.log(`[Office] Fleet V-Team office created: ${officeId} (source: ${sourceOfficeId ?? 'none'})`);

  // Transfer Arthur's meeting session to the fleet office so it's accessible there
  if (sourceOfficeId && window.copilotBridge?.transferSession) {
    try {
      const result = await window.copilotBridge.transferSession(sourceOfficeId, officeId, ARCHITECT_AGENT_ID);
      console.log(`[Office] Arthur session transfer: ${result.success ? 'OK' : result.error ?? 'failed'}`);
    } catch (e) {
      console.warn('[Office] Failed to transfer Arthur session:', e);
    }
  }

  // Tell OfficeScene the source office for FleetTracker attach
  if (sourceOfficeId) {
    phaserGameRef?.events.emit('fleet:source-office', { sourceOfficeId });
  }

  switchToOffice(officeId);
}

async function onFleetDeployRequested(data: FleetDeployRequest): Promise<void> {
  console.log(`[Fleet] Deploy requested: "${data.officeName}" from office ${data.sourceOfficeId}`);

  // 1. Create a new fleet-vteam office
  const fleetOffice = officeManager.createOffice(data.officeName, '.', 'fleet-vteam');
  const officeId = fleetOffice.config.id;
  console.log(`[Fleet] Created fleet office: ${officeId}`);

  // 2. Transfer Arthur's session from the source office to the fleet office
  if (window.copilotBridge?.transferSession) {
    try {
      const result = await window.copilotBridge.transferSession(data.sourceOfficeId, officeId, ARCHITECT_AGENT_ID);
      console.log(`[Fleet] Arthur session transfer: ${result.success ? 'OK' : 'failed'}`, result);
    } catch (e) {
      console.warn('[Fleet] Failed to transfer Arthur session:', e);
    }
  } else {
    console.warn('[Fleet] copilotBridge.transferSession not available');
  }

  // 3. Signal MeetingScene that transfer is done (so it can safely exitMeeting)
  data.resolve?.();

  // 4. Tell OfficeScene the source office and fleet prompt.
  //    The /fleet command will be sent from OfficeScene.initFleetPipeline() AFTER
  //    the terminal viewer is attached — avoids the race with session transfer.
  phaserGameRef?.events.emit('fleet:source-office', { sourceOfficeId: data.sourceOfficeId, prompt: data.prompt });

  // 5. Switch to the new fleet office (triggers OfficeScene rebuildLayout)
  switchToOffice(officeId);
}

function onFleetStatus(status: FleetStatusSummary): void {
  const subtitle = document.getElementById('terminal-subtitle');
  if (subtitle && officeManager.currentOffice?.config.layout === 'fleet-vteam') {
    subtitle.textContent = `Fleet: ${status.active} active · ${status.completed} done · ${status.failed} failed / ${status.total} total`;
  }
  updateTerminalContent();
}

function onFleetComplete(): void {
  console.log('[Fleet] All sub-agents complete');
  const subtitle = document.getElementById('terminal-subtitle');
  if (subtitle) {
    subtitle.textContent = '✅ Fleet complete!';
  }
  updateTerminalContent();
}

let officePanelListenersBound = false;

function bindOfficePanelListeners(): void {
  if (officePanelListenersBound) return;
  officePanelListenersBound = true;

  // Focus the Phaser canvas when clicking the game pane so keyboard input works
  officePanel.addEventListener('click', () => {
    const canvas = officePanel.querySelector('canvas');
    canvas?.focus();
  });

  // Clicking the game panel should blur the terminal (DOM-level, bypasses Phaser input)
  officePanel.addEventListener('mousedown', () => {
    if (isMobileModeActive()) return;
    console.log('[main] game panel mousedown — emitting game:panel:clicked');
    phaserGameRef?.events.emit('game:panel:clicked');
  });
}

function getPhaserDimensions(): { width: number; height: number } {
  return {
    width: officePanel.clientWidth || window.innerWidth / 2,
    height: officePanel.clientHeight || window.innerHeight,
  };
}

function bindPhaserEventListeners(game: Phaser.Game): void {
  // Once Phaser boots and textures are ready, draw sprites for the overview cards
  game.events.once('ready', () => {
    drawOverviewSprites();
    game.events.emit('layout:change', { layoutKey: currentResponsiveLayout });
  });

  game.events.on('agent:session:closed', onAgentSessionClosed);
  game.events.on('agent:status:changed', onAgentStatusChanged);
  game.events.on('agent:reattached', onAgentReattached);
  game.events.on('bgm:started', onBgmStarted);
  game.events.on('fleet:office:created', onFleetOfficeCreated);
  game.events.on('fleet:deploy-requested', onFleetDeployRequested);
  game.events.on('fleet:status', onFleetStatus);
  game.events.on('fleet:complete', onFleetComplete);
}

function ensurePhaserGame(): void {
  if (phaserGameRef) return;

  const { width, height } = getPhaserDimensions();
  const game = new Phaser.Game({
    type: Phaser.AUTO,
    parent: officePanel,
    width,
    height,
    backgroundColor: '#1a1a2e',
    physics: { default: 'arcade', arcade: { debug: false } },
    scene: [BootScene, OfficeScene, MeetingScene],
  });
  phaserGameRef = game;
  // Diagnostic / e2e handle: exposes the Phaser.Game instance under a stable
  // window key so Playwright specs (and devtools sessions) can dispatch
  // `game.events` without screen coordinate scripting. Read-only consumer
  // convention — never assigned to from inside the app.
  (window as unknown as { __phaserGame?: Phaser.Game }).__phaserGame = game;
  bindPhaserEventListeners(game);
}

function teardownPhaserGame(): void {
  if (!phaserGameRef) return;
  const game = phaserGameRef;
  phaserGameRef = undefined;
  try {
    game.destroy(true);
  } catch (error) {
    console.warn('[main] Failed to destroy Phaser game cleanly:', error);
  }
  delete (window as unknown as { __phaserGame?: Phaser.Game }).__phaserGame;
  officePanel.innerHTML = '';
}

bindOfficePanelListeners();

// User-reported 2026-06-12: when durable persistence load completes AFTER
// the initial fetchSessionMeta() call (the common case on cold boot because
// localStorage hydrates synchronously but the file load is async), the
// renderer is left with cachedSessionMeta keyed for the WRONG office.
// Clicking the tab for the newly-current office is a no-op (id already
// matches), so the cache never refills and the dashboard shows
// "Untitled session" for every agent even though the metadata is on disk
// and the bridge returns it correctly.
//
// Wire officeManager.onOfficesUpdated to re-render tabs and re-fetch the
// session meta cache for whatever currentOfficeId became after the durable
// load applied. Defensive: also run a roster sync + status bar update so
// any other UI bound to office state catches up in one go.
officeManager.onOfficesUpdated = () => {
  syncActiveRosterForCurrentOffice();
  renderOfficeTabs();
  fetchSessionMeta();
  updateTerminalContent();
  updateStatusBar();
  // Spec 009 (US1): cold-launch trigger for auto-startup. Runs as the LAST
  // step in this callback so cachedSessionMeta is fresh-ish (fetchSessionMeta
  // is fire-and-forget but the cached-meta synchronous path above already
  // hydrated the renderer for the current office). The coordinator
  // re-checks per-agent session IDs via the async getSessionId bridge, so
  // even if cachedSessionMeta is briefly stale the qualifying filter is
  // correct.
  void autoStartCoordinator.tryWarmCurrentOffice();
  // Warm every persisted Teams-bound agent across ALL offices (once per app
  // session), so bound agents in non-current offices come online at launch
  // instead of only when their tab is visited.
  void warmAllTeamsBoundAgents();
};

// Foreground catch-up: ensure dashboard + scene badges refresh immediately after backgrounding.
window.addEventListener('focus', () => {
  catchUpStatusViews('window focus');
});
document.addEventListener('visibilitychange', () => {
  if (!document.hidden) {
    catchUpStatusViews('document visible');
  }
});

syncActiveRosterForCurrentOffice();
applyAppMode(appMode, { force: true, refreshTabs: false });
fetchSessionMeta();
