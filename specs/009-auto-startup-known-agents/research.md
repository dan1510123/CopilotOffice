# Research — Auto-Startup of Known Agents (spec 009)

**Status**: Phase 0 complete. All NEEDS CLARIFICATION resolved against the existing
worktree code (`009-auto-startup-known-agents`, base commit `a6007e7`). No external
dependencies considered — everything is wired against primitives already in the
renderer / preload bridge / terminal server.

The spec described four behavior rules. Each one had at least one open "wire it to
*which* function?" question. This document records the answers and the rejected
alternatives so Phase 1 / `/speckit.tasks` can proceed without re-discovering them.

---

## R1. "Start one agent" primitive — what does auto-startup call?

- **Decision**: Auto-startup calls `openAgentTerminal(agentId)` in `src/main.ts`
  (line ~1144) for each qualifying agent. This is the same function the dashboard
  card click and the `__copilotOfficeDebug.openAgentTerminal` hook already use
  (see `src/main.ts:1502-1508` for the card click path, `src/main.ts:457-459` for
  the debug bridge). In game mode it emits `open:agent:terminal` which the
  scene/overlay handles; in serious mode it routes through
  `seriousTerminalController.openAgentTerminal()`. The function tolerates the
  same `agentId` being requested while the underlying PTY is already alive — the
  server's `terminalStart` IPC short-circuits when `current[agentId]` is already
  bound (`electron/terminal/server.ts` PTY map), which is what gives us the
  no-double-spawn guarantee for FR-006/SC-005 for free.
- **Rationale**: Spec Assumption explicitly designates the manual press-E /
  click-card path as the canonical primitive. Reusing it preserves session
  resume semantics (Principle III) and means auto-startup inherits every
  badge/status/notification surface the manual path already drives — no
  parallel spawn path, no parallel state machine, no new IPC.
- **Alternatives rejected**:
  - *Call `terminalStart` directly from the renderer.* Would skip overlay /
    serious-panel wiring, leaving the UI in an inconsistent "PTY exists but no
    view ever attached" state on the next user click. Also bypasses the
    `selectedAgentId` bookkeeping that game↔serious mode flips depend on
    (`src/main.ts:1149`).
  - *New IPC `terminal-warm-known-agents`.* Rejected (Principle V): existing
    typed surfaces are sufficient and adding a new bridge method just to wrap
    a renderer-side loop hides logic in main that belongs in the renderer.
- **Note on game vs serious mode**: Auto-startup MUST be allowed to spawn the
  PTY even when no terminal view is currently open (the whole point is to be
  warm by the time the user walks over). `openAgentTerminal` in game mode
  emits `open:agent:terminal` which today *also opens the overlay*. To avoid
  popping up an overlay the user didn't ask for, auto-startup uses a slimmer
  primitive — see R5.

## R2. "New Session" / "Close Session" — what controls do we hook?

- **Decision**: The two buttons live in `TerminalOverlay` (game mode) and
  `SeriousTerminalController` (serious mode):
  - `TerminalOverlay.handleNewSession()` (`src/ui/TerminalOverlay.ts:1024`,
    bound at line 935). Already does: kill+restart in-place, calling
    `window.copilotBridge.resetSession()` followed by `terminalStart()`. To
    satisfy FR-012 we extend this to **finish in `ready`** without the user
    pressing E (today it relies on the in-place restart already being active);
    in practice this already lands in `ready` because `handleNewSession` calls
    `terminalStart` synchronously after the reset. The change is: also fire
    `openAgentTerminal` when called from a path where the overlay is NOT
    currently open (e.g. fleet scenarios), and gate the auto-restart half of
    the chain behind the new setting.
  - `TerminalOverlay.handleCloseSession()` (`src/ui/TerminalOverlay.ts:1081`,
    bound at line 951). Already does: `resetSession()` + leave session
    closed. FR-013 wants exactly this — no change needed beyond explicitly
    documenting "do NOT auto-restart" and adding a unit test.
  - `SeriousTerminalController.handleNewSession()` (line 596) →
    `startNewSession()` (line 448). Same pattern; same change.
  - `SeriousTerminalController.handleCloseSession()` (line 613). Already
    matches FR-013 (calls `resetSession` then `closeView({ detach: true })`).
