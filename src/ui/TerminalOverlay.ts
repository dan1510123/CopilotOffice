import Phaser from 'phaser';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { AgentConfig } from '../config/agents';
import { InputManager } from '../input/InputManager';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`IPC timeout: ${label} after ${ms}ms`)), ms)
    ),
  ]);
}

const IPC_TIMEOUT = 10_000;

export class TerminalOverlay {
  private scene: Phaser.Scene;
  private container: HTMLDivElement | null = null;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private currentAgentId: string | null = null;
  private currentAgent: AgentConfig | null = null;
  private isVisible: boolean = false;
  private onCloseCallback: (() => void) | null = null;
  private headerElement: HTMLDivElement | null = null;
  private footerElement: HTMLDivElement | null = null;
  private terminalDiv: HTMLDivElement | null = null;
  private sessionId: string | null = null;
  private sessionIdElement: HTMLSpanElement | null = null;
  private historyPopover: HTMLDivElement | null = null;
  private inputManager: InputManager;

  constructor(scene: Phaser.Scene, inputManager: InputManager) {
    this.scene = scene;
    this.inputManager = inputManager;
    this.setupTerminalListeners();
  }

  private setupTerminalListeners(): void {
    if (typeof window !== 'undefined' && window.copilotBridge) {
      window.copilotBridge.onTerminalData((agentId: string, data: string) => {
        if (agentId === this.currentAgentId && this.terminal) {
          this.terminal.write(data);
          // Try to capture session ID from copilot output
          this.parseSessionId(data);
        }
      });

      window.copilotBridge.onTerminalExit((agentId: string, exitCode: number) => {
        if (agentId === this.currentAgentId && this.terminal) {
          this.terminal.writeln(`\r\n[Process exited with code ${exitCode}]`);
        }
      });
    }
  }

