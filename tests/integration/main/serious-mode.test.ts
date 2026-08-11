import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installMockCopilotBridge } from '../../setup/copilot-bridge-mock';

/**
 * Serious-mode smoke test (spec 003 investigation).
 *
 * Bootstraps the full main.ts in jsdom, toggles into serious mode, opens
 * agent terminals via the dashboard cards, and asserts the invariants that
 * should hold (single sprite card, no duplicate ids, terminal switches
 * route correctly, etc.). Failures = bugs to be fixed by spec 003.
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

function clickAppModeToggle(): void {
  const btn = document.getElementById('app-mode-toggle-btn');
  if (!btn) throw new Error('app-mode-toggle-btn not found');
  (btn as HTMLElement).click();
}

function clickAgentCard(agentId: string): void {
  const card = document.querySelector(`.agent-card[data-agent="${agentId}"]`);
  if (!card) throw new Error(`agent card for ${agentId} not found`);
  (card as HTMLElement).click();
}

describe('integration/serious-mode smoke (spec 003)', () => {
  let setIntervalSpy: ReturnType<typeof vi.spyOn>;
  let canvasContextSpy: ReturnType<typeof vi.spyOn> | null = null;

  beforeEach(() => {
    document.body.innerHTML = '<div id="game-container"></div>';
    localStorage.clear();
    setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
      .mockReturnValue(1 as unknown as ReturnType<typeof setInterval>);
    // jsdom canvas returns a stub without 2d API; SeriousTerminalController and
    // the dashboard renderers call ctx.fillRect/drawImage/etc. Mock the context.
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

  async function bootstrapMain() {
    vi.resetModules();
    setupPhaserMock();
    setupMainDependencyMocks();
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
    });
    await import('../../../src/main');
    await flushUi();
    return { bridge };
  }

  it('SM-A: app-mode-toggle button exists and switches to serious mode', async () => {
    await bootstrapMain();
    const btn = document.getElementById('app-mode-toggle-btn');
    expect(btn?.textContent?.toLowerCase()).toContain('game');
    clickAppModeToggle();
    await flushUi();
    const btn2 = document.getElementById('app-mode-toggle-btn');
    expect(btn2?.textContent?.toLowerCase()).toContain('serious');
  }, 15000);

  it('SM-B: opening an agent terminal in serious mode shows ONE container, not stacked overviews', async () => {
    await bootstrapMain();
    clickAppModeToggle();
    await flushUi();
    clickAgentCard('generalist');
    await flushUi();

    // The serious-mode terminal host should now be visible.
    const overviewHost = document.querySelector('[data-app-mode="serious"]');
    expect(overviewHost).toBeTruthy();

    // SeriousTerminalController only creates ONE sprite/profile section.
    // (The serious controller does NOT use `id="sprite-card"`; that id is for
    // the game-mode TerminalOverlay only. Asserting we don't accidentally have
    // game-mode overlays leaking into serious mode.)
    const gameModeSpriteCards = document.querySelectorAll('#sprite-card');
    expect(gameModeSpriteCards.length, 'game-mode TerminalOverlay sprite-card should not leak into serious mode').toBe(0);
  }, 15000);

  it('SM-C: switching agents in serious mode routes activation to the new agent', async () => {
    const { bridge } = await bootstrapMain();
    clickAppModeToggle();
    await flushUi();

    clickAgentCard('generalist');
    await flushUi();
    expect(bridge.terminalActivate).toHaveBeenCalledWith('office-0', 'generalist', expect.objectContaining({ foreground: true }));

    clickAgentCard('debugger');
    await flushUi();
    expect(bridge.terminalActivate).toHaveBeenCalledWith('office-0', 'debugger', expect.objectContaining({ foreground: true }));

    // Spec 021 Phase 5b (retain-while-cached): switching must NOT detach the
    // previous agent — its cached xterm keeps its viewer for a warm re-open.
    expect(bridge.terminalDetach).not.toHaveBeenCalledWith('office-0', 'generalist');
  }, 15000);

  it('SM-D: toggling serious -> game -> serious does not stack sprite cards / leak DOM nodes', async () => {
    await bootstrapMain();

    // 1) Enter serious, open agent
    clickAppModeToggle();
    await flushUi();
    clickAgentCard('generalist');
    await flushUi();

    // 2) Toggle back to game
    clickAppModeToggle();
    await flushUi();

    // 3) Toggle to serious again
    clickAppModeToggle();
    await flushUi();
    clickAgentCard('debugger');
    await flushUi();

    // Each toggle should NOT create a new SeriousTerminalController; the
    // single instance is created at module load time. There should never be
    // more than one serious-mode card on screen.
    const seriousTerminalContainers = document.querySelectorAll('#serious-terminal-container');
    expect(seriousTerminalContainers.length, 'only one serious-terminal-container should exist').toBeLessThanOrEqual(1);

    // No leftover game-mode sprite cards either.
    const gameModeSpriteCards = document.querySelectorAll('#sprite-card');
    expect(gameModeSpriteCards.length, 'no leftover game-mode sprite cards in serious mode').toBe(0);
  }, 15000);

  it('SM-E: persisted appMode in localStorage controls boot mode', async () => {
    localStorage.setItem('agencyOffice:appMode', 'serious');
    await bootstrapMain();
    const btn = document.getElementById('app-mode-toggle-btn');
    expect(btn?.textContent?.toLowerCase(), 'boot in serious mode when localStorage says so').toContain('serious');
  }, 15000);

  it('SM-F: openAgentTerminal surfaces sprite-render failure and still attempts attach (V12, C8)', async () => {
    // Spec 003 fix: the synchronous render phase is wrapped in try/catch so
    // a canvas/sprite failure surfaces in status + xterm and the IPC
    // attach STILL fires for the requested ids.
    canvasContextSpy?.mockRestore();
    canvasContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('simulated canvas failure');
    });
    const { bridge } = await bootstrapMain();
    clickAppModeToggle();
    await flushUi();
    clickAgentCard('generalist');
    await flushUi();
    expect(
      bridge.terminalActivate,
      'V12 violated: render failure aborted the open flow before terminalActivate',
    ).toHaveBeenCalledWith('office-0', 'generalist', expect.objectContaining({ foreground: true }));
  }, 15000);

  it('SM-001 single sprite-card across game-mode + serious-mode toggles (V8/V9/V10, C6/C7)', async () => {
    await bootstrapMain();
    // game mode boot — at most one sprite-card
    expect(
      document.querySelectorAll('#sprite-card').length,
      'V8 violated: sprite-card stacked on boot',
    ).toBeLessThanOrEqual(1);

    // Toggle serious -> game -> serious -> game several times. The DOM must
    // never accumulate more than one #sprite-card across transitions.
    for (let i = 0; i < 5; i++) {
      clickAppModeToggle();
      await flushUi();
      expect(
        document.querySelectorAll('#sprite-card').length,
        `V8 violated: sprite-card stacked after toggle #${i + 1}`,
      ).toBeLessThanOrEqual(1);
    }
  }, 15000);

  it('SM-002 serious-mode open surfaces synchronous render failures and still attaches (V12, C8)', async () => {
    canvasContextSpy?.mockRestore();
    canvasContextSpy = vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(() => {
      throw new Error('forced render failure');
    });
    const { bridge } = await bootstrapMain();
    clickAppModeToggle();
    await flushUi();
    clickAgentCard('generalist');
    await flushUi();

    // (3) terminalStart was invoked with the requested ids
    const startCalls = (bridge.terminalStart as ReturnType<typeof vi.fn>).mock.calls;
    expect(
      startCalls.some((c) => c[0] === 'office-0' && c[1] === 'generalist'),
      'V12 violated: terminalStart never called for office-0/generalist after render throw',
    ).toBe(true);
    // (4) terminalActivate was invoked with the requested ids
    expect(
      bridge.terminalActivate,
      'V12 violated: terminalActivate never called after render throw',
    ).toHaveBeenCalledWith('office-0', 'generalist', expect.objectContaining({ foreground: true }));
  }, 15000);

  it('SM-002.a serious-mode open happy path unchanged by resilience handler (V12.a, C8.a)', async () => {
    const { bridge } = await bootstrapMain();
    clickAppModeToggle();
    await flushUi();
    clickAgentCard('generalist');
    await flushUi();

    // Happy path activates normally.
    expect(bridge.terminalActivate).toHaveBeenCalledWith('office-0', 'generalist', expect.objectContaining({ foreground: true }));
    // No render-error status leaked into the terminal output.
    // (We can only inspect the rendered status element; if the resilience
    // handler fired, the status would contain "[render error" — it must not.)
    const statusEls = document.querySelectorAll('[data-app-mode="serious"]');
    let combined = '';
    statusEls.forEach((el) => { combined += el.textContent || ''; });
    expect(
      combined,
      'V12.a violated: render-error message leaked into happy-path status',
    ).not.toContain('[render error');
    expect(
      combined,
      'V12.a violated: serious-mode open failed during render message leaked into happy path',
    ).not.toContain('serious-mode open failed during render');
  }, 15000);

  it('SM-003 serious-mode onData routes to agent bound at registration, not live activeAgentId (V13/V14, C9)', async () => {
    const { bridge } = await bootstrapMain();
    clickAppModeToggle();
    await flushUi();
    clickAgentCard('generalist');
    await flushUi();

    // Switch to debugger — the previous onData binding for generalist must
    // be disposed; the new binding routes to debugger.
    clickAgentCard('debugger');
    await flushUi();

    // After switching, activation for debugger fired; retain-while-cached means
    // the previous (generalist) is NOT detached on switch.
    expect(bridge.terminalActivate).toHaveBeenCalledWith('office-0', 'debugger', expect.objectContaining({ foreground: true }));
    expect(bridge.terminalDetach).not.toHaveBeenCalledWith('office-0', 'generalist');

    // Sanity: the dashboard click-driven open path issued an activation for the
    // *currently visible* agent, not the previously-active one. (Direct
    // onData routing is exercised by the unit-level controller test; here
    // we verify the integrated handler chain at least activates correctly.)
    const lastActivateCall = (bridge.terminalActivate as ReturnType<typeof vi.fn>).mock.calls.at(-1);
    expect(
      lastActivateCall,
      'V13 violated: no terminalActivate calls recorded',
    ).toBeTruthy();
    expect(lastActivateCall?.[1], 'V13 violated: last activate not bound to clicked agent').toBe('debugger');
  }, 15000);
});
