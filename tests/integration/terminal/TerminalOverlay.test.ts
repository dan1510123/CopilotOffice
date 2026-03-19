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
});

