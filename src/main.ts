// CopilotOffice - Main Entry Point
// Canvas-based office visualization with split terminal view

import { startGameLoop } from './office/engine/gameLoop';
import { OfficeState } from './office/engine/officeState';
import { renderFrame } from './office/engine/renderer';
import { ZOOM_DEFAULT, ZOOM_MIN, ZOOM_MAX, TILE_SIZE } from './office/constants';
import { officeManager, OfficeData } from './office/officeManager';
import { AGENTS } from './config/agents';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';

// ── State ────────────────────────────────────────────────────

// Initialize office manager with at least one office
officeManager.ensureDefaultOffice();

// Get current office state (will be updated when switching)
function getCurrentOfficeState(): OfficeState {
  return officeManager.currentOffice?.state || new OfficeState();
}

function getCurrentAgentTools(): Map<string, { toolId: string; name: string; status: string }[]> {
  return officeManager.currentOffice?.agentTools || new Map();
}

let zoom = ZOOM_DEFAULT;
let panX = 0;
let panY = 0;
let selectedAgentId: string | null = null;
let interactingWithAgent: string | null = null; // Currently talking to this agent
let nearbyAgentId: string | null = null; // Agent player is near (for E prompt)

// Interaction distance (in pixels)
const INTERACTION_DISTANCE = 48;

// ── XTerm Terminal Management ────────────────────────────────────
// Map of agentId -> { terminal, fitAddon, container }
const agentTerminals: Map<string, { terminal: Terminal; fitAddon: FitAddon; container: HTMLElement }> = new Map();
let activeTerminalAgentId: string | null = null;

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

// Left panel: Office visualization
const officePanel = document.createElement('div');
officePanel.style.cssText = 'width: 50%; height: 100%; position: relative;';
mainContent.appendChild(officePanel);

const officeCanvas = document.createElement('canvas');
officeCanvas.id = 'office-canvas';
officeCanvas.style.cssText = 'display: block; width: 100%; height: 100%;';
officePanel.appendChild(officeCanvas);

// Right panel: Terminal / Activity view
const terminalPanel = document.createElement('div');
terminalPanel.id = 'terminal-panel';
terminalPanel.style.cssText = `
  width: 50%;
  height: 100%;
  background: #1e1e2e;
  border-left: 2px solid #333;
  display: flex;
  flex-direction: column;
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
  
  // Add new office button
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
  
  // Add click handlers
  tabsBar.querySelectorAll('.office-tab').forEach(tab => {
    tab.addEventListener('click', (e) => {
      const target = e.target as HTMLElement;
      // Don't switch if clicking edit button
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
  // Reset interaction state
  interactingWithAgent = null;
  selectedAgentId = null;
  nearbyAgentId = null;
  
  // Switch office
  officeManager.switchOffice(officeId);
  
  // Update UI
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

// Initial render
renderOfficeTabs();

// Terminal header
const terminalHeader = document.createElement('div');
terminalHeader.style.cssText = `
  padding: 12px 16px;
  background: #252538;
  border-bottom: 1px solid #333;
  font-family: monospace;
  font-size: 21px;
  color: #8af;
`;
terminalHeader.innerHTML = '<span id="terminal-title">Agent Activity</span>';
terminalPanel.appendChild(terminalHeader);

// Terminal content area
const terminalContent = document.createElement('div');
terminalContent.id = 'terminal-content';
terminalContent.style.cssText = `
  flex: 1;
  padding: 16px;
  overflow: auto;
  font-family: monospace;
  font-size: 18px;
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

