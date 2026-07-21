# Phase 1 Data Model: Orchestrator Improvements

New/extended types live in `electron/orchestrator/types.ts` (the shared, Node/DOM-free
source of truth imported by both the main process and the renderer, per spec 016). All
statuses derive from `src/config/agentStatusPresentation.ts`; no new status semantics are
introduced.

## 1. Orchestrator Transcript (US1 — FR-001..FR-007)

The durable, ordered, retention-bounded record of one orchestrator conversation.

### `TranscriptOrigin`
```ts
type TranscriptOrigin = 'desktop' | 'teams';
```

### `TranscriptRole`
```ts
type TranscriptRole = 'user' | 'orchestrator' | 'tool' | 'system';
```

### `TranscriptTurn`
| Field | Type | Notes |
|-------|------|-------|
| `seq` | `number` | Monotonic order index within the active conversation. |
| `role` | `TranscriptRole` | user / orchestrator / tool / system. |
| `origin` | `TranscriptOrigin` | Desktop TUI vs. Teams thread (FR-002). |
| `text` | `string` | Rendered content (assistant text, user prompt, or human-readable tool/system line). |
| `tool` | `{ name: string; outcome: string; target?: string }` \| `undefined` | Present for `role: 'tool'`; records act-on tool + typed outcome + office-qualified target (FR-023). |
| `at` | `number` | Epoch ms timestamp. |

### `OrchestratorTranscript`
| Field | Type | Notes |
|-------|------|-------|
| `sessionId` | `string` | The orchestrator SDK session id this transcript is bound to. |
| `lifecycle` | `'active' \| 'closed'` | `closed` marks a user-closed (red ✕) conversation; a `closed` record MUST NOT be resurrected as the active session (FR-005). |
| `turns` | `TranscriptTurn[]` | Ordered; **bounded** to the xterm scrollback window (≈5000 rendered lines) per session; trimmed oldest-first (FR-006). |
| `updatedAt` | `number` | Epoch ms of last append. |

**Invariants**
- New session (open after close/restart-with-no-active) starts an empty `active` transcript.
- Trimming is oldest-first once the bounded window is exceeded (FR-006); never unbounded.
- Every act-on outcome, including denials, appends a `tool` turn (FR-023).
- Teams-origin turns are tagged `origin: 'teams'` at capture (FR-002).

## 2. Active Agent Snapshot (US2 — FR-008, FR-009, FR-013)

Read-only view of one session-bearing agent, valid for ANY state (incl. `done`/`waiting`/
`thinking`). Returned by `get_active_agents` for every office.

### `ActiveAgentSnapshot`
| Field | Type | Source |
|-------|------|--------|
| `agentId` | `string` | `officeManager` seated/reserve id (`src/config/agents.ts`). |
| `name` | `string` | Agent display name. |
| `officeId` | `string` | Office the agent belongs to (FR-013 — all offices, labeled). |
| `officeName` | `string` | Human-readable office name for the orchestrator's reply. |
| `statusKey` | `StatusKey` | `resolveStatusKey(status)` — canonical (FR-009). |
| `statusLabel` | `string` | `presentationFor(status).label` — no divergent labels. |
| `activity` | `string` | `describeActivity(status)` (secondary detail; may be ''). |
| `timeInState` | `string` | `formatElapsedMmSs(status.activityStartTime)` (m:ss). |
| `awaitingInput` | `boolean` | `statusKey === 'waiting'`. |
| `pendingQuestion` | `string \| undefined` | Present when `awaitingInput` (context to unblock). |

**Invariants**
- The roster MUST include `done`/idle-online agents — no silent omission (FR-008).
- Labels/keys come only from `agentStatusPresentation` (FR-009).

## 3. Awaiting-Input Agent (US3 — FR-010)

`list_agents_awaiting_input` returns the `waiting` subset, ordered longest-waiting first.

### `AwaitingAgent`
Same shape as `ActiveAgentSnapshot` filtered to `awaitingInput === true`, plus a stable
sort by `timeInState` descending (longest first). `pendingQuestion` is required here.

## 4. Agent Recent-Output Window (US7 — FR-011, FR-012)

Bounded, read-only recent output for one target agent (peek).

