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

  it('hides terminal, detaches session, and restores game focus path', async () => {
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

    expect(bridge.terminalDetach).toHaveBeenCalledWith('office-0', 'generalist');
    expect(inputManager.deactivateTerminalF10).toHaveBeenCalled();
    expect(inputManager.switchToGame).toHaveBeenCalled();
    expect(inputManager.blurTerminalXterm).toHaveBeenCalled();
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(overlay.getIsVisible()).toBe(false);
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

  it('fits and resizes before attaching an existing session', async () => {
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(true),
      terminalAttach: vi.fn().mockResolvedValue({ success: true, scrollback: '' }),
      getSessionId: vi.fn().mockResolvedValue('sess-existing'),
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

    expect(bridge.terminalAttach).toHaveBeenCalledWith('office-0', 'generalist');
    expect(bridge.terminalResize).toHaveBeenCalled();

    const resizeOrder = (bridge.terminalResize as any).mock.invocationCallOrder[0] as number | undefined;
    const attachOrder = (bridge.terminalAttach as any).mock.invocationCallOrder[0] as number | undefined;
    expect(resizeOrder).toBeDefined();
    expect(attachOrder).toBeDefined();
    expect((resizeOrder as number) < (attachOrder as number)).toBe(true);
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
    terminal.fireSelectionChange('selected text');

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
    terminal.fireSelectionChange('');
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

  it('spec 005 Bug B: Ctrl+C uses cached selection from onSelectionChange even after hasSelection() returns false (race)', async () => {
    // Simulates the race that broke spec 004: onSelectionChange fires with
    // text, then xterm clears its internal state before the Ctrl+C handler
    // reads it. The cached value must still be used.
    const clipboardWrite = vi.fn().mockResolvedValue({ success: true, verified: true });
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-race' }),
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
    // 1. Selection happens — cache fills.
    terminal.fireSelectionChange('race-text');
    // 2. Race: xterm's live selection is cleared before our key handler reads.
    terminal.hasSelection.mockReturnValue(false);
    terminal.getSelection.mockReturnValue('');

    const keyHandler = terminal.attachCustomKeyEventHandler.mock.calls[0]?.[0] as
      | ((e: KeyboardEvent) => boolean) | undefined;
    const result = keyHandler?.({
      ctrlKey: true, metaKey: false, key: 'c', type: 'keydown',
      preventDefault: vi.fn(), stopPropagation: vi.fn(),
    } as unknown as KeyboardEvent);

    expect(result).toBe(false);
    await new Promise((r) => setTimeout(r, 0));
    expect(clipboardWrite).toHaveBeenCalledWith('race-text');
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
    terminal.fireSelectionChange('payload');
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
    expect(toast?.textContent || '').toMatch(/failed/i);
    expect(toast?.textContent || '').toMatch(/verification/i);
  });

  it('spec 005: cached selection is cleared on terminal.clear() during agent switch', async () => {
    const clipboardWrite = vi.fn().mockResolvedValue({ success: true, verified: true });
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-clr' }),
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
    terminal.fireSelectionChange('stale text from previous agent');
    expect((overlay as any).cachedSelection).toBe('stale text from previous agent');

    // Switch to a different agent — triggers terminal.reset/clear path which
    // also resets cachedSelection.
    await overlay.show(createAgent({ id: 'debugger', name: 'Dan', sprite: 'npc_debugger' }), vi.fn());
    expect((overlay as any).cachedSelection).toBe('');
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

  it('intercepts /new and starts a tracked new session', async () => {
    let terminalDataCb: ((agentId: string, data: string) => void) | undefined;
    let onSessionMetaUpdatedCb: ((agentId: string, meta: { title: string }) => void) | undefined;
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-initial' }),
      getSessionMeta: vi.fn().mockResolvedValue({ title: 'Old title' }),
      onTerminalData: vi.fn((cb) => {
        terminalDataCb = cb;
      }),
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
    await new Promise((resolve) => setTimeout(resolve, 450));
    terminalDataCb?.('generalist', 'Session ID: aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');
    await Promise.resolve();

    expect(bridge.resetSession).not.toHaveBeenCalled();
    expect(bridge.terminalStart).toHaveBeenCalledTimes(1);
    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'generalist', '/new');
    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'generalist', '\r');
    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'generalist', '/session\r');
    expect(bridge.setSessionId).toHaveBeenCalledWith(
      'office-0',
      'generalist',
      'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'
    );

    const sessionDisplay = document.querySelector('.session-id-display') as HTMLElement;
    expect(sessionDisplay.textContent).toBe('aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa');

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

    const terminal = (overlay as any).terminal as MockTerminal;
    const onDataGene = terminal.onData.mock.calls.at(-1)?.[0] as ((d: string) => void) | undefined;
    expect(onDataGene).toBeTypeOf('function');
    onDataGene?.('g');

    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'generalist', 'g');

    await overlay.show(danAgent, vi.fn());

    // After switch the previous onData closure should be disposed AND a fresh
    // closure registered with bound agentId=debugger.
    const onDataDan = terminal.onData.mock.calls.at(-1)?.[0] as ((d: string) => void) | undefined;
    expect(onDataDan).toBeTypeOf('function');
    expect(onDataDan).not.toBe(onDataGene);

    // Detach was awaited for the previous agent.
    expect(bridge.terminalDetach).toHaveBeenCalledWith('office-0', 'generalist');

    onDataDan?.('d');

    expect(bridge.terminalWrite).toHaveBeenCalledWith('office-0', 'debugger', 'd');
    // V6: input addressed to the new agent must NEVER be routed to the previous one.
    expect(bridge.terminalWrite).not.toHaveBeenCalledWith('office-0', 'generalist', 'd');
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
