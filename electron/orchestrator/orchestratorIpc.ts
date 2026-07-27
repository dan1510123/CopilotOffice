// `orchestrator:*` IPC registration (spec 016 — T009, contracts/orchestrator-ipc.md).
//
// Wires the renderer bridge to the OrchestratorSessionManager and forwards the
// manager's main→renderer pushes to the active webContents. Modeled on
// electron/teams/teamsIpc.ts and registered from electron/main.ts.

import { ipcMain, BrowserWindow } from 'electron';
import type { OrchestratorSessionManager, OrchestratorEmitter } from './orchestratorSessionManager';
import type {
  ActiveAgentSnapshot,
  ActOnResult,
  AgentRecentOutput,
  AgentStatusLookup,
  AwaitingAgent,
  BringOnlineCandidate,
  BringOnlineResult,
  OfficeSummary,
  SwitchOfficeResult,
} from './types';

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
    emitOfficesRequest: (payload) => send('orchestrator:offices:request', payload),
    emitSwitchRequest: (payload) => send('orchestrator:switch:request', payload),
    // ── spec 017: new request channels ────────────────────────────────────────
    emitActiveAgentsRequest: (payload) => send('orchestrator:active-agents:request', payload),
    emitAwaitingAgentsRequest: (payload) => send('orchestrator:awaiting-agents:request', payload),
    emitAgentOutputRequest: (payload) => send('orchestrator:agent-output:request', payload),
    emitAgentStatusRequest: (payload) => send('orchestrator:agent-status:request', payload),
    emitAnswerAgentRequest: (payload) => send('orchestrator:answer-agent:request', payload),
    emitSendPromptRequest: (payload) => send('orchestrator:send-prompt:request', payload),
    emitStopAgentRequest: (payload) => send('orchestrator:stop-agent:request', payload),
    emitRestartAgentRequest: (payload) => send('orchestrator:restart-agent:request', payload),
    emitTeamsPresenceRequest: (payload) => send('orchestrator:teams-presence:request', payload),
    emitSetTitleRequest: (payload) => send('orchestrator:set-title:request', payload),
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

  ipcMain.handle('orchestrator:end', async (_e, _args: { sessionId: string }) => {
    await manager.endSession();
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

  ipcMain.handle(
    'orchestrator:offices:respond',
    (_e, args: { requestId: string; offices: OfficeSummary[] }) => {
      const ok = manager.respondOffices(args.requestId, args.offices ?? []);
      return { ok };
    },
  );

  ipcMain.handle(
    'orchestrator:switch:respond',
    (_e, args: { requestId: string; result: SwitchOfficeResult }) => {
      const ok = manager.respondSwitch(args.requestId, args.result);
      return { ok };
    },
  );

  // ── spec 017: read-only situational-awareness respond channels ─────────────
  ipcMain.handle(
    'orchestrator:active-agents:respond',
    (_e, args: { requestId: string; agents: ActiveAgentSnapshot[] }) => {
      const ok = manager.respondActiveAgents(args.requestId, args.agents ?? []);
      return { ok };
    },
  );

  ipcMain.handle(
    'orchestrator:awaiting-agents:respond',
    (_e, args: { requestId: string; agents: AwaitingAgent[] }) => {
      const ok = manager.respondAwaitingAgents(args.requestId, args.agents ?? []);
      return { ok };
    },
  );

  ipcMain.handle(
    'orchestrator:agent-output:respond',
    (_e, args: { requestId: string; output: AgentRecentOutput }) => {
      const ok = manager.respondAgentOutput(args.requestId, args.output);
      return { ok };
    },
  );

  ipcMain.handle(
    'orchestrator:agent-status:respond',
    (_e, args: { requestId: string; lookup: AgentStatusLookup }) => {
      const ok = manager.respondAgentStatus(args.requestId, args.lookup);
      return { ok };
    },
  );

  // ── spec 017: gated act-on respond channels (all resolve the shared map) ────
  const respondActOn = (_e: unknown, args: { requestId: string; result: ActOnResult }) => {
    const ok = manager.respondActOn(args.requestId, args.result);
    return { ok };
  };
  ipcMain.handle('orchestrator:answer-agent:respond', respondActOn);
  ipcMain.handle('orchestrator:send-prompt:respond', respondActOn);
  ipcMain.handle('orchestrator:stop-agent:respond', respondActOn);
  ipcMain.handle('orchestrator:restart-agent:respond', respondActOn);
  ipcMain.handle('orchestrator:teams-presence:respond', respondActOn);
  ipcMain.handle('orchestrator:set-title:respond', respondActOn);

  // ── spec 017: transcript restore (pure read; never mutates a session) ──────
  ipcMain.handle('orchestrator:transcript:get', (_e, _args: { sessionId?: string }) => {
    return { transcript: manager.getTranscript() };
  });
}
