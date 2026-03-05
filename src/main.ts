// AgencyOffice - Main Entry Point
// Phaser 3 office visualization with split terminal view

import Phaser from 'phaser';
import { BootScene } from './scenes/BootScene';
import { OfficeScene } from './scenes/OfficeScene';
import { officeManager } from './office/officeManager';
import { AGENTS } from './config/agents';

// ── State ────────────────────────────────────────────────────

officeManager.ensureDefaultOffice();

function getCurrentAgentTools(): Map<string, { toolId: string; name: string; status: string }[]> {
  return officeManager.currentOffice?.agentTools || new Map();
}

let selectedAgentId: string | null = null;
let interactingWithAgent: string | null = null;
let phaserGameRef: Phaser.Game | undefined;

// ── Agent Preload Status ────────────────────────────────────────
const agentPreloadStatus: Map<string, 'preloading' | 'ready' | 'failed'> = new Map();

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
container.style.cssText = 'display: flex; flex-direction: column; width: 100%; height: calc(100% - 32px);';

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
  font-size: 36px;
`;
container.appendChild(tabsBar);

// Main content area (split view)
const mainContent = document.createElement('div');
mainContent.style.cssText = 'display: flex; flex: 1; min-height: 0;';
container.appendChild(mainContent);

// Left panel: Phaser renders here
const officePanel = document.createElement('div');
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
          font-size: 24px;
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
}

function switchToOffice(officeId: string) {
  interactingWithAgent = null;
  selectedAgentId = null;

  officeManager.switchOffice(officeId);

  phaserGame?.events.emit('office:switch', officeId, officeManager.currentOffice?.config.workingDirectory);

  renderOfficeTabs();
  updateTerminalContent();
  updateStatusBar();

  console.log(`[Office] Switched to office: ${officeManager.currentOffice?.config.name}`);
}

function showNewOfficeDialog() {
  const name = prompt('Enter office name:', 'New Office');
  if (!name) return;

  const path = prompt('Enter working directory path:', '.');
  if (!path) return;

  officeManager.createOffice(name, path);
  renderOfficeTabs();
  updateTerminalContent();

  console.log(`[Office] Created new office: ${name} at ${path}`);
}

function showEditOfficeDialog(officeId: string) {
  const office = officeManager.getOffice(officeId);
  if (!office) return;

  const action = prompt(
    `Office: ${office.config.name}\nPath: ${office.config.workingDirectory}\n\nEnter action:\n- "rename" to change name\n- "path" to change working directory\n- "delete" to remove office`,
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
`;
terminalHeader.innerHTML = `
  <div id="terminal-title" style="font-size: 18px; font-weight: bold; color: #8af; margin-bottom: 4px;">🏢 Office Overview</div>
  <div id="terminal-subtitle" style="font-size: 12px; color: #555;"></div>
`;
terminalPanel.appendChild(terminalHeader);

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
  height: 32px;
  background: #252538;
  border-top: 1px solid #333;
  display: flex;
  align-items: center;
  padding: 0 12px;
  font-family: monospace;
  font-size: 12px;
  color: #888;
  z-index: 100;
