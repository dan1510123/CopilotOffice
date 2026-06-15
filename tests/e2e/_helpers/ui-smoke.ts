// Spec 008-smoke: high-level page actions for UI smoke tests.
//
// These helpers wrap the renderer-side window.__copilotOfficeDebug surface
// (installed only when COPILOT_E2E=1 is set in the Electron main process env).
// All actions are async and return after the renderer has had a chance to
// settle (status badges, terminal panel mode, dashboard cards).

import type { Page } from '@playwright/test';

export type AppMode = 'game' | 'serious';

export interface AgentInfo {
  id: string;
  name: string;
  tileX: number;
  tileY: number;
}

/** Wait until the e2e debug hook is installed on the renderer. */
export async function waitForDebugHook(page: Page, timeoutMs = 30_000): Promise<void> {
  await page.waitForFunction(
    () => typeof window.__copilotOfficeDebug === 'object'
      && window.__copilotOfficeDebug !== null,
    null,
    { timeout: timeoutMs },
  );
}

export async function getMode(page: Page): Promise<AppMode> {
  return page.evaluate(() => window.__copilotOfficeDebug!.getActiveMode());
}

export async function setMode(page: Page, mode: AppMode): Promise<void> {
  await page.evaluate((m) => window.__copilotOfficeDebug!.setMode(m), mode);
  // Settle: mode switching tears down/builds up Phaser and DOM panels.
  await page.waitForTimeout(300);
}

export async function listAgents(page: Page): Promise<AgentInfo[]> {
  return page.evaluate(() => window.__copilotOfficeDebug!.listAgents());
}

export async function getActiveTerminalAgentId(page: Page): Promise<string | null> {
  return page.evaluate(() => window.__copilotOfficeDebug!.getActiveTerminalAgentId());
}

export async function openAgentTerminal(page: Page, agentId: string): Promise<void> {
  await page.evaluate(
    (id) => window.__copilotOfficeDebug!.openAgentTerminal(id),
    agentId,
  );
  // Settle: terminalStart IPC + xterm attach.
  await page.waitForTimeout(500);
}

export async function closeActiveTerminal(page: Page): Promise<void> {
  await page.evaluate(() => window.__copilotOfficeDebug!.closeActiveTerminal());
  await page.waitForTimeout(200);
}

/**
 * Wait until getActiveTerminalAgentId() matches the expected id (or null).
 * Polls every 100ms up to `timeoutMs`. Throws with a clear message on timeout.
 */
export async function expectActiveTerminalAgent(
  page: Page,
  expected: string | null,
  timeoutMs = 5_000,
): Promise<void> {
  const start = Date.now();
  let observed: string | null = null;
  while (Date.now() - start < timeoutMs) {
    observed = await getActiveTerminalAgentId(page);
    if (observed === expected) return;
    await page.waitForTimeout(100);
  }
  throw new Error(
    `expectActiveTerminalAgent: expected="${expected}" observed="${observed}" after ${timeoutMs}ms`,
  );
}
