# Contract: Orchestrator IPC Surface (`orchestrator:*`)

Renderer ↔ Electron-main channels for the orchestrator agent. Modeled on the existing
`teams:*` surface (`electron/teams/teamsIpc.ts`, `electron/terminal/preload.ts`) and the
`terminal-*` channels. All renderer→main calls are `ipcRenderer.invoke` (exposed on
`window.copilotBridge`); all main→renderer pushes are `webContents.send` + a
`copilotBridge.on*` listener registrar.

## Renderer → Main (invoke)

| Channel | Args | Returns | Purpose |
|---------|------|---------|---------|
| `orchestrator:open` | `{ workingDirectory?: string }` | `{ sessionId: string; lifecycle: string }` | Start (or reattach to) the orchestrator SDK session. Idempotent — reopening returns the same session. |
| `orchestrator:input` | `{ sessionId: string; text: string }` | `{ ok: boolean }` | Submit user chat text as a prompt via `session.send({ prompt: text })` (default mode — no `enqueue`/interrupt override). |
| `orchestrator:permission:respond` | `{ sessionId: string; toolCallId: string; decision: 'approve' \| 'deny' }` | `{ ok: boolean }` | Resolve a pending gated tool call. |
| `orchestrator:close` | `{ sessionId: string }` | `{ ok: boolean }` | Detach the panel/stream. **MUST NOT kill** the session. |

## Main → Renderer (event)

| Channel | Payload | Purpose |
|---------|---------|---------|
| `orchestrator:event` | `{ sessionId: string; event: CopilotEvent }` | Normalized SDK stream (assistant text, tool start/complete, turn) via `mapSdkEventToCopilotEvent`. Rendered into the panel's xterm/chat. |
| `orchestrator:permission:request` | `{ sessionId: string; toolCallId: string; toolName: string; args: { agentId?: string; reason?: string } }` | A gated `bring_agent_online` invocation awaiting approve/deny. Panel MUST name the target agent. |
| `orchestrator:candidates:request` | `{ sessionId: string; requestId: string }` | Main asks the renderer to compute the current office's `BringOnlineCandidate[]` (backs the `list_office_agents` tool). |
| `orchestrator:execute:request` | `{ sessionId: string; requestId: string; agentId: string }` | Main asks the renderer to perform an **approved** bring-online. |
| `orchestrator:exit` | `{ sessionId: string; reason: string }` | Session ended/errored; panel surfaces it and remains usable for manual selection. |

## Renderer → Main (invoke, responses to main-initiated requests)

| Channel | Args | Purpose |
|---------|------|---------|
| `orchestrator:candidates:respond` | `{ requestId: string; candidates: BringOnlineCandidate[] }` | Renderer returns the computed candidate roster. |
| `orchestrator:execute:respond` | `{ requestId: string; result: BringOnlineResult }` | Renderer returns the bring-online outcome. |

> The main-initiated request/respond pairs exist because `OfficeManager` (candidate
> compute + execution) lives in the renderer while the SDK session lives in main. Each
> pair is correlated by `requestId` and resolved late (mirroring the `pendingUserInput`
> late-resolve pattern).

## Ordering / lifecycle invariants

1. `orchestrator:open` MUST be safe to call repeatedly; the second call reattaches and
   streams from the live session without creating a second session.
2. A `orchestrator:permission:request` with no matching
   `orchestrator:permission:respond` before `orchestrator:close` MUST resolve as **deny**
   (dismiss-while-pending).
3. `orchestrator:close` MUST NOT tear down the SDK session, kill any office session, or
   mutate `activeAgentViewers`.
4. All failures (session start, execution) MUST be surfaced via `orchestrator:event` or
   `orchestrator:exit` — never silent.
