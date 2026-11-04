import type { BrowserWindow } from 'electron';
import { pathToFileURL } from 'url';

export function isAppMicrophoneRequest(
  expectedUrl: string,
  actualUrl: string,
  mediaTypes: string[],
): boolean {
  return actualUrl === expectedUrl && mediaTypes.length === 1 && mediaTypes[0] === 'audio';
}

export function registerVoicePermissions(window: BrowserWindow, htmlPath: string): void {
  const expectedUrl = pathToFileURL(htmlPath).href;
  const session = window.webContents.session;
  session.setPermissionCheckHandler((contents, permission, _origin, details) =>
    contents === window.webContents && permission === 'media' &&
    details.isMainFrame &&
    isAppMicrophoneRequest(expectedUrl, details.requestingUrl ?? '', details.mediaType ? [details.mediaType] : []),
  );
  session.setPermissionRequestHandler((contents, permission, callback, details) => {
    callback(contents === window.webContents && permission === 'media' &&
      details.isMainFrame && 'mediaTypes' in details &&
      isAppMicrophoneRequest(expectedUrl, details.requestingUrl, details.mediaTypes ?? []));
  });
}
