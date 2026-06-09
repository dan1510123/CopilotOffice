// Playwright cold-start helper (feature 002, T006).
//
// Wipes the workspace `.data/` directory, launches the built Electron app via
// `_electron.launch`, finds the renderer window, and returns a Page plus
// accessors for main-process console output. Skips the test when the
// `CI_E2E_BLOCKED` env var is set so the suite degrades cleanly on runners
// that cannot host Electron + xterm + clipboard permissions.

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  _electron as electron,
  test,
  type ElectronApplication,
  type Page,
} from '@playwright/test';

const E2E_BLOCKED_REASON =
  'env-blocked: CI_E2E_BLOCKED=1 — Electron + xterm + clipboard cannot be hosted on this runner';

export function skipIfEnvBlocked(): void {
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  test.skip(process.env.CI_E2E_BLOCKED === '1', E2E_BLOCKED_REASON);
}

/** Wipe the workspace `.data/` directory so the next launch is a true cold start. */
export function wipeWorkspaceDataDir(): void {
  const dataDir = path.join(process.cwd(), '.data');
  if (fs.existsSync(dataDir)) {
    fs.rmSync(dataDir, { recursive: true, force: true });
  }
}

/**
 * Boot the Electron app cold and return a Page once the renderer window is up.
 * Caller is responsible for calling `app.close()` (typically in a finally
 * block). Captures main-process console output for forensic assertions —
 * retrieve it via `getMainProcessLog()`.
 *
 * Pass `env: { COPILOT_E2E: '1', ... }` to inject env vars into the Electron
 * main process. This is how spec 008-smoke turns on the debug hook and forces
 * `launchMode: 'shell'` for all PTY spawns.
 */
export async function bootColdOffice(options?: {
  env?: Record<string, string>;
}): Promise<{
  app: ElectronApplication;
  page: Page;
  getMainProcessLog: () => string;
}> {
  wipeWorkspaceDataDir();

  const mainLog: string[] = [];
  // Strip ELECTRON_RUN_AS_NODE — when set in the inherited shell env it forces
  // electron.exe to launch as plain Node, which breaks Playwright's electron
  // launcher with an opaque "Process failed to launch" message.
  const envWithoutNodeMode: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    if (typeof v === 'string') envWithoutNodeMode[k] = v;
  }
  const app = await electron.launch({
    args: [path.resolve(process.cwd())],
    timeout: 60_000,
    env: {
      ...envWithoutNodeMode,
      ...(options?.env ?? {}),
    },
  });
  app.process().stdout?.on('data', (chunk: Buffer) => {
    mainLog.push(chunk.toString('utf8'));
  });
  app.process().stderr?.on('data', (chunk: Buffer) => {
    mainLog.push(chunk.toString('utf8'));
  });

  const page = await findRendererWindow(app);
  await page.waitForSelector('#office-tabs', { timeout: 60_000 });
  await page.waitForSelector('#status-bar', { timeout: 60_000 });

  return { app, page, getMainProcessLog: () => mainLog.join('') };
}

async function findRendererWindow(app: ElectronApplication): Promise<Page> {
  const timeoutAt = Date.now() + 60_000;
  while (Date.now() < timeoutAt) {
    for (const page of app.windows()) {
      try {
        if (await page.locator('#game-container').count()) {
          return page;
        }
      } catch {
        // ignore devtools/non-renderer windows and keep searching
      }
    }
    try {
      await app.waitForEvent('window', { timeout: 1000 });
    } catch {
      // keep polling until timeout
    }
  }
  throw new Error('Renderer window not found within timeout');
}

/** Read the workspace `.data/office-0.sessions.json` (or null if missing). */
export function readOfficeSessions(officeId: string = 'office-0'): {
  current: Record<string, string>;
} | null {
  const filePath = path.join(process.cwd(), '.data', `${officeId}.sessions.json`);
  if (!fs.existsSync(filePath)) return null;
  return JSON.parse(fs.readFileSync(filePath, 'utf8'));
}
