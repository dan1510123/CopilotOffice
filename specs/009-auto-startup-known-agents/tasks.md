---
description: "Tasks for Auto-Startup of Known Agents (spec 009)"
---

# Tasks: Auto-Startup of Known Agents

**Input**: `specs/009-auto-startup-known-agents/` (plan.md, spec.md, research.md, data-model.md, contracts/README.md, quickstart.md)
**Branch**: `009-auto-startup-known-agents`
**Worktree**: `C:\Users\danielluo\repos\CopilotOffice-worktree-next-steps-20260603-133614`

**Tests**: Tests are REQUIRED for this feature. The constitution mandates regression coverage for terminal/session lifecycle, office switching, and settings/focus touches (Principle IV), and `plan.md` §"Regression validation scope defined" enumerates the vitest + Playwright suites that ship with the feature. Tests are written FIRST and must FAIL before implementation per Constitution Principle IV.

## Constitution-Driven Task Requirements (applied)

- **Configuration-first**: `T201` introduces the typed `AgentAutoStartSettings` module mirroring `src/config/notifications.ts`. No hardcoded agent IDs anywhere.
- **Terminal/session lifecycle**: every spawn path goes through the existing `terminalStart`; every close through the existing `resetSession`. Regression tasks `T401`, `T402`, `T501`, `T503`, `T505` cover this.
- **Office switching**: `T403` regression covers cold-launch + switch + second-visit.
- **InputManager focus discipline**: `T504` asserts the headless warm path does NOT pop the overlay or steal focus from Phaser.
- **Phaser-first boundaries**: `T303` is a DOM-only `SettingsPanel` change; no new canvas surfaces are introduced (validated by `T503`).
- **Worktree-aware verification (Principle VII)**: `T701` rebuilds bundles in this worktree before running e2e; `T703` greps `dist/game.bundle.js` for `AutoStartCoordinator` to confirm the right checkout is being executed.

## Format: `[ID] [P?] [Story] Description`

- `[P]`: independent, parallelizable (different files, no in-phase ordering)
- `[Story]`: `US1` cold-launch, `US2` office-switch, `US3` New/Close Session, `US4` Settings toggle
- Each task includes the exact file path it touches.

---

## Phase 1: Setup

**Purpose**: confirm the worktree is buildable before any new code lands.

- [X] T101 Confirm dependencies install cleanly in this worktree by running `npm install` from the worktree root and verifying `node_modules/phaser`, `node_modules/xterm`, and `node_modules/node-pty` exist.
- [X] T102 [P] Capture the green baseline declared in `plan.md` Technical Context (204/204 unit, 8/8 e2e) by running `npm test` and `npm run test:e2e` from the worktree root and recording the pass count in your scratch notes. Failures here are baseline regressions and MUST be triaged before starting Phase 2.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: create the shared module skeletons (settings + coordinator) that every user story depends on. No behavior change yet — the coordinator is not wired into any trigger until the user-story phases.

**⚠️ CRITICAL**: US1/US2/US3/US4 cannot begin until Phase 2 is complete.

- [X] T201 Create the typed settings module at `src/config/agentAutoStart.ts` mirroring `src/config/notifications.ts`: export `interface AgentAutoStartSettings { autoStartKnownAgents: boolean }`, `DEFAULT_AGENT_AUTO_START_SETTINGS = { autoStartKnownAgents: true }`, `STORAGE_KEY = 'copilot-office-agent-auto-start'`, and `getAgentAutoStartSettings() / setAgentAutoStartSettings(next) / resetAgentAutoStartSettings()` with fail-open semantics per data-model.md §1 (missing key → default; JSON parse error → default + clear; non-boolean field → default).
- [X] T202 [P] Create the coordinator module skeleton at `src/agents/AutoStartCoordinator.ts` exporting the `AutoStartCoordinatorDeps` interface and the `AutoStartCoordinator` class with the public signatures from data-model.md §4 (`tryWarmCurrentOffice(): Promise<string[]>`, `replaceSession(officeId, agentId): Promise<void>`). Include the internal `WarmedOfficeRegistry` and `AgentReplaceTracker` helper classes as non-exported (or `@internal` exports for unit testing) per data-model.md §2 and §3. Method bodies may be stubs that throw `not implemented` — wiring lands in Phase 3+.
- [X] T203 [P] Add a `tests/unit/agents/` directory and a placeholder `tests/unit/agents/.gitkeep` so the vitest config picks up the new path; verify `npm test` still passes with zero new tests after this task (no behavior change).

