// CopilotOffice - Main Entry Point
// Phaser 3 office visualization with split terminal view

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { OfficeScene } from './scenes/OfficeScene';
import { MeetingScene } from './scenes/MeetingScene';
import { officeManager, OfficeLayout } from './office/officeManager';
import { AGENTS } from './config/agents';
import { getLayout } from './layouts/index';
import { ToastNotificationManager } from './ui/ToastNotification';
import { NotificationService } from './ui/NotificationService';
import { NotificationSettingsPanel } from './ui/NotificationSettingsPanel';

// ── State ────────────────────────────────────────────────────

officeManager.ensureDefaultOffice();

/** Get the current office layout type. */
function getCurrentLayout(): OfficeLayout {
  return officeManager.currentOffice?.config.layout ?? 'default';
}

/** Return the agent list for the current office layout */
function getCurrentAgents() {
  return getLayout(getCurrentLayout()).agents;
}

function getCurrentAgentTools(): Map<string, { toolId: string; name: string; status: string }[]> {
  return officeManager.currentOffice?.agentTools || new Map();
}

let selectedAgentId: string | null = null;
let phaserGameRef: Phaser.Game | undefined;
let debugMode = false;

/** Log only when debug mode is active */
function debugLog(...args: unknown[]): void {
  if (debugMode) console.log('[Debug]', ...args);
}

// ── Agent Preload Status ────────────────────────────────────────
const agentPreloadStatus: Map<string, 'preloading' | 'ready' | 'failed'> = new Map();

// When true, IPC event handlers block status transitions while agent is in 'starting' state.
// Server-side filtering already handles historical events, so this is a secondary safety net.
const ENABLE_STARTING_GUARD = false;

// ── Debounced Updates ────────────────────────────────────────────
let pendingStatusBarUpdate = false;
let pendingTerminalContentUpdate = false;

function scheduleStatusBarUpdate() {
  if (pendingStatusBarUpdate) return;
  pendingStatusBarUpdate = true;
  requestAnimationFrame(() => {
    pendingStatusBarUpdate = false;
    updateStatusBarNow();
  });
}

