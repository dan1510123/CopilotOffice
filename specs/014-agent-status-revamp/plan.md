# Implementation Plan: Agent Status Tracking Revamp

**Branch**: `014-agent-status-revamp` | **Date**: 2026-07-09 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `specs/014-agent-status-revamp/spec.md`

## Summary

Keep the existing agent state model (`slacking`, `starting`, `ready`, `waiting`, `thinking`, `error`, derived `done`) but revamp its **presentation** and **reliability**. Introduce a single canonical status-presentation module as the source of truth for each state's name, color, icon, and animation, consumed by the sprite badge, both dashboards, and notifications so they can no longer drift. Harden the derivation pipeline against staleness, races, duplicate/out-of-order events, and office-switch snapshots. Add a live mm:ss timer for active agents, a ~60s "possible stall" visual (a modifier on the existing active state, not a new state), fixed-height dashboard cards with a concise "Thinking" label, and "Done" clearing on any focus (terminal, card select, or in-world interaction).

**Technical approach**: config-first shared mapping + surgical hardening of existing renderer-side status flow. No Electron/main-process, PTY, or session-lifecycle changes.

## Technical Context

**Language/Version**: TypeScript (strict), ES2020+ modules  
**Primary Dependencies**: Phaser 3 (sprite badge), DOM (dashboards/notifications), esbuild; no new runtime deps  
**Storage**: N/A (in-memory `OfficeManager` status; existing persistence unchanged)  
**Testing**: Vitest (`npm run test`), Playwright (`npm run test:e2e`)  
**Target Platform**: Electron desktop (renderer process)  
**Project Type**: Desktop app (single project, `src/` renderer + `electron/` main — this feature is renderer-only)  
**Performance Goals**: Displayed status reflects state change < ~1s; live timer ticks at 1s; no dashboard reflow/jitter  
**Constraints**: Phaser-first rendering; all status flow via `game.events`/existing IPC; no session lifecycle changes; fixed dashboard card height  
**Scale/Scope**: Per-office rosters (single-digit to low-tens of agents); 4 status surfaces (badge, Default dashboard, Fleet dashboard, notifications)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Phaser-first constraint respected** — sprite badge stays in Phaser (`NPC.ts`); dashboards/notifications stay DOM overlays. No new in-canvas renderer.
- [x] **Event-driven boundaries preserved** — status continues to flow via `agent:status:changed`, `agent:tool:start`, tool/turn events; no new cross-layer coupling. Focus-to-clear-Done routes through existing interaction/selection events.
- [x] **Input focus transitions routed through `InputManager`** — no change to focus model; "interact in-world to clear Done" reuses the existing E-interact path, not ad hoc keyboard handling.
- [x] **Session lifecycle integrity maintained** — no terminal/PTY/session changes; Done-clear and stall detection are read-only over status. Fleet-critical event forwarding untouched.
- [x] **Configuration-first approach used** — new canonical mapping + thresholds live in a typed config module (`src/config/agentStatusPresentation.ts`), not duplicated per surface. Agent identity via `src/config/agents.ts` constants; layout behavior via `getLayout(...).behaviors`.
- [x] **Regression validation scope defined** — unit tests for the mapping + reducer + stall/staleness/dedup logic; parity checks across Default and Fleet dashboards; e2e boot/switch/badge flow. See Regression Plan in spec.

**Result**: PASS (no violations; Complexity Tracking not required).

## Key Design Decisions

1. **Single source of truth for presentation** — new `src/config/agentStatusPresentation.ts` exports a typed `STATUS_PRESENTATION` map: `statusKey -> { key, label, shortLabel, color (hex + Phaser number), icon, badgeAnimation }`, plus a `resolveStatusKey(status)` helper that folds `ready + completionPendingAck` into `'done'` and applies the stall modifier. `NPC.ts`, `DefaultDashboard.ts`, `FleetDashboard.ts`, and `NotificationService.ts` all consume it. Removes the current duplication and fixes the Thinking-icon mismatch (🧠 badge vs ⚡ dashboard).

