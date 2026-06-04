import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ZIndex } from '../config/zIndex';

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
 * Serious-mode DOM terminal view.
 * Uses copilotBridge directly (no Phaser event dependency).
 */
export class SeriousTerminalController {
  private static readonly FULL_WIDTH_STORAGE_KEY = 'agencyOffice:seriousTerminalFullWidth';
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
  private readonly sessionTitleEl: HTMLSpanElement;
  private readonly sessionIdEl: HTMLSpanElement;
  private readonly fullscreenBtn: HTMLButtonElement;
  private historyPopover: HTMLDivElement | null = null;
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
  private activeOptions: SeriousTerminalOpenOptions | null = null;
  private isFullWidth = false;
  private terminalCopyHandler: ((event: ClipboardEvent) => void) | null = null;

  constructor(host: HTMLElement, options: SeriousTerminalControllerOptions = {}) {
    this.host = host;
    this.onClose = options.onClose;
    this.isFullWidth = localStorage.getItem(SeriousTerminalController.FULL_WIDTH_STORAGE_KEY) === 'true';
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
      background: #13131f;
      border-top: 1px solid #252540;
      font-family: 'Cascadia Code', Consolas, monospace;
      color: #c8d4ff;
      display: flex;
      flex-shrink: 0;
      justify-content: space-between;
      align-items: stretch;
      gap: 24px;
      min-height: 148px;
      padding: 16px 24px;
      box-sizing: border-box;
    `;

    const spriteCardLeft = document.createElement('div');
    spriteCardLeft.style.cssText = 'display: flex; align-items: center; gap: 18px; min-width: 0; flex: 1;';

    const spriteFrame = document.createElement('div');
    spriteFrame.style.cssText = `
      width: 72px;
      background: #2a2a40;
      border: 1px solid #3a3a58;
      border-radius: 8px;
      display: flex;
      align-items: center;
      justify-content: center;
      overflow: hidden;
      flex-shrink: 0;
    `;

    this.spriteCanvasEl = document.createElement('canvas');
    this.spriteCanvasEl.width = 32;
    this.spriteCanvasEl.height = 34;
    this.spriteCanvasEl.style.cssText = `
      image-rendering: pixelated;
      width: 64px;
      height: 68px;
      display: block;
    `;
    spriteFrame.appendChild(this.spriteCanvasEl);

    const spriteCardText = document.createElement('div');
    spriteCardText.style.cssText = 'display: flex; flex-direction: column; gap: 4px; min-width: 0;';
    this.spriteNameEl = document.createElement('span');
    this.spriteNameEl.style.cssText = 'font-size: 18px; font-weight: 700; color: #dde; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    this.spriteSubtitleEl = document.createElement('span');
    this.spriteSubtitleEl.style.cssText = 'font-size: 13px; color: #778; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    this.sessionTitleEl = document.createElement('span');
    this.sessionTitleEl.textContent = 'Untitled session';
    this.sessionTitleEl.style.cssText = 'font-size: 14px; font-weight: 700; color: #77839f; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;';
    spriteCardText.appendChild(this.spriteNameEl);
    spriteCardText.appendChild(this.spriteSubtitleEl);
    spriteCardText.appendChild(this.sessionTitleEl);
    spriteCardLeft.appendChild(spriteFrame);
    spriteCardLeft.appendChild(spriteCardText);

    const spriteCardRight = document.createElement('div');
    spriteCardRight.style.cssText = 'display: flex; flex-direction: column; justify-content: center; align-items: flex-end; gap: 8px;';
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

    const buttonGrid = document.createElement('div');
    buttonGrid.style.cssText = `
      display: grid;
      grid-template-columns: repeat(2, max-content);
      gap: 6px;
      margin-top: 2px;
    `;
    const footerBtnCss = this.buttonCss('#2a3a4a', '#4a5a6a');

    const historyBtn = document.createElement('button');
    historyBtn.textContent = 'Session History';
    historyBtn.style.cssText = footerBtnCss;
    historyBtn.onclick = () => {
      void this.toggleSessionHistory(historyBtn);
    };
    buttonGrid.appendChild(historyBtn);

    const newSessionBtn = document.createElement('button');
    newSessionBtn.textContent = 'New Session';
    newSessionBtn.style.cssText = footerBtnCss;
    newSessionBtn.onclick = () => {
      void this.handleNewSession();
    };
    buttonGrid.appendChild(newSessionBtn);

    const clearHistoryBtn = document.createElement('button');
    clearHistoryBtn.textContent = 'Clear History';
    clearHistoryBtn.style.cssText = footerBtnCss;
    clearHistoryBtn.onclick = () => {
      void this.handleClearHistory();
    };
    buttonGrid.appendChild(clearHistoryBtn);

    const closeSessionBtn = document.createElement('button');
    closeSessionBtn.textContent = 'Close Session';
    closeSessionBtn.style.cssText = this.buttonCss('#3a2a2a', '#8f5d5d');
    closeSessionBtn.onclick = () => {
      void this.handleCloseSession();
    };
    buttonGrid.appendChild(closeSessionBtn);

    this.fullscreenBtn = document.createElement('button');
    this.fullscreenBtn.textContent = this.isFullWidth ? 'Half Width' : 'Full Width';
    this.fullscreenBtn.style.cssText = this.buttonCss('#2a2f4a', '#5a6aa0');
    this.fullscreenBtn.onclick = () => this.toggleFullWidth();
    buttonGrid.appendChild(this.fullscreenBtn);

    const refreshFocusBtn = document.createElement('button');
    refreshFocusBtn.textContent = 'Refresh Focus';
    refreshFocusBtn.style.cssText = this.buttonCss('#2a3a2a', '#4f7b63');
    refreshFocusBtn.onclick = () => this.refreshFocusAndGeometry();
    buttonGrid.appendChild(refreshFocusBtn);
    spriteCardRight.appendChild(buttonGrid);

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
      window.copilotBridge.onSessionMetaUpdated((agentId) => {
        if (!this.visible || !this.activeOfficeId || this.activeAgentId !== agentId) return;
        void this.updateSessionTitle(this.activeOfficeId, agentId);
      });
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  public refreshCardFromOverview(): void {
    if (!this.visible || !this.activeAgentId) return;
    this.renderExactOverviewCard(this.activeAgentId);
  }

  async openAgentTerminal(options: SeriousTerminalOpenOptions): Promise<void> {
    if (!window.copilotBridge || !this.terminal) return;
    const switchingTarget = this.activeOfficeId !== options.officeId || this.activeAgentId !== options.agentId;
    if (switchingTarget) {
      await this.closeView({ detach: true, silent: true });
    }

    this.activeOfficeId = options.officeId;
    this.activeAgentId = options.agentId;
    this.activeOptions = { ...options };
    this.visible = true;
    this.openedAt = Date.now();
    this.sessionId = null;
    this.container.style.display = 'flex';
    this.attachTerminalCopyListener();
    this.terminal.clear();
    this.titleEl.textContent = `${options.name} (${options.agentId})`;
    this.subtitleEl.textContent = options.description;
    this.updateSpriteCard(options);
    void this.updateSessionTitle(options.officeId, options.agentId);
    this.updateSessionIdDisplay();
    this.setStatus('Opening...');
    this.applyPanelLayout();
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
      this.refreshCardFromOverview();
    } catch (error) {
      this.terminal.writeln(`\r\nTerminal error: ${(error as Error)?.message || String(error)}`);
      this.setStatus('Error');
      this.refreshCardFromOverview();
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
    this.detachTerminalCopyListener();
    this.activeOfficeId = null;
    this.activeAgentId = null;
    this.activeOptions = null;
    this.sessionId = null;
    this.sessionTitleEl.textContent = 'Untitled session';
    this.sessionTitleEl.style.color = '#77839f';
    this.updateSessionIdDisplay();
    this.setStatus('');
    this.clearRefitTimers();
    this.closeSessionHistoryPopover();
    this.applyPanelLayout();

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

  private renderExactOverviewCard(agentId: string): void {
    const sourceCard = document.querySelector(`#overview-content .agent-card[data-agent="${agentId}"]`) as HTMLElement | null;
    if (!sourceCard) return;

    const clonedCard = sourceCard.cloneNode(true) as HTMLElement;
    clonedCard.style.marginBottom = '0';
    clonedCard.style.cursor = 'default';

    const sourceCanvases = sourceCard.querySelectorAll('canvas');
    const cloneCanvases = clonedCard.querySelectorAll('canvas');
    cloneCanvases.forEach((node, i) => {
      const canvas = node as HTMLCanvasElement;
      canvas.removeAttribute('id');
      const src = sourceCanvases[i] as HTMLCanvasElement | undefined;
      const ctx = canvas.getContext('2d');
      if (!src || !ctx) return;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(src, 0, 0);
    });

    this.spriteCardEl.style.display = 'block';
    this.spriteCardEl.style.padding = '10px 10px 12px';
    this.spriteCardEl.style.minHeight = '0';
    this.spriteCardEl.style.gap = '0';
    this.spriteCardEl.style.alignItems = 'stretch';
    this.spriteCardEl.style.justifyContent = 'stretch';
    this.spriteCardEl.innerHTML = '';
    this.spriteCardEl.appendChild(clonedCard);
  }

