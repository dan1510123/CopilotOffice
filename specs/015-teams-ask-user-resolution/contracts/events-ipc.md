# Contract: ask_user Payload Relay + Answer Channel (server ↔ main ↔ Teams)

**Feature**: `015-teams-ask-user-resolution` | **Date**: 2026-07-11

Defines the **additive** event/IPC changes that (a) carry the `ask_user` payload
(question, ordered options, freeform flag, `requestId`) from the terminal server to the
Teams service, and (b) carry a Teams answer back to the running session. The existing
generic `copilot-tool-start` relay is **unchanged** (FR-015/016); this contract adds a
parallel `copilot-ask-user` event and a `submit-answer` IPC. Field names/positions of all
existing copilot events and `submit-prompt` are preserved.

**Backend split (research Decision 1 — spike-verified):**
- **SDK/ui-server backend (product default):** `ask_user` is the SDK **user-input
  interaction**. The payload arrives **natively** in the `user_input.requested`
  event `{ requestId, question, choices, allowFreeform, toolCallId }` — no argument
  scraping. **Prerequisite:** the managed session MUST register an `onUserInputRequest`
  handler (see §0) or the model refuses to call `ask_user`.
- **node-pty backend (fallback):** no SDK session — `ask_user` renders in the TUI; the
  server normalizes `tool.execution_start` arguments best-effort (`requestId` undefined),
  and the answer is applied by keystroke injection. Structured surfacing is degraded here.

---

## 0. Session prerequisite — register the user-input handler (SDK/ui-server)

`electron/terminal/terminal-backend.ts` — both managed-session factories MUST register a
user-input handler so `requestUserInput: true` and the model is told `ask_user` exists:

- `ControlPlaneClient.createOrResumeSession` `sharedConfig` (~L754)
- `CopilotSdkBackend.resumeOrCreateSession` `sharedConfig` (~L534, `forStdio`)

```ts
onUserInputRequest: (request, { sessionId }) =>
  new Promise<{ answer: string; wasFreeform: boolean }>((resolve) => {
    pendingUserInput.set(request.requestId, { resolve, agentId, toolCallId: request.toolCallId });
    // ... emit user_input.requested for relay (§1); promise is resolved LATE by submit-answer (§5)
  }),
```

The promise is resolved **late** — when a Teams (or local) answer arrives — allowing the
agent to keep waiting until then. `handlePendingUserInput(requestId, {answer, wasFreeform})`
(§5) resolves the stored promise (fallback: `session.rpc.ui.handlePendingUserInput(...)`).

---

## 1. Terminal server → clients (WebSocket message)

**Existing (unchanged)** — emitted for every tool including `ask_user`:

```ts
// electron/terminal/server.ts, protocol.ts SrvCopilotToolStart
{ type: 'copilot-tool-start', agentId, toolName, toolId, status }
// status for ask_user stays the constant 'Waiting for your answer'
```

**NEW `SrvCopilotAskUser`** (`electron/terminal/protocol.ts`) — emitted **in addition**
when a user-input interaction is raised. For the SDK/ui-server backend the server reads
the native `user_input.requested` fields; for node-pty it normalizes
`tool.execution_start` arguments:

```ts
export interface SrvCopilotAskUser {
  type: 'copilot-ask-user';
  agentId: string;
  toolId: string;                 // == toolCallId
  requestId: string;              // SDK user_input.requested id (single-resolution key); '' on node-pty
  question: string;               // native (SDK) or normalized from arguments (node-pty)
  options: { text: string }[];    // ORDERED; original display text, verbatim
  freeform: boolean;              // whether a non-listed answer is accepted (allowFreeform)
}
```

Add `SrvCopilotAskUser` to the server→client message union. The server stays a dumb
forwarder: it does **not** assign selector labels or format HTML.

> **Argument-shape (node-pty degraded path only).** For the SDK/ui-server backend the
> fields are native and stable, so no scraping is needed. For node-pty, `events-watcher.ts`
> normalizes `ask_user` arguments to `{ question, options: {text}[], freeform }` regardless
> of upstream key names (`question`/`prompt`; `options`/`choices` as `string[]` or
> `{label,value}[]`; the freeform flag). This was resolved by the spike — no open TODO.

**Non-regression**: the pre-existing `copilot-tool-start` for `ask_user` still fires
with its static status, so `formatToolStatus`, `isAskUserTool`, waiting-state, and
agent-status presentation are byte-for-byte unchanged (FR-016).

---

## 2. IPC relay: server message → main + renderer

`electron/terminal/ipc-relay.ts` — add a `case 'copilot-ask-user'` in **both** fan-out
switches (main-events and renderer webContents), mirroring the existing
`copilot-tool-start` cases (`ipc-relay.ts:297,321`):

```ts
// main-process consumers (Teams service):
case 'copilot-ask-user':
  this.mainEvents.emit('copilot-ask-user', msg.agentId, msg.toolId, msg.requestId, msg.question, msg.options, msg.freeform);
  break;

// renderer parity (no Phaser consumer required by this feature):
case 'copilot-ask-user':
  win.webContents.send('copilot-ask-user', msg.agentId, msg.toolId, msg.requestId, msg.question, msg.options, msg.freeform);
  break;
```

