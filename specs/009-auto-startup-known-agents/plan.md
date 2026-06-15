# Implementation Plan: Auto-Startup of Known Agents

**Branch**: `009-auto-startup-known-agents` | **Date**: 2026-06-12 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/009-auto-startup-known-agents/spec.md`

## Summary

Wire three auto-startup triggers (cold-launch warm, office-switch warm, post-"New Session" auto-restart) and a global "Auto-start known agents" Settings toggle (default ON) onto the existing per-agent terminal lifecycle, without introducing any new IPC, any new disk schema, or any parallel spawn path. All four spec rules are implemented as renderer-side orchestration over existing primitives: `openAgentTerminal` / `terminalStart` (canonical "start one agent"), `resetSession` (canonical "close session"), `getAllSessionMeta` (read-only title check), and the existing per-agent status badge state machine. A new `AutoStartCoordinator` owns the three trigger entry points, a `WarmedOfficeRegistry` (in-memory + `sessionStorage` to survive renderer reloads but not Electron quits), and a per-agent `AgentReplaceTracker` for coalescing rapid "New Session" clicks. The settings toggle is added as a new "Agents" section in the existing `SettingsPanel`, persisted in `localStorage` in the same shape as `notifications.ts`.

## Technical Context

**Language/Version**: TypeScript 5 (strict), targeting Electron 40 (Chromium renderer + Node main)
**Primary Dependencies**: Phaser 3 (renderer), xterm.js + node-pty (terminal lifecycle), esbuild (bundler). No new runtime deps.
**Storage**: `localStorage` for the new boolean setting (`copilot-office-agent-auto-start`); `sessionStorage` for the `warmedOfficeIds` registry; `.data/{officeId}.sessions.json` consumed read-only via existing `copilotBridge.getAllSessionMeta`.
**Testing**: vitest (`tests/unit/**`) + Playwright (`tests/e2e/**`, `_electron` harness). Baseline on this branch: 204/204 unit + 8/8 e2e green.
**Target Platform**: Electron 40 desktop (Windows-primary, cross-platform). Renderer-process scope.
**Project Type**: Desktop app (single Electron main + renderer split). No backend, no library separation.
**Performance Goals**: SC-002 — no user-noticeable regression in time-to-first-interaction; auto-startup is async and non-blocking. SC-003 — up to 8 known agents reach `ready` in a small multiple of single-agent manual startup (i.e., parallel spawn, not serialized).
**Constraints**: SC-005 zero double-spawn (renderer must not race the server's own dedup); FR-008 exactly one warm pass per office per app session even across renderer reloads (motivates the `sessionStorage` registry); FR-018 setting gates triggers only, not in-flight work; FR-020 fleet sub-agents excluded.
**Scale/Scope**: Typical user: 1-5 offices × 3-8 known agents. Worst-case in spec assumptions: 40+ known agents across 5+ offices, bounded by per-office laziness (rule #2) so concurrent PTYs stay proportional to *visited* offices, not *defined* offices.

## Constitution Check

*GATE: Pre-Phase-0 evaluation. Re-checked post-Phase-1 below.*

- [x] **Phaser-first constraint respected** — no new in-canvas renderer; status badges reuse the existing Phaser dashboard surface. Settings toggle reuses the existing DOM `SettingsPanel` overlay.
- [x] **Event-driven boundaries preserved** — auto-startup invokes the existing `openAgentTerminal` / `terminalStart` primitives; the post-New-Session chain reuses `resetSession` + `terminalStart`; the cold-launch trigger hooks into the existing `officeManager.onOfficesUpdated` event; the office-switch trigger hooks into the existing `switchToOffice` path. No new cross-layer coupling, no new IPC channel, no new `game.events` event.
- [x] **Input focus transitions routed through `InputManager`** — neither auto-startup nor "New Session" change focus state; the Settings panel already uses `onOpen`/`onClose` hooks that route through the existing focus discipline; the warming path is intentionally "headless" (does not open the overlay) so it cannot steal focus from the Phaser scene. See research.md §R5.
- [x] **Session lifecycle integrity maintained** — auto-startup is a new trigger on the existing per-agent state machine (`slacking → starting → ready → closing → slacking`); no new states; FR-006/FR-014 + server-side `terminalStart` dedup protect against duplicate PTYs; FR-009/FR-015 + per-agent try/catch ensure no agent is left wedged on failure; FR-020 explicitly excludes fleet sub-agent PTYs.
- [x] **Configuration-first approach used** — the boolean toggle is a typed config value in `src/config/agentAutoStart.ts`, mirroring the existing `src/config/notifications.ts` pattern. No hardcoded agent IDs; the roster comes from the existing office config + `customAgents`. The toggle gates trigger evaluation only (FR-018), so the conditional lives in the coordinator, not in the spawn path.
- [x] **Regression validation scope defined** — vitest covers settings round-trip, coordinator state transitions, fleet-exclusion, no-double-spawn, coalescing, setting-OFF gate. Playwright covers cold-launch warm, office-switch warm, second-visit no-respawn, setting-OFF across cold+switch+new, New Session ends in `ready`, Close Session ends in `slacking` and stays there, rapid New Session double-click → single PTY. High-risk flows from Principle IV (terminal lifecycle, office switching, settings/focus) are all exercised. Worktree-aware verification (Principle VII) called out in quickstart.md §0.

## Project Structure

### Documentation (this feature)

```text
specs/009-auto-startup-known-agents/
├── plan.md              # This file
├── spec.md              # Pre-existing — 4 stories, 20 FRs, 11 SCs
├── research.md          # Phase 0 — R1..R7 decisions
├── data-model.md        # Phase 1 — entities + algorithms
├── quickstart.md        # Phase 1 — owner-facing verification walkthrough
├── contracts/
│   └── README.md        # Phase 1 — explicitly "no new IPC", lists reused surfaces
└── tasks.md             # Phase 2 — generated later by /speckit.tasks
```

### Source Code (repository root)

This is a single-project Electron + Phaser app. The feature touches three
existing directories and adds one new sub-directory (`src/agents/`) for the
coordinator.

```text
src/
├── main.ts                          # MODIFY — wire coordinator into onOfficesUpdated + switchToOffice
├── config/
│   ├── agentAutoStart.ts            # NEW — typed settings + localStorage persistence
│   └── notifications.ts             # reference pattern (unchanged)
├── agents/                          # NEW — coordinator package
│   └── AutoStartCoordinator.ts      # NEW — orchestrator + WarmedOfficeRegistry + AgentReplaceTracker
├── ui/
│   ├── SettingsPanel.ts             # MODIFY — add "Agents" section with the toggle
│   ├── TerminalOverlay.ts           # MODIFY — handleNewSession delegates restart to coordinator (gated)
│   └── SeriousTerminalController.ts # MODIFY — handleNewSession delegates restart to coordinator (gated)
└── office/
    └── officeManager.ts             # UNCHANGED — onOfficesUpdated already fires at the right moment

electron/                            # UNCHANGED — no new IPC, server-side PTY dedup already covers FR-006

tests/
├── unit/
│   ├── config/agentAutoStart.test.ts            # NEW
│   └── agents/autoStartCoordinator.test.ts      # NEW
└── e2e/
    ├── auto-startup.e2e.ts                      # NEW — A1..A7 scenarios (see quickstart §5)
    └── _helpers/                                # reused (sessions-json seeding pattern from ui-smoke T12)
```

**Structure Decision**: Single-project layout. The new `src/agents/` directory is
introduced because (a) the coordinator owns cross-cutting orchestration over
office/terminal/settings that does not belong in any single existing directory,
and (b) future spec extensions (per-agent opt-out, smarter title-change handling
called out in the spec's Assumptions) will likely live in the same package. The
co-located helper classes (`WarmedOfficeRegistry`, `AgentReplaceTracker`) stay
in `AutoStartCoordinator.ts` as internal exports for unit testing.

## Constitution Check (Post-Phase 1 Re-Check)

- [x] **Phaser-first** — confirmed by Phase 1 design: no new canvas surfaces; toggle in `SettingsPanel`.
- [x] **Event-driven boundaries** — confirmed: coordinator depends on injected functions (Deps interface in data-model §4), not on direct module imports of `officeManager`/`SeriousTerminalController`. This keeps the test boundary clean and ensures the coordinator is a pure consumer of the existing event surfaces.
- [x] **InputManager focus discipline** — confirmed: research.md §R5 explicitly forbids the headless warm path from calling `openAgentTerminal` (which would pop the overlay and grab focus). The post-New-Session restart runs from within an already-open overlay/panel, so no new focus transition is introduced.
- [x] **Session lifecycle integrity** — confirmed: every spawn path goes through existing `terminalStart`; every close through existing `resetSession`. Per-agent `AgentReplaceTracker` + server-side PTY dedup form the two layers protecting SC-005. FR-020 fleet exclusion implemented by sourcing roster from `getCanonicalAgentIds` (rosters + customAgents only).
- [x] **Configuration-first** — confirmed: single typed boolean, single storage key, mirroring the established `notifications.ts` pattern. No code branch outside the coordinator reads the setting directly.
- [x] **Regression validation scope** — confirmed: contracts/README enumerates every existing surface consumed; quickstart §5 enumerates every new test. Worktree-aware build verification called out (Principle VII).

No violations. Complexity Tracking section omitted.

## Complexity Tracking

*No constitution violations. Section intentionally empty.*
