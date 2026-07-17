// OrchestratorPanel — focused chat TUI overlay for the Office Orchestrator agent
// (spec 016 — T017/T018/T019/T023/T023a).
//
// A DOM-modal overlay that dims the game and hosts an xterm.js chat with the
// orchestrator SDK session (main process). The user describes what they need in
// natural language; the orchestrator proposes an agent and raises an approve/deny
// prompt; approval brings that agent online — always gated, regardless of the
// global YOLO toggle.
//
// Focus is coordinated through optional `onOpen` / `onClose` callbacks the host
// wires to the `settings:open` / `settings:close` event bus
// (→ InputManager.suspendGameInput/resumeGameInput), consistent with the other
// DOM-modal overlays (SpriteCustomizerPanel, NotificationSettingsPanel). This keeps
// the panel independent of the Phaser scene so it also works in serious mode, where
// no Phaser game exists. All IPC goes through `window.copilotBridge`.

import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { ZIndex } from '../config/zIndex';
import { ensureXtermStyles } from './xtermStyles';
import { showClipboardToast } from './clipboardToast';
import { sanitizeTerminalSelection } from './terminalSelection';
import { AGENTS, RESERVE_AGENTS } from '../config/agents';

// Instance tag for clipboard diagnostics (Constitution Principle VI).
const CLIP_TAG = '[ORC0]';

interface PendingPermission {
  toolCallId: string;
  agentId?: string;
}

/** Host callbacks so the panel stays decoupled from Phaser (works in game + serious). */
export interface OrchestratorPanelHost {
  /** Called when the panel opens — host suspends game input (no-op in serious mode). */
  onOpen?: () => void;
  /** Called when the panel closes — host resumes game input. */
  onClose?: () => void;
}

function resolveAgentName(agentId?: string): string {
  if (!agentId) return 'an agent';
  const seated = AGENTS.find((a) => a.id === agentId);
  if (seated) return seated.name;
  for (const reserve of Object.values(RESERVE_AGENTS)) {
    if (reserve.id === agentId) return reserve.name;
  }
  return agentId;
}

export class OrchestratorPanel {
  private readonly host: OrchestratorPanelHost;
  private overlay: HTMLDivElement | null = null;
  private terminalDiv: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private permissionCard: HTMLDivElement | null = null;
  private statusBanner: HTMLDivElement | null = null;
  private teamsBtn: HTMLButtonElement | null = null;
  private confirmEl: HTMLDivElement | null = null;
  private teamsOnline = false;

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;

  private sessionId = '';
  private isVisible = false;
  private opening = false;
  /** Set when the user closes (red ✕) during startup, before the sessionId is known. */
  private endRequested = false;

  private readonly streamedMessageIds = new Set<string>();
  private pending: PendingPermission | null = null;
  private disposers: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(host: OrchestratorPanelHost = {}) {
    this.host = host;
  }

  isOpen(): boolean {
    return this.isVisible;
  }

  async show(): Promise<void> {
    if (this.isVisible || this.opening) return;
    this.opening = true;
    this.endRequested = false;
    ensureXtermStyles();
    this.buildDom();
    this.registerBridgeListeners();
    // Reflect a Teams binding that survived a previous minimize (singleton panel).
    this.updateTeamsButton();
    // Focus contract: suspend game input while the modal is open (no-op in serious mode).
    this.host.onOpen?.();
    this.isVisible = true;
    this.opening = false;

    try {
      const res = await window.copilotBridge.orchestratorOpen();
      if (res?.error || !res?.sessionId) {
        if (this.isVisible) {
          this.showBanner(`Orchestrator failed to start: ${res?.error ?? 'unknown error'}. You can still bring agents online manually.`, 'error');
        }
        return;
      }
      this.sessionId = res.sessionId;
      // The user closed (red ✕) before the session finished opening — end the
      // now-live session so it doesn't leak in the background.
      if (this.endRequested) {
        this.endRequested = false;
        void window.copilotBridge.orchestratorEnd(this.sessionId);
        this.sessionId = '';
        return;
      }
      // Minimized during open: keep the live session tracked, but skip UI writes.
      if (!this.isVisible) return;
      this.terminal?.writeln('\x1b[2mOrchestrator ready. Describe what you need help with…\x1b[0m');
    } catch (e) {
      if (this.isVisible) {
        this.showBanner(`Orchestrator failed to start: ${(e as Error)?.message ?? 'threw'}.`, 'error');
      }
    }
    setTimeout(() => this.inputEl?.focus(), 0);
  }

