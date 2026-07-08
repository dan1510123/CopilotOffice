# Implementation Plan: SDK Control Plane for Agent Terminals (Variant 1)

**Branch**: `012-sdk-control-plane` | **Date**: 2026-07-08 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/012-sdk-control-plane/spec.md`

## Summary

Introduce a new terminal backend in which node-pty hosts the **real Copilot TUI** via the CLI's
`--ui-server` mode, and a Copilot SDK client attaches to that **same running runtime** over a local
control connection (`RuntimeConnection.forUri`). The SDK becomes the control plane — programmatic
`send`, structured events, and foreground switching — while node-pty keeps rendering the authentic
TUI and carrying human keystrokes. One runtime is hosted **per office**. The legacy node-pty
backend is retained permanently as a config-selectable fallback, with automatic fallback when
`--ui-server` is unavailable. All behavior was de-risked by spikes A–E3 (see `research.md`).

Primary requirement: replace the fragile `submitViaKeystrokes` programmatic reply path and
`events.jsonl` tailing with reliable SDK `send()` + `session.on()`, without losing the real TUI.

## Technical Context

**Language/Version**: TypeScript (strict), Node.js on Electron 40+ (main process); esbuild bundling
**Primary Dependencies**: `@github/copilot-sdk` (upgrade `^0.1.32` → `1.0.5` stable GA), `node-pty`,
`@xterm/xterm`, `ws`
**Storage**: `.data/*.json` (offices, per-office session GUID maps, teams settings); Copilot session
state under `~/.copilot` keyed by session GUID
**Testing**: Vitest (`npm run test`, `npm run test:coverage`) for unit/integration; Playwright
(`npm run test:e2e`) for full-boot workflows
**Target Platform**: Desktop app (Electron; Windows primary, per environment)
**Project Type**: Desktop app — Electron main + terminal server child process + Phaser/DOM renderer
**Performance Goals**: Terminal input/output responsiveness at parity with today; status-transition
latency small and consistent; Phaser 60fps unaffected (control plane lives in main/terminal server)
**Constraints**: Preserve the real TUI (Variant 1; headless self-render is out of scope);
`--ui-server` is undocumented → capability probe + fallback required; `forUri` clients cannot pass
`useLoggedInUser`/`gitHubToken` (hosted runtime owns auth); one runtime per office (crash domain)
**Scale/Scope**: N agents per office × multiple offices; one hosted runtime + control port per
office; one foreground TUI visible at a time (already true today)

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Phaser-first constraint respected (no alternate in-canvas renderer introduced) — change is
  confined to the Electron terminal server + DOM terminal overlay; Phaser rendering untouched.
- [x] Event-driven boundaries preserved (`game.events`/IPC contracts, no hidden cross-layer
  coupling) — new flows ride existing `terminal:*`/`agent:*`/`teams:*` channels and the
  terminal-server protocol; SDK events are normalized into the existing `CopilotEvent` shape.
- [x] Input focus transitions routed through `InputManager` — human keystrokes continue via the
  existing PTY path and focus model; no new keyboard handling added to Phaser.
- [x] Session lifecycle integrity maintained for terminal/agent/fleet flows — session GUID identity,
  detach-not-kill on office switch, and fleet-critical event forwarding are preserved (P1 risk area;
  see Regression Plan).
- [x] Configuration-first approach used for agents/layouts/feature flags — backend selection is a
  typed setting (not hardcoded), extending the existing settings/config model; no agent IDs or
  layout behaviors hardcoded.
- [x] Regression validation scope defined for touched high-risk flows — see Regression Plan below
  and the per-story acceptance tests.

**Re-check after Phase 1**: No new violations introduced. Complexity Tracking is empty.

## Project Structure

### Documentation (this feature)

```text
specs/012-sdk-control-plane/
├── plan.md              # This file
├── research.md          # Phase 0 — decisions, spike evidence, API deltas
├── data-model.md        # Phase 1 — control-plane entities & state
├── quickstart.md        # Phase 1 — enable/validate the ui-server backend
├── contracts/
│   ├── ui-server-backend.md   # TerminalBackend/TerminalProcess contract for the hybrid backend
│   └── event-mapping.md       # SDK event → CopilotEvent normalization contract
└── checklists/
    └── requirements.md  # Spec quality checklist (from /speckit.specify)
```

### Source Code (repository root)

```text
electron/
├── terminal/
│   ├── terminal-backend.ts     # ADD: UiServerBackend (node-pty hosts --ui-server) + SDK forUri attach;
│   │                           #      upgrade CopilotClient usage to 1.x RuntimeConnection API
│   ├── server.ts               # EDIT: backend selection ('ui-server'|'sdk'|'node-pty'); per-office
│   │                           #       runtime registry; foreground switch on agent switch; route
│   │                           #       submit-prompt via SDK; readiness gating (FR-020)
│   ├── event-source.ts         # ADD: SdkEventSource (session.on) alongside FileWatcherEventSource
│   ├── events-watcher.ts       # REUSE: CopilotEvent shape is the normalization target
│   ├── protocol.ts             # EDIT (if needed): any new main↔server messages for foreground/host
│   ├── agent-viewers.ts        # REUSE: dual-key viewer invariant unchanged
│   └── ipc-relay.ts            # REUSE: renderer forwarding unchanged
├── teams/
│   └── sessionGateway.ts       # VERIFY: programmatic send path targets SDK submit; assistant.message capture intact
└── main.ts                     # EDIT (if needed): wire backend-selection setting → terminal server

src/
├── config/                     # ADD: typed backend-selection setting (feature flag)
├── ui/TerminalOverlay.ts       # VERIFY: agent switch maps to foreground switch; no scrollback-replay regressions
└── main.ts                     # VERIFY: agent switch/status wiring under SDK events

tests/
├── unit/terminal/              # ADD: event-mapping, capability-probe, readiness-gate, per-office registry
├── integration/                # ADD: send-while-typing (FR-019), fallback (FR-010), office-switch continuity
└── integration/teams/          # REUSE/EXTEND: programmatic reply via SDK
```

**Structure Decision**: Desktop-app layout. The change is concentrated in the Electron terminal
server (`electron/terminal/*`) with a small typed-config addition in the renderer (`src/config/*`)
and verification touch-points in the DOM terminal overlay and Teams gateway. No Phaser/scene code
changes are required.

## Phased Approach

### Phase 0 — Research (`research.md`)
All major unknowns were resolved empirically (spikes A–E3). `research.md` records: the ui-server +
`forUri` attach model, port discovery, foreground switching, resume, shared-port multiplexing, the
send-while-typing behavior, the load-time keystroke-drop caveat, the SDK 0.1.32→1.x API deltas, and
the three clarify decisions. No open `NEEDS CLARIFICATION` remain.

### Phase 1 — Design (`data-model.md`, `contracts/`, `quickstart.md`)
- **data-model.md**: entities (Hosted Runtime, Control-Plane Client, Agent Session, Foreground
  Selection, Backend Selection) with states and lifecycle (launch → ready → attach → session
  create/resume → foreground → send/events → detach/crash/relaunch).
- **contracts/ui-server-backend.md**: the `TerminalBackend`/`TerminalProcess` contract the hybrid
  backend must satisfy (launch ui-server in PTY, discover port, attach SDK, `submitPrompt`, resize,
  foreground switch, kill/detach), plus per-office runtime lifecycle and fallback rules.
- **contracts/event-mapping.md**: normalization of SDK `session.on` events → the existing
  `CopilotEvent` shape consumed by `server.ts` (tool start/complete, turn start/end, user.message,
  subagent.*, assistant.message for Teams), preserving fleet-critical forwarding semantics.
- **quickstart.md**: enabling the backend (`COPILOT_TERMINAL_BACKEND=ui-server` / typed setting),
  the capability probe, and a manual validation script mirroring spike D/E3.

### Phase 2 — Tasks
Generated later by `/speckit.tasks` (not part of this plan).

## Rollout & Backend Selection

Three backends coexist, selected by a typed setting (default unchanged = `node-pty`):
- `node-pty` (legacy, default): today's behavior. Permanent fallback (FR-018).
- `ui-server` (new, Variant 1): node-pty hosts `--ui-server`; SDK attaches via `forUri`.
- `sdk` (existing, headless/Variant-2): retained but not the target of this feature.

Capability probe (FR-010): before selecting `ui-server`, verify the installed CLI accepts
`--ui-server` (strict-parser accept-vs-error check, per spike). On failure, auto-fall back to
`node-pty` with a structured log line; never fail user-visibly.

## Regression Plan (high-risk flows)

- **Session integrity (Constitution III, P1)**: office-switch detach-not-kill + reattach;
  session-GUID continuity; fleet-critical event forwarding without a viewer. Add integration tests;
  run existing terminal/teams suites.
- **Programmatic reply (Teams)**: reply lands via SDK `send`; `assistant.message` captured for
  thread reply. Extend `tests/integration/teams`.
- **Concurrency (FR-019/SC-007)**: send-while-typing preserves the human line, ordered turns.
- **Readiness gate (FR-020)**: no input routed before session ready (guards load-time drops).
- **Clipboard/selection (Constitution VI)**: no changes expected; if any overlay code is touched,
  mirror across `TerminalOverlay` and `SeriousTerminalController` and run copy/paste specs.
- **Worktree verification (Constitution VII)**: validate against this worktree's rebuilt `dist/`.

## Complexity Tracking

> No constitution violations. Table intentionally empty.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| — | — | — |
