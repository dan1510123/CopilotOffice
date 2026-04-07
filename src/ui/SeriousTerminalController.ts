type SeriousTerminalOpenOptions = {
  officeId: string;
  agentId: string;
  name: string;
  description: string;
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
  private readonly outputEl: HTMLPreElement;
  private readonly inputEl: HTMLTextAreaElement;
  private readonly sendBtn: HTMLButtonElement;
  private activeOfficeId: string | null = null;
  private activeAgentId: string | null = null;
  private visible = false;
  private openedAt = 0;

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

    this.outputEl = document.createElement('pre');
    this.outputEl.style.cssText = `
      margin: 0;
      padding: 12px;
      flex: 1;
      min-height: 0;
      overflow: auto;
      white-space: pre-wrap;
      word-break: break-word;
      font-size: 12px;
      line-height: 1.35;
      color: #d4dbf9;
      background: #0d111b;
    `;

    const inputWrap = document.createElement('div');
    inputWrap.style.cssText = `
      display: flex;
      gap: 8px;
      padding: 10px;
      border-top: 1px solid #27314e;
      background: #15192a;
      flex-shrink: 0;
    `;

    this.inputEl = document.createElement('textarea');
    this.inputEl.rows = 2;
    this.inputEl.placeholder = 'Type command and press Enter (Shift+Enter for newline)';
    this.inputEl.style.cssText = `
      flex: 1;
      resize: vertical;
      min-height: 40px;
      max-height: 180px;
      background: #0d111b;
      border: 1px solid #334166;
      border-radius: 6px;
      color: #d4dbf9;
      padding: 8px;
      font-family: inherit;
      font-size: 12px;
      outline: none;
    `;
    this.inputEl.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        void this.sendInput();
      }
    });

    this.sendBtn = document.createElement('button');
    this.sendBtn.textContent = 'Send';
    this.sendBtn.style.cssText = this.buttonCss('#23345f', '#7db0ff');
    this.sendBtn.addEventListener('click', () => {
      void this.sendInput();
    });

    inputWrap.appendChild(this.inputEl);
    inputWrap.appendChild(this.sendBtn);

    this.container.appendChild(header);
    this.container.appendChild(this.outputEl);
    this.container.appendChild(inputWrap);
    this.host.appendChild(this.container);

    if (window.copilotBridge) {
      window.copilotBridge.onTerminalData((agentId, data) => {
        if (!this.visible || this.activeAgentId !== agentId) return;
        this.appendOutput(data);
      });
      window.copilotBridge.onTerminalExit((agentId, exitCode) => {
        if (!this.visible || this.activeAgentId !== agentId) return;
        this.appendOutput(`\n[terminal exited with code ${exitCode}]\n`);
        this.setStatus('Exited');
      });
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  async openAgentTerminal(options: SeriousTerminalOpenOptions): Promise<void> {
    if (!window.copilotBridge) return;
    const switchingTarget = this.activeOfficeId !== options.officeId || this.activeAgentId !== options.agentId;
    if (switchingTarget) {
      await this.closeView({ detach: true, silent: true });
      this.outputEl.textContent = '';
    }

    this.activeOfficeId = options.officeId;
    this.activeAgentId = options.agentId;
    this.visible = true;
    this.openedAt = Date.now();
    this.container.style.display = 'flex';
    this.titleEl.textContent = `${options.name} (${options.agentId})`;
    this.subtitleEl.textContent = options.description;
    this.setStatus('Opening...');
    this.enableInput(true);

    try {
      const exists = await window.copilotBridge.terminalExists(options.officeId, options.agentId);
      if (!exists) {
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
          this.appendOutput(`Failed to start terminal: ${startResult.error || 'unknown error'}\n`);
          this.setStatus('Start failed');
          this.enableInput(false);
          return;
        }
      }

      const attachResult = await window.copilotBridge.terminalAttach(options.officeId, options.agentId);
      if (!attachResult.success) {
        this.appendOutput('Failed to attach terminal session.\n');
        this.setStatus('Attach failed');
        this.enableInput(false);
        return;
      }

      if (attachResult.scrollback) {
        this.appendOutput(attachResult.scrollback);
      }
      this.setStatus(`Attached · ${this.formatElapsed(this.openedAt)}`);
      this.inputEl.focus();
    } catch (error) {
      this.appendOutput(`Terminal error: ${(error as Error)?.message || String(error)}\n`);
      this.setStatus('Error');
      this.enableInput(false);
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
    this.setStatus('');

    if (!silent) {
      this.onClose?.();
    }
  }

  private async sendInput(): Promise<void> {
    if (!window.copilotBridge || !this.activeOfficeId || !this.activeAgentId) return;
    const value = this.inputEl.value;
    const text = value.trim();
    if (!text) return;

    this.enableInput(false);
    try {
      const outbound = value.endsWith('\n') || value.endsWith('\r') ? value : `${value}\r`;
      const result = await window.copilotBridge.terminalWrite(this.activeOfficeId, this.activeAgentId, outbound);
      if (!result.success) {
        this.appendOutput(`\n[write failed: ${result.error || 'unknown error'}]\n`);
      }
      this.inputEl.value = '';
    } finally {
      this.enableInput(true);
      this.inputEl.focus();
    }
  }

  private appendOutput(data: string): void {
    this.outputEl.textContent += data;
    this.outputEl.scrollTop = this.outputEl.scrollHeight;
  }

  private setStatus(text: string): void {
    this.statusEl.textContent = text;
  }

  private enableInput(enabled: boolean): void {
    this.inputEl.disabled = !enabled;
    this.sendBtn.disabled = !enabled;
    this.sendBtn.style.opacity = enabled ? '1' : '0.6';
    this.sendBtn.style.cursor = enabled ? 'pointer' : 'default';
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
