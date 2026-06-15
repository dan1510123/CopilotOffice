# Phase 1 Data Model: Fix Terminal Cold-Start Bugs

This feature does not introduce new persistent entities. It strengthens invariants on existing ones. Entities below reflect both the in-memory and on-disk shapes as of this plan.

## Entity: Agent Session

**Where it lives**: In-memory in the terminal server process (`electron/terminal/server.ts`). Persisted to disk.

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `sessionId` | string (UUID v4) | Unique within the app lifetime. Minted by `crypto.randomUUID()` on first `open`. |
| `officeId` | string | Office that owns this agent. |
| `agentId` | string | Stable agent identifier from `AGENTS` (`src/config/agents.ts`). |
| `pid` | number | OS process id of the underlying PTY. |
| `workingDir` | string \| undefined | Filesystem cwd for the CLI process. |
| `readyState` | `'preloading' \| 'ready' \| 'failed'` | Last known readiness derived from server's `signalReady()`. |
| `compositeKey` | string | `${officeId}:${agentId}` — viewer-side routing key. Derived, not stored. |

**Validation rules** (NEW or STRENGTHENED by this feature):

- **V1**: `sessionId` MUST be unique across all `Agent Session` entries in any single office at any moment in the app lifetime. Enforced on `case 'open'` and on load of the persisted file (`getOfficeSession`).
- **V2**: For any `(officeId, agentId)` pair, there is at most one live entry in `ptyProcesses`. Enforced today by the `existingTerminalKey` check at `server.ts:317`; tests will assert.
- **V3**: When loading a persisted office sessions file, if two or more `agentId`s map to the same `sessionId`, the loader MUST keep the first and re-mint distinct UUIDs for the rest, logging a `[TermServer] Repaired duplicate sessionId` warning. NEW.

**State transitions**:

```text
              open()                       signalReady()
slacking ───────────► starting ───────────────────────► ready ◄──┐
   ▲                     │                                       │
   │                     │  60s elapsed && PTY alive  ──► ready ─┘  (NEW recovery branch in syncAgentStatuses)
   │                     │  60s elapsed && PTY dead   ──► error: 'Startup timed out'
   │                     ▼
   │                  waiting ◄─► thinking
   │
   └──── resetSession() / close()
```

## Entity: Per-Office Session Map

**Where it lives**: `OfficeSessionData` struct in the terminal server (`server.ts:67`). Persisted as JSON to `.data/office-<id>.sessions.json`.

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `current` | `Record<agentId, sessionId>` | Active session per agent. |
| `history` | `Record<agentId, sessionId[]>` | Past sessionIds for this agent in this office. |
| `metadata` | `Record<agentId, { title?: string }>` | Session display metadata. |

**Invariant** (STRENGTHENED): values of `current` MUST be unique across keys within one file. Violations trigger the V3 repair on load.

**State transitions**: write-through on every `open` (new), `setSessionId` (resume), `resetSession` (clear+remint), and `transferSession` (fleet transfer).

## Entity: Agent Status Badge

**Where it lives**: `OfficeManager` in the renderer (`src/office/officeManager.ts`), surfaced through `getAgentStatus(officeId, agentId)` and the `agent:status:changed` event.

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `state` | `'slacking' \| 'starting' \| 'ready' \| 'waiting' \| 'thinking' \| 'error'` | High-level state. |
| `subState` | string | Finer-grained sub-state used by `syncAgentStatuses`. |
| `activityStartTime` | number \| null | Used by the 60s startup-timeout check. |
| `reason` | string \| undefined | When `state === 'error'`, the operator-visible reason. |

**Validation rules** (STRENGTHENED):

- **V4**: When `subState === 'starting'` and `(now - activityStartTime) > STARTING_TIMEOUT_MS`, the transition to `error: 'Startup timed out'` is allowed ONLY if `serverStatus.alive === false`. If the PTY is alive, force `setAgentReady(officeId, agentId)` and log `[Office] Agent X stuck in starting past timeout but PTY alive — recovering to ready`. NEW guard in `syncAgentStatuses`.

## Entity: TerminalOverlay focus state

**Where it lives**: `TerminalOverlay` in the renderer (`src/ui/TerminalOverlay.ts`).

**Fields**:

| Field | Type | Description |
|-------|------|-------------|
| `currentAgentId` | string \| null | The agent that owns the visible xterm. |
| `currentAgent` | AgentConfig \| null | Mirror of agent config for the visible terminal. |
| `attachedOfficeId` | string \| null | Office id captured at attach time (survives later office switches). |
| `isFocused` | boolean | Whether the terminal panel currently owns keyboard focus. |

**Validation rules** (NEW):

- **V5**: `currentAgentId` MUST NOT be mutated while a previous detach is in flight. The `show(agent)` path MUST `await terminalDetach(...)` before assigning `currentAgentId` to the new agent.
- **V6**: The `onData` callback registered on the xterm instance MUST write to the `agentId` captured in its own closure, not to the live `this.currentAgentId`. Re-register the callback on every successful attach to keep the closure fresh.
- **V7**: `focusTerminal()` MUST run AFTER `terminalAttach` resolves, so `InputManager.requestSwitch('terminal', ...)` is not racing against a not-yet-attached agent.
