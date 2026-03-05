import Phaser from 'phaser';
import { Terminal } from 'xterm';
import { FitAddon } from 'xterm-addon-fit';
import { AgentConfig } from '../config/agents';

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

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
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
          window.copilotBridge.saveSessionId(this.currentAgentId, this.sessionId);
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

    // Show container
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
      // Clear terminal when switching to different agent
      this.terminal.clear();
    }

    // Reset session ID for this agent
    this.sessionId = null;

    // Check if terminal session exists, if not start one
    if (window.copilotBridge) {
      const exists = await window.copilotBridge.terminalExists(agent.id);
      if (!exists) {
        await this.startNewSession(agent.id, agent.workingDir);
      } else {
        // Session exists - try to get saved session ID
        const savedId = await window.copilotBridge.getSessionId(agent.id);
        if (savedId) {
          this.sessionId = savedId;
          this.updateSessionDisplay();
        }
      }
      
      // Resize terminal - need to wait for container to be fully rendered
      if (this.fitAddon && this.terminal) {
        // Do multiple fits to ensure proper sizing
        const doFit = () => {
          this.fitAddon?.fit();
          const dims = this.fitAddon?.proposeDimensions();
          if (dims && window.copilotBridge) {
            window.copilotBridge.terminalResize(agent.id, dims.cols, dims.rows);
          }
        };
        setTimeout(doFit, 50);
        setTimeout(doFit, 150);
        setTimeout(doFit, 300);
      }
    }

    this.isVisible = true;
    
    // Disable Phaser keyboard when terminal is shown
    if (this.scene.input.keyboard) {
      this.scene.input.keyboard.enabled = false;
    }
    
    // Focus terminal after a delay to ensure it's ready
    setTimeout(() => {
      if (this.terminal) {
        this.terminal.focus();
      }
    }, 200);

    // Setup F10 close handler
    this.setupKeyboardHandler();
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
    
    const result = await window.copilotBridge.terminalStart(agentId, workingDir);
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
      position: fixed;
      top: 50%;
      left: 50%;
      transform: translate(-50%, -50%);
      width: 80%;
      height: 80%;
      background: #0a0a14;
      border: 2px solid #3a5a8a;
      border-radius: 8px;
      display: none;
      flex-direction: column;
      z-index: 10000;
      box-shadow: 0 0 40px rgba(0, 100, 200, 0.4);
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
    `;
    this.container.appendChild(this.headerElement);

    // Terminal container
    this.terminalDiv = document.createElement('div');
    this.terminalDiv.id = 'terminal-container';
    this.terminalDiv.style.cssText = `
      flex: 1;
      padding: 5px;
      overflow: hidden;
    `;
    // Click to focus terminal
    this.terminalDiv.addEventListener('click', () => {
      this.terminal?.focus();
    });
    this.container.appendChild(this.terminalDiv);

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
    
    // Right side: New session button
    const newSessionBtn = document.createElement('button');
    newSessionBtn.textContent = '🔄 New Session';
    newSessionBtn.style.cssText = `
      background: #2a3a4a;
      border: 1px solid #4a5a6a;
      color: #aaa;
      padding: 8px 16px;
      border-radius: 4px;
      cursor: pointer;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 14px;
    `;
    newSessionBtn.onmouseover = () => newSessionBtn.style.background = '#3a4a5a';
    newSessionBtn.onmouseout = () => newSessionBtn.style.background = '#2a3a4a';
    newSessionBtn.onclick = () => this.handleNewSession();
    this.footerElement.appendChild(newSessionBtn);
    
    this.container.appendChild(this.footerElement);

    document.body.appendChild(this.container);

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
    await window.copilotBridge.terminalKill(this.currentAgentId);
    await this.startNewSession(this.currentAgentId, this.currentAgent.workingDir);
  }

  private injectStyles(): void {
    if (document.getElementById('xterm-styles')) return;

    const style = document.createElement('style');
    style.id = 'xterm-styles';
    style.textContent = `
      .xterm {
        height: 100%;
        padding: 10px;
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
      fontSize: 24,
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

  private escapeHandler: ((event: KeyboardEvent) => void) | null = null;

  private setupKeyboardHandler(): void {
    // Disable Phaser keyboard capture when terminal is visible
    if (this.scene.input.keyboard) {
      this.scene.input.keyboard.enabled = false;
    }
    
    // Remove any existing handler
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler, true);
    }
    
    this.escapeHandler = (event: KeyboardEvent) => {
      // Only handle specific keys, let everything else through to terminal
      // F10 to close - rarely used in terminals
      if (event.key === 'F10' && this.isVisible) {
        event.preventDefault();
        event.stopPropagation();
        event.stopImmediatePropagation();
        this.hide();
        return;
      }
      // Ctrl+Shift+N for new session
      if (event.ctrlKey && event.shiftKey && event.key === 'N' && this.isVisible) {
        event.preventDefault();
        event.stopPropagation();
        this.handleNewSession();
        return;
      }
      
      // FORCE forward spacebar and other commonly blocked keys directly to PTY
      if (this.isVisible && this.currentAgentId && window.copilotBridge) {
        // Spacebar
        if (event.key === ' ' || event.code === 'Space') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, ' ');
          return;
        }
        // Enter
        if (event.key === 'Enter') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, '\r');
          return;
        }
        // Backspace
        if (event.key === 'Backspace') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, '\x7f');
          return;
        }
        // Tab
        if (event.key === 'Tab') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, '\t');
          return;
        }
        // Arrow keys
        if (event.key === 'ArrowUp') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, '\x1b[A');
          return;
        }
        if (event.key === 'ArrowDown') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, '\x1b[B');
          return;
        }
        if (event.key === 'ArrowRight') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, '\x1b[C');
          return;
        }
        if (event.key === 'ArrowLeft') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, '\x1b[D');
          return;
        }
        // Regular printable characters (single char, no modifiers except shift)
        if (event.key.length === 1 && !event.ctrlKey && !event.altKey && !event.metaKey) {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, event.key);
          return;
        }
        // Ctrl+C
        if (event.ctrlKey && event.key === 'c') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, '\x03');
          return;
        }
        // Ctrl+D
        if (event.ctrlKey && event.key === 'd') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, '\x04');
          return;
        }
        // Ctrl+L (clear)
        if (event.ctrlKey && event.key === 'l') {
          event.preventDefault();
          event.stopPropagation();
          window.copilotBridge.terminalWrite(this.currentAgentId, '\x0c');
          return;
        }
      }
    };
    
    // Use capture phase (true) to intercept before anything else
    document.addEventListener('keydown', this.escapeHandler, true);
  }

  hide(): void {
    if (this.container) {
      this.container.style.display = 'none';
    }
    this.isVisible = false;
    
    // Re-enable Phaser keyboard
    if (this.scene.input.keyboard) {
      this.scene.input.keyboard.enabled = true;
    }
    
    // Remove F10 handler
    if (this.escapeHandler) {
      document.removeEventListener('keydown', this.escapeHandler, true);
      this.escapeHandler = null;
    }
    
    // Don't kill the terminal - keep session alive in background!
    
    if (this.onCloseCallback) {
      this.onCloseCallback();
    }
  }

  getIsVisible(): boolean {
    return this.isVisible;
  }

  // Get if an agent has an active terminal session
  async hasSession(agentId: string): Promise<boolean> {
    if (window.copilotBridge) {
      return window.copilotBridge.terminalExists(agentId);
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