- **Rationale**: Both controls already call `resetSession`, which on the
  server side closes the PTY and clears `current[agentId]`. The only behavior
  delta this spec introduces for "New Session" is: when the auto-startup
  setting is ON, chain a fresh `terminalStart`/`openAgentTerminal` after the
  reset resolves, and coalesce concurrent clicks. "Close Session" needs no
  behavior change at all.
- **Coalescing strategy (FR-014, SC-008)**: Per-agent in-flight promise stored
  in a `Map<agentId, Promise<void>>` owned by the new
  `AgentAutoStartCoordinator` (see data-model). `handleNewSession` becomes:
  ```
  if (coordinator.hasReplaceInFlight(agentId)) return coordinator.awaitReplace(agentId);
  return coordinator.replaceSession(agentId);
  ```
  Inside `replaceSession`: `await resetSession; if (setting.on) await openAgentTerminal;`.
  The cleared map entry happens in a `finally` so a failed run does not wedge
  subsequent clicks (FR-015).
- **Alternatives rejected**:
  - *Per-button debounce.* Would not coalesce New Session clicked across the
    two surfaces (game-mode overlay then serious-mode panel for the same
    agent). The coordinator is per-agent, not per-button.
  - *Move the chaining into the preload bridge.* Cleaner-looking but hides
    renderer state (the setting toggle and the in-flight map are renderer
    state) from inspection and breaks the existing convention that
    `copilotBridge` is a thin pass-through (`electron/terminal/preload.ts`).

## R3. Settings surface — where does the toggle live?

- **Decision**: Extend `SettingsPanel` (`src/ui/SettingsPanel.ts`). It is
  already the single user-facing settings overlay, already follows the
  pattern of `localStorage`-persisted typed config (mirroring
  `src/config/notifications.ts:86-112`), already has `onOpen` / `onClose`
  hooks that route through the input/focus discipline (Principle II), and is
  what the toolbar `#settings-btn` opens (`src/main.ts:692-694`). Add a new
  section "Agents" above the existing "Notifications" section with a single
  checkbox: **Auto-start known agents**, default ON.
- **Persistence**: Add `src/config/agentAutoStart.ts` mirroring
  `src/config/notifications.ts`:
  - `STORAGE_KEY = 'copilot-office-agent-auto-start'`
  - `interface AgentAutoStartSettings { autoStartKnownAgents: boolean }`
  - `getAgentAutoStartSettings()` reads localStorage with default `{ autoStartKnownAgents: true }`
  - `setAgentAutoStartSettings(next)` writes localStorage
  - `resetAgentAutoStartSettings()` clears localStorage
- **Rationale**: Principle V (configuration-first), spec FR-016/FR-019
  explicit alignment with "the same configuration mechanism used by other
  Settings entries". `localStorage` is acceptable for a single boolean —
  notification settings already use it, no PII, default-on means a corrupt
  read fails open and the user keeps the documented default behavior.
- **Alternatives rejected**:
  - *Store in `.data/settings.json` via a new IPC.* Adds a bridge method
    and persistence path for one boolean; rejected as over-engineering.
    `localStorage` is per-app-install which matches the spec's "across app
    restarts" requirement.
  - *Build a brand-new `AgentSettingsPanel` overlay.* Rejected — Principle V
    says extend existing config surfaces before introducing new ones.

## R4. "Office already warmed this session" — where does the tracker live?

- **Decision**: A renderer-scoped module-level `Set<officeId>` named
  `warmedOfficeIds`, owned by the same new `AgentAutoStartCoordinator`
  module (`src/agents/AutoStartCoordinator.ts`). Populated by
  `tryWarmCurrentOffice()` after a successful spawn pass for that office.