**Checkpoint**: skeleton compiles, baseline still green, no user-visible change.

---

## Phase 3: User Story 1 — Returning user finds known agents already warm on cold launch (Priority: P1) 🎯 MVP

**Goal**: when the app cold-launches, every agent in the boot office that has a non-empty title AND a `current[agentId]` uuid in `.data/{officeId}.sessions.json` transitions `slacking → starting → ready` without any user interaction, while respecting the per-office-once guarantee and never popping the terminal overlay.

**Independent Test**: spec.md §"User Story 1 / Independent Test" — seed `.data/office-0.sessions.json` with at least one titled agent + current uuid, launch the app, observe the badge cycle and confirm pressing E shows the resumed session (not a fresh one).

### Tests for User Story 1 (write FIRST, must FAIL)

- [X] T301 [P] [US1] Add `tests/unit/config/agentAutoStart.test.ts` covering: default returned when key missing; round-trip via `set`/`get`; corrupt JSON in storage → default returned AND key cleared; non-boolean field type → default returned (data-model.md §1 validation rules).
- [X] T302 [P] [US1] Add `tests/unit/agents/autoStartCoordinator.test.ts` with the `tryWarmCurrentOffice` cases: (a) setting OFF short-circuits to `[]` (FR-018); (b) `getCurrentOfficeId()` null short-circuits to `[]`; (c) office already in `WarmedOfficeRegistry` short-circuits to `[]` (FR-008); (d) qualifying filter — only agents with non-empty trimmed title AND a `current` uuid are kicked off (FR-005); (e) fleet sub-agent IDs are NEVER kicked off because `getCanonicalAgentIds` excludes them (FR-020); (f) per-agent failure isolation — one `warmAgentSession` rejection does not abort the others (FR-007); (g) `warmedOfficeIds` is marked BEFORE the spawn loop runs (re-entry safety, research.md §R4); (h) `WarmedOfficeRegistry` rehydrates from `sessionStorage` on construction and writes back on `mark()` (data-model.md §2). Use stub `Deps` and an in-memory `sessionStorage` mock. ALL tests MUST fail before T303 lands.

### Implementation for User Story 1