  private async updateSessionTitle(officeId: string, agentId: string): Promise<void> {
    if (!window.copilotBridge?.getSessionMeta) {
      this.sessionTitleEl.textContent = 'Untitled session';
      this.sessionTitleEl.style.color = '#77839f';
      return;
    }
    try {
      const meta = await window.copilotBridge.getSessionMeta(officeId, agentId) as { title?: string } | null;
      const title = meta?.title?.trim();
      if (title) {
        this.sessionTitleEl.textContent = title;
        this.sessionTitleEl.style.color = '#c8d4ff';
      } else {
        this.sessionTitleEl.textContent = 'Untitled session';
        this.sessionTitleEl.style.color = '#77839f';
      }
    } catch {
      this.sessionTitleEl.textContent = 'Untitled session';
      this.sessionTitleEl.style.color = '#77839f';
    }
  }

  private async handleNewSession(): Promise<void> {
    if (!this.activeOptions) return;
    await this.startNewSession(this.activeOptions);
    this.closeSessionHistoryPopover();
  }

  private async handleClearHistory(): Promise<void> {
    if (!window.copilotBridge || !this.activeOfficeId || !this.activeAgentId) return;
    try {
      await window.copilotBridge.clearSessionHistory(this.activeOfficeId, this.activeAgentId);
      this.terminal?.writeln('\r\n[session history cleared]');
      this.closeSessionHistoryPopover();
    } catch {
      this.terminal?.writeln('\r\n[failed to clear session history]');
    }
  }

