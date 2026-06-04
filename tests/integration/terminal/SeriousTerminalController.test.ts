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
    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-serious' }),
      terminalAttach: vi.fn().mockResolvedValue({ success: true, scrollback: '' }),
      getSessionId: vi.fn().mockResolvedValue('sess-serious'),
      getSessionMeta: vi.fn().mockResolvedValue({ title: 'Session Title' }),
    });

    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
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

  it('removes copy listener when view closes', async () => {
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

    await controller.closeView({ detach: true });

    expect((controller as any).terminalCopyHandler).toBeNull();
  });
});
