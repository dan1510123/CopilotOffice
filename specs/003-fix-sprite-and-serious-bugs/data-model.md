# Phase 1 Data Model: Fix Sprite-Card Stacking and Serious-Mode Open-Flow Bugs

This feature does not introduce new persistent entities and does not change any IPC payload shapes. It strengthens lifecycle invariants on existing renderer-side DOM and controller entities. Numbering continues from spec 002 (V1–V7) so cross-spec references remain unambiguous.

## Entity: Sprite Card DOM Element

**Where it lives**: DOM, appended to `document.body` (or the configured overlay container) by `TerminalOverlay.createSpriteCard()` in `src/ui/TerminalOverlay.ts`.

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `id` | string (literal `"sprite-card"`) | DOM id. Must be unique across the document per HTML spec. |
| owning overlay | `TerminalOverlay` instance | The renderer object that created the node and is responsible for removing it. |
| displayed agent | `AgentConfig` | The agent whose sprite/profile the card currently shows. Mirrors the owning overlay's currently-visible terminal agent. |

**Validation rules** (NEW for this feature):

- **V8**: At any moment in game mode, `document.querySelectorAll('#sprite-card').length` MUST be `0` or `1`. Enforced by V9 + V10.
- **V9**: `TerminalOverlay.createSpriteCard()` MUST remove any pre-existing element matching `#sprite-card` before appending the new one. Idempotent by construction.
- **V10**: Every game-mode scene that constructs a `TerminalOverlay` MUST call `terminalOverlay.destroy()` (which removes the sprite-card DOM node) from its `shutdown()` hook. Today: `OfficeScene`, `MeetingScene`.

## Entity: Terminal Overlay (Game Mode)

**Where it lives**: `TerminalOverlay` class in `src/ui/TerminalOverlay.ts`. One instance per Phaser scene that hosts a terminal panel.

**Fields** (existing, no change):

| Field | Type | Description |
|-------|------|-------------|
| `currentAgentId` | string \| null | See spec 002 V5/V6. |
| `currentAgent` | AgentConfig \| null | Mirror of agent config for visible terminal. |
| `attachedOfficeId` | string \| null | Office id captured at attach time. |
| sprite-card DOM ref | HTMLElement \| null | Reference to the appended sprite-card node, for `destroy()` cleanup. |

**Validation rules** (NEW for this feature, additive to V5–V7 from spec 002):

- **V11**: `TerminalOverlay.destroy()` MUST remove the sprite-card DOM node it owns (or any `#sprite-card` it finds, as defense in depth) and MUST NOT throw when called on a partially-constructed overlay (edge case spec L80).

## Entity: Serious Terminal Controller Open Flow

**Where it lives**: `SeriousTerminalController.openAgentTerminal(office, agent)` in `src/ui/SeriousTerminalController.ts`.

**Phases** (existing, no order change):

```text
openAgentTerminal(office, agent)
  ├─ await closeView({silent: true})       (close previous, may clear activeOfficeId/activeAgentId)
  ├─ synchronous render phase                  ◄── NEW: wrapped in try/catch (V12)
  │    ├─ updateSpriteCard(agent)
  │    ├─ updateSessionTitle(agent)
  │    └─ refitAndResize()
  ├─ register onData bound handler             ◄── NEW: bound-id capture (V13)
  ├─ await terminalStart(office.id, agent.id, ...)
  └─ await terminalAttach(office.id, agent.id)
```

**Validation rules** (NEW):

- **V12**: A throw in the synchronous render phase MUST be caught at the top level of `openAgentTerminal`. The catch handler MUST:
  - Surface a human-readable error via `setStatus(...)`.
  - Write a visible warning into the xterm (`\r\n[render error: <message>]\r\n`).
  - Still invoke `terminalStart` and `terminalAttach` for the *requested* `office.id` / `agent.id` (not `this.activeOfficeId` / `this.activeAgentId`, which may have been cleared by the earlier `closeView`).
- **V12.a**: A successful synchronous render MUST leave behavior byte-for-byte unchanged from the pre-fix happy path. The catch handler MUST NOT introduce a new visible state when nothing has thrown.

## Entity: Bound Terminal Data Handler (Serious Mode)

**Where it lives**: The `onData` callback registered on `this.terminal` inside `SeriousTerminalController.openAgentTerminal`. Disposable tracked as `this.onDataDisposable`.

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `boundOfficeId` | string | Captured at the moment the handler is registered. |
| `boundAgentId` | string | Captured at the moment the handler is registered. |
| disposable | `{ dispose(): void } \| null` | Returned by `terminal.onData(...)`; tracked on the controller so it can be disposed before re-registration. |

**Validation rules** (NEW, mirroring spec 002 V6 for the serious-mode controller):

- **V13**: The `onData` callback MUST send `terminalWrite({ officeId: boundOfficeId, agentId: boundAgentId, data })` using the locals captured in its own closure. It MUST NOT read `this.activeOfficeId` or `this.activeAgentId` from inside the callback.
- **V14**: On every `openAgentTerminal` call, the previous `onDataDisposable` (if any) MUST be `dispose()`d before a new handler is registered. Result: exactly one live `onData` handler routes input to any one agent's session at any time.

## Cross-spec invariant map

| Invariant | Source spec | Source file | This spec extends? |
|-----------|------------|-------------|---------------------|
| V1 — distinct sessionId per agent | 002 | `electron/terminal/server.ts` | No |
| V2 — at most one live PTY per (officeId, agentId) | 002 | `electron/terminal/server.ts` | No |
| V3 — repair duplicate sessionId on load | 002 | `electron/terminal/server.ts` | No |
| V4 — alive-guard recovery in syncAgentStatuses | 002 | `src/main.ts` | No |
| V5 — serialize detach → mutate → attach | 002 | `src/ui/TerminalOverlay.ts` | No |
| V6 — bound-at-registration onData (game mode) | 002 | `src/ui/TerminalOverlay.ts` | **Generalized in V13** |
| V7 — focus after attach | 002 | `src/ui/TerminalOverlay.ts` | No |
| **V8** — at most one `#sprite-card` in DOM | **003** | `src/ui/TerminalOverlay.ts` | Introduced |
| **V9** — idempotent createSpriteCard | **003** | `src/ui/TerminalOverlay.ts` | Introduced |
| **V10** — scene shutdown calls overlay destroy | **003** | `src/scenes/OfficeScene.ts`, `src/scenes/MeetingScene.ts` | Introduced |
| **V11** — overlay destroy is safe on partial construct | **003** | `src/ui/TerminalOverlay.ts` | Introduced |
| **V12** — resilient serious-mode open | **003** | `src/ui/SeriousTerminalController.ts` | Introduced |
| **V13** — bound-at-registration onData (serious mode) | **003** | `src/ui/SeriousTerminalController.ts` | Introduced |
| **V14** — dispose previous onData before re-register | **003** | `src/ui/SeriousTerminalController.ts` | Introduced |
