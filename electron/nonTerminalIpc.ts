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

import { BrowserWindow, clipboard, ipcMain, Notification } from 'electron';
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

  // Spec 003 follow-up: clipboard.writeText via Electron main process.
  //
  // navigator.clipboard.writeText in the renderer is fragile in Electron —
  // it requires the Permissions API to grant `clipboard-write` AND the
  // document to currently have focus. When xterm's <textarea> has focus,
  // the renderer-side write is silently rejected on many Windows builds.
  // The document.execCommand('copy') fallback also fails because xterm
  // intercepts selection events.
  //
  // The Electron main-process clipboard module talks directly to the OS
  // clipboard API and has no permission/focus restrictions. This handler
  // is the canonical copy path; renderer code calls it first.
  ipcMain.handle('clipboard-write-text', (_event, text: string) => {
    try {
      if (typeof text !== 'string') {
        return { success: false, error: 'text must be a string' };
      }
      clipboard.writeText(text);
      const verify = clipboard.readText();
      const matched = verify === text;
      console.log(`[Main/Clipboard] writeText len=${text.length} verify-matched=${matched}`);
      return { success: true, verified: matched };
    } catch (e) {
      console.warn('[Main/Clipboard] writeText threw', e);
      return { success: false, error: (e as Error)?.message || String(e) };
    }
  });

  ipcMain.handle('clipboard-read-text', () => {
    try {
      const text = clipboard.readText();
      console.log(`[Main/Clipboard] readText len=${text.length}`);
      return { success: true, text };
    } catch (e) {
      console.warn('[Main/Clipboard] readText threw', e);
      return { success: false, text: '', error: (e as Error)?.message || String(e) };
    }
  });
}
