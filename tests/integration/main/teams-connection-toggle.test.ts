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
    // Stateful fake agentsPaused flag: teamsPauseAgents/teamsResumeAgents flip it,
    // and teamsStatus always reflects it — mirrors the real TeamsService, where
    // the pill's state is sourced from teamsStatus().agentsPaused (NOT from
    // TeamsSettings.enabled, which this toggle must never touch).
    let agentsPaused = false;
    const teamsStatus = vi.fn(async () => ({ success: true, connected: false, bindings: [], agentsPaused }));
    const teamsPauseAgents = vi.fn(async () => {
      agentsPaused = true;
      return { outcome: 'paused', count: 1, message: 'paused' };
    });
    const teamsResumeAgents = vi.fn(async () => {
      agentsPaused = false;
      return { outcome: 'resumed', count: 1, message: 'resumed' };
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
      teamsStatus,
      teamsPauseAgents,
      teamsResumeAgents,
    });
    await import('../../../src/main');
    await flushUi();
    return { bridge, teamsPauseAgents, teamsResumeAgents };
  }

  it('TCT-A: pill is absent when no Teams channel is configured', async () => {
    await bootstrapMain({ enabled: true, defaultChannelUrl: '' });
    expect(getTogglePill()).toBeNull();
  }, 15000);

  it('TCT-B: pill shows "Connection Active" when configured + enabled + not paused', async () => {
    await bootstrapMain({ enabled: true, defaultChannelUrl: 'https://teams.microsoft.com/l/channel/x' });
    const pill = getTogglePill();
    expect(pill).toBeTruthy();
    expect(pill?.textContent).toContain('Connection Active');
  }, 15000);

  it('TCT-C: pill is ABSENT when the Teams feature itself is disabled, even if a channel is configured', async () => {
    // Pausing is a sub-feature of Teams Remote; it makes no sense to show a
    // quick-pause pill when the whole feature is off in Settings.
    await bootstrapMain({ enabled: false, defaultChannelUrl: 'https://teams.microsoft.com/l/channel/x' });
    expect(getTogglePill()).toBeNull();
  }, 15000);

  it('TCT-D: clicking calls teamsPauseAgents/teamsResumeAgents (never teamsSaveSettings), toggling the pill both ways', async () => {
    const { bridge, teamsPauseAgents, teamsResumeAgents } = await bootstrapMain({
      enabled: true,
      defaultChannelUrl: 'https://teams.microsoft.com/l/channel/x',
    });
    expect(getTogglePill()?.textContent).toContain('Connection Active');

    // Click #1: Active -> Paused.
    (getTogglePill() as HTMLElement).click();
    await flushUi();
    expect(teamsPauseAgents).toHaveBeenCalledTimes(1);
    expect(teamsResumeAgents).not.toHaveBeenCalled();
    expect(getTogglePill()?.textContent).toContain('Connection Paused');

    // Click #2: Paused -> Active.
    (getTogglePill() as HTMLElement).click();
    await flushUi();
    expect(teamsResumeAgents).toHaveBeenCalledTimes(1);
    expect(getTogglePill()?.textContent).toContain('Connection Active');

    // This toggle must NEVER touch TeamsSettings.enabled (that's the full
    // feature kill switch, which would also affect the orchestrator).
    expect(bridge.teamsSaveSettings).not.toHaveBeenCalled();
  }, 15000);

  it('clicking an orange paused agent button disconnects its thread rather than registering again', async () => {
    const { bridge } = await bootstrapMain({
      enabled: true,
      defaultChannelUrl: 'https://teams.microsoft.com/l/channel/x',
    });
    const binding = {
      officeId: 'office-0', agentId: 'generalist', online: false,
      handle: 'gene', health: 'disconnected' as const, workingDir: '.',
    };
    vi.mocked(bridge.teamsStatus).mockResolvedValue({
      success: true, connected: false, agentsPaused: true, bindings: [binding],
    });
    vi.mocked(bridge.teamsStop).mockImplementation(async () => {
      vi.mocked(bridge.teamsStatus).mockResolvedValue({
        success: true, connected: false, agentsPaused: true, bindings: [],
      });
      return { success: true };
    });
    getTogglePill()?.click();
    await flushUi();
    const button = document.querySelector<HTMLButtonElement>('.session-teams-btn[data-agent="generalist"]');
    expect(button?.textContent).toContain('Teams Paused');
    expect(button?.classList.contains('ui-btn--teams-paused')).toBe(true);
    button?.click();
    await flushUi();
    expect(bridge.teamsStop).toHaveBeenCalledWith({ officeId: 'office-0', agentId: 'generalist' });
    expect(bridge.teamsRegister).not.toHaveBeenCalled();
    expect(document.querySelector('.session-teams-btn[data-agent="generalist"]')?.textContent).toContain('Teams Remote');
  }, 15000);
});
