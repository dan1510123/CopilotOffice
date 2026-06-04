# Quickstart: Fix Sprite-Card Stacking and Serious-Mode Open-Flow Bugs

How to reproduce each bug today, how to verify the fix, and how to run the smoke tests.

## 1. Reproduce the bugs (pre-fix)

From the worktree root:

```powershell
npm run build
npm start
```

### Bug 1 — Sprite-card stacking (US1)

1. Wait for the default office to boot.
2. Open the terminal for any agent. Observe one `#sprite-card` at the bottom.
3. Open dev tools, run `document.querySelectorAll('#sprite-card').length` → expect `1`.
4. Walk into the meeting room (or trigger the meeting scene transition). Walk back out.
5. Re-run `document.querySelectorAll('#sprite-card').length` → currently observes `2` or more. **This is the bug.**
6. Repeat the meeting round trip → count keeps growing.

### Bug 2 — Serious-mode silent open failure (US2)

1. Switch the app into serious mode (persisted-mode toggle or boot flag).
2. In dev tools, monkey-patch the controller's render phase to throw, e.g.:

   ```javascript
   const controller = window.__seriousTerminalController; // (only available in dev builds; otherwise stub via test harness)
   const orig = controller.updateSpriteCard.bind(controller);
   controller.updateSpriteCard = () => { throw new Error('forced render failure'); };
   ```

3. Click an agent card in the serious-mode dashboard.
4. Observe: nothing visible happens. No status update. No xterm warning. No PTY attach. **This is the bug.**

(In CI / tests, this same forced-throw is performed via the Vitest harness rather than dev-tools monkey-patch.)

### Bug 3 — Serious-mode `onData` cross-agent leak (US3)

This bug is masked today by an early-return guard in the close path, so it is hard to reproduce by clicking. The smoke test in `SeriousTerminalController.test.ts` exercises it directly by mutating `this.activeAgentId` without going through close. Behavior under that test: keystroke routed to the wrong agent. **This is the bug.**

## 2. Verify the fix

After Phases A–C land, repeat:

- **Bug 1**: meeting round trip × 5, plus 2 office switches → `document.querySelectorAll('#sprite-card').length` stays at `1` (or `0` between scene transitions, never ≥2).
- **Bug 2**: forced render throw → status bar shows a human-readable error, xterm shows `[render error: forced render failure]`, AND the PTY attach still fires (visible in main-process logs as `[TermServer] New session GUID for ...` or `[TermServer] Reusing session GUID ...`).
- **Bug 3**: smoke test asserts the bound agent receives the keystroke even after `activeAgentId` mutation.

## 3. Run the smoke tests

```powershell
# All new and extended integration tests
npm run test -- tests/integration/main/serious-mode.test.ts
npm run test -- tests/integration/terminal/SeriousTerminalController.test.ts

# Full suite — must remain green (187 baseline + new assertions)
npm run test
```

The three named tests added/converted by this feature:

- `tests/integration/main/serious-mode.test.ts`:
  - `SM-001 single sprite-card across game-mode + meeting round trip`
  - `SM-002 serious-mode open surfaces synchronous render failures and still attaches` (converted from prior `it.fails` SM-F)
  - `SM-003 serious-mode onData routes to the agent bound at registration`
- `tests/integration/terminal/SeriousTerminalController.test.ts`:
  - `routes onData to bound agent after activeAgentId mutation`

## 4. Verify the SC-005 regression-detection promise

For each invariant, intentionally regress the code in a throwaway change and confirm exactly one named test fails:

- Comment out the new `getElementById('sprite-card')?.remove()` line in `TerminalOverlay.createSpriteCard()` → `SM-001` fails with a count assertion message naming the sprite-card invariant.
- Remove the top-level `try/catch` from `SeriousTerminalController.openAgentTerminal` → `SM-002` fails citing missing status / missing attach.
- Replace `boundAgentId` with `this.activeAgentId` inside the `onData` closure → `SM-003` (and the controller-unit regression) fail with cross-agent routing message.

Restore the code afterwards.

## 5. Diagnostic log scrape

If a regression is suspected in production / dev, these forensic log lines (added optionally by the contracts doc) help bisect:

```powershell
# Stale sprite-card cleanup firing
Get-Content $env:USERPROFILE\AppData\Roaming\CopilotOffice\logs\main.log | Select-String 'createSpriteCard removed stale'

# Scene-shutdown cleanup firing
Get-Content $env:USERPROFILE\AppData\Roaming\CopilotOffice\logs\main.log | Select-String 'shutdown destroying terminalOverlay'

# Serious-mode render-phase catch firing
Get-Content $env:USERPROFILE\AppData\Roaming\CopilotOffice\logs\main.log | Select-String 'openAgentTerminal render failure'

# onData rebind events (one per agent open)
Get-Content $env:USERPROFILE\AppData\Roaming\CopilotOffice\logs\main.log | Select-String 'onData rebound'
```

## 6. Rollback

This feature touches four production files and two test files. To roll back, revert the commits on `003-fix-sprite-and-serious-bugs` — no schema migration, no persisted-state shape change, no IPC contract change, no Phaser canvas change.
