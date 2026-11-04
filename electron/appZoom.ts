import type { Input, WebContents } from 'electron';

export function handleAppZoom(
  webContents: Pick<WebContents, 'getZoomLevel' | 'setZoomLevel'>,
  input: Input,
): boolean {
  if (input.type !== 'keyDown' || !(input.control || input.meta) || input.alt) {
    return false;
  }

  const level = webContents.getZoomLevel();
  switch (input.key) {
    case '-':
    case '_':
      webContents.setZoomLevel(Math.max(-5, level - 0.5));
      return true;
    case '+':
    case '=':
      webContents.setZoomLevel(Math.min(5, level + 0.5));
      return true;
    case '0':
      webContents.setZoomLevel(0);
      return true;
    default:
      return false;
  }
}