2. **Stall as a presentation modifier, not a state** — `resolveStatusKey` computes `isStalled = active && sameState for >= STALL_THRESHOLD_MS (60_000)` from `activityStartTime`. The stall renders as a distinct treatment on the existing active state (amber tint + altered pulse on the badge; amber label/timer on cards). No change to `ActiveSubState` or `VALID_TRANSITIONS`.

3. **Reliability hardening in the existing pipeline** — reuse `nextSubStateAfterToolComplete`/`isAskUserTool` (already the `ask_user` race-guard) and ensure every surface derives from the same resolved status. Add duplicate/out-of-order guards in the status update path in `main.ts` (ignore completions for unknown tool ids; idempotent tool set). Ensure turn-end forces resolution off in-progress states. Office-switch freshness already handled by `reconnectAgentStatuses()`; add a test asserting no stale snapshot.

4. **Live timer + fixed-height cards** — change `formatElapsed` to mm:ss; the existing 1s `ELAPSED_TICK_MS` DOM updater drives the live timer and applies the stall class past threshold (DOM-only, no full re-render → no reflow). Dashboard card gets a fixed `min-height`/reserved single-line detail area; the primary label is the concise state name ("Thinking"), and `thinkingDetail` moves to a truncated line / `title` tooltip so it never grows the card.

5. **Done-clear on any focus** — a single `clearCompletionAck(agentId)` entry point invoked from all three focus paths: terminal open, dashboard card select, and in-world interact. Consolidates the currently implicit clearing so no focus method leaves Done lingering.

## Project Structure

### Documentation (this feature)

```text
specs/014-agent-status-revamp/
├── plan.md              # This file
├── research.md          # Phase 0 — current-state audit + decisions
├── data-model.md        # Phase 1 — status/presentation entities
├── quickstart.md        # Phase 1 — how to verify the revamp
├── contracts/
│   └── status-presentation.md   # Canonical state->presentation contract + surface obligations
└── tasks.md             # Phase 2 (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
src/
├── config/
│   ├── agentStatusPresentation.ts   # NEW — canonical state->{label,color,icon,anim} + thresholds + resolveStatusKey
│   └── agents.ts                    # (unchanged) agent id constants
├── util/
│   └── toolStatus.ts                # (reuse) ask_user race-guard reducer; add dedup/out-of-order helpers if needed
├── office/
│   └── officeManager.ts             # AgentStatus model (unchanged shape); transition validation reused
├── entities/
│   └── NPC.ts                       # badge consumes shared mapping; stall pulse modifier
├── layouts/
│   ├── default/DefaultDashboard.ts  # consume shared mapping; concise label; fixed-height card; detail tooltip
│   └── fleet/FleetDashboard.ts      # same treatment, parity
├── ui/
│   └── NotificationService.ts       # consume shared mapping for names/icons/colors
└── main.ts                          # formatElapsed -> mm:ss; live-timer/stall tick; dedup guard; clearCompletionAck focus wiring

tests/
└── unit/
    ├── config/agentStatusPresentation.test.ts   # NEW — mapping completeness + resolveStatusKey (done/stall folding)
    └── util/toolStatus.test.ts                  # extend — dedup/out-of-order + ask_user guard coverage
```

**Structure Decision**: Single-project, renderer-only change under `src/`. The one new file is a typed config module (Principle V); every other change is a surgical edit to an existing status surface or the derivation path in `main.ts`. No `electron/` changes.

## Phased Work Outline

- **Phase 0 (research.md)**: Audit every current status surface and derivation point; catalogue inconsistencies (icon/label/color drift), staleness/race/dedup gaps, and where Done is cleared today. Lock threshold/format decisions.
- **Phase 1 (data-model.md, contracts/, quickstart.md)**: Define the `AgentStatus` fields consumed, the `StatusPresentation` entity, the `resolveStatusKey` contract, and per-surface obligations; write the verification quickstart.
- **Phase 2 (/speckit.tasks)**: Dependency-ordered tasks — build the config module + tests first, then migrate each surface to it, then reliability hardening, then timer/stall/card-height, then Done-clear wiring, then regression/e2e.

## Complexity Tracking

> No constitution violations — section intentionally empty.
