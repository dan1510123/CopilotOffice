# Quickstart — Auto-Startup of Known Agents (spec 009)

> Owner-facing walkthrough to verify the feature end-to-end after `/speckit.tasks`
> and implementation land. All commands run from this worktree root:
> `C:\Users\danielluo\repos\CopilotOffice-worktree-next-steps-20260603-133614`.

## 0. Build the worktree's bundles

```powershell
npm install            # only on first checkout
npm run build          # produces dist/game.bundle.js + dist/electron/*.js
```

> **Constitution VII reminder**: `dist/` is per-worktree. If you run
> `npm start` from the main checkout you will execute *that* checkout's stale
> bundle and the feature will appear missing. Verify with
> `Get-ChildItem dist/game.bundle.js | Select-Object LastWriteTime` and
> `Select-String -Path dist/game.bundle.js -Pattern "AutoStartCoordinator"`.

## 1. Manual verification (rule #1 — cold launch)

1. Pre-seed `.data/`:
   ```powershell
   Remove-Item -Recurse -Force .data -ErrorAction SilentlyContinue
   New-Item -ItemType Directory .data | Out-Null
   @'
   { "current": { "generalist": "<existing-uuid>" },
     "metadata": { "generalist": { "title": "Refactor login flow" } } }
   '@ | Set-Content .data/office-0.sessions.json
   ```
   (Replace `<existing-uuid>` with any uuid present in the local Copilot CLI
   session store, or just rerun after you have had at least one real
   conversation as the "generalist" agent.)
2. Launch: `npm start`.
3. **Expected**: Without pressing any key, the dashboard card for "generalist"
   shows the status badge transition `slacking → starting → ready` within a
   few seconds. Card title shows "Refactor login flow". No terminal overlay
   pops open on its own.
4. Walk the avatar to the generalist NPC and press E. The terminal opens
   onto the resumed session (no fresh `copilot` launch animation), and the
   PTY count in `electron`'s log shows exactly one PTY for that agent.

## 2. Manual verification (rule #2 — office switch)

1. With the app from §1 still running, create a second office in the office
   tab bar (or use one that already has a populated
   `.data/office-1.sessions.json`).
2. Click the office-1 tab.
3. **Expected**: Office-1's known agents (those with non-empty titles) walk
   through `slacking → starting → ready` automatically. Office-0's already-
   warm agents are undisturbed. Click back to office-0 — no re-spawn occurs
   for its agents.

## 3. Manual verification (rule #3 — New Session vs Close Session)

1. Open a terminal for any `ready` agent.
2. Click **New Session**. **Expected**: terminal clears, shows
   `[Starting new session...]`, then within a few seconds reaches the
   `ready` state on a different session uuid. Status badge cycle:
   `ready → closing → starting → ready`. No additional key presses needed.
3. Double-click **New Session** rapidly. **Expected**: exactly one
   replacement session, not two. `current[agentId]` ends up with one uuid.
4. Click **Close Session**. **Expected**: terminal shows `[session closed]`,
   the panel detaches, badge returns to `slacking`, and it STAYS in
   `slacking` (wait ≥ 60s — no spurious restart).

## 4. Manual verification (rule #4 — Settings toggle)

1. Open Settings (gear icon in top bar).
2. Confirm the new "Agents" section exists with **Auto-start known agents**
   checked.
3. Uncheck it, close Settings, quit the app.
4. Relaunch (`npm start`).
5. **Expected**: No auto-startup occurs. Every agent stays `slacking`.
6. Switch offices — still no auto-startup.
7. Manually press E on an agent to get it `ready`, then click New Session.
   **Expected**: agent closes (returns to `slacking`) but does NOT auto-
   restart (FR-017).
8. Re-open Settings, re-check the toggle.
9. Switch to a not-yet-warmed office. **Expected**: auto-startup runs for
   that office's known agents.

## 5. Automated regression

```powershell
npm test                  # vitest unit suite
npm run test:e2e          # Playwright (auto-startup spec under tests/e2e/auto-startup.e2e.ts)
```

Spec 009 adds the following tests (see `plan.md` Phase 1 / tasks.md):

- `tests/unit/config/agentAutoStart.test.ts` — settings round-trip,
  defaults, corrupt-value recovery.
- `tests/unit/agents/autoStartCoordinator.test.ts` —
  `tryWarmCurrentOffice` filters by title + current-uuid (FR-005),
  no-double-spawn race (FR-006), one-per-app-session (FR-008), per-agent
  failure isolation (FR-007), fleet-exclusion (FR-020),
  `replaceSession` coalescing (FR-014), setting-OFF gate for replace
  (FR-017).
- `tests/e2e/auto-startup.e2e.ts` —
  - A1 cold-launch warms only titled agents in office-0.
  - A2 office switch warms office-1's titled agents and does not respawn
    office-0.
  - A3 second visit to a warmed office spawns nothing.
  - A4 Settings OFF prevents all three triggers across cold+switch+new.
  - A5 New Session lands back in `ready` with a different session uuid.
  - A6 Close Session ends in `slacking` and stays there.
  - A7 Rapid New Session double-click yields exactly one PTY.

> e2e tests seed `.data/` manually after wiping (T12 pattern, see
> `tests/e2e/ui-smoke.e2e.ts:422`), bypassing `bootColdOffice` which
> would wipe the seed.

## 6. Pitfalls / gotchas

- If you see two terminals for the same agent: the server-side dedup in
  `terminalStart` failed. Inspect `electron/terminal/server.ts` PTY map
  bookkeeping; do NOT add a renderer-side mutex (that would mask the bug).
- If switching offices retriggers warming: `WarmedOfficeRegistry` is not
  reading from `sessionStorage` on construction, or `mark()` is not
  writing back. See `data-model.md` §2.
- If the Settings toggle does not persist: `setAgentAutoStartSettings` is
  not writing `localStorage`, or the panel is not re-reading on open. See
  `notifications.ts` for the reference pattern.
- If the overlay pops open during auto-startup: the coordinator is calling
  `openAgentTerminal` instead of the headless `warmAgentSession` helper.
  See research.md §R5.
