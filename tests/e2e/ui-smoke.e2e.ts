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

import * as fs from 'fs';
import * as path from 'path';
import { _electron as electron } from '@playwright/test';
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

  // T8: real Electron clipboard round-trip. Drives the actual Spec 005-008
  // copyToClipboard path: writes text via bridge.clipboardWriteText, reads
  // it back via bridge.clipboardReadText (which goes through the same
  // electron/clipboard IPC the Ctrl+C handler uses), and asserts byte-for-byte
  // equality. This is the regression guard that would have flagged the user's
  // "broken again" report if the right bundle were running.
  test('T8 clipboard IPC round-trip writes and reads same text', async () => {
    const { app, page } = await bootColdOffice({ env: { COPILOT_E2E: '1' } });
    try {
      await waitForDebugHook(page);

      // Open a terminal so the renderer has fully wired the clipboard bridge.
      await openAgentTerminal(page, 'generalist');
      await expectActiveTerminalAgent(page, 'generalist', 10_000);

      const payload = `spec-008-roundtrip ${Date.now()} 你好 \n\t<>&"'`;

      const result = await page.evaluate(async (text) => {
        const bridge = window.copilotBridge;
        if (!bridge?.clipboardWriteText || !bridge?.clipboardReadText) {
          return { wrote: false, read: '', verified: false, error: 'bridge missing' };
        }
        const w = await bridge.clipboardWriteText(text);
        const r = await bridge.clipboardReadText();
        return {
          wrote: w?.success === true,
          verified: w?.verified === true,
          read: r?.text ?? '',
          error: w?.error || r?.error || null,
        };
      }, payload);

      expect(result.error, `clipboard IPC error: ${result.error}`).toBeNull();
      expect(result.wrote, 'clipboardWriteText did not report success').toBe(true);
      expect(result.verified, 'main process verify-readback failed').toBe(true);
      expect(result.read, 'clipboard read did not match written payload').toBe(payload);
    } finally {
      await app.close();
    }
  });

  // T9: per-agent session ID isolation. Spec 007 removed the greedy
  // parseSessionId regex that was clobbering agents' UUIDs with whatever id
  // appeared in CLI output. This test proves the server-authoritative path
  // hands the renderer a distinct UUID per agent, and that subsequent
  // bridge.resetSession() calls (the /new path) keep them distinct.
  test('T9 each agent has a distinct session ID across open + resetSession', async () => {
    const { app, page } = await bootColdOffice({ env: { COPILOT_E2E: '1' } });
    try {
      await waitForDebugHook(page);

      const agents = ['generalist', 'debugger', 'admin'] as const;

      // Open each agent so a PTY (shell mode under COPILOT_E2E=1) is spawned
      // and its session id is minted + persisted on the server.
      for (const id of agents) {
        await openAgentTerminal(page, id);
        await expectActiveTerminalAgent(page, id, 15_000);
      }

      // Snapshot 1: server-side session ids via bridge.getSessionId.
      const snap1 = await page.evaluate(async (agentIds) => {
        const bridge = window.copilotBridge;
        const officeId = window.__copilotOfficeDebug!.getCurrentOfficeId() || 'office-0';
        const out: Record<string, string | null> = {};
        for (const id of agentIds) {
          out[id] = await bridge!.getSessionId(officeId, id);
        }
        return out;
      }, agents as unknown as string[]);

      const ids1 = agents.map((a) => snap1[a]);
      expect(ids1.every((id) => typeof id === 'string' && id.length > 0),
        `getSessionId returned null/empty: ${JSON.stringify(snap1)}`).toBe(true);
      expect(new Set(ids1).size,
        `expected 3 distinct session ids after open, got: ${JSON.stringify(snap1)}`).toBe(3);

      // Now call resetSession on each (simulates the /new path) and snapshot
      // again. Every id must change AND remain pairwise-distinct.
      const snap2 = await page.evaluate(async (agentIds) => {
        const bridge = window.copilotBridge;
        const officeId = window.__copilotOfficeDebug!.getCurrentOfficeId() || 'office-0';
        const out: Record<string, string | null> = {};
        for (const id of agentIds) {
          const r = await bridge!.resetSession(officeId, id);
          out[id] = r?.sessionId ?? null;
        }
        return out;
      }, agents as unknown as string[]);

      const ids2 = agents.map((a) => snap2[a]);
      expect(ids2.every((id) => typeof id === 'string' && id.length > 0),
        `resetSession returned null/empty: ${JSON.stringify(snap2)}`).toBe(true);
      expect(new Set(ids2).size,
        `expected 3 distinct session ids after resetSession, got: ${JSON.stringify(snap2)}`).toBe(3);

      // Each agent's id must have CHANGED from snap1 to snap2.
      for (const id of agents) {
        expect(snap1[id], `agent ${id}: id should change after resetSession`).not.toBe(snap2[id]);
      }
    } finally {
      await app.close();
    }
  });

  // T10 (user-reported repro 2026-06-12): cold start -> click an agent in game
  // mode -> flip to Serious mode -> click between agents in serious mode.
  // User reports all agents appear "locked to the same one" and same session id
  // gets shown. This test asserts:
  //   - serious-mode getActiveTerminalAgentId tracks the latest requested agent
  //   - serious-mode sprite-card title text + the session-id DOM display update
  //     per switch (this is what the user actually sees)
  //   - each agent retains its own distinct server-side session id throughout
  test('T10 game-click -> flip serious -> switch agents updates terminal AND sprite card AND session id', async () => {
    const { app, page } = await bootColdOffice({ env: { COPILOT_E2E: '1' } });
    try {
      await waitForDebugHook(page);

      // Ensure starting in game mode.
      if ((await getMode(page)) !== 'game') {
        await setMode(page, 'game');
      }

      // Step 1: user clicks Gene in game mode.
      await openAgentTerminal(page, 'generalist');
      await expectActiveTerminalAgent(page, 'generalist', 10_000);

      // Step 2: user flips to Serious mode. applyAppMode forwards the previously
      // selected agent (selectedAgentBeforeModeSwitch) to seriousTerminalController.
      await setMode(page, 'serious');
      expect(await getMode(page)).toBe('serious');
      await expectActiveTerminalAgent(page, 'generalist', 15_000);

      // Step 3: user clicks Dan, then Alice, in serious mode.
      const observations: Array<{
        requested: string;
        activeAfter: string | null;
        spriteTitle: string;
        sessionIdShown: string;
        sessionIdFromBridge: string | null;
      }> = [];

      for (const id of ['debugger', 'admin', 'generalist'] as const) {
        await openAgentTerminal(page, id);
        await expectActiveTerminalAgent(page, id, 15_000);
        // give DOM (sprite card title + session id readout) a tick to repaint
        await page.waitForTimeout(300);

        const snap = await page.evaluate(() =>
          window.__copilotOfficeDebug!.getSeriousPanelSnapshot(),
        );

        const sidFromBridge = await page.evaluate(async (agentId) => {
          const officeId = window.__copilotOfficeDebug!.getCurrentOfficeId() || 'office-0';
          return await window.copilotBridge!.getSessionId(officeId, agentId);
        }, id);

        observations.push({
          requested: id,
          activeAfter: await getActiveTerminalAgentId(page),
          spriteTitle: snap?.spriteName ?? '',
          sessionIdShown: snap?.sessionIdText ?? '',
          sessionIdFromBridge: sidFromBridge,
        });
      }

      // Diagnostic dump so failures are immediately actionable.
      const diag = JSON.stringify(observations, null, 2);

      // (a) Active agent id from controller MUST match what was requested each time.
      for (const obs of observations) {
        expect(obs.activeAfter, `controller active id mismatch:\n${diag}`).toBe(obs.requested);
      }

      // (b) Sprite-card title MUST change between switches (catches "locked" UI).
      const titles = observations.map((o) => o.spriteTitle);
      expect(new Set(titles).size, `sprite-card title did not vary across switches:\n${diag}`)
        .toBeGreaterThan(1);

      // (c) Session id rendered in the panel MUST match what bridge.getSessionId
      // says for the active agent — i.e., NOT stuck on the prior agent's id.
      for (const obs of observations) {
        expect(obs.sessionIdShown, `panel session id did not match bridge for ${obs.requested}:\n${diag}`)
          .toBe(obs.sessionIdFromBridge);
      }

      // (d) Across the 3 unique agents observed, the rendered session ids must
      // be pairwise distinct for distinct agents (the user-reported symptom).
      const byAgent = new Map<string, Set<string>>();
      for (const obs of observations) {
        if (!byAgent.has(obs.requested)) byAgent.set(obs.requested, new Set());
        byAgent.get(obs.requested)!.add(obs.sessionIdShown);
      }
      const distinctIdsAcrossAgents = new Set(
        Array.from(byAgent.values()).map((s) => Array.from(s)[0]),
      );
      expect(
        distinctIdsAcrossAgents.size,
        `expected distinct session ids per agent in serious mode, got:\n${diag}`,
      ).toBe(byAgent.size);
    } finally {
      await app.close();
    }
  });

  // T11 (user-reported 2026-06-12): flipping from game to serious mode while
  // a game-mode terminal is still open must close that overlay. Otherwise the
  // overlay DOM stays parented in terminalPanel (the SeriousTerminalController
  // host), overlapping the serious panel, and the PTY viewer attach leaks.
  test('T11 game->serious flip closes any open game-mode terminal overlay', async () => {
    const { app, page } = await bootColdOffice({ env: { COPILOT_E2E: '1' } });
    try {
      await waitForDebugHook(page);

      if ((await getMode(page)) !== 'game') {
        await setMode(page, 'game');
      }

      // Open Gene in game mode -> overlay container becomes visible.
      await openAgentTerminal(page, 'generalist');
      await expectActiveTerminalAgent(page, 'generalist', 10_000);

      // Sanity: in game mode, getActiveTerminalAgentId reads the overlay.
      // If it returns the agent id, the overlay reports itself visible.
      expect(await getActiveTerminalAgentId(page)).toBe('generalist');

      // Flip to serious mode WITHOUT manually closing the overlay first.
      await setMode(page, 'serious');
      expect(await getMode(page)).toBe('serious');

      // After flip, the previously-active agent should auto-attach in the
      // serious panel (T10 behaviour). Wait for that to settle first.
      await expectActiveTerminalAgent(page, 'generalist', 15_000);

      // The game-mode overlay DOM is parented in #terminal-panel. After flip,
      // the only visible terminal surface in terminalPanel/terminalHost must
      // be the serious controller's container. Assert no leftover xterm
      // viewport from the game-mode overlay is visible.
      const leakState = await page.evaluate(() => {
        const panel = document.querySelector('#terminal-panel') as HTMLElement | null;
        if (!panel) return { hasLeak: false, leakedViewports: 0, reason: 'no #terminal-panel' };
        // Count xterm-viewport children that are visibly rendered.
        const viewports = Array.from(panel.querySelectorAll('.xterm-viewport')) as HTMLElement[];
        const visibleCount = viewports.filter((v) => {
          // Walk up to find any ancestor with display:none.
          let el: HTMLElement | null = v;
          while (el && el !== panel) {
            const cs = window.getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
            el = el.parentElement;
          }
          return v.offsetParent !== null;
        }).length;
        return { hasLeak: visibleCount > 1, leakedViewports: visibleCount, reason: '' };
      });
      // Exactly one visible xterm viewport (the serious controller's). More
      // means the game-mode overlay leaked through.
      expect(leakState.leakedViewports, JSON.stringify(leakState))
        .toBeLessThanOrEqual(1);
    } finally {
      await app.close();
    }
  });

  // T12 (user-reported 2026-06-12): when durable persistence load sets
  // currentOfficeId to a non-default value AFTER the initial
  // fetchSessionMeta() ran (with the localStorage / auto-default office id),
  // the dashboard rendered "Untitled session" for every agent because:
  //   - cachedSessionMeta was populated for the WRONG office
  //   - clicking the tab for the durable-load office is a no-op
  //     (id already matches), so fetchSessionMeta never re-fires
  //   - officeManager.onOfficesUpdated was never wired to refresh anything
  //
  // Fix: wire onOfficesUpdated in main.ts to renderOfficeTabs +
  // fetchSessionMeta + updateTerminalContent. This test seeds .data/ with
  // a 3-office payload whose currentOfficeId points at office-2 with a
  // known title, boots, and asserts the dashboard shows the title WITHOUT
  // any user-initiated tab click.
  test('T12 durable load applies titles to dashboard without user click', async () => {
    skipIfEnvBlocked();
    // bootColdOffice wipes .data first, then launches asynchronously. We
    // need to write our seed AFTER the wipe but BEFORE Electron's office
    // store reads. Easiest: wipe + seed ourselves, then launch via the
    // helper without re-wiping.
    const cwd = process.cwd();
    const dataDir = path.join(cwd, '.data');
    if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
    fs.mkdirSync(dataDir, { recursive: true });

    const offices = {
      currentOfficeId: 'office-2',
      offices: [
        { id: 'office-0', name: 'Main Office', workingDirectory: '.', createdAt: 1, layout: 'default', seatedAgents: [] },
        { id: 'office-1', name: 'One', workingDirectory: '.', createdAt: 2, layout: 'default', seatedAgents: [] },
        {
          id: 'office-2',
          name: 'AIQB',
          workingDirectory: '.',
          createdAt: 3,
          layout: 'default',
          seatedAgents: [],
          customAgents: [
            {
              id: 'office-4-agent-0',
              name: 'Willa',
              skill: 'general',
              sprite: 'npc_random_4',
              color: 5583769,
              position: { x: 4, y: 3 },
              greeting: 'hi',
              description: 'Analyst',
            },
          ],
          customReserveAgents: {},
        },
      ],
    };
    fs.writeFileSync(path.join(dataDir, 'copilot-offices.json'), JSON.stringify(offices, null, 2));
    fs.writeFileSync(
      path.join(dataDir, 'office-2.sessions.json'),
      JSON.stringify(
        {
          current: { 'office-4-agent-0': '11111111-2222-3333-4444-555555555555' },
          history: {},
          metadata: { 'office-4-agent-0': { title: 'analyze gmm copilot' } },
        },
        null,
        2,
      ),
    );

    // Launch electron directly (bootColdOffice would wipe our seed).
    const envWithoutNodeMode: Record<string, string> = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (k === 'ELECTRON_RUN_AS_NODE') continue;
      if (typeof v === 'string') envWithoutNodeMode[k] = v;
    }
    const app = await electron.launch({
      args: [path.resolve(cwd)],
      timeout: 60_000,
      env: { ...envWithoutNodeMode, COPILOT_E2E: '1' },
    });

    try {
      const page = await app.firstWindow();
      await waitForDebugHook(page);
      // Allow durable load + onOfficesUpdated chain to settle.
      await page.waitForTimeout(2500);

      const result = await page.evaluate(async () => {
        const debug = window.__copilotOfficeDebug!;
        return {
          currentOfficeId: debug.getCurrentOfficeId(),
          cachedMeta: debug.getCachedSessionMetaForRender?.() ?? {},
        };
      });

      const diag = JSON.stringify(result, null, 2);
      // Without the fix: currentOfficeId='office-2' but cachedMeta={}
      // With the fix: cachedMeta has the title keyed by office-4-agent-0.
      expect(result.currentOfficeId, `expected office-2 to be current:\n${diag}`).toBe('office-2');
      expect(
        result.cachedMeta['office-4-agent-0']?.title,
        `expected dashboard cache to have the title from the seeded sessions file:\n${diag}`,
      ).toBe('analyze gmm copilot');
    } finally {
      await app.close();
      // Best-effort cleanup of our seed.
      if (fs.existsSync(dataDir)) fs.rmSync(dataDir, { recursive: true, force: true });
    }
  });
});