`;
document.body.appendChild(statusBar);

// ── Terminal Content Updates ────────────────────────────────────

let lastTerminalContentHtml = '';
let lastStatusBarHtml = '';

function updateTerminalContent() {
  if (interactingWithAgent) return;
  scheduleTerminalContentUpdate();
}

function updateTerminalContentNow() {
  if (interactingWithAgent) return;

  const agentTools = getCurrentAgentTools();
  const office = officeManager.currentOffice;

  // Update subtitle
  const subtitle = document.getElementById('terminal-subtitle');
  if (subtitle) {
    subtitle.textContent = office
      ? `${office.config.name}  ·  ${office.config.workingDirectory}`
      : 'No office selected';
  }

  // Build cards from the static AGENTS config (always visible, not just when active)
  let html = '';
  for (const agent of AGENTS) {
    const liveStatus = office?.agents.get(agent.id);
    const tools = agentTools.get(agent.id) || [];

    // Determine status label + color
    let statusDot = '#555';
    let statusLabel = 'Idle';
    let statusIcon = '○';
    if (liveStatus?.currentTool) {
      statusDot = '#50fa7b';
      statusLabel = liveStatus.currentTool;
      statusIcon = '▶';
    } else if (liveStatus?.bubbleType === 'waiting') {
      statusDot = '#ffb86c';
      statusLabel = 'Waiting for input';
      statusIcon = '⏳';
    }

    const colorHex = '#' + agent.color.toString(16).padStart(6, '0');
    const isSelected = agent.id === selectedAgentId;
    const borderColor = isSelected ? '#6677ff' : '#252540';
    const bgColor = isSelected ? '#1e1e3a' : '#13131f';

    html += `
      <div class="agent-card" data-agent="${agent.id}" style="
        background: ${bgColor};
        border: 1.5px solid ${borderColor};
        border-radius: 10px;
        padding: 14px 16px;
        margin-bottom: 10px;
        cursor: pointer;
        transition: border-color 0.15s;
        display: flex;
        align-items: stretch;
        gap: 14px;
      ">
        <div style="
          flex-shrink: 0;
          width: 64px;
          background: ${colorHex}22;
          border: 1px solid ${colorHex}44;
          border-radius: 8px;
          display: flex;
          align-items: center;
          justify-content: center;
          overflow: hidden;
        ">
          <canvas
            id="overview-sprite-${agent.id}"
            width="32" height="34"
            style="image-rendering: pixelated; width: 64px; height: 68px; display: block;"
          ></canvas>
        </div>
        <div style="flex: 1; min-width: 0; display: flex; flex-direction: column; justify-content: space-between; gap: 4px;">
          <div>
            <div style="font-weight: bold; color: #dde; font-size: 15px;">${agent.name}</div>
            <div style="color: #778; font-size: 11px; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;">${agent.description}</div>
          </div>
          <div style="display: flex; align-items: center; justify-content: space-between; margin-top: 4px;">
            <div style="
              font-size: 11px;
              color: ${statusDot};
              display: flex; align-items: center; gap: 4px;
            ">
              <span style="font-size: 8px;">●</span>
              <span>${statusIcon === '○' ? 'Idle' : statusLabel}</span>
            </div>
            ${tools.length > 0 ? `<div style="color: #667; font-size: 10px;">▸ ${tools[tools.length - 1].status}</div>` : ''}
          </div>
        </div>
      </div>
    `;
  }

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
    for (const agent of AGENTS) {
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
    const card = (e.target as HTMLElement).closest('.agent-card');
    if (card) {
      const agentId = (card as HTMLElement).dataset.agent ?? null;
      if (!agentId) return;
      selectedAgentId = agentId;
      updateTerminalContent();
      // Open the agent's terminal overlay via OfficeScene
      phaserGame?.events.emit('open:agent:terminal', agentId);
    }
  });
}

function stopInteraction() {
  interactingWithAgent = null;
  phaserGame?.events.emit('terminal:close');
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

    officeManager.setAgentActive(officeId, agentId, toolName, status);

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
      const remaining = tools.filter(t => t.toolId !== toolId);
      agentTools.set(agentId, remaining);

      if (remaining.length === 0) {
        officeManager.setAgentActive(officeId, agentId, null, null);
      } else {
        const last = remaining[remaining.length - 1];
        officeManager.setAgentActive(officeId, agentId, last.name, last.status);
      }
    }

    updateTerminalContent();
    updateStatusBar();
  });

  window.copilotBridge.onCopilotTurnEnd((agentId) => {
    console.log(`[Office] Turn end: ${agentId}`);
    const officeId = officeManager.currentOfficeId;
    if (officeId) officeManager.setAgentWaiting(officeId, agentId);
    updateTerminalContent();
    updateStatusBar();
  });

  window.copilotBridge.onCopilotUserMessage((agentId) => {
    console.log(`[Office] User message: ${agentId}`);
    const officeId = officeManager.currentOfficeId;
    if (officeId) officeManager.clearAgentBubble(officeId, agentId);
    updateTerminalContent();
  });

  window.copilotBridge.onTerminalPreloadStatus((agentId, status) => {
    console.log(`[Office] Preload status for ${agentId}: ${status}`);
    agentPreloadStatus.set(agentId, status);
    updateStatusBar();
  });

}

// ── Status Bar ────────────────────────────────────────────────────

function updateStatusBarNow() {
  const office = officeManager.currentOffice;
  const agents = office ? Array.from(office.agents.values()) : [];
  const activeCount = agents.filter(a => a.currentTool !== null).length;
  const waitingCount = agents.filter(a => a.bubbleType === 'waiting').length;
  const officeName = officeManager.currentOffice?.config.name || 'No Office';

  let preloadInfo = '';
  agentPreloadStatus.forEach((status, agentId) => {
    const agent = AGENTS.find(a => a.id === agentId);
    const name = agent?.name || agentId;
    const color = status === 'ready' ? '#4f4' : status === 'preloading' ? '#ff4' : '#f44';
    const label = status === 'ready' ? '✓' : status === 'preloading' ? '⟳' : '✗';
    preloadInfo += `<span style="color: ${color}; margin-right: 8px;">${name}: ${label}</span>`;
  });

  const html = `
    <span style="margin-right: 16px; color: #8af;">${officeName}</span>
    <span style="margin-right: 16px;">Agents: ${agents.length}</span>
    <span style="margin-right: 16px; color: #6f6;">Active: ${activeCount}</span>
    <span style="margin-right: 16px; color: #fa4;">Waiting: ${waitingCount}</span>
    ${preloadInfo ? `<span style="margin-right: 16px;">Preload: ${preloadInfo}</span>` : ''}
    <span style="flex: 1;"></span>
    <span style="color: #666;">WASD: Walk | Shift: Run | Space: Talk | F10: Close terminal</span>
  `;

  if (html !== lastStatusBarHtml) {
    lastStatusBarHtml = html;
    statusBar.innerHTML = html;
  }
}

updateStatusBar();

setupTerminalClickHandler();

updateTerminalContent();

// ── Phaser Game ────────────────────────────────────────────────────

const phaserGame = new Phaser.Game({
  type: Phaser.AUTO,
  parent: officePanel,
  width: officePanel.clientWidth || window.innerWidth / 2,
  height: officePanel.clientHeight || window.innerHeight,
  backgroundColor: '#1a1a2e',
  physics: { default: 'arcade', arcade: { debug: false } },
  scene: [BootScene, OfficeScene],
});

phaserGameRef = phaserGame;

// Focus the Phaser canvas when clicking the game pane so keyboard input works
officePanel.addEventListener('click', () => {
  const canvas = officePanel.querySelector('canvas');
  canvas?.focus();
});

// Once Phaser boots and textures are ready, draw sprites for the overview cards
phaserGame.events.once('ready', () => {
  drawOverviewSprites();
});

console.log('[AgencyOffice] Started - Phaser 3 renderer with multi-office support');
