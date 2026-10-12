import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';

/**
 * Top-bar Teams connection pause/resume toggle.
 *
 * Boots the full main.ts in jsdom (same pattern as serious-mode.test.ts) and
 * exercises `#teams-connection-toggle-btn`: it must be absent when no Teams
 * channel is configured, render "Connection Active"/"Connection Paused"
 * based on `TeamsSettings.enabled`, and flip that same flag via
 * teamsGetSettings/teamsSaveSettings on click (the exact field the Teams
 * Settings panel checkbox controls — see electron/main.ts's
 * registerTeamsIpc onSettingsChanged -> TeamsService.start()/stop()).
 */

class MockPhaserEventEmitter {
  private handlers = new Map<string, Array<(...args: unknown[]) => void>>();
  on(event: string, cb: (...args: unknown[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    list.push(cb);
    this.handlers.set(event, list);
    return this;
  }
  once(event: string, cb: (...args: unknown[]) => void): this {
    const wrapped = (...args: unknown[]) => {
      this.off(event, wrapped);
      cb(...args);
    };
    return this.on(event, wrapped);
  }
  off(event: string, cb: (...args: unknown[]) => void): this {
    const list = this.handlers.get(event) ?? [];
    this.handlers.set(event, list.filter((fn) => fn !== cb));
    return this;
  }
  emit(event: string, ...args: unknown[]): boolean {
    const list = this.handlers.get(event) ?? [];
    for (const cb of list) cb(...args);
    return list.length > 0;
  }
}

function setupPhaserMock(): void {
  class MockGame {
    events = new MockPhaserEventEmitter();
    registry = { get: vi.fn(() => false) };
    scale = { resize: vi.fn() };
    textures = {
      get: vi.fn(() => ({ key: '__MISSING' })),
      getBase64: vi.fn(() => 'data:image/png;base64,'),
    };
    scene = { getScene: vi.fn(() => ({ textures: this.textures })) };
    destroy = vi.fn();
    constructor(_config: unknown) {}
  }
  vi.doMock('phaser', () => {
    const phaser = { AUTO: 0, Game: MockGame };
    return { default: phaser, AUTO: phaser.AUTO, Game: phaser.Game };
  });
}

function setupMainDependencyMocks(): void {
  vi.doMock('../../../src/scenes/BootScene', () => ({ BootScene: class MockBootScene {} }));
  vi.doMock('../../../src/scenes/OfficeScene', () => ({ OfficeScene: class MockOfficeScene {} }));
  vi.doMock('../../../src/scenes/MeetingScene', () => ({ MeetingScene: class MockMeetingScene {} }));
  vi.doMock('../../../src/ui/SettingsPanel', () => ({
    SettingsPanel: class MockSettingsPanel {
      toggle = vi.fn();
      constructor(_a: unknown, _b: unknown) {}
    },
  }));
  vi.doMock('../../../src/ui/SpriteCustomizerPanel', () => ({
    SpriteCustomizerPanel: class MockSpriteCustomizerPanel {
      toggle = vi.fn();
      isOpen = vi.fn(() => false);
      updatePreview = vi.fn();
      constructor(_opts: unknown) {}
    },
  }));
  vi.doMock('../../../src/sprites/SpriteGenerator', () => ({
    regeneratePlayerSprite: vi.fn(),
  }));
}

async function flushUi(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 25));
}

function getTogglePill(): HTMLElement | null {
  return document.getElementById('teams-connection-toggle-btn');
}

function teamsSettings(overrides: Partial<{ enabled: boolean; defaultChannelUrl: string }> = {}) {
  return {
    enabled: false,
    defaultChannelUrl: '',
    ackEnabled: false,
    checkInEnabled: false,
    checkInThresholdMs: 0,
    checkInThrottleMs: 0,
    ...overrides,
  };
}