  private async handleCloseSession(): Promise<void> {
    if (!window.copilotBridge || !this.activeOfficeId || !this.activeAgentId) return;
    try {
      await window.copilotBridge.resetSession(this.activeOfficeId, this.activeAgentId);
      this.terminal?.writeln('\r\n[session closed]');
    } catch {
      this.terminal?.writeln('\r\n[failed to close session]');
    }
    await this.closeView({ detach: true });
  }

  private async toggleSessionHistory(anchor: HTMLButtonElement): Promise<void> {
    if (!window.copilotBridge || !this.activeOfficeId || !this.activeAgentId) return;
    if (this.historyPopover) {
      this.closeSessionHistoryPopover();
      return;
    }

    let history: string[] = [];
    try {
      history = await window.copilotBridge.getSessionHistory(this.activeOfficeId, this.activeAgentId);
    } catch {
      history = [];
    }

    const pop = document.createElement('div');
    pop.style.cssText = `
      position: absolute;
      right: 12px;
      bottom: calc(100% + 8px);
      width: min(620px, 88vw);
      max-height: 280px;
      overflow: auto;
      background: #101629;
      border: 1px solid #2f3f62;
      border-radius: 8px;
      box-shadow: 0 12px 28px rgba(0, 0, 0, 0.45);
      padding: 10px 12px;
      z-index: ${ZIndex.SERIOUS_TERMINAL};
      color: #c8d4ff;
      font-size: 12px;
      white-space: pre-wrap;
      line-height: 1.4;
    `;
    const title = document.createElement('div');
    title.textContent = `Session History (${history.length})`;
    title.style.cssText = 'font-weight: 700; margin-bottom: 8px; color: #9fc2ff;';
    pop.appendChild(title);

    const body = document.createElement('div');
    if (history.length === 0) {
      body.textContent = 'No history yet.';
      body.style.cssText = 'color: #77839f; font-style: italic;';
    } else {
      body.textContent = history.join('\n');
    }
    pop.appendChild(body);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.style.cssText = `${this.buttonCss('#2a2f4a', '#5a6aa0')} margin-top: 10px;`;
    closeBtn.onclick = () => this.closeSessionHistoryPopover();
    pop.appendChild(closeBtn);

    this.historyPopover = pop;
    this.spriteCardEl.style.position = 'relative';
    this.spriteCardEl.appendChild(pop);
    anchor.blur();
  }

  private closeSessionHistoryPopover(): void {
    if (this.historyPopover?.parentElement) {
      this.historyPopover.parentElement.removeChild(this.historyPopover);
    }
    this.historyPopover = null;
  }

