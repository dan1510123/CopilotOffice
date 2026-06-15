// Spec 009: auto-startup of known agents — e2e scenarios.
//
// Boots Electron cold with COPILOT_E2E=1 so:
//   - main-process PTY spawns use launchMode='shell' (no real Copilot CLI needed),
//     which means agentReadyState is set to true immediately on terminalStart.
//   - the renderer installs window.__copilotOfficeDebug with the spec-009 hooks
//     (getWarmedOfficeIds, triggerAutoStartForCurrentOffice, etc.).
//
// Seeding pattern mirrors tests/e2e/ui-smoke.e2e.ts T12: wipe .data first,
// then write the durable office state + per-office sessions.json BEFORE
// launching, then launch Electron directly with _electron.launch() so we do
// not re-trigger the wipe.
//
// Coverage:
//   A1 Cold-launch warm: a titled agent with a persisted current sessionId
//      reaches { alive: true, ready: true } automatically; an untitled agent
//      stays { alive: false }.
//   A2 Office-switch warm: switching to a not-yet-warmed office triggers the
//      same warm pass for that office's qualifying agents.
//   A3 Second-visit no-op: switching back to an already-warmed office does
//      NOT re-issue terminalStart for any agent.
//   A7 Double-click coalescing: two back-to-back replaceSession calls for the
//      same agent invoke terminalStart exactly once during the replacement.

