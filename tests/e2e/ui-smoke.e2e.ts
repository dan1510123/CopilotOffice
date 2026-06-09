// Spec 008-smoke: UI control smoke harness.
//
// Boots Electron cold with COPILOT_E2E=1 so:
//   - main-process PTY spawns use launchMode='shell' (no real Copilot CLI needed).
//   - the renderer installs window.__copilotOfficeDebug.
//
// Coverage:
//   T1  Cold start: 3 default agents are listed.
//   T2  Game mode: opening Gene's terminal sets the active agent.
//   T3  Game mode: closing the terminal clears the active agent.
//   T4  Game mode regression: switching Gene -> Dan -> Alice updates the active
//       agent each time. Reproduces the user-reported "locked to first agent"
//       bug if it regresses.
//   T5  Immediate switch to Serious mode after cold start renders the dashboard.
//   T6  Serious mode regression: switching Gene -> Dan -> Alice updates the
//       active agent each time.
//   T7  Status bar contains no fatal error text.

import { expect, test } from '@playwright/test';
import {
  bootColdOffice,
  skipIfEnvBlocked,
} from './_helpers/electron-cold-start';
import {
  closeActiveTerminal,
  expectActiveTerminalAgent,
  getActiveTerminalAgentId,
  getMode,
  listAgents,
  openAgentTerminal,
  setMode,
  waitForDebugHook,
} from './_helpers/ui-smoke';

const DEFAULT_AGENT_IDS = ['generalist', 'debugger', 'admin'] as const;

test.describe('UI smoke harness (spec 008)', () => {
  test.beforeEach(() => {
    skipIfEnvBlocked();
  });

  test('T1+T2+T3+T4 game-mode: list, open, close, and switch across all 3 agents', async () => {
    const { app, page } = await bootColdOffice({ env: { COPILOT_E2E: '1' } });
    try {
      await waitForDebugHook(page);

      // T1: cold start lists 3 default agents.
      const agents = await listAgents(page);
      const ids = agents.map((a) => a.id).sort();
      expect(ids).toEqual([...DEFAULT_AGENT_IDS].sort());

      // Ensure we are in game mode (default), reset just in case localStorage
      // remembered a previous mode.
      if ((await getMode(page)) !== 'game') {
        await setMode(page, 'game');
      }
      expect(await getMode(page)).toBe('game');

      // T2: open Gene's terminal -> active agent is generalist.
      await openAgentTerminal(page, 'generalist');
      await expectActiveTerminalAgent(page, 'generalist', 10_000);

      // T3: close terminal -> active agent goes back to null.
      await closeActiveTerminal(page);
      await expectActiveTerminalAgent(page, null, 5_000);

      // T4 (regression): close -> open next agent -> verify each time.
      for (const id of DEFAULT_AGENT_IDS) {
        await openAgentTerminal(page, id);
        await expectActiveTerminalAgent(page, id, 10_000);
        await closeActiveTerminal(page);
        await expectActiveTerminalAgent(page, null, 5_000);
      }

      // T4b (regression): switch DIRECTLY between agents without closing in
      // between. This is the path the user-reported "locked to first agent"
      // bug would surface on — the previous terminal stays open while a new
      // agent is requested.
      await openAgentTerminal(page, 'generalist');
      await expectActiveTerminalAgent(page, 'generalist', 10_000);
      await openAgentTerminal(page, 'debugger');
      await expectActiveTerminalAgent(page, 'debugger', 10_000);
      await openAgentTerminal(page, 'admin');
      await expectActiveTerminalAgent(page, 'admin', 10_000);
      await closeActiveTerminal(page);
    } finally {
      await app.close();
    }
  });

  test('T5+T6 serious-mode: immediate mode flip + agent switching', async () => {
    const { app, page } = await bootColdOffice({ env: { COPILOT_E2E: '1' } });
    try {
      await waitForDebugHook(page);

      // T5: flip to serious mode immediately after cold start.
      await setMode(page, 'serious');
      expect(await getMode(page)).toBe('serious');

      // T6 (regression): switch through all 3 agents while in serious mode.
      // SeriousTerminalController.openAgentTerminal does an internal detach +
      // re-attach when the target agent changes — this catches regressions in
      // that path.
      for (const id of DEFAULT_AGENT_IDS) {
        await openAgentTerminal(page, id);
        await expectActiveTerminalAgent(page, id, 15_000);
      }

      // Cleanup
      await closeActiveTerminal(page);
    } finally {
      await app.close();
    }
  });

  test('T7 status bar shows no fatal error text after cold start', async () => {
    const { app, page, getMainProcessLog } = await bootColdOffice({
      env: { COPILOT_E2E: '1' },
    });
    try {
      await waitForDebugHook(page);
      // Give status bar a moment to render the post-boot state.
      await page.waitForTimeout(2_000);

      const statusText = (await page.locator('#status-bar').textContent({ timeout: 5_000 })) ?? '';
      const lower = statusText.toLowerCase();
      expect(lower.includes('startup timed out'), 'status bar must not show timeout').toBe(false);
      // Allow "error" inside common phrases by checking only for a hard-error marker.
      expect(lower.includes('fatal'), 'status bar must not show fatal').toBe(false);

      const mainLog = getMainProcessLog();
      expect(
        mainLog.includes('Startup timed out'),
        `main log must not report startup timeout. Tail:\n${mainLog.slice(-1000)}`,
      ).toBe(false);
    } finally {
      await app.close();
    }
  });
});
