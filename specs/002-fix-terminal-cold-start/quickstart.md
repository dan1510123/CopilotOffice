# Quickstart: Fix Terminal Cold-Start Bugs

How to reproduce the bugs today, how to verify the fix, and how to run the new smoke tests.

## 1. Reproduce the bugs (pre-fix)

From the worktree root:

```powershell
# 1. Wipe persisted office sessions so the cold-start path runs.
Remove-Item .\.data\office-0.sessions.json -ErrorAction SilentlyContinue
Remove-Item .\.data\copilot-offices.json   -ErrorAction SilentlyContinue

# 2. Build + run the app.
npm run build
npm start
```

Then in the running app:

1. Wait ~10s for the default office to boot.
2. Open the terminal for Gene, type `gene-marker<Enter>`. Observe echo.
3. Switch to Dan's terminal, type `dan-marker<Enter>`. Observe whether Dan echoes or whether keystrokes are silently dropped.
4. Switch to Alice's terminal, type `alice-marker<Enter>`. Same observation.
5. In a separate shell, inspect the persisted sessions:

   ```powershell
   Get-Content .\.data\office-0.sessions.json | ConvertFrom-Json | Select-Object -ExpandProperty current
   ```

   If the bug is active, two or three agents will share the same UUID OR the in-app behavior will be inconsistent with the file (input goes to the wrong PTY).
6. Watch for status badges flipping to "Startup timed out" within ~60s even though the underlying CLI processes are alive (visible in Electron main-process logs as `[TermServer] Agent <ck> signalled READY ...` for the working agent, and absent for the others).
7. Try Ctrl+Click → Copy on visible terminal output, paste into Notepad. Observe whether the paste matches selection.

## 2. Verify the fix

After the fix lands, repeat the steps above and expect:

- All three agents echo their own markers in their own terminals.
- `.data/office-0.sessions.json` contains three pairwise-distinct UUIDs.
- No agent shows a "Startup timed out" badge within 60s when its CLI process is alive.
- Ctrl+C (or Cmd+C on macOS) with a selection copies exactly the selected text, verified via paste into any other surface.

## 3. Run the smoke tests

```powershell
# Unit + integration
npm run test -- tests/integration/terminal/server-cold-start.test.ts
npm run test -- tests/integration/terminal/sync-agent-statuses.test.ts
npm run test -- tests/integration/terminal/TerminalOverlay.test.ts

# End-to-end (cold-start, three terminals, copy)
npm run test:e2e -- default-office-cold-start.spec.ts
```

CI-blocked variant: if the runner cannot host an Electron + xterm session, the e2e file is annotated with the same env-block marker used by feature 001 — it will skip with a documented rationale rather than failing.

## 4. Diagnostic log scrape (debugging)

Useful patterns when the bug or a regression is suspected:

```powershell
# Distinct session GUIDs emitted on cold start
Get-Content $env:USERPROFILE\AppData\Roaming\CopilotOffice\logs\main.log | Select-String 'New session GUID for'

# Recovery branch in syncAgentStatuses firing
Get-Content $env:USERPROFILE\AppData\Roaming\CopilotOffice\logs\main.log | Select-String 'stuck in starting past timeout but PTY alive'

# Repaired duplicate session
Get-Content $env:USERPROFILE\AppData\Roaming\CopilotOffice\logs\main.log | Select-String 'Repaired duplicate sessionId'
```

(Replace log path with whatever your platform's Electron user-data directory is — these patterns also surface in the dev console when running `npm start`.)

## 5. Rollback

The fix touches at most four production files plus three test files. To roll back, revert the commits on the `worktree-next-steps-20260603-133614` branch — no schema migration, no persisted-state shape change, no IPC contract change.
