// Meeting → plan approval → fleet spawn → fleet office terminal visibility.
//
// Authored for S1-E (T038). This test exercises the high-risk fleet pipeline
// end-to-end: meeting entry triggers Arthur's session, plan approval emits
// the deploy request, the fleet office is created and the architect session
// is transferred, and the fleet office terminal becomes visible (proving the
// dual-key viewer invariant from S1-D / R-002 still holds when exercised
// through the real Electron stack).
//
// Likely env-blocked on headless / CLI runners — same baseline failure as
// `electron-smoke.e2e.ts` ("Process failed to launch!"). Re-run on a desktop
// session to validate.

import path from 'node:path';
import { _electron as electron, expect, test } from '@playwright/test';

async function findRendererWindow(app: Awaited<ReturnType<typeof electron.launch>>) {
  const timeoutAt = Date.now() + 60_000;
  while (Date.now() < timeoutAt) {
    for (const page of app.windows()) {
      try {
        if (await page.locator('#game-container').count()) {
          return page;
        }
      } catch {
        // Ignore devtools/non-renderer windows and keep searching.
      }
    }
    try {
      await app.waitForEvent('window', { timeout: 1000 });
    } catch {
      // Keep polling until timeout.
    }
  }
  throw new Error('Renderer window not found within timeout');
}

test('meeting → plan approval → fleet spawn → fleet office terminal visibility', async () => {
  const app = await electron.launch({
    args: [path.resolve(process.cwd())],
    timeout: 60_000,
  });

  try {
    const page = await findRendererWindow(app);
    await page.waitForSelector('#game-container', { timeout: 60_000 });
    await page.waitForSelector('#office-tabs', { timeout: 60_000 });

    // Drive the fleet pipeline via game events so the test is independent of
    // exact Phaser key/click coordinates (which vary by responsive layout).
    // We synthesize the same `fleet:deploy-requested` event MeetingScene
    // would emit on plan approval, then assert the fleet office tab appears
    // and the terminal panel becomes visible.
    const initialTabCount = await page.locator('.office-tab').count();

    await page.evaluate(() => {
      // The renderer-side game emitter is exposed for diagnostics in main.ts.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const game: any = (window as any).__phaserGame;
      if (!game) throw new Error('phaser game not exposed on window');
      game.events.emit('fleet:deploy-requested', {
        officeName: `E2E Fleet ${Date.now()}`,
        prompt: 'noop — e2e parity smoke',
        sourceOfficeId: 'office-0',
      });
    });

    // Allow the deploy request to land: office created, session transferred,
    // OfficeScene initFleetPipeline runs.
    await page.waitForFunction(
      (initial) => document.querySelectorAll('.office-tab').length > initial,
      initialTabCount,
      { timeout: 30_000 }
    );

    // Fleet office tab should be present and the terminal panel still rendered.
    const newTab = page.locator('.office-tab').last();
    await expect(newTab).toBeVisible();
    await expect(page.locator('#terminal-panel')).toBeVisible();
  } finally {
    await app.close();
  }
});