function updateTerminalContent() {
  const officeState = getCurrentOfficeState();
  const agentTools = getCurrentAgentTools();
  let html = '';
  
  // If interacting with an agent, xterm handles everything - just return
  if (interactingWithAgent && activeTerminalAgentId) {
    return;
  }
  
  const agents = Array.from(officeState.characters.values());
  
  if (agents.length === 0) {
    const currentOffice = officeManager.currentOffice;
    html = `<div style="color: #666; padding: 20px;">
      <div style="margin-bottom: 12px;">Office: <span style="color: #8af;">${currentOffice?.config.name || 'None'}</span></div>
      <div style="margin-bottom: 12px;">Path: <span style="color: #888;">${currentOffice?.config.workingDirectory || 'N/A'}</span></div>
      <div>No agents active. Waiting for Copilot sessions...</div>
    </div>`;
  } else {
    for (const char of agents) {
      const isSelected = char.agentId === selectedAgentId;
      const isNearby = char.agentId === nearbyAgentId;
      const bgColor = isSelected ? '#2a2a4a' : 'transparent';
      const borderColor = isSelected ? '#88f' : (isNearby ? '#4a4' : '#333');
      
      html += `<div class="agent-card" data-agent="${char.agentId}" style="background: ${bgColor}; border: 2px solid ${borderColor}; border-radius: 6px; padding: 12px; margin-bottom: 12px; cursor: pointer;">`;
      html += `<div style="color: #8af; font-weight: bold; margin-bottom: 8px;">Agent: ${char.agentId}</div>`;
      
      if (isNearby) {
        html += `<div style="color: #4f4; margin-bottom: 6px;">Press <span style="background: #3a5a3a; padding: 2px 6px; border-radius: 4px;">E</span> to talk</div>`;
      }
      
      if (char.currentToolStatus) {
        html += `<div style="color: #6f6;">▶ ${char.currentToolStatus}</div>`;
      } else if (char.bubbleType === 'waiting') {
        html += `<div style="color: #fa4;">⏳ Waiting for input...</div>`;
      } else {
        html += `<div style="color: #666;">Idle</div>`;
      }
      
      // Show recent tools
      const tools = agentTools.get(char.agentId) || [];
      if (tools.length > 0) {
        html += `<div style="color: #555; font-size: 14px; margin-top: 12px;">Recent:</div>`;
        for (const tool of tools.slice(-3)) {
          html += `<div style="color: #777; font-size: 14px; padding-left: 12px;">• ${tool.status}</div>`;
        }
      }
      
      html += `</div>`;
    }
  }
  
  terminalContent.innerHTML = html;
  
  // Add click handlers for agent cards
  terminalContent.querySelectorAll('.agent-card').forEach(card => {
    card.addEventListener('click', (e) => {
      const agentId = (e.currentTarget as HTMLElement).dataset.agent;
      if (agentId) {
        startInteraction(agentId);
      }
    });
  });
}

function startInteraction(agentId: string) {
  interactingWithAgent = agentId;
  selectedAgentId = agentId;
  officeState.selectedAgentId = agentId;
  console.log(`[Office] Started interaction with ${agentId}`);
  
  // Show xterm terminal for this agent
  showAgentTerminal(agentId);
  
  updateStatusBar();
}

function stopInteraction() {
  if (interactingWithAgent) {
    console.log(`[Office] Stopped interaction with ${interactingWithAgent}`);
    
    // Hide the active terminal
    hideAgentTerminal();
    
    interactingWithAgent = null;
    updateTerminalContent();
    updateStatusBar();
  }
}

async function showAgentTerminal(agentId: string) {
  // Hide any currently active terminal
  if (activeTerminalAgentId && activeTerminalAgentId !== agentId) {
    const prev = agentTerminals.get(activeTerminalAgentId);
    if (prev) {
      prev.container.style.display = 'none';
    }
  }
  
  // Check if we already have a terminal for this agent
  let termData = agentTerminals.get(agentId);
  
  if (!termData) {
    // Create new terminal
    const container = document.createElement('div');
    container.style.cssText = 'position: absolute; top: 0; left: 0; right: 0; bottom: 0; background: #1a1a2e;';
    terminalContent.appendChild(container);
    
    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: 'Consolas, "Courier New", monospace',
      theme: {
        background: '#1a1a2e',
        foreground: '#e0e0e0',
        cursor: '#ffffff',
        cursorAccent: '#1a1a2e',
        selectionBackground: '#4a4a6a',
      },
      scrollback: 10000,
      convertEol: true,
    });
    
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(container);
    fitAddon.fit();
    
    // Send keystrokes to backend
    terminal.onData((data) => {
      if (window.copilotBridge && activeTerminalAgentId) {
        window.copilotBridge.terminalWrite(activeTerminalAgentId, data);
      }
    });
    
    termData = { terminal, fitAddon, container };
    agentTerminals.set(agentId, termData);
    
    // Start terminal session on backend if not already running
    const agent = AGENTS.find(a => a.id === agentId);
    const result = await window.copilotBridge.terminalStart(agentId, agent?.workingDir);
    console.log(`[Office] Terminal start result for ${agentId}:`, result);
  } else {
    // Show existing terminal
    termData.container.style.display = 'block';
    termData.fitAddon.fit();
  }
  
  activeTerminalAgentId = agentId;
  termData.terminal.focus();
  
  // Hide the regular terminal content
  const regularContent = terminalContent.querySelector(':scope > :not(div[style*="position: absolute"])');
  if (regularContent) {
    (regularContent as HTMLElement).style.display = 'none';
  }
}