function scheduleTerminalContentUpdate() {
  if (pendingTerminalContentUpdate) return;
  pendingTerminalContentUpdate = true;
  requestAnimationFrame(() => {
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
  background: #1a1a2a;
  border-bottom: 2px solid #333;
  padding: 0 16px;
  height: 72px;
  flex-shrink: 0;
  font-size: 22px;
`;
container.appendChild(tabsBar);

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

// ── Office Tabs ─────────────────────────────────────────────────

function renderOfficeTabs() {
  const offices = officeManager.getAllOffices();
  const currentId = officeManager.currentOfficeId;

  let html = '';

  for (const office of offices) {
    const isActive = office.id === currentId;
    const bgColor = isActive ? '#2a2a4a' : '#1a1a2a';
    const borderColor = isActive ? '#4488ff' : 'transparent';

    html += `
      <div class="office-tab" data-office-id="${office.id}" style="
        padding: 12px 24px;
        margin-right: 8px;
        background: ${bgColor};
        border: 2px solid ${borderColor};
        border-bottom: none;
        border-radius: 8px 8px 0 0;
        cursor: pointer;
        font-family: monospace;
        color: ${isActive ? '#fff' : '#888'};
        display: flex;
        align-items: center;
        gap: 12px;
      ">
        <span>${office.name}</span>
        <span class="edit-office-btn" data-office-id="${office.id}" style="
          color: #666;
          font-size: 14px;
          padding: 4px 8px;
          border-radius: 4px;
        ">⚙</span>
      </div>
    `;
  }

  html += `
    <div id="new-office-btn" style="
      padding: 12px 24px;
      background: #252538;
      border: 2px dashed #444;
      border-radius: 8px 8px 0 0;
      cursor: pointer;
      font-family: monospace;
      color: #4a4;
    ">+ New Office</div>
    <div style="flex: 1;"></div>
    <div id="debug-toggle-btn" style="
      padding: 8px 16px;
      background: ${debugMode ? '#3a2a1a' : '#252538'};
      border: 2px solid ${debugMode ? '#ff8800' : '#444'};
      border-radius: 6px;
      cursor: pointer;
      font-family: monospace;
      color: ${debugMode ? '#ff8800' : '#666'};
      font-size: 16px;
      user-select: none;
      transition: all 0.2s;
      ${debugMode ? 'box-shadow: 0 0 8px #ff880044;' : ''}
    ">🐛 Debug</div>
    <div id="notif-settings-btn" style="
      padding: 8px 16px;
      background: #252538;
      border: 2px solid #444;
      border-radius: 6px;
      cursor: pointer;
      font-family: monospace;
      color: #666;
      font-size: 16px;
      user-select: none;
      transition: all 0.2s;
    ">🔔</div>
    <div id="bgm-control" style="
      display: flex;
      align-items: center;
      gap: 6px;
      padding: 4px 8px;
      background: #252538;
      border: 2px solid #444;
      border-radius: 6px;
      font-family: monospace;
      font-size: 14px;
    ">
      <span style="color: #666; font-size: 12px;">BGM</span>
      <button id="bgm-mute-btn" style="
        background: #333;
        border: 1px solid #555;
        border-radius: 4px;
        cursor: pointer;
        font-size: 11px;
        font-family: monospace;
        padding: 3px 6px;
        color: ${bgmMuted ? '#ff6666' : '#00ff88'};
        min-width: 50px;
      ">${bgmMuted ? 'MUTED' : 'ON'}</button>
      <input id="bgm-slider" type="range" min="0" max="100"
        value="${Math.round(parseFloat(localStorage.getItem('copilot-office-bgm-volume') ?? '0.5') * 100)}"
        title="Volume"
        style="width: 70px; cursor: pointer; accent-color: #00ff88;" />
    </div>
  `;

  tabsBar.innerHTML = html;

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
      const officeId = (e.target as HTMLElement).dataset.officeId;
      if (officeId) showEditOfficeDialog(officeId);
    });
  });

  document.getElementById('new-office-btn')?.addEventListener('click', showNewOfficeDialog);

  document.getElementById('debug-toggle-btn')?.addEventListener('click', () => {
    debugMode = !debugMode;
    phaserGame?.events.emit('debug:toggle', debugMode);
    renderOfficeTabs();
    // Return focus to the game so player movement isn't interrupted
    phaserGame?.events.emit('game:panel:clicked');
    console.log(`[Debug] Debug mode ${debugMode ? 'ON' : 'OFF'}`);
  });

  document.getElementById('notif-settings-btn')?.addEventListener('click', () => {
    notificationSettingsPanel.toggle();
  });

  // BGM controls in top bar
  document.getElementById('bgm-mute-btn')?.addEventListener('click', () => {
    bgmMuted = !bgmMuted;
    localStorage.setItem('copilot-office-bgm-muted', String(bgmMuted));
    const vol = parseInt((document.getElementById('bgm-slider') as HTMLInputElement)?.value ?? '50', 10) / 100;
    updateSpeakerIcon(vol, bgmMuted);
    phaserGameRef?.events.emit('bgm:mute', bgmMuted);
  });

  document.getElementById('bgm-slider')?.addEventListener('input', (e) => {
    const vol = parseInt((e.target as HTMLInputElement).value, 10) / 100;
    localStorage.setItem('copilot-office-bgm-volume', String(vol));
    updateSpeakerIcon(vol, bgmMuted);
    phaserGameRef?.events.emit('bgm:volume', vol);
  });
}

function switchToOffice(officeId: string) {
  // Block switching while scene animations are in progress
  if (phaserGame?.registry.get('animating')) {
    console.log('[Office] Blocked: animation in progress');
    return;
  }

  selectedAgentId = null;

  officeManager.switchOffice(officeId);

  phaserGame?.events.emit('office:switch', officeId, officeManager.currentOffice?.config.workingDirectory);

  renderOfficeTabs();
  updateTerminalContent();
  updateStatusBar();

  // Re-sync agent statuses for the new office
  syncAgentStatuses();
  fetchSessionMeta();

  console.log(`[Office] Switched to office: ${officeManager.currentOffice?.config.name}`);
}

function showNewOfficeDialog() {
  // DOM-based dialog — prompt() is blocked in Electron
  const overlay = document.createElement('div');
  overlay.style.cssText = `
    position: fixed; top: 0; left: 0; width: 100%; height: 100%;
    background: rgba(0,0,0,0.7); z-index: 99999;
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

  const close = () => overlay.remove();
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

function showEditOfficeDialog(officeId: string) {
  const office = officeManager.getOffice(officeId);
  if (!office) return;

  const canDelete = office.config.id !== 'office-0';
  const deleteOption = canDelete ? '\n- "delete" to remove office' : '';

  const action = prompt(
    `Office: ${office.config.name}\nPath: ${office.config.workingDirectory}\n\nEnter action:\n- "rename" to change name\n- "path" to change working directory${deleteOption}`,
    'rename'
  );

  if (action === 'rename') {
    const newName = prompt('Enter new name:', office.config.name);
    if (newName) {
      officeManager.updateOffice(officeId, { name: newName });
      renderOfficeTabs();
    }
  } else if (action === 'path') {
    const newPath = prompt('Enter new working directory:', office.config.workingDirectory);
    if (newPath) {
      officeManager.updateOffice(officeId, { workingDirectory: newPath });
      renderOfficeTabs();
    }
  } else if (action === 'delete') {
    if (!canDelete) return;
    if (confirm(`Delete office "${office.config.name}"? This cannot be undone.`)) {
      officeManager.deleteOffice(officeId);
      renderOfficeTabs();
      updateTerminalContent();
    }
  }
}

renderOfficeTabs();

// Terminal header
const terminalHeader = document.createElement('div');
terminalHeader.style.cssText = `
  padding: 14px 20px;
  background: #141424;
  border-bottom: 2px solid #2a2a4a;
  font-family: 'Cascadia Code', Consolas, monospace;
  flex-shrink: 0;
  display: flex;
  justify-content: space-between;
  align-items: center;
`;
terminalHeader.innerHTML = `
  <div>
    <div id="terminal-title" style="font-size: 18px; font-weight: bold; color: #8af; margin-bottom: 4px;">🏢 Office Overview</div>
    <div id="terminal-subtitle" style="font-size: 12px; color: #555;"></div>
  </div>
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
`;
terminalPanel.appendChild(terminalHeader);

// Close Office button handler
document.getElementById('close-office-btn')!.addEventListener('click', () => {
  const currentId = officeManager.currentOfficeId;
  const office = officeManager.currentOffice;
  if (!currentId || !office) return;
  if (confirm(`Close office "${office.config.name}"? This cannot be undone.`)) {
    officeManager.deleteOffice(currentId);
    renderOfficeTabs();
    updateTerminalContent();
  }
});

// Terminal content area
const terminalContent = document.createElement('div');
terminalContent.id = 'terminal-content';
terminalContent.style.cssText = `
  flex: 1;
  padding: 16px;
  overflow-y: auto;
  font-family: 'Cascadia Code', Consolas, monospace;
  font-size: 13px;
  color: #ccc;
  position: relative;
`;
terminalPanel.appendChild(terminalContent);

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
  z-index: 100;
`;
document.body.appendChild(statusBar);

// ── Background Music State ───────────────────────────────────────
let bgmMuted = localStorage.getItem('copilot-office-bgm-muted') !== 'false';

function updateSpeakerIcon(vol: number, muted: boolean): void {
  const btn = document.getElementById('bgm-mute-btn');
  if (!btn) return;
  if (muted || vol === 0) { btn.textContent = 'MUTED'; btn.style.color = '#ff6666'; }
  else { btn.textContent = 'ON'; btn.style.color = '#00ff88'; }
}

// Sync slider when music starts (in case OfficeScene restores saved state)
function onBgmStarted(state: { volume: number; muted: boolean }): void {
  const slider = document.getElementById('bgm-slider') as HTMLInputElement | null;
  if (slider) slider.value = String(Math.round(state.volume * 100));
  bgmMuted = state.muted;
  updateSpeakerIcon(state.volume, state.muted);
}

// ── Notifications ────────────────────────────────────────────────
const toastManager = new ToastNotificationManager(document.body);

function formatElapsed(startTime: number | null): string {
  if (!startTime) return '';
  const seconds = Math.floor((Date.now() - startTime) / 1000);
  if (seconds < 60) return `${seconds}s`;
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${mins}m ${secs}s`;
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
    phaserGame?.events.emit('open:agent:terminal', agentId);
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

const notificationSettingsPanel = new NotificationSettingsPanel(notificationService);

// ── Terminal Content Updates ────────────────────────────────────

let lastTerminalContentHtml = '';
let lastStatusBarHtml = '';
let cachedSessionMeta: Record<string, { title: string }> = {};

// Fetch session meta from backend (fire-and-forget, updates cache + UI)
function fetchSessionMeta() {
  if (!window.copilotBridge?.getAllSessionMeta) return;
  window.copilotBridge.getAllSessionMeta(officeManager.currentOfficeId || 'office-0').then(meta => {
    cachedSessionMeta = meta || {};
    updateTerminalContent();
  }).catch(() => {});
}

function updateTerminalContent() {
  scheduleTerminalContentUpdate();
}

function updateTerminalContentNow() {
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
    agents: layout.agents,
    office: office || null,
    selectedAgentId,
    cachedSessionMeta,
    agentTools,
    formatElapsed,
    formatRelativeTime,
  });

  if (html !== lastTerminalContentHtml) {
    lastTerminalContentHtml = html;
    terminalContent.innerHTML = html;
    drawOverviewSprites();
  }
}

function updateStatusBar() {
  scheduleStatusBarUpdate();
}

function drawOverviewSprites() {
  setTimeout(() => {
    if (!phaserGameRef) return;
    for (const agent of getCurrentAgents()) {
      const canvas = document.getElementById(`overview-sprite-${agent.id}`) as HTMLCanvasElement | null;
      if (!canvas) continue;
      const ctx = canvas.getContext('2d');
      if (!ctx) continue;
      const texture = phaserGameRef.textures.get(agent.sprite);
      if (!texture || texture.key === '__MISSING') continue;
      const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      if (source) {
        ctx.imageSmoothingEnabled = false;
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(source, 0, 0);
      }
    }
  }, 50);
}

function setupTerminalClickHandler() {
  terminalContent.addEventListener('click', (e) => {
    const target = e.target as HTMLElement;
    const layout = getLayout(getCurrentLayout());

    // Handle session meta panel interactions (prevent card open)
    const metaPanel = target.closest('.session-meta-panel');
    if (metaPanel) {
      e.stopPropagation();
      const agentId = (metaPanel as HTMLElement).dataset.agent;
      if (!agentId) return;
      layout.clickHandler.handleMetaPanelClick(target, agentId, {
        startSessionMetaEdit,
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
        emitOpenTerminal: (id) => { phaserGame?.events.emit('open:agent:terminal', id); },
      });
    }
  });
}

function startSessionMetaEdit(agentId: string) {
  const panel = terminalContent.querySelector(`.session-meta-panel[data-agent="${agentId}"]`);
  if (!panel) return;

  const meta = cachedSessionMeta[agentId] || { title: '' };
  const titleEl = panel.querySelector('.session-title-display') as HTMLElement | null;

  if (titleEl) {
    replaceWithInput(titleEl, meta.title, 'Session title...', 80, async (value) => {
      await window.copilotBridge.setSessionMeta(officeManager.currentOfficeId || 'office-0', agentId, { title: value });
      cachedSessionMeta[agentId] = { title: value };
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

  window.copilotBridge.onCopilotToolStart((agentId, toolName, toolId, status) => {
    console.log(`[Office] Tool start: ${agentId} - ${toolName} - ${status}`);

    const officeId = officeManager.currentOfficeId;
    if (!officeId) return;
    const agentTools = getCurrentAgentTools();

    if (!agentTools.has(agentId)) {
      agentTools.set(agentId, []);
    }
    agentTools.get(agentId)!.push({ toolId, name: toolName, status });

    // Track in recent actions history
    officeManager.pushRecentAction(officeId, agentId, toolName, 'started');
    // Use tool status as task summary context
    if (status) {
      officeManager.setTaskSummary(officeId, agentId, status);
    }

    // Don't change status while agent is still starting — wait for the preload ready signal
    const current = officeManager.getAgentStatus(officeId, agentId);
    if (!ENABLE_STARTING_GUARD || current?.subState !== 'starting') {
      if (toolName === 'ask_user') {
        officeManager.setAgentWaiting(officeId, agentId);
        console.log(`[Office] Status: ${agentId} → waiting (ask_user)`);
        notifyAgent(agentId, 'askUser');
      } else {
        officeManager.setAgentThinking(officeId, agentId, `${toolName}`);
        console.log(`[Office] Status: ${agentId} → thinking (${toolName})`);
        notifyAgent(agentId, 'toolStart', { toolName });
      }
    } else {
      console.log(`[Office] [BLOCKED] Tool start for ${agentId} blocked by starting guard (subState=${current?.subState})`);
    }

    phaserGame?.events.emit('agent:tool:start', agentId, toolName, status);

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
      // Find the completed tool's name before removing
      const completedTool = tools.find(t => t.toolId === toolId);
      const completedToolName = completedTool?.name || 'tool';
      const remaining = tools.filter(t => t.toolId !== toolId);
      agentTools.set(agentId, remaining);

      // Track last completed action + recent actions history
      officeManager.setLastCompletedAction(officeId, agentId, completedToolName);
      officeManager.pushRecentAction(officeId, agentId, completedToolName, 'completed');
      notifyAgent(agentId, 'toolComplete', { toolName: completedToolName });

      // Don't change status while agent is still starting — wait for the preload ready signal
      const current = officeManager.getAgentStatus(officeId, agentId);
      if (!ENABLE_STARTING_GUARD || current?.subState !== 'starting') {
        if (remaining.length === 0) {
          officeManager.setAgentReady(officeId, agentId);
        } else {
          const last = remaining[remaining.length - 1];
          officeManager.setAgentThinking(officeId, agentId, `${last.name}`);
        }
      }
    }

    phaserGame?.events.emit('agent:status:changed', agentId);
    updateTerminalContent();
    updateStatusBar();
  });

  window.copilotBridge.onCopilotTurnEnd((agentId) => {
    console.log(`[Office] Turn end: ${agentId}`);
    const officeId = officeManager.currentOfficeId;
    if (officeId) {
      // Clear task summary on turn end
      officeManager.setTaskSummary(officeId, agentId, null);
      // Don't change status while agent is still starting — wait for the preload ready signal
      const current = officeManager.getAgentStatus(officeId, agentId);
      if (!ENABLE_STARTING_GUARD || current?.subState !== 'starting') {
        officeManager.setAgentReady(officeId, agentId);
      }
      notifyAgent(agentId, 'turnEnd');
    }
    phaserGame?.events.emit('agent:status:changed', agentId);
    updateTerminalContent();
    updateStatusBar();
  });

  window.copilotBridge.onCopilotTurnStart((agentId) => {
    console.log(`[Office] Turn start: ${agentId}`);
    const officeId = officeManager.currentOfficeId;
    if (!officeId) return;
    // Set task summary on turn start
    officeManager.setTaskSummary(officeId, agentId, 'Processing...');
    // Don't change status while agent is still starting — wait for the preload ready signal
    const current = officeManager.getAgentStatus(officeId, agentId);
    if (!ENABLE_STARTING_GUARD || current?.subState !== 'starting') {
      officeManager.setAgentThinking(officeId, agentId, 'Processing...');
      console.log(`[Office] Status: ${agentId} → thinking (turn start)`);
      notifyAgent(agentId, 'turnStart');
    } else {
      console.log(`[Office] [BLOCKED] Turn start for ${agentId} blocked by starting guard`);
    }
    phaserGame?.events.emit('agent:status:changed', agentId);
    updateTerminalContent();
    updateStatusBar();
  });

  window.copilotBridge.onCopilotUserMessage((agentId) => {
    console.log(`[Office] User message: ${agentId}`);
    const officeId = officeManager.currentOfficeId;
    if (!officeId) return;
    // Don't overwrite the starting state — copilot-turn-end will clear it to ready
    const current = officeManager.getAgentStatus(officeId, agentId);
    if (!ENABLE_STARTING_GUARD || current?.subState !== 'starting') {
      officeManager.setAgentThinking(officeId, agentId, 'Processing...');
      console.log(`[Office] Status: ${agentId} → thinking (user message)`);
    } else {
      console.log(`[Office] [BLOCKED] User message for ${agentId} blocked by starting guard`);
    }
    phaserGame?.events.emit('agent:status:changed', agentId);
    updateTerminalContent();
  });

  window.copilotBridge.onSessionMetaUpdated((agentId, meta) => {
    console.log(`[Office] Session meta updated for ${agentId}: "${meta.title}"`);
    cachedSessionMeta[agentId] = meta;
    updateTerminalContent();
  });

  window.copilotBridge.onTerminalPreloadStatus((agentId, status) => {
    console.log(`[Office] Preload status for ${agentId}: ${status}`);
    agentPreloadStatus.set(agentId, status);

    const officeId = officeManager.currentOfficeId;
    if (officeId) {
      const current = officeManager.getAgentStatus(officeId, agentId);
      if (status === 'preloading') {
        if (!current || current.state === 'slacking') {
          officeManager.setAgentStarting(officeId, agentId);
        }
      } else if (status === 'ready') {
        // This is the ONLY path allowed to transition out of starting state
        officeManager.setAgentReady(officeId, agentId);
        // Clear any stale tool state accumulated from historical events during startup
        const agentTools = getCurrentAgentTools();
        if (agentTools.has(agentId)) {
          agentTools.set(agentId, []);
        }
        notifyAgent(agentId, 'sessionReady');
      } else if (status === 'failed') {
        console.warn(`[Office] Preload FAILED for ${agentId}`);
        officeManager.setAgentError(officeId, agentId, 'Preload failed');
        notifyAgent(agentId, 'sessionError');
      }
    }

    phaserGame?.events.emit('agent:status:changed', agentId);
    updateStatusBar();
    updateTerminalContent();
  });

}

// ── Agent Status Sync ─────────────────────────────────────────────

/** Reconcile officeManager state with actual terminal server state. */
async function syncAgentStatuses(): Promise<void> {
  if (!window.copilotBridge) return;
  try {
    const statuses = await window.copilotBridge.queryAgentStatuses();
    const officeId = officeManager.currentOfficeId;
    if (!officeId) return;

    let changed = false;
    const STARTING_TIMEOUT_MS = 60_000; // 1 minute timeout for stuck starting state
    const now = Date.now();

    for (const agent of getCurrentAgents()) {
      const serverStatus = statuses[agent.id];
      const current = officeManager.getAgentStatus(officeId, agent.id);

      // Timeout: if agent has been in 'starting' for too long, transition to error
      if (current?.subState === 'starting' && current.activityStartTime
          && (now - current.activityStartTime) > STARTING_TIMEOUT_MS) {
        console.warn(`[Office] Agent ${agent.id} stuck in starting for >${STARTING_TIMEOUT_MS / 1000}s — transitioning to error`);
        officeManager.setAgentError(officeId, agent.id, 'Startup timed out');
        changed = true;
        continue;
      }

      if (serverStatus?.alive) {
        if (serverStatus.ready) {
          // Agent is alive and ready — if we think it's slacking or starting, fix it
          if (!current || current.state === 'slacking') {
            officeManager.setAgentReady(officeId, agent.id);
            changed = true;
          } else if (current.subState === 'starting') {
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
        phaserGame?.events.emit('agent:status:changed', agent.id);
      }
      updateTerminalContent();
      updateStatusBar();
    }
  } catch (e) {
    console.warn('[Office] Failed to sync agent statuses:', e);
  }
}

// Initial sync on startup (replaces the old listActiveTerminals approach)
syncAgentStatuses();

// Periodic sync every 10 seconds to catch missed events and dead sessions
const STATUS_SYNC_INTERVAL_MS = 10_000;
setInterval(syncAgentStatuses, STATUS_SYNC_INTERVAL_MS);

// ── Elapsed Time Ticker ─────────────────────────────────────────────
// Updates elapsed time displays on dashboard cards every second (DOM-only, no full re-render)
const ELAPSED_TICK_MS = 1000;
setInterval(() => {
  const office = officeManager.currentOffice;
  if (!office) return;
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
  const office = officeManager.currentOffice;
  const agents = office ? Array.from(office.agents.values()) : [];
  const officeName = officeManager.currentOffice?.config.name || 'No Office';

  // Count per state
  const slackingCount = getCurrentAgents().length - agents.filter(a => a.state === 'active').length;
  const startingCount = agents.filter(a => a.subState === 'starting').length;
  const readyCount = agents.filter(a => a.subState === 'ready').length;
  const waitingCount = agents.filter(a => a.subState === 'waiting').length;
  const thinkingCount = agents.filter(a => a.subState === 'thinking').length;
  const errorCount = agents.filter(a => a.subState === 'error').length;

  const html = `
    <span style="margin-right: 29px; color: #8af;">${officeName}</span>
    <span style="margin-right: 22px; color: #555;">💤 Slacking ${slackingCount}</span>
    <span style="margin-right: 22px; color: #ff9944;">🚀 Starting ${startingCount}</span>
    ${readyCount > 0 ? `<span style="margin-right: 22px; color: #4af;">✓ Ready ${readyCount}</span>` : ''}
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
  }
}

updateStatusBar();

setupTerminalClickHandler();

updateTerminalContent();
fetchSessionMeta();

// ── Phaser Game ────────────────────────────────────────────────────

const phaserGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: officePanel,
  width: officePanel.clientWidth || window.innerWidth / 2,
  height: officePanel.clientHeight || window.innerHeight,
  backgroundColor: '#1a1a2e',
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [BootScene, OfficeScene, MeetingScene],
});

phaserGameRef = phaserGame;

// Focus the Phaser canvas when clicking the game pane so keyboard input works
officePanel.addEventListener('click', () => {
  const canvas = officePanel.querySelector('canvas');
  canvas?.focus();
});

// Clicking the game panel should blur the terminal (DOM-level, bypasses Phaser input)
officePanel.addEventListener('mousedown', () => {
  console.log('[main] game panel mousedown — emitting game:panel:clicked');
  phaserGame?.events.emit('game:panel:clicked');
});

// Once Phaser boots and textures are ready, draw sprites for the overview cards
phaserGame.events.once('ready', () => {
  drawOverviewSprites();
});

// When a session is closed via the Close Session button, set agent to slacking
phaserGame.events.on('agent:session:closed', (agentId: string) => {
  const officeId = officeManager.currentOfficeId;
  if (officeId) officeManager.setAgentSlacking(officeId, agentId);
  phaserGame?.events.emit('agent:status:changed', agentId);
  updateTerminalContent();
  updateStatusBar();
});

// Sync status bar whenever any agent status changes (e.g. Starting set by OfficeScene)
phaserGame.events.on('agent:status:changed', () => {
  updateStatusBar();
});

// When a terminal is reattached, sync the agent's status from the server
phaserGame.events.on('agent:reattached', (agentId: string) => {
  console.log(`[Office] Agent reattached: ${agentId}`);
  syncAgentStatuses();
});

// Sync background music UI when music starts
phaserGame.events.on('bgm:started', onBgmStarted);

// When a Fleet V-Team office is created from a meeting, transfer Arthur's session and switch
phaserGame.events.on('fleet:office:created', async (officeId: string, sourceOfficeId?: string) => {
  console.log(`[Office] Fleet V-Team office created: ${officeId} (source: ${sourceOfficeId ?? 'none'})`);

  // Transfer Arthur's meeting session to the fleet office so it's accessible there
  if (sourceOfficeId && window.copilotBridge?.transferSession) {
    try {
      const result = await window.copilotBridge.transferSession(sourceOfficeId, officeId, 'architect');
      console.log(`[Office] Arthur session transfer: ${result.success ? 'OK' : result.error ?? 'failed'}`);
    } catch (e) {
      console.warn('[Office] Failed to transfer Arthur session:', e);
    }
  }

  switchToOffice(officeId);
});

console.log('[CopilotOffice] Started - Phaser 3 renderer with multi-office support');
