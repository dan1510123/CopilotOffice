import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { TerminalOverlay } from '../../../src/ui/TerminalOverlay';
import { installMockCopilotBridge, type MockCopilotBridge } from '../../setup/copilot-bridge-mock';

/**
 * Spec 020 — TerminalOverlay restore flow (contracts/restore-session.md §7).
 *
 * Exercises the private `handleRestoreSession` wiring against the shared bridge mock:
 * confirm → single bridge call (FR-004/FR-010), cancel → no bridge call (FR-004),
 * advisory on `resumeContextUncertain` (FR-013). `show()` is stubbed so we assert the
 * control-flow, not the heavy terminal re-render.
 */

interface OverlayInternals {
  currentAgentId: string | null;
  currentAgent: unknown;
  attachedOfficeId: string | null;
  onCloseCallback: (() => void) | null;
  isReadOnly: boolean;
  restoreInFlight: boolean;
  show: (...args: unknown[]) => Promise<void>;
  awaitNextRefitSettled: (...args: unknown[]) => Promise<void>;
  handleRestoreSession: (entry: { id: string; title?: string }) => Promise<void>;
}

function makeOverlay(bridge: MockCopilotBridge): { overlay: TerminalOverlay; internals: OverlayInternals } {
  void bridge;
  const scene = { game: { events: { emit: vi.fn(), on: vi.fn() } } } as unknown;
  const inputManager = {} as never;
  const overlay = new TerminalOverlay(scene as never, inputManager, () => 'office-1');
  const internals = overlay as unknown as OverlayInternals;
  internals.currentAgentId = 'agent-1';
  internals.currentAgent = { id: 'agent-1', name: 'Dan', description: 'dev', color: 0, workingDir: '' };
  internals.attachedOfficeId = 'office-1';
  internals.onCloseCallback = () => {};
  internals.isReadOnly = false;
  // Stub the heavy re-render + its post-render settle wait.
  internals.show = vi.fn().mockResolvedValue(undefined);
  internals.awaitNextRefitSettled = vi.fn().mockResolvedValue(undefined);
  return { overlay, internals };
}

describe('spec 020 — TerminalOverlay.handleRestoreSession', () => {
  let bridge: MockCopilotBridge;
  const confirmSpy = vi.fn();

  beforeEach(() => {
    bridge = installMockCopilotBridge();
    vi.stubGlobal('confirm', confirmSpy);
    confirmSpy.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('confirm → restoreSession called once with (officeId, agentId, entry.id)', async () => {
    confirmSpy.mockReturnValue(true);
    const { internals } = makeOverlay(bridge);
    await internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    expect(bridge.restoreSession).toHaveBeenCalledTimes(1);
    expect(bridge.restoreSession).toHaveBeenCalledWith('office-1', 'agent-1', 'sess-A');
    // Re-render happens after success.
    expect(internals.show).toHaveBeenCalledTimes(1);
  });

  it('cancel → bridge NOT called (FR-004 no-op)', async () => {
    confirmSpy.mockReturnValue(false);
    const { internals } = makeOverlay(bridge);
    await internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    expect(bridge.restoreSession).not.toHaveBeenCalled();
    expect(internals.show).not.toHaveBeenCalled();
  });

  it('read-only overlay never calls the bridge (FR-017)', async () => {
    confirmSpy.mockReturnValue(true);
    const { internals } = makeOverlay(bridge);
    internals.isReadOnly = true;
    await internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(bridge.restoreSession).not.toHaveBeenCalled();
  });

  it('resumeContextUncertain:true surfaces the advisory toast (FR-013)', async () => {
    confirmSpy.mockReturnValue(true);
    (bridge.restoreSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: true, sessionId: 'sess-A', resumeContextUncertain: true,
    });
    const { internals } = makeOverlay(bridge);
    await internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    const toast = document.body.textContent || '';
    expect(toast).toContain('context may not be restored');
  });

  it('failure response surfaces an error and does not re-render (FR-009)', async () => {
    confirmSpy.mockReturnValue(true);
    (bridge.restoreSession as ReturnType<typeof vi.fn>).mockResolvedValue({
      success: false, error: 'target session not in history',
    });
    const { internals } = makeOverlay(bridge);
    await internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    expect(document.body.textContent || '').toContain('Restore failed');
    expect(internals.show).not.toHaveBeenCalled();
  });

  it('a second select while restoreInFlight is ignored (FR-010 latch)', async () => {
    confirmSpy.mockReturnValue(true);
    const { internals } = makeOverlay(bridge);
    internals.restoreInFlight = true;
    await internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(bridge.restoreSession).not.toHaveBeenCalled();
  });

  it('spec 021: shows the "Restoring session…" loader while in flight and hides it after (blocking input meanwhile)', async () => {
    confirmSpy.mockReturnValue(true);
    const { overlay, internals } = makeOverlay(bridge);

    // Give the overlay a real restore loader element (createContainer builds it).
    const loader = (overlay as unknown as {
      createRestoreLoadingOverlay: () => HTMLDivElement;
    }).createRestoreLoadingOverlay();
    (overlay as unknown as { restoreLoadingOverlay: HTMLDivElement }).restoreLoadingOverlay = loader;
    document.body.appendChild(loader);

    // Gate restoreSession so we can observe the in-flight state.
    let release: (v: { success: boolean; sessionId: string }) => void = () => {};
    (bridge.restoreSession as ReturnType<typeof vi.fn>).mockImplementation(
      () => new Promise((res) => { release = res; }),
    );

    const p = internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    // In flight: loader visible, latch raised → input dropped.
    expect(loader.style.display).toBe('flex');
    expect(internals.restoreInFlight).toBe(true);
    const handleUserInput = (overlay as unknown as {
      handleUserInput: (d: string, o: string, a: string) => void;
    }).handleUserInput.bind(overlay);
    handleUserInput('x', 'office-1', 'agent-1');
    expect(bridge.terminalWrite).not.toHaveBeenCalled();

    release({ success: true, sessionId: 'sess-A' });
    await p;

    // Settled: loader hidden, latch cleared.
    expect(loader.style.display).toBe('none');
    expect(internals.restoreInFlight).toBe(false);
  });
});
