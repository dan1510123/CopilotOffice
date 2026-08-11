import { Terminal } from '@xterm/xterm';
import { teamsLabel } from './teamsIcon';
import { FitAddon } from '@xterm/addon-fit';
import { ZIndex } from '../config/zIndex';
import { DEBUG_SPRITE_SERIOUS } from './TerminalOverlay';
import { showClipboardToast } from './clipboardToast';
import { ensureXtermStyles } from './xtermStyles';
import { WheelPager } from './terminalWheel';
import { sanitizeTerminalSelection } from './terminalSelection';
import { getAutoStartCoordinator } from '../agents/AutoStartCoordinator';
import { TeamsSettingsOverlay } from './TeamsSettingsOverlay';
import { officeManager } from '../office/officeManager';
import { perfMark } from './terminalPerf';
import { injectUiKit, uiButtonClass } from './uiKit';
import { renderSessionHistoryList, type SessionHistoryEntry } from './sessionHistoryRender';
import {
  TerminalInstanceCache,
  type TerminalCacheFactoryContext,
  type CreatedTerminal,
} from './TerminalInstanceCache';

/**
 * Spec 021 Phase 5b: high-volume trace of the serious-mode xterm cache lifecycle
 * (cold miss / warm hit / activate path / evict+detach / invalidate). Default
 * false for quiet production builds; flip to true to watch fresh-vs-cached xterm
 * decisions and viewer retain/detach in the DevTools console during a bisect.
 */
export const DEBUG_SERIOUS_CACHE = false;

