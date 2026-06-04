// Non-terminal IPC handler registration (S2-F).
//
// Extracted from `electron/main.ts` so the renderer-facing contracts for
// `request-hard-reload`, `show-native-notification`, `save-offices`, and
// `load-offices` live in one place alongside the FS store they depend on.
// Terminal IPC stays in `electron/terminal/ipc-relay.ts` (S1-D scope).
//
// The handlers preserve the exact response shapes that the renderer's
// `OfficePersistencePort` (S2-A) and the `window.copilotBridge` surface
// already expect. No protocol changes.

import { BrowserWindow, ipcMain, Notification } from 'electron';
import type { OfficeFileStore } from './officeFileStore';

export interface NonTerminalIpcHooks {
  /** Returns the current main window (used to bring it to front on notification click). */
  getMainWindow: () => BrowserWindow | null;
  /** Called when the renderer requests a hard reload (Ctrl+Shift+R). */
  onHardReloadRequested: () => void;
  /** File-backed office store. */
  officeStore: OfficeFileStore;
}

/**
 * Wire the four non-terminal IPC handlers. Idempotent within a single Electron
 * session — each `ipcMain.handle` call replaces any prior handler for that
 * channel, so re-invoking this from a hot-reload path is safe.
 */
export function registerNonTerminalIpc(hooks: NonTerminalIpcHooks): void {
  ipcMain.handle('request-hard-reload', () => {
    console.log('[Main] Hard reload requested by renderer');
    hooks.onHardReloadRequested();
    return { success: true };
  });

  ipcMain.handle('show-native-notification', (_event, title: string, body: string) => {
    if (!Notification.isSupported()) return { success: false };
    const notification = new Notification({ title, body });
    notification.on('click', () => {
      // Bring the app window to front when notification is clicked.
      const win = hooks.getMainWindow();
      if (win) {
        if (win.isMinimized()) win.restore();
        win.focus();
      }
    });
    notification.show();
    return { success: true };
  });

  ipcMain.handle('save-offices', (_event, data: string) => {
    return hooks.officeStore.save(data);
  });

  ipcMain.handle('load-offices', () => {
    return hooks.officeStore.load();
  });
}
