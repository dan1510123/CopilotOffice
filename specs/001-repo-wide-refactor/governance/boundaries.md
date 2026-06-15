# Domain Boundaries — Final State (post-001-repo-wide-refactor)

This document records the **ownership boundaries** the codebase landed on after P1+P2. Use it as the reference when deciding which file owns a new piece of functionality.

## Top-Level Map

```
┌──────────────────────────────────────────────────────────────────────────┐
│                            RENDERER (src/)                                │
│                                                                          │
│  ┌────────────────┐   ┌──────────────────┐   ┌────────────────────────┐ │
│  │ src/main.ts    │   │ src/scenes/**    │   │ src/ui/**              │ │
│  │ app shell +    │←→ │ Phaser scenes    │←→ │ DOM overlays           │ │
│  │ DOM layout +   │   │ (Office, Meeting)│   │ (Terminal, Settings,   │ │
│  │ event wiring   │   │                  │   │  Dashboards, Games)    │ │
│  └───┬────────────┘   └──┬───────────────┘   └────┬───────────────────┘ │
│      │                   │                        │                       │
│      ▼                   ▼                        ▼                       │
│  ┌────────────────┐   ┌──────────────────┐   ┌────────────────────────┐ │
│  │ src/util/**    │   │ src/input/**     │   │ src/config/**          │ │
│  │ pure reducers  │   │ InputManager +   │   │ named constants +      │ │
│  │ (toolStatus,   │   │ focus contract   │   │ z-index registry +     │ │
│  │  lifecycleLog) │   │                  │   │ depths + agents        │ │
│  └────────────────┘   └──────────────────┘   └────────────────────────┘ │
│                                                                          │
│  ┌────────────────┐   ┌──────────────────┐   ┌────────────────────────┐ │
│  │ src/office/**  │   │ src/layouts/**   │   │ src/meeting/**         │ │
│  │ pure state +   │   │ data-driven      │   │ plan parse/approve +   │ │
│  │ persistence    │   │ LayoutDefinition │   │ fleet spawn/track/viz  │ │
│  │ port           │   │ + behaviors      │   │                        │ │
│  └───┬────────────┘   └──────────────────┘   └────────────────────────┘ │
│      │                                                                   │
│      │ src/entities/**, src/sprites/**: Phaser sprites + procedural gen │
│      ▼                                                                   │
└──────┼───────────────────────────────────────────────────────────────────┘
       │  window.copilotBridge (preload)
       ▼
┌──────────────────────────────────────────────────────────────────────────┐
│                          ELECTRON MAIN (electron/)                        │
│                                                                          │
│  main.ts → registerNonTerminalIpc + TerminalRelay                        │
│  nonTerminalIpc.ts: hard-reload, native notifications, office persist    │
│  officeFileStore.ts: pure FS wrapper                                     │
│  terminal/server.ts (forked): PTY owner; uses agent-viewers.ts           │
│  terminal/agent-viewers.ts: dual-key invariant (R-002)                   │
│  terminal/{preload,protocol,ipc-relay,events-watcher}.ts: contract layer │
└──────────────────────────────────────────────────────────────────────────┘
```

## Domain Ownership Table

| Domain | Owns | Does NOT own | Key files |
|--------|------|--------------|-----------|
| **scene** | Phaser scenes, NPC + Player game objects, world layout, scene transitions | DOM, focus state mutation, terminal lifecycle, office data | `src/scenes/**`, `src/entities/**`, `src/sprites/**` |
| **input** | InputManager, focus contract (`game` vs `terminal`), `suspendGameInput` / `resumeGameInput`, listener lifecycles | Per-overlay UI; what the keys do | `src/input/**` |
| **ui** | DOM overlays, terminal panel, dashboards, mini-games, settings, notifications | Phaser objects, status state, persistence | `src/ui/**` |
| **terminal** | PTY lifecycle, scrollback, event watchers, dual-key viewer invariant | Renderer terminal UI (that's `ui`), fleet orchestration (that's `meeting`) | `electron/terminal/**` |
| **office** | Pure data layer for offices + per-agent status; serialization boundary; lifecycle telemetry emission | Rendering, IPC mechanics, layout selection | `src/office/**` |
| **layout** | Data-driven `LayoutDefinition` (agents, dashboard, click handler, capability flags) | Scene rendering, office persistence | `src/layouts/**` |
| **meeting** | Plan parse/approve, fleet spawn (orchestrator), fleet track (renderer), fleet visualize | Terminal lifecycle, scene shell | `src/meeting/**`, `src/scenes/MeetingScene.ts` |
| **config** | Agent definitions + named ids, Phaser depth layers, z-index registry, notifications, player customization | Anything that depends on runtime state | `src/config/**` |
| **electron main** | App shell, window lifecycle, non-terminal IPC, file persistence, terminal-relay spawn | Renderer DOM, PTY internals (delegated to `server.ts`) | `electron/main.ts`, `electron/nonTerminalIpc.ts`, `electron/officeFileStore.ts` |

## Cross-Cutting Contracts (must stay in lockstep)

These pairs MUST ship coordinated changes — splitting them breaks the renderer ↔ main contract:

1. **`electron/terminal/preload.ts` ↔ `electron/terminal/protocol.ts` ↔ `electron/terminal/server.ts`** — IPC message shapes. Adding/removing a message requires editing all three.
2. **`src/office/officePersistence.ts` ↔ `electron/officeFileStore.ts`** — the persisted JSON schema. Renderer serializer and main FS layer must agree.
3. **`src/main.ts` tool-status handlers ↔ `src/util/toolStatus.ts`** — the ask_user race-guard reducer is shared.
4. **`src/office/officeManager.ts` `setAgent*` ↔ `src/util/lifecycleLog.ts`** — every mutation emits a transition; subscribers depend on the contract.

## Where to Put New Code

| Need | Go to |
|------|-------|
| New status state | `src/office/officeManager.ts` + extend `AgentStatus`, add `setAgent*` method, update VALID_TRANSITIONS, add `LifecycleState` enum entry in `src/util/lifecycleLog.ts` |
| New IPC message | All three of preload + protocol + server (S1-D pair contract) |
| New overlay | `src/ui/<Name>.ts` with `onOpen`/`onClose` hooks; register a `ZIndex` constant in `src/config/zIndex.ts`; wire focus via `settings:open` / `settings:close` bus |
| New layout | `src/layouts/<name>/<Name>{Dashboard,ClickHandler}.ts`; add a `LayoutDefinition` entry in `src/layouts/index.ts` with explicit `behaviors` |
| New agent role | `src/config/agents.ts` named id constant + `AGENTS` entry + (if reserve) `RESERVE_AGENTS` + `RESERVE_AGENT_DESK` |
| New fleet behavior | `src/meeting/fleetOrchestrator.ts` (spawn), `fleetTracker.ts` (track), or `fleetVisualizer.ts` (viz) per phase ownership |
| New persisted field | `src/office/officeManager.ts` + extend `serializeOffices` / `deserializeOffices` in `src/office/officePersistence.ts` + backfill for legacy payloads |

## Anti-Patterns (do not do these)

- Touching `window.copilotBridge` directly from `src/office/**` (use `OfficePersistencePort`)
- String-comparing layout ids in scene code (use `getLayout(id).behaviors.X`)
- Picking a magic `z-index` for a new overlay (use `ZIndex.X`)
- Reimplementing the ask_user race-guard inline (use `nextSubStateAfterToolComplete`)
- Bypassing `addAgentViewer` / `removeAgentViewer` on transfer paths in `server.ts`
- Hardcoding agent id literals (use the named constants in `src/config/agents.ts`)
