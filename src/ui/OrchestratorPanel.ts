// OrchestratorPanel — focused chat TUI overlay for the Office Orchestrator agent
// (spec 016 — T017/T018/T019/T023/T023a).
//
// A DOM-modal overlay that dims the game and hosts an xterm.js chat with the
// orchestrator SDK session (main process). The user describes what they need in
// natural language; the orchestrator proposes an agent and raises an approve/deny
// prompt; approval brings that agent online — always gated, regardless of the
// global YOLO toggle.
//
// Focus is coordinated through the `settings:open` / `settings:close` event bus
// (→ InputManager.suspendGameInput/resumeGameInput), consistent with the other
// DOM-modal overlays. All IPC goes through `window.copilotBridge`.

import Phaser from 'phaser';
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
  private readonly scene: Phaser.Scene;
  private overlay: HTMLDivElement | null = null;
  private terminalDiv: HTMLDivElement | null = null;
  private inputEl: HTMLInputElement | null = null;
  private permissionCard: HTMLDivElement | null = null;
  private statusBanner: HTMLDivElement | null = null;
  private teamsBtn: HTMLButtonElement | null = null;
  private teamsOnline = false;

  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;

  private sessionId = '';
  private isVisible = false;
  private opening = false;

  private readonly streamedMessageIds = new Set<string>();
  private pending: PendingPermission | null = null;
  private disposers: Array<() => void> = [];
  private resizeObserver: ResizeObserver | null = null;

  constructor(scene: Phaser.Scene) {
    this.scene = scene;
  }

  isOpen(): boolean {
    return this.isVisible;
  }

  async show(): Promise<void> {
    if (this.isVisible || this.opening) return;
    this.opening = true;
    ensureXtermStyles();
    this.buildDom();
    this.registerBridgeListeners();
    // Focus contract: suspend game input while the modal is open.
    this.scene.game.events.emit('settings:open');
    this.isVisible = true;
    this.opening = false;

    try {
      const res = await window.copilotBridge.orchestratorOpen();
      if (res?.error || !res?.sessionId) {
        this.showBanner(`Orchestrator failed to start: ${res?.error ?? 'unknown error'}. You can still bring agents online manually.`, 'error');
      } else {
        this.sessionId = res.sessionId;
        this.terminal?.writeln('\x1b[2mOrchestrator ready. Describe what you need help with…\x1b[0m');
      }
    } catch (e) {
      this.showBanner(`Orchestrator failed to start: ${(e as Error)?.message ?? 'threw'}.`, 'error');
    }
    setTimeout(() => this.inputEl?.focus(), 0);
  }

  hide(): void {
    if (!this.isVisible) return;
    this.isVisible = false;

    // Dismiss-while-pending resolves as deny.
    if (this.pending) {
      void window.copilotBridge.orchestratorRespondPermission(this.sessionId, this.pending.toolCallId, 'deny');
      this.pending = null;
    }
    // Detach the stream — NEVER kill the session (reopen reattaches).
    if (this.sessionId) {
      void window.copilotBridge.orchestratorClose(this.sessionId);
    }
    this.unregisterBridgeListeners();
    this.scene.game.events.emit('settings:close');
    this.teardownDom();
  }

  destroy(): void {
    this.hide();
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
      if (e.target === overlay) this.hide();
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
    const closeBtn = document.createElement('button');
    closeBtn.textContent = '✕';
    closeBtn.style.cssText = 'background:none;border:none;color:#aaa;font-size:18px;cursor:pointer;';
    closeBtn.onclick = () => this.hide();
    headerRight.appendChild(teamsBtn);
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