- [X] T303 [US1] Implement the full body of `AutoStartCoordinator.tryWarmCurrentOffice()` in `src/agents/AutoStartCoordinator.ts` per the algorithm in data-model.md §4 (setting check → currentOffice check → warmed check → mark warmed BEFORE spawn → roster from `getCanonicalAgentIds` → filter by `meta[id].title.trim()` and `getCurrentSessionId` → kick off `deps.warmAgentSession` in parallel, each individually try/caught). Implement `WarmedOfficeRegistry` hydration/persistence against `sessionStorage` with key `copilot-office-auto-start:warmed`. Make all T301/T302 tests pass.
- [X] T304 [US1] Add the headless `warmAgentSession(officeId, agentId)` helper invoked by the coordinator (research.md §R5) inside `src/main.ts` (the natural home alongside `openAgentTerminal` at ~line 1144). It MUST: (a) call `window.copilotBridge.terminalStart(officeId, agentId, workingDir, undefined, undefined, undefined, launchMode)` with the persisted session uuid; (b) NOT mutate `selectedAgentId`; (c) NOT emit `open:agent:terminal`; (d) NOT call `seriousTerminalController.openAgentTerminal`. Wire the function into the `AutoStartCoordinatorDeps.warmAgentSession` dependency when constructing the coordinator instance.
- [X] T305 [US1] Instantiate the `AutoStartCoordinator` in `src/main.ts` near the existing officeManager construction, supplying the full `Deps` object: `getCurrentOfficeId` (reads `currentOfficeId`), `getCanonicalAgentIds` (rosters + customAgents for the office, EXCLUDING fleet sub-agents — FR-020), `getSessionMeta` (returns `cachedSessionMeta[officeId]`), `getCurrentSessionId` (reads from the same cache), `getAgentLaunchConfig` (returns `{ workingDir, launchMode }` for the agent), `resetSession` (wraps `window.copilotBridge.resetSession`), `warmAgentSession` (the T304 helper), `getSettings` (calls `getAgentAutoStartSettings()`).
- [X] T306 [US1] Wire the cold-launch trigger: inside the existing `officeManager.onOfficesUpdated` callback in `src/main.ts` (~line 2314 per research.md §R4), after `fetchSessionMeta()` resolves, add `void coordinator.tryWarmCurrentOffice();` as the LAST step in the callback. Do NOT await — the call is non-blocking (FR-003).
- [X] T307 [US1] Add e2e `tests/e2e/auto-startup.e2e.ts` scenario **A1**: following the T12 seeding pattern (`tests/e2e/ui-smoke.e2e.ts:422`), wipe `.data/`, write `.data/office-0.sessions.json` with two agents (one titled + `current` uuid, one untitled), write the multi-office persistence file so `currentOfficeId === 'office-0'` on boot, launch Electron with `_electron.launch({ env: { COPILOT_E2E: '1' }})`, poll `window.copilotBridge.queryAgentStatuses('office-0')` until the titled agent reports `{ alive: true, ready: true }` within 10s, and assert the untitled agent stays `{ alive: false }` (FR-005). Test MUST fail before T303-T306 and pass after.

**Checkpoint**: cold-launch warm works end-to-end; quickstart §1 passes manually.

---

## Phase 4: User Story 2 — User switches office and finds its known agents warming up (Priority: P1)

**Goal**: switching to a not-yet-warmed office triggers the same warm-pass for that office's qualifying agents; switching back to an already-warmed office triggers nothing.

**Independent Test**: spec.md §"User Story 2 / Independent Test" — boot with office X warmed, switch to office Y (populated), observe Y agents go `slacking → starting → ready`, switch back to X and observe no respawn.

### Tests for User Story 2 (write FIRST, must FAIL)

- [X] T401 [P] [US2] Extend `tests/unit/agents/autoStartCoordinator.test.ts` with the second-visit case: calling `tryWarmCurrentOffice()` twice for the same `getCurrentOfficeId()` returns `[]` on the second call and does NOT invoke `deps.warmAgentSession` a second time (FR-008 / SC-007). Add a third case asserting that switching `getCurrentOfficeId()` to a different office triggers a fresh warm pass for THAT office only.

### Implementation for User Story 2

- [X] T402 [US2] Wire the office-switch trigger in `src/main.ts` `switchToOffice` (~line 710 per research.md §R4): immediately after the existing `fetchSessionMeta()` resolves for the newly-selected office, add `void coordinator.tryWarmCurrentOffice();`. Place the call AFTER the `selectedAgentId` reset and AFTER the cached meta update so the coordinator sees the post-switch state. Do NOT await.
- [X] T403 [US2] Add e2e `tests/e2e/auto-startup.e2e.ts` scenario **A2 + A3**: with `.data/office-0` and `.data/office-1` both seeded (each with a titled agent), launch the app, wait for A1 conditions on office-0, then trigger an office switch via the `__copilotOfficeDebug` hook (or the office tab DOM click), poll `queryAgentStatuses('office-1')` until the titled office-1 agent reaches `ready` (A2), then switch back to office-0 and assert via a debug counter (or log scrape) that NO additional `terminalStart` was issued for office-0 (A3 — second-visit no respawn).

