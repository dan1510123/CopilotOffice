import { afterEach, describe, expect, it, vi } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { createOrchestratorSettingsStore, type OrchestratorSettings } from '../../../electron/orchestrator/orchestratorSettingsStore';
import { OrchestratorSessionManager, type OrchestratorEmitter } from '../../../electron/orchestrator/orchestratorSessionManager';
import type { PermissionRequest, PermissionRequestResult } from '@github/copilot-sdk';

const { handlers } = vi.hoisted(() => ({
  handlers: new Map<string, (...args: unknown[]) => { success?: boolean; settings?: OrchestratorSettings; error?: string }>(),
}));
vi.mock('electron', () => ({
  ipcMain: {
    handle: (channel: string, handler: (...args: unknown[]) => { success?: boolean; settings?: OrchestratorSettings; error?: string }) =>
      handlers.set(channel, handler),
  },
}));
import { registerOrchestratorIpc } from '../../../electron/orchestrator/orchestratorIpc';

const directories: string[] = [];
afterEach(() => {
  for (const dir of directories.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
  handlers.clear();
  vi.restoreAllMocks();
});

function fixture() {
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'ringleader-settings-'));
  directories.push(cwd);
  const emitter: OrchestratorEmitter = {
    emitEvent: vi.fn(),
    emitPermissionRequest: vi.fn(),
    emitCandidatesRequest: vi.fn(),
    emitExecuteRequest: vi.fn(),
    emitOfficesRequest: vi.fn(),
    emitSwitchRequest: vi.fn(),
    emitExit: vi.fn(),
  };
  const manager = new OrchestratorSessionManager(emitter, cwd);
  const store = createOrchestratorSettingsStore(cwd);
  registerOrchestratorIpc({ manager, settingsStore: store });
  const gate = (manager as unknown as {
    permissionHandler: (request: PermissionRequest) => PermissionRequestResult | Promise<PermissionRequestResult>;
  }).permissionHandler;
  const request: PermissionRequest = {
    kind: 'custom-tool', toolCallId: 'write-1', toolName: 'bring_agent_online',
    toolDescription: 'Start an agent', args: { agentId: 'debugger' },
  };
  return { cwd, emitter, manager, store, gate, request };
}

describe('Ringleader approval settings persistence and IPC', () => {
  it('defaults to approval and restores a saved bypass after recreation', async () => {
    const { cwd, store, gate, request, manager } = fixture();
    expect(store.load()).toEqual({ allowAllOperations: false });
    const pending = gate(request);
    expect(pending).toBeInstanceOf(Promise);
    manager.respondToPermission({ toolCallId: 'write-1', decision: 'deny' });
    await pending;
    expect(handlers.get('orchestrator:settings:save')!(null, { allowAllOperations: true }).success).toBe(true);
    expect(gate(request)).toEqual({ kind: 'approved' });
    const restored = createOrchestratorSettingsStore(cwd);
    expect(restored.load()).toEqual({ allowAllOperations: true });
    registerOrchestratorIpc({ manager, settingsStore: restored });
    expect(handlers.get('orchestrator:settings:get')!().settings).toEqual({ allowAllOperations: true });
    expect(gate(request)).toEqual({ kind: 'approved' });
  });

  it('rejects invalid IPC values and keeps the old gate when persistence fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { store, gate, request, manager } = fixture();
    const save = handlers.get('orchestrator:settings:save')!;
    expect(save(null, { allowAllOperations: 'true' }).success).toBe(false);
    vi.spyOn(store, 'save').mockImplementation(() => { throw new Error('Disk full'); });
    expect(save(null, { allowAllOperations: true })).toEqual({ success: false, error: 'Disk full' });
    const pending = gate(request);
    expect(pending).toBeInstanceOf(Promise);
    expect(handlers.get('orchestrator:settings:get')!().settings).toEqual({ allowAllOperations: false });
    manager.close();
    await pending;
  });

  it.each(['{"allowAllOperations":"true"}', '{"allowAllOperations":null}', '{broken'])(
    'fails closed and logs malformed persisted settings: %s',
    (contents) => {
      const error = vi.spyOn(console, 'error').mockImplementation(() => {});
      const { cwd, store } = fixture();
      fs.mkdirSync(path.join(cwd, '.data'), { recursive: true });
      fs.writeFileSync(path.join(cwd, '.data', 'orchestrator-settings.json'), contents);
      expect(store.load()).toEqual({ allowAllOperations: false });
      expect(error).toHaveBeenCalled();
    },
  );
});
