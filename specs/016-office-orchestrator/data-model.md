# Phase 1 Data Model: Office Orchestrator Agent

Entities are in-memory / message-shape only. **No new persisted storage** in the
initial build (see research R7). Field types are conceptual; concrete TypeScript
interfaces are defined in `contracts/`.

## OrchestratorSessionInfo (main process)

The single dedicated SDK session that backs the orchestrator agent.

| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | string | SDK session id; the correlation key for permission/user-input late-resolve (mirrors `pendingUserInput` keyed by `sessionId`). |
| `lifecycle` | `'idle' \| 'starting' \| 'ready' \| 'error'` | Manager-local lifecycle; not an office `AgentStatus`. |
| `session` | SDK session handle | From `CopilotClient.createSession(...)` over `RuntimeConnection.forStdio`. |
| `workingDirectory` | string | Repo root (or configured); passed to the SDK session config. |

**Lifecycle**: `idle → starting` on first `orchestrator:open`; `starting → ready` when
the SDK session is created and streaming; `→ error` on start failure (surfaced to the
panel, panel stays usable for manual selection). Never transitions to a killed state on
panel close — the session persists and reattaches.

## BringOnlineCandidate (renderer-computed)

A dormant agent the orchestrator may propose to bring online, scoped to the currently
viewed office.

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | string | Config id (from `agents.ts`); never hardcoded. |
| `name` | string | Display name. |
| `skill` | string | From `AgentConfig.skill` — a match signal. |
| `description` | string | From `AgentConfig.description` — the primary NL match signal. |
| `source` | `'idle-seated' \| 'reserve'` | How it would be brought online. |
| `deskId` | string \| null | Required when `source === 'reserve'` (the `unassigned-*` seat / `RESERVE_AGENT_DESK` mapping). |
| `officeId` | string | `OfficeManager.currentOfficeId` at compute time. |

**Derivation** (renderer, from `OfficeManager` + `agents.ts`):
- *idle-seated*: `currentOffice.agents` entries whose `AgentStatus.state === 'slacking'`.
- *reserve* (only when the current layout has `supportsReserveAgents`): desks whose id
  starts with `unassigned-` that map to an entry in `RESERVE_AGENTS`.
- Agents already `active` (starting/ready/waiting/thinking/error) are **excluded** (they
  are not "dormant"); this yields the "nothing to bring online" case when empty.

## BringOnlineToolCall (tool invocation)

> Conceptual only — this is the union of the `bring_agent_online` tool params
> (`agentId`, `reason`) plus the `toolCallId` from the permission request. It is **not**
> a distinct persisted/marshaled type; no channel or handler consumes it separately.

The arguments the orchestrator agent passes to the gated tool.

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | string | Must match a current `BringOnlineCandidate.agentId`. |
| `reason` | string (optional) | Agent's rationale; shown in the approve/deny prompt. |
| `toolCallId` | string | From `PermissionRequestCustomTool.toolCallId`; correlates the permission request/response. |

## PermissionDecision

The user's answer to a gated tool call, mapped to an SDK `PermissionRequestResult`.

| Field | Type | Notes |
|-------|------|-------|
| `toolCallId` | string | Correlates to the pending request. |
| `decision` | `'approve' \| 'deny'` | From the panel's approve/deny UI. |
| `→ result kind` | SDK union | `approve → { kind: 'approved' }`; `deny → { kind: 'denied-interactively-by-user' }`; panel dismissed while pending → treated as deny. |

**Invariant**: the handler NEVER auto-returns `{ kind: 'approved' }` from
`isYoloEnabled()`; it only resolves after an explicit panel decision (or dismiss=deny).

## BringOnlineResult (renderer execution outcome)

Returned to the main-process tool handler (which returns it to the agent) and surfaced
in the panel.

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | string | Target. |
| `outcome` | `'started' \| 'denied' \| 'invalid-target' \| 'already-active' \| 'failed'` | See spec FR-004/FR-006 + edge cases. |
| `message` | string | Human-readable detail; never silent on failure (Principle: surface failures). |

**Outcome rules**:
- `started`: seated idle agent → `officeManager.setAgentStarting` + `copilotBridge.terminalStart`
  (from the `OfficeManager`-owned execute module); reserve → routed to `OfficeScene` via a
  `game.events` event (`orchestrator:activate-reserve`) that calls the private
  `spawnReserveAgent(deskId)` (which itself does `AGENTS.push` → `addSeatedAgent` →
  `setAgentStarting` → `terminalStart` and the walk-in animation). The reserve path
  **cannot** run directly from an `OfficeManager`-owned module.
- `already-active`: target already starting/active → no-op (no duplicate session start).
  For reserves, `spawnReserveAgent`'s existing `animating` / already-spawned guards
  contribute this semantics.
- `invalid-target`: `agentId` not in the current candidate set / no open seat / no
  reserves → refused, returned to the agent.
- `denied`: user denied the gate — no mutation.
- `failed`: execution path threw / session failed to start — surfaced, state stays
  consistent.

## Deferred entities (NOT in the initial build)

`Orchestrator View State`, `Control Action`, `Backlog Task`, `Orchestration Policy`,
`Orchestrator Settings` — specified in `spec.md` Key Entities for the deferred board /
direct-control / task-board phases; no data structures are created for them now.