  private parseSessionId(data: string): void {
    // Look for session ID patterns in copilot output
    // Copilot typically shows session path like: ~/.copilot/session-state/abc-123-def-456
    const patterns = [
      // UUID format (8-4-4-4-12)
      /session-state[\/\\]([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/i,
      // Any path with session-state followed by ID
      /session-state[\/\\]([a-f0-9-]{20,})/i,
      // "Session: <id>" or "session: <id>"
      /[Ss]ession[:\s]+([a-f0-9-]{36})/,
      /[Ss]ession[:\s]+([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})/,
      // Session ID on its own line (UUID format)
      /\b([a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12})\b/,
    ];
    
    for (const pattern of patterns) {
      const match = data.match(pattern);
      if (match && match[1] && match[1].length >= 20) {
        this.sessionId = match[1];
        this.updateSessionDisplay();
        
        // Save session ID for persistence (resume on game restart)
        if (this.currentAgentId && window.copilotBridge) {
          withTimeout(
            window.copilotBridge.saveSessionId(this.currentAgentId, this.sessionId),
            IPC_TIMEOUT, 'saveSessionId'
          ).catch(() => { /* non-critical */ });
        }
        break;
      }
    }
  }

  private updateSessionDisplay(): void {
    // Re-get element in case DOM changed
    const el = document.getElementById('session-id-display') as HTMLSpanElement;
    if (el && this.sessionId) {
      el.textContent = this.sessionId;
      el.title = `Click to copy. Resume with: copilot --resume ${this.sessionId}`;
      el.onclick = () => this.copySessionId();
    }
  }

  async show(agent: AgentConfig, onClose: () => void): Promise<void> {
    this.currentAgentId = agent.id;
    this.onCloseCallback = onClose;

    // Store current agent for workingDir access
    this.currentAgent = agent;

    // Create container if it doesn't exist
    if (!this.container) {
      this.createContainer();
    }

    // Update header with inception indicator for admin
    const inceptionBadge = agent.id === 'admin' ? ' 🎭 INCEPTION MODE' : '';
    if (this.headerElement) {
      this.headerElement.innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px;">
          <span style="color: #00ff88; font-weight: bold; font-size: 18px;">💬 Talking to ${agent.name}</span>
          <span style="color: #ff88ff; font-size: 16px;">${inceptionBadge}</span>
          <span style="color: #888; font-size: 14px;">${agent.description}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 15px;">
          <span style="color: #666; font-size: 14px;">[F10] Close  [Ctrl+Shift+N] New Session</span>
          <button id="close-terminal-btn" style="background: #ff4444; border: none; color: white; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 16px;">✕ CLOSE</button>
        </div>
      `;
      
      // Add close button handler
      const closeBtn = document.getElementById('close-terminal-btn');
      if (closeBtn) {
        closeBtn.onclick = () => this.hide();
      }
    }

    if (this.container) {
      this.container.style.display = 'flex';
    }
    
    // Update agent display in footer
    const colorHex = '#' + agent.color.toString(16).padStart(6, '0');
    const agentNameDisplay = document.getElementById('agent-name-display');
    if (agentNameDisplay) {
      agentNameDisplay.textContent = agent.name;
      agentNameDisplay.style.color = colorHex;
    }
    
    // Draw agent sprite
    this.drawAgentSprite(agent);

    // Create or reuse terminal
    if (!this.terminal) {
      this.createTerminal();
    } else {
      // Reusing existing terminal for a returning session — clear screen but preserve state
      this.terminal.clear();
    }

    // Reset session ID for this agent
    this.sessionId = null;

    // Check if terminal session exists, if not start one
    if (window.copilotBridge) {
      try {
        const exists = await withTimeout(
          window.copilotBridge.terminalExists(agent.id),
          IPC_TIMEOUT, 'terminalExists'
        );
        if (!exists) {
          await this.startNewSession(agent.id, agent.workingDir);
        } else {
          // Session exists - reattach by triggering a resize (SIGWINCH), which forces
          // the Copilot CLI TUI to fully redraw at the correct dimensions and cursor position.
          // Do NOT replay raw scrollback — it fights with the live PTY cursor position.
          await withTimeout(
            window.copilotBridge.terminalAttach(agent.id),
            IPC_TIMEOUT, 'terminalAttach'
          );

          // Fit the xterm viewport first, then send resize to PTY
          this.fitAddon?.fit();
          const dims = this.fitAddon?.proposeDimensions();
          if (dims && window.copilotBridge) {
            await withTimeout(
              window.copilotBridge.terminalResize(agent.id, dims.cols, dims.rows),
              IPC_TIMEOUT, 'terminalResize'
            ).catch(() => {});
          }

          // Try to get saved session ID
          const savedId = await withTimeout(
            window.copilotBridge.getSessionId(agent.id),
            IPC_TIMEOUT, 'getSessionId'
          );
          if (savedId) {
            this.sessionId = savedId;
            this.updateSessionDisplay();
          }
        }
      } catch (e) {
        this.terminal?.writeln(`\r\n\x1b[31m[${e}]\x1b[0m\r\n`);
      }
      
      // Resize terminal - need to wait for container to be fully rendered
      if (this.fitAddon && this.terminal) {
        const doFit = () => {
          this.fitAddon?.fit();
          const dims = this.fitAddon?.proposeDimensions();
          if (dims && window.copilotBridge) {
            withTimeout(
              window.copilotBridge.terminalResize(agent.id, dims.cols, dims.rows),
              IPC_TIMEOUT, 'terminalResize'
            ).catch(() => { /* non-critical */ });
          }
          this.terminal?.focus();
        };
        // Run after layout is painted (rAF → rAF ensures two frames so flex layout settles)
        requestAnimationFrame(() => requestAnimationFrame(doFit));
      }
    }

    this.isVisible = true;

    // Highlight the matching NPC in the game and glow the profile canvas
    this.scene.game.events.emit('npc:highlight', agent.id);
    const spriteCanvas = document.getElementById('agent-sprite-canvas') as HTMLCanvasElement | null;
    if (spriteCanvas) {
      const colorHex = '#' + agent.color.toString(16).padStart(6, '0');
      spriteCanvas.style.boxShadow = `0 0 18px 6px ${colorHex}99, 0 0 6px 2px ${colorHex}`;
      spriteCanvas.style.border = `2px solid ${colorHex}`;
    }

    // F10 always closes — active regardless of which side has keyboard focus
    this.inputManager.activateTerminalF10(() => this.hide());

    this.focusTerminal();
  }

  private drawAgentSprite(agent: AgentConfig): void {
    // Get sprite texture from Phaser and draw to canvas
    setTimeout(() => {
      const canvas = document.getElementById('agent-sprite-canvas') as HTMLCanvasElement;
      if (!canvas) return;
      
      const ctx = canvas.getContext('2d');
      if (!ctx) return;
      
      // Get the texture from Phaser
      const texture = this.scene.textures.get(agent.sprite);
      if (!texture || texture.key === '__MISSING') return;
      
      const source = texture.getSourceImage() as HTMLImageElement | HTMLCanvasElement;
      if (source) {
        ctx.imageSmoothingEnabled = false;
        ctx.drawImage(source, 0, 0);
      }
    }, 50);
  }

  private async startNewSession(agentId: string, workingDir?: string): Promise<void> {
    this.sessionId = null;
    this.updateSessionDisplay();
    
    const el = document.getElementById('session-id-display');
    if (el) {
      el.textContent = 'starting...';
    }

    // Fit xterm first so we know the real dimensions to spawn the PTY at
    this.fitAddon?.fit();
    const dims = this.fitAddon?.proposeDimensions();

    const result = await withTimeout(
      window.copilotBridge.terminalStart(agentId, workingDir, dims?.cols, dims?.rows),
      IPC_TIMEOUT, 'terminalStart'
    );
    if (!result.success) {
      this.terminal?.writeln(`Failed to start terminal: ${result.error}`);
    }
  }

  private fetchSessionId(agentId: string): void {
    // Send /session command to get session ID from copilot
    if (window.copilotBridge && !this.sessionId) {
      const el = document.getElementById('session-id-display');
      if (el) {
        el.textContent = 'fetching...';
      }
      // Send the /session command with carriage return to submit
      setTimeout(() => {
        window.copilotBridge.terminalWrite(agentId, '/session\r');
      }, 200);
    }
  }

  private createContainer(): void {
    this.container = document.createElement('div');
    this.container.id = 'terminal-overlay';
    this.container.style.cssText = `
      position: absolute;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      background: #0a0a14;
      border: none;
      border-radius: 0;
      display: none;
      flex-direction: column;
      z-index: 10000;
    `;

    // Header
    this.headerElement = document.createElement('div');
    this.headerElement.style.cssText = `
      padding: 12px 20px;
      background: #1a1a2e;
      border-bottom: 1px solid #3a5a8a;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 14px;
      color: #fff;
      border-radius: 6px 6px 0 0;
      display: flex;
      justify-content: space-between;
      align-items: center;
      flex-shrink: 0;
    `;
    this.container.appendChild(this.headerElement);

    // Terminal container — outer div holds the padding; xterm opens into the inner div.
    // IMPORTANT: never add padding to the element xterm.open() is called on — it breaks
    // FitAddon geometry and misaligns the internal textarea/canvas overlay.
    const terminalOuter = document.createElement('div');
    terminalOuter.id = 'terminal-container';
    terminalOuter.style.cssText = `
      flex: 1;
      overflow: hidden;
      min-height: 0;
      padding: 10px;
      box-sizing: border-box;
    `;
    this.terminalDiv = document.createElement('div');
    this.terminalDiv.style.cssText = `
      width: 100%;
      height: 100%;
      overflow: hidden;
    `;
    terminalOuter.appendChild(this.terminalDiv);
    // Click anywhere in the padded area to focus terminal
    terminalOuter.addEventListener('click', () => {
      this.terminal?.focus();
    });
    this.container.appendChild(terminalOuter);

    // Footer with session info and agent sprite
    this.footerElement = document.createElement('div');
    this.footerElement.style.cssText = `
      padding: 15px 20px;
      background: #1a1a2e;
      border-top: 1px solid #3a5a8a;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 14px;
      color: #888;
      border-radius: 0 0 6px 6px;
      display: flex;
      flex-shrink: 0;
      justify-content: space-between;
      align-items: center;
    `;
    
    // Left side: Agent sprite and name (big)
    const agentDisplay = document.createElement('div');
    agentDisplay.id = 'agent-display';
    agentDisplay.style.cssText = `
      display: flex;
      align-items: center;
      gap: 15px;
    `;
    agentDisplay.innerHTML = `
      <canvas id="agent-sprite-canvas" width="32" height="34" style="image-rendering: pixelated; width: 160px; height: 170px; border-radius: 8px;"></canvas>
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <span id="agent-name-display" style="font-weight: bold; font-size: 28px;"></span>
        <span style="color: #666; font-size: 12px;">Session ID: <span id="session-id-display" style="color: #4a9eff; cursor: pointer;">--</span></span>
      </div>
    `;
    this.footerElement.appendChild(agentDisplay);
    
    // Right side: Button grid (Session History + Clear History | New Session + Close Session)
    const buttonGrid = document.createElement('div');
    buttonGrid.style.cssText = `
      display: grid;
      grid-template-columns: auto auto;
      gap: 8px;
    `;

    const btnStyle = `
      background: #2a3a4a;
      border: 1px solid #4a5a6a;
      color: #aaa;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 13px;
      white-space: nowrap;
    `;

    // Session History button (top-left)
    const historyBtn = document.createElement('button');
    historyBtn.textContent = '📜 Session History';
    historyBtn.style.cssText = btnStyle;
    historyBtn.onmouseover = () => historyBtn.style.background = '#3a4a5a';
    historyBtn.onmouseout = () => historyBtn.style.background = '#2a3a4a';
    historyBtn.onclick = () => this.toggleSessionHistory(historyBtn);
    buttonGrid.appendChild(historyBtn);

    // New Session button (top-right)
    const newSessionBtn = document.createElement('button');
    newSessionBtn.textContent = '🔄 New Session';
    newSessionBtn.style.cssText = btnStyle;
    newSessionBtn.onmouseover = () => newSessionBtn.style.background = '#3a4a5a';
    newSessionBtn.onmouseout = () => newSessionBtn.style.background = '#2a3a4a';
    newSessionBtn.onclick = () => this.handleNewSession();
    buttonGrid.appendChild(newSessionBtn);

    // Clear History button (bottom-left)
    const clearHistoryBtn = document.createElement('button');
    clearHistoryBtn.textContent = '🗑️ Clear History';
    clearHistoryBtn.style.cssText = btnStyle;
    clearHistoryBtn.onmouseover = () => clearHistoryBtn.style.background = '#3a4a5a';
    clearHistoryBtn.onmouseout = () => clearHistoryBtn.style.background = '#2a3a4a';
    clearHistoryBtn.onclick = () => this.handleClearHistory();
    buttonGrid.appendChild(clearHistoryBtn);

    // Close Session button (bottom-right)
    const closeSessionBtn = document.createElement('button');
    closeSessionBtn.textContent = '⏹ Close Session';
    closeSessionBtn.style.cssText = btnStyle + 'color: #ff8888;';
    closeSessionBtn.onmouseover = () => { closeSessionBtn.style.background = '#4a2a2a'; };
    closeSessionBtn.onmouseout = () => { closeSessionBtn.style.background = '#2a3a4a'; };
    closeSessionBtn.onclick = () => this.handleCloseSession();
    buttonGrid.appendChild(closeSessionBtn);

    this.footerElement.appendChild(buttonGrid);
    
    this.container.appendChild(this.footerElement);

    const terminalPanel = document.getElementById('terminal-panel') || document.body;
    terminalPanel.appendChild(this.container);

    // Get reference to session ID element
    this.sessionIdElement = document.getElementById('session-id-display') as HTMLSpanElement;
    if (this.sessionIdElement) {
      this.sessionIdElement.onclick = () => this.copySessionId();
    }

    // Add xterm.css styles
    this.injectStyles();
  }

  private copySessionId(): void {
    if (this.sessionId) {
      navigator.clipboard.writeText(this.sessionId).then(() => {
        if (this.sessionIdElement) {
          const original = this.sessionIdElement.textContent;
          this.sessionIdElement.textContent = 'Copied!';
          this.sessionIdElement.style.color = '#50fa7b';
          setTimeout(() => {
            if (this.sessionIdElement) {
              this.sessionIdElement.textContent = original;
              this.sessionIdElement.style.color = '#4a9eff';
            }
          }, 1000);
        }
      });
    }
  }

  private async handleNewSession(): Promise<void> {
    if (!this.currentAgentId || !this.currentAgent) return;
    
    // Clear terminal
    this.terminal?.clear();
    this.terminal?.writeln('\x1b[33m[Starting new session...]\x1b[0m\r\n');
    
    // Kill existing and start new
    await withTimeout(
      window.copilotBridge.terminalKill(this.currentAgentId),
      IPC_TIMEOUT, 'terminalKill'
    ).catch(() => { /* may already be dead */ });
    await this.startNewSession(this.currentAgentId, this.currentAgent.workingDir);
  }

  private async handleCloseSession(): Promise<void> {
    if (!this.currentAgentId) return;

    try {
      const result = await withTimeout(
        window.copilotBridge.resetSession(this.currentAgentId),
        IPC_TIMEOUT, 'resetSession'
      );
      if (result.success && result.sessionId) {
        this.sessionId = result.sessionId;
        this.updateSessionDisplay();
      }
    } catch { /* ignore */ }

    // Notify the app to set this agent to slacking
    this.scene.game.events.emit('agent:session:closed', this.currentAgentId);

    this.hide();
  }

  private async toggleSessionHistory(anchorBtn: HTMLButtonElement): Promise<void> {
    // If popover already visible, close it
    if (this.historyPopover) {
      this.closeHistoryPopover();
      return;
    }
    if (!this.currentAgentId) return;

    let history: string[] = [];
    try {
      history = await withTimeout(
        window.copilotBridge.getSessionHistory(this.currentAgentId),
        IPC_TIMEOUT, 'getSessionHistory'
      );
    } catch { /* ignore */ }

    this.historyPopover = document.createElement('div');
    this.historyPopover.style.cssText = `
      position: absolute;
      bottom: 100%;
      right: 0;
      margin-bottom: 8px;
      background: #1a1a2e;
      border: 1px solid #3a5a8a;
      border-radius: 6px;
      padding: 12px;
      min-width: 320px;
      max-height: 250px;
      overflow-y: auto;
      z-index: 10001;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 12px;
      box-shadow: 0 -4px 12px rgba(0,0,0,0.5);
    `;

    if (history.length === 0) {
      this.historyPopover.innerHTML = '<div style="color: #666; text-align: center; padding: 10px;">No previous sessions</div>';
    } else {
      const title = document.createElement('div');
      title.textContent = `Session History (${history.length})`;
      title.style.cssText = 'color: #4a9eff; font-weight: bold; margin-bottom: 8px; font-size: 13px;';
      this.historyPopover.appendChild(title);

      // Show most recent first
      for (let i = history.length - 1; i >= 0; i--) {
        const entry = document.createElement('div');
        entry.style.cssText = `
          color: #888;
          padding: 4px 8px;
          border-radius: 3px;
          margin-bottom: 2px;
          display: flex;
          align-items: center;
          gap: 8px;
        `;
        entry.innerHTML = `<span style="color: #555;">#${i + 1}</span><span style="color: #aaa; user-select: all;">${history[i]}</span>`;
        this.historyPopover.appendChild(entry);
      }
    }

    // Position relative to the footer
    if (this.footerElement) {
      this.footerElement.style.position = 'relative';
      this.footerElement.appendChild(this.historyPopover);
    }

    // Close on click outside
    const closeHandler = (e: MouseEvent) => {
      if (this.historyPopover && !this.historyPopover.contains(e.target as Node) && e.target !== anchorBtn) {
        this.closeHistoryPopover();
        document.removeEventListener('click', closeHandler);
      }
    };
    // Delay to avoid immediate close from the button click
    setTimeout(() => document.addEventListener('click', closeHandler), 0);
  }

  private closeHistoryPopover(): void {
    if (this.historyPopover && this.historyPopover.parentNode) {
      this.historyPopover.parentNode.removeChild(this.historyPopover);
    }
    this.historyPopover = null;
  }

  private async handleClearHistory(): Promise<void> {
    if (!this.currentAgentId) return;
    try {
      await withTimeout(
        window.copilotBridge.clearSessionHistory(this.currentAgentId),
        IPC_TIMEOUT, 'clearSessionHistory'
      );
    } catch { /* ignore */ }
    // Close popover if open
    this.closeHistoryPopover();
  }

  private injectStyles(): void {
    if (document.getElementById('xterm-styles')) return;

    const style = document.createElement('style');
    style.id = 'xterm-styles';
    style.textContent = `
      .xterm {
        height: 100%;
      }
      .xterm-viewport {
        background-color: #0a0a14 !important;
      }
      .xterm-screen {
        height: 100%;
      }
      #terminal-container .xterm {
        height: 100%;
      }
    `;
    document.head.appendChild(style);
  }

  private createTerminal(): void {
    if (!this.terminalDiv) return;

    this.terminal = new Terminal({
      theme: {
        background: '#0a0a14',
        foreground: '#e0e0e0',
        cursor: '#00ff88',
        cursorAccent: '#0a0a14',
        selectionBackground: '#3a5a8a',
        black: '#1a1a2e',
        red: '#ff5555',
        green: '#50fa7b',
        yellow: '#f1fa8c',
        blue: '#6272a4',
        magenta: '#ff79c6',
        cyan: '#8be9fd',
        white: '#f8f8f2',
        brightBlack: '#4a4a6a',
        brightRed: '#ff6e6e',
        brightGreen: '#69ff94',
        brightYellow: '#ffffa5',
        brightBlue: '#d6acff',
        brightMagenta: '#ff92df',
        brightCyan: '#a4ffff',
        brightWhite: '#ffffff',
      },
      fontFamily: 'Cascadia Code, Consolas, Monaco, monospace',
      fontSize: 16,
      lineHeight: 1.2,
      cursorBlink: true,
      cursorStyle: 'block',
      scrollback: 10000,
      allowProposedApi: true,
    });

    this.fitAddon = new FitAddon();
    this.terminal.loadAddon(this.fitAddon);

    this.terminal.open(this.terminalDiv);
    this.fitAddon.fit();

    // Handle terminal input
    this.terminal.onData((data: string) => {
      if (this.currentAgentId && window.copilotBridge) {
        window.copilotBridge.terminalWrite(this.currentAgentId, data);
      }
    });

    // Handle resize
    window.addEventListener('resize', () => {
      if (this.isVisible && this.fitAddon && this.terminal && this.currentAgentId) {
        this.fitAddon.fit();
        const dims = this.fitAddon.proposeDimensions();
        if (dims && window.copilotBridge) {
          window.copilotBridge.terminalResize(this.currentAgentId, dims.cols, dims.rows);
        }
      }
    });
  }

  /** Give keyboard focus to the terminal. Safe to call when already focused. */
  focusTerminal(): void {
    console.log('[TerminalOverlay] focusTerminal() — delegating to InputManager');
    this.inputManager.switchToTerminal(
      'TerminalOverlay.focusTerminal()',
      () => this.handleNewSession()
    );
    this.inputManager.focusTerminalXterm(this.terminal);
  }

  /** Give keyboard focus back to the game canvas. Safe to call when already blurred. */
  blurTerminal(): void {
    console.log('[TerminalOverlay] blurTerminal() — delegating to InputManager');
    this.inputManager.switchToGame('TerminalOverlay.blurTerminal()');
    this.inputManager.blurTerminalXterm(this.terminal);
  }

  private setupKeyboardHandler(): void {
    // Retained for backward-compat; now handled entirely by InputManager.
    // Calling focusTerminal() above already invokes InputManager.switchToTerminal().
  }

  hide(): void {
    if (this.container) {
      this.container.style.display = 'none';
    }
    this.isVisible = false;
    this.closeHistoryPopover();

    // F10 handler is now managed by InputManager (deactivated below)

    this.inputManager.deactivateTerminalF10();

    this.blurTerminal();

    // Clear NPC highlight and profile canvas glow
    this.scene.game.events.emit('npc:clear-highlight');
    const spriteCanvas = document.getElementById('agent-sprite-canvas') as HTMLCanvasElement | null;
    if (spriteCanvas) {
      spriteCanvas.style.boxShadow = '';
      spriteCanvas.style.border = '';
    }

    // Don't kill the terminal - keep session alive in background!

    if (this.onCloseCallback) {
      this.onCloseCallback();
    }

    // Return keyboard focus to the game canvas
    this.scene.game.canvas.focus();
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }

  // Get if an agent has an active terminal session
  async hasSession(agentId: string): Promise<boolean> {
    if (window.copilotBridge) {
      return withTimeout(
        window.copilotBridge.terminalExists(agentId),
        IPC_TIMEOUT, 'terminalExists'
      ).catch(() => false);
    }
    return false;
  }

  destroy(): void {
    if (this.terminal) {
      this.terminal.dispose();
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (window.copilotBridge) {
      window.copilotBridge.removeTerminalListeners();
    }
  }
}
