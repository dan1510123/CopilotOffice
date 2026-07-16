// `orchestrator:*` IPC registration (spec 016 — T009, contracts/orchestrator-ipc.md).
//
// Wires the renderer bridge to the OrchestratorSessionManager and forwards the
// manager's main→renderer pushes to the active webContents. Modeled on
// electron/teams/teamsIpc.ts and registered from electron/main.ts.

import { ipcMain, BrowserWindow } from 'electron';
import type { OrchestratorSessionManager, OrchestratorEmitter } from './orchestratorSessionManager';
import type { BringOnlineCandidate, BringOnlineResult } from './types';

export interface OrchestratorIpcHooks {
  manager: OrchestratorSessionManager;
}

/** Build the emitter the manager uses to push to the renderer. */
export function makeOrchestratorEmitter(getWindow: () => BrowserWindow | null): OrchestratorEmitter {
  const send = (channel: string, payload: unknown): void => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send(channel, payload);
  };
  return {
    emitEvent: (sessionId, event) => send('orchestrator:event', { sessionId, event }),
    emitPermissionRequest: (payload) => send('orchestrator:permission:request', payload),
    emitCandidatesRequest: (payload) => send('orchestrator:candidates:request', payload),
    emitExecuteRequest: (payload) => send('orchestrator:execute:request', payload),
    emitExit: (payload) => send('orchestrator:exit', payload),
  };
}

export function registerOrchestratorIpc(hooks: OrchestratorIpcHooks): void {
  const { manager } = hooks;

  ipcMain.handle('orchestrator:open', async () => {
    try {
      const info = await manager.open();
      return { sessionId: info.sessionId, lifecycle: info.lifecycle };
    } catch (err) {
      return { sessionId: '', lifecycle: 'error', error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('orchestrator:input', async (_e, args: { sessionId: string; text: string }) => {
    try {
      await manager.submitInput(args?.text ?? '');
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle(
    'orchestrator:permission:respond',
    (_e, args: { sessionId: string; toolCallId: string; decision: 'approve' | 'deny' }) => {
      const ok = manager.respondToPermission({ toolCallId: args.toolCallId, decision: args.decision });
      return { ok };
    },
  );

  ipcMain.handle('orchestrator:close', (_e, _args: { sessionId: string }) => {
    manager.close();
    return { ok: true };
  });

  ipcMain.handle(
    'orchestrator:candidates:respond',
    (_e, args: { requestId: string; candidates: BringOnlineCandidate[] }) => {
      const ok = manager.respondCandidates(args.requestId, args.candidates ?? []);
      return { ok };
    },
  );

  ipcMain.handle(
    'orchestrator:execute:respond',
    (_e, args: { requestId: string; result: BringOnlineResult }) => {
      const ok = manager.respondExecute(args.requestId, args.result);
      return { ok };
    },
  );
}
