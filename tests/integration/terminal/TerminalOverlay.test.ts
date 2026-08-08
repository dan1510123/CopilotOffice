import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AgentConfig } from '../../../src/config/agents';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';
import { MockFitAddon, MockTerminal } from '../../setup/xterm-mock';

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));

import { TerminalOverlay } from '../../../src/ui/TerminalOverlay';

function createAgent(overrides: Partial<AgentConfig> = {}): AgentConfig {
  return {
    id: 'generalist',
    name: 'Gene',
    skill: 'general',
    sprite: 'npc_generalist',
    color: 0x4488cc,
    position: { x: 4, y: 3 },
    greeting: 'hello',
    description: 'Generalist',
    workingDir: '.',
    ...overrides,
  };
}

function createSceneStub() {
  const canvas = document.createElement('canvas');
  const focusSpy = vi.fn();
  canvas.focus = focusSpy as unknown as () => void;

  return {
    game: {
      events: { emit: vi.fn(), on: vi.fn(), once: vi.fn() },
      canvas,
    },
    textures: {
      get: vi.fn(() => ({
        key: 'npc_generalist',
        getSourceImage: () => document.createElement('canvas'),
      })),
    },
  };
}

describe('integration/TerminalOverlay', () => {
  let overlay: TerminalOverlay | null = null;

  beforeEach(() => {
    document.body.innerHTML = `
      <div id="game-container">
        <div id="office-panel"></div>
        <div id="terminal-panel"></div>
      </div>
    `;
    localStorage.clear();
  });

  afterEach(() => {
    overlay?.destroy();
    overlay = null;
  });

  it('shows terminal, starts session, and keeps server session id authoritative', async () => {
    let terminalDataCb: ((agentId: string, data: string) => void) | undefined;
    const bridge = installMockCopilotBridge({
      onTerminalData: vi.fn((cb) => {
        terminalDataCb = cb;
      }),
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-123' }),
      getSessionMeta: vi.fn().mockResolvedValue({ title: 'Plan Session' }),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), vi.fn());

    expect(bridge.terminalExists).toHaveBeenCalledWith('office-0', 'generalist');
    expect(bridge.terminalStart).toHaveBeenCalledWith(
      'office-0',
      'generalist',
      '.',
      80,
      24
    );
    expect(inputManager.activateTerminalF10).toHaveBeenCalled();
    expect(inputManager.switchToTerminal).toHaveBeenCalled();
    expect(overlay.getIsVisible()).toBe(true);
    expect(document.getElementById('terminal-overlay')?.innerHTML).toContain('Plan Session');

    const sessionDisplay = document.querySelector('.session-id-display') as HTMLElement;
    expect(sessionDisplay.textContent).toBe('sess-123');

    terminalDataCb?.('generalist', 'session id 11111111-1111-1111-1111-111111111111');
    expect(sessionDisplay.textContent).toBe('sess-123');
  });

  it('spec 021 Phase 5: routes background output to a hidden cached terminal and drops stale generations', async () => {
    let terminalDataCb:
      | ((agentId: string, data: string, officeId?: string, sessionId?: string) => void)
      | undefined;
    installMockCopilotBridge({
      onTerminalData: vi.fn((cb) => { terminalDataCb = cb; }),
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-A' }),
      terminalActivate: vi.fn().mockResolvedValue({
        success: true, existed: false, sessionId: 'sess-A', title: null, scrollback: '',
      }),
      getSessionMeta: vi.fn().mockResolvedValue(null),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');

    // Show Gene, then switch to Dan — Gene's terminal is now cached but hidden.
    await overlay.show(createAgent({ id: 'generalist', name: 'Gene' }), vi.fn());
    const cache = (overlay as any).terminalCache;
    const geneTerminal = cache.peek('office-0', 'generalist').terminal as MockTerminal;
    // Bind Gene's cache generation so the drop guard is exercised.
    cache.setSessionId('office-0', 'generalist', 'sess-A');

    await overlay.show(createAgent({ id: 'debugger', name: 'Dan', sprite: 'npc_debugger', position: { x: 13, y: 3 } }), vi.fn());
    const danTerminal = (overlay as any).terminal as MockTerminal;
    expect(danTerminal).not.toBe(geneTerminal);

    geneTerminal.write.mockClear();
    danTerminal.write.mockClear();

    // Background output for the hidden Gene routes to Gene's cached terminal only.
    terminalDataCb?.('generalist', 'bg-gene', 'office-0', 'sess-A');
    expect(geneTerminal.write).toHaveBeenCalledWith('bg-gene');
    expect(danTerminal.write).not.toHaveBeenCalledWith('bg-gene');

    // Output for Gene tagged with a SUPERSEDED session generation is dropped.
    geneTerminal.write.mockClear();
    terminalDataCb?.('generalist', 'stale', 'office-0', 'sess-OLD');
    expect(geneTerminal.write).not.toHaveBeenCalledWith('stale');
  });

  it('reattachListeners is idempotent — never accumulates duplicate terminal-data listeners', () => {
    // Simulate the real preload contract: additive registration that returns a
    // disposer removing ONLY that registration. Duplicate live listeners are what
    // cause every PTY byte (incl. typed echo) to be written to xterm twice.
    const liveDataCbs: Array<(agentId: string, data: string) => void> = [];
    installMockCopilotBridge({
      onTerminalData: vi.fn((cb: (agentId: string, data: string) => void) => {
        liveDataCbs.push(cb);
        return () => {
          const i = liveDataCbs.indexOf(cb);
          if (i >= 0) liveDataCbs.splice(i, 1);
        };
      }),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    // Constructor registers exactly one terminal-data listener.
    expect(liveDataCbs.length).toBe(1);

    // Returning from a meeting re-attaches; without idempotency this would grow
    // to 4 and every byte would be written to xterm 4×.
    overlay.reattachListeners();
    overlay.reattachListeners();
    overlay.reattachListeners();
    expect(liveDataCbs.length).toBe(1);

    // Destroy disposes this overlay's own listener (no global nuke).
    overlay.destroy();
    overlay = null;
    expect(liveDataCbs.length).toBe(0);
  });

  it('hides without detaching (retain-while-cached), and detaches on destroy', async () => {
    const onClose = vi.fn();
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-1' }),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), onClose);
    overlay.hide();

    // Spec 021 Phase 5 (retain-while-cached): hiding keeps the cached entry's
    // server viewer attached so background output keeps rendering — no detach.
    expect(bridge.terminalDetach).not.toHaveBeenCalled();
    expect(inputManager.deactivateTerminalF10).toHaveBeenCalled();
    expect(inputManager.switchToGame).toHaveBeenCalled();
    expect(inputManager.blurTerminalXterm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(overlay.getIsVisible()).toBe(false);

    // Destroying the surface disposes every cached entry and detaches its viewer.
    overlay.destroy();
    overlay = null;
    expect(bridge.terminalDetach).toHaveBeenCalledWith('office-0', 'generalist');
  });

  it('persists fullscreen preference and updates panel layout', async () => {
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-2' }),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), vi.fn());

    const fullscreenBtn = Array.from(document.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Fullscreen')
    ) as HTMLButtonElement | undefined;
    expect(fullscreenBtn).toBeTruthy();
    fullscreenBtn?.click();

    expect(localStorage.getItem('agencyOffice:terminalFullWidth')).toBe('true');
    expect((document.getElementById('office-panel') as HTMLElement).style.display).toBe('none');
    expect((document.getElementById('terminal-panel') as HTMLElement).style.width).toBe('100%');
  });

  it('fits and resizes before activating an existing session', async () => {
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(true),
      terminalActivate: vi.fn().mockResolvedValue({
        success: true, existed: true, sessionId: 'sess-existing', title: null, scrollback: '',
      }),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), vi.fn());

    // Spec 021 Phase 5: an existing server session on a cold cache entry is
    // brought up with a single atomic activation (foreground + one-time
    // scrollback), not the legacy attach + getSessionId pair.
    expect(bridge.terminalActivate).toHaveBeenCalledWith(
      'office-0', 'generalist',
      expect.objectContaining({ foreground: true, needScrollback: true }),
    );
    expect(bridge.terminalResize).toHaveBeenCalled();

    const resizeOrder = (bridge.terminalResize as any).mock.invocationCallOrder[0] as number | undefined;
    const activateOrder = (bridge.terminalActivate as any).mock.invocationCallOrder[0] as number | undefined;
    expect(resizeOrder).toBeDefined();
    expect(activateOrder).toBeDefined();
    expect((resizeOrder as number) < (activateOrder as number)).toBe(true);
  });

  it('Ctrl+V: spec 004 — reads clipboard via bridge and forwards text to PTY via terminalWrite', async () => {
    const terminalWriteSpy = vi.fn().mockResolvedValue({ success: true });
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-paste' }),
      terminalWrite: terminalWriteSpy,
      clipboardReadText: vi.fn().mockResolvedValue({ success: true, text: 'hello' }),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), vi.fn());

    const terminal = (overlay as any).terminal as MockTerminal;
    const keyHandler = terminal.attachCustomKeyEventHandler.mock.calls[0]?.[0] as
      | ((e: KeyboardEvent) => boolean)
      | undefined;
    expect(keyHandler).toBeTypeOf('function');

    const preventDefault = vi.fn();
    const stopPropagation = vi.fn();
    const result = keyHandler?.({
      ctrlKey: true,
      metaKey: false,
      key: 'v',
      type: 'keydown',
      preventDefault,
      stopPropagation,
    } as unknown as KeyboardEvent);

    expect(result).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);

    // Allow the pasteFromClipboardToTerminal microtask chain to settle.
    await new Promise((r) => setTimeout(r, 0));
    expect(terminalWriteSpy).toHaveBeenCalledWith('office-0', expect.any(String), 'hello');
  });

  it('Ctrl+C (spec 004): non-empty selection writes to clipboard via bridge; empty selection passes through', async () => {
    const clipboardWrite = vi.fn().mockResolvedValue({ success: true });
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-copy' }),
      clipboardWriteText: clipboardWrite,
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), vi.fn());

    const terminal = (overlay as any).terminal as MockTerminal;
    const keyHandler = terminal.attachCustomKeyEventHandler.mock.calls[0]?.[0] as
      | ((e: KeyboardEvent) => boolean)
      | undefined;
    expect(keyHandler).toBeTypeOf('function');

    // ── With selection: bridge writes, key event suppressed ──
    terminal.hasSelection.mockReturnValue(true);
    terminal.getSelection.mockReturnValue('selected text');

    const pdWith = vi.fn();
    const spWith = vi.fn();
    const r1 = keyHandler?.({
      ctrlKey: true, metaKey: false, key: 'c', type: 'keydown',
      preventDefault: pdWith, stopPropagation: spWith,
    } as unknown as KeyboardEvent);

    expect(r1).toBe(false);
    expect(pdWith).toHaveBeenCalledTimes(1);
    expect(spWith).toHaveBeenCalledTimes(1);
    await new Promise((r) => setTimeout(r, 0));
    expect(clipboardWrite).toHaveBeenCalledWith('selected text');

    // ── Without selection: pass through, do not preventDefault ──
    terminal.hasSelection.mockReturnValue(false);
    terminal.getSelection.mockReturnValue('');
    const pdNo = vi.fn();
    const spNo = vi.fn();
    const r2 = keyHandler?.({
      ctrlKey: true, metaKey: false, key: 'c', type: 'keydown',
      preventDefault: pdNo, stopPropagation: spNo,
    } as unknown as KeyboardEvent);

    expect(r2).toBe(true);
    expect(pdNo).not.toHaveBeenCalled();
    expect(spNo).not.toHaveBeenCalled();
  });

  it('spec 005 Bug A: verify-mismatch from bridge shows failure toast, not success', async () => {
    const clipboardWrite = vi.fn().mockResolvedValue({
      success: false, verified: false, error: 'clipboard verification failed',
    });
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-vmis' }),
      clipboardWriteText: clipboardWrite,
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(), deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(), switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(), blurTerminalXterm: vi.fn(),
    };
    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), vi.fn());

    const terminal = (overlay as any).terminal as MockTerminal;
    terminal.hasSelection.mockReturnValue(true);
    terminal.getSelection.mockReturnValue('payload');
    const keyHandler = terminal.attachCustomKeyEventHandler.mock.calls[0]?.[0] as
      | ((e: KeyboardEvent) => boolean) | undefined;
    keyHandler?.({
      ctrlKey: true, metaKey: false, key: 'c', type: 'keydown',
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    await new Promise((r) => setTimeout(r, 0));
    expect(clipboardWrite).toHaveBeenCalledWith('payload');
    const toast = document.getElementById('copilot-office-clipboard-toast');
    expect(toast).toBeTruthy();
    expect(toast?.textContent || '').toMatch(/verify-fail/i);
    expect(toast?.textContent || '').toMatch(/wrote=7/);
  });

  it('spec 006: Ctrl+C uses hasSelection/getSelection directly', async () => {
    const clipboardWrite = vi.fn().mockResolvedValue({ success: true, verified: true });
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-modeA' }),
      clipboardWriteText: clipboardWrite,
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(), deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(), switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(), blurTerminalXterm: vi.fn(),
    };
    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), vi.fn());

    const terminal = (overlay as any).terminal as MockTerminal;
    terminal.hasSelection.mockReturnValue(true);
    terminal.getSelection.mockReturnValue('live-only text');

    const keyHandler = terminal.attachCustomKeyEventHandler.mock.calls[0]?.[0] as
      | ((e: KeyboardEvent) => boolean) | undefined;
    const result = keyHandler?.({
      ctrlKey: true, metaKey: false, key: 'c', type: 'keydown',
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    expect(result).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(clipboardWrite).toHaveBeenCalledWith('live-only text');
    const toast = document.getElementById('copilot-office-clipboard-toast');
    expect(toast?.textContent || '').toMatch(/verified/i);
  });

  it('runs a geometry self-heal when Refresh Focus is clicked', async () => {
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-focus' }),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), vi.fn());

    const terminal = (overlay as any).terminal as MockTerminal;
    const resizeCallsBefore = (bridge.terminalResize as any).mock.calls.length as number;
    const refreshCallsBefore = terminal.refresh.mock.calls.length;
    const switchCallsBefore = inputManager.switchToTerminal.mock.calls.length;

    const refreshBtn = Array.from(document.querySelectorAll('button')).find(
      (btn) => btn.textContent?.includes('Refresh Focus')
    ) as HTMLButtonElement | undefined;
    expect(refreshBtn).toBeTruthy();
    refreshBtn?.click();

    expect(terminal.refresh.mock.calls.length).toBeGreaterThan(refreshCallsBefore);
    expect((bridge.terminalResize as any).mock.calls.length).toBeGreaterThan(resizeCallsBefore);
    expect(inputManager.switchToTerminal.mock.calls.length).toBeGreaterThan(switchCallsBefore);
  });

  it('spec 007: intercepts /new and calls bridge.resetSession (no /session PTY parse)', async () => {
    let onSessionMetaUpdatedCb: ((agentId: string, meta: { title: string }) => void) | undefined;
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-initial' }),
      getSessionMeta: vi.fn().mockResolvedValue({ title: 'Old title' }),
      resetSession: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-after-new' }),
      onSessionMetaUpdated: vi.fn((cb) => {
        onSessionMetaUpdatedCb = cb;
      }),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), vi.fn());

    const terminal = (overlay as any).terminal as MockTerminal;
    const onData = terminal.onData.mock.calls[0]?.[0] as ((data: string) => void) | undefined;
    expect(onData).toBeTypeOf('function');

    onData?.('/new');
    onData?.('\r');
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 10));

    // Spec 007: server-authoritative reset, no /session PTY round-trip.
    expect(bridge.resetSession).toHaveBeenCalledWith('office-0', 'generalist');
    expect(bridge.terminalStart).toHaveBeenCalledTimes(1);
    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'generalist', '/new');
    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'generalist', '\r');
    // The greedy /session parser is gone — no /session\r write, no setSessionId IPC.
    expect(bridge.terminalWrite).not.toHaveBeenCalledWith('office-0', 'generalist', '/session\r');
    expect(bridge.setSessionId).not.toHaveBeenCalled();

    const sessionDisplay = document.querySelector('.session-id-display') as HTMLElement;
    expect(sessionDisplay.textContent).toBe('sess-after-new');

    const titleDisplay = document.querySelector('.session-title-display') as HTMLElement;
    expect(titleDisplay.textContent).toBe('Old title');
    onSessionMetaUpdatedCb?.('generalist', { title: 'New title from first message' });
    expect(titleDisplay.textContent).toBe('New title from first message');
  });

  it('US1 V6: routes keystrokes to the freshly-bound agent after show() switches', async () => {
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-X' }),
      terminalDetach: vi.fn().mockResolvedValue({ success: true }),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      switchToNone: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');

    const geneAgent = createAgent({ id: 'generalist', name: 'Gene' });
    const danAgent = createAgent({ id: 'debugger', name: 'Dan' });

    await overlay.show(geneAgent, vi.fn());

    // Spec 021 Phase 5: each agent owns its own cached xterm with its own,
    // permanently-bound onData handler. Capture Gene's terminal + handler.
    const geneTerminal = (overlay as any).terminal as MockTerminal;
    const onDataGene = geneTerminal.onData.mock.calls.at(-1)?.[0] as ((d: string) => void) | undefined;
    expect(onDataGene).toBeTypeOf('function');
    onDataGene?.('g');
    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'generalist', 'g');

    await overlay.show(danAgent, vi.fn());

    // The visible terminal is now Dan's — a DIFFERENT xterm instance with its own
    // onData handler bound to agentId=debugger.
    const danTerminal = (overlay as any).terminal as MockTerminal;
    expect(danTerminal).not.toBe(geneTerminal);
    const onDataDan = danTerminal.onData.mock.calls.at(-1)?.[0] as ((d: string) => void) | undefined;
    expect(onDataDan).toBeTypeOf('function');
    expect(onDataDan).not.toBe(onDataGene);

    // Spec 021 Phase 5 (retain-while-cached): switching does NOT detach the
    // previous agent — its cached terminal stays live in the background.
    expect(bridge.terminalDetach).not.toHaveBeenCalled();

    onDataDan?.('d');
    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'debugger', 'd');
    // V6: input addressed to the new agent must NEVER be routed to the previous one.
    expect(bridge.terminalWrite).not.toHaveBeenCalledWith('office-0', 'generalist', 'd');

    // And Gene's still-bound handler continues to address generalist (never dan).
    onDataGene?.('x');
    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'generalist', 'x');
    expect(bridge.terminalWrite).not.toHaveBeenCalledWith('office-0', 'debugger', 'x');
  });

  it('supports inline session title editing from the sprite card', async () => {
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-title' }),
      getSessionMeta: vi.fn().mockResolvedValue({ title: 'Initial title' }),
      setSessionMeta: vi.fn().mockResolvedValue({ success: true }),
    });

    const scene = createSceneStub();
    const inputManager = {
      activateTerminalF10: vi.fn(),
      deactivateTerminalF10: vi.fn(),
      switchToTerminal: vi.fn(),
      switchToGame: vi.fn(),
      focusTerminalXterm: vi.fn(),
      blurTerminalXterm: vi.fn(),
    };

    overlay = new TerminalOverlay(scene as any, inputManager as any, () => 'office-0');
    await overlay.show(createAgent(), vi.fn());

    const titleDisplay = document.querySelector('.session-title-display') as HTMLElement;
    expect(titleDisplay.textContent).toBe('Initial title');
    titleDisplay.click();

    const titleInput = document.querySelector('.session-title-input') as HTMLInputElement;
    expect(titleInput).toBeTruthy();
    titleInput.value = 'Renamed from sprite card';
    titleInput.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter' }));
    await Promise.resolve();
    await Promise.resolve();

    expect(bridge.setSessionMeta).toHaveBeenCalledWith('office-0', 'generalist', {
      title: 'Renamed from sprite card',
    });
    expect((document.querySelector('.session-title-display') as HTMLElement).textContent).toBe('Renamed from sprite card');
  });
});