  /**
   * Minimize the overlay (blue −): tear down the DOM but KEEP the orchestrator
   * session running server-side (via `orchestratorClose`, which no longer detaches
   * the event stream). A Teams-online orchestrator keeps answering in-thread while
   * minimized; reopening rebuilds the DOM and resumes streaming from the same session.
   */
  minimize(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    // Do NOT deny a pending gate here — if the orchestrator is online in Teams the
    // in-thread approver may still respond; otherwise the server denies it on close().
    this.pending = null;
    if (this.sessionId) {
      void window.copilotBridge.orchestratorClose(this.sessionId);
    }
    this.unregisterBridgeListeners();
    this.host.onClose?.();
    this.teardownDom();
  }

  /**
   * Close the session for real (red ✕): ends the SDK session server-side. When the
   * orchestrator is Teams-online this fires the exit chain that posts the closing
   * notice to the thread and takes the binding offline. The next open() starts fresh.
   */
  closeSession(): void {
    if (!this.isVisible) return;
    this.isVisible = false;
    this.pending = null;
    // Cover the startup race: if the session hasn't finished opening yet, show()
    // will see endRequested and end it as soon as the sessionId arrives.
    this.endRequested = true;
    if (this.sessionId) {
      this.endRequested = false;
      void window.copilotBridge.orchestratorEnd(this.sessionId);
    }
    this.sessionId = '';
    this.teamsOnline = false;
    this.unregisterBridgeListeners();
    this.host.onClose?.();
    this.teardownDom();
  }

  destroy(): void {
    this.closeSession();
  }