**Checkpoint**: office-switch warm + second-visit no-op both pass.

---

## Phase 5: User Story 3 — "New Session" returns the agent straight to ready; "Close Session" leaves it slacking (Priority: P2)

**Goal**: clicking New Session on a `ready` agent transitions `ready → closing → starting → ready` on a fresh session uuid with no further user interaction; rapid double-clicks coalesce to one PTY; Close Session ends in `slacking` and STAYS there.

**Independent Test**: spec.md §"User Story 3 / Independent Test" — `ready` on uuid U1, click New Session, observe automatic return to `ready` on U2 ≠ U1; then click Close Session and observe steady `slacking`.

### Tests for User Story 3 (write FIRST, must FAIL)

- [X] T501 [P] [US3] Extend `tests/unit/agents/autoStartCoordinator.test.ts` with `replaceSession` cases: (a) when `tracker.has(agentId)` is true, returns the existing promise WITHOUT calling `resetSession` or `warmAgentSession` again (FR-014 / SC-008 coalescing); (b) happy path with setting ON calls `resetSession` then `warmAgentSession` exactly once each, in that order; (c) setting OFF calls `resetSession` only and skips `warmAgentSession` (FR-017); (d) `tracker` entry is cleared in `finally` even when `warmAgentSession` rejects, so the next click is unblocked (FR-015).

### Implementation for User Story 3

- [X] T502 [US3] Implement `AutoStartCoordinator.replaceSession(officeId, agentId)` in `src/agents/AutoStartCoordinator.ts` per data-model.md §4 algorithm: tracker hit returns the in-flight promise; otherwise build `(async () => { await deps.resetSession(...); if (deps.getSettings().autoStartKnownAgents) await deps.warmAgentSession(...); })().finally(() => tracker.delete(agentId))`, register it in the tracker, return it. Make all T501 cases pass.
- [X] T503 [US3] Modify `src/ui/TerminalOverlay.ts` `handleNewSession` (~line 1024) to delegate the close+restart chain to `coordinator.replaceSession(officeId, agentId)` instead of inline `resetSession` + `terminalStart`. Preserve the existing in-overlay UI affordances (`[Starting new session...]` text, focus retention). Do NOT change `handleCloseSession` (FR-013 — Close stays as-is, just calls `resetSession`).
- [X] T504 [US3] Modify `src/ui/SeriousTerminalController.ts` `handleNewSession` (~line 596) and its `startNewSession` helper (~line 448) to delegate to `coordinator.replaceSession(officeId, agentId)` with the same coalescing semantics. Leave `handleCloseSession` (~line 613) unchanged.
- [X] T505 [US3] Add e2e `tests/e2e/auto-startup.e2e.ts` scenarios **A5 + A6 + A7**: A5 — manually press E on a `ready` agent, click New Session via the overlay DOM, poll until `queryAgentStatuses` shows `ready` again, assert the `current[agentId]` uuid in `.data/office-0.sessions.json` differs from the pre-click value. A6 — click Close Session and assert the agent reports `{ alive: false }` and remains so for ≥ 3s (no spurious restart). A7 — issue two `coordinator.replaceSession(...)` calls back-to-back via `__copilotOfficeDebug` (or simulate a rapid double-click), and assert via a debug counter that `terminalStart` was invoked exactly once during the replacement window (SC-005 / SC-008).

**Checkpoint**: New Session → ready, Close Session → stays slacking, double-click → one PTY.

---

## Phase 6: User Story 4 — User can disable auto-startup from Settings (Priority: P2)

**Goal**: the `SettingsPanel` exposes an "Auto-start known agents" checkbox (default ON) that, when OFF, suppresses all three triggers (cold-launch, office-switch, post-New-Session restart) without affecting in-flight work; setting persists across app restarts.

