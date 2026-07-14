# Teams Continuous Streaming

Summary of the work that makes an **online Teams-remote agent mirror _all_ of its
activity** into its bound Teams channel thread — not just replies to messages that
originated from Teams.

## Problem

Previously, a Teams-remote agent only posted back to the thread when it was
responding to an **inbound Teams message**. Streaming was gated on a `pending`
dispatch record that was created *only* when a Teams message arrived
(`processDispatch()`), and `setForwarding(true)` was toggled per Teams-driven turn.

As a result, anything the operator did by typing directly into the app's own
terminal (a "local" turn) was invisible in the Teams thread. The channel was an
incomplete mirror of what the agent was doing.

## Goal

While an agent is **online**, continuously stream everything it does to the thread:

1. **Online-lifetime forwarding** — event mirroring stays on for the agent's whole
   online lifetime, not just per Teams dispatch.
2. **Ambient (local) turn streaming** — turns driven from the app's own terminal are
   streamed to the thread just like Teams-originated replies.
3. **Local request echo** — the locally-typed user prompt is also mirrored, so the
   thread shows both the request and the response.

## Design

### Local vs Teams turn distinction

`this.pending.get(agentId)` is the discriminator:

- **Exists** → the turn is a Teams dispatch (handled by the existing dispatch path).
- **Absent** → the turn is local/ambient (handled by the new `onAmbientEvent` path).

`pending` is set **synchronously** in `processDispatch` *before* `submitPrompt`, so a
Teams prompt's own `user.message` event (which fires later, at CLI-accept) always
sees `pending` and is routed to the dispatch handler — it is **not** re-echoed as a
local request. No practical race.

### Forwarding lifecycle invariant (regression-prone)

`gateway.setForwarding` is scoped to the **whole ONLINE lifetime**:

- **Enabled** in `register` + `reconcile`-reconnect.
- **Disabled** in `goOffline` AND `stop()`.
- **NOT** toggled per dispatch.

> ⚠️ Do **not** reinstate per-dispatch `setForwarding(false)` (the old
> `finalizeDispatch` behavior) — doing so breaks ambient streaming.

### User-prompt text plumbing

The clean prompt text is carried end-to-end so the local request can be echoed:

- The `user.message` copilot event exposes the prompt in `data.content` (clean).
  `data.transformedContent` is polluted with `<current_datetime>` /
  `<system_reminder>` blocks and is **avoided**.
- `text` is threaded through the IPC protocol → main-process events → the Teams
  session gateway as a `user-message` `AgentEvent`.
- Empty content is skipped silently (safe failure mode).

### Ambient turn buffering

`onAmbientEvent` buffers `message` chunks per turn and flushes on `turn-end`
(per-turn posting, mirroring Teams dispatch behavior), with a debounced settle so a
tool-using multi-turn response streams as a coherent whole.

## Message attribution & icons

Teams channel messages sent via the Graph API only render a small HTML allow-list
(`<b> <i> <u> <a> <code> <pre> <blockquote> <ul> <ol> <li> <img> <br>`). Inline
`style="color:…"` — even on a `<span>` — is **stripped** on render, so real text
color is not achievable. Emoji markers are used as the reliable visual distinction:

| Source | Label | Rendered example |
| --- | --- | --- |
| Agent output | 🤖 `<b>Name</b>` (via `agentLabel`) | `🤖 **Gene** ⌛ …message received` |
| Agent reply | 🤖 `<b>Name</b>` | `🤖 **Gene** <br> Done refactoring.` |
| Local request | 👤 `<b>Human</b>` | `👤 **Human** 💬 *local request:* <br> refactor the parser` |

The 🤖 badge is centralized in the `agentLabel()` helper, so it covers ack quips,
replies, "finished responding" completion pings, "still working" notices, and
reconnect messages uniformly. Local requests are attributed to **Human** (the
operator authored them, not the agent). The one-time online banner keeps its own 🟢
status dot and is intentionally left unchanged.

## Files changed

| File | Change |
| --- | --- |
| `electron/terminal/protocol.ts` | Added optional `text?: string` to `SrvCopilotUserMessage`. |
| `electron/terminal/server.ts` | Capture `rawUserText` from `user.message`; include it in the `copilot-user-message` send. |
| `electron/terminal/ipc-relay.ts` | Mirror `copilot-user-message` to `mainEvents` (with text) and pass text to renderer. |
| `electron/teams/sessionGateway.ts` | Added `'user-message'` `AgentEventKind`; `onUserMessage` listener mapping `copilot-user-message` → `{ kind: 'user-message', content }`. |
| `electron/teams/teamsService.ts` | Core: `AmbientTurn` + `ambient` Map; online-lifetime forwarding; ambient routing (`onAmbientEvent`, `ensureAmbient`, `flushAmbient`, `finalizeAmbient`, `postLocalRequest`); shutdown-race guards; 🤖/👤 attribution. |
| `tests/integration/teams/teams-ambient-stream.test.ts` | NEW — forwarding lifecycle, ambient streaming, no-echo, empty-request skip, offline, stop-disable-forwarding, shutdown races, icon/label attribution. |
| `tests/integration/teams/teams-multichannel-checkin-reconnect.test.ts` | Updated reply-prefix assertion for the 🤖 badge. |
| `tests/unit/teams/sessionGateway.test.ts` | Added `user-message` mapping test. |

## Shutdown-race hardening (from adversarial review)

- `stop()` (the settings-disable path, called without `goOffline`) disables
  forwarding for online bindings so no keys leak.
- `stop()` calls `queue.clear()` **before** resolving pending promises, so
  `DispatchQueue.drain()` cannot start a new `processDispatch` mid-shutdown.
- `processDispatch` guards on `!this.started`.
- `reconcile()` guards on `!this.started` at the loop top and after each await, so an
  in-flight reconcile cannot re-enable forwarding after stop begins.

## Verification

- Build: `npm run build` (esbuild) — passes.
- Tests: `npm run test -- tests/integration/teams tests/unit/teams --run` — **152 Teams
  tests pass**. Full suite (`npm run test`) — 463 tests pass.
- Reviewed across 3 adversarial rounds; all findings fixed.

## Commits (branch `anvil/teams-webhook-sender`)

| SHA | Description |
| --- | --- |
| `d1dc850` | Stream all online-agent turns to the thread, not just Teams replies. |
| `8a21bf8` | Attribute Teams messages with role icons (🤖 / 👤) and relabel local requests as Human. |

> Note: an auto-checkpoint commit `b011922` ("Include session title in Teams
> completion ping") captured the initial ambient work in `teamsService.ts` plus one
> extra test; history was left intact.
