---
applyTo: "src/office/**"
---

# Office Manager — Pure State Management

## Purpose

`officeManager.ts` is the **pure state management** layer for the multi-office system.
It owns all office CRUD, agent status tracking, session mapping, and persistence.
It **never renders anything** — no DOM manipulation, no Phaser objects. Communication
outward happens exclusively through callbacks.

## Office Model

Each office is an `OfficeConfig`: `id`, `name`, `workingDirectory`, `createdAt`, `layout`.
The `layout` field is an `OfficeLayout` type (`'default' | 'fleet-vteam'`), controlling which
layout definition the office uses (agent roster, dashboard, click handler).
`OfficeData` wraps the config with runtime maps for agent statuses and tool stacks.
CRUD operations: `createOffice(name, workingDirectory, layout = 'default')`,
`getOffice`/`getAllOffices`, `updateOffice` (can update `name`, `workingDirectory`, `layout`),
`deleteOffice`. Deleting the current office auto-switches to the next available one.
Backfill logic exists for offices saved before the `layout` field was added (defaults to `'default'`).

## Agent Status Tracking

Status is tracked **per-office, per-agent** via the `AgentStatus` interface:
- `state`: `slacking` | `active`
- `subState` (when active): `starting` | `ready` | `waiting` | `thinking` | `error`
- `thinkingDetail`: free-text description of current activity
- `currentTool`: derived from the agent's tool stack
- Enhanced fields: `unreadCount`, `lastEvent`, `activityStartTime`, `lastCompletedAction`, `recentActions`, `taskSummary`

### State Machine (VALID_TRANSITIONS)

```
slacking → starting, ready
starting → ready, error, slacking
ready    → thinking, waiting, slacking
thinking → ready, waiting, thinking (self), slacking
waiting  → thinking, ready, slacking
error    → slacking, starting
```

Invalid transitions log a warning but still execute (backward compatibility).
Use the dedicated setters (`setAgentSlacking`, `setAgentStarting`, etc.) — never mutate status fields directly.

## Persistence

All office configs are serialized to `.data/copilot-offices.json`.
Loaded in the constructor (`loadFromStorage`), saved after every mutation (`saveToStorage`).
Runtime-only data (agent statuses, tool stacks, session mappings) is **not** persisted.

## Callbacks

- `onOfficeChanged(officeId)` — fires when the active office switches (via `switchOffice` or deletion fallback)
- `onOfficesUpdated()` — fires when any office is created, updated, or deleted

These are the **only** outward communication channels. Consumers wire them up after construction.

## Critical Rules

1. **No rendering** — this module must never touch the DOM or create Phaser objects
2. **Respect the state machine** — always use the `setAgent*` methods; they validate transitions
3. **Persist after mutations** — every method that changes office config must call `saveToStorage`
4. **Callbacks only** — do not import UI modules or emit events directly; use the two callbacks

## Common Pitfalls

- Adding DOM/Phaser rendering here — it belongs in `OfficeScene.ts` or `main.ts`
- Bypassing `setAgent*` helpers to mutate status fields directly (skips validation)
- Forgetting `saveToStorage` after a new mutation method
- Assuming agent status is persisted — it resets on reload (only office configs survive)

## Post-Refactor (S2-A, 2026-06-04)

The persistence boundary now lives in `src/office/officePersistence.ts`:

- **Pure serializer / deserializer**: `serializeOffices(state)` / `deserializeOffices(json)` produce and consume the JSON schema. Side-effect free and unit-testable.
- **`OfficePersistencePort`**: tiny interface (`loadDurable`, `saveDurable`, `createOfficeSession`, `deleteOfficeSession`) the manager calls instead of touching `window.copilotBridge` directly.
- **Defaults**: `createBridgePersistencePort()` adapts the existing `window.copilotBridge` surface for production; `createNoopPersistencePort()` is for tests and SSR.

`OfficeManager`'s constructor accepts an optional port (defaults to `createBridgePersistencePort()`). The schema is unchanged; legacy backfill (`layout`, `seatedAgents`, UUID id → `office-N` reindexing, `index` field drop) lives in `deserializeOffices` and matches the prior inline `loadFromJson` behaviour exactly.

Every `setAgent*` mutation also emits a structured `[lifecycle]` log line via `src/util/lifecycleLog.ts` — see `src-main.instructions.md` for the telemetry contract.

