import { describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
}));

import { TerminalRelay } from '../../../electron/terminal/ipc-relay';
import type { MainToServer, ServerToMain } from '../../../electron/terminal/protocol';

interface RelayInternals {
  server: { connected: boolean; send: (msg: MainToServer) => void } | null;
  handleServerMessage(msg: ServerToMain, readyTimeout: unknown, onReady: () => void): void;
}

function connectedRelay(window: unknown = null) {
  const relay = new TerminalRelay(() => window as never);
  const sent: Array<MainToServer & { requestId?: string }> = [];
  const internals = relay as unknown as RelayInternals;
  internals.server = { connected: true, send: (msg) => sent.push(msg) };
  const deliver = (msg: ServerToMain) => internals.handleServerMessage(msg, undefined, () => {});
  return { relay, sent, deliver };
}

describe('TerminalRelay native-bridge seams', () => {
  it('ensures a session online with a background start that waits for readiness', async () => {
    const { relay, sent, deliver } = connectedRelay();

    const pending = relay.mainEnsureSessionOnline('office-0', 'generalist', 'C:\\work\\repo');

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({
      type: 'start',
      officeId: 'office-0',
      agentId: 'generalist',
      workingDir: 'C:\\work\\repo',
      background: true,
      readyTimeoutMs: 20_000,
    });
    expect(sent[0]).not.toHaveProperty('preseededPrompt', expect.anything());
    deliver({
      type: 'response',
      requestId: sent[0].requestId!,
      result: { success: false, ready: false, error: 'bridge did not connect' },
    });
    await expect(pending).resolves.toEqual({ success: false, ready: false, error: 'bridge did not connect' });
  });

  it('forwards session replacement metadata (office + session id) to main and renderer', () => {
    const webContentsSend = vi.fn();
    const window = { isDestroyed: () => false, webContents: { send: webContentsSend } };
    const { relay, deliver } = connectedRelay(window);
    const mainListener = vi.fn();
    relay.mainEvents.on('session-meta-updated', mainListener);

    deliver({
      type: 'session-meta-updated',
      agentId: 'generalist',
      officeId: 'office-0',
      meta: { title: '', sessionId: 'session-after-clear' },
    });

    expect(mainListener).toHaveBeenCalledWith('generalist', { title: '', sessionId: 'session-after-clear' }, 'office-0');
    expect(webContentsSend).toHaveBeenCalledWith(
      'session-meta-updated',
      'generalist',
      { title: '', sessionId: 'session-after-clear' },
      'office-0',
    );
  });

  it('forwards turn-end with office scope to main and renderer consumers', () => {
    const webContentsSend = vi.fn();
    const window = { isDestroyed: () => false, webContents: { send: webContentsSend } };
    const { relay, deliver } = connectedRelay(window);
    const mainListener = vi.fn();
    relay.mainEvents.on('copilot-turn-end', mainListener);

    deliver({
      type: 'copilot-turn-end',
      agentId: 'generalist',
      officeId: 'office-0',
    });

    expect(mainListener).toHaveBeenCalledWith('generalist', 'office-0');
    expect(webContentsSend).toHaveBeenCalledWith(
      'copilot-turn-end',
      'generalist',
      'office-0',
    );
  });
});