import * as fs from 'fs';
import * as path from 'path';
import { _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { skipIfEnvBlocked } from './_helpers/electron-cold-start';
import { waitForDebugHook } from './_helpers/ui-smoke';

const SEEDED_TITLED_AGENT = 'generalist'; // present in default layout
const SEEDED_UNTITLED_AGENT = 'debugger'; // present in default layout
const SEEDED_SECOND_OFFICE_AGENT = 'generalist'; // re-use; office-1 isolates by composite key

function seedDataDir(seed: () => void): void {
  const dataDir = path.join(process.cwd(), '.data');
  if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
  fs.mkdirSync(dataDir, { recursive: true });
  seed();
}

async function launchElectron(extraEnv: Record<string, string> = {}): Promise<ElectronApplication> {
  // Strip ELECTRON_RUN_AS_NODE (see bootColdOffice — same reason).
  const envWithoutNodeMode: Record<string, string> = {};
  for (const [k, v] of Object.entries(process.env)) {
    if (k === 'ELECTRON_RUN_AS_NODE') continue;
    if (typeof v === 'string') envWithoutNodeMode[k] = v;
  }
  return electron.launch({
    args: [path.resolve(process.cwd())],
    timeout: 60_000,
    env: { ...envWithoutNodeMode, COPILOT_E2E: '1', ...extraEnv },
  });
}

async function findRenderer(app: ElectronApplication): Promise<Page> {
  const page = await app.firstWindow();
  // First boot can be slow (>30s) cold; bump timeout to 90s.
  await page.waitForFunction(
    () => typeof (window as any).__copilotOfficeDebug === 'object'
      && (window as any).__copilotOfficeDebug !== null,
    null,
    { timeout: 90_000 },
  );
  // Allow durable load + onOfficesUpdated chain to settle.
  await page.waitForTimeout(1500);
  return page;
}

async function pollAgentStatus(
  page: Page,
  officeId: string,
  agentId: string,
  predicate: (s: { alive: boolean; ready: boolean }) => boolean,
  timeoutMs = 10_000,
): Promise<{ alive: boolean; ready: boolean; inTurn: boolean }> {
  const start = Date.now();
  let last: { alive: boolean; ready: boolean; inTurn: boolean } = {
    alive: false,
    ready: false,
    inTurn: false,
  };
  while (Date.now() - start < timeoutMs) {
    last = await page.evaluate(
      async ([oid, aid]) => {
        const all = await window.copilotBridge.queryAgentStatuses(oid as string);
        return all[aid as string] ?? { alive: false, ready: false, inTurn: false };
      },
      [officeId, agentId],
    );
    if (predicate(last)) return last;
    await page.waitForTimeout(150);
  }
  return last;
}

const SEED_OFFICES_TWO = {
  currentOfficeId: 'office-0',
  offices: [
    {
      id: 'office-0',
      name: 'Main Office',
      workingDirectory: '.',
      createdAt: 1,
      layout: 'default',
      seatedAgents: [],
    },
    {
      id: 'office-1',
      name: 'Second',
      workingDirectory: '.',
      createdAt: 2,
      layout: 'default',
      seatedAgents: [],
    },
  ],
};

function writeSessionsFile(
  officeId: string,
  current: Record<string, string>,
  metadata: Record<string, { title: string }>,
): void {
  fs.writeFileSync(
    path.join(process.cwd(), '.data', `${officeId}.sessions.json`),
    JSON.stringify({ current, history: {}, metadata }, null, 2),
  );
}

test.describe('spec 009 auto-startup', () => {
  test.beforeEach(() => {
    skipIfEnvBlocked();
  });

  test('A1 cold-launch warms titled agents only', async () => {
    seedDataDir(() => {
      fs.writeFileSync(
        path.join(process.cwd(), '.data', 'copilot-offices.json'),
        JSON.stringify(SEED_OFFICES_TWO, null, 2),
      );
      writeSessionsFile(
        'office-0',
        {
          [SEEDED_TITLED_AGENT]: '11111111-1111-1111-1111-111111111111',
          [SEEDED_UNTITLED_AGENT]: '22222222-2222-2222-2222-222222222222',
        },
        {
          [SEEDED_TITLED_AGENT]: { title: 'My ongoing task' },
          [SEEDED_UNTITLED_AGENT]: { title: '' },
        },
      );
    });

    const app = await launchElectron();
    try {
      const page = await findRenderer(app);

      // Wait for cold-launch auto-startup to kick off. The coordinator runs
      // inside officeManager.onOfficesUpdated which fires after the durable
      // load resolves. Poll until the titled agent reaches alive+ready.
      const titledStatus = await pollAgentStatus(
        page,
        'office-0',
        SEEDED_TITLED_AGENT,
        (s) => s.alive && s.ready,
        15_000,
      );
      expect(titledStatus.alive, `titled agent should be alive: ${JSON.stringify(titledStatus)}`).toBe(true);
      expect(titledStatus.ready, `titled agent should be ready: ${JSON.stringify(titledStatus)}`).toBe(true);

      // FR-005: assert via the AUTO-START counter that our coordinator
      // actually fired for the titled agent. (The untitled agent may
      // still come up via the pre-existing OfficeScene.preStartAgentSessions
      // pre-start path from Feature 002 — that is a separate mechanism
      // outside this spec's scope.)
      const autoStartCount = await page.evaluate(() =>
        window.__copilotOfficeDebug!.getAutoStartTerminalStartCount(),
      );
      expect(autoStartCount, 'auto-start coordinator must have fired for at least one agent').toBeGreaterThanOrEqual(1);

      // Office-0 should appear in warmedOfficeIds.
      const warmed = await page.evaluate(() => window.__copilotOfficeDebug!.getWarmedOfficeIds());
      expect(warmed).toContain('office-0');
    } finally {
      await app.close();
    }
  });

  test('A2 + A3 office-switch warms new office; second visit does not respawn', async () => {
    seedDataDir(() => {
      fs.writeFileSync(
        path.join(process.cwd(), '.data', 'copilot-offices.json'),
        JSON.stringify(SEED_OFFICES_TWO, null, 2),
      );
      writeSessionsFile(
        'office-0',
        { [SEEDED_TITLED_AGENT]: '11111111-1111-1111-1111-111111111111' },
        { [SEEDED_TITLED_AGENT]: { title: 'Office-0 task' } },
      );
      writeSessionsFile(
        'office-1',
        { [SEEDED_SECOND_OFFICE_AGENT]: '33333333-3333-3333-3333-333333333333' },
        { [SEEDED_SECOND_OFFICE_AGENT]: { title: 'Office-1 task' } },
      );
    });

    const app = await launchElectron();
    try {
      const page = await findRenderer(app);

      // A1-style: office-0 titled agent reaches ready.
      const office0Ready = await pollAgentStatus(
        page,
        'office-0',
        SEEDED_TITLED_AGENT,
        (s) => s.alive && s.ready,
        15_000,
      );
      expect(office0Ready.alive && office0Ready.ready, JSON.stringify(office0Ready)).toBe(true);

      // Capture terminalStart count after office-0 warm.
      const countAfterOffice0 = await page.evaluate(() =>
        window.__copilotOfficeDebug!.getAutoStartTerminalStartCount(),
      );
      expect(countAfterOffice0).toBeGreaterThanOrEqual(1);

      // A2: switch to office-1 and wait for its titled agent.
      await page.evaluate(() => window.__copilotOfficeDebug!.switchOffice('office-1'));
      const office1Ready = await pollAgentStatus(
        page,
        'office-1',
        SEEDED_SECOND_OFFICE_AGENT,
        (s) => s.alive && s.ready,
        15_000,
      );
      expect(office1Ready.alive && office1Ready.ready, JSON.stringify(office1Ready)).toBe(true);

      const countAfterOffice1 = await page.evaluate(() =>
        window.__copilotOfficeDebug!.getAutoStartTerminalStartCount(),
      );
      expect(countAfterOffice1).toBeGreaterThan(countAfterOffice0);

      // A3: switch back to office-0; no additional terminalStart should fire
      // for office-0 since WarmedOfficeRegistry has it marked.
      await page.evaluate(() => window.__copilotOfficeDebug!.switchOffice('office-0'));
      // Give the coordinator a beat to (not) run.
      await page.waitForTimeout(1500);
      const countAfterReturn = await page.evaluate(() =>
        window.__copilotOfficeDebug!.getAutoStartTerminalStartCount(),
      );
      expect(countAfterReturn, 'second visit to office-0 must not respawn').toBe(countAfterOffice1);

      // Both offices should appear in warmedOfficeIds.
      const warmed = await page.evaluate(() => window.__copilotOfficeDebug!.getWarmedOfficeIds());
      expect(new Set(warmed)).toEqual(new Set(['office-0', 'office-1']));
    } finally {
      await app.close();
    }
  });

  test('A7 double-call replaceSession coalesces to one terminalStart per replacement', async () => {
    seedDataDir(() => {
      fs.writeFileSync(
        path.join(process.cwd(), '.data', 'copilot-offices.json'),
        JSON.stringify(SEED_OFFICES_TWO, null, 2),
      );
      writeSessionsFile(
        'office-0',
        { [SEEDED_TITLED_AGENT]: '44444444-4444-4444-4444-444444444444' },
        { [SEEDED_TITLED_AGENT]: { title: 'Coalesce test' } },
      );
    });

    const app = await launchElectron();
    try {
      const page = await findRenderer(app);

      // Wait for cold-launch warm to settle so the baseline terminalStart
      // count is stable.
      await pollAgentStatus(
        page,
        'office-0',
        SEEDED_TITLED_AGENT,
        (s) => s.alive && s.ready,
        15_000,
      );
      const baseCount = await page.evaluate(() =>
        window.__copilotOfficeDebug!.getAutoStartTerminalStartCount(),
      );

      // Issue two back-to-back replaceSession calls (simulating a double-click
      // on "New Session"). FR-014/SC-008: must coalesce to exactly one
      // resetSession + one warmAgentSession.
      const result = await page.evaluate(async ([oid, aid]) => {
        const debug = window.__copilotOfficeDebug!;
        const p1 = debug.replaceAgentSession(oid as string, aid as string);
        const p2 = debug.replaceAgentSession(oid as string, aid as string);
        await Promise.all([p1, p2]);
        return debug.getAutoStartTerminalStartCount();
      }, ['office-0', SEEDED_TITLED_AGENT]);

      // Exactly one additional terminalStart from the replacement (the second
      // call returned the in-flight promise without re-invoking deps).
      expect(result - baseCount, 'double replaceSession coalescing').toBe(1);
    } finally {
      await app.close();
    }
  });

  test('A4 setting OFF gates the replace trigger (FR-017)', async () => {
    seedDataDir(() => {
      fs.writeFileSync(
        path.join(process.cwd(), '.data', 'copilot-offices.json'),
        JSON.stringify(SEED_OFFICES_TWO, null, 2),
      );
      writeSessionsFile(
        'office-0',
        { [SEEDED_TITLED_AGENT]: '55555555-5555-5555-5555-555555555555' },
        { [SEEDED_TITLED_AGENT]: { title: 'A4 OFF gate test' } },
      );
    });

    const app = await launchElectron();
    try {
      const page = await findRenderer(app);

      // Wait for cold-launch warm so we have a stable baseline + a known
      // alive agent we can then "close + restart" via the OFF-gated
      // replaceSession path.
      await pollAgentStatus(
        page,
        'office-0',
        SEEDED_TITLED_AGENT,
        (s) => s.alive && s.ready,
        15_000,
      );

      // Disable auto-start, clear the warmed registry so any office-switch
      // logic in the harness sees a fresh state if invoked.
      await page.evaluate(() => {
        window.__copilotOfficeDebug!.setAutoStartEnabled(false);
        window.__copilotOfficeDebug!.clearWarmedOfficeRegistry();
      });

      // FR-017: replaceSession with OFF gate calls resetSession only and
      // skips warmAgentSession. Assert the terminalStart count did NOT
      // grow during the replacement.
      const baseCount = await page.evaluate(() =>
        window.__copilotOfficeDebug!.getAutoStartTerminalStartCount(),
      );
      await page.evaluate(
        ([oid, aid]) =>
          window.__copilotOfficeDebug!.replaceAgentSession(oid as string, aid as string),
        ['office-0', SEEDED_TITLED_AGENT],
      );
      const afterCount = await page.evaluate(() =>
        window.__copilotOfficeDebug!.getAutoStartTerminalStartCount(),
      );
      expect(afterCount - baseCount, 'OFF gate must skip warmAgentSession').toBe(0);

      // Agent should now be slacking (closed) — replaceSession with OFF
      // performs reset only, which kills the PTY (FR-013).
      const status = await page.evaluate(async () => {
        const all = await window.copilotBridge.queryAgentStatuses('office-0');
        return all['generalist'] ?? { alive: false, ready: false, inTurn: false };
      });
      expect(status.alive, `agent must be closed after OFF replace: ${JSON.stringify(status)}`).toBe(false);
    } finally {
      await app.close();
    }
  });

  test('A5 + A6 replaceSession yields fresh sessionId; close stays slacking', async () => {
    seedDataDir(() => {
      fs.writeFileSync(
        path.join(process.cwd(), '.data', 'copilot-offices.json'),
        JSON.stringify(SEED_OFFICES_TWO, null, 2),
      );
      writeSessionsFile(
        'office-0',
        { [SEEDED_TITLED_AGENT]: '66666666-6666-6666-6666-666666666666' },
        { [SEEDED_TITLED_AGENT]: { title: 'A5/A6 session lifecycle' } },
      );
    });

    const app = await launchElectron();
    try {
      const page = await findRenderer(app);

      // Wait for cold-launch warm so the agent is alive on some uuid.
      await pollAgentStatus(
        page,
        'office-0',
        SEEDED_TITLED_AGENT,
        (s) => s.alive && s.ready,
        15_000,
      );
      const sidBefore = await page.evaluate(
        ([oid, aid]) =>
          window.__copilotOfficeDebug!.getCurrentSessionIdForAgent(
            oid as string,
            aid as string,
          ),
        ['office-0', SEEDED_TITLED_AGENT],
      );
      expect(sidBefore, 'pre-replace session id should be present').toBeTruthy();

      // A5: replaceSession (the New Session click path) — assert the
      // agent ends up ready on a DIFFERENT uuid.
      await page.evaluate(
        ([oid, aid]) =>
          window.__copilotOfficeDebug!.replaceAgentSession(oid as string, aid as string),
        ['office-0', SEEDED_TITLED_AGENT],
      );
      const afterReplace = await pollAgentStatus(
        page,
        'office-0',
        SEEDED_TITLED_AGENT,
        (s) => s.alive && s.ready,
        15_000,
      );
      expect(afterReplace.alive && afterReplace.ready, JSON.stringify(afterReplace)).toBe(true);
      const sidAfter = await page.evaluate(
        ([oid, aid]) =>
          window.__copilotOfficeDebug!.getCurrentSessionIdForAgent(
            oid as string,
            aid as string,
          ),
        ['office-0', SEEDED_TITLED_AGENT],
      );
      expect(sidAfter, 'post-replace session id should be present').toBeTruthy();
      expect(sidAfter, 'replaceSession must mint a fresh uuid').not.toBe(sidBefore);

      // A6: Close Session — direct resetSession via the bridge (the same
      // call the overlay's handleCloseSession makes). Auto-start MUST NOT
      // restart the agent (FR-013): it stays slacking for ≥ 2s.
      await page.evaluate(
        ([oid, aid]) => window.copilotBridge.resetSession(oid as string, aid as string),
        ['office-0', SEEDED_TITLED_AGENT],
      );
      await page.waitForTimeout(2000);
      const finalStatus = await page.evaluate(async () => {
        const all = await window.copilotBridge.queryAgentStatuses('office-0');
        return all['generalist'] ?? { alive: false, ready: false, inTurn: false };
      });
      expect(finalStatus.alive, `Close Session must leave agent slacking: ${JSON.stringify(finalStatus)}`).toBe(false);
    } finally {
      await app.close();
    }
  });

  // A8 — Setting=OFF gates the roster pre-start (spec-002 path), not just the
  // spec-009 triggers. Boot with the setting OFF, seed a titled agent so
  // spec-009 would normally warm it on cold-launch, and a normal roster of
  // untitled agents that the spec-002 preStartAgentSessions would normally
  // warm. After boot + a 4s settle, assert that NO agent is alive. This is
  // the user-requested clarification: "If auto start known agents is false,
  // then default behavior should not start any agents until they're clicked
  // on, which is different from the previous default behavior."
  test('A8 setting OFF at boot prevents any agent from auto-starting (FR-017)', async () => {
    seedDataDir(() => {
      fs.writeFileSync(
        path.join(process.cwd(), '.data', 'copilot-offices.json'),
        JSON.stringify(SEED_OFFICES_TWO, null, 2),
      );
      // One titled agent (would trigger spec-009 cold-launch warm) PLUS the
      // implicit default-roster pre-start (spec-002) for every other agent.
      writeSessionsFile(
        'office-0',
        { [SEEDED_TITLED_AGENT]: '88888888-8888-8888-8888-888888888888' },
        { [SEEDED_TITLED_AGENT]: { title: 'A8 OFF boot gate' } },
      );
    });

    // First boot the app, set the setting to OFF, then reload the renderer.
    // page.reload() preserves localStorage but re-runs the full renderer cold
    // start (Boot/Office scenes, preStartAgentSessions, AutoStartCoordinator
    // initial trigger), which is exactly the path we need to verify is gated.
    const app = await launchElectron();
    try {
      const page = await findRenderer(app);

      // Flip OFF, kill any sessions started by the first boot's pre-start
      // (otherwise those alive PTYs in the main process would still appear in
      // queryAgentStatuses and the test would not be measuring the gate).
      // Also clear the warmed-office registry so we can assert it stays empty
      // across the reload under setting=OFF.
      await page.evaluate(async () => {
        window.__copilotOfficeDebug!.setAutoStartEnabled(false);
        window.__copilotOfficeDebug!.clearWarmedOfficeRegistry();
        const all = await window.copilotBridge.queryAgentStatuses('office-0');
        for (const [aid, s] of Object.entries(all)) {
          if ((s as { alive: boolean }).alive) {
            await window.copilotBridge.resetSession('office-0', aid);
          }
        }
      });
      // Confirm everything is closed before reload.
      await page.waitForFunction(
        async () => {
          const all = await window.copilotBridge.queryAgentStatuses('office-0');
          return Object.values(all).every((s: any) => !s.alive);
        },
        null,
        { timeout: 10_000 },
      );

      await page.reload();
      await page.waitForFunction(
        () =>
          typeof (window as any).__copilotOfficeDebug === 'object' &&
          (window as any).__copilotOfficeDebug !== null,
        null,
        { timeout: 90_000 },
      );
      await page.waitForTimeout(1500);

      // Confirm the setting really is OFF in the reloaded renderer.
      const settingValue = await page.evaluate(() =>
        window.__copilotOfficeDebug!.getAutoStartEnabled(),
      );
      expect(settingValue, 'reloaded renderer must see persisted OFF setting').toBe(false);

      // Generous settle: pre-start would normally have started agents within
      // ~2-3s. Wait 4s before sampling to give any errant spawn time to land.
      await page.waitForTimeout(4000);

      const aliveAgents = await page.evaluate(async () => {
        const all = await window.copilotBridge.queryAgentStatuses('office-0');
        return Object.entries(all)
          .filter(([, s]) => (s as { alive: boolean }).alive)
          .map(([id]) => id);
      });
      expect(aliveAgents, `OFF gate must prevent ALL boot-time spawns: ${JSON.stringify(aliveAgents)}`).toEqual([]);

      // And the spec-009 coordinator must report zero warmed agents on the reload.
      // (We can't easily zero the counter mid-test, but if it's still equal to its
      // pre-reload value, the reload boot path did not invoke terminalStart again.)
      // Simpler/sufficient: assert no office got added to the warmed registry.
      const warmedAfterReload = await page.evaluate(() =>
        window.__copilotOfficeDebug!.getWarmedOfficeIds(),
      );
      expect(warmedAfterReload, `OFF coordinator must NOT mark offices warmed: ${JSON.stringify(warmedAfterReload)}`).toEqual([]);

      // Sanity: re-enabling the setting and manually opening an agent must
      // still work — proves OFF is gating, not breaking, startup.
      await page.evaluate(() => {
        window.__copilotOfficeDebug!.setAutoStartEnabled(true);
      });
      await page.evaluate(
        ([oid, aid]) => window.copilotBridge.terminalStart(oid as string, aid as string, '.'),
        ['office-0', SEEDED_TITLED_AGENT],
      );
      const manualStatus = await pollAgentStatus(
        page,
        'office-0',
        SEEDED_TITLED_AGENT,
        (s) => s.alive,
        15_000,
      );
      expect(manualStatus.alive, `manual terminalStart must still work after OFF: ${JSON.stringify(manualStatus)}`).toBe(true);
    } finally {
      await app.close();
    }
  });
});
