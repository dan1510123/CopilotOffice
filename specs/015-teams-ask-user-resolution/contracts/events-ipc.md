# Contract: ask_user Payload Relay (server → main → Teams)

**Feature**: `015-teams-ask-user-resolution` | **Date**: 2026-07-11

Defines the **additive** event/IPC changes that carry the `ask_user` payload
(question, ordered options, freeform flag) from the terminal server to the Teams
service. The existing generic `copilot-tool-start` relay is **unchanged** (FR-015/016);
this contract adds a parallel `copilot-ask-user` event. Field names/positions of all
existing copilot events are preserved.

---

## 1. Terminal server → clients (WebSocket message)

**Existing (unchanged)** — emitted for every tool including `ask_user`:

```ts
// electron/terminal/server.ts (tool.execution_start), protocol.ts SrvCopilotToolStart
{ type: 'copilot-tool-start', agentId, toolName, toolId, status }
// status for ask_user stays the constant 'Waiting for your answer'
```

**NEW `SrvCopilotAskUser`** (`electron/terminal/protocol.ts`) — emitted **in addition**
when `event.data.toolName === 'ask_user'`, from the same `tool.execution_start` branch
(`server.ts:760-768`):

```ts
export interface SrvCopilotAskUser {
  type: 'copilot-ask-user';
  agentId: string;
  toolId: string;                 // == tool.execution_start toolCallId
  question: string;               // from event.data.arguments (question/prompt field)
  options: { text: string }[];    // ORDERED; original display text, verbatim
  freeform: boolean;              // whether a non-listed answer is accepted
}
```

Add `SrvCopilotAskUser` to the server→client message union. Server code stays a dumb
forwarder: it reads `event.data.arguments`, extracts question/options/freeform, and
sends — it does **not** assign selector labels or format HTML.

> **Argument-shape resolution (implementation task).** The exact `ask_user` argument
> keys (e.g. `question` vs `prompt`; `options`/`choices` as `string[]` vs
> `{label,value}[]`; the freeform flag name) MUST be read from a live
> `tool.execution_start` event during the research spike and mapped here. The server
> extractor normalizes to `{ question, options: {text}[], freeform }` regardless of the
> upstream key names, so downstream contracts are stable.

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
  this.mainEvents.emit('copilot-ask-user', msg.agentId, msg.toolId, msg.question, msg.options, msg.freeform);
  break;

// renderer parity (no Phaser consumer required by this feature):
case 'copilot-ask-user':
  win.webContents.send('copilot-ask-user', msg.agentId, msg.toolId, msg.question, msg.options, msg.freeform);
  break;
```

Update the channel-list doc comment at `ipc-relay.ts:18` to include
`'copilot-ask-user' (agentId, toolId, question, options, freeform)`.

---

## 3. Preload bridge (renderer parity)

`electron/terminal/preload.ts` — add symmetric bridge surface next to
`onCopilotToolStart` (`preload.ts:138`, type at `:325`), plus cleanup in
`removeAllListeners`:

```ts
onCopilotAskUser: (
  cb: (agentId: string, toolId: string, question: string, options: {text:string}[], freeform: boolean) => void
) => () => void;
```

No renderer consumer is required by this feature; the bridge exists for boundary
symmetry and future in-app rendering.

---

## 4. SessionGateway mapping: IPC event → AgentEvent

`electron/teams/sessionGateway.ts` — in `RelaySessionGateway.onAgentEvent`, subscribe to
`copilot-ask-user` and map it to the new `ask-user` AgentEvent kind. **Selector labels
are assigned here** (consumer-owned presentation policy):

```ts
const onAskUser = (...args: unknown[]) => {
  const agentId = args[0] as string;
  const toolId = args[1] as string;
  const question = args[2] as string;
  const options = (args[3] as { text: string }[]) ?? [];
  const freeform = Boolean(args[4]);
  cb({ agentId, kind: 'ask-user', askUser: { toolId, question, options, freeform } });
};
this.relay.mainEvents.on('copilot-ask-user', onAskUser);
// ...and off() in the returned unsubscribe
```

`AgentEvent` / `AgentEventKind` extension is defined in
[data-model.md](../data-model.md). The `TerminalRelayLike.mainEvents` surface already
exposes generic `on/off`, so no interface change is needed there.

---

## Contract test expectations

- **Server extractor**: given a synthetic `tool.execution_start` with `toolName:
  'ask_user'` and representative arguments, the server emits both `copilot-tool-start`
  (status `'Waiting for your answer'`) **and** `copilot-ask-user` with the normalized
  `{question, options:[{text}], freeform}`. For any non-`ask_user` tool, **no**
  `copilot-ask-user` is emitted and `copilot-tool-start` is unchanged.
- **Relay fan-out**: a `copilot-ask-user` server message emits the main event and the
  renderer send with the exact positional args above; existing events unaffected.
- **Gateway mapping**: a `copilot-ask-user` main event yields one `ask-user` AgentEvent
  with `askUser.options` order preserved and `freeform` coerced to boolean.
