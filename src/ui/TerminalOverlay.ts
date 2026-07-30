import Phaser from 'phaser';
import { teamsLabel } from './teamsIcon';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { AgentConfig, ADMIN_AGENT_ID } from '../config/agents';
import { ZIndex } from '../config/zIndex';
import { InputManager } from '../input/InputManager';
import { officeManager } from '../office/officeManager';
import { showClipboardToast } from './clipboardToast';
import { ensureXtermStyles } from './xtermStyles';
import { WheelPager } from './terminalWheel';
import { sanitizeTerminalSelection } from './terminalSelection';
import { getAutoStartCoordinator } from '../agents/AutoStartCoordinator';
import { TeamsSettingsOverlay } from './TeamsSettingsOverlay';
import { injectUiKit, uiButtonClass } from './uiKit';
import { renderSessionHistoryList, type SessionHistoryEntry } from './sessionHistoryRender';

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  return new Promise<T>((resolve, reject) => {
    timeoutId = setTimeout(() => {
      reject(new Error(`IPC timeout: ${label} after ${ms}ms`));
    }, ms);

    promise.then(resolve, reject).finally(() => {
      if (timeoutId !== null) {
        clearTimeout(timeoutId);
        timeoutId = null;
      }
    });
  });
}

const IPC_TIMEOUT = 10_000;
type TerminalLaunchMode = 'copilot' | 'shell';

// Feature 002 forensic logging. See OfficeScene.ts for usage notes.
const DEBUG_COLD_START =
  (typeof window !== 'undefined' &&
    (window as unknown as { __COPILOT_OFFICE_DEBUG_COLD_START__?: boolean })
      .__COPILOT_OFFICE_DEBUG_COLD_START__ === true) || false;