function cacheLog(message: string): void {
  if (DEBUG_SERIOUS_CACHE) console.log(`[serious-cache] ${message}`);
}

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
  /** Called when a DOM-modal overlay (Teams settings) opens — wire to InputManager. */
  onOverlayOpen?: () => void;
  /** Called when that overlay closes — wire to InputManager. */
  onOverlayClose?: () => void;
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
  // Spec 021 Phase 5b: six-entry LRU xterm cache. `this.terminal`/`this.fitAddon`
  // above are pointers to the currently-visible cache entry so the ~25 existing
  // call sites keep operating on the visible instance unchanged.
  private terminalCache: TerminalInstanceCache | null = null;
  // Surface-global handlers (context menu, resize/ResizeObserver) install once,
  // after the first cache entry exists.
  private surfaceHandlersInstalled = false;
  // Accumulates wheel movement so alt-buffer scrolling is slower than one page
  // per notch (see terminalWheel.ts).
  private readonly wheelPager = new WheelPager();
  private resizeObserver: ResizeObserver | null = null;
  private resizeHandler: (() => void) | null = null;
  private refitTimers: ReturnType<typeof setTimeout>[] = [];
  // Serious mode tears down Phaser (no InputManager), so this controller is the
  // sole owner of xterm focus retention. These timers back the focus verify+retry
  // and are kept separate from refitTimers (which debouncedRefit clears).
  private focusRetryTimers: ReturnType<typeof setTimeout>[] = [];
  private activeOfficeId: string | null = null;
  private activeAgentId: string | null = null;
  private visible = false;
  private openedAt = 0;
  private sessionId: string | null = null;
  private activeOptions: SeriousTerminalOpenOptions | null = null;
  /** Spec 020: single-flight latch so a rapid double-confirm can't launch overlapping switches (FR-010). */
  private restoreInFlight = false;
  private isFullWidth = false;
  private terminalContextMenu: HTMLDivElement | null = null;
  private terminalContextMenuDismiss: ((e: Event) => void) | null = null;
  private static nextSeriousId = 0;
  private readonly seriousInstanceId: string = String(SeriousTerminalController.nextSeriousId++);
  /** Teams Remote Agents (011) — mirror of the TerminalOverlay control (Principle VI). */
  private teamsRemoteBtn: HTMLButtonElement | null = null;
  private readonly teamsSettingsOverlay: TeamsSettingsOverlay;

  constructor(host: HTMLElement, options: SeriousTerminalControllerOptions = {}) {
    this.host = host;
    this.onClose = options.onClose;
    this.teamsSettingsOverlay = new TeamsSettingsOverlay({
      onOpen: options.onOverlayOpen,
      onClose: options.onOverlayClose,
      onSaved: () => { void this.refreshTeamsButton(); },
    });
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
    detachBtn.className = uiButtonClass('primary');
    detachBtn.addEventListener('click', () => {
      void this.closeView({ detach: true });
    });

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = uiButtonClass('danger');
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
      overflow: auto;
      background: #0d111b;
      padding: 10px;
      box-sizing: border-box;
    `;
    this.terminalDivEl = document.createElement('div');
    this.terminalDivEl.style.cssText = 'width: 100%; height: 100%;';
    this.terminalOuterEl.appendChild(this.terminalDivEl);
    // Any click in the terminal area must (re-)assert xterm keyboard focus.
    // mousedown alone loses the race when the browser settles focus after the
    // click (e.g. focus was on a sprite-card button/history row), so re-assert
    // on mouseup as well. Mirrors TerminalOverlay's proven handling.
    this.terminalOuterEl.addEventListener('mousedown', () => this.focusTerminalHardened());
    this.terminalOuterEl.addEventListener('mouseup', () => {
      requestAnimationFrame(() => this.focusTerminalHardened());
    });

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
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 7px;
      margin-top: 2px;
    `;

    const historyBtn = document.createElement('button');
    historyBtn.textContent = 'Session History';
    historyBtn.className = uiButtonClass('default');
    historyBtn.onclick = () => {
      void this.toggleSessionHistory(historyBtn);
    };
    buttonGrid.appendChild(historyBtn);

    const newSessionBtn = document.createElement('button');
    newSessionBtn.textContent = 'New Session';
    newSessionBtn.className = uiButtonClass('primary');
    newSessionBtn.onclick = () => {
      void this.handleNewSession();
    };
    buttonGrid.appendChild(newSessionBtn);

    const clearHistoryBtn = document.createElement('button');
    clearHistoryBtn.textContent = 'Clear History';
    clearHistoryBtn.className = uiButtonClass('default');
    clearHistoryBtn.onclick = () => {
      void this.handleClearHistory();
    };
    buttonGrid.appendChild(clearHistoryBtn);

    const closeSessionBtn = document.createElement('button');
    closeSessionBtn.textContent = 'Close Session';
    closeSessionBtn.className = uiButtonClass('danger');
    closeSessionBtn.onclick = () => {
      void this.handleCloseSession();
    };
    buttonGrid.appendChild(closeSessionBtn);

    // Teams Remote Agents (011): mirror of TerminalOverlay's control (Principle VI).
    this.teamsRemoteBtn = document.createElement('button');
    this.teamsRemoteBtn.innerHTML = teamsLabel('Teams Remote');
    this.teamsRemoteBtn.className = uiButtonClass('teams');
    this.teamsRemoteBtn.style.display = 'none';
    this.teamsRemoteBtn.onclick = () => { void this.handleTeamsRemote(); };
    buttonGrid.appendChild(this.teamsRemoteBtn);

    this.fullscreenBtn = document.createElement('button');
    this.fullscreenBtn.textContent = this.isFullWidth ? 'Half Width' : 'Full Width';
    this.fullscreenBtn.className = uiButtonClass('default');
    this.fullscreenBtn.onclick = () => this.toggleFullWidth();
    buttonGrid.appendChild(this.fullscreenBtn);

    const refreshFocusBtn = document.createElement('button');
    refreshFocusBtn.textContent = 'Refresh Focus';
    refreshFocusBtn.className = uiButtonClass('success');
    refreshFocusBtn.onclick = () => this.refreshFocusAndGeometry();
    buttonGrid.appendChild(refreshFocusBtn);
    spriteCardRight.appendChild(buttonGrid);

    this.spriteCardEl.appendChild(spriteCardLeft);
    this.spriteCardEl.appendChild(spriteCardRight);

    this.ensureXtermStyles();
    injectUiKit();
    this.container.appendChild(header);
    this.container.appendChild(this.terminalOuterEl);
    this.container.appendChild(this.spriteCardEl);
    this.host.appendChild(this.container);

    if (window.copilotBridge) {
      // Spec 021 Phase 5b: route terminal output by composite office+agent to the
      // exact cached entry (so hidden background terminals keep rendering) and drop
      // output from a superseded session generation (New/Close/Restore). Falls back
      // to the visible entry for legacy emits that omit officeId.
      window.copilotBridge.onTerminalData((agentId, data, officeId?, sessionId?) => {
        const entry = officeId
          ? this.terminalCache?.peek(officeId, agentId)
          : this.terminalCache?.getVisible();
        if (!entry) return;
        if (entry.sessionId && sessionId && entry.sessionId !== sessionId) return;
        entry.terminal.write(data);
      });
      window.copilotBridge.onTerminalExit((agentId, exitCode, officeId?, sessionId?) => {
        const entry = officeId
          ? this.terminalCache?.peek(officeId, agentId)
          : this.terminalCache?.getVisible();
        if (!entry) return;
        if (entry.sessionId && sessionId && entry.sessionId !== sessionId) return;
        entry.terminal.writeln(`\r\n[terminal exited with code ${exitCode}]`);
        if (this.visible && this.activeAgentId === agentId) this.setStatus('Exited');
      });
      window.copilotBridge.onSessionMetaUpdated((agentId) => {
        if (!this.visible || !this.activeOfficeId || this.activeAgentId !== agentId) return;
        void this.updateSessionTitle(this.activeOfficeId, agentId);
      });
      window.copilotBridge.onTeamsStatusChanged?.((status: { agentId: string; online: boolean }) => {
        if (status?.agentId === this.activeAgentId) this.setTeamsButtonState(!!status.online);
      });
    }
  }

  isVisible(): boolean {
    return this.visible;
  }

  // Spec 008-smoke: expose active agent id for the e2e debug hook.
  getActiveAgentId(): string | null {
    return this.activeAgentId ?? null;
  }

  // Spec 008-smoke (T10): expose the visible sprite-card + session-id panel
  // text so e2e tests can assert what the operator actually sees after agent
  // switches. Used to repro the user-reported "locked to one agent" symptom.
  getPanelSnapshot(): {
    activeAgentId: string | null;
    titleText: string;
    spriteName: string;
    spriteSubtitle: string;
    sessionIdText: string;
    sessionIdField: string | null;
  } {
    return {
      activeAgentId: this.activeAgentId ?? null,
      titleText: this.titleEl.textContent ?? '',
      spriteName: this.spriteNameEl.textContent ?? '',
      spriteSubtitle: this.spriteSubtitleEl.textContent ?? '',
      sessionIdText: this.sessionIdEl.textContent ?? '',
      sessionIdField: this.sessionId ?? null,
    };
  }

  public refreshCardFromOverview(): void {
    if (!this.visible || !this.activeAgentId) return;
    this.renderExactOverviewCard(this.activeAgentId);
  }

  async openAgentTerminal(options: SeriousTerminalOpenOptions): Promise<void> {
    if (!window.copilotBridge) return;
    const { officeId, agentId } = options;
    const perfTarget = `${officeId}:${agentId}`;
    perfMark('serious', 'switch:request', perfTarget);

    // Spec 021 Phase 5b (retain-while-cached): switching agents no longer detaches
    // the previous server viewer or tears down its xterm. We only clear per-switch
    // transient UI timers/popovers; cache.activate() hides the prior entry's host
    // and its viewer stays attached (warm re-open with no replay). Viewers detach
    // only on eviction/close/restore via the cache onEvict hook.
    this.clearRefitTimers();
    this.clearFocusRetryTimers();
    this.closeSessionHistoryPopover();

    this.activeOfficeId = officeId;
    this.activeAgentId = agentId;
    this.activeOptions = { ...options };
    void this.refreshTeamsButton();
    // New agent/office binding — drop any partial wheel accumulation so it can't
    // bleed a stray PageUp/PageDown into the newly-bound session.
    this.wheelPager.reset();
    this.visible = true;
    this.openedAt = Date.now();
    this.sessionId = null;
    this.container.style.display = 'flex';

    // Acquire (or lazily create) the retained xterm for this office+agent. A warm
    // hit re-shows the already-rendered terminal with NO reset/clear/replay; a miss
    // builds a fresh xterm via the factory. Point this.terminal/this.fitAddon at the
    // visible entry so all existing call sites operate on it.
    const cache = this.ensureTerminalCache();
    const { entry, created } = cache.acquire(officeId, agentId);
    cacheLog(
      `acquire ${officeId}:${agentId} → ${created ? 'COLD miss (fresh xterm)' : 'WARM hit (no replay)'} (entries=${cache.size}, keys=[${cache.keys().join(', ')}])`,
    );
    this.terminal = entry.terminal;
    this.fitAddon = entry.fitAddon;
    cache.activate(officeId, agentId);
    // Surface-global handlers read the now-visible this.terminal; install once.
    this.installSurfaceHandlers();

    // Spec 003 V12/V12.a, C8: the synchronous render phase (sprite, title,
    // refit) MUST NOT silently abort the entire open. Wrap in try/catch; on
    // throw, surface a status update + visible terminal warning, then STILL
    // proceed to the IPC attach phase using the requested ids so the PTY
    // session is reachable for the operator. Note: warm hits are NOT cleared —
    // the retained buffer is the whole point of the cache.
    try {
      this.titleEl.textContent = `${options.name} (${agentId})`;
      this.subtitleEl.textContent = options.description;
      this.updateSpriteCard(options);
      void this.updateSessionTitle(officeId, agentId);
      this.updateSessionIdDisplay();
      this.setStatus(created ? 'Opening...' : 'Attached');
      this.applyPanelLayout();
      this.refitAndResize(officeId, agentId);
    } catch (err) {
      const message = `serious-mode open failed during render: ${(err as Error)?.message || String(err)}`;
      try { this.setStatus(message); } catch { /* ignore */ }
      try { this.terminal.writeln(`\r\n[render error: ${message}]\r\n`); } catch { /* ignore */ }
      if (DEBUG_SPRITE_SERIOUS) {
        console.log(
          `[SeriousTerminalController] openAgentTerminal render failure (officeId=${officeId} agentId=${agentId}): ${message}`,
        );
      } else {
        console.warn('[SeriousTerminalController] openAgentTerminal render failure', err);
      }
      // Fall through to attach — do NOT return.
    }

    try {
      const dims = this.fitAddon?.proposeDimensions();
      perfMark('serious', 'switch:activate-start', perfTarget);

      if (created) {
        // Cold cache entry — establish the server-side session.
        const exists = await window.copilotBridge.terminalExists(officeId, agentId);
        perfMark('serious', 'switch:exists-done', perfTarget, exists ? 1 : 0);

        if (!exists) {
          // Brand-new session: start it, then explicitly claim foreground (a cold
          // ui-server start may not auto-foreground during a switch).
          cacheLog(`activate ${officeId}:${agentId} → COLD/new: terminalStart + foreground activate`);
          const startResult = await window.copilotBridge.terminalStart(
            officeId, agentId, options.workingDir, dims?.cols, dims?.rows, undefined, options.launchMode || 'copilot',
          );
          if (!startResult.success) {
            this.terminal.writeln(`\r\nFailed to start terminal: ${startResult.error || 'unknown error'}`);
            this.setStatus('Start failed');
            return;
          }
          const act = await window.copilotBridge.terminalActivate(officeId, agentId, { foreground: true, needScrollback: false });
          if (act.success) {
            cache.setAttached(officeId, agentId, true);
            const sid = startResult.sessionId ?? act.sessionId ?? null;
            if (sid) { this.sessionId = sid; this.updateSessionIdDisplay(); }
            cache.setSessionId(officeId, agentId, this.sessionId);
          }
        } else {
          // Already-running server session: activate atomically with a one-time
          // scrollback replay into the fresh xterm.
          cacheLog(`activate ${officeId}:${agentId} → COLD/existing: atomic activate + one-time scrollback replay`);
          const act = await window.copilotBridge.terminalActivate(officeId, agentId, {
            foreground: true, needScrollback: true, cols: dims?.cols, rows: dims?.rows,
          });
          if (!act.success) {
            this.terminal.writeln('\r\nFailed to attach terminal session.');
            this.setStatus('Attach failed');
            return;
          }
          cache.setAttached(officeId, agentId, true);
          if (act.scrollback) {
            this.terminal.write(act.scrollback);
            cacheLog(`scrollback replay ${officeId}:${agentId} (${act.scrollback.length} bytes)`);
            perfMark('serious', 'switch:scrollback-write', perfTarget, act.scrollback.length);
          }
          if (act.sessionId) { this.sessionId = act.sessionId; this.updateSessionIdDisplay(); }
          cache.setSessionId(officeId, agentId, act.sessionId ?? null);
        }
      } else {
        // Warm cache hit — the retained xterm already reflects live PTY state.
        // ONE activation claims foreground; NO exists / getSessionId / scrollback
        // replay (that is the whole point of the cache).
        cacheLog(`activate ${officeId}:${agentId} → WARM: single foreground activate, no replay`);
        const act = await window.copilotBridge.terminalActivate(officeId, agentId, {
          foreground: true, needScrollback: false, cols: dims?.cols, rows: dims?.rows,
        });
        if (act.success) {
          cache.setAttached(officeId, agentId, true);
          if (act.sessionId) {
            this.sessionId = act.sessionId;
            cache.setSessionId(officeId, agentId, act.sessionId);
          } else if (entry.sessionId) {
            this.sessionId = entry.sessionId;
          }
          this.updateSessionIdDisplay();
        }
      }
      perfMark('serious', 'switch:activate-done', perfTarget);

      this.setStatus(`Attached · ${this.formatElapsed(this.openedAt)}`);
      this.focusTerminalHardened();
      this.debouncedRefit(officeId, agentId);
      this.refreshCardFromOverview();
      perfMark('serious', 'switch:first-ready', perfTarget);
    } catch (error) {
      this.terminal.writeln(`\r\nTerminal error: ${(error as Error)?.message || String(error)}`);
      this.setStatus('Error');
      this.refreshCardFromOverview();
    }
  }

  async startNewSession(options: SeriousTerminalOpenOptions): Promise<void> {
    if (!window.copilotBridge) return;

    // T504: when the coordinator is wired (production path), delegate the
    // close+restart chain to it so a rapid double-click coalesces to a
    // single PTY (FR-014). If the view is currently rendering this
    // (officeId, agentId) the resulting onStarting/onReady events propagate
    // back through the existing terminal data channel and refresh the card.
    const coordinator = getAutoStartCoordinator();
    if (coordinator) {
      try {
        await coordinator.replaceSession(options.officeId, options.agentId);
      } catch (err) {
        console.warn(
          `[SeriousTerminalController] replaceSession failed for ${options.agentId}: ${(err as Error)?.message || String(err)}`,
        );
      }
      // Spec 021 Phase 5b: the PTY was replaced, so drop the cached xterm holding
      // the old session's rendered content (and detach its viewer via onEvict) so
      // the re-open rebuilds a COLD entry that replays the fresh session.
      cacheLog(`invalidate ${options.officeId}:${options.agentId} (reason=new-session/coordinator)`);
      this.terminalCache?.invalidate(options.officeId, options.agentId);
      const isCurrentView =
        this.visible &&
        this.activeOfficeId === options.officeId &&
        this.activeAgentId === options.agentId;
      if (isCurrentView) {
        // Re-attach the visible view to the new PTY so the terminal renders
        // its replay/output stream.
        await this.openAgentTerminal(options);
      }
      return;
    }

    // ── Fallback (coordinator not wired) ──────────────────────────
    try {
      await window.copilotBridge.resetSession(options.officeId, options.agentId);
    } catch {
      // Keep going to start a fresh session even if reset fails.
    }
    // Spec 021 Phase 5b: same cache invalidation as the coordinator path above.
    cacheLog(`invalidate ${options.officeId}:${options.agentId} (reason=new-session/fallback)`);
    this.terminalCache?.invalidate(options.officeId, options.agentId);

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
    // Spec 021 Phase 5b (retain-while-cached): closing the panel / switching office
    // no longer detaches the server viewer here. Each cached entry keeps its viewer
    // attached so background PTY output keeps rendering into its hidden xterm,
    // making re-open a warm no-replay hit. Viewers detach only on eviction /
    // session invalidation (New/Close/Restore) / cache destroy. `detach` is retained
    // for API compatibility but intentionally does not force a per-agent detach.
    void detach;
    cacheLog(`closeView: retain-while-cached hide (prev=${this.activeOfficeId ?? '—'}:${this.activeAgentId ?? '—'}, no detach)`);
    this.terminalCache?.hide();

    this.visible = false;
    this.container.style.display = 'none';
    this.hideTerminalContextMenu();
    this.activeOfficeId = null;
    this.activeAgentId = null;
    this.activeOptions = null;
    this.sessionId = null;
    this.wheelPager.reset();
    this.sessionTitleEl.textContent = 'Untitled session';
    this.sessionTitleEl.style.color = '#77839f';
    this.updateSessionIdDisplay();
    this.setStatus('');
    this.clearRefitTimers();
    this.clearFocusRetryTimers();
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

  // ── Teams Remote Agents (011) ─────────────────────────────────

  private async refreshTeamsButton(): Promise<void> {
    if (!this.teamsRemoteBtn || !window.copilotBridge?.teamsGetSettings) return;
    let enabled = false;
    try {
      const res = await window.copilotBridge.teamsGetSettings();
      enabled = !!(res?.success && (res.settings as { enabled?: boolean })?.enabled);
    } catch { enabled = false; }
    if (!enabled) {
      this.teamsRemoteBtn.style.display = 'none';
      return;
    }
    this.teamsRemoteBtn.style.display = '';
    let online = false;
    try {
      const status = await window.copilotBridge.teamsStatus({
        officeId: this.activeOfficeId ?? undefined,
        agentId: this.activeAgentId ?? undefined,
      });
      online = !!status?.connected;
    } catch { online = false; }
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
    if (!this.activeOptions || !this.activeOfficeId || !this.activeAgentId || !window.copilotBridge) return;
    const officeId = this.activeOfficeId;
    const agentId = this.activeAgentId;

    let online = false;
    try {
      const status = await window.copilotBridge.teamsStatus({ officeId, agentId });
      online = !!status?.connected;
    } catch { /* offline */ }

    if (online) {
      this.setTeamsButtonState(false, true);
      await window.copilotBridge.teamsStop({ officeId, agentId });
      this.setTeamsButtonState(false);
      return;
    }

    this.setTeamsButtonState(false, true);
    const office = officeManager.getOffice(officeId)?.config;
    const officeChannelUrl = office?.teamsChannelUrl;
    const workingDir = this.activeOptions.workingDir || officeManager.getCurrentWorkingDirectory();
    const res = await window.copilotBridge.teamsRegister({
      officeId,
      agentId,
      displayName: this.activeOptions.name,
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
    if (res?.error === 'no-channel') {
      void this.teamsSettingsOverlay.open('No Teams channel is configured. Add a default channel link to bring agents online.');
      return;
    }
    if (res?.error) showClipboardToast(`Teams: ${res.error}`, 'error');
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

    let history: SessionHistoryEntry[] = [];
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
      // Per-entry rendering: #N + literal-text title + exact copyable id (spec 019, FR-014).
      // Spec 020: rows are clickable to restore/switch to a past session (dual-surface parity, FR-011).
      body.style.whiteSpace = 'normal';
      const onSelect = (entry: SessionHistoryEntry) => { void this.handleRestoreSession(entry); };
      body.appendChild(renderSessionHistoryList(history, { readOnly: false, onSelect }));
    }
    pop.appendChild(body);

    const closeBtn = document.createElement('button');
    closeBtn.textContent = 'Close';
    closeBtn.className = uiButtonClass('default');
    closeBtn.style.marginTop = '10px';
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
    // Interacting with the popover moved focus off the terminal; restore it so
    // the cursor reactivates and keystrokes reach the PTY again. No-op while the
    // view is hidden (guarded inside focusTerminalHardened).
    this.focusTerminalHardened();
  }

  /**
   * Spec 020: restore/switch the current agent to a previously-archived session (FR-003).
   * Byte-for-byte behavioral parity with TerminalOverlay.handleRestoreSession (FR-011):
   * confirmation dialog (harder warning mid-turn, FR-016), single-flight latch (FR-010),
   * error/advisory surfacing, then re-render. Cancel is a strict no-op (FR-004).
   */
  private async handleRestoreSession(entry: SessionHistoryEntry): Promise<void> {
    if (this.restoreInFlight) return;                  // FR-010 latch
    if (!this.activeOptions || !this.activeOfficeId || !this.activeAgentId || !window.copilotBridge) return;

    const officeId = this.activeOfficeId;
    const agentId = this.activeAgentId;
    const options = this.activeOptions;

    const title = (typeof entry.title === 'string' && entry.title.trim()) ? entry.title.trim() : entry.id;
    const midTurn = officeManager.getAgentStatus(officeId, agentId)?.subState === 'thinking';
    const message = midTurn
      ? `This agent is MID-TURN. Switching to session "${title}" will interrupt in-progress work and archive the current session. Continue?`
      : `Switch to session "${title}"? The current session will be archived into history.`;
    if (!confirm(message)) return;                     // FR-004 no-op on cancel

    this.restoreInFlight = true;
    try {
      const res = await window.copilotBridge.restoreSession(officeId, agentId, entry.id);
      if (!res.success) {
        showClipboardToast(`Restore failed: ${res.error || 'unknown error'}`, 'error');  // FR-009
        return;
      }
      if (res.resumeContextUncertain) {
        showClipboardToast('Switched session — context may not be restored', 'info');     // FR-013
      }
      // Spec 021 Phase 5b: the server killed the old PTY and swapped in the restored
      // session. Invalidate the cached xterm for this agent first (detaching its old
      // viewer via onEvict) so the re-open rebuilds a COLD entry and replays the
      // restored session's scrollback — a warm hit would keep showing the archived
      // session's rendered content.
      cacheLog(`invalidate ${officeId}:${agentId} (reason=restore-session)`);
      this.terminalCache?.invalidate(officeId, agentId);
      // Refresh the popover + re-render the terminal to reflect the new current session (FR-003).
      this.closeSessionHistoryPopover();
      await this.openAgentTerminal(options);
    } catch (e) {
      showClipboardToast(`Restore failed: ${(e as Error)?.message || 'bridge threw'}`, 'error');
    } finally {
      this.restoreInFlight = false;
    }
  }

  private copySessionId(): void {
    if (!this.sessionId) return;
    void this.copyToClipboard(this.sessionId, 'session').then((success) => {
      const original = this.sessionIdEl.textContent;
      this.sessionIdEl.textContent = success ? 'Copied!' : 'Copy failed';
      this.sessionIdEl.style.color = success ? '#61d394' : '#ff6b6b';
      setTimeout(() => {
        this.sessionIdEl.textContent = original;
        this.sessionIdEl.style.color = '#8ec3ff';
      }, 900);
    });
  }

  // Spec 006: diagnostic prefix so multi-instance and channel issues
  // are visible in the toast UI without opening DevTools.
  private tag(): string {
    return `[S${this.seriousInstanceId}]`;
  }

  // Spec 005 + 006: single canonical clipboard write path via Electron main.
  // Diagnostic toast on every outcome.
  private async copyToClipboard(text: string, source: 'live' | 'session' = 'live'): Promise<boolean> {
    const t = this.tag();
    if (!text) {
      showClipboardToast(`${t} empty selection`, 'info');
      return false;
    }
    const bridge = window.copilotBridge as Window['copilotBridge'] | undefined;
    if (!bridge?.clipboardWriteText) {
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
    if (!this.activeOfficeId || !this.activeAgentId || !window.copilotBridge) return;
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
    try {
      await window.copilotBridge.terminalWrite(this.activeOfficeId, this.activeAgentId, text);
      showClipboardToast(`Pasted ${text.length} char${text.length === 1 ? '' : 's'}`, 'success');
    } catch (e) {
      showClipboardToast(`Paste failed: ${(e as Error)?.message || 'terminalWrite threw'}`, 'error');
    }
  }

  /**
   * Spec 004: terminal right-click context menu (Copy / Paste). Built once
   * during attachTerminal, reused per right-click. Dismissed on outside
   * mousedown or Escape.
   */
  private installTerminalContextMenu(): void {
    if (!this.terminal || !this.terminalDivEl) return;
    const menu = document.createElement('div');
    menu.id = 'serious-terminal-context-menu';
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
      item.style.cssText = `padding: 6px 14px; cursor: pointer;`;
      item.dataset.enabled = 'true';
      item.addEventListener('mouseenter', () => {
        if (item.dataset.enabled === 'true') item.style.background = '#2a2a45';
      });
      item.addEventListener('mouseleave', () => { item.style.background = ''; });
      item.addEventListener('mousedown', (e) => { e.preventDefault(); e.stopPropagation(); });
      item.addEventListener('click', (e) => {
        e.preventDefault(); e.stopPropagation();
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

    this.terminalDivEl.addEventListener('contextmenu', (event: MouseEvent) => {
      if (!this.visible) return;
      event.preventDefault();
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
    ensureXtermStyles();
  }

  /**
   * Spec 021 Phase 5b: lazily construct the six-entry LRU xterm cache for this
   * surface. The parent is the fixed terminalDivEl; the factory builds per-agent
   * xterms; onEvict detaches the server viewer for the evicted composite key so
   * an evicted background terminal stops receiving output.
   */
  private ensureTerminalCache(): TerminalInstanceCache {
    if (!this.terminalCache) {
      this.terminalDivEl.id = 'serious-terminal-container';
      this.terminalCache = new TerminalInstanceCache({
        parent: this.terminalDivEl,
        createTerminal: (ctx) => this.createCachedTerminal(ctx),
        onEvict: (e) => {
          cacheLog(`evict + detach viewer ${e.officeId}:${e.agentId} (sessionId=${e.sessionId ?? 'none'})`);
          if (typeof window !== 'undefined' && window.copilotBridge) {
            window.copilotBridge.terminalDetach(e.officeId, e.agentId).catch(() => {});
          }
        },
      });
    }
    return this.terminalCache;
  }

  /**
   * Cache factory (spec 021 Phase 5b). Builds ONE retained xterm per agent into
   * the cache-owned hidden host `ctx.host`, wiring the per-entry handlers (mouse
   * suppression, wheel paging, Ctrl+C/V/F, and the input binding). The wheel and
   * input bindings are bound to THIS entry's office+agent so a cached background
   * terminal can never send keystrokes/paging to the wrong agent. Surface-global
   * handlers (context menu, resize) are installed once via installSurfaceHandlers.
   */
  private createCachedTerminal(ctx: TerminalCacheFactoryContext): CreatedTerminal {
    const terminal = new Terminal({
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
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.open(ctx.host);

    // Suppress SGR/any-event mouse tracking from the PTY (same as TerminalOverlay).
    const MOUSE_MODES = new Set([1000, 1002, 1003, 1006]);
    terminal.parser.registerCsiHandler({ prefix: '?', final: 'h' }, (params) => {
      for (const p of params) {
        if (typeof p === 'number' && MOUSE_MODES.has(p)) return true;
      }
      return false;
    });

    // Mouse-wheel scroll fix (mirrors TerminalOverlay; Constitution VI rule 4).
    // In the alternate screen buffer (Copilot CLI TUI, no scrollback) xterm emits
    // bare arrow keys on wheel — which the CLI ignores. Forward PageUp/PageDown to
    // the PTY instead; in the normal buffer let xterm scroll natively. Bound to
    // this entry's office+agent so only the visible terminal pages its own session.
    terminal.attachCustomWheelEventHandler((event: WheelEvent) => {
      if (terminal.buffer.active.type !== 'alternate') return true;
      const seq = this.wheelPager.feed(event);
      if (!seq) return false; // movement accumulated but not enough for a page yet
      if (window.copilotBridge) {
        void window.copilotBridge.terminalWrite(ctx.officeId, ctx.agentId, seq);
      }
      return false;
    });

    terminal.attachCustomKeyEventHandler((event: KeyboardEvent) => {
      const isModifierPressed = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (event.type !== 'keydown' || !isModifierPressed) return true;

      if (key === 'c') {
        const selection = this.getSelectionForCopy();
        if (!selection) {
          return true;
        }
        event.preventDefault();
        event.stopPropagation();
        void this.copyToClipboard(selection, 'live');
        return false;
      }

      if (key === 'v') {
        event.preventDefault();
        event.stopPropagation();
        void this.pasteFromClipboardToTerminal();
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

    // Spec 003 V13/V14, C9: input binding bound to THIS entry's office+agent for
    // its whole lifetime, so keystrokes always reach the correct session even from
    // a cached background terminal. Replaces the old per-open onData rebind.
    const onDataResult = terminal.onData((data: string) => {
      if (!window.copilotBridge) return;
      void window.copilotBridge.terminalWrite(ctx.officeId, ctx.agentId, data);
    });
    const inputBinding =
      onDataResult && typeof (onDataResult as { dispose?: () => void }).dispose === 'function'
        ? (onDataResult as { dispose: () => void })
        : null;

    return { terminal, fitAddon, inputBinding };
  }

  /**
   * Install surface-global handlers exactly once: the right-click context menu
   * (spec 004) bound to the parent terminalDivEl, plus the window/ResizeObserver
   * refit hooks. These read the currently-visible terminal via `this.terminal`, so
   * they work uniformly across every cached entry.
   */
  private installSurfaceHandlers(): void {
    if (this.surfaceHandlersInstalled) return;
    this.surfaceHandlersInstalled = true;

    // Spec 004: terminal right-click → context menu (Copy / Paste). Bound to the
    // parent terminalDivEl so it fires for whichever cached host is visible.
    this.installTerminalContextMenu();

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
    this.focusTerminalHardened();
    this.debouncedRefit(this.activeOfficeId, this.activeAgentId);
  }

  private toggleFullWidth(): void {
    this.isFullWidth = !this.isFullWidth;
    localStorage.setItem(SeriousTerminalController.FULL_WIDTH_STORAGE_KEY, String(this.isFullWidth));
    this.fullscreenBtn.textContent = this.isFullWidth ? 'Half Width' : 'Full Width';
    this.applyPanelLayout();
    // Return focus to the terminal so the toggle button doesn't keep keyboard focus.
    this.focusTerminalHardened();
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

  /**
   * Give keyboard focus to the xterm hidden textarea, with a short verify+retry.
   *
   * Serious mode tears down Phaser (no InputManager), so this controller is the
   * sole owner of terminal focus. Clicking a sprite-card button or a history row
   * (role="button") moves DOM focus off the xterm textarea; a single focus() can
   * lose the race against the browser's post-click focus settling. Without this
   * re-assert the cursor renders hollow and keystrokes — Space in particular,
   * which a focused button/row swallows as an activation key — never reach the
   * PTY. Mirrors InputManager.focusTerminalXterm's retry (game mode gets this via
   * InputManager; serious mode needs it inline).
   */
  private focusTerminalHardened(): void {
    const term = this.terminal;
    if (!term || !this.visible) return;
    try { term.focus(); } catch { /* terminal may be mid-teardown */ }
    const verify = (attempt: number, delay: number): void => {
      const timer = setTimeout(() => {
        if (!this.visible) return;
        const textarea = (term as unknown as { textarea?: HTMLTextAreaElement }).textarea;
        if (textarea && document.activeElement !== textarea) {
          try { term.focus(); } catch { /* ignore */ }
          if (attempt < 3) verify(attempt + 1, delay * 2);
        }
      }, delay);
      this.focusRetryTimers.push(timer);
    };
    verify(1, 50);
  }

  private clearFocusRetryTimers(): void {
    for (const timer of this.focusRetryTimers) clearTimeout(timer);
    this.focusRetryTimers.length = 0;
  }

  private formatElapsed(startTime: number): string {
    const seconds = Math.floor((Date.now() - startTime) / 1000);
    if (seconds < 60) return `${seconds}s`;
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${mins}m ${secs}s`;
  }
}
