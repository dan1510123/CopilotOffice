import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';

type SeriousTerminalOpenOptions = {
  officeId: string;
  agentId: string;
  name: string;
  description: string;
  color?: number;
  workingDir?: string;
  launchMode?: 'copilot' | 'shell';
};

type SeriousTerminalControllerOptions = {
  onClose?: () => void;
};

/**
 * Minimal DOM terminal view for serious mode.
 * Uses copilotBridge directly (no Phaser event dependency).
 */
export class SeriousTerminalController {
  private readonly host: HTMLElement;
  private readonly onClose?: () => void;
  private readonly container: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subtitleEl: HTMLDivElement;
  private readonly statusEl: HTMLDivElement;
  private readonly terminalOuterEl: HTMLDivElement;
  private readonly terminalDivEl: HTMLDivElement;
  private readonly spriteCardEl: HTMLDivElement;
  private readonly spriteCanvasEl: HTMLCanvasElement;
  private readonly spriteNameEl: HTMLSpanElement;
  private readonly spriteSubtitleEl: HTMLSpanElement;
  private readonly sessionIdEl: HTMLSpanElement;
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private resizeHandler: (() => void) | null = null;
  private refitTimers: ReturnType<typeof setTimeout>[] = [];
  private activeOfficeId: string | null = null;
  private activeAgentId: string | null = null;
  private visible = false;
  private openedAt = 0;
  private sessionId: string | null = null;