**Independent Test**: spec.md §"User Story 4 / Independent Test" — toggle OFF, quit, relaunch with seeded data, observe no auto-startup; switch offices, observe no auto-startup; press E manually to reach `ready`, click New Session, observe agent ends in `slacking` (NOT auto-restarted); re-enable, switch to a not-yet-warmed office, observe warm pass.

### Tests for User Story 4 (write FIRST, must FAIL)

- [X] T601 [P] [US4] Add `tests/unit/ui/settingsPanel.agents.test.ts` (or extend the existing settings panel unit test if present) asserting: the panel renders an "Agents" section above "Notifications" with a single checkbox labeled "Auto-start known agents"; checkbox defaults to checked when `localStorage` is empty; toggling and closing the panel writes `{ autoStartKnownAgents: false }` to `localStorage` under key `copilot-office-agent-auto-start`; re-opening reflects the persisted value. Use jsdom + the same harness `notifications` settings tests use.

### Implementation for User Story 4

- [X] T602 [US4] Modify `src/ui/SettingsPanel.ts` to add a new "Agents" section above the existing "Notifications" section, rendering a single checkbox bound to `getAgentAutoStartSettings().autoStartKnownAgents`. On change, call `setAgentAutoStartSettings({ autoStartKnownAgents: <new value> })`. Reuse the existing focus/`onOpen`/`onClose` discipline — do NOT introduce a new overlay or new focus path (Principle II).
- [X] T603 [US4] Add e2e `tests/e2e/auto-startup.e2e.ts` scenario **A4**: seed `.data/` like A1, ALSO write `localStorage` (via Electron's `app.getPath('userData')` or by injecting a pre-launch script) to `{ "copilot-office-agent-auto-start": "{\"autoStartKnownAgents\":false}" }`, launch the app, assert that NO agent in any office reaches `alive: true` within 5s (cold-launch gate); programmatically switch offices and assert still nothing warms (switch gate); manually press E on an agent to make it `ready`, click New Session, assert it ends in `{ alive: false }` (the replace gate — FR-017 — performs reset-only when OFF).

**Checkpoint**: all three triggers respect the toggle; quickstart §4 passes manually.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T701 Rebuild bundles in this worktree (`npm run build`) and verify `dist/game.bundle.js` LastWriteTime is current per quickstart.md §0 — required so e2e launches the new code (Principle VII).
- [X] T702 [P] Run the full unit suite (`npm test`) and confirm: prior 204 baseline still green AND the new tests from T301, T302, T401, T501, T601 all pass. Investigate any regression before proceeding.
- [X] T703 [P] Run the full e2e suite (`npm run test:e2e`) and confirm the prior 8 e2e tests pass AND scenarios A1-A7 in `tests/e2e/auto-startup.e2e.ts` pass. Confirm via `Select-String -Path dist/game.bundle.js -Pattern "AutoStartCoordinator"` that the bundle actually contains the coordinator (Principle VII guard against running the wrong worktree's bundle).
- [X] T704 [P] Run the owner walkthrough in `specs/009-auto-startup-known-agents/quickstart.md` §§1-4 manually and tick the checkboxes mentally; file any deviations as follow-up issues.
- [X] T705 Add a brief feature note to `docs/` (or update `CODEBASE_INVENTORY.md` if that is the active inventory) describing: `src/config/agentAutoStart.ts`, `src/agents/AutoStartCoordinator.ts`, the three trigger sites in `src/main.ts` / `src/ui/TerminalOverlay.ts` / `src/ui/SeriousTerminalController.ts`, and the `localStorage` + `sessionStorage` keys introduced.
- [X] T706 Final lint/build: `npm run build` once more from a clean state and confirm zero TypeScript strict errors and zero new lint warnings.

---

## Dependencies & Execution Order

### Phase dependencies

- Setup (Phase 1) → Foundational (Phase 2) → US1 (Phase 3) → US2 (Phase 4) and US3 (Phase 5) in parallel → US4 (Phase 6) → Polish (Phase 7).
- US4 (Phase 6) depends on US1+US2+US3 being wired because its OFF-gate test (A4) exercises all three triggers.

### Inter-task dependencies (within story)

- T303 depends on T201, T202, T301, T302 (failing tests + skeletons).
- T304 depends on T303 (coordinator must accept the helper).
- T305 depends on T201, T202, T304.
- T306 depends on T305.
- T307 depends on T306.
- T402 depends on T305, T401.
- T403 depends on T402.
- T502 depends on T202, T501.
- T503 / T504 depend on T502 (different files — can run in parallel with each other).
- T505 depends on T503 and T504.
- T602 depends on T201, T601.
- T603 depends on T602 and US1/US2/US3 implementations (T306, T402, T503/T504).
- Phase 7 tasks depend on all Phase 3-6 work landing.

### Parallel opportunities

- **Within Phase 2**: T202 ∥ T203 (different files; T201 ordered first because T202 imports from it).
- **Within US1 tests**: T301 ∥ T302 (different test files).
- **Within US3**: T503 ∥ T504 (overlay vs serious controller; independent files).
- **Within Phase 7**: T702 ∥ T703 ∥ T704 (independent verification harnesses).
- **Across stories**: once Phase 3 (US1) lands, US2 (Phase 4) and US3 (Phase 5) can be worked on by two developers in parallel — US3 does not depend on US2's trigger wiring; US4 then sequentializes them.

---

## Parallel Example: User Story 1 tests

```bash
# Launch both US1 unit-test scaffolds in parallel (different files):
Task: "Add tests/unit/config/agentAutoStart.test.ts per T301"
Task: "Add tests/unit/agents/autoStartCoordinator.test.ts per T302"
```

## Parallel Example: User Story 3 implementation

```bash
# Once T502 lands the replaceSession method, the two UI delegations are independent:
Task: "Modify src/ui/TerminalOverlay.ts handleNewSession per T503"
Task: "Modify src/ui/SeriousTerminalController.ts handleNewSession per T504"
```

---

## Implementation Strategy

### MVP scope

US1 alone (Phase 1 + Phase 2 + Phase 3). That delivers the dominant user value — cold-launch warming — without touching the New Session/Close Session flow or the Settings UI. quickstart.md §1 is the MVP acceptance script.

### Incremental delivery

1. **MVP**: Setup → Foundational → US1 → ship/demo cold-launch warming.
2. **Increment 2**: add US2 (office-switch warming).
3. **Increment 3**: add US3 (New Session auto-restart + coalescing).
4. **Increment 4**: add US4 (Settings toggle) — explicitly ordered LAST because its A4 test exercises all three triggers' OFF paths and must run against the complete trigger surface.
5. Polish + final verification (Phase 7).

### Parallel team strategy

After Phase 3 lands, Developer A picks up US2 (single trigger site + one e2e scenario), Developer B picks up US3 (two UI files + three e2e scenarios). Then both converge on US4. Phase 7 (build/test/verify) is owned by whoever lands last.

---

## Notes

- Tests are written FIRST per Constitution Principle IV; verify each test FAILS before its implementation task lands.
- The constitution's "Configuration-first" principle is satisfied by T201's typed module — no consumer (overlay, serious controller, main) reads `localStorage` directly.
- "No new IPC, no new disk schema" is a hard invariant from contracts/README.md — if any task here grows a new `copilotBridge.*` method or a new `.data/*` file, treat it as a design defect and revisit research.md before proceeding.
- `WarmedOfficeRegistry` persists to `sessionStorage` (not `localStorage`) so renderer reloads do not re-warm but Electron quits DO — see data-model.md §2 lifetime semantics.
- All e2e scenarios A1-A7 live in a single file `tests/e2e/auto-startup.e2e.ts` per quickstart.md §5, sharing the T12 seeding helper pattern.
