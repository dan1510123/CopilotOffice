# Contract: Orchestrator SDK Tools v2 (US2–US8)

Extends `electron/orchestrator/tools.ts`. Tools are registered on the single orchestrator
SDK session and backed by `requestX`/`respondX` round-trips on `OrchestratorSessionManager`
that the renderer resolves late over the `orchestrator:*` IPC surface (see
[orchestrator-ipc-v2.md](./orchestrator-ipc-v2.md)). Baseline tools from spec 016
(`list_office_agents`, `list_offices`, `switch_office`, `bring_agent_online`) are unchanged.

Conventions:
- **Read-only** tools set `skipPermission: true` and MUST NOT mutate any session (FR-012).
- **Gated** tools omit `skipPermission`; their handler runs ONLY after the always-on,
  non-YOLO permission gate approves. A denial resolves to `outcome: 'denied'` (FR-018).
- Every tool returns a typed result; failure paths never throw silently (FR-025).
- Targets are office-qualified; tools MUST NOT target the orchestrator identity (FR-020).

## Read-only situational-awareness tools

### `get_active_agents` (read-only) — US2 / FR-008, FR-009, FR-013
- **Description intent**: "List every agent that currently has a live session across ALL
  offices — including agents that are done/awaiting-ack, waiting on input, and thinking —
  with each agent's office, status, current activity, and how long it's been in that state.
  Use for any 'what's everyone working on / status roll-up' request."
- **Parameters**: none (`{}`, `additionalProperties: false`).
- **Returns**: `{ agents: ActiveAgentSnapshot[] }` spanning all offices; empty array ⇒ the
  orchestrator reports nobody is active (US2 scenario 2). MUST NOT omit `done`/idle-online
  agents (FR-008). Every agent labeled with `officeId`/`officeName` (FR-013).

### `list_agents_awaiting_input` (read-only) — US3 / FR-010
- **Description intent**: "List only the agents that are blocked waiting for user input,
  with each one's pending question and how long it's been waiting, longest first. Use for
  'who needs me / is anyone stuck?'"
- **Parameters**: none.
- **Returns**: `{ agents: AwaitingAgent[] }` ordered longest-waiting first; empty ⇒ nobody
  needs attention (US3 scenario 2). Each includes `pendingQuestion` + `officeId`.

### `get_agent_transcript` (read-only) — US7 / FR-011, FR-012
- **Description intent**: "Fetch a bounded window of a specific agent's recent output so you
  can summarize or relay what it just did — without opening its terminal. Read-only."
- **Parameters**: `{ agentId: string (required), officeId?: string }`. When `officeId` is
  omitted the resolver disambiguates via the current office then all offices; ambiguous or
  unknown targets return `hasOutput:false` with a clear message.
- **Returns**: `AgentRecentOutput` (`hasOutput`, bounded `lines`, optional `summaryHint`);
  `hasOutput:false` ⇒ "nothing recent" (US7 scenario 2). Never gated, never mutates
  (US7 scenario 3).

## Gated act-on tools

All gated tools share the `ActOnResult` return shape and are re-validated at execution time
(FR-019). Reached only after gate approval; denial ⇒ `outcome:'denied'`, zero change (SC-007).

### `answer_agent` (gated) — US4 / FR-014
- **Description intent**: "Deliver the user's answer to an agent that is waiting for input,
  unblocking it. Gated — the user must approve."
- **Parameters**: `{ agentId: string (required), officeId?: string, answer: string (required) }`.
- **Outcomes**: `delivered` | `not-waiting` (target isn't awaiting, US4 scenario 3) |
  `not-online` | `invalid-target` | `denied` | `failed`. Records to transcript with target
  (FR-023, US4 scenario 4).

### `send_prompt_to_agent` (gated) — US5 / FR-015
- **Description intent**: "Send a follow-up prompt/task to an already-online agent (by
  capability or name). Gated."
- **Parameters**: `{ agentId: string (required), officeId?: string, prompt: string (required) }`.
- **Outcomes**: `sent` | `not-online` (optionally suggest bringing it online, US5 scenario 2)
  | `invalid-target` | `denied` | `failed`.

### `stop_agent` (gated) — US6 / FR-016
- **Description intent**: "Stop / take an online agent offline. Gated — destructive."
- **Parameters**: `{ agentId: string (required), officeId?: string }`.
- **Outcomes**: `stopped` | `taken-offline` | `not-online` | `invalid-target` | `denied` | `failed`.

### `restart_agent` (gated) — US6 / FR-016
- **Description intent**: "Restart an agent's session and report it ready. Gated."
- **Parameters**: `{ agentId: string (required), officeId?: string }`.
- **Outcomes**: `restarted` | `not-online` | `invalid-target` | `denied` | `failed`.

### `set_agent_teams_presence` (gated) — US8 / FR-017, FR-022
- **Description intent**: "Bring a specific agent online in Teams (activate its Teams
  remote) or take it offline. Gated. If Teams is disabled, say so."
- **Parameters**: `{ agentId: string (required), officeId?: string, online: boolean (required) }`.
- **Outcomes**: `online-in-teams` (with `threadWebUrl`, US8 scenario 1) | `taken-offline`
  (posts closing notice to thread, US8 scenario 2) | `unavailable` (Teams disabled/
  unconfigured, US8 scenario 3) | `invalid-target` | `denied` | `failed`.

## Permission-gate coverage (manager)

`OrchestratorSessionManager.permissionHandler` MUST gate ALL of `answer_agent`,
`send_prompt_to_agent`, `stop_agent`, `restart_agent`, `set_agent_teams_presence` (extend
the current `bring_agent_online`-only branch), and MUST NOT consult `isYoloEnabled()`
(FR-018). Minimized/Teams-only relay parity follows the existing `close()` rule: pending
gates are denied only when NOT `teamsRelayActive` (FR-021). The emitted
`orchestrator:permission:request` payload MUST carry enough context (tool name + target
agent/office) for the panel and Teams relay to name the target.

## System-prompt extension (FR-024, SC-009)

`ORCHESTRATOR_SYSTEM_PROMPT` is extended so the agent selects these tools from natural
language without the user naming the tool or exact agent: status roll-up → `get_active_agents`;
"who's stuck" → `list_agents_awaiting_input`; "what did X do" → `get_agent_transcript`;
answer/delegate/stop/restart/teams → the matching gated tool. Keep replies concise; never
invent an `agentId`/`officeId` not returned by a discovery/status tool.
