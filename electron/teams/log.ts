// Centralized logger for the Teams Remote Agents service. All output goes to the
// Electron MAIN process stdout/stderr (the terminal that launched the app) — NOT
// the renderer DevTools console. One prefix, one place to change it.
//
// Never pass a bearer token to these — secrets must never be logged.

const PREFIX = '[TeamsRemote]';

export function tlog(...args: unknown[]): void {
  console.log(PREFIX, ...args);
}

export function twarn(...args: unknown[]): void {
  console.warn(PREFIX, ...args);
}

export function terror(...args: unknown[]): void {
  console.error(PREFIX, ...args);
}