describe('integration/teams connection toggle (top bar)', () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let canvasContextSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '<div id="game-container"></div>';
    localStorage.clear();
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      .mockReturnValue(1 as unknown as ReturnType<typeof setInterval>);
    canvasContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => ({
      clearRect: vi.fn(),
      fillRect: vi.fn(),
      drawImage: vi.fn(),
      strokeRect: vi.fn(),
      fillText: vi.fn(),
      beginPath: vi.fn(),
      moveTo: vi.fn(),
      lineTo: vi.fn(),
      stroke: vi.fn(),
      closePath: vi.fn(),
      arc: vi.fn(),
      fill: vi.fn(),
      save: vi.fn(),
      restore: vi.fn(),
      translate: vi.fn(),
      scale: vi.fn(),
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      font: '',
      imageSmoothingEnabled: false,
    }) as unknown as CanvasRenderingContext2D);
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
    canvasContextSpy?.mockRestore();
    canvasContextSpy = null;
  });

  async function bootstrapMain(settingsOverrides?: Partial<{ enabled: boolean; defaultChannelUrl: string }>) {
    vi.resetModules();
    setupPhaserMock();
    setupMainDependencyMocks();
    // Stateful fake settings store: teamsSaveSettings persists what it's given,
    // and every subsequent teamsGetSettings reflects it — mirrors the real
    // main-process settings file, so the toggle handler's own re-fetch (it
    // never trusts a stale cache) sees its own write without test-side poking.
    let storedSettings = teamsSettings(settingsOverrides);
    const teamsGetSettings = vi.fn(async () => ({ success: true, settings: storedSettings }));
    const teamsSaveSettings = vi.fn(async (next: ReturnType<typeof teamsSettings>) => {
      storedSettings = next;
      return { success: true };
    });
    const bridge = installMockCopilotBridge({
      onTerminalPreloadStatus: vi.fn(),
      queryAgentStatuses: vi.fn().mockResolvedValue({}),
      getAllSessionMeta: vi.fn().mockResolvedValue({}),
      terminalExists: vi.fn().mockResolvedValue(false),
      terminalStart: vi.fn().mockResolvedValue({ success: true, sessionId: 'sess-smoke' }),
      terminalAttach: vi.fn().mockResolvedValue({ success: true, scrollback: '' }),
      terminalDetach: vi.fn().mockResolvedValue({ success: true }),
      getSessionId: vi.fn().mockResolvedValue('sess-smoke'),
      getSessionMeta: vi.fn().mockResolvedValue({ title: 'A title' }),
      teamsGetSettings,
      teamsSaveSettings,
      teamsStatus: vi.fn().mockResolvedValue({ success: true, connected: false, bindings: [] }),
    });
    await import('../../../src/main');
    await flushUi();
    return { bridge };
  }

  it('TCT-A: pill is absent when no Teams channel is configured', async () => {
    await bootstrapMain({ enabled: false, defaultChannelUrl: '' });
    expect(getTogglePill()).toBeNull();
  }, 15000);

  it('TCT-B: pill shows "Connection Active" when configured + enabled', async () => {
    await bootstrapMain({ enabled: true, defaultChannelUrl: 'https://teams.microsoft.com/l/channel/x' });
    const pill = getTogglePill();
    expect(pill).toBeTruthy();
    expect(pill?.textContent).toContain('Connection Active');
  }, 15000);

  it('TCT-C: pill shows "Connection Paused" when configured but disabled', async () => {
    await bootstrapMain({ enabled: false, defaultChannelUrl: 'https://teams.microsoft.com/l/channel/x' });
    const pill = getTogglePill();
    expect(pill).toBeTruthy();
    expect(pill?.textContent).toContain('Connection Paused');
  }, 15000);

  it('TCT-D: clicking toggles enabled false->true->false via teamsSaveSettings, re-rendering each time', async () => {
    const { bridge } = await bootstrapMain({ enabled: true, defaultChannelUrl: 'https://teams.microsoft.com/l/channel/x' });
    expect(getTogglePill()?.textContent).toContain('Connection Active');

    // Click #1: Active -> Paused.
    (getTogglePill() as HTMLElement).click();
    await flushUi();
    expect(bridge.teamsSaveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ enabled: false, defaultChannelUrl: 'https://teams.microsoft.com/l/channel/x' }),
    );
    expect(getTogglePill()?.textContent).toContain('Connection Paused');

    // Click #2: Paused -> Active.
    (getTogglePill() as HTMLElement).click();
    await flushUi();
    expect(bridge.teamsSaveSettings).toHaveBeenLastCalledWith(
      expect.objectContaining({ enabled: true, defaultChannelUrl: 'https://teams.microsoft.com/l/channel/x' }),
    );
    expect(getTogglePill()?.textContent).toContain('Connection Active');
  }, 15000);
});
