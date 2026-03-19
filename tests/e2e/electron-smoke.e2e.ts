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

test('electron smoke: boot + office create/switch flow', async () => {
  const app = await electron.launch({
    args: [path.resolve(process.cwd())],
    timeout: 60_000,
  });

  try {
    const page = await findRendererWindow(app);
    await page.waitForSelector('#office-tabs', { timeout: 60_000 });
    await page.waitForSelector('#status-bar', { timeout: 60_000 });

    await expect(page.locator('#office-panel')).toBeVisible();
    await expect(page.locator('#terminal-panel')).toBeVisible();
    await expect(page.locator('.office-tab', { hasText: 'Main Office' })).toBeVisible();

    const officeName = `Smoke Office ${Date.now()}`;
    await page.locator('#new-office-btn').click();
    await expect(page.locator('#nod-name')).toBeVisible();
    await page.fill('#nod-name', officeName);
    await page.fill('#nod-path', '.');
    await page.locator('#nod-create').click();

    await expect(page.locator('.office-tab', { hasText: officeName })).toBeVisible();
    await expect(page.locator('#terminal-subtitle')).toContainText(officeName);

    await page.locator('.office-tab', { hasText: 'Main Office' }).click();
    await expect(page.locator('#terminal-subtitle')).toContainText('Main Office');
  } finally {
    await app.close();
  }
});