Also add the reverse `mainSubmitAnswer(officeId, agentId, { requestId?, answer, wasFreeform })`
→ server `submit-answer` IPC (mirrors `mainSubmitPrompt` → `submit-prompt`). Update the
channel-list doc comment at `ipc-relay.ts:18` to include
`'copilot-ask-user' (agentId, toolId, requestId, question, options, freeform)` and
`'submit-answer' (officeId, agentId, requestId?, answer, wasFreeform)`.

---

## 3. Preload bridge (renderer parity)

`electron/terminal/preload.ts` — add symmetric bridge surface next to
`onCopilotToolStart` (`preload.ts:138`, type at `:325`), plus cleanup in
`removeAllListeners`:

```ts
onCopilotAskUser: (
  cb: (agentId: string, toolId: string, requestId: string, question: string, options: {text:string}[], freeform: boolean) => void
) => () => void;
```

No renderer consumer is required by this feature; the bridge exists for boundary
symmetry and future in-app rendering.

---

## 4. SessionGateway mapping: IPC event → AgentEvent

`electron/teams/sessionGateway.ts` — in `RelaySessionGateway.onAgentEvent`, subscribe to
`copilot-ask-user` and map it to the new `ask-user` AgentEvent kind. **Selector labels
are NOT assigned here** — the gateway is transport-only; the consumer (`TeamsService`)
owns presentation and assigns `A/B/C` labels (see question-answer-flow.md §A):

```ts
const onAskUser = (...args: unknown[]) => {
  const agentId = args[0] as string;
  const toolId = args[1] as string;
  const requestId = args[2] as string;
  const question = args[3] as string;
  const options = (args[4] as { text: string }[]) ?? [];
  const freeform = Boolean(args[5]);
  cb({ agentId, kind: 'ask-user', askUser: { toolId, requestId, question, options, freeform } });
};
this.relay.mainEvents.on('copilot-ask-user', onAskUser);
// ...and off() in the returned unsubscribe
```

`AgentEvent` / `AgentEventKind` extension is defined in
[data-model.md](../data-model.md). The `TerminalRelayLike.mainEvents` surface already
exposes generic `on/off`, so no interface change is needed there.

---

## 5. Answer channel: Teams answer → running session (FR-004)

The single transport-agnostic answer seam is `RelaySessionGateway.submitAnswer` — it does
**not** reuse `submitPrompt`. Answers resolve the *pending interaction* (SDK) or inject
keystrokes (node-pty); either way the resolution appears in the terminal exactly once with
no forked/duplicated session (Principle III).

```ts
// electron/teams/sessionGateway.ts — additive; submitPrompt stays for ordinary prompts
submitAnswer(officeId: string, agentId: string,
  a: { requestId?: string; answer: string; wasFreeform: boolean }): Promise<void>;
//   → relay.mainSubmitAnswer(officeId, agentId, a) → server 'submit-answer' IPC
```

`electron/terminal/server.ts` — add a `case 'submit-answer'` handler (near `submit-prompt`,
~L971):
- **SDK/ui-server backend** → `handlePendingUserInput(requestId, { answer, wasFreeform })`
  (§0), which resolves the stored `onUserInputRequest` promise (fallback:
  `session.rpc.ui.handlePendingUserInput`). No-op + warn if `requestId` is unknown/already
  resolved (idempotent, supports the single-resolution race).
- **node-pty backend** → `submitViaKeystrokes(backendProc, answer, key)` (idle-gated type +
  Enter, ~L380). Keystroke/RPC logic lives only in this handler — never re-implemented.

**Local-resolution signal:** the server also forwards `user_input.completed
{ answer, wasFreeform, requestId }` to main (for Teams-online agents even with no viewer),
so `TeamsService` can detect an in-app answer and post the "answered in app" notice
(FR-008). See question-answer-flow.md §C.

---

## Contract test expectations

- **Handler registration (§0, spike prerequisite)**: both `ControlPlaneClient.createOrResumeSession`
  and `CopilotSdkBackend.resumeOrCreateSession` register `onUserInputRequest` (so
  `requestUserInput: true`); `handlePendingUserInput(requestId, …)` resolves a stored late
  promise and is an idempotent no-op for an unknown/resolved `requestId`.
- **Server emitter**: given a synthetic `user_input.requested` (SDK) — or, for node-pty, a
  `tool.execution_start` with `toolName: 'ask_user'` — the server emits both
  `copilot-tool-start` (status `'Waiting for your answer'`) **and** `copilot-ask-user` with
  `{requestId, question, options:[{text}], freeform}`. For any non-`ask_user` tool, **no**
  `copilot-ask-user` is emitted and `copilot-tool-start` is unchanged (FR-016).
- **Relay fan-out**: a `copilot-ask-user` server message emits the main event and the
  renderer send with the exact positional args above (incl. `requestId`); `submit-answer`
  fans out from `mainSubmitAnswer`; existing events unaffected.
- **Gateway mapping**: a `copilot-ask-user` main event yields one `ask-user` AgentEvent
  with `askUser.requestId` carried, `askUser.options` order preserved, `freeform` coerced
  to boolean, and **no labels assigned**; `submitAnswer(...)` calls `mainSubmitAnswer` with
  the exact `{requestId, answer, wasFreeform}` payload.
