// spec 017 — T036. E2E smoke for the US1 persistent-transcript seam.
//
// The orchestrator SDK session needs a real Copilot CLI, which the COPILOT_E2E
// shell-stub harness does not provide, so this smoke does NOT drive a live
// conversation. Instead it proves the persistence seam is wired end-to-end and
// reachable from the renderer without crashing:
//   1. `window.copilotBridge.orchestratorGetTranscript` exists (preload → IPC →
//      manager.getTranscript round-trip is registered).
//   2. On a cold start with no prior session it returns a well-formed
//      `{ transcript: null }` (a fresh panel starts clean — FR-005).
//   3. The transcript IPC is a pure read: calling it MUST NOT create a session
//      (ipc-v2 invariant 4) — a second call still returns null.
//
// The history-REPLAY behavior itself (turn rendering, origin attribution, bounded
// retention) is covered deterministically by the unit tests
// (orchestratorTranscriptCapture.test.ts + orchestratorTranscriptStore.test.ts)
// and the OrchestratorPanel replay path (T013), which do not require a live CLI.

import { expect, test } from '@playwright/test';
import { bootColdOffice, skipIfEnvBlocked } from './_helpers/electron-cold-start';
import { waitForDebugHook } from './_helpers/ui-smoke';

test.describe('orchestrator transcript persistence seam (spec 017 US1)', () => {
  test.beforeEach(() => {
    skipIfEnvBlocked();
  });

  test('transcript IPC is wired and returns a clean (null) record on cold start', async () => {
    const { app, page } = await bootColdOffice({ env: { COPILOT_E2E: '1' } });
    try {
      await waitForDebugHook(page);

      // 1. The renderer seam exists.
      const hasBridge = await page.evaluate(
        () => typeof window.copilotBridge?.orchestratorGetTranscript === 'function',
      );
      expect(hasBridge).toBe(true);

      // 2. Cold start → no active conversation to replay.
      const first = await page.evaluate(() => window.copilotBridge!.orchestratorGetTranscript!());
      expect(first).toBeTruthy();
      expect(first.transcript).toBeNull();

      // 3. Pure read — a second call does not resurrect / create a session.
      const second = await page.evaluate(() => window.copilotBridge!.orchestratorGetTranscript!());
      expect(second.transcript).toBeNull();
    } finally {
      await app.close();
    }
  });
});