- **Trigger plumbing**:
  - **Cold-launch trigger (rule #1)**: Fired from the existing
    `officeManager.onOfficesUpdated` callback in `src/main.ts:2314`. The
    callback already runs after both the synchronous localStorage apply
    AND the async durable load resolves, which is exactly the moment the
    real `currentOfficeId` is known and `fetchSessionMeta()` has been
    re-issued. Wire `void coordinator.tryWarmCurrentOffice()` as the LAST
    step inside the callback, after `fetchSessionMeta()`.
  - **Office-switch trigger (rule #2)**: Fired from `switchToOffice` in
    `src/main.ts:710` after `fetchSessionMeta()` resolves. Same
    `coordinator.tryWarmCurrentOffice()` call. The tab-click handler
    early-returns if `officeId === currentOfficeId` (line 643) so back-to-back
    clicks on the same tab cannot re-trigger.
  - **Coalescing across cold-launch + first onOfficesUpdated**: Because
    `tryWarmCurrentOffice` consults `warmedOfficeIds`, calling it twice for
    the same office is a safe no-op. We rely on this rather than trying to
    detect "is this the cold-launch path or a switch?".
- **Renderer reload note**: Per spec Assumption "Per app session means a
  single Electron main-process lifetime. A renderer reload … is treated as
  a continuation of the same app session and does not re-trigger auto-startup
  for any office." The naïve in-memory `Set` would re-warm on every renderer
  reload, which would violate FR-008/SC-007 if reloads occur. Resolution:
  also persist `warmedOfficeIds` in `sessionStorage` (NOT `localStorage`).
  `sessionStorage` survives renderer reloads inside the same window but does
  not survive app restart, which is exactly the desired scope.
- **Rationale**: Centralizing both the per-office set and the per-agent
  in-flight map in one coordinator object keeps the three triggers
  (cold-launch, office-switch, post-New-Session) calling into a single
  decision point that holds the gating logic — Principle II (one explicit
  boundary instead of three independent timers).
- **Alternatives rejected**:
  - *Store warmed set in `officeManager`.* Couples office-state lifecycle to
    auto-startup state, which is exactly the cross-layer coupling Principle II
    forbids. The set has nothing to do with which offices exist.
  - *Re-check `queryAgentStatuses` every time and skip "already alive" agents
    instead of tracking warmed offices.* Would still spawn fresh PTYs for
    agents the user manually closed since last warm — that's not what
    "already warmed this session" means and SC-007 wants exactly one pass
    per office.

## R5. Avoiding overlay-pop on auto-startup (game mode)

- **Decision**: Auto-startup does NOT call `openAgentTerminal(agentId)`
  directly because in game mode that emits `open:agent:terminal` which the
  scene handles by *opening the terminal overlay*. Instead the coordinator
  calls a new renderer-private helper `warmAgentSession(officeId, agentId)`
  that mirrors the relevant subset of `openAgentTerminal`:
  - Calls `window.copilotBridge.terminalStart(officeId, agentId, ...)` to
    spawn the PTY with the persisted session uuid, identical to the args
    the overlay path uses.
  - Updates `selectedAgentId`? **No.** This is critical: spec NFR is the
    user never sees the active agent change. The selection MUST remain
    whatever it was (likely `null` on cold boot, or the agent the user
    last had open).
  - Does NOT emit `open:agent:terminal` and does NOT call
    `seriousTerminalController.openAgentTerminal`. The status badge
    transitions (`slacking → starting → ready`) flow through the existing
    per-agent status event channel which the dashboard subscribes to
    regardless of overlay state.
- **Rationale**: FR-004 wants the badge transitions visible (this happens via
  the existing status channel) but the spec is silent on opening the
  overlay — and the user story (S1) explicitly contrasts "by the time the
  user walks over and presses E, the agent is already ready", implying the
  terminal view is NOT auto-opened. Popping the overlay would also steal
  focus from the Phaser scene, violating Principle II focus discipline.
- **Manual-interaction race (FR-006)**: When the user presses E while
  `warmAgentSession` is in flight, the press-E handler still calls
  `openAgentTerminal`, which calls `terminalStart` — but the server-side
  PTY map already has an alive entry, so `terminalStart` reattaches rather
  than spawning a second PTY. Verified by inspection of
  `electron/terminal/server.ts:269+`. No code change needed for this guard;
  unit test will assert it.
- **Alternatives rejected**:
  - *Reuse `openAgentTerminal` and have it accept a `{ headless: true }`
    flag.* Spreads the headless concept into the overlay/serious paths that
    don't need to know about it. The factoring is cleaner with a sibling
    helper that only does the PTY warm.

## R6. e2e test seeding — surviving `bootColdOffice`

- **Decision**: New e2e tests follow the pattern established by T12
  (`tests/e2e/ui-smoke.e2e.ts:422`). `bootColdOffice` wipes `.data/` and
  then launches asynchronously; T12 launches Electron *directly* with
  `_electron.launch()` after manually seeding `.data/{officeId}.sessions.json`,
  bypassing `bootColdOffice`. New tests for spec 009 do the same:
  1. Compute `dataDir = path.join(cwd, '.data')`.
  2. Wipe + recreate it.
  3. Write `.data/office-0.sessions.json` with crafted `current` + `metadata`
     entries (some titled, some not).
  4. Write the matching multi-office persistence file the durable load
     reads (so `currentOfficeId === 'office-0'` is honored on boot).
  5. Launch via `_electron.launch({ args: [main.js], env: { COPILOT_E2E: '1' }})`.
  6. Assert via the `__copilotOfficeDebug` hook that the targeted agent
     IDs reach `ready` without any synthetic click.
- **Rationale**: T12 is the reference implementation for this exact problem.
  Re-using its pattern keeps the test infrastructure consistent and the
  helper functions in `tests/e2e/_helpers/` already cover the
  `__copilotOfficeDebug` polling we need.
- **Status assertion**: Use `window.copilotBridge.queryAgentStatuses(officeId)`
  (exposed in preload.ts:67) — returns `{ alive, ready, inTurn }` per agent.
  Wait for `status.alive && status.ready` for each targeted agent ID within
  a generous timeout (10s) to cover CI variance. In E2E mode the PTY runs
  `launchMode='shell'` so "ready" arrives immediately after spawn rather
  than waiting on the real `copilot` CLI.

## R7. Setting OFF mid-session — what happens to in-flight work?

- **Decision**: Per FR-018, the setting gates *trigger evaluation* only,
  not *in-flight work*. Implementation: each of the three trigger entry
  points (`coordinator.tryWarmCurrentOffice`, `coordinator.replaceSession`)
  reads `getAgentAutoStartSettings().autoStartKnownAgents` ONCE at the top
  and bails early if false. Once past that check, the work runs to
  completion regardless of subsequent toggle changes.
- **Rationale**: This is the simplest reading of "in-flight spawns continue
  to completion" — once we've decided to warm an office, abandoning
  half-spawned PTYs would just create orphans the server tracks but the
  renderer thinks were never started.
- **Alternative rejected**: Polling the setting between spawns would allow
  finer-grained interruption but produce a partially-warmed office, which
  is harder to reason about than "we either warmed it or we didn't".

---

## Inventory of touched / new modules

| Module | Action | Notes |
|---|---|---|
| `src/config/agentAutoStart.ts` | NEW | Settings storage (R3). Mirrors `notifications.ts`. |
| `src/agents/AutoStartCoordinator.ts` | NEW | Owns `warmedOfficeIds`, per-agent in-flight maps, `tryWarmCurrentOffice()`, `replaceSession()`, `warmAgentSession()` helper (R4, R5). |
| `src/ui/SettingsPanel.ts` | MODIFY | Add "Agents" section with the new checkbox (R3). |
| `src/main.ts` | MODIFY | Wire `coordinator.tryWarmCurrentOffice()` into `onOfficesUpdated` and `switchToOffice`. Instantiate coordinator with dependencies. (R4) |
| `src/ui/TerminalOverlay.ts` | MODIFY | `handleNewSession` delegates the post-close re-spawn to `coordinator.replaceSession` (FR-012/14, gated by setting). `handleCloseSession` unchanged (FR-013). (R2) |
| `src/ui/SeriousTerminalController.ts` | MODIFY | Same delegation pattern as overlay for `handleNewSession`. (R2) |
| `tests/unit/agents/autoStartCoordinator.test.ts` | NEW | Unit coverage for warmedOfficeIds, in-flight coalescing, setting gate, fleet-exclusion. |
| `tests/unit/config/agentAutoStart.test.ts` | NEW | Settings round-trip + default. |
| `tests/e2e/auto-startup.e2e.ts` | NEW | Cold-launch warm, office-switch warm, setting-OFF gate, New Session auto-restart, Close Session no-restart (R6). |
| `electron/**` | UNCHANGED | No new IPC; server-side de-dup already covers FR-006. |
