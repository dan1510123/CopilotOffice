// T017 — `teams:*` IPC registration. Wires the renderer bridge to the TeamsService,
// and forwards status/toast events to the renderer webContents.
//
// Registered from electron/main.ts (like registerNonTerminalIpc) so the TeamsService
// dependency stays out of TerminalRelay.

import { ipcMain, BrowserWindow } from 'electron';
import type { TeamsService, RegisterContext } from './teamsService';
import type { TeamsSettingsStore } from './teamsSettingsStore';
import { normalizeTeamsSettings } from './teamsSettingsStore';
import { parseChannelLink } from './channelLink';
import type { TeamsSettings } from './types';

export interface TeamsIpcHooks {
  service: TeamsService;
  settingsStore: TeamsSettingsStore;
  getMainWindow: () => BrowserWindow | null;
  /** Called after settings are saved so the service can react (e.g. restart source). */
  onSettingsChanged?: (settings: TeamsSettings) => void;
}

export function registerTeamsIpc(hooks: TeamsIpcHooks): void {
  const { service, settingsStore } = hooks;

  ipcMain.handle('teams:status', (_e, args: { officeId?: string; agentId?: string }) => {
    if (args?.officeId && args?.agentId) {
      const status = service.getStatus(args.officeId, args.agentId);
      return { success: true, connected: !!status?.online, bindings: status ? [status] : [] };
    }
    const bindings = service.getStatuses();
    return { success: true, connected: bindings.some((b) => b.online), bindings };
  });

  ipcMain.handle('teams:register', (_e, ctx: RegisterContext) => service.register(ctx));

  ipcMain.handle('teams:stop', (_e, args: { officeId: string; agentId: string }) =>
    service.goOffline(args.officeId, args.agentId, true),
  );

  ipcMain.handle('teams:getSettings', () => {
    return { success: true, settings: settingsStore.load() };
  });

  ipcMain.handle('teams:saveSettings', (_e, args: { settings: Partial<TeamsSettings> }) => {
    const settings = normalizeTeamsSettings(args?.settings);
    // Validate the default channel deep-link if provided.
    let parsed: { teamId: string; channelId: string; tenantId: string } | undefined;
    if (settings.defaultChannelUrl.trim()) {
      const coords = parseChannelLink(settings.defaultChannelUrl);
      if (!coords) {
        return { success: false, error: 'The default channel link could not be parsed.' };
      }
      parsed = coords;
    }
    settingsStore.save(settings);
    hooks.onSettingsChanged?.(settings);
    return { success: true, parsed };
  });
}

/** Emit a per-agent status change to the renderer. */
export function makeStatusEmitter(getWindow: () => BrowserWindow | null) {
  return (status: unknown) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('teams:status:changed', status);
  };
}

/** Emit a toast to the renderer. */
export function makeToastEmitter(getWindow: () => BrowserWindow | null) {
  return (toast: unknown) => {
    const win = getWindow();
    if (win && !win.isDestroyed()) win.webContents.send('teams:toast', toast);
  };
}
