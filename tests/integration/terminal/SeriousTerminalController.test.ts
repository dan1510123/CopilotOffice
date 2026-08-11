import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';
import { MockFitAddon, MockTerminal } from '../../setup/xterm-mock';

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));

import { SeriousTerminalController } from '../../../src/ui/SeriousTerminalController';

describe('integration/SeriousTerminalController', () => {
  let controller: SeriousTerminalController | null = null;
  let canvasContextSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    canvasContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      fillStyle: '',
      imageSmoothingEnabled: false,
    }) as unknown as CanvasRenderingContext2D);

    document.body.innerHTML = `
      <div id="game-container" data-app-mode="serious">
        <div id="office-panel"></div>
        <div id="terminal-panel"></div>
      </div>
    `;
    localStorage.clear();
  });

  afterEach(async () => {
    if (controller) {
      await controller.closeView({ detach: true, silent: true });
    }
    canvasContextSpy?.mockRestore();
    canvasContextSpy = null;
    controller = null;
  });

  it('US3 C5: Ctrl+C with non-empty selection writes to clipboard and suppresses SIGINT', async () => {
    const writeText = vi.fn().mockResolvedValue({ success: true, verified: true });
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-serious' }),
      terminalAttach: vi.fn().mockResolvedValue({ success: true, scrollback: '' }),
      getSessionId: vi.fn().mockResolvedValue('sess-serious'),
      getSessionMeta: vi.fn().mockResolvedValue({ title: 'Session Title' }),
      clipboardWriteText: writeText,
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    controller = new SeriousTerminalController(host);

    await controller.openAgentTerminal({
      officeId: 'office-0',
      agentId: 'generalist',
      name: 'Gene',
      description: 'General assistant',
      workingDir: '.',
      launchMode: 'copilot',
    });

    const terminal = (controller as any).terminal as MockTerminal;
    const keyHandler = terminal.attachCustomKeyEventHandler.mock.calls[0]?.[0] as
      | ((e: KeyboardEvent) => boolean)
      | undefined;
    expect(keyHandler).toBeTypeOf('function');

    terminal.hasSelection.mockReturnValue(true);
    terminal.getSelection.mockReturnValue('serious selected text');

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

    expect(copyWithSelection).toBe(false);
    expect(preventDefaultWithSelection).toHaveBeenCalledTimes(1);
    expect(stopPropagationWithSelection).toHaveBeenCalledTimes(1);
    await Promise.resolve();
    await Promise.resolve();
    expect(writeText).toHaveBeenCalledWith('serious selected text');

    terminal.hasSelection.mockReturnValue(false);
    terminal.getSelection.mockReturnValue('');
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
  });

  it('spec 004: context menu element is created during openAgentTerminal', async () => {
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-serious-2' }),
      terminalAttach: vi.fn().mockResolvedValue({ success: true, scrollback: '' }),
      getSessionId: vi.fn().mockResolvedValue('sess-serious-2'),
      getSessionMeta: vi.fn().mockResolvedValue({ title: '' }),
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    controller = new SeriousTerminalController(host);

    await controller.openAgentTerminal({
      officeId: 'office-0',
      agentId: 'generalist',
      name: 'Gene',
      description: 'General assistant',
      workingDir: '.',
      launchMode: 'copilot',
    });

    // Spec 004: the right-click context menu element is appended to the
    // document body once the terminal is attached.
    const menu = document.getElementById('serious-terminal-context-menu');
    expect(menu, 'context menu should be installed after openAgentTerminal').toBeTruthy();
    expect((controller as any).terminalContextMenu).toBe(menu);
  });

  it('spec 021 Phase 1: cold-exists switch activates once (no attach/getSessionId) and records switch perf spans', async () => {
    const { countTerminalPerfEntries, resetTerminalPerf, setTerminalPerfEnabled } = await import(
      '../../../src/ui/terminalPerf'
    );
    resetTerminalPerf();
    setTerminalPerfEnabled(true);

    const existsFor = new Set<string>();
    const bridge = installMockCopilotBridge({
      terminalExists: vi.fn((_office: string, agentId: string) => Promise.resolve(existsFor.has(agentId))),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-A' }),
      terminalActivate: vi.fn().mockResolvedValue({ success: true, existed: true, sessionId: 'sess-B', title: 'T', scrollback: 'abc' }),
      terminalAttach: vi.fn().mockResolvedValue({ success: true, scrollback: 'abc' }),
      getSessionId: vi.fn().mockResolvedValue('sess-B'),
      getSessionMeta: vi.fn().mockResolvedValue({ title: 'T' }),
    });

    const host = document.createElement('div');
    document.body.appendChild(host);
    controller = new SeriousTerminalController(host);

    // Cold-open agent A.
    await controller.openAgentTerminal({
      officeId: 'office-0', agentId: 'generalist', name: 'Gene',
      description: 'General', workingDir: '.', launchMode: 'copilot',
    });

    existsFor.add('debugger');
    (bridge.terminalActivate as any).mockClear();
    (bridge.terminalAttach as any).mockClear();
    (bridge.getSessionId as any).mockClear();

    // Switch to agent B (cold cache entry, already running on server → one atomic activation).
    await controller.openAgentTerminal({
      officeId: 'office-0', agentId: 'debugger', name: 'Dan',
      description: 'Debugger', workingDir: '.', launchMode: 'copilot',
    });

    const activateCalls = (bridge.terminalActivate as any).mock.calls.filter(
      (c: unknown[]) => c[0] === 'office-0' && c[1] === 'debugger' && (c[2] as { foreground?: boolean })?.foreground === true,
    ).length;
    // Spec 021 Phase 5b: the atomic activation replaces the legacy attach+getSessionId pair.
    const attachCalls = (bridge.terminalAttach as any).mock.calls.filter(
      (c: unknown[]) => c[0] === 'office-0' && c[1] === 'debugger',
    ).length;
    const getIdCalls = (bridge.getSessionId as any).mock.calls.filter(
      (c: unknown[]) => c[0] === 'office-0' && c[1] === 'debugger',
    ).length;
    expect(activateCalls).toBe(1);
    expect(attachCalls).toBe(0);
    expect(getIdCalls).toBe(0);

    const target = 'office-0:debugger';
    expect(countTerminalPerfEntries('switch:request', { surface: 'serious', target })).toBe(1);
    expect(countTerminalPerfEntries('switch:activate-done', { surface: 'serious', target })).toBe(1);
    expect(countTerminalPerfEntries('switch:first-ready', { surface: 'serious', target })).toBe(1);

    setTerminalPerfEnabled(false);
    resetTerminalPerf();
  });
});
