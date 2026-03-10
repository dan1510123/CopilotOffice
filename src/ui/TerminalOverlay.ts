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
  private spriteCardElement: HTMLDivElement | null = null;
  private terminalDiv: HTMLDivElement | null = null;
  private sessionId: string | null = null;
  private sessionIdElement: HTMLSpanElement | null = null;
  private historyPopover: HTMLDivElement | null = null;
  private inputManager: InputManager;
  private isFullWidth: boolean = false;
  private fullscreenBtn: HTMLButtonElement | null = null;
  private isFocused: boolean = false;
  private resizeHandler: (() => void) | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private refitTimers: ReturnType<typeof setTimeout>[] = [];
  private getOfficeId: () => string;
  private isReadOnly: boolean = false;
  private isReplaying: boolean = false;
  private readonly instanceId: string;

  private static nextInstanceId = 0;
  private static readonly STORAGE_KEY = 'agencyOffice:terminalFullWidth';

  constructor(scene: Phaser.Scene, inputManager: InputManager, getOfficeId: () => string) {
    this.scene = scene;
    this.inputManager = inputManager;
    this.getOfficeId = getOfficeId;
    this.instanceId = String(TerminalOverlay.nextInstanceId++);
    // Load persisted fullscreen preference
    this.isFullWidth = localStorage.getItem(TerminalOverlay.STORAGE_KEY) === 'true';
    this.setupTerminalListeners();
  }

  private setupTerminalListeners(): void {
    if (typeof window !== 'undefined' && window.copilotBridge) {
      window.copilotBridge.onTerminalData((agentId: string, data: string) => {
        if (this.isReplaying) return;
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

  /**
   * Re-register IPC listeners that may have been removed by another scene's
   * cleanup (e.g. MeetingScene calling removeTerminalListeners()).
   * Safe to call multiple times — additive listeners are fine because they
   * all guard on `this.currentAgentId`.
   */
  reattachListeners(): void {
    this.setupTerminalListeners();
    console.log('[TerminalOverlay] Re-attached terminal IPC listeners');
  }

  private parseSessionId(_data: string): void {
    // No-op: Session IDs are now exclusively managed by the terminal server.
    // Previously this parsed UUIDs from CLI output and overwrote the server's
    // session mapping via saveSessionId(), causing cross-agent contamination
    // (e.g. generalist and architect sharing the same UUID).
    // The server is the single source of truth — see startNewSession() and
    // the show() reattach path which read the session ID from the server.
  }

  private updateSessionDisplay(): void {
    // Query within our own SpriteCard to avoid collisions with other TerminalOverlay instances
    const el = this.spriteCardElement?.querySelector('.session-id-display') as HTMLSpanElement;
    if (el && this.sessionId) {
      el.textContent = this.sessionId;
      el.title = `Click to copy. Resume with: copilot --resume ${this.sessionId}`;
      el.onclick = () => this.copySessionId();
    }
  }

  async show(agent: AgentConfig, onClose: () => void, options?: { readOnly?: boolean }): Promise<void> {
    this.currentAgentId = agent.id;
    this.onCloseCallback = onClose;
    this.isReadOnly = options?.readOnly ?? false;

    // Store current agent for workingDir access
    this.currentAgent = agent;

    // Create container if it doesn't exist
    if (!this.container) {
      this.createContainer();
    }

    // Update header with inception indicator for admin
    const inceptionBadge = agent.id === 'admin' ? ' 🎭 INCEPTION MODE' : '';
    // Fetch session title for header
    let sessionTitleHtml = '';
    if (window.copilotBridge?.getSessionMeta) {
      try {
        const meta = await window.copilotBridge.getSessionMeta(this.getOfficeId(), agent.id);
        if (meta?.title) {
          sessionTitleHtml = ` <span style="color: #aab; font-size: 15px;">— ${meta.title.replace(/</g, '&lt;')}</span>`;
        }
      } catch (_) { /* ignore */ }
    }
    if (this.headerElement) {
      const readOnlyBadge = this.isReadOnly ? ' <span style="color: #ffb86c; font-size: 12px; background: #332200; padding: 2px 8px; border-radius: 4px;">🔒 READ-ONLY</span>' : '';
      const shortcutsText = this.isReadOnly
        ? '[F10] Close  [Ctrl+F] Fullscreen'
        : '[F10] Close  [Ctrl+Shift+N] New Session  [Ctrl+F] Fullscreen';
      const headerLabel = this.isReadOnly ? `📜 Meeting with ${agent.name}` : `💬 Talking to ${agent.name}`;
      this.headerElement.innerHTML = `
        <div style="display: flex; align-items: center; gap: 15px;">
          <span style="color: #00ff88; font-weight: bold; font-size: 18px;">${headerLabel}${sessionTitleHtml}</span>
          ${readOnlyBadge}
          <span style="color: #ff88ff; font-size: 16px;">${inceptionBadge}</span>
          <span style="color: #888; font-size: 14px;">${agent.description}</span>
        </div>
        <div style="display: flex; align-items: center; gap: 15px;">
          <span style="color: #666; font-size: 14px;">${shortcutsText}</span>
          <button id="close-terminal-btn" style="background: #ff4444; border: none; color: white; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-weight: bold; font-size: 16px;">✕ CLOSE</button>
        </div>
      `;
      
      // Add close button handler (stopPropagation prevents container's mousedown
      // from calling focusTerminal(), which steals focus and blocks the click)
      const closeBtn = document.getElementById('close-terminal-btn');
      if (closeBtn) {
        closeBtn.addEventListener('mousedown', (e) => e.stopPropagation());
        closeBtn.addEventListener('click', () => this.hide());
      }
    }

    if (this.container) {
      this.container.style.display = 'flex';
    }

    // Show the SpriteCard
    if (this.spriteCardElement) {
      this.spriteCardElement.style.display = 'flex';
    }

    // Apply panel layout based on persisted fullscreen preference
    this.applyPanelLayout();
    this.updateFullscreenButton();
    
    // Update agent display in footer
    const colorHex = '#' + agent.color.toString(16).padStart(6, '0');
    const agentNameDisplay = this.spriteCardElement?.querySelector('.agent-name-display') as HTMLElement | null;
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
      this.isReplaying = true;
      this.terminal.clear();
    }

    // Reset session ID for this agent
    this.sessionId = null;

    // Check if terminal session exists, if not start one
    if (window.copilotBridge) {
      try {
        const exists = await withTimeout(
          window.copilotBridge.terminalExists(this.getOfficeId(), agent.id),
          IPC_TIMEOUT, 'terminalExists'
        );
        if (!exists) {
          this.isReplaying = false;
          await this.startNewSession(agent.id, agent.workingDir);
        } else {
          // Session exists - reattach and replay scrollback to sync xterm with PTY state.
          // Raw scrollback preserves ANSI escape sequences so xterm's cursor ends up
          // at the same position as the live PTY.
          const attachResult = await withTimeout(
            window.copilotBridge.terminalAttach(this.getOfficeId(), agent.id),
            IPC_TIMEOUT, 'terminalAttach'
          );

          console.log(`[TerminalOverlay] Scrollback replay for ${agent.id}: ${attachResult?.scrollback?.length ?? 0} bytes`);
          if (attachResult?.scrollback && this.terminal) {
            this.terminal.write(attachResult.scrollback);
          }
          this.isReplaying = false;

          // Notify main.ts to refresh this agent's badge status
          this.scene.game.events.emit('agent:reattached', agent.id);

          // Do NOT fit() here — the container may not be visible/laid out yet.
          // All sizing is deferred to the post-layout rAF block below.

          // Try to get saved session ID
          const savedId = await withTimeout(
            window.copilotBridge.getSessionId(this.getOfficeId(), agent.id),
            IPC_TIMEOUT, 'getSessionId'
          );
          if (savedId) {
            this.sessionId = savedId;
            this.updateSessionDisplay();
          }
        }
      } catch (e) {
        this.isReplaying = false;
        this.terminal?.writeln(`\r\n\x1b[31m[${e}]\x1b[0m\r\n`);
      }
      
      // Resize terminal — use debouncedRefit for multi-stage layout settling.
      // Defer focus until after refit so xterm state is fully synced before input.
      if (this.fitAddon && this.terminal) {
        this.debouncedRefit();
        requestAnimationFrame(() => {
          this.terminal?.focus();
        });
      }
    }

    this.isVisible = true;

    // Highlight the matching NPC in the game and glow the profile canvas
    this.scene.game.events.emit('npc:highlight', agent.id);
    const spriteCanvas = this.spriteCardElement?.querySelector('.agent-sprite-canvas') as HTMLCanvasElement | null;
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
      const canvas = this.spriteCardElement?.querySelector('.agent-sprite-canvas') as HTMLCanvasElement;
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
    
    const el = this.spriteCardElement?.querySelector('.session-id-display') as HTMLElement | null;
    if (el) {
      el.textContent = 'starting...';
    }

    // Fit xterm first so we know the real dimensions to spawn the PTY at
    this.fitAddon?.fit();
    const dims = this.fitAddon?.proposeDimensions();

    const result = await withTimeout(
      window.copilotBridge.terminalStart(this.getOfficeId(), agentId, workingDir, dims?.cols, dims?.rows),
      IPC_TIMEOUT, 'terminalStart'
    );
    if (!result.success) {
      this.terminal?.writeln(`Failed to start terminal: ${result.error}`);
    } else if (result.sessionId) {
      // Use the server's authoritative session ID — never parse it from CLI output
      this.sessionId = result.sessionId;
      this.updateSessionDisplay();
    }
  }

  private fetchSessionId(agentId: string): void {
    // Send /session command to get session ID from copilot
    if (window.copilotBridge && !this.sessionId) {
      const el = this.spriteCardElement?.querySelector('.session-id-display') as HTMLElement | null;
      if (el) {
        el.textContent = 'fetching...';
      }
      // Send the /session command with carriage return to submit
      setTimeout(() => {
        window.copilotBridge.terminalWrite(this.getOfficeId(), agentId, '/session\r');
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
    // Click anywhere in the terminal area to re-focus (switches input + restores visuals)
    terminalOuter.addEventListener('mousedown', () => {
      if (this.isVisible && !this.isFocused) {
        this.focusTerminal();
      }
    });
    this.container.appendChild(terminalOuter);

    const terminalPanel = document.getElementById('terminal-panel') || document.body;
    terminalPanel.appendChild(this.container);

    // Click anywhere in the terminal overlay to re-focus
    this.container.addEventListener('mousedown', () => {
      if (this.isVisible && !this.isFocused) {
        this.focusTerminal();
      }
    });

    // Create the SpriteCard — a full-width bar mounted outside the terminal overlay
    this.createSpriteCard();

    // Get reference to session ID element
    this.sessionIdElement = this.spriteCardElement?.querySelector('.session-id-display') as HTMLSpanElement;
    if (this.sessionIdElement) {
      this.sessionIdElement.onclick = () => this.copySessionId();
    }

    // Add xterm.css styles
    this.injectStyles();
  }

  /** Create the SpriteCard — a full-width bottom bar showing agent sprite, info, and controls. */
  private createSpriteCard(): void {
    this.spriteCardElement = document.createElement('div');
    this.spriteCardElement.id = 'sprite-card';
    this.spriteCardElement.style.cssText = `
      width: 100%;
      background: #1a1a2e;
      border-top: 1px solid #3a5a8a;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 14px;
      color: #888;
      display: none;
      flex-shrink: 0;
      justify-content: space-between;
      align-items: center;
      padding: 15px 30px;
      box-sizing: border-box;
      position: relative;
      z-index: 10001;
    `;

    // Left side: Agent sprite and name
    const agentDisplay = document.createElement('div');
    agentDisplay.className = 'agent-display';
    agentDisplay.style.cssText = `
      display: flex;
      align-items: center;
      gap: 20px;
    `;
    agentDisplay.innerHTML = `
      <canvas class="agent-sprite-canvas" width="32" height="34" style="image-rendering: pixelated; width: 160px; height: 170px; border-radius: 8px;"></canvas>
      <div style="display: flex; flex-direction: column; gap: 5px;">
        <span class="agent-name-display" style="font-weight: bold; font-size: 28px;"></span>
        <span style="color: #666; font-size: 12px;">Session ID: <span class="session-id-display" style="color: #4a9eff; cursor: pointer;">--</span></span>
      </div>
    `;
    this.spriteCardElement.appendChild(agentDisplay);

    // Right side: Button grid
    const buttonGrid = document.createElement('div');
    buttonGrid.style.cssText = `
      display: grid;
      grid-template-columns: auto auto auto;
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

    const historyBtn = document.createElement('button');
    historyBtn.textContent = '📜 Session History';
    historyBtn.style.cssText = btnStyle;
    historyBtn.onmouseover = () => historyBtn.style.background = '#3a4a5a';
    historyBtn.onmouseout = () => historyBtn.style.background = '#2a3a4a';
    historyBtn.onclick = () => this.toggleSessionHistory(historyBtn);
    buttonGrid.appendChild(historyBtn);

    const newSessionBtn = document.createElement('button');
    newSessionBtn.textContent = '🔄 New Session';
    newSessionBtn.style.cssText = btnStyle;
    newSessionBtn.onmouseover = () => newSessionBtn.style.background = '#3a4a5a';
    newSessionBtn.onmouseout = () => newSessionBtn.style.background = '#2a3a4a';
    newSessionBtn.onclick = () => this.handleNewSession();
    buttonGrid.appendChild(newSessionBtn);

    const clearHistoryBtn = document.createElement('button');
    clearHistoryBtn.textContent = '🗑️ Clear History';
    clearHistoryBtn.style.cssText = btnStyle;
    clearHistoryBtn.onmouseover = () => clearHistoryBtn.style.background = '#3a4a5a';
    clearHistoryBtn.onmouseout = () => clearHistoryBtn.style.background = '#2a3a4a';
    clearHistoryBtn.onclick = () => this.handleClearHistory();
    buttonGrid.appendChild(clearHistoryBtn);

    const closeSessionBtn = document.createElement('button');
    closeSessionBtn.textContent = '⏹ Close Session';
    closeSessionBtn.style.cssText = btnStyle + 'color: #ff8888;';
    closeSessionBtn.onmouseover = () => { closeSessionBtn.style.background = '#4a2a2a'; };
    closeSessionBtn.onmouseout = () => { closeSessionBtn.style.background = '#2a3a4a'; };
    closeSessionBtn.onclick = () => this.handleCloseSession();
    buttonGrid.appendChild(closeSessionBtn);

    this.fullscreenBtn = document.createElement('button');
    this.fullscreenBtn.textContent = this.isFullWidth ? '⛶ Half' : '⛶ Fullscreen';
    this.fullscreenBtn.style.cssText = btnStyle + 'color: #88ccff;';
    this.fullscreenBtn.onmouseover = () => { if (this.fullscreenBtn) this.fullscreenBtn.style.background = '#2a3a5a'; };
    this.fullscreenBtn.onmouseout = () => { if (this.fullscreenBtn) this.fullscreenBtn.style.background = '#2a3a4a'; };
    this.fullscreenBtn.onclick = () => this.toggleFullWidth();
    this.fullscreenBtn.title = 'Toggle fullscreen (Ctrl+F)';
    buttonGrid.appendChild(this.fullscreenBtn);

    this.spriteCardElement.appendChild(buttonGrid);

    // Mount to #game-container so it spans full width, between mainContent and status bar
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.appendChild(this.spriteCardElement);
    }

    // Keep footerElement reference pointing to spriteCard for history popover positioning
    this.footerElement = this.spriteCardElement;
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
    if (!this.currentAgentId || !this.currentAgent || this.isReadOnly) return;
    
    // Clear terminal
    this.terminal?.clear();
    this.terminal?.writeln('\x1b[33m[Starting new session...]\x1b[0m\r\n');
    
    // Reset session (clears meta/title, generates new session ID, kills PTY)
    await withTimeout(
      window.copilotBridge.resetSession(this.getOfficeId(), this.currentAgentId),
      IPC_TIMEOUT, 'resetSession'
    ).catch(() => { /* ignore */ });

    await this.startNewSession(this.currentAgentId, this.currentAgent.workingDir);
  }

  private async handleCloseSession(): Promise<void> {
    if (!this.currentAgentId || this.isReadOnly) return;

    try {
      const result = await withTimeout(
        window.copilotBridge.resetSession(this.getOfficeId(), this.currentAgentId),
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
        window.copilotBridge.getSessionHistory(this.getOfficeId(), this.currentAgentId),
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
    if (!this.currentAgentId || this.isReadOnly) return;
    try {
      await withTimeout(
        window.copilotBridge.clearSessionHistory(this.getOfficeId(), this.currentAgentId),
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

    // Handle terminal input (blocked in read-only mode)
    this.terminal.onData((data: string) => {
      if (this.isReadOnly) return;
      if (this.currentAgentId && window.copilotBridge) {
        window.copilotBridge.terminalWrite(this.getOfficeId(), this.currentAgentId, data);
      }
    });

    // Handle resize — store reference for cleanup in destroy()
    this.resizeHandler = () => {
      if (this.isVisible) {
        this.debouncedRefit();
      }
    };
    window.addEventListener('resize', this.resizeHandler);

    // ResizeObserver catches CSS-driven panel resizes that window.resize misses
    this.resizeObserver = new ResizeObserver(() => {
      if (this.isVisible) {
        this.debouncedRefit();
      }
    });
    if (this.terminalDiv) {
      this.resizeObserver.observe(this.terminalDiv);
    }
  }

  /** Toggle between half-width and full-width terminal panel. */
  private toggleFullWidth(): void {
    this.isFullWidth = !this.isFullWidth;
    localStorage.setItem(TerminalOverlay.STORAGE_KEY, String(this.isFullWidth));
    console.log(`[TerminalOverlay] toggleFullWidth() — now ${this.isFullWidth ? 'full' : 'half'}`);
    this.applyPanelLayout();
    this.updateFullscreenButton();
    this.debouncedRefit();
  }

  /** Apply panel widths based on isFullWidth state. */
  private applyPanelLayout(): void {
    const officePanel = document.getElementById('office-panel');
    const terminalPanel = document.getElementById('terminal-panel');
    if (!officePanel || !terminalPanel) return;

    if (this.isFullWidth) {
      officePanel.style.display = 'none';
      terminalPanel.style.width = '100%';
    } else {
      officePanel.style.display = 'block';
      officePanel.style.width = '50%';
      terminalPanel.style.width = '50%';
    }
  }

  /** Restore half-width layout (used when hiding terminal). */
  private restorePanelLayout(): void {
    const officePanel = document.getElementById('office-panel');
    const terminalPanel = document.getElementById('terminal-panel');
    if (!officePanel || !terminalPanel) return;

    officePanel.style.display = 'block';
    officePanel.style.width = '50%';
    terminalPanel.style.width = '50%';
  }

  /** Re-fit xterm after panel resize and notify PTY of new dimensions.
   *  Multi-stage: immediate → 150ms → 350ms to catch late layout shifts. */
  private debouncedRefit(): void {
    if (!this.fitAddon || !this.terminal || !this.currentAgentId) return;

    // Cancel any pending refit timers
    for (const t of this.refitTimers) clearTimeout(t);
    this.refitTimers.length = 0;

    const doFit = () => {
      this.fitAddon?.fit();
      const dims = this.fitAddon?.proposeDimensions();
      if (dims && window.copilotBridge && this.currentAgentId) {
        window.copilotBridge.terminalResize(this.getOfficeId(), this.currentAgentId, dims.cols, dims.rows);
      }
    };

    // Stage 1: immediate (next frame)
    requestAnimationFrame(() => {
      doFit();
      // Stage 2: after 150ms
      this.refitTimers.push(setTimeout(() => {
        doFit();
        // Stage 3: after 350ms
        this.refitTimers.push(setTimeout(doFit, 200));
      }, 150));
    });
  }

  /** Update the fullscreen toggle button label. */
  private updateFullscreenButton(): void {
    if (this.fullscreenBtn) {
      this.fullscreenBtn.textContent = this.isFullWidth ? '⛶ Half' : '⛶ Fullscreen';
    }
  }

  /** Give keyboard focus to the terminal. Safe to call when already focused. */
  focusTerminal(): void {
    console.log('[TerminalOverlay] focusTerminal() — delegating to InputManager');
    this.inputManager.switchToTerminal(
      'TerminalOverlay.focusTerminal()',
      () => this.handleNewSession(),
      () => this.toggleFullWidth()
    );
    this.inputManager.focusTerminalXterm(this.terminal);

    // Restore NPC highlight for the active agent
    if (this.currentAgent) {
      this.scene.game.events.emit('npc:highlight', this.currentAgent.id);
      // Restore sprite canvas glow
      const spriteCanvas = this.spriteCardElement?.querySelector('.agent-sprite-canvas') as HTMLCanvasElement | null;
      if (spriteCanvas) {
        const colorHex = '#' + this.currentAgent.color.toString(16).padStart(6, '0');
        spriteCanvas.style.boxShadow = `0 0 18px 6px ${colorHex}99, 0 0 6px 2px ${colorHex}`;
        spriteCanvas.style.border = `2px solid ${colorHex}`;
      }
    }

    // Remove dimmed visual state
    this.setTerminalFocusVisual(true);
  }

  /** Give keyboard focus back to the game canvas. Safe to call when already blurred. */
  blurTerminal(): void {
    console.log('[TerminalOverlay] blurTerminal() — delegating to InputManager');
    this.inputManager.switchToGame('TerminalOverlay.blurTerminal()');
    this.inputManager.blurTerminalXterm(this.terminal);

    // Clear NPC highlight glow
    this.scene.game.events.emit('npc:clear-highlight');

    // Clear sprite canvas glow
    const spriteCanvas = this.spriteCardElement?.querySelector('.agent-sprite-canvas') as HTMLCanvasElement | null;
    if (spriteCanvas) {
      spriteCanvas.style.boxShadow = '';
      spriteCanvas.style.border = '';
    }

    // Apply dimmed visual state
    this.setTerminalFocusVisual(false);
  }

  /** Apply or remove the visual focus/blur state on the terminal panel. */
  private setTerminalFocusVisual(focused: boolean): void {
    this.isFocused = focused;
    if (this.spriteCardElement && this.spriteCardElement.style.display !== 'none') {
      this.spriteCardElement.style.background = focused ? '#1a1a2e' : '#111118';
      this.spriteCardElement.style.borderTopColor = focused ? '#3a5a8a' : '#2a2a3a';
    }
  }

  private setupKeyboardHandler(): void {
    // Retained for backward-compat; now handled entirely by InputManager.
    // Calling focusTerminal() above already invokes InputManager.switchToTerminal().
  }

  hide(): void {
    if (this.container) {
      this.container.style.display = 'none';
    }
    // Hide the SpriteCard
    if (this.spriteCardElement) {
      this.spriteCardElement.style.display = 'none';
    }
    this.isVisible = false;
    this.isReadOnly = false;
    this.closeHistoryPopover();

    // Always restore half-width so the game is visible
    this.restorePanelLayout();

    // F10 handler is now managed by InputManager (deactivated below)

    this.inputManager.deactivateTerminalF10();

    this.blurTerminal();

    // Reset visual state to full opacity (blurTerminal dims it, but hide removes it entirely)
    this.setTerminalFocusVisual(true);

    // Clear profile canvas glow (NPC highlight already cleared by blurTerminal)
    const spriteCanvas = this.spriteCardElement?.querySelector('.agent-sprite-canvas') as HTMLCanvasElement | null;
    if (spriteCanvas) {
      spriteCanvas.style.boxShadow = '';
      spriteCanvas.style.border = '';
    }

    // Don't kill the terminal - keep session alive in background!
    // Detach viewer so the server stops sending data to us while hidden.
    if (this.currentAgentId && window.copilotBridge) {
      window.copilotBridge.terminalDetach(this.getOfficeId(), this.currentAgentId).catch(() => {});
    }

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
        window.copilotBridge.terminalExists(this.getOfficeId(), agentId),
        IPC_TIMEOUT, 'terminalExists'
      ).catch(() => false);
    }
    return false;
  }

  destroy(): void {
    // Cancel pending refit timers
    for (const t of this.refitTimers) clearTimeout(t);
    this.refitTimers.length = 0;
    // Remove window resize listener
    if (this.resizeHandler) {
      window.removeEventListener('resize', this.resizeHandler);
      this.resizeHandler = null;
    }
    // Disconnect ResizeObserver
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
    if (this.terminal) {
      this.terminal.dispose();
    }
    if (this.container && this.container.parentNode) {
      this.container.parentNode.removeChild(this.container);
    }
    if (this.spriteCardElement && this.spriteCardElement.parentNode) {
      this.spriteCardElement.parentNode.removeChild(this.spriteCardElement);
    }
    if (window.copilotBridge) {
      window.copilotBridge.removeTerminalListeners();
    }
  }
}