function hideAgentTerminal() {
  if (activeTerminalAgentId) {
    const termData = agentTerminals.get(activeTerminalAgentId);
    if (termData) {
      termData.container.style.display = 'none';
    }
    activeTerminalAgentId = null;
  }
  
  // Show regular terminal content again
  updateTerminalContent();
}

// Handle window resize for terminal
window.addEventListener('resize', () => {
  if (activeTerminalAgentId) {
    const termData = agentTerminals.get(activeTerminalAgentId);
    if (termData) {
      termData.fitAddon.fit();
      // Also notify backend of new size
      const dims = termData.fitAddon.proposeDimensions();
      if (dims && window.copilotBridge) {
        window.copilotBridge.terminalResize(activeTerminalAgentId, dims.cols, dims.rows);
      }
    }
  }
});

// Find nearest agent to player
function updateNearbyAgent() {
  const officeState = getCurrentOfficeState();
  if (!officeState.player) {
    nearbyAgentId = null;
    return;
  }
  
  let nearest: string | null = null;
  let nearestDist = INTERACTION_DISTANCE;
  
  for (const char of officeState.characters.values()) {
    const dx = char.x - officeState.player.x;
    const dy = char.y - officeState.player.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    
    if (dist < nearestDist) {
      nearestDist = dist;
      nearest = char.agentId;
    }
  }
  
  if (nearest !== nearbyAgentId) {
    nearbyAgentId = nearest;
    updateTerminalContent();
  }
}

// ── Canvas Resize ────────────────────────────────────────────────

function resizeCanvas() {
  const rect = officePanel.getBoundingClientRect();
  officeCanvas.width = rect.width;
  officeCanvas.height = rect.height;
}

window.addEventListener('resize', resizeCanvas);
resizeCanvas();

// ── Input Handling ────────────────────────────────────────────────

// Track pressed keys for WASD movement
const keysPressed = new Set<string>();
let officePanelFocused = false;
let shiftHeld = false;

officePanel.tabIndex = 0; // Make focusable
officePanel.style.outline = 'none';

officePanel.addEventListener('focus', () => {
  officePanelFocused = true;
  officePanel.style.boxShadow = 'inset 0 0 0 2px #4488ff';
});

officePanel.addEventListener('blur', () => {
  officePanelFocused = false;
  officePanel.style.boxShadow = 'none';
});

// WASD keyboard controls + Shift for run + Enter to spawn + E to interact
document.addEventListener('keydown', (e) => {
  // Track shift globally
  if (e.key === 'Shift') {
    shiftHeld = true;
  }
  
  // ESC to stop interaction (works globally)
  if (e.key === 'Escape' && interactingWithAgent) {
    stopInteraction();
    e.preventDefault();
    return;
  }
  
  if (!officePanelFocused) return;
  
  // Enter key to spawn player
  const officeState = getCurrentOfficeState();
  if (e.key === 'Enter' && !officeState.playerInOffice) {
    console.log('[Office] Player entering office via Enter key!');
    officeState.spawnPlayer();
    updateStatusBar();
    e.preventDefault();
    return;
  }
  
  // E key to interact with nearby agent or stop interaction
  if (e.key.toLowerCase() === 'e') {
    if (interactingWithAgent) {
      stopInteraction();
    } else if (nearbyAgentId) {
      startInteraction(nearbyAgentId);
    }
    e.preventDefault();
    return;
  }
  
  const key = e.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(key)) {
    keysPressed.add(key);
    e.preventDefault();
  }
});

document.addEventListener('keyup', (e) => {
  if (e.key === 'Shift') {
    shiftHeld = false;
  }
  
  const key = e.key.toLowerCase();
  if (['w', 'a', 's', 'd'].includes(key)) {
    keysPressed.delete(key);
    if (keysPressed.size === 0) {
      getCurrentOfficeState().stopPlayer();
    }
  }
});

officeCanvas.addEventListener('wheel', (e) => {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -1 : 1;
  zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, zoom + delta));
  updateStatusBar();
});

let isPanning = false;
let lastX = 0;
let lastY = 0;

officeCanvas.addEventListener('mousedown', (e) => {
  if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
    isPanning = true;
    lastX = e.clientX;
    lastY = e.clientY;
    e.preventDefault();
  }
});

