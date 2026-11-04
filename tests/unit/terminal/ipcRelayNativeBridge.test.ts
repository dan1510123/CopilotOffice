import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('electron', () => ({
  ipcMain: { handle: vi.fn() },
  BrowserWindow: class {},
}));

import { TerminalRelay } from '../../../electron/terminal/ipc-relay';
import { ipcMain } from 'electron';
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
  afterEach(() => vi.useRealTimers());

  it('expires disconnected startup requests and never sends them on reconnect', async () => {
    vi.useFakeTimers();
    const { relay, sent, deliver } = connectedRelay();
    const internals = relay as unknown as RelayInternals;
    internals.server = null;
    const deadline = Date.now() + 100;
    const pending = relay.mainStartBackground('office-2', 'new-agent', 'agent-dir', 'office-dir', true, deadline);
    await vi.advanceTimersByTimeAsync(100);
    await expect(pending).resolves.toMatchObject({ success: false, error: 'Request timed out' });
    internals.server = { connected: true, send: (msg) => sent.push(msg) };
    deliver({ type: 'ready' });
    expect(sent).toEqual([]);
  });

  it('sends complete background launch config and inactive acquisition constraint', async () => {
    const { relay, sent, deliver } = connectedRelay();
    const deadline = Date.now() + 60_000;
    const pending = relay.mainStartBackground('office-2', 'new-agent', 'agent-dir', 'office-dir', true, deadline);
    expect(sent[0]).toMatchObject({
      type: 'start', background: true, requireInactive: true, deadline,
      workingDir: 'agent-dir', hostWorkingDir: 'office-dir', launchMode: 'copilot',
    });
    deliver({ type: 'response', requestId: sent[0].requestId!, result: { success: false, alreadyActive: true } });
    await expect(pending).resolves.toMatchObject({ success: false, alreadyActive: true });
  });

  it('waits for the server permission update and forwards its failure to settings', async () => {
    const { relay, sent, deliver } = connectedRelay();
    vi.mocked(ipcMain.handle).mockClear();
    relay.registerIpc();
    const listener = vi.mocked(ipcMain.handle).mock.calls.find(([channel]) => channel === 'set-yolo')?.[1];
    expect(listener).toBeDefined();
    const pending = listener!({} as never, true);
    expect(sent[0]).toMatchObject({ type: 'set-yolo', enabled: true, requestId: expect.any(String) });
    deliver({
      type: 'response',
      requestId: sent[0].requestId!,
      result: { success: false, error: 'Permission mode rejected' },
    });
    await expect(pending).resolves.toEqual({ success: false, error: 'Permission mode rejected' });
  });

  it('routes background voice events with office/session scope without changing ordinary viewer forwarding', () => {
    const send = vi.fn();
    const { relay, deliver } = connectedRelay({ isDestroyed: () => false, webContents: { send } });
    const teamsListener = vi.fn();
    relay.mainEvents.on('copilot-event', teamsListener);
    const event = { id: 'reply', type: 'assistant.message', data: { content: 'Hello' }, timestamp: '', parentId: null };
    deliver({ type: 'copilot-event', agentId: 'dynamic', officeId: 'office-a', sessionId: 'session-a', event, mainOnly: true, voiceOnly: true });
    expect(send).toHaveBeenCalledExactlyOnceWith('voice-event', 'dynamic', event, 'office-a', 'session-a');
    expect(teamsListener).not.toHaveBeenCalled();
  });
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