  constructor(host: HTMLElement, options: SeriousTerminalControllerOptions = {}) {
    this.host = host;
    this.onClose = options.onClose;
    this.container = document.createElement('div');
    this.container.style.cssText = `
      display: none;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      background: #11131c;
      color: #d7defa;
      border-left: 2px solid #2f3f62;
      font-family: 'Cascadia Code', Consolas, monospace;
    `;

    const header = document.createElement('div');
    header.style.cssText = `
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      padding: 12px 14px;
      border-bottom: 1px solid #27314e;
      background: #171b2a;
      flex-shrink: 0;
    `;

    const leftHeader = document.createElement('div');
    leftHeader.style.cssText = 'min-width: 0;';
    this.titleEl = document.createElement('div');
    this.titleEl.style.cssText = 'font-size: 14px; font-weight: 700; color: #9fc2ff; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    this.subtitleEl = document.createElement('div');
    this.subtitleEl.style.cssText = 'font-size: 11px; color: #7f8bad; margin-top: 3px;';
    leftHeader.appendChild(this.titleEl);
    leftHeader.appendChild(this.subtitleEl);

    const rightHeader = document.createElement('div');
    rightHeader.style.cssText = 'display: flex; align-items: center; gap: 6px;';
    this.statusEl = document.createElement('div');
    this.statusEl.style.cssText = 'font-size: 11px; color: #8ca2db; margin-right: 4px;';

    const detachBtn = document.createElement('button');
    detachBtn.textContent = 'Detach';
    detachBtn.style.cssText = this.buttonCss('#2f3754', '#6f8ed8');
    detachBtn.addEventListener('click', () => {
      void this.closeView({ detach: true });
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = this.buttonCss('#3a2534', '#c98fbb');
    closeBtn.addEventListener('click', () => {
      void this.closeView({ detach: true });
    });

    rightHeader.appendChild(this.statusEl);
    rightHeader.appendChild(detachBtn);
    rightHeader.appendChild(closeBtn);

    header.appendChild(leftHeader);
    header.appendChild(rightHeader);

    this.terminalOuterEl = document.createElement('div');
    this.terminalOuterEl.style.cssText = `
      flex: 1;
      min-height: 0;
      overflow: hidden;
      background: #0d111b;
      padding: 10px;
      box-sizing: border-box;
    `;
    this.terminalDivEl = document.createElement('div');
    this.terminalDivEl.style.cssText = 'width: 100%; height: 100%; overflow: hidden;';
    this.terminalOuterEl.appendChild(this.terminalDivEl);
    this.terminalOuterEl.addEventListener('mousedown', () => this.terminal?.focus());

    this.spriteCardEl = document.createElement('div');
    this.spriteCardEl.style.cssText = `
      width: 100%;
      background: #1a1a2e;
      border-top: 1px solid #3a5a8a;
      font-family: 'Cascadia Code', Consolas, monospace;
      color: #c8d4ff;
      display: flex;
      flex-shrink: 0;
      justify-content: space-between;
      align-items: center;
      gap: 16px;
      padding: 12px 18px;
      box-sizing: border-box;
    `;

    const spriteCardLeft = document.createElement('div');
    spriteCardLeft.style.cssText = 'display: flex; align-items: center; gap: 14px; min-width: 0;';

    this.spriteCanvasEl = document.createElement('canvas');
    this.spriteCanvasEl.width = 32;
    this.spriteCanvasEl.height = 34;
    this.spriteCanvasEl.style.cssText = `
      image-rendering: pixelated;
      width: 96px;
      height: 102px;
      border-radius: 6px;
      border: 1px solid #42507a;
      background: #121729;
      flex-shrink: 0;
    `;

    const spriteCardText = document.createElement('div');
    spriteCardText.style.cssText = 'display: flex; flex-direction: column; gap: 3px; min-width: 0;';
    this.spriteNameEl = document.createElement('span');
    this.spriteNameEl.style.cssText = 'font-size: 19px; font-weight: 700; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    this.spriteSubtitleEl = document.createElement('span');
    this.spriteSubtitleEl.style.cssText = 'font-size: 12px; color: #95a7d7; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    spriteCardText.appendChild(this.spriteNameEl);
    spriteCardText.appendChild(this.spriteSubtitleEl);
    spriteCardLeft.appendChild(this.spriteCanvasEl);
    spriteCardLeft.appendChild(spriteCardText);

    const spriteCardRight = document.createElement('div');
    spriteCardRight.style.cssText = 'display: flex; flex-direction: column; align-items: flex-end; gap: 4px;';
    const sessionLabel = document.createElement('span');
    sessionLabel.textContent = 'Session ID';
    sessionLabel.style.cssText = 'font-size: 11px; color: #6f7fa9;';
    this.sessionIdEl = document.createElement('span');
    this.sessionIdEl.textContent = '--';
    this.sessionIdEl.style.cssText = 'font-size: 12px; color: #8ec3ff; cursor: pointer;';
    this.sessionIdEl.title = 'Copy session ID';
    this.sessionIdEl.onclick = () => this.copySessionId();
    spriteCardRight.appendChild(sessionLabel);
    spriteCardRight.appendChild(this.sessionIdEl);

    this.spriteCardEl.appendChild(spriteCardLeft);
    this.spriteCardEl.appendChild(spriteCardRight);

    this.ensureXtermStyles();
    this.container.appendChild(header);
    this.container.appendChild(this.terminalOuterEl);
    this.container.appendChild(this.spriteCardEl);
    this.host.appendChild(this.container);
    this.createTerminal();

    if (window.copilotBridge) {
      window.copilotBridge.onTerminalData((agentId, data) => {
        if (!this.visible || this.activeAgentId !== agentId) return;
        this.terminal?.write(data);
      });
      window.copilotBridge.onTerminalExit((agentId, exitCode) => {
        if (!this.visible || this.activeAgentId !== agentId) return;
        this.terminal?.writeln(`\r\n[terminal exited with code ${exitCode}]`);
        this.setStatus('Exited');
      });
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  async openAgentTerminal(options: SeriousTerminalOpenOptions): Promise<void> {
    if (!window.copilotBridge || !this.terminal) return;
    const switchingTarget = this.activeOfficeId !== options.officeId || this.activeAgentId !== options.agentId;
    if (switchingTarget) {
      await this.closeView({ detach: true, silent: true });
    }

    this.activeOfficeId = options.officeId;
    this.activeAgentId = options.agentId;
    this.visible = true;
    this.openedAt = Date.now();
    this.sessionId = null;
    this.container.style.display = 'flex';
    this.terminal.clear();
    this.titleEl.textContent = `${options.name} (${options.agentId})`;
    this.subtitleEl.textContent = options.description;
    this.updateSpriteCard(options);
    this.updateSessionIdDisplay();
    this.setStatus('Opening...');
    this.refitAndResize(options.officeId, options.agentId);

    try {
      const exists = await window.copilotBridge.terminalExists(options.officeId, options.agentId);
      if (!exists) {
        const dims = this.fitAddon?.proposeDimensions();
        const startResult = await window.copilotBridge.terminalStart(
          options.officeId,
          options.agentId,
          options.workingDir,
          dims?.cols,
          dims?.rows,
          undefined,
          options.launchMode || 'copilot',
        );
        if (!startResult.success) {
          this.terminal.writeln(`\r\nFailed to start terminal: ${startResult.error || 'unknown error'}`);
          this.setStatus('Start failed');
          return;
        }
        if (startResult.sessionId) {
          this.sessionId = startResult.sessionId;
          this.updateSessionIdDisplay();
        }
      }

      const attachResult = await window.copilotBridge.terminalAttach(options.officeId, options.agentId);
      if (!attachResult.success) {
        this.terminal.writeln('\r\nFailed to attach terminal session.');
        this.setStatus('Attach failed');
        return;
      }

      if (attachResult.scrollback) {
        this.terminal.write(attachResult.scrollback);
      }
      const attachedSessionId = await window.copilotBridge.getSessionId(options.officeId, options.agentId);
      if (attachedSessionId) {
        this.sessionId = attachedSessionId;
        this.updateSessionIdDisplay();
      }
      this.setStatus(`Attached · ${this.formatElapsed(this.openedAt)}`);
      this.terminal.focus();
      this.debouncedRefit(options.officeId, options.agentId);
    } catch (error) {
      this.terminal.writeln(`\r\nTerminal error: ${(error as Error)?.message || String(error)}`);
      this.setStatus('Error');
    }
  }

  async startNewSession(options: SeriousTerminalOpenOptions): Promise<void> {
    if (!window.copilotBridge) return;

    try {
      await window.copilotBridge.resetSession(options.officeId, options.agentId);
    } catch {
      // Keep going to start a fresh session even if reset fails.
    }

    const isCurrentView =
      this.visible &&
      this.activeOfficeId === options.officeId &&
      this.activeAgentId === options.agentId;
    if (isCurrentView) {
      await this.openAgentTerminal(options);
      return;
    }

    const startResult = await window.copilotBridge.terminalStart(
      options.officeId,
      options.agentId,
      options.workingDir,
      undefined,
      undefined,
      undefined,
      options.launchMode || 'copilot',
    );

    if (!startResult.success) {
      console.warn(
        `[SeriousTerminalController] Failed to start new session for ${options.agentId}: ${startResult.error || 'unknown error'}`
      );
    }
  }

  async closeView(options: { detach?: boolean; silent?: boolean } = {}): Promise<void> {
    const { detach = true, silent = false } = options;
    if (detach && this.activeOfficeId && this.activeAgentId && window.copilotBridge) {
      try {
        await window.copilotBridge.terminalDetach(this.activeOfficeId, this.activeAgentId);
      } catch {
        // Ignore detach failures
      }
    }

    this.visible = false;
    this.container.style.display = 'none';
    this.activeOfficeId = null;
    this.activeAgentId = null;
    this.sessionId = null;
    this.updateSessionIdDisplay();
    this.setStatus('');
    this.clearRefitTimers();

    if (!silent) {
      this.onClose?.();
    }
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private updateSpriteCard(options: SeriousTerminalOpenOptions): void {
    this.spriteNameEl.textContent = options.name;
    this.spriteSubtitleEl.textContent = options.description;
    const colorHex = `#${(options.color ?? 0x6f8ed8).toString(16).padStart(6, '0')}`;
    this.spriteNameEl.style.color = colorHex;
    this.renderAgentSprite(options.agentId, options.color ?? 0x6f8ed8);
  }

  private updateSessionIdDisplay(): void {
    this.sessionIdEl.textContent = this.sessionId || '--';
  }

  private copySessionId(): void {
    if (!this.sessionId) return;
    navigator.clipboard.writeText(this.sessionId).then(() => {
      const original = this.sessionIdEl.textContent;
      this.sessionIdEl.textContent = 'Copied!';
      this.sessionIdEl.style.color = '#61d394';
      setTimeout(() => {
        this.sessionIdEl.textContent = original;
        this.sessionIdEl.style.color = '#8ec3ff';
      }, 900);
    }).catch(() => {});
  }

  private renderAgentSprite(seed: string, baseColor: number): void {
    const ctx = this.spriteCanvasEl.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, 32, 34);
    ctx.imageSmoothingEnabled = false;

    const color = this.toHex(baseColor);
    const shade = this.toHex(this.scaleColor(baseColor, 0.72));
    const accent = this.toHex(this.scaleColor(baseColor, 1.22));
    const skin = '#f3cfa7';

    ctx.fillStyle = '#0f1425';
    ctx.fillRect(0, 0, 32, 34);

    ctx.fillStyle = shade;
    ctx.fillRect(8, 16, 16, 14);
    ctx.fillStyle = color;
    ctx.fillRect(9, 16, 14, 13);

    ctx.fillStyle = skin;
    ctx.fillRect(10, 8, 12, 9);
    ctx.fillStyle = accent;
    ctx.fillRect(10, 5, 12, 4);
    ctx.fillStyle = '#182033';
    ctx.fillRect(13, 11, 2, 2);
    ctx.fillRect(17, 11, 2, 2);

    const seedValue = [...seed].reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
    const badgeX = seedValue % 2 === 0 ? 5 : 24;
    ctx.fillStyle = accent;
    ctx.fillRect(badgeX, 19, 3, 3);
  }

  private toHex(color: number): string {
    return `#${color.toString(16).padStart(6, '0')}`;
  }

  private scaleColor(color: number, multiplier: number): number {
    const r = Math.min(255, Math.max(0, Math.round(((color >> 16) & 0xff) * multiplier)));
    const g = Math.min(255, Math.max(0, Math.round(((color >> 8) & 0xff) * multiplier)));
    const b = Math.min(255, Math.max(0, Math.round((color & 0xff) * multiplier)));
    return (r << 16) | (g << 8) | b;
  }

  private ensureXtermStyles(): void {
    if (document.getElementById('xterm-styles')) return;
    const style = document.createElement('style');
    style.id = 'xterm-styles';
    style.textContent = `
      .xterm { height: 100%; }
      .xterm-viewport { overflow-y: auto !important; }
      #serious-terminal-container .xterm { height: 100%; }
    `;
    document.head.appendChild(style);
  }

  private createTerminal(): void {
    this.terminal = new Terminal({
      theme: {
        background: '#0d111b',
        foreground: '#e0e0e0',
        cursor: '#00ff88',
        cursorAccent: '#0d111b',
        selectionBackground: '#3a5a8a',
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
    this.terminalDivEl.id = 'serious-terminal-container';
    this.terminal.open(this.terminalDivEl);

    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'v' && event.type === 'keydown') {
        event.preventDefault();
        event.stopPropagation();
        navigator.clipboard.readText().then((text) => {
          if (text) this.terminal?.paste(text);
        }).catch(() => {});
        return false;
      }
      return true;
    });

    this.terminal.onData((data: string) => {
      if (!window.copilotBridge || !this.activeOfficeId || !this.activeAgentId) return;
      void window.copilotBridge.terminalWrite(this.activeOfficeId, this.activeAgentId, data);
    });

    this.resizeHandler = () => {
      if (!this.visible || !this.activeOfficeId || !this.activeAgentId) return;
      this.debouncedRefit(this.activeOfficeId, this.activeAgentId);
    };
    window.addEventListener('resize', this.resizeHandler);

    this.resizeObserver = new ResizeObserver(() => {
      if (!this.visible || !this.activeOfficeId || !this.activeAgentId) return;
      this.debouncedRefit(this.activeOfficeId, this.activeAgentId);
    });
    this.resizeObserver.observe(this.terminalDivEl);
  }

  private refitAndResize(officeId: string, agentId: string): void {
    if (!this.fitAddon || !window.copilotBridge) return;
    this.fitAddon.fit();
    const dims = this.fitAddon.proposeDimensions();
    if (!dims) return;
    void window.copilotBridge.terminalResize(officeId, agentId, dims.cols, dims.rows);
  }

  private debouncedRefit(officeId: string, agentId: string): void {
    this.clearRefitTimers();
    requestAnimationFrame(() => {
      this.refitAndResize(officeId, agentId);
      this.refitTimers.push(setTimeout(() => {
        this.refitAndResize(officeId, agentId);
        this.refitTimers.push(setTimeout(() => this.refitAndResize(officeId, agentId), 200));
      }, 150));
    });
  }

  private clearRefitTimers(): void {
    for (const timer of this.refitTimers) clearTimeout(timer);
    this.refitTimers.length = 0;
  }

  private formatElapsed(startTime: number): string {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }

  private buttonCss(background: string, border: string): string {
    return `
      background: ${background};
      border: 1px solid ${border};
      color: #d4dbf9;
      border-radius: 5px;
      padding: 5px 10px;
      font-family: inherit;
      font-size: 11px;
      cursor: pointer;
      white-space: nowrap;
    `;
  }
}