officeCanvas.addEventListener('mousemove', (e) => {
  if (isPanning) {
    panX += e.clientX - lastX;
    panY += e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
  }
});

officeCanvas.addEventListener('mouseup', () => isPanning = false);
officeCanvas.addEventListener('mouseleave', () => isPanning = false);

// Helper: Convert screen to world coordinates
function screenToWorld(screenX: number, screenY: number): { worldX: number; worldY: number } {
  const officeState = getCurrentOfficeState();
  const cols = officeState.tileMap[0]?.length || 0;
  const rows = officeState.tileMap.length;
  const mapW = cols * TILE_SIZE * zoom;
  const mapH = rows * TILE_SIZE * zoom;
  const offsetX = Math.floor((officeCanvas.width - mapW) / 2) + panX;
  const offsetY = Math.floor((officeCanvas.height - mapH) / 2) + panY;
  
  return {
    worldX: (screenX - offsetX) / zoom,
    worldY: (screenY - offsetY) / zoom,
  };
}

// Click to select character or enter office
officeCanvas.addEventListener('click', (e) => {
  if (isPanning) return;
  
  const officeState = getCurrentOfficeState();
  const rect = officeCanvas.getBoundingClientRect();
  const clickX = e.clientX - rect.left;
  const clickY = e.clientY - rect.top;
  
  const { worldX, worldY } = screenToWorld(clickX, clickY);
  
  // Check for entrance rug click
  if (!officeState.playerInOffice && officeState.isEntranceClick(worldX, worldY)) {
    console.log('[Office] Player entering office!');
    officeState.spawnPlayer();
    officePanel.focus();
    updateStatusBar();
    return;
  }
  
  // Find clicked character - start interaction
  for (const char of officeState.characters.values()) {
    const dx = Math.abs(char.x - worldX);
    const dy = Math.abs(char.y - worldY);
    if (dx < 12 && dy < 20) {
      startInteraction(char.agentId);
      return;
    }
  }
  
  // Clicked empty space - deselect
  selectedAgentId = null;
  officeState.selectedAgentId = null;
  updateTerminalContent();
});

// ── Copilot Event Handlers ────────────────────────────────────────

if (window.copilotBridge) {
  // Tool started
  window.copilotBridge.onCopilotToolStart((agentId, toolName, toolId, status) => {
    console.log(`[Office] Tool start: ${agentId} - ${toolName} - ${status}`);
    
    const officeState = getCurrentOfficeState();
    const agentTools = getCurrentAgentTools();
    
    // Ensure agent exists
    if (!officeState.getCharacter(agentId)) {
      officeState.addAgent(agentId);
    }
    
    // Track tool
    if (!agentTools.has(agentId)) {
      agentTools.set(agentId, []);
    }
    agentTools.get(agentId)!.push({ toolId, name: toolName, status });
    
    // Update character state
    officeState.setAgentActive(agentId, toolName, status);
    
    updateTerminalContent();
    updateStatusBar();
  });
  
  // Tool completed
  window.copilotBridge.onCopilotToolComplete((agentId, toolId, success) => {
    console.log(`[Office] Tool complete: ${agentId} - ${toolId} - ${success}`);
    
    const officeState = getCurrentOfficeState();
    const agentTools = getCurrentAgentTools();
    
    const tools = agentTools.get(agentId);
    if (tools) {
      const remaining = tools.filter(t => t.toolId !== toolId);
      agentTools.set(agentId, remaining);
      
      if (remaining.length === 0) {
        officeState.setAgentActive(agentId, null, null);
      } else {
        const last = remaining[remaining.length - 1];
        officeState.setAgentActive(agentId, last.name, last.status);
      }
    }
    
    updateTerminalContent();
    updateStatusBar();
  });
  
  // Turn ended (waiting for user)
  window.copilotBridge.onCopilotTurnEnd((agentId) => {
    console.log(`[Office] Turn end: ${agentId}`);
    getCurrentOfficeState().setAgentWaiting(agentId);
    updateTerminalContent();
    updateStatusBar();
  });
  
  // User message (new turn starting)
  window.copilotBridge.onCopilotUserMessage((agentId) => {
    console.log(`[Office] User message: ${agentId}`);
    getCurrentOfficeState().clearAgentBubble(agentId);
    updateTerminalContent();
  });
  
  // Terminal data - feed to xterm
  window.copilotBridge.onTerminalData((agentId, data) => {
    const termData = agentTerminals.get(agentId);
    if (termData) {
      termData.terminal.write(data);
    }
  });
  
  // Terminal exit
  window.copilotBridge.onTerminalExit((agentId, exitCode) => {
    console.log(`[Office] Terminal exited for ${agentId} with code ${exitCode}`);
    const termData = agentTerminals.get(agentId);
    if (termData) {
      termData.terminal.writeln(`\r\n[Terminal exited with code ${exitCode}]`);
    }
  });
}

