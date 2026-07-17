# Contract: Orchestrator IPC Surface v2 (`orchestrator:*` additions)

Extends the spec 016 `orchestrator:*` surface
([016 orchestrator-ipc.md](../../016-office-orchestrator/contracts/orchestrator-ipc.md)).
Same conventions: renderer→main via `ipcRenderer.invoke` on `window.copilotBridge`;
main→renderer via `webContents.send` + a `copilotBridge.on*` registrar. New main-initiated
`request` channels are correlated to a `respond` invoke by `requestId` and resolved late in
the renderer (`src/main.ts`), where `OfficeManager`, per-agent session ops, and the Teams
bridge live. All existing spec-016 channels are unchanged.

## Main → Renderer (new request events)

| Channel | Payload | Purpose |
|---------|---------|---------|
| `orchestrator:active-agents:request` | `{ sessionId, requestId }` | Compute `ActiveAgentSnapshot[]` across ALL offices (backs `get_active_agents`). |
| `orchestrator:awaiting-agents:request` | `{ sessionId, requestId }` | Compute `AwaitingAgent[]` (waiting subset, longest-first) across all offices. |
| `orchestrator:agent-output:request` | `{ sessionId, requestId, agentId, officeId? }` | Compute bounded `AgentRecentOutput` for one agent. |
| `orchestrator:answer-agent:request` | `{ sessionId, requestId, agentId, officeId?, answer }` | Deliver an approved answer to a waiting agent. |
| `orchestrator:send-prompt:request` | `{ sessionId, requestId, agentId, officeId?, prompt }` | Deliver an approved follow-up prompt to an online agent. |
| `orchestrator:stop-agent:request` | `{ sessionId, requestId, agentId, officeId? }` | Stop/take offline an agent (approved). |
| `orchestrator:restart-agent:request` | `{ sessionId, requestId, agentId, officeId? }` | Restart an agent's session (approved). |
| `orchestrator:teams-presence:request` | `{ sessionId, requestId, agentId, officeId?, online }` | Activate/deactivate an agent's Teams remote (approved). |

## Renderer → Main (new respond invokes)

| Channel | Args | Purpose |
|---------|------|---------|
| `orchestrator:active-agents:respond` | `{ requestId, agents: ActiveAgentSnapshot[] }` | Return the all-offices roster. |
| `orchestrator:awaiting-agents:respond` | `{ requestId, agents: AwaitingAgent[] }` | Return the awaiting-input subset. |
| `orchestrator:agent-output:respond` | `{ requestId, output: AgentRecentOutput }` | Return the bounded recent-output window. |
| `orchestrator:answer-agent:respond` | `{ requestId, result: ActOnResult }` | Return the answer outcome. |
| `orchestrator:send-prompt:respond` | `{ requestId, result: ActOnResult }` | Return the send-prompt outcome. |
| `orchestrator:stop-agent:respond` | `{ requestId, result: ActOnResult }` | Return the stop outcome. |
| `orchestrator:restart-agent:respond` | `{ requestId, result: ActOnResult }` | Return the restart outcome. |
| `orchestrator:teams-presence:respond` | `{ requestId, result: ActOnResult }` | Return the Teams-presence outcome. |

## Transcript restore (new)

| Channel | Direction | Args → Returns | Purpose |
|---------|-----------|----------------|---------|
| `orchestrator:transcript:get` | renderer → main (invoke) | `{ sessionId? }` → `{ transcript: OrchestratorTranscript \| null }` | Panel fetches the persisted active transcript on open to replay it (FR-003/FR-004). Returns `null` when the last record was user-closed (FR-005) → panel starts clean. |

> The existing `orchestrator:event` push stream is unchanged and continues to render live
> turns; `orchestrator:transcript:get` supplies only the historical backfill replayed
> before the "ready" line, so live streaming and restore do not double-render (the panel
> already de-dupes streamed message ids via `streamedMessageIds`).

## Permission request payload (extended)

`orchestrator:permission:request` is broadened to carry the gated tool name and its
office-qualified target so the panel/Teams relay can name the target for ANY act-on tool
(not just `bring_agent_online`):

```ts
{ sessionId, toolCallId, toolName, args: { agentId?, officeId?, answer?, prompt?, online?, reason? } }
```

## Ordering / lifecycle invariants (in addition to spec 016)

1. Every new `*:request` MUST be answered by its `*:respond` with the matching `requestId`;
   on teardown the manager resolves in-flight round-trips with a typed terminal outcome
   (read-only → empty; act-on → `{ outcome:'failed', message:'Orchestrator session ended' }`),
   mirroring `clearPendingRoundTrips`.
2. Act-on `*:request` channels are emitted ONLY after the permission gate approves; a denied
   gate never emits a request and yields `outcome:'denied'` to the tool (FR-018).
3. Read-only `*:request` channels MUST NOT mutate any session (FR-012); they are safe to
   emit without a gate.
4. `orchestrator:transcript:get` MUST NOT create, resume, or mutate a session — it is a pure
   read of the persisted store.
5. All failures surface via the typed `result`/`output` or `orchestrator:exit` — never
   silent (FR-025).

## Preload / bridge additions (`electron/terminal/preload.ts`)

New `window.copilotBridge` members mirror the spec-016 shape:
- Invokers: `orchestratorRespondActiveAgents`, `orchestratorRespondAwaitingAgents`,
  `orchestratorRespondAgentOutput`, `orchestratorRespondAnswerAgent`,
  `orchestratorRespondSendPrompt`, `orchestratorRespondStopAgent`,
  `orchestratorRespondRestartAgent`, `orchestratorRespondTeamsPresence`,
  `orchestratorGetTranscript`.
- Listeners: `onOrchestratorActiveAgentsRequest`, `onOrchestratorAwaitingAgentsRequest`,
  `onOrchestratorAgentOutputRequest`, `onOrchestratorAnswerAgentRequest`,
  `onOrchestratorSendPromptRequest`, `onOrchestratorStopAgentRequest`,
  `onOrchestratorRestartAgentRequest`, `onOrchestratorTeamsPresenceRequest`.

Each is typed (no `any` across the seam) and declared in the `copilotBridge` interface.