// Spec 003 forensic logging. Gates the optional log lines listed in
// specs/003-fix-sprite-and-serious-bugs/contracts/ui-contracts.md
// (sprite-card idempotency, scene shutdown destroy, serious-mode render
// failure, onData rebind). Default false for quiet production builds; flip
// to true during a bisect to make sprite/serious-mode regressions cheap to
// trace. Re-exported for use by sibling files (SeriousTerminalController,
// OfficeScene, MeetingScene).
export const DEBUG_SPRITE_SERIOUS = false;

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
  private mobileKeyboardBtn: HTMLButtonElement | null = null;
  private isFocused: boolean = false;
  private resizeHandler: (() => void) | null = null;
  private clipboardHandler: ((e: KeyboardEvent) => void) | null = null;
  // Accumulates wheel movement so alt-buffer scrolling is slower than one page
  // per notch (see terminalWheel.ts).
  private readonly wheelPager = new WheelPager();
  private resizeObserver: ResizeObserver | null = null;
  private refitTimers: ReturnType<typeof setTimeout>[] = [];
  private refitRaf: number | null = null;
  private refitGeneration: number = 0;
  private getOfficeId: () => string;
  private attachedOfficeId: string | null = null;
  private isReadOnly: boolean = false;
  private isReplaying: boolean = false;
  /** Spec 020: single-flight latch so a rapid double-confirm can't launch overlapping switches (FR-010). */
  private restoreInFlight: boolean = false;
  private launchMode: TerminalLaunchMode = 'copilot';
  private pendingInputLine: string = '';
  // Spec 007: awaitingSessionIdRefresh / sessionRefresh*Timer fields removed
  // along with the parseSessionId / scheduleSessionIdRefresh helpers.
  private currentSessionTitle: string | null = null;
  private isEditingSessionTitle: boolean = false;
  private terminalContextMenu: HTMLDivElement | null = null;
  private terminalContextMenuDismiss: ((e: Event) => void) | null = null;
  // Disposable returned by xterm.terminal.onData(...). Re-registered per show()
  // so the handler's closure captures the new agent id (feature 002, C3/V6).
  private onDataDisposable: { dispose: () => void } | null = null;
  // Unsubscribe functions for the bridge IPC listeners this overlay owns
  // (terminal-data, terminal-exit, session-meta-updated). Disposed and
  // re-created on every setupTerminalListeners() call so an overlay can never
  // accumulate duplicate listeners — duplicates would write each PTY byte to
  // xterm more than once (the "double characters" bug).
  private bridgeListenerDisposers: Array<() => void> = [];
  // Teams status listener has no disposer on the bridge; bind it at most once.
  private teamsListenerBound: boolean = false;
  // Toggled while show() is awaiting detach/attach so onData cannot fire input
  // against a half-attached agent (feature 002, V5).
  private isSwitchingAgent: boolean = false;
  private readonly instanceId: string;
  /** "Teams remote" control (011) — rendered only when the feature flag is on. */
  private teamsRemoteBtn: HTMLButtonElement | null = null;
  private teamsSettingsOverlay: TeamsSettingsOverlay | null = null;

  private static nextInstanceId = 0;
  private static readonly STORAGE_KEY = 'agencyOffice:terminalFullWidth';

  constructor(scene: Phaser.Scene, inputManager: InputManager, getOfficeId: () => string) {
    this.scene = scene;
    this.inputManager = inputManager;
    this.getOfficeId = getOfficeId;
    this.instanceId = String(TerminalOverlay.nextInstanceId++);
    // Load persisted fullscreen preference
    this.isFullWidth = localStorage.getItem(TerminalOverlay.STORAGE_KEY) === 'true';
    this.teamsSettingsOverlay = new TeamsSettingsOverlay({
      onOpen: () => this.scene.game.events.emit('settings:open'),
      onClose: () => this.scene.game.events.emit('settings:close'),
      onSaved: () => { void this.refreshTeamsButton(); },
    });
    this.setupTerminalListeners();
  }

  private setupTerminalListeners(): void {
    if (typeof window !== 'undefined' && window.copilotBridge) {
      // Idempotent: drop any prior registrations from this overlay first so we
      // never end up with two live callbacks writing the same byte to xterm.
      for (const dispose of this.bridgeListenerDisposers) {
        try { dispose(); } catch { /* ignore */ }
      }
      this.bridgeListenerDisposers = [];

      this.bridgeListenerDisposers.push(
        window.copilotBridge.onTerminalData((agentId: string, data: string) => {
          if (this.isReplaying) return;
          if (agentId === this.currentAgentId && this.terminal) {
            this.terminal.write(data);
          }
        }),
      );

      this.bridgeListenerDisposers.push(
        window.copilotBridge.onTerminalExit((agentId: string, exitCode: number) => {
          if (agentId === this.currentAgentId && this.terminal) {
            this.terminal.writeln(`\r\n[Process exited with code ${exitCode}]`);
          }
        }),
      );

      this.bridgeListenerDisposers.push(
        window.copilotBridge.onSessionMetaUpdated((agentId: string, meta: { title: string }) => {
          if (agentId === this.currentAgentId) {
            this.updateSessionTitleDisplay(meta?.title || null);
          }
        }),
      );

      // Teams Remote Agents (011): live-update the button when the bound
      // agent's online state changes. No disposer on the bridge — bind once.
      if (!this.teamsListenerBound) {
        window.copilotBridge.onTeamsStatusChanged?.((status: { agentId: string; online: boolean }) => {
          if (status?.agentId === this.currentAgentId) {
            this.setTeamsButtonState(!!status.online);
          }
        });
        this.teamsListenerBound = true;
      }
    }
  }

  /**
   * Re-register this overlay's IPC listeners. setupTerminalListeners() is
   * idempotent (it disposes prior registrations first), so calling this after
   * returning from another scene cannot create duplicate listeners.
   */
  reattachListeners(): void {
    this.setupTerminalListeners();
    console.log('[TerminalOverlay] Re-attached terminal IPC listeners');
  }

  // Spec 007: parseSessionId / scheduleSessionIdRefresh / awaitingSessionIdRefresh
  // were removed. They greedily matched any UUID-shaped substring in PTY data
  // (which could be a constant install/trace/OAuth UUID emitted by Copilot CLI
  // before the real session UUID), then persisted that wrong value as the
  // agent's session id. The server is now the only source of truth for session
  // ids — see `bridge.resetSession` in the /new path below.

  private getActiveOfficeId(): string {
    return this.attachedOfficeId ?? this.getOfficeId();
  }

  private clearRefitTimers(): void {
    if (this.refitRaf !== null) {
      cancelAnimationFrame(this.refitRaf);
      this.refitRaf = null;
    }
    for (const timer of this.refitTimers) {
      clearTimeout(timer);
    }
    this.refitTimers.length = 0;
  }

  // Spec 006: diagnostic toast prefix so multi-instance and channel issues
  // are visible in the UI (no DevTools required).
  private tag(): string {
    return `[O${this.instanceId}]`;
  }

  // Spec 005 + 006: write text to OS clipboard via Electron main process.
  // Diagnostic toast on every outcome so we never have to guess again.
  private async copyToClipboard(text: string, source: 'live' | 'session' = 'live'): Promise<boolean> {
    const t = this.tag();
    if (!text) {
      showClipboardToast(`${t} empty selection`, 'info');
      return false;
    }
    const bridge = window.copilotBridge as Window['copilotBridge'] | undefined;
    if (!bridge?.clipboardWriteText) {
      // Test/non-Electron fallback so unit tests can spy on clipboard writes.
      try {
        await navigator.clipboard.writeText(text);
        showClipboardToast(`${t} OK ${text.length} (fallback)`, 'success');
        return true;
      } catch {
        showClipboardToast(`${t} no-bridge`, 'error');
        return false;
      }
    }
    try {
      const r = await bridge.clipboardWriteText(text);
      if (r?.success === true) {
        showClipboardToast(`${t} OK ${text.length} (verified)`, 'success');
        return true;
      }
      if (r?.verified === false) {
        showClipboardToast(`${t} verify-fail (wrote=${text.length})`, 'error');
      } else {
        showClipboardToast(`${t} bridge-err: ${r?.error || 'unknown'}`, 'error');
      }
      return false;
    } catch (e) {
      showClipboardToast(`${t} bridge-err: ${(e as Error)?.message || 'threw'}`, 'error');
      return false;
    }
  }

  // Returns the current xterm selection sanitized for clipboard use, with any
  // trailing CLI scrollbar glyph removed (see terminalSelection.ts).
  private getSelectionForCopy(): string {
    const raw = this.terminal?.hasSelection() ? (this.terminal.getSelection() ?? '') : '';
    return sanitizeTerminalSelection(raw);
  }

  // Spec 005: read OS clipboard via Electron main, forward to PTY.
  private async pasteFromClipboardToTerminal(): Promise<void> {
    if (!this.currentAgentId || !window.copilotBridge) return;
    let text = '';
    try {
      const bridge = window.copilotBridge;
      if (bridge?.clipboardReadText) {
        const r = await bridge.clipboardReadText();
        if (r?.success) text = r.text || '';
      } else if (navigator.clipboard?.readText) {
        text = await navigator.clipboard.readText();
      }
    } catch (e) {
      showClipboardToast(`Paste failed: ${(e as Error)?.message || 'bridge threw'}`, 'error');
      return;
    }
    if (!text) {
      showClipboardToast('Clipboard is empty', 'info');
      return;
    }
    const officeId = this.attachedOfficeId ?? this.getOfficeId();
    try {
      await window.copilotBridge.terminalWrite(officeId, this.currentAgentId, text);
      showClipboardToast(`Pasted ${text.length} char${text.length === 1 ? '' : 's'}`, 'success');
    } catch (e) {
      showClipboardToast(`Paste failed: ${(e as Error)?.message || 'terminalWrite threw'}`, 'error');
    }
  }

  private resolveTerminalDimensions(): { cols: number; rows: number } | null {
    if (!this.terminal || !this.fitAddon) return null;

    this.fitAddon.fit();
    const proposed = this.fitAddon.proposeDimensions();
    const fallbackCols = this.terminal.cols || 80;
    const fallbackRows = this.terminal.rows || 24;
    const colsRaw = proposed?.cols ?? fallbackCols;
    const rowsRaw = proposed?.rows ?? fallbackRows;
    if (!Number.isFinite(colsRaw) || !Number.isFinite(rowsRaw)) return null;

    const cols = Math.max(2, Math.floor(colsRaw));
    const rows = Math.max(1, Math.floor(rowsRaw));
    return { cols, rows };
  }

  private fitAndResizeTerminal(options?: {
    officeId?: string;
    agentId?: string;
    refreshVisibleRows?: boolean;
  }): { cols: number; rows: number } | null {
    if (!this.terminal || !this.fitAddon) return null;

    const dims = this.resolveTerminalDimensions();
    if (!dims) return null;

    const agentId = options?.agentId ?? this.currentAgentId;
    if (!agentId || typeof window === 'undefined' || !window.copilotBridge) return dims;

    const officeId = options?.officeId ?? this.getActiveOfficeId();
    void window.copilotBridge.terminalResize(officeId, agentId, dims.cols, dims.rows).catch(() => {});

    if (options?.refreshVisibleRows) {
      this.terminal.refresh(0, Math.max(0, dims.rows - 1));
    }

    return dims;
  }

  private acknowledgeCompletedWork(officeId: string, agentId: string): void {
    if (agentId === 'pc-terminal') return;
    if (officeManager.acknowledgeAgentCompletion(officeId, agentId)) {
      this.scene.game.events.emit('agent:status:changed', agentId);
    }
  }

  private updateSessionDisplay(): void {
    // Query within our own SpriteCard to avoid collisions with other TerminalOverlay instances
    const el = this.spriteCardElement?.querySelector('.session-id-display') as HTMLSpanElement;
    if (el && this.sessionId) {
      el.textContent = this.sessionId;
      el.title = `Click to copy. Resume with: copilot --session-id ${this.sessionId}`;
      el.onclick = () => this.copySessionId();
    }
  }

  private updateSessionTitleDisplay(title: string | null): void {
    this.currentSessionTitle = title && title.trim().length > 0 ? title : null;
    if (this.isEditingSessionTitle) return;

    const el = this.spriteCardElement?.querySelector('.session-title-display') as HTMLSpanElement | null;
    if (!el) return;
    if (this.currentSessionTitle) {
      el.textContent = this.currentSessionTitle;
      el.title = this.currentSessionTitle;
      el.style.color = '#c8d4ff';
      return;
    }
    el.textContent = 'Untitled session';
    el.title = 'Click to set title';
    el.style.color = '#77839f';
  }

  private async startSessionTitleEdit(): Promise<void> {
    if (
      this.isReadOnly ||
      !this.currentAgentId ||
      this.isEditingSessionTitle ||
      !this.spriteCardElement ||
      !window.copilotBridge?.setSessionMeta
    ) return;

    const titleEl = this.spriteCardElement.querySelector('.session-title-display') as HTMLSpanElement | null;
    if (!titleEl) return;

    this.isEditingSessionTitle = true;
    const previousTitle = this.currentSessionTitle || '';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = previousTitle;
    input.maxLength = 120;
    input.className = 'session-title-input';
    input.style.cssText = `
      width: min(520px, 52vw);
      max-width: 100%;
      background: #101629;
      color: #dbe6ff;
      border: 1px solid #3f5c92;
      border-radius: 6px;
      padding: 6px 10px;
      font-size: 15px;
      font-weight: 700;
      font-family: 'Cascadia Code', Consolas, monospace;
      line-height: 1.25;
      outline: none;
    `;

    titleEl.replaceWith(input);
    input.focus();
    input.select();

    const agentId = this.currentAgentId;
    let finalized = false;
    const finalize = async (save: boolean): Promise<void> => {
      if (finalized) return;
      finalized = true;
      const nextTitle = save ? input.value.trim() : previousTitle;

      if (save) {
        try {
          await withTimeout(
            window.copilotBridge.setSessionMeta(this.getActiveOfficeId(), agentId, { title: nextTitle }),
            IPC_TIMEOUT,
            'setSessionMeta',
          );
        } catch (error) {
          console.warn('[TerminalOverlay] Failed to save session title', error);
        }
      }

      this.isEditingSessionTitle = false;
      this.currentSessionTitle = nextTitle || null;
      if (!input.isConnected || !this.spriteCardElement) {
        this.updateSessionTitleDisplay(this.currentSessionTitle);
        return;
      }

      input.replaceWith(titleEl);
      this.updateSessionTitleDisplay(this.currentSessionTitle);
    };

    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        void finalize(true);
      } else if (event.key === 'Escape') {
        event.preventDefault();
        void finalize(false);
      }
    });
    input.addEventListener('blur', () => {
      void finalize(true);
    });
  }

  async show(agent: AgentConfig, onClose: () => void, options?: { readOnly?: boolean; launchMode?: TerminalLaunchMode }): Promise<void> {
    const previousAgentId = this.currentAgentId;
    const previousOfficeId = this.attachedOfficeId ?? this.getOfficeId();
    const nextOfficeId = this.getOfficeId();
    const isSwitchingAgent =
      previousAgentId !== null && (previousAgentId !== agent.id || previousOfficeId !== nextOfficeId);

    if (previousAgentId && previousAgentId !== agent.id) {
      this.acknowledgeCompletedWork(previousOfficeId, previousAgentId);
    }

    // FR-010: focusing an agent (opening / attaching its terminal, including the
    // in-world E interact that routes here) clears that agent's Done completion
    // badge — the user has now seen the finished work. Clearing only flips the
    // ack flag; it never detaches or kills the session (Principle III).
    this.acknowledgeCompletedWork(nextOfficeId, agent.id);

    // Perf (switch quick-win): kick off the session-metadata read now so it runs
    // concurrently with the detach round-trip below instead of adding its own
    // serial round-trip to the switch critical path. It only feeds the header /
    // sprite-card title and never gates attach; awaited where the header is built.
    const sessionMetaPromise: Promise<{ title?: string } | null> =
      window.copilotBridge?.getSessionMeta
        ? window.copilotBridge.getSessionMeta(nextOfficeId, agent.id).catch(() => null)
        : Promise.resolve(null);

    // Feature 002 (US1, C2/V5): detach the previous agent BEFORE mutating
    // currentAgentId. Awaiting here prevents the in-flight onData/onTerminalData
    // race that produced input-lock and shared-session symptoms on cold start.
    if (isSwitchingAgent && previousAgentId && window.copilotBridge) {
      this.isSwitchingAgent = true;
      this.onDataDisposable?.dispose();
      this.onDataDisposable = null;
      try {
        const detachStartedAt = Date.now();
        await withTimeout(
          window.copilotBridge.terminalDetach(previousOfficeId, previousAgentId),
          IPC_TIMEOUT,
          'terminalDetach',
        );
        if (DEBUG_COLD_START) {
          console.log(
            `[TerminalOverlay] switch from=${previousAgentId} to=${agent.id} detachMs=${
              Date.now() - detachStartedAt
            }`,
          );
        }
      } catch (e) {
        console.warn(`[TerminalOverlay] terminalDetach failed for ${previousAgentId}: ${String(e)}`);
      }
    }

    this.currentAgentId = agent.id;
    this.onCloseCallback = onClose;
    this.isReadOnly = options?.readOnly ?? false;
    this.launchMode = options?.launchMode ?? 'copilot';

    // Snapshot the office ID at attach time so hide() detaches from the correct
    // office even if switchToOffice() changes currentOfficeId before hide() runs.
    this.attachedOfficeId = nextOfficeId;
    const officeId = this.getActiveOfficeId();

    // Store current agent for workingDir access
    this.currentAgent = agent;

    // Create container if it doesn't exist
    if (!this.container) {
      this.createContainer();
    }

    // Teams Remote Agents (011): refresh the control for the now-current agent.
    void this.refreshTeamsButton();

    // Update header with inception indicator for admin
    const inceptionBadge = agent.id === ADMIN_AGENT_ID ? ' 🎭 INCEPTION MODE' : '';
    // Session title for header and sprite card — resolved from the read started
    // before the detach above so it overlaps the switch critical path.
    let sessionTitle: string | null = null;
    try {
      const meta = await sessionMetaPromise;
      if (meta?.title) {
        sessionTitle = meta.title;
      }
    } catch (_) { /* ignore */ }
    const sessionTitleHtml = sessionTitle
      ? ` <span style="color: #aab; font-size: 15px;">— ${sessionTitle.replace(/</g, '&lt;')}</span>`
      : '';
    if (this.headerElement) {
      const readOnlyBadge = this.isReadOnly ? ' <span style="color: #ffb86c; font-size: 12px; background: #332200; padding: 2px 8px; border-radius: 4px;">🔒 READ-ONLY</span>' : '';
      const shortcutsText = this.isReadOnly
        ? '[F10] Close  [Ctrl+F] Fullscreen'
        : '[F10] Close  [/new or Ctrl+Shift+N] New Session  [Ctrl+F] Fullscreen';
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
    this.applySpriteCardResponsiveStyles();
    this.updateMobileKeyboardButtonVisibility();

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
    const agentDescriptionDisplay = this.spriteCardElement?.querySelector('.agent-description-display') as HTMLElement | null;
    if (agentDescriptionDisplay) {
      agentDescriptionDisplay.textContent = agent.description;
    }
    this.updateSessionTitleDisplay(sessionTitle);
    
    // Draw agent sprite
    this.drawAgentSprite(agent);

    this.pendingInputLine = '';
    this.clearRefitTimers();
    this.refitGeneration += 1;

    // Create or reuse terminal
    if (!this.terminal) {
      this.createTerminal();
    } else {
      // Reusing existing terminal for a returning session — reset renderer state so
      // row/cursor geometry from a previous session does not leak across switches.
      this.isReplaying = true;
      this.terminal.reset();
      this.terminal.clear();
    }

    // Reset session ID for this agent
    this.sessionId = null;

    // Check if terminal session exists, if not start one
    if (window.copilotBridge) {
      try {
        const exists = await withTimeout(
          window.copilotBridge.terminalExists(officeId, agent.id),
          IPC_TIMEOUT, 'terminalExists'
        );
        if (!exists) {
          this.isReplaying = false;
          await this.startNewSession(agent.id, agent.workingDir || officeManager.getCurrentWorkingDirectory(), officeId);
        } else {
          this.fitAndResizeTerminal({ officeId, agentId: agent.id });
          // Session exists - reattach and replay scrollback to sync xterm with PTY state.
          // Raw scrollback preserves ANSI escape sequences so xterm's cursor ends up
          // at the same position as the live PTY. Perf (switch quick-win): the saved
          // session-id read is independent of attach, so fire both concurrently to
          // shave a round-trip off the switch critical path.
          const [attachResult, savedId] = await Promise.all([
            withTimeout(
              window.copilotBridge.terminalAttach(officeId, agent.id, true),
              IPC_TIMEOUT, 'terminalAttach'
            ),
            withTimeout(
              window.copilotBridge.getSessionId(officeId, agent.id),
              IPC_TIMEOUT, 'getSessionId'
            ),
          ]);

          console.log(`[TerminalOverlay] Scrollback replay for ${agent.id}: ${attachResult?.scrollback?.length ?? 0} bytes`);
          if (attachResult?.scrollback && this.terminal) {
            this.terminal.write(attachResult.scrollback);
          }
          this.isReplaying = false;

          // Notify main.ts to refresh this agent's badge status
          this.scene.game.events.emit('agent:reattached', agent.id);

          // Do NOT fit() here — the container may not be visible/laid out yet.
          // All sizing is deferred to the post-layout rAF block below.

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

    // Feature 002 (US1, C3/V6/V7): register a fresh onData closure that binds
    // the new agentId + officeId at registration time. Clear isSwitchingAgent
    // first so the freshly registered handler accepts input immediately.
    const attachStartedAt = Date.now();
    this.isSwitchingAgent = false;
    this.registerOnDataHandler(agent.id, officeId);
    if (DEBUG_COLD_START && isSwitchingAgent) {
      console.log(
        `[TerminalOverlay] switch attach complete to=${agent.id} attachMs=${Date.now() - attachStartedAt}`,
      );
    }

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

    // V7: focus AFTER attach has resolved and onData is bound to the new agent.
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

  private async startNewSession(agentId: string, workingDir?: string, officeId?: string): Promise<void> {
    this.sessionId = null;
    this.updateSessionDisplay();
    
    const el = this.spriteCardElement?.querySelector('.session-id-display') as HTMLElement | null;
    if (el) {
      el.textContent = 'starting...';
    }

    const targetOfficeId = officeId ?? this.getActiveOfficeId();
    const dims = this.fitAndResizeTerminal({ officeId: targetOfficeId, agentId });

    const result = await withTimeout(
      this.launchMode === 'shell'
        ? window.copilotBridge.terminalStart(
            targetOfficeId,
            agentId,
            workingDir,
            dims?.cols,
            dims?.rows,
            undefined,
            'shell',
          )
        : window.copilotBridge.terminalStart(
            targetOfficeId,
            agentId,
            workingDir,
            dims?.cols,
            dims?.rows,
          ),
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

  // Spec 007: after the user types /new in the PTY, ask the server to mint
  // a fresh per-agent session UUID. Authoritative — never parses CLI output.
  private async fetchSessionId(agentId: string): Promise<void> {
    if (!window.copilotBridge) return;
    const officeId = this.getActiveOfficeId();
    try {
      const r = await window.copilotBridge.resetSession(officeId, agentId);
      if (r?.success && r.sessionId && agentId === this.currentAgentId) {
        this.sessionId = r.sessionId;
        this.updateSessionDisplay();
      }
    } catch {
      // Best-effort; leave the previous sessionId in place if reset failed.
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
      z-index: ${ZIndex.TERMINAL_OVERLAY};
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
      overflow: auto;
      min-height: 0;
      padding: 10px;
      box-sizing: border-box;
    `;
    this.terminalDiv = document.createElement('div');
    this.terminalDiv.style.cssText = `
      width: 100%;
      height: 100%;
    `;
    terminalOuter.appendChild(this.terminalDiv);
    // Click anywhere in the terminal area to re-focus (switches input + restores visuals)
    terminalOuter.addEventListener('mousedown', () => {
      if (this.isVisible && !this.isFocused) {
        this.focusTerminal();
      }
      // Ensure the xterm textarea has keyboard focus on any mousedown.
      // When SGR mouse mode is active (Copilot CLI), xterm routes mouse events
      // to the PTY but may not focus its hidden textarea — without this,
      // subsequent Ctrl+C/Ctrl+V keystrokes won't reach the customKeyEventHandler.
      this.terminal?.focus();
    });
    // Re-assert focus after mouseup — the browser's default mousedown action
    // and xterm's SGR mouse handler may move focus away from the textarea
    // between mousedown and mouseup. This ensures keyboard focus is correct
    // by the time the user presses Ctrl+C.
    terminalOuter.addEventListener('mouseup', () => {
      if (this.isVisible) {
        requestAnimationFrame(() => this.terminal?.focus());
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
    // V9: defensive removal of any pre-existing #sprite-card so the DOM
    // contains at most one at any moment, even if a prior overlay leaked
    // (e.g. scene transition without shutdown destroy).
    const stale = document.getElementById('sprite-card');
    if (stale) {
      try { stale.remove(); } catch { /* ignore */ }
      if (DEBUG_SPRITE_SERIOUS) {
        console.log('[TerminalOverlay] createSpriteCard removed stale #sprite-card before append');
      }
    }
    this.spriteCardElement = document.createElement('div');
    this.spriteCardElement.id = 'sprite-card';
    this.spriteCardElement.style.cssText = `
      width: 100%;
      background: #13131f;
      border-top: 1px solid #252540;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 14px;
      color: #888;
      display: none;
      flex-shrink: 0;
      justify-content: space-between;
      align-items: center;
      padding: 16px 24px;
      box-sizing: border-box;
      position: relative;
      z-index: ${ZIndex.TERMINAL_SPRITE_CARD};
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
      <div style="width: 72px; background: #2a2a40; border: 1px solid #3a3a58; border-radius: 8px; display: flex; align-items: center; justify-content: center; overflow: hidden; flex-shrink: 0;">
        <canvas class="agent-sprite-canvas" width="32" height="34" style="image-rendering: pixelated; width: 64px; height: 68px; display: block;"></canvas>
      </div>
      <div style="display: flex; flex-direction: column; gap: 4px; min-width: 0;">
        <span class="agent-name-display" style="font-weight: 700; font-size: 18px; color: #dde;"></span>
        <span class="agent-description-display" style="color: #778; font-size: 13px; line-height: 1.25;"></span>
        <span class="session-title-display" style="color: #c8d4ff; font-size: 14px; font-weight: 700; line-height: 1.25; cursor: text; max-width: min(520px, 52vw); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">Untitled session</span>
        <span style="color: #666; font-size: 11px;">Session ID: <span class="session-id-display" style="color: #4a9eff; cursor: pointer;">--</span></span>
      </div>
    `;
    this.spriteCardElement.appendChild(agentDisplay);

    const sessionTitleDisplay = this.spriteCardElement.querySelector('.session-title-display') as HTMLSpanElement | null;
    if (sessionTitleDisplay) {
      sessionTitleDisplay.onclick = () => { void this.startSessionTitleEdit(); };
      sessionTitleDisplay.onkeydown = (event: KeyboardEvent) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          void this.startSessionTitleEdit();
        }
      };
      sessionTitleDisplay.tabIndex = 0;
      sessionTitleDisplay.setAttribute('role', 'button');
      sessionTitleDisplay.setAttribute('aria-label', 'Edit session title');
    }

    // Right side: controls (mobile keyboard CTA + button grid)
    const controlsColumn = document.createElement('div');
    controlsColumn.style.cssText = `
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: stretch;
    `;

    const buttonGrid = document.createElement('div');
    buttonGrid.style.cssText = `
      display: grid;
      grid-template-columns: auto auto auto;
      gap: 8px;
    `;

    injectUiKit();

    const historyBtn = document.createElement('button');
    historyBtn.textContent = 'Session History';
    historyBtn.className = uiButtonClass('default');
    historyBtn.onclick = () => this.toggleSessionHistory(historyBtn);
    buttonGrid.appendChild(historyBtn);

    const newSessionBtn = document.createElement('button');
    newSessionBtn.textContent = 'New Session';
    newSessionBtn.className = uiButtonClass('primary');
    newSessionBtn.onclick = () => this.handleNewSession();
    buttonGrid.appendChild(newSessionBtn);

    const clearHistoryBtn = document.createElement('button');
    clearHistoryBtn.textContent = 'Clear History';
    clearHistoryBtn.className = uiButtonClass('default');
    clearHistoryBtn.onclick = () => this.handleClearHistory();
    buttonGrid.appendChild(clearHistoryBtn);

    const closeSessionBtn = document.createElement('button');
    closeSessionBtn.textContent = 'Close Session';
    closeSessionBtn.className = uiButtonClass('danger');
    closeSessionBtn.onclick = () => this.handleCloseSession();
    buttonGrid.appendChild(closeSessionBtn);

    // Teams Remote Agents (011): bring the agent online in a Teams channel thread.
    // Rendered only when the feature flag is enabled (visibility set by refreshTeamsButton).
    this.teamsRemoteBtn = document.createElement('button');
    this.teamsRemoteBtn.innerHTML = teamsLabel('Teams Remote');
    this.teamsRemoteBtn.className = uiButtonClass('teams');
    this.teamsRemoteBtn.style.display = 'none';
    this.teamsRemoteBtn.onclick = () => { void this.handleTeamsRemote(); };
    this.teamsRemoteBtn.title = 'Bring this agent online in a Teams channel thread';
    buttonGrid.appendChild(this.teamsRemoteBtn);
    void this.refreshTeamsButton();

    this.fullscreenBtn = document.createElement('button');
    this.fullscreenBtn.textContent = this.isFullWidth ? 'Half Width' : 'Full Width';
    this.fullscreenBtn.className = uiButtonClass('default');
    this.fullscreenBtn.onclick = () => this.toggleFullWidth();
    this.fullscreenBtn.title = 'Toggle fullscreen (Ctrl+F)';
    buttonGrid.appendChild(this.fullscreenBtn);

    const refreshFocusBtn = document.createElement('button');
    refreshFocusBtn.textContent = 'Refresh Focus';
    refreshFocusBtn.className = uiButtonClass('success');
    refreshFocusBtn.onclick = () => this.refreshFocusAndGeometry();
    refreshFocusBtn.title = 'Re-focus terminal and force geometry self-heal';
    buttonGrid.appendChild(refreshFocusBtn);

    this.mobileKeyboardBtn = document.createElement('button');
    this.mobileKeyboardBtn.textContent = '⌨ Open Keyboard';
    this.mobileKeyboardBtn.className = uiButtonClass('primary');
    this.mobileKeyboardBtn.style.cssText += `
      width: 100%;
      min-height: 56px;
      font-size: 20px;
      font-weight: bold;
    `;
    this.mobileKeyboardBtn.onclick = () => this.focusTerminal();
    this.mobileKeyboardBtn.title = 'Tap to open the device keyboard for terminal input';

    controlsColumn.appendChild(this.mobileKeyboardBtn);
    controlsColumn.appendChild(buttonGrid);
    this.spriteCardElement.appendChild(controlsColumn);
    this.updateMobileKeyboardButtonVisibility();

    // Mount to #game-container so it spans full width, between mainContent and status bar
    const gameContainer = document.getElementById('game-container');
    if (gameContainer) {
      gameContainer.appendChild(this.spriteCardElement);
    }

    // Keep footerElement reference pointing to spriteCard for history popover positioning
    this.footerElement = this.spriteCardElement;
  }

  // ── Teams Remote Agents (011) ─────────────────────────────────

  /** Show/hide + label the Teams remote button based on the feature flag + online state. */
  private async refreshTeamsButton(): Promise<void> {
    if (!this.teamsRemoteBtn || !window.copilotBridge?.teamsGetSettings) return;
    let enabled = false;
    try {
      const res = await window.copilotBridge.teamsGetSettings();
      enabled = !!(res?.success && (res.settings as { enabled?: boolean })?.enabled);
    } catch {
      enabled = false;
    }
    // In read-only (meeting replay) mode the control is not applicable.
    if (!enabled || this.isReadOnly) {
      this.teamsRemoteBtn.style.display = 'none';
      return;
    }
    this.teamsRemoteBtn.style.display = '';
    let online = false;
    try {
      const officeId = this.attachedOfficeId ?? this.getOfficeId();
      const status = await window.copilotBridge.teamsStatus({ officeId, agentId: this.currentAgentId ?? undefined });
      online = !!status?.connected;
    } catch {
      online = false;
    }
    this.setTeamsButtonState(online);
  }

  private setTeamsButtonState(online: boolean, pending = false): void {
    if (!this.teamsRemoteBtn) return;
    if (pending) {
      this.teamsRemoteBtn.innerHTML = teamsLabel('Connecting…');
      this.teamsRemoteBtn.disabled = true;
      return;
    }
    this.teamsRemoteBtn.disabled = false;
    this.teamsRemoteBtn.className = uiButtonClass(online ? 'teams-online' : 'teams');
    this.teamsRemoteBtn.innerHTML = teamsLabel(online ? 'Teams Online' : 'Teams Remote');
  }

  private async handleTeamsRemote(): Promise<void> {
    if (!this.currentAgentId || !this.currentAgent || this.isReadOnly || !window.copilotBridge) return;
    const officeId = this.attachedOfficeId ?? this.getOfficeId();
    const agentId = this.currentAgentId;

    // If already online, toggle offline.
    let online = false;
    try {
      const status = await window.copilotBridge.teamsStatus({ officeId, agentId });
      online = !!status?.connected;
    } catch { /* treat as offline */ }

    if (online) {
      this.setTeamsButtonState(false, true);
      await window.copilotBridge.teamsStop({ officeId, agentId });
      this.setTeamsButtonState(false);
      return;
    }

    this.setTeamsButtonState(false, true);
    const office = officeManager.getOffice(officeId)?.config;
    const officeChannelUrl = office?.teamsChannelUrl;
    const workingDir = this.currentAgent.workingDir || officeManager.getCurrentWorkingDirectory();
    const res = await window.copilotBridge.teamsRegister({
      officeId,
      agentId,
      displayName: this.currentAgent.name,
      workingDir,
      officeChannelUrl,
      officeMentionType: office?.teamsMentionType,
      officeMentionValue: office?.teamsMentionValue,
    });
    if (res?.success) {
      this.setTeamsButtonState(true);
      return;
    }
    this.setTeamsButtonState(false);
    // No channel configured → route the user to the Teams settings overlay (FR-004).
    if (res?.error === 'no-channel') {
      void this.teamsSettingsOverlay?.open('No Teams channel is configured. Add a default channel link to bring agents online.');
      return;
    }
    if (res?.error) {
      showClipboardToast(`Teams: ${res.error}`, 'error');
    }
  }

  private copySessionId(): void {
    if (!this.sessionId) return;
    void this.copyToClipboard(this.sessionId, 'session').then((success) => {
      if (!this.sessionIdElement) return;
      const original = this.sessionIdElement.textContent;
      this.sessionIdElement.textContent = success ? 'Copied!' : 'Copy failed';
      this.sessionIdElement.style.color = success ? '#50fa7b' : '#ff6b6b';
      setTimeout(() => {
        if (this.sessionIdElement) {
          this.sessionIdElement.textContent = original;
          this.sessionIdElement.style.color = '#4a9eff';
        }
      }, 1000);
    });
  }

  private async handleNewSession(): Promise<void> {
    if (!this.currentAgentId || !this.currentAgent || this.isReadOnly) return;
    
    // Snapshot office ID now — getOfficeId() returns the CURRENT office which may
    // change during async operations (e.g. fleet deploy switches office mid-await).
    const officeId = this.attachedOfficeId ?? this.getOfficeId();
    const agentId = this.currentAgentId;
    console.log(`[TerminalOverlay] handleNewSession: agent=${agentId}, office=${officeId}`);
    this.clearRefitTimers();
    this.refitGeneration += 1;

    // Clear terminal
    this.pendingInputLine = '';
    this.terminal?.clear();
    this.terminal?.writeln('\x1b[33m[Starting new session...]\x1b[0m\r\n');

    const el = this.spriteCardElement?.querySelector('.session-id-display') as HTMLElement | null;
    if (el) el.textContent = 'starting...';
    this.sessionId = null;
    this.updateSessionDisplay();
    this.updateSessionTitleDisplay(null);

    // T503: delegate the close+restart chain to AutoStartCoordinator so the
    // tracker coalesces a rapid double-click into a single PTY (FR-014 /
    // SC-005 / SC-008). Falls back to inline behavior if the coordinator
    // singleton has not been wired (defensive — should not happen in prod).
    const coordinator = getAutoStartCoordinator();
    if (coordinator) {
      try {
        await coordinator.replaceSession(officeId, agentId);
      } catch (err) {
        this.terminal?.writeln(`Failed to start terminal: ${(err as Error)?.message || String(err)}`);
      }
      // After the coordinator's warm path, refresh the session id from the
      // bridge so the UI shows the freshly-minted uuid.
      try {
        if (window.copilotBridge?.getSessionId) {
          const sid = await window.copilotBridge.getSessionId(officeId, agentId);
          if (sid) {
            this.sessionId = sid;
            this.updateSessionDisplay();
          }
        }
      } catch { /* ignore */ }
      return;
    }

    // ── Fallback (coordinator not wired) ──────────────────────────
    await withTimeout(
      window.copilotBridge.resetSession(officeId, agentId),
      IPC_TIMEOUT, 'resetSession'
    ).catch(() => { /* ignore */ });

    const dims = this.fitAndResizeTerminal({ officeId, agentId });
    const result = await withTimeout(
      this.launchMode === 'shell'
        ? window.copilotBridge.terminalStart(
            officeId,
            agentId,
            this.currentAgent.workingDir || officeManager.getCurrentWorkingDirectory(),
            dims?.cols,
            dims?.rows,
            undefined,
            'shell',
          )
        : window.copilotBridge.terminalStart(
            officeId,
            agentId,
            this.currentAgent.workingDir || officeManager.getCurrentWorkingDirectory(),
            dims?.cols,
            dims?.rows,
          ),
      IPC_TIMEOUT, 'terminalStart'
    );
    if (!result.success) {
      this.terminal?.writeln(`Failed to start terminal: ${result.error}`);
    } else if (result.sessionId) {
      this.sessionId = result.sessionId;
      this.updateSessionDisplay();
    }
  }

  private async handleCloseSession(): Promise<void> {
    if (!this.currentAgentId || this.isReadOnly) return;

    // Snapshot office ID — see handleNewSession comment for rationale
    const officeId = this.attachedOfficeId ?? this.getOfficeId();
    console.log(`[TerminalOverlay] handleCloseSession: agent=${this.currentAgentId}, office=${officeId}`);

    try {
      const result = await withTimeout(
        window.copilotBridge.resetSession(officeId, this.currentAgentId),
        IPC_TIMEOUT, 'resetSession'
      );
      if (result.success && result.sessionId) {
        this.sessionId = result.sessionId;
        this.updateSessionDisplay();
        this.updateSessionTitleDisplay(null);
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

    let history: SessionHistoryEntry[] = [];
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
      z-index: ${ZIndex.TERMINAL_SPRITE_CARD};
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

      // Show most recent first (#N numbering + title + exact copyable id, spec 019).
      // Spec 020: rows are clickable to restore/switch to a past session (disabled in
      // read-only meeting views, FR-017).
      const onSelect = this.isReadOnly
        ? undefined
        : (entry: SessionHistoryEntry) => { void this.handleRestoreSession(entry); };
      this.historyPopover.appendChild(
        renderSessionHistoryList(history, { readOnly: this.isReadOnly, onSelect })
      );
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

  /**
   * Spec 020: restore/switch the current agent to a previously-archived session (FR-003).
   * Shows a confirmation dialog (harder warning mid-turn, FR-016), calls the bridge under a
   * single-flight latch (FR-010), surfaces errors/advisories, and re-renders the terminal to
   * reflect the new current session. Cancel is a strict no-op (FR-004). Disabled in read-only
   * views (FR-017). Mirrors SeriousTerminalController.handleRestoreSession for parity (FR-011).
   */
  private async handleRestoreSession(entry: SessionHistoryEntry): Promise<void> {
    if (this.isReadOnly) return;                       // FR-017
    if (this.restoreInFlight) return;                  // FR-010 latch
    if (!this.currentAgentId || !this.currentAgent || !window.copilotBridge) return;

    const officeId = this.attachedOfficeId ?? this.getOfficeId();
    const agentId = this.currentAgentId;

    const title = (typeof entry.title === 'string' && entry.title.trim()) ? entry.title.trim() : entry.id;
    const midTurn = officeManager.getAgentStatus(officeId, agentId)?.subState === 'thinking';
    const message = midTurn
      ? `This agent is MID-TURN. Switching to session "${title}" will interrupt in-progress work and archive the current session. Continue?`
      : `Switch to session "${title}"? The current session will be archived into history.`;
    if (!confirm(message)) return;                     // FR-004 no-op on cancel

    this.restoreInFlight = true;
    try {
      const res = await withTimeout(
        window.copilotBridge.restoreSession(officeId, agentId, entry.id),
        IPC_TIMEOUT, 'restoreSession'
      );
      if (!res.success) {
        showClipboardToast(`Restore failed: ${res.error || 'unknown error'}`, 'error');  // FR-009
        return;
      }
      if (res.resumeContextUncertain) {
        showClipboardToast('Switched session — context may not be restored', 'info');     // FR-013
      }
      // Refresh the history popover + re-render the terminal to reflect the new current
      // session (FR-003). The server killed the old PTY, so show() re-attaches/relaunches.
      this.closeHistoryPopover();
      const onClose = this.onCloseCallback ?? (() => {});
      await this.show(this.currentAgent, onClose, { readOnly: this.isReadOnly, launchMode: this.launchMode });
    } catch (e) {
      showClipboardToast(`Restore failed: ${(e as Error)?.message || 'bridge threw'}`, 'error');
    } finally {
      this.restoreInFlight = false;
    }
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
    ensureXtermStyles();
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
    this.fitAndResizeTerminal();

    // Suppress SGR/any-event mouse tracking sequences from the PTY.
    // Copilot CLI enables mouse tracking (CSI ? 1000/1002/1003/1006 h) which
    // causes xterm to route mouse events to the PTY and disable text selection.
    // By intercepting these DECSET sequences, we keep selection working normally
    // while the PTY program (Copilot CLI) remains unaware.
    const MOUSE_MODES = new Set([1000, 1002, 1003, 1006]);
    this.terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      // If ANY param is a mouse mode, swallow the entire sequence
      for (const p of params) {
        if (typeof p === 'number' && MOUSE_MODES.has(p)) return true;
      }
      return false; // not mouse-related — let default handler process it
    });

    // Mouse-wheel scroll fix: Copilot CLI runs in the xterm alternate screen
    // buffer (no scrollback), where xterm's default wheel handler emits bare
    // arrow keys the CLI ignores — so the wheel appears dead while PageUp/Down
    // work. Take over the wheel: in the alt buffer, forward PageUp/PageDown to
    // the PTY (the keys the CLI actually pages on); in the normal buffer, return
    // true to let xterm scroll its scrollback natively.
    this.terminal.attachCustomWheelEventHandler((event: WheelEvent) => {
      const term = this.terminal;
      if (!term) return true;
      if (term.buffer.active.type !== 'alternate') return true; // normal buffer → native scroll
      const seq = this.wheelPager.feed(event);
      if (!seq) return false; // movement accumulated but not enough for a page yet
      const officeId = this.attachedOfficeId ?? this.getOfficeId();
      if (officeId && this.currentAgentId && window.copilotBridge) {
        void window.copilotBridge.terminalWrite(officeId, this.currentAgentId, seq);
      }
      return false; // suppress xterm's default arrow-key translation
    });

    // Spec 004: terminal right-click → context menu (Copy / Paste).
    this.installTerminalContextMenu();

    // Spec 004: clipboard keybindings — Ctrl+C copies the xterm selection
    // (Copilot CLI does not use Ctrl+C as SIGINT, so intercepting is safe);
    // Ctrl+V pastes via the OS clipboard → PTY.
    this.terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const isModifierPressed = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.type !== 'keydown' || !isModifierPressed) return true;

      if (key === 'c') {
        // Spec 002: query terminal selection directly — xterm 6.0.0 hasSelection()
        // returns accurate values even in canvas/WebGL renderers.
        const selection = this.getSelectionForCopy();
        if (!selection) {
          // No selection → pass through to PTY (SIGINT).
          return true;
        }
        event.preventDefault();
        event.stopPropagation();
        void this.copyToClipboard(selection, 'live');
        return false;
      }

      if (key === 'v') {
        if (this.isReadOnly) return false;
        event.preventDefault();
        event.stopPropagation();
        void this.pasteFromClipboardToTerminal();
        return false;
      }
      return true;
    });

    // Document-level capture-phase clipboard handler — catches Ctrl+C/V even
    // when xterm's textarea doesn't have DOM focus (e.g. SGR mouse mode stole
    // focus during click, or user pressed Ctrl+C without clicking first).
    if (this.clipboardHandler) {
      document.removeEventListener('keydown', this.clipboardHandler, true);
    }
    this.clipboardHandler = (event: KeyboardEvent) => {
      if (!this.isVisible) return;
      // Don't intercept when user is editing the session title or typing in
      // any non-xterm input/textarea (e.g. search, title rename).
      if (this.isEditingSessionTitle) return;
      const active = document.activeElement;
      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA') &&
          active !== this.terminal?.textarea) {
        return;
      }
      const isModifierPressed = event.ctrlKey || event.metaKey;
      if (!isModifierPressed || event.type !== 'keydown') return;
      const key = event.key.toLowerCase();

      if (key === 'c') {
        const selection = this.getSelectionForCopy();
        if (!selection) return; // no selection — let event propagate naturally
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.copyToClipboard(selection, 'live');
      } else if (key === 'v') {
        if (this.isReadOnly) return;
        event.preventDefault();
        event.stopImmediatePropagation();
        void this.pasteFromClipboardToTerminal();
      }
    };
    document.addEventListener('keydown', this.clipboardHandler, true);

    // Handle terminal input — registered fresh in registerOnDataHandler() per
    // show() so the bound agentId/officeId stay correct across agent switches
    // (feature 002, C3/V6). The first registration happens at the end of show().

    // Handle resize — store reference for cleanup in destroy()
    this.resizeHandler = () => {
      if (this.isVisible) {
        this.applySpriteCardResponsiveStyles();
        this.updateMobileKeyboardButtonVisibility();
        this.debouncedRefit();
      }
    };
    window.addEventListener('resize', this.resizeHandler);

    // ResizeObserver catches CSS-driven panel resizes that window.resize misses
    this.resizeObserver = new ResizeObserver(() => {
      if (this.isVisible) {
        this.applySpriteCardResponsiveStyles();
        this.updateMobileKeyboardButtonVisibility();
        this.debouncedRefit();
      }
    });
    if (this.terminalDiv) {
      this.resizeObserver.observe(this.terminalDiv);
    }
  }

  /**
   * Re-register the xterm `onData` handler with a fresh closure that captures
   * the bound `agentId` and `officeId` at registration time. Disposes any
   * previous registration so stale closures cannot send user keystrokes to
   * the wrong agent during an agent switch (feature 002, C3/V6).
   */
  private registerOnDataHandler(boundAgentId: string, boundOfficeId: string): void {
    if (!this.terminal) return;
    // New agent/office binding — drop any partial wheel accumulation so it can't
    // bleed a stray PageUp/PageDown into the newly-bound session.
    this.wheelPager.reset();
    this.onDataDisposable?.dispose();
    this.onDataDisposable = null;

    const result = this.terminal.onData((data: string) => {
      if (this.isReadOnly) return;
      if (this.isSwitchingAgent) return; // V5: drop input mid-switch
      if (!window.copilotBridge) return;

      let outbound = '';
      let shouldStartSlashNewSession = false;

      for (const ch of data) {
        if (ch === '\r' || ch === '\n') {
          const command = this.pendingInputLine.trim();
          this.pendingInputLine = '';
          if (command === '/new') {
            shouldStartSlashNewSession = true;
          }
          outbound += ch;
          continue;
        }

        if (ch === '\x7f') {
          this.pendingInputLine = this.pendingInputLine.slice(0, -1);
          outbound += ch;
          continue;
        }

        if (ch >= ' ') {
          this.pendingInputLine += ch;
        }
        outbound += ch;
      }

      if (outbound.length > 0) {
        window.copilotBridge.terminalWrite(boundOfficeId, boundAgentId, outbound);
      }

      if (shouldStartSlashNewSession) {
        this.fetchSessionId(boundAgentId);
      }
    });

    // xterm's onData returns an IDisposable. The mocked terminal returns
    // undefined in tests; both shapes are tolerated.
    this.onDataDisposable =
      result && typeof (result as { dispose?: () => void }).dispose === 'function'
        ? (result as { dispose: () => void })
        : null;
  }

  /**
   * Spec 004: terminal right-click context menu with Copy (enabled iff
   * non-empty selection) and Paste (always enabled). Built once, reused
   * across selections; dismissed on any outside mousedown or Escape.
   */
  private installTerminalContextMenu(): void {
    if (!this.terminal || !this.terminalDiv) return;

    const menu = document.createElement('div');
    menu.id = 'terminal-context-menu';
    menu.style.cssText = `
      position: fixed;
      display: none;
      z-index: ${ZIndex.TERMINAL_SPRITE_CARD + 10};
      min-width: 160px;
      background: #1c1c2a;
      border: 1px solid #3a3a55;
      border-radius: 6px;
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.55);
      padding: 4px 0;
      font-family: 'Cascadia Code', Consolas, monospace;
      font-size: 13px;
      color: #cfd0e0;
      user-select: none;
    `;

    const makeItem = (label: string, onClick: () => void): HTMLDivElement => {
      const item = document.createElement('div');
      item.textContent = label;
      item.style.cssText = `
        padding: 6px 14px;
        cursor: pointer;
      `;
      item.dataset.enabled = 'true';
      item.addEventListener('mouseenter', () => {
        if (item.dataset.enabled === 'true') item.style.background = '#2a2a45';
      });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      item.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (item.dataset.enabled !== 'true') return;
        this.hideTerminalContextMenu();
        onClick();
      });
      return item;
    };

    const copyItem = makeItem('Copy', () => {
      const selection = this.getSelectionForCopy();
      void this.copyToClipboard(selection, 'live');
    });
    const pasteItem = makeItem('Paste', () => {
      void this.pasteFromClipboardToTerminal();
    });
    menu.appendChild(copyItem);
    menu.appendChild(pasteItem);
    document.body.appendChild(menu);
    this.terminalContextMenu = menu;

    this.terminalDiv.addEventListener('contextmenu', (event: MouseEvent) => {
      if (!this.isVisible) return;
      event.preventDefault();
      // Clamp to viewport so the menu doesn't render off-screen.
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      menu.style.display = 'block';
      const rect = menu.getBoundingClientRect();
      const left = Math.min(event.clientX, vw - rect.width - 4);
      const top = Math.min(event.clientY, vh - rect.height - 4);
      menu.style.left = `${Math.max(0, left)}px`;
      menu.style.top = `${Math.max(0, top)}px`;
    });

    this.terminalContextMenuDismiss = (e: Event) => {
      if (!this.terminalContextMenu || this.terminalContextMenu.style.display === 'none') return;
      if (e instanceof KeyboardEvent && e.key !== 'Escape') return;
      this.hideTerminalContextMenu();
    };
    document.addEventListener('mousedown', this.terminalContextMenuDismiss, true);
    document.addEventListener('keydown', this.terminalContextMenuDismiss, true);
  }

  private hideTerminalContextMenu(): void {
    if (this.terminalContextMenu) this.terminalContextMenu.style.display = 'none';
  }

  /** Toggle between half-width and full-width terminal panel. */
  private toggleFullWidth(): void {
    if (window.__copilotOfficeMobileModeActive?.() === true) {
      this.isFullWidth = true;
      this.applyPanelLayout();
      this.updateFullscreenButton();
      this.debouncedRefit();
      return;
    }
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

    if (window.__copilotOfficeMobileModeActive?.() === true) {
      officePanel.style.display = 'none';
      terminalPanel.style.width = '100%';
      terminalPanel.style.borderLeft = 'none';
      return;
    }

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
    if (window.__copilotOfficeMobileModeActive?.() === true) return;
    const officePanel = document.getElementById('office-panel');
    const terminalPanel = document.getElementById('terminal-panel');
    if (!officePanel || !terminalPanel) return;

    officePanel.style.display = 'block';
    officePanel.style.width = '50%';
    terminalPanel.style.width = '50%';
  }

  private refreshFocusAndGeometry(): void {
    this.clearRefitTimers();
    this.refitGeneration += 1;
    this.fitAndResizeTerminal({ refreshVisibleRows: true });
    this.focusTerminal();
    this.debouncedRefit();
  }

  /** Re-fit xterm after panel resize and notify PTY of new dimensions.
   *  Multi-stage: immediate → 150ms → 350ms to catch late layout shifts. */
  private debouncedRefit(): void {
    if (!this.fitAddon || !this.terminal || !this.currentAgentId) return;

    const generation = ++this.refitGeneration;
    const agentId = this.currentAgentId;
    const officeId = this.getActiveOfficeId();
    this.clearRefitTimers();

    const doFit = () => {
      if (!this.isVisible) return;
      if (generation !== this.refitGeneration) return;
      if (this.currentAgentId !== agentId) return;
      if (this.getActiveOfficeId() !== officeId) return;
      this.fitAndResizeTerminal({ officeId, agentId });
    };

    // Stage 1: immediate (next frame)
    this.refitRaf = requestAnimationFrame(() => {
      this.refitRaf = null;
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
      if (window.__copilotOfficeMobileModeActive?.() === true) {
        this.fullscreenBtn.textContent = '⛶ Locked';
        this.fullscreenBtn.title = 'Fullscreen is locked in mobile mode';
        return;
      }
      this.fullscreenBtn.textContent = this.isFullWidth ? '⛶ Half' : '⛶ Fullscreen';
      this.fullscreenBtn.title = '';
    }
  }

  private applySpriteCardResponsiveStyles(): void {
    if (!this.spriteCardElement) return;
    this.spriteCardElement.style.minHeight = '';
    this.spriteCardElement.style.padding = '16px 24px';
  }

  private updateMobileKeyboardButtonVisibility(): void {
    if (!this.mobileKeyboardBtn) return;
    this.mobileKeyboardBtn.style.display = 'none';
  }

  /** Give keyboard focus to the terminal. Safe to call when already focused. */
  focusTerminal(): void {
    this.inputManager.switchToTerminal(
      'TerminalOverlay.focusTerminal()',
      () => this.handleNewSession(),
      () => this.toggleFullWidth()
    );
    // Synchronous focus — critical for keyboard capture when SGR mouse mode is
    // active (Copilot CLI). The InputManager retry handles edge cases where the
    // DOM isn't ready yet.
    this.terminal?.focus();
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
    const mobileLocked = window.__copilotOfficeMobileModeActive?.() === true;
    if (mobileLocked) {
      this.inputManager.switchToNone('TerminalOverlay.blurTerminal() mobile lock');
    } else {
      this.inputManager.switchToGame('TerminalOverlay.blurTerminal()');
    }
    this.inputManager.blurTerminalXterm(this.terminal);
    if (this.currentAgentId) {
      const officeId = this.attachedOfficeId ?? this.getOfficeId();
      this.acknowledgeCompletedWork(officeId, this.currentAgentId);
    }

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
      this.spriteCardElement.style.background = focused ? '#13131f' : '#101019';
      this.spriteCardElement.style.borderTopColor = focused ? '#252540' : '#1c1c2f';
    }
  }

  private setupKeyboardHandler(): void {
    // Retained for backward-compat; now handled entirely by InputManager.
    // Calling focusTerminal() above already invokes InputManager.switchToTerminal().
  }

  // Spec 008-smoke: expose state for the e2e debug hook.
  getActiveAgentId(): string | null {
    return this.currentAgentId;
  }

  hide(): void {
    this.hideTerminalContextMenu();
    this.wheelPager.reset();
    if (this.container) {
      this.container.style.display = 'none';
    }
    // Hide the SpriteCard
    if (this.spriteCardElement) {
      this.spriteCardElement.style.display = 'none';
    }
    this.updateMobileKeyboardButtonVisibility();
    this.isVisible = false;
    this.isReadOnly = false;
    this.pendingInputLine = '';
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
    // Use attachedOfficeId (captured in show()) so that if switchToOffice() changed
    // currentOfficeId between show() and hide(), we still detach from the correct office.
    if (this.currentAgentId && window.copilotBridge) {
      const officeId = this.attachedOfficeId ?? this.getOfficeId();
      window.copilotBridge.terminalDetach(officeId, this.currentAgentId).catch(() => {});
      this.attachedOfficeId = null;
    }

    if (this.onCloseCallback) {
      this.onCloseCallback();
    }

    // Return focus only when game scene is allowed to receive input
    if (window.__copilotOfficeMobileModeActive?.() !== true) {
      this.scene.game.canvas.focus();
    }
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
    this.hideTerminalContextMenu();
    if (this.clipboardHandler) {
      document.removeEventListener('keydown', this.clipboardHandler, true);
      this.clipboardHandler = null;
    }
    if (this.terminalContextMenuDismiss) {
      document.removeEventListener('mousedown', this.terminalContextMenuDismiss, true);
      document.removeEventListener('keydown', this.terminalContextMenuDismiss, true);
      this.terminalContextMenuDismiss = null;
    }
    if (this.terminalContextMenu && this.terminalContextMenu.parentNode) {
      try { this.terminalContextMenu.parentNode.removeChild(this.terminalContextMenu); } catch { /* ignore */ }
    }
    this.terminalContextMenu = null;
    this.onDataDisposable?.dispose();
    this.onDataDisposable = null;
    this.clearRefitTimers();
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
      try { this.container.parentNode.removeChild(this.container); } catch { /* ignore */ }
    }
    // V11: destroy() MUST be safe even on partial construction. Use the
    // stored reference first, then defensively belt-and-suspenders query the
    // DOM in case a stale node leaked via a different code path. Each
    // removal is independently guarded so a single failure cannot leave the
    // other DOM node behind.
    try {
      if (this.spriteCardElement && this.spriteCardElement.parentNode) {
        this.spriteCardElement.parentNode.removeChild(this.spriteCardElement);
      }
    } catch { /* ignore */ }
    try {
      const fallback = document.getElementById('sprite-card');
      if (fallback) fallback.remove();
    } catch { /* ignore */ }
    this.spriteCardElement = null;
    // Dispose only THIS overlay's bridge listeners (not a global nuke that would
    // silence other overlays). setupTerminalListeners re-registers on reattach.
    for (const dispose of this.bridgeListenerDisposers) {
      try { dispose(); } catch { /* ignore */ }
    }
    this.bridgeListenerDisposers = [];
  }
}
