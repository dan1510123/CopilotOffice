import * as fs from 'node:fs';
import * as path from 'node:path';
import { _electron as electron, expect, test, type ElectronApplication } from '@playwright/test';
import { DEFAULT_AGENTS, DEFAULT_RESERVE_MAP } from '../../src/config/agents';

test('Ringleader background activation persists another office seat without switching or claiming raw-shell readiness', async ({}, testInfo) => {
  test.setTimeout(90_000);
  fs.mkdirSync(testInfo.outputDir, { recursive: true });
  const workspace = fs.mkdtempSync(path.join(testInfo.outputDir, 'workspace-'));
  const dataDir = path.join(workspace, '.data');
  fs.mkdirSync(dataDir);
  const home = path.join(workspace, 'home');
  const profile = path.join(workspace, 'profile');
  const appData = path.join(home, 'AppData', 'Roaming');
  const localAppData = path.join(home, 'AppData', 'Local');
  for (const dir of [home, profile, appData, localAppData]) fs.mkdirSync(dir, { recursive: true });
  const [deskId, defaultReserve] = Object.entries(DEFAULT_RESERVE_MAP)[0];
  const officeId = 'office-2';
  const agentId = 'office-2-reserve-0';
  fs.writeFileSync(path.join(dataDir, 'copilot-offices.json'), JSON.stringify({
    currentOfficeId: 'office-0',
    offices: [
      { id: 'office-0', name: 'Main Office', workingDirectory: workspace, layout: 'default', createdAt: 1, seatedAgents: [] },
      {
        id: officeId, name: 'Background Office', workingDirectory: workspace, layout: 'default', createdAt: 2, seatedAgents: [],
        customAgents: [{ ...DEFAULT_AGENTS[0], id: 'office-2-agent-0', name: 'Background Core' }],
        customReserveAgents: { [deskId]: { ...defaultReserve, id: agentId, name: 'Background Reserve' } },
      },
    ],
  }));
  fs.writeFileSync(path.join(dataDir, 'teams-settings.json'), JSON.stringify({ enabled: false }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key, value]) =>
    key !== 'ELECTRON_RUN_AS_NODE' && typeof value === 'string')) as Record<string, string>;
  const logs: string[] = [];
  let app: ElectronApplication | undefined;
  try {
    await test.step('launch isolated Electron app', async () => {
      app = await electron.launch({
        args: [path.resolve(process.cwd()), `--user-data-dir=${profile}`],
        cwd: workspace,
        env: { ...env, HOME: home, USERPROFILE: home, APPDATA: appData, LOCALAPPDATA: localAppData,
          COPILOT_E2E: '1', COPILOT_TERMINAL_BACKEND: 'node-pty',
          COPILOT_OFFICE_ENABLE_WATCHER: '0', COPILOT_OFFICE_OPEN_DEVTOOLS: '0' },
        timeout: 20_000,
      });
      app.process().stdout?.on('data', (chunk: Buffer) => logs.push(`[stdout] ${chunk.toString('utf8')}`));
      app.process().stderr?.on('data', (chunk: Buffer) => logs.push(`[stderr] ${chunk.toString('utf8')}`));
      app.on('console', (message) => logs.push(`[main:${message.type()}] ${message.text()}`));
      expect(await app.evaluate(({ app }) => app.getPath('userData'))).toBe(profile);
      expect(await app.evaluate(() => process.cwd())).toBe(workspace);
    });
    if (!app) throw new Error('Electron launch did not return an application');
    const page = await app.firstWindow();
    page.on('console', (message) => logs.push(`[renderer:${message.type()}] ${message.text()}`));
    page.on('pageerror', (error) => logs.push(`[pageerror] ${error.stack ?? error.message}`));
    await page.waitForSelector('#office-tabs', { timeout: 15_000 });
    await expect(page.locator('#terminal-subtitle')).toContainText('Main Office');
    await expect.poll(() => page.evaluate(() => window.__copilotOfficeDebug!.getCurrentOfficeId()))
      .toBe('office-0');
    await page.evaluate(() => window.__copilotOfficeDebug!.setAutoStartEnabled(false));
    const captureProjection = async (phase: string) => {
      const renderer = await page.evaluate(async (officeId) => {
        const debug = window.__copilotOfficeDebug!;
        const offices = await window.copilotBridge.loadOffices();
        return {
          currentOfficeId: debug.getCurrentOfficeId(),
          mode: debug.getActiveMode(),
          roster: debug.listAgents(),
          activeTerminalAgentId: debug.getActiveTerminalAgentId(),
          autoStartEnabled: debug.getAutoStartEnabled(),
          officeState: offices.data ? JSON.parse(offices.data) : offices,
          candidates: await window.copilotBridge.orchestratorListCandidates(officeId),
          runtime: await window.copilotBridge.queryAgentStatuses(officeId),
          cards: Array.from(document.querySelectorAll('.agent-card')).map((card) => ({
            agentId: card.getAttribute('data-agent'),
            alternateAgentId: card.getAttribute('data-agent-id'),
            visible: !!(card as HTMLElement).offsetWidth,
            text: card.textContent?.slice(0, 300),
          })),
        };
      }, officeId);
      const snapshot = {
        phase, target: { officeId, agentId, deskId },
        fixtureReserve: { ...defaultReserve, id: agentId, name: 'Background Reserve' },
        renderer,
        persisted: JSON.parse(fs.readFileSync(path.join(dataDir, 'copilot-offices.json'), 'utf8')),
      };
      await testInfo.attach(`projection-${phase}`, {
        body: JSON.stringify(snapshot, null, 2), contentType: 'application/json',
      });
      return snapshot;
    };
    await captureProjection('before-activation');
    const foregroundBefore = await page.evaluate(() => window.__copilotOfficeDebug!.getActiveTerminalAgentId());
    const before = await page.evaluate((id) => window.copilotBridge.orchestratorListCandidates(id), officeId);
    expect(before.some((a) => a.agentId === agentId && a.officeId === officeId)).toBe(true);
    expect(await page.evaluate(({ officeId, agentId }) =>
      window.copilotBridge.terminalExists(officeId, agentId), { officeId, agentId })).toBe(false);

    const result = await test.step('activate reserve in background and reject raw-shell readiness', () =>
      page.evaluate(async ({ officeId, agentId }) =>
        window.copilotBridge.activateAgent(officeId, agentId), { officeId, agentId }));
    expect(result.outcome).toBe('failed');
    expect(result.message).toContain('programmatic session control');
    await expect(page.locator('#terminal-subtitle')).toContainText('Main Office');
    await expect(page.locator('#office-panel')).toBeVisible();
    await expect(page.locator('#terminal-panel')).toBeVisible();
    expect(await page.evaluate(() => window.__copilotOfficeDebug!.getCurrentOfficeId())).toBe('office-0');
    expect(await page.evaluate(() => window.__copilotOfficeDebug!.getActiveTerminalAgentId())).toBe(foregroundBefore);

    const persisted = JSON.parse(fs.readFileSync(path.join(dataDir, 'copilot-offices.json'), 'utf8'));
    expect(persisted.currentOfficeId).toBe('office-0');
    expect(persisted.offices.find((o: { id: string }) => o.id === officeId).seatedAgents)
      .toContainEqual({ deskId, agentId });
    const sessionId = await page.evaluate(({ officeId, agentId }) =>
      window.copilotBridge.getSessionId(officeId, agentId), { officeId, agentId });
    // E2E shell mode deliberately uses an ephemeral PTY id, never a persisted Copilot session.
    expect(sessionId).toBeNull();
    expect(result.ready).not.toBe(true);
    const runtime = await page.evaluate((id) => window.copilotBridge.queryAgentStatuses(id), officeId);
    expect(runtime[agentId]?.alive ?? false).toBe(false);
    expect(await page.evaluate(({ officeId, agentId }) =>
      window.copilotBridge.terminalExists(officeId, agentId), { officeId, agentId })).toBe(false);
    expect((await page.evaluate((id) => window.copilotBridge.orchestratorListCandidates(id), officeId))
      .some((agent) => agent.agentId === agentId)).toBe(true);
    const launchLines = logs.filter((line) => line.startsWith('[stdout]'))
      .join('').split('\n').filter((line) => line.includes(`[workingDir] ${officeId}:${agentId}: terminalStart`));
    expect(launchLines).toHaveLength(1);
    expect(launchLines[0]).toContain(`finalCwd="${workspace}"`);
    await captureProjection('before-switch');

    await page.locator('.office-tab', { hasText: 'Background Office' }).click();
    await expect(page.locator('#terminal-subtitle')).toContainText('Background Office');
    await captureProjection('after-switch');
    try {
      await expect.poll(() => page.evaluate(() => window.__copilotOfficeDebug!.listAgents().map((agent) => agent.id)))
        .toContain(agentId);
      await expect(page.locator(`.agent-card[data-agent="${agentId}"]`).first()).toBeVisible();
    } finally {
      await captureProjection('after-projection-check');
    }
    expect((await page.evaluate(() => window.copilotBridge.listActiveTerminals()))
      .filter((id) => id === agentId)).toHaveLength(0);
  } catch (error) {
    console.error(`Isolated Electron failure:\n${logs.join('').slice(-20_000)}`);
    throw error;
  } finally {
    try {
      if (app) {
        await test.step('close isolated Electron app', async () => {
          app!.context().setDefaultTimeout(10_000);
          await app!.close();
        });
      }
    } finally {
      await testInfo.attach('electron-log', { body: logs.join('\n'), contentType: 'text/plain' });
      fs.rmSync(workspace, { recursive: true, force: true });
    }
  }
});