  /**
   * Confirm before the red ✕ ends the session. Warns that closing stops the
   * orchestrator entirely (and, when Teams-online, posts a closing notice and takes
   * the thread offline), and points at minimize as the keep-running alternative.
   */
  private confirmClose(): void {
    if (!this.overlay || this.confirmEl) return;

    const scrim = document.createElement('div');
    scrim.style.cssText = `
      position: absolute; inset: 0; z-index: 5;
      background: rgba(4, 5, 12, 0.55);
      display: flex; align-items: center; justify-content: center;
    `;
    const teamsWarning = this.teamsOnline
      ? '<br><span style="color:#ffb27d">It is online in Teams — a closing notice will be posted and the thread will go offline.</span>'
      : '';
    const dialog = document.createElement('div');
    dialog.setAttribute('role', 'alertdialog');
    dialog.setAttribute('aria-label', 'Confirm closing the orchestrator session');
    dialog.style.cssText = `
      width: min(420px, 84vw); background: #12121f;
      border: 1px solid #6a2a2a; border-radius: 10px;
      box-shadow: 0 12px 48px rgba(0,0,0,0.7);
      padding: 18px 20px; color: #e0e0e0; font-size: 13px; line-height: 1.5;
    `;
    dialog.innerHTML = `
      <div style="font-size:15px;font-weight:bold;margin-bottom:8px">⚠️ Close orchestrator session?</div>
      <div style="color:#c4c4d4">This ends the orchestrator session and clears its conversation. Any in-progress requests are cancelled.${teamsWarning}<br><br><span style="color:#8a8aa6">Tip: use minimize (−) to keep it running in the background instead.</span></div>
    `;
    const row = document.createElement('div');
    row.style.cssText = 'display:flex;justify-content:flex-end;gap:10px;margin-top:16px;';
    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = 'Keep running';
    cancelBtn.style.cssText = 'padding:7px 12px;border-radius:6px;border:1px solid #33557a;background:#16233a;color:#cde;font-size:13px;cursor:pointer;';
    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'Close session';
    confirmBtn.style.cssText = 'padding:7px 12px;border-radius:6px;border:1px solid #6a2a2a;background:#3a1414;color:#ff9d9d;font-size:13px;cursor:pointer;';

    const dismiss = (): void => {
      scrim.remove();
      this.confirmEl = null;
      setTimeout(() => this.inputEl?.focus(), 0);
    };
    cancelBtn.onclick = dismiss;
    confirmBtn.onclick = () => {
      this.confirmEl = null;
      scrim.remove();
      this.closeSession();
    };
    scrim.addEventListener('mousedown', (e) => {
      if (e.target === scrim) dismiss();
    });
    dialog.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); dismiss(); }
      else if (e.key === 'Enter') { e.stopPropagation(); confirmBtn.click(); }
    });

    row.appendChild(cancelBtn);
    row.appendChild(confirmBtn);
    dialog.appendChild(row);
    scrim.appendChild(dialog);
    this.overlay.appendChild(scrim);
    this.confirmEl = scrim;
    setTimeout(() => cancelBtn.focus(), 0);
  }

  // ── DOM construction ─────────────────────────────────────────────
  private buildDom(): void {
    const overlay = document.createElement('div');
    overlay.id = 'orchestrator-overlay';
    overlay.style.cssText = `
      position: fixed; inset: 0;
      z-index: ${ZIndex.ORCHESTRATOR_PANEL};
      background: rgba(6, 8, 16, 0.72);
      display: flex; align-items: center; justify-content: center;
      font-family: 'Cascadia Code', Consolas, Monaco, monospace;
    `;
    overlay.addEventListener('mousedown', (e) => {
      if (e.target === overlay) this.minimize();
    });

    const panel = document.createElement('div');
    panel.style.cssText = `
      width: min(880px, 92vw); height: min(680px, 88vh);
      background: #0a0a14; border: 1px solid #2a2a44; border-radius: 10px;
      box-shadow: 0 12px 48px rgba(0,0,0,0.6);
      display: flex; flex-direction: column; overflow: hidden;
    `;

    // Header
    const header = document.createElement('div');
    header.style.cssText = `
      display: flex; align-items: center; justify-content: space-between;
      padding: 10px 14px; background: #12121f; border-bottom: 1px solid #2a2a44;
    `;
    const title = document.createElement('div');
    title.innerHTML = '🎩 <b>Office Orchestrator</b> <span style="color:#6a6a8a;font-size:12px">— always asks before bringing anyone online</span>';
    title.style.color = '#e0e0e0';
    const headerRight = document.createElement('div');
    headerRight.style.cssText = 'display:flex;align-items:center;gap:10px;';
    const teamsBtn = document.createElement('button');
    teamsBtn.textContent = '💬 Bring online in Teams';
    teamsBtn.title = 'Bring the orchestrator online in a Microsoft Teams channel thread so you can drive it remotely.';
    teamsBtn.style.cssText = 'padding:5px 10px;border-radius:6px;border:1px solid #33557a;background:#16233a;color:#cde;font-size:12px;cursor:pointer;';
    teamsBtn.onclick = () => this.toggleTeams();
    this.teamsBtn = teamsBtn;
    const minimizeBtn = document.createElement('button');
    minimizeBtn.textContent = '−';
    minimizeBtn.title = 'Minimize — keep the session running (Teams stays online) and hide this overlay.';
    minimizeBtn.setAttribute('aria-label', 'Minimize orchestrator');
    minimizeBtn.style.cssText = 'width:26px;height:26px;border-radius:6px;border:1px solid #33557a;background:#16233a;color:#7db4ff;font-size:18px;line-height:1;cursor:pointer;';
    minimizeBtn.onclick = () => this.minimize();
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.title = 'Close — end the orchestrator session. If online in Teams, posts a closing notice and goes offline.';
    closeBtn.setAttribute('aria-label', 'Close orchestrator session');
    closeBtn.style.cssText = 'width:26px;height:26px;border-radius:6px;border:1px solid #6a2a2a;background:#2a1414;color:#ff7d7d;font-size:15px;line-height:1;cursor:pointer;';
    closeBtn.onclick = () => this.confirmClose();
    headerRight.appendChild(teamsBtn);
    headerRight.appendChild(minimizeBtn);
    headerRight.appendChild(closeBtn);
    header.appendChild(title);
    header.appendChild(headerRight);

    // Status banner (hidden until an exit/error).
    const banner = document.createElement('div');
    banner.style.cssText = 'display:none;padding:8px 14px;font-size:13px;color:#fff;';
    this.statusBanner = banner;

    // Terminal host
    const terminalOuter = document.createElement('div');
    terminalOuter.style.cssText = 'flex:1;min-height:0;position:relative;background:#0a0a14;';
    const terminalDiv = document.createElement('div');
    terminalDiv.style.cssText = 'position:absolute;inset:8px;';
    terminalOuter.appendChild(terminalDiv);
    this.terminalDiv = terminalDiv;

    // Input row
    const inputRow = document.createElement('div');
    inputRow.style.cssText = `
      display: flex; gap: 8px; padding: 10px 12px;
      background: #12121f; border-top: 1px solid #2a2a44;
    `;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = 'Describe what you need (e.g. "someone to review my code")…';
    input.style.cssText = `
      flex: 1; padding: 8px 10px; border-radius: 6px; border: 1px solid #333355;
      background: #0a0a14; color: #e0e0e0; font-family: inherit; font-size: 14px;
    `;
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') this.submitInput();
    });
    const sendBtn = document.createElement('button');
    sendBtn.textContent = 'Send';
    sendBtn.style.cssText = 'padding:8px 16px;border-radius:6px;border:none;background:#3a5a8a;color:#fff;cursor:pointer;';
    sendBtn.onclick = () => this.submitInput();
    inputRow.appendChild(input);
    inputRow.appendChild(sendBtn);
    this.inputEl = input;

    panel.appendChild(header);
    panel.appendChild(banner);
    panel.appendChild(terminalOuter);
    panel.appendChild(inputRow);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.overlay = overlay;

    this.createTerminal(terminalDiv, terminalOuter);
  }

  private createTerminal(host: HTMLDivElement, outer: HTMLDivElement): void {
    const terminal = new Terminal({
      theme: { background: '#0a0a14', foreground: '#e0e0e0', cursor: '#00ff88' },
      fontFamily: 'Cascadia Code, Consolas, Monaco, monospace',
      fontSize: 14,
      lineHeight: 1.2,
      cursorBlink: false,
      convertEol: true,
      scrollback: 5000,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    terminal.loadAddon(fit);
    terminal.open(host);
    try { fit.fit(); } catch { /* geometry not ready */ }
    this.terminal = terminal;
    this.fitAddon = fit;

    // Constitution Principle VI — clipboard copy discipline for this TUI.
    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const mod = event.ctrlKey || event.metaKey;
      if (event.type !== 'keydown' || !mod) return true;
      if (event.key.toLowerCase() === 'c') {
        // Selection cascade (Constitution Principle VI): terminal selection first,
        // then the DOM selection scoped to the panel, before any preventDefault().
        let raw = terminal.hasSelection() ? (terminal.getSelection() ?? '') : '';
        if (!raw) raw = window.getSelection()?.toString() ?? '';
        const selection = sanitizeTerminalSelection(raw);
        if (!selection) return true; // nothing selected — let it through
        event.preventDefault();
        void this.copyToClipboard(selection);
        return false;
      }
      return true;
    });

    this.resizeObserver = new ResizeObserver(() => {
      try { this.fitAddon?.fit(); } catch { /* ignore */ }
    });
    this.resizeObserver.observe(outer);
  }

  // Mirrors TerminalOverlay.copyToClipboard: verified write via the bridge with
  // an instance-tagged toast on every branch (no bare preventDefault).
  private async copyToClipboard(text: string): Promise<void> {
    if (!text) { showClipboardToast(`${CLIP_TAG} empty selection`, 'info'); return; }
    const bridge = window.copilotBridge;
    if (!bridge?.clipboardWriteText) {
      try {
        await navigator.clipboard.writeText(text);
        showClipboardToast(`${CLIP_TAG} OK ${text.length} (fallback)`, 'success');
      } catch {
        showClipboardToast(`${CLIP_TAG} no-bridge`, 'error');
      }
      return;
    }
    try {
      const r = await bridge.clipboardWriteText(text);
      if (r?.success === true) showClipboardToast(`${CLIP_TAG} OK ${text.length} (verified)`, 'success');
      else if (r?.verified === false) showClipboardToast(`${CLIP_TAG} verify-fail (wrote=${text.length})`, 'error');
      else showClipboardToast(`${CLIP_TAG} bridge-err: ${r?.error || 'unknown'}`, 'error');
    } catch (e) {
      showClipboardToast(`${CLIP_TAG} bridge-err: ${(e as Error)?.message || 'threw'}`, 'error');
    }
  }

  private teardownDom(): void {
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.terminal?.dispose();
    this.terminal = null;
    this.fitAddon = null;
    this.permissionCard?.remove();
    this.permissionCard = null;
    this.confirmEl = null;
    this.overlay?.remove();
    this.overlay = null;
    this.terminalDiv = null;
    this.inputEl = null;
    this.statusBanner = null;
    this.streamedMessageIds.clear();
  }

  // ── Input ────────────────────────────────────────────────────────
  private submitInput(): void {
    const text = this.inputEl?.value.trim() ?? '';
    if (!text || !this.sessionId) return;
    this.terminal?.writeln(`\x1b[38;5;39m› ${text}\x1b[0m`);
    if (this.inputEl) this.inputEl.value = '';
    void window.copilotBridge.orchestratorInput(this.sessionId, text);
  }

  // ── Bridge listeners ─────────────────────────────────────────────
  private registerBridgeListeners(): void {
    this.unregisterBridgeListeners();
    this.disposers.push(
      window.copilotBridge.onOrchestratorEvent((payload) => this.renderEvent(payload.event)),
    );
    this.disposers.push(
      window.copilotBridge.onOrchestratorPermissionRequest((payload) => this.showPermission(payload)),
    );
    this.disposers.push(
      window.copilotBridge.onOrchestratorExit((payload) =>
        this.showBanner(`Orchestrator session ended (${payload.reason}). Reopen to reattach; you can still bring agents online manually.`, 'error'),
      ),
    );
  }

  private unregisterBridgeListeners(): void {
    for (const dispose of this.disposers) {
      try { dispose(); } catch { /* ignore */ }
    }
    this.disposers = [];
  }

  // ── Event → text rendering ───────────────────────────────────────
  private renderEvent(event: CopilotEventData): void {
    if (!this.terminal) return;
    const data = event.data as Record<string, unknown>;
    switch (event.type) {
      case 'assistant.message_delta': {
        if (typeof data.messageId === 'string') this.streamedMessageIds.add(data.messageId);
        if (typeof data.deltaContent === 'string') this.terminal.write(data.deltaContent);
        break;
      }
      case 'assistant.message': {
        if (typeof data.messageId === 'string' && this.streamedMessageIds.has(data.messageId)) break;
        if (typeof data.content === 'string') this.terminal.write(data.content);
        break;
      }
      case 'tool.execution_start': {
        if (typeof data.toolName === 'string') {
          this.terminal.write(`\r\n\x1b[2m[tool] ${data.toolName}\x1b[0m\r\n`);
        }
        break;
      }
      case 'assistant.turn_end': {
        this.terminal.write('\r\n');
        break;
      }
      default:
        break;
    }
  }

  // ── Approve / deny UI ────────────────────────────────────────────
  private showPermission(payload: { toolCallId: string; args: { agentId?: string; reason?: string } }): void {
    this.pending = { toolCallId: payload.toolCallId, agentId: payload.args.agentId };
    this.permissionCard?.remove();

    const name = resolveAgentName(payload.args.agentId);
    const card = document.createElement('div');
    card.style.cssText = `
      position: absolute; left: 50%; bottom: 78px; transform: translateX(-50%);
      width: min(560px, 88%); background: #14142a; border: 1px solid #3a5a8a;
      border-radius: 10px; padding: 14px 16px; box-shadow: 0 8px 28px rgba(0,0,0,0.55);
      z-index: 1;
    `;
    const q = document.createElement('div');
    q.style.cssText = 'color:#e8e8f0;font-size:14px;margin-bottom:10px;';
    q.innerHTML = `Bring <b>${name}</b> online?` + (payload.args.reason ? `<div style="color:#9aa;font-size:12px;margin-top:4px;">${payload.args.reason}</div>` : '');

    const row = document.createElement('div');
    row.style.cssText = 'display:flex;gap:10px;justify-content:flex-end;';
    const deny = document.createElement('button');
    deny.textContent = 'Deny';
    deny.style.cssText = 'padding:7px 16px;border-radius:6px;border:1px solid #663333;background:#2a1a1a;color:#f0c0c0;cursor:pointer;';
    deny.onclick = () => this.respondPermission('deny');
    const approve = document.createElement('button');
    approve.textContent = `Approve`;
    approve.style.cssText = 'padding:7px 16px;border-radius:6px;border:none;background:#2f7d4a;color:#fff;cursor:pointer;';
    approve.onclick = () => this.respondPermission('approve');
    row.appendChild(deny);
    row.appendChild(approve);

    card.appendChild(q);
    card.appendChild(row);
    // Attach to the panel (parent of the terminal outer) so it floats over the chat.
    (this.overlay?.querySelector('div') as HTMLElement | null)?.appendChild(card);
    this.permissionCard = card;
  }

  private respondPermission(decision: 'approve' | 'deny'): void {
    if (!this.pending) return;
    const { toolCallId } = this.pending;
    this.pending = null;
    this.permissionCard?.remove();
    this.permissionCard = null;
    void window.copilotBridge.orchestratorRespondPermission(this.sessionId, toolCallId, decision);
  }

  // ── Teams remote (spec 016 Workstream B) ─────────────────────────
  private async toggleTeams(): Promise<void> {
    if (!window.copilotBridge?.teamsRegisterOrchestrator) return;
    if (this.teamsBtn) this.teamsBtn.disabled = true;
    try {
      if (!this.teamsOnline) {
        const res = await window.copilotBridge.teamsRegisterOrchestrator();
        if (res?.success) {
          this.teamsOnline = true;
          this.showBanner(
            `Orchestrator is online in Teams${res.handle ? ` as @${res.handle}` : ''}. Reply in its thread to drive it; approvals appear there too.`,
            'info',
          );
        } else {
          this.showBanner(`Couldn't bring the orchestrator online in Teams: ${res?.error ?? 'unknown error'}.`, 'error');
        }
      } else {
        await window.copilotBridge.teamsStopOrchestrator?.();
        this.teamsOnline = false;
        this.showBanner('Orchestrator is offline in Teams.', 'info');
      }
    } catch (e) {
      this.showBanner(`Teams action failed: ${(e as Error)?.message ?? 'threw'}.`, 'error');
    } finally {
      this.updateTeamsButton();
      if (this.teamsBtn) this.teamsBtn.disabled = false;
    }
  }

  private updateTeamsButton(): void {
    if (!this.teamsBtn) return;
    this.teamsBtn.textContent = this.teamsOnline ? '💬 Teams: online — take offline' : '💬 Bring online in Teams';
    this.teamsBtn.style.background = this.teamsOnline ? '#1d3a24' : '#16233a';
    this.teamsBtn.style.borderColor = this.teamsOnline ? '#2f7d4a' : '#33557a';
  }

  // ── Banner ───────────────────────────────────────────────────────
  private showBanner(message: string, kind: 'error' | 'info'): void {
    if (!this.statusBanner) return;
    this.statusBanner.textContent = message;
    this.statusBanner.style.background = kind === 'error' ? '#5a2230' : '#27355a';
    this.statusBanner.style.display = 'block';
  }
}