// ── Status Bar ────────────────────────────────────────────────────

function updateStatusBar() {
  const officeState = getCurrentOfficeState();
  const agents = Array.from(officeState.characters.values());
  const activeCount = agents.filter(a => a.isActive).length;
  const waitingCount = agents.filter(a => a.bubbleType === 'waiting').length;
  const playerStatus = officeState.playerInOffice ? 'In Office' : 'Press Enter to join';
  const officeName = officeManager.currentOffice?.config.name || 'No Office';
  
  let controlHints = '';
  if (interactingWithAgent) {
    controlHints = 'E/ESC: Stop talking';
  } else if (officeState.playerInOffice) {
    controlHints = 'WASD: Walk | Shift: Run';
    if (nearbyAgentId) {
      controlHints += ' | <span style="color: #4f4;">E: Talk</span>';
    }
  } else {
    controlHints = 'Enter: Join';
  }
  
  statusBar.innerHTML = `
    <span style="margin-right: 16px; color: #8af;">${officeName}</span>
    <span style="margin-right: 16px;">Agents: ${agents.length}</span>
    <span style="margin-right: 16px; color: #6f6;">Active: ${activeCount}</span>
    <span style="margin-right: 16px; color: #fa4;">Waiting: ${waitingCount}</span>
    <span style="margin-right: 16px; color: ${officeState.playerInOffice ? '#8f8' : '#888'};">Player: ${playerStatus}</span>
    <span style="margin-right: 16px;">Zoom: ${zoom}x</span>
    <span style="flex: 1;"></span>
    <span style="color: #666;">${controlHints} | Scroll: Zoom</span>
  `;
}

updateStatusBar();
updateTerminalContent();

// ── Demo: Add agents from config ────────────────────────────────────────

const officeState = getCurrentOfficeState();
for (const agent of AGENTS) {
  // Position x/y in config maps to col/row (chairs are at row = desk_row + 1)
  const char = officeState.addAgent(agent.id, agent.position.x, agent.position.y);
  console.log(`[Office] Added agent ${agent.name} (${agent.id}) at col=${agent.position.x}, row=${agent.position.y}`);
}
updateTerminalContent();

// ── Game Loop ────────────────────────────────────────────────────

const stop = startGameLoop(officeCanvas, {
  update: (dt) => {
    const officeState = getCurrentOfficeState();
    
    // Process WASD movement if player is in office
    if (officeState.playerInOffice && officePanelFocused) {
      let dx = 0;
      let dy = 0;
      if (keysPressed.has('w')) dy -= 1;
      if (keysPressed.has('s')) dy += 1;
      if (keysPressed.has('a')) dx -= 1;
      if (keysPressed.has('d')) dx += 1;
      
      if (dx !== 0 || dy !== 0) {
        // Normalize diagonal movement
        const len = Math.sqrt(dx * dx + dy * dy);
        // Half speed normally, full speed with shift (run)
        const speedMult = shiftHeld ? 1.0 : 0.5;
        officeState.movePlayer(dx / len, dy / len, speedMult);
      }
    }
    
    // Check for nearby agents
    updateNearbyAgent();
    
    officeState.update(dt);
  },
  render: (ctx) => {
    const officeState = getCurrentOfficeState();
    
    // Collect all characters including player
    const allCharacters = Array.from(officeState.characters.values());
    if (officeState.player) {
      allCharacters.push(officeState.player);
    }
    
    renderFrame(
      ctx,
      officeCanvas.width,
      officeCanvas.height,
      officeState.tileMap,
      officeState.furniture,
      allCharacters,
      zoom,
      panX,
      panY,
      {
        selectedAgentId: officeState.selectedAgentId,
        hoveredAgentId: officeState.hoveredAgentId,
        hoveredTile: null,
        seats: officeState.seats,
        characters: officeState.characters,
      }
    );
  }
});

console.log('[CopilotOffice] Started - Multi-office support with WASD player controls');