  private copySessionId(): void {
    if (!this.sessionId) return;
    void this.writeClipboardText(this.sessionId).then((success) => {
      const original = this.sessionIdEl.textContent;
      this.sessionIdEl.textContent = success ? 'Copied!' : 'Copy failed';
      this.sessionIdEl.style.color = success ? '#61d394' : '#ff6b6b';
      setTimeout(() => {
        this.sessionIdEl.textContent = original;
        this.sessionIdEl.style.color = '#8ec3ff';
      }, 900);
    });
  }

  private attachTerminalCopyListener(): void {
    if (this.terminalCopyHandler) return;

    this.terminalCopyHandler = (event: ClipboardEvent) => {
      if (!this.visible || !this.terminal) return;

      const target = event.target;
      if (target instanceof Node && !this.terminalDivEl.contains(target)) return;

      const selectedText = this.terminal.hasSelection() ? this.terminal.getSelection() : '';
      if (!selectedText) return;

      if (event.clipboardData) {
        event.clipboardData.setData('text/plain', selectedText);
        event.preventDefault();
        return;
      }

      event.preventDefault();
      void this.writeClipboardText(selectedText).then((success) => {
        if (!success) {
          this.terminal?.writeln('\r\n[Unable to copy terminal selection. Check clipboard permissions.]');
        }
      });
    };

    this.terminalDivEl.addEventListener('copy', this.terminalCopyHandler);
  }

  private detachTerminalCopyListener(): void {
    if (!this.terminalCopyHandler) return;
    this.terminalDivEl.removeEventListener('copy', this.terminalCopyHandler);
    this.terminalCopyHandler = null;
  }

  private async writeClipboardText(text: string): Promise<boolean> {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back for Electron contexts where navigator.clipboard may be unavailable/blocked.
      const ta = document.createElement('textarea');
      ta.value = text;
      ta.setAttribute('readonly', 'true');
      ta.style.position = 'fixed';
      ta.style.left = '-9999px';
      ta.style.top = '0';
      ta.style.opacity = '0';
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      ta.setSelectionRange(0, ta.value.length);
      const copied = document.execCommand('copy');
      document.body.removeChild(ta);
      return copied;
    }
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
    this.attachTerminalCopyListener();

    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const isModifierPressed = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.type !== 'keydown' || !isModifierPressed) return true;

      if (key === 'c') {
        // Selection: allow native copy shortcut path (handled by copy event listener).
        // No selection: allow default terminal behavior (e.g. SIGINT).
        return true;
      }

      if (key === 'v') {
        event.preventDefault();
        event.stopPropagation();
        navigator.clipboard.readText().then((text) => {
          if (text) this.terminal?.paste(text);
        }).catch(() => {});
        return false;
      }
      if (key === 'f') {
        event.preventDefault();
        event.stopPropagation();
        this.toggleFullWidth();
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

  private refreshFocusAndGeometry(): void {
    if (!this.visible || !this.activeOfficeId || !this.activeAgentId) return;
    this.terminal?.focus();
    this.debouncedRefit(this.activeOfficeId, this.activeAgentId);
  }

  private toggleFullWidth(): void {
    this.isFullWidth = !this.isFullWidth;
    localStorage.setItem(SeriousTerminalController.FULL_WIDTH_STORAGE_KEY, String(this.isFullWidth));
    this.fullscreenBtn.textContent = this.isFullWidth ? 'Half Width' : 'Full Width';
    this.applyPanelLayout();
  }

  private applyPanelLayout(): void {
    const officePanel = document.getElementById('office-panel') as HTMLElement | null;
    const terminalPanel = document.getElementById('terminal-panel') as HTMLElement | null;
    const isMobile = window.__copilotOfficeMobileModeActive?.() === true;
    if (!officePanel || !terminalPanel || isMobile) return;

    const appMode = document.getElementById('game-container')?.dataset.appMode;
    if (appMode !== 'serious' || !this.visible || !this.isFullWidth) {
      officePanel.style.display = 'flex';
      officePanel.style.flexDirection = 'column';
      terminalPanel.style.width = '50%';
      terminalPanel.style.borderLeft = '2px solid #333';
      return;
    }

    officePanel.style.display = 'none';
    terminalPanel.style.width = '100%';
    terminalPanel.style.borderLeft = 'none';
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
      padding: 6px 10px;
      font-family: inherit;
      font-size: 12px;
      cursor: pointer;
      white-space: nowrap;
    `;
  }
}
