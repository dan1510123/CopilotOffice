# Contracts — Auto-Startup of Known Agents (spec 009)

**No new IPC channels, no new preload bridge methods, no new disk schemas
are introduced by this feature.** The feature is implemented entirely as
new renderer-side orchestration over existing typed surfaces.

## Existing renderer-side surfaces consumed (read-only references)

| Surface | Source | Used for |
|---|---|---|
| `window.copilotBridge.terminalStart(officeId, agentId, workingDir, cols?, rows?, preseededPrompt?, launchMode?)` | `electron/terminal/preload.ts:20` | Spawn / reattach PTY (warm path + post-New-Session restart). Server-side dedups when `current[agentId]` already alive. |
| `window.copilotBridge.resetSession(officeId, agentId)` | `electron/terminal/preload.ts:55` | Close the active session as the first step of `replaceSession`. |
| `window.copilotBridge.getAllSessionMeta(officeId)` | `electron/terminal/preload.ts:78` | Read titles to decide qualifying agents (FR-001/FR-005). Already cached in `cachedSessionMeta`. |
| `window.copilotBridge.queryAgentStatuses(officeId?)` | `electron/terminal/preload.ts:67` | E2E assertion that a warmed agent reached `{ alive: true, ready: true }`. |
| `officeManager.onOfficesUpdated` | `src/office/officeManager.ts:99` | Fired after durable load resolves; cold-launch trigger hooks here. |
| `officeManager.switchOffice` | `src/office/officeManager.ts:204` | Office-switch trigger hooks immediately after this resolves (in `switchToOffice`, `src/main.ts:710`). |
| `TerminalOverlay.handleNewSession` / `handleCloseSession` | `src/ui/TerminalOverlay.ts:1024,1081` | Existing controls; New Session delegates the chain to the coordinator, Close Session is unchanged. |
| `SeriousTerminalController.handleNewSession` / `handleCloseSession` | `src/ui/SeriousTerminalController.ts:596,613` | Same as overlay. |

## New renderer-internal contracts (typed inside `src/agents/`)

See `data-model.md` §4 for the full TypeScript signatures of:

- `AgentAutoStartSettings` (interface)
- `AutoStartCoordinatorDeps` (interface)
- `AutoStartCoordinator` (class)
- `WarmedOfficeRegistry`, `AgentReplaceTracker` (internal helpers)

These live entirely in renderer TypeScript modules; there is no cross-
process boundary to document beyond what already exists.

## Why no new IPC

The spec explicitly says (Assumptions): *"The existing manual-startup
flow … is the canonical 'start one agent' primitive. Auto-startup invokes
this primitive once per qualifying agent rather than introducing a separate
spawn path."* The primitive's IPC contract (`terminal-start`) already exists
and already dedups duplicate spawns server-side, which is exactly the
behavior FR-006 requires. Adding a new "warm-many" IPC would either
duplicate that dedup or bypass it — both worse than the trivial renderer
loop the coordinator implements.
