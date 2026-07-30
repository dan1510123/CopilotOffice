import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { SeriousTerminalController } from '../../../src/ui/SeriousTerminalController';
import { installMockCopilotBridge, type MockCopilotBridge } from '../../setup/copilot-bridge-mock';

/**
 * Spec 020 — SeriousTerminalController restore parity (contracts/restore-session.md §7, FR-011).
 *
 * The second history surface must produce the SAME confirm prompt and call `restoreSession`
 * with the SAME args as TerminalOverlay. Read-only rows on the shared renderer never call the
 * bridge (asserted in sessionHistoryRenderSelect.test.ts).
 */

interface ControllerInternals {
  activeOfficeId: string | null;
  activeAgentId: string | null;
  activeOptions: unknown;
  restoreInFlight: boolean;
  openAgentTerminal: (...args: unknown[]) => Promise<void>;
  handleRestoreSession: (entry: { id: string; title?: string }) => Promise<void>;
}

function makeController(): { internals: ControllerInternals } {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const controller = new SeriousTerminalController(host);
  const internals = controller as unknown as ControllerInternals;
  internals.activeOfficeId = 'office-1';
  internals.activeAgentId = 'agent-1';
  internals.activeOptions = { officeId: 'office-1', agentId: 'agent-1', name: 'Dan', description: 'dev' };
  internals.openAgentTerminal = vi.fn().mockResolvedValue(undefined);
  return { internals };
}

describe('spec 020 — SeriousTerminalController.handleRestoreSession (parity)', () => {
  let bridge: MockCopilotBridge;
  const confirmSpy = vi.fn();

  beforeEach(() => {
    bridge = installMockCopilotBridge();
    vi.stubGlobal('confirm', confirmSpy);
    confirmSpy.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    document.body.innerHTML = '';
  });

  it('confirm → restoreSession called once with the same (officeId, agentId, entry.id)', async () => {
    confirmSpy.mockReturnValue(true);
    const { internals } = makeController();
    await internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    expect(bridge.restoreSession).toHaveBeenCalledTimes(1);
    expect(bridge.restoreSession).toHaveBeenCalledWith('office-1', 'agent-1', 'sess-A');
    expect(internals.openAgentTerminal).toHaveBeenCalledTimes(1);
  });

  it('uses the same confirm copy as TerminalOverlay (non-mid-turn)', async () => {
    confirmSpy.mockReturnValue(true);
    const { internals } = makeController();
    await internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    expect(confirmSpy).toHaveBeenCalledWith(
      'Switch to session "Alpha"? The current session will be archived into history.'
    );
  });

  it('cancel → bridge NOT called (FR-004 no-op)', async () => {
    confirmSpy.mockReturnValue(false);
    const { internals } = makeController();
    await internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    expect(bridge.restoreSession).not.toHaveBeenCalled();
    expect(internals.openAgentTerminal).not.toHaveBeenCalled();
  });

  it('a second select while restoreInFlight is ignored (FR-010 latch)', async () => {
    confirmSpy.mockReturnValue(true);
    const { internals } = makeController();
    internals.restoreInFlight = true;
    await internals.handleRestoreSession({ id: 'sess-A', title: 'Alpha' });
    expect(confirmSpy).not.toHaveBeenCalled();
    expect(bridge.restoreSession).not.toHaveBeenCalled();
  });
});
