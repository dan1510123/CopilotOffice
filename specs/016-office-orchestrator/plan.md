# Implementation Plan: Office Orchestrator Agent

**Branch**: `016-office-orchestrator` | **Date**: 2026-07-15 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/016-office-orchestrator/spec.md`

## Summary

Ship a dedicated **orchestrator agent** — a real, persistent Copilot session in its
**own non-YOLO SDK session** — surfaced in a focused hotkey/button-launched DOM panel
with an xterm chat TUI. The user describes, in natural language, the kind of help they
need; the agent ranks the current office's dormant candidates (idle-seated agents +
activatable reserves) and invokes a real, **gated** `bring_agent_online` tool. The
SDK session's `onPermissionRequest` surfaces an approve/deny in the panel naming the
target; only an approved call executes the **existing** start-session / reserve-
activation path. Because the orchestrator session never consults the global YOLO
toggle, bring-online is always gated.

Technical approach (from Phase 0 research): a new main-process
`OrchestratorSessionManager` owns one `@github/copilot-sdk` stdio session configured
with two tools — a read-only `list_office_agents` and a gated
`bring_agent_online({ agentId, reason })` — plus a bespoke always-interactive
permission handler. A new `orchestrator:*` IPC surface (mirroring the `teams:*`
pattern) connects it to a renderer `OrchestratorPanel` overlay that computes
candidates from `OfficeManager`, renders the chat via xterm, answers permission
prompts, and executes bring-online via the proven
`setAgentStarting` + `terminalStart` path (idle-seated) and a `game.events` delegation
to `OfficeScene.spawnReserveAgent` (reserves). No new persistence.

## Technical Context

**Language/Version**: TypeScript (strict) on Electron 40+ (Node main, browser
renderer), esbuild bundling
**Primary Dependencies**: Phaser 3; `@github/copilot-sdk@1.0.5`
(`defineTool`/`tools`/`onPermissionRequest`); `@xterm/xterm` + `@xterm/addon-fit`;
node-pty/ws (existing backends, unchanged)
**Storage**: None new (localStorage / `.data/*.json` untouched for the initial build)
**Testing**: Vitest (`npm run test`) unit/integration; Playwright (`npm run test:e2e`)
smoke
**Target Platform**: Desktop (Electron) — Windows/macOS/Linux
**Project Type**: Desktop app (Electron main + Phaser/DOM renderer)
**Performance Goals**: 60fps gameplay unaffected; stream/approval latency within the
existing bounded status-delay target
**Constraints**: Phaser sole renderer; sessions detached-not-killed; focus via
`InputManager`; `ZIndex` registry; no hardcoded agent IDs / status strings; orchestrator
session non-YOLO regardless of the global toggle
**Scale/Scope**: Single-user desktop; a handful of offices, dozens of agents; exactly
one orchestrator session

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] Phaser-first constraint respected (no alternate in-canvas renderer introduced) —
  the panel is a DOM overlay; gameplay stays Phaser-rendered.
- [x] Event-driven boundaries preserved — renderer↔main flows through a new
  `orchestrator:*` IPC surface (mirroring `teams:*`) and `game.events` for open/close;
  no hidden cross-layer coupling.
- [x] Input focus transitions routed through `InputManager` — open/close call
  `suspendGameInput()`/`resumeGameInput()`; xterm focus via `switchToTerminal`.
- [x] Session lifecycle integrity maintained — the orchestrator is a **separate** SDK
  session outside the office terminal server and its `activeAgentViewers` invariants;
  it starts/reattaches on open and is never killed on close; office sessions are
  untouched; bring-online reuses the existing start/reserve paths (detach-not-kill
  preserved).
- [x] Configuration-first approach — candidates derive from `agents.ts`
  (`RESERVE_AGENTS`, named ID constants) and `OfficeManager` state; status presentation
  (if shown) from `agentStatusPresentation.ts`; no hardcoded IDs/labels.
- [x] Regression validation scope defined — see Regression Plan in spec Constitution
  Alignment; targeted Vitest for the manager/tool/permission + candidate/execute logic,
  plus Playwright smoke for boot.

**Post-Phase 1 re-check**: PASS — the design introduces one new main-process module and
one renderer overlay plus an isolated IPC surface; it does not alter the office
terminal server, viewer bookkeeping, or Phaser rendering. Complexity is justified in
the table below.

## Project Structure

### Documentation (this feature)

```text
specs/016-office-orchestrator/
├── plan.md              # This file (/speckit.plan output)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── orchestrator-ipc.md      # renderer↔main IPC channel contract
│   └── orchestrator-tools.md    # SDK tool + permission-gate contract
├── checklists/
│   └── requirements.md  # spec quality checklist (already passing)
└── tasks.md             # Phase 2 output (/speckit.tasks — NOT created here)
```

### Source Code (repository root)

```text
electron/
├── orchestrator/                     # NEW — main-process orchestrator session
│   ├── orchestratorSessionManager.ts # owns the SDK stdio session; registers tools;
│   │                                 # bespoke non-YOLO permission handler; streams events
│   ├── tools.ts                      # defineTool(list_office_agents),
│   │                                 # defineTool(bring_agent_online) + JSON param schemas
│   └── orchestratorIpc.ts            # ipcMain.handle('orchestrator:*') + webContents.send(...)
├── terminal/
│   ├── terminal-backend.ts           # REUSE: CopilotSdkBackend / CopilotClient stdio, event-source
│   ├── event-source.ts               # REUSE: mapSdkEventToCopilotEvent for the stream
│   └── preload.ts                    # EDIT: add orchestrator methods to window.copilotBridge
└── main.ts                           # EDIT: register orchestratorIpc; lifecycle wiring

src/
├── ui/
│   └── OrchestratorPanel.ts          # NEW — focused DOM overlay + xterm chat TUI,
│                                     # candidate compute, bring-online execute, approve/deny UI
├── config/
│   └── zIndex.ts                     # EDIT: add ORCHESTRATOR_PANEL layer
├── office/
│   ├── officeManager.ts              # REUSE: currentOffice, setAgentStarting, seating
│   ├── orchestratorCandidates.ts     # NEW: compute idle-seated + activatable-reserve candidates
│   └── orchestratorExecute.ts        # NEW: seated-start directly; reserve → game.events delegation
├── scenes/
│   └── OfficeScene.ts                # EDIT: subscribe to orchestrator:activate-reserve → spawnReserveAgent
├── config/
│   └── agents.ts                     # REUSE: RESERVE_AGENTS, named ID constants, skill/description
└── main.ts                           # EDIT: hotkey/button to open the panel; open/close focus bus

tests/
├── unit/orchestrator/
│   ├── candidateSelection.test.ts    # idle-seated + activatable-reserve computation
│   ├── permissionGate.test.ts        # non-YOLO always-gate; approve/deny/dismiss mapping
│   └── bringOnlineExecute.test.ts    # start seated / activate reserve / invalid / already-active no-op
└── e2e/electron-smoke.e2e.ts         # EXTEND: open panel, boot session (smoke only)
```

**Structure Decision**: Desktop-app split (Electron main + Phaser/DOM renderer). The
orchestrator lands as one new main-process module namespace (`electron/orchestrator/`)
and one renderer overlay (`src/ui/OrchestratorPanel.ts`), connected by an isolated
`orchestrator:*` IPC surface — deliberately parallel to `electron/teams/` so it reuses
the SDK/session primitives without touching the office terminal server or its viewer
invariants. Note: `electron/orchestrator/*.ts` files must be added to the
`build:electron` esbuild entry list in `package.json` (or imported from an existing
entry) to be bundled.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| New main-process session manager (`electron/orchestrator/`) separate from the office terminal server | The orchestrator is a meta-agent with its own non-YOLO SDK session; it must not enter the `officeId+agentId` keyspace or the `activeAgentViewers` dual-key invariants | Reusing `server.ts` sessions would force a synthetic office/agent id into roster + viewer logic (R-002/BL-004 risk) and couple the orchestrator to office YOLO handling |
| New `orchestrator:*` IPC surface | Renderer owns `OfficeManager` (candidate compute + execution) while main owns the SDK session; the split requires request/response channels for stream, input, permission, and bring-online execution | Driving everything through existing `terminal-*` channels would overload office-scoped semantics and conflate the orchestrator with a seated agent's terminal |
