import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';

interface BridgeCallbacks {
  preloadStatus?: (agentId: string, status: 'preloading' | 'ready' | 'failed') => void;
}

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
    this.handlers.set(
      event,
      list.filter((fn) => fn !== cb)
    );
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

    constructor(_config: unknown) {}
  }

  vi.doMock('phaser', () => {
    const phaser = { AUTO: 0, Game: MockGame };
    return {
      default: phaser,
      AUTO: phaser.AUTO,
      Game: phaser.Game,
    };
  });
}

function setupMainDependencyMocks(): void {
  vi.doMock('../../../src/scenes/BootScene', () => ({ BootScene: class MockBootScene {} }));
  vi.doMock('../../../src/scenes/OfficeScene', () => ({ OfficeScene: class MockOfficeScene {} }));
  vi.doMock('../../../src/scenes/MeetingScene', () => ({ MeetingScene: class MockMeetingScene {} }));
  vi.doMock('../../../src/ui/SettingsPanel', () => ({
    SettingsPanel: class MockSettingsPanel {
      toggle = vi.fn();
      constructor(_notificationService: unknown, _callbacks: unknown) {}
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

function findOfficeTab(name: string): HTMLElement | undefined {
  return Array.from(document.querySelectorAll('.office-tab'))
    .find((tab) => tab.textContent?.includes(name)) as HTMLElement | undefined;
}

describe('integration/main bootstrap and wiring', () => {
  let callbacks: BridgeCallbacks;
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    document.body.innerHTML = '<div id="game-container"></div>';
    callbacks = {};
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      .mockReturnValue(1 as unknown as ReturnType<typeof setInterval>);
  });

  afterEach(() => {
    setIntervalSpy.mockRestore();
  });

  async function bootstrapMain() {
    vi.resetModules();
    setupPhaserMock();
    setupMainDependencyMocks();

    const bridge = installMockCopilotBridge({
      onTerminalPreloadStatus: vi.fn((cb) => { callbacks.preloadStatus = cb; }),
      queryAgentStatuses: vi.fn().mockResolvedValue({}),
      getAllSessionMeta: vi.fn().mockResolvedValue({}),
    });

    await import('../../../src/main');
    await flushUi();
    return { bridge };
  }

  // Full-suite runs can be slower due to jsdom/timer contention during app bootstrap.
  it('renders base split layout and registers bridge listeners', async () => {
    const { bridge } = await bootstrapMain();

    expect(document.getElementById('office-tabs')).toBeTruthy();
    expect(document.getElementById('office-panel')).toBeTruthy();
    expect(document.getElementById('terminal-panel')).toBeTruthy();
    expect(document.getElementById('status-bar')).toBeTruthy();
    expect(findOfficeTab('Main Office')).toBeTruthy();
    expect(document.getElementById('terminal-title')?.textContent).toContain('Office Overview');

    expect(bridge.onCopilotToolStart).toHaveBeenCalledTimes(1);
    expect(bridge.onCopilotToolComplete).toHaveBeenCalledTimes(1);
    expect(bridge.onCopilotTurnStart).toHaveBeenCalledTimes(1);
    expect(bridge.onCopilotTurnEnd).toHaveBeenCalledTimes(1);
    expect(bridge.onCopilotUserMessage).toHaveBeenCalledTimes(1);
    expect(bridge.onTerminalPreloadStatus).toHaveBeenCalledTimes(1);
    expect(bridge.queryAgentStatuses).toHaveBeenCalledWith('office-0');
  }, 15000);

  it('creates a new office via tabs UI and switches back to main office', async () => {
    await bootstrapMain();

    const officeName = 'Smoke Office';
    const workingDir = '.\\smoke';
    (document.getElementById('new-office-btn') as HTMLElement).click();
    expect(document.getElementById('nod-name')).toBeTruthy();

    (document.getElementById('nod-name') as HTMLInputElement).value = officeName;
    (document.getElementById('nod-path') as HTMLInputElement).value = workingDir;
    (document.getElementById('nod-create') as HTMLButtonElement).click();
    await flushUi();

    expect(findOfficeTab(officeName)).toBeTruthy();
    const subtitle = document.getElementById('terminal-subtitle');
    expect(subtitle?.textContent).toContain(officeName);
    expect(subtitle?.textContent).toContain(workingDir);

    const mainTab = findOfficeTab('Main Office');
    expect(mainTab).toBeTruthy();
    mainTab?.click();
    await flushUi();
    expect(subtitle?.textContent).toContain('Main Office');
  });

  it('routes preload-ready bridge events to visible toast notifications', async () => {
    await bootstrapMain();

    expect(callbacks.preloadStatus).toBeTypeOf('function');
    callbacks.preloadStatus?.('generalist', 'ready');
    await flushUi();

    const toastContainer = document.getElementById('toast-container');
    expect(toastContainer).toBeTruthy();
    expect(toastContainer?.children.length).toBeGreaterThan(0);
    expect(toastContainer?.textContent).toContain('Gene');
  });
});