### `AgentRecentOutput`
| Field | Type | Source |
|-------|------|--------|
| `agentId` | `string` | Office-qualified target. |
| `officeId` | `string` | Target office. |
| `hasOutput` | `boolean` | False → "nothing recent" (US7 scenario 2). |
| `lines` | `string[]` | Bounded recent activity window (`getRecentActions` / task summary), NOT unbounded scrollback. |
| `summaryHint` | `string \| undefined` | Optional task summary to help the orchestrator relay. |

**Invariants**: ungated, no session mutation, bounded window only (FR-011/FR-012, privacy edge case).

## 5. Act-On Result (US4–US6, US8 — FR-014..FR-023)

Typed outcome returned by every gated act-on tool.

### `ActOnOutcome`
```ts
type ActOnOutcome =
  | 'delivered'        // answer_agent success
  | 'sent'             // send_prompt_to_agent success
  | 'stopped'          // stop_agent success
  | 'restarted'        // restart_agent success
  | 'taken-offline'    // set_agent_teams_presence off / stop_agent variant
  | 'online-in-teams'  // set_agent_teams_presence on
  | 'not-online'       // target not online (send/answer/stop/restart/teams)
  | 'not-waiting'      // answer_agent: target isn't awaiting input
  | 'invalid-target'   // unknown/ineligible/orchestrator-identity/wrong-office
  | 'unavailable'      // Teams feature disabled/unconfigured
  | 'denied'           // user denied the gate
  | 'failed';          // execution error
```

### `ActOnResult`
| Field | Type | Notes |
|-------|------|-------|
| `agentId` | `string` | Office-qualified target the tool acted on. |
| `officeId` | `string` | Target office (disambiguates same-named agents across offices). |
| `outcome` | `ActOnOutcome` | Typed outcome (FR-019). |
| `message` | `string` | Human-readable result for the orchestrator to relay. |
| `threadWebUrl` | `string \| undefined` | Present for `online-in-teams` (US8 scenario 1). |

**Invariants**
- Reached only AFTER gate approval; a denied gate yields `denied` with zero target change (FR-018, SC-007).
- Target re-validated at execution time; never acts on a stale/wrong/orchestrator-identity target (FR-019, FR-020).
- Every outcome (incl. `denied`) is recorded in the transcript with target identified (FR-023).

## 6. Relationships & lifecycle

```
OrchestratorSessionManager (main)
  ├─ owns → OrchestratorTranscript (via OrchestratorTranscriptStore, .data/orchestrator-transcript.json)
  │         fed by: session event tap + permission approve/deny + submitInput + Teams-origin tag
  ├─ tools → get_active_agents ─────────┐
  │          list_agents_awaiting_input │ read-only round-trips → renderer OfficeManager (all offices)
  │          get_agent_transcript ──────┘
  │          answer_agent ──────────────┐
  │          send_prompt_to_agent       │ gated round-trips → renderer per-agent session ops
  │          stop_agent / restart_agent │ (warmAgentSession/terminalStart, stop/restart)
  │          set_agent_teams_presence ──┘ → Teams register/stop (spec 011)
  └─ permission gate (always on, non-YOLO) gates every act-on tool

OrchestratorPanel (renderer)
  └─ on open → restore transcript → replay into xterm (view-only, green theme, Page Up/Down)
```

### State transitions (transcript lifecycle)
```
(no record | closed record) --open--> active(empty)
active --turn(any origin)--> active(+turn, trimmed to bound)
active --red ✕ / endSession--> closed  (next open → active(empty); FR-005)
active --app restart--> active(restored & replayed; FR-004)
```

## 7. Reused existing types (unchanged)

- `BringOnlineCandidate`, `BringOnlineResult`, `OfficeSummary`, `SwitchOfficeResult`,
  `PermissionDecision`, `OrchestratorSessionInfo` — from spec 016 `types.ts`.
- `AgentStatus`, `StatusKey`, `StatusPresentation` and the `resolveStatusKey` /
  `presentationFor` / `describeActivity` / `formatElapsedMmSs` helpers — from
  `officeManager.ts` + `agentStatusPresentation.ts` (canonical status source of truth).
