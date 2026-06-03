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

  it('handles Ctrl+V once by suppressing default paste path', async () => {
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-paste' }),
    });

    const readText = vi.fn().mockResolvedValue('hello');
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { readText },
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

    await Promise.resolve();

    expect(result).toBe(false);
    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(stopPropagation).toHaveBeenCalledTimes(1);
    expect(readText).toHaveBeenCalledTimes(1);
    expect(terminal.paste).toHaveBeenCalledTimes(1);
    expect(terminal.paste).toHaveBeenCalledWith('hello');
  });

  it('uses native copy path for selection and keeps Ctrl+C pass-through without selection', async () => {
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-copy' }),
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

    terminal.hasSelection.mockReturnValue(true);
    terminal.getSelection.mockReturnValue('selected text');

    const preventDefaultWithSelection = vi.fn();
    const stopPropagationWithSelection = vi.fn();
    const copyWithSelection = keyHandler?.({
      ctrlKey: true,
      metaKey: false,
      key: 'c',
      type: 'keydown',
      preventDefault: preventDefaultWithSelection,
      stopPropagation: stopPropagationWithSelection,
    } as unknown as KeyboardEvent);

    expect(copyWithSelection).toBe(true);
    expect(preventDefaultWithSelection).not.toHaveBeenCalled();
    expect(stopPropagationWithSelection).not.toHaveBeenCalled();

    const setData = vi.fn();
    const copyEvent = new Event('copy', { bubbles: true, cancelable: true }) as ClipboardEvent;
    Object.defineProperty(copyEvent, 'clipboardData', {
      configurable: true,
      value: { setData },
    });
    ((overlay as any).terminalDiv as HTMLDivElement).dispatchEvent(copyEvent);

    expect(setData).toHaveBeenCalledWith('text/plain', 'selected text');
    expect(copyEvent.defaultPrevented).toBe(true);

    terminal.hasSelection.mockReturnValue(false);
    const preventDefaultNoSelection = vi.fn();
    const stopPropagationNoSelection = vi.fn();
    const copyWithoutSelection = keyHandler?.({
      ctrlKey: true,
      metaKey: false,
      key: 'c',
      type: 'keydown',
      preventDefault: preventDefaultNoSelection,
      stopPropagation: stopPropagationNoSelection,
    } as unknown as KeyboardEvent);

    expect(copyWithoutSelection).toBe(true);
    expect(preventDefaultNoSelection).not.toHaveBeenCalled();
    expect(stopPropagationNoSelection).not.toHaveBeenCalled();

    const terminalDiv = (overlay as any).terminalDiv as HTMLDivElement;
    const removeListenerSpy = vi.spyOn(terminalDiv, 'removeEventListener');
    overlay.hide();
    expect(removeListenerSpy).toHaveBeenCalledWith('copy', expect.any(Function));
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
