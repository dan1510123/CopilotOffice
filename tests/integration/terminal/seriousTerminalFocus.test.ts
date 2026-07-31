import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';
import { MockFitAddon, MockTerminal } from '../../setup/xterm-mock';

vi.mock('@xterm/xterm', () => ({ Terminal: MockTerminal }));
vi.mock('@xterm/addon-fit', () => ({ FitAddon: MockFitAddon }));

import { SeriousTerminalController } from '../../../src/ui/SeriousTerminalController';

/**
 * Focus-ownership regression for Serious mode.
 *
 * Serious mode tears down Phaser (`teardownPhaserGame`), so there is no
 * `InputManager` and no Phaser keyboard capture. `SeriousTerminalController` is
 * therefore the sole owner of xterm focus. Clicking a sprite-card button or a
 * history row (`role="button"`) moves DOM focus off the hidden textarea; without a
 * re-assert the cursor renders hollow and keystrokes (Space especially, consumed
 * by a focused button/row as an activation key) never reach the PTY.
 *
 * These tests assert the controller re-asserts terminal focus on the paths that
 * lose it: terminal click (mousedown/mouseup), attach, and popover close — while
 * NOT stealing focus once the view is hidden.
 */
describe('integration/SeriousTerminalController — focus retention', () => {
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

    installMockCopilotBridge({
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-focus' }),
      terminalAttach: vi.fn().mockResolvedValue({ success: true, scrollback: '' }),
      getSessionId: vi.fn().mockResolvedValue('sess-focus'),
      getSessionMeta: vi.fn().mockResolvedValue({ title: '' }),
    });
  });

  afterEach(async () => {
    if (controller) {
      await controller.closeView({ detach: true, silent: true });
    }
    canvasContextSpy?.mockRestore();
    canvasContextSpy = null;
    controller = null;
  });

  async function openController(): Promise<{ terminal: MockTerminal }> {
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
    return { terminal: (controller as any).terminal as MockTerminal };
  }

  it('focuses the terminal on attach during openAgentTerminal', async () => {
    const { terminal } = await openController();
    expect(terminal.focus).toHaveBeenCalled();
  });

  it('re-asserts focus on terminal-area mousedown', async () => {
    const { terminal } = await openController();
    terminal.focus.mockClear();
    const outer = (controller as any).terminalOuterEl as HTMLElement;
    outer.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    expect(terminal.focus).toHaveBeenCalledTimes(1);
  });

  it('re-asserts focus after mouseup (deferred via rAF)', async () => {
    const rafSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((cb: FrameRequestCallback) => { cb(0); return 1; });
    try {
      const { terminal } = await openController();
      terminal.focus.mockClear();
      const outer = (controller as any).terminalOuterEl as HTMLElement;
      outer.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
      expect(terminal.focus).toHaveBeenCalledTimes(1);
    } finally {
      rafSpy.mockRestore();
    }
  });

  it('restores terminal focus when the history popover closes while visible', async () => {
    const { terminal } = await openController();
    terminal.focus.mockClear();
    (controller as any).closeSessionHistoryPopover();
    expect(terminal.focus).toHaveBeenCalled();
  });

  it('does NOT steal focus once the view is hidden (guarded by visibility)', async () => {
    const { terminal } = await openController();
    await controller!.closeView({ detach: true, silent: true });
    terminal.focus.mockClear();
    // Closing the popover again post-hide must not re-focus a hidden terminal.
    (controller as any).closeSessionHistoryPopover();
    (controller as any).focusTerminalHardened();
    expect(terminal.focus).not.toHaveBeenCalled();
    controller = null; // already closed
  });
});
