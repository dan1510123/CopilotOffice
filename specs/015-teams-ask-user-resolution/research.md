# Research: Resolve ask_user Prompts via Teams Remote

**Feature**: `015-teams-ask-user-resolution` | **Date**: 2026-07-11
**Input**: [spec.md](./spec.md)

This document resolves the two open questions that gate the design: (1) **how an
`ask_user` selection is actually submitted to the running agent** (and whether it
needs semantics distinct from a normal free prompt), and (2) **how to preserve the
`ask_user` payload end-to-end** so the question and its options can be presented in
Teams. All findings are grounded in the current code.

---

## Decision 1 — Answer-submission mechanism (CRITICAL)

**Question**: When a Teams reply resolves an `ask_user` question, how is the selected
answer delivered to the agent so its turn continues, and is that mechanism distinct
from submitting an ordinary prompt?

**Finding — there is a single prompt-submission transport; no dedicated
"resolve-interaction" API exists in this codebase.** The path is:

```
TeamsService dispatch/answer
  → RelaySessionGateway.submitPrompt(officeId, agentId, text, label)   electron/teams/sessionGateway.ts:72
  → TerminalRelay.mainSubmitPrompt(...)                                 electron/terminal/ipc-relay.ts:223
      IPC { type:'submit-prompt', officeId, agentId, prompt, label }    electron/terminal/protocol.ts:29
  → server 'submit-prompt' handler                                      electron/terminal/server.ts:971
      ├─ SDK/ui-server backend: backendProc.submitPrompt(prompt,label)  → session.send({prompt, mode:'enqueue'})
      │                                                                    electron/terminal/terminal-backend.ts:333,357
      └─ node-pty backend: submitViaKeystrokes(proc, prompt, key)       electron/terminal/server.ts:380
             Ctrl+U (clear line) → bracketed paste → idle-gated Enter (closed-loop, retries)
```

Both backends drive the **same input surface the local operator uses**: the SDK
backend enqueues into the CLI's turn loop; the node-pty backend types into the real
Ink TUI's input line. `ask_user` is an **interactive TUI prompt rendered inline** by
the CLI, and locally it is answered by that same input line (typing the choice /
number, or the freeform text, then Enter). There is **no separate keystroke protocol
or SDK interaction-response call** for `ask_user` anywhere in `electron/terminal/*`
or `src/main.ts` (ask_user is only special-cased for *status/waiting-state*
presentation — `src/util/toolStatus.ts`, `src/config/agentStatusPresentation.ts`,
`src/main.ts:2205` — never for answer submission).

> ⚠️ **SUPERSEDED for the SDK/ui-server backend by the spike (see "Runtime verification —
> RESOLVED by spike" and "Revised Decision 1" below).** The `submitPrompt`/`enqueue`
> reasoning in the next three paragraphs applies **only to the node-pty fallback** now.
> The SDK/ui-server backend answers via the dedicated user-input interaction channel
> (`onUserInputRequest` / `handlePendingUserInput(requestId)`), unified behind
> `gateway.submitAnswer`.

**Decision**: **Reuse the existing `submitPrompt` path unchanged** as the answer
channel. The Teams answer flows through
`RelaySessionGateway.submitPrompt → mainSubmitPrompt → server 'submit-prompt'`,
identical to a normal Teams prompt. This is the only path that satisfies constitution
Principle III (Real-Agent Session Integrity): a Teams answer is delivered on the same
channel as a local answer, so the resolution is reflected in the CopilotOffice
terminal exactly once, with no detached/forked/duplicated session.

**What string is submitted** — the *option's display text*, not the selector label.
Selector labels (`A`, `B`, `1`, `2`) are a **Teams-only presentation affordance** that
this feature generates for the operator; the CLI has never seen them. When a reply's
label matches an option, we submit that option's **original display text** (preserved
from the payload — see Decision 2), which is what a local operator selecting that
option would produce. For a freeform answer we submit the raw reply text. This keeps
the submitted value identical to the local answer for the same choice.

**Rationale**:
- One transport → guaranteed single-submission parity with local answers (FR-004,
  SC-003/004); nothing new to keep in sync with the local path.
- Reuses the per-agent `DispatchQueue` and forwarding lifecycle already wired for
  online agents (FR-012 ordering falls out for free — see Decision 4).
- No new IPC verb, no bot, no auth change (spec Assumptions; constitution Principle V).

**Alternatives considered**:
- *A dedicated `resolve-ask-user` IPC / SDK interaction-response call.* Rejected —
  no such API exists in the SDK wrapper (`terminal-backend.ts` exposes only
  `submit-prompt`/`write`), and adding one would create a second answer channel that
  can diverge from the local path (Principle III/IV risk). If a future SDK exposes a
  true interaction-response, it can be adopted behind the same gateway method.
- *Direct `mainWrite` keystroke injection of the bare selector label* (bypassing
  `submitViaKeystrokes`). Rejected as the default — it re-implements submission and
  loses the closed-loop "prompt accepted" confirmation and idle-gating that
  `submitViaKeystrokes` already provides. Retained only as the documented **fallback**
  below.

### Runtime verification — RESOLVED by spike (2026-07-11)

**A spike was run against the real bundled CLI (`@github/copilot-1.0.71`) and the SDK
(`@github/copilot-sdk@1.0.5`).** It resolved the open question decisively and, more
importantly, **surfaced a purpose-built SDK mechanism** that is superior to reusing the
prompt-submission path for the SDK/ui-server backend.

**Key findings:**

1. **`ask_user` maps to the SDK "user input" interaction, not to elicitation and not to
   an ordinary prompt.** When the agent calls `ask_user`, the SDK emits a
   `user_input.requested` event: `{ requestId, question, choices: string[],
   allowFreeform: boolean, toolCallId }`. The choices/question/freeform flag are
   **carried natively in this event** — this also partially resolves Decision 2 for the
   SDK backend (no need to scrape discarded tool arguments; the payload is first-class).

2. **The SDK accepts a programmatic answer that unblocks the agent**, via either:
   - registering `onUserInputRequest(request, {sessionId}) => Promise<{answer,
     wasFreeform}>` at `createSession`/`resumeSession`, **or**
   - listening for `user_input.requested` and calling
     `session.rpc.ui.handlePendingUserInput({ requestId, ... })`.
   The handler's returned promise **can be resolved late** — the spike deliberately held
   the answer for 3s (simulating a Teams reply arriving out-of-band); the agent waited,
   then continued with the supplied answer and emitted `user_input.completed
   { answer, wasFreeform, requestId }`. Verdict line confirmed the agent honored the
   programmatic selection (`SELECTED=blue`).

3. **CRITICAL prerequisite:** the `ask_user` tool is only *usable* when the session was
   created with a user-input handler registered (`requestUserInput: !!onUserInputRequest`).
   With **no** handler registered, the runtime tells the model the tool is unavailable and
   the model refuses to call it (observed twice in the spike, in both `forStdio` and
   `ui-server` attach modes, before a handler was added). **CopilotOffice's current
   `ControlPlaneClient.createOrResumeSession` does NOT register `onUserInputRequest`** —
   so today, SDK/ui-server-backed agents effectively cannot use `ask_user` at all. This
   feature must register a user-input handler on every managed session for the SDK/ui-server
   backend.

**Revised Decision 1:** For the **SDK/ui-server backend**, do **not** answer via
`submitPrompt`/`enqueue`. Instead register a user-input handler (or use the
`user_input.requested` event + `handlePendingUserInput(requestId)` RPC) and deliver the
**answer** through that dedicated interaction channel. This is the exact gesture the CLI
expects, guarantees the interaction resolves (not "queued for later"), and returns the
`wasFreeform` flag for free. The `requestId` gives a precise single-resolution key.

**node-pty backend (fallback):** there is no SDK session — `ask_user` is handled entirely
inside the real TUI. Here the keystroke-injection path (`submitViaKeystrokes`: idle-gated
type-the-answer + Enter onto the interaction input line) remains the mechanism, exactly as
a local human answer works.

**Unified seam:** both mechanisms hide behind a single
`RelaySessionGateway.submitAnswer(officeId, agentId, { requestId?, answer, wasFreeform })`
so the Teams service stays transport-agnostic and single-resolution lives in one place.
The main-process server routes to `handlePendingUserInput(requestId)` for the SDK/ui-server
backend and to keystroke injection for node-pty.

**Design guard regardless of backend**: the answer is submitted through the gateway
(never by re-implementing keystrokes/RPC in the Teams service), so the Teams service stays
transport-agnostic and the single-resolution guarantee lives in one place.

---

## Decision 2 — Preserving the ask_user payload end-to-end

**Question**: The relayed tool-start carries only a static status label; the arguments
(question, options, freeform flag) are discarded. How do we carry them to the Teams
service without regressing existing tool-start signaling (FR-015, FR-016)?

**Finding — the payload is dropped at the terminal server (node-pty path).** For
`tool.execution_start`, the server sends only `{toolName, toolId, status}`, where
`status = formatToolStatus(toolName, arguments)` and `formatToolStatus('ask_user', …)`
returns the constant `'Waiting for your answer'`, discarding `arguments`
(`electron/terminal/events-watcher.ts:221`, `.../server.ts:762`). **However, the spike
(Decision 1) showed the SDK/ui-server backend does NOT depend on this path at all**: it
emits a first-class `user_input.requested { requestId, question, choices, allowFreeform,
toolCallId }` event that carries the full payload natively. So payload preservation splits
by backend: **native for SDK/ui-server**, **arguments-scrape best-effort for node-pty**.

**Decision — supplement, don't replace, the tool-start relay.** Add a **new dedicated
`copilot-ask-user` event** emitted *alongside* the existing generic `copilot-tool-start`
(which continues unchanged so status/waiting-state signaling and all other tools are
untouched — FR-016).

Concretely (full shapes in [contracts/events-ipc.md](./contracts/events-ipc.md)):
- **Server → main/renderer**: emit a new
  `copilot-ask-user { agentId, toolId, requestId, question, options: {text}[], freeform }`
  server message. On the **SDK/ui-server backend** the fields come from the native
  `user_input.requested` event (incl. the `requestId` single-resolution key). On the
  **node-pty backend** the server normalizes `event.data.arguments` best-effort
  (`requestId` unavailable). The server carries the *ordered option display text only* —
  it does **not** assign selector labels.
- **protocol.ts**: add `SrvCopilotAskUser` (with `requestId`) to the server→client union.
- **ipc-relay.ts**: relay it to `mainEvents.emit('copilot-ask-user', …)` (for the Teams
  service) and `webContents.send('copilot-ask-user', …)` (renderer parity, unused by
  Phaser today but keeps the boundary honest).
- **preload.ts**: expose `onCopilotAskUser(cb)` for symmetry (no renderer consumer
  required by this feature).
- **sessionGateway.ts**: map `copilot-ask-user` into a new `AgentEvent` kind
  `ask-user` carrying `{ question, options: {text}[], freeform, toolId, requestId }` —
  transport only, **no labels assigned here**.

**Rationale**:
- Additive — the generic `copilot-tool-start` for `ask_user` still fires with its
  static status, so `isAskUserTool` / waiting-state / agent-status presentation are
  byte-for-byte unchanged (FR-015 "without regressing", FR-016).
- A dedicated typed event avoids overloading the positional `copilot-tool-start`
  signature (which four call sites unpack positionally) — no risk to existing consumers.
- Mirrors the established pattern: each copilot concern (`turn-start`, `turn-end`,
  `tool-start`, `tool-complete`, `user-message`) is its own event through the same
  relay; `ask-user` becomes one more.

**Where labels are assigned**: assign in the **Teams service (`TeamsService`) consumer**,
not the server or the gateway. The server and `SessionGateway` stay dumb forwarders of the
raw ordered option text; the Teams-facing label convention (letters `A,B,…` per spec
examples) is a presentation concern owned solely by the consumer that posts to Teams. This
keeps the renderer/other consumers free to label differently and keeps `electron/terminal/*`
and the gateway free of Teams presentation policy.

**Alternatives considered**:
- *Widen `copilot-tool-start` to also carry `arguments`.* Rejected — changes a shared,
  positionally-unpacked event consumed by renderer status logic; higher blast radius
  and easy to regress (FR-016). A separate event is strictly additive.
- *Re-fetch the arguments in main from some cache.* Rejected — no such cache exists;
  the arguments only exist transiently in the server's event stream.

---

## Decision 3 — Question presentation (Option A: formatted text)

**Question**: Rich formatted text (reply with a number/letter) vs Adaptive Card with
clickable buttons?

**Decision — formatted HTML text with generated selector labels (Option A).** Post a
single (chunked) HTML reply via the existing `graphClient.replyToThread` path used by
`safeReply`, framed as needing an answer, listing each option as `Label — text` and
stating whether freeform is accepted.

**Rationale (already fixed in the spec Clarifications, restated for grounding)**:
- The receive path monitors **posted thread messages only** (Trouter/chatsvc). An
  Adaptive Card `Action.Submit` produces a client-side **invoke** deliverable **only to
  a registered bot endpoint** and creates **no thread message** — so a card answer is
  undetectable by the local monitor.
- Card interactivity would require a new Azure Bot registration + hosted messaging
  endpoint, breaking the delegated-token (`az` CLI) model; even a display-only card
  send is permission-risky (the Graph token lacks `ChannelMessage.Send`).
- HTML text send is already proven and in use (`safeReply` → `graphClient`), carries
  the self-marker, and chunks cleanly.

**Alternatives considered**: Adaptive Cards — deferred behind a future bot
registration (spec Assumptions).

---

## Decision 4 — Ordering, single-resolution, and lifecycle reuse

**Question**: How do we guarantee at-most-once resolution (Teams vs local race,
FR-007), keep queued follow-ups behind the resolution (FR-012), and handle
offline/session-end abandonment (FR-009)?

**Findings & decisions**:
- **Pending state lives in the Teams service** as one `PendingQuestion` per online
  agent (`Map<agentId, PendingQuestion>`), created on the `ask-user` AgentEvent and
  cleared on resolution / supersession / turn-end-without-ask / offline / session-exit.
  (Data model in [data-model.md](./data-model.md).)
- **Single-resolution (FR-007)**: the `PendingQuestion` carries a `resolved` flag
  flipped atomically by the *first* resolver, keyed by `requestId`. The Teams answer path
  checks-and-sets it before calling `submitAnswer`; a later Teams reply for the same
  question finds `resolved` (or no pending record) and is a no-op — and
  `handlePendingUserInput(requestId)` is itself idempotent (defense in depth). The
  **local** answer is detected via the SDK `user_input.completed { requestId }` event
  (node-pty fallback: the `turn-start`/`message`/`user-message`/`tool-complete` signal
  that the ask_user wait ended) — at which point the service clears the pending record and
  (per FR-008) posts a short "answered in app" notice. Because both the local resolution
  signal and the Teams answer mutate the same in-service record, exactly one wins.
- **Ordering (FR-012)**: answers do **not** go through the normal inbound-dispatch
  enqueue path. When a reply arrives while a question is pending, `handleInbound`
  routes it to the **answer resolver** (submit selected option / freeform / nudge)
  *instead of* `queue.enqueue(...)`. This structurally prevents a follow-up prompt from
  being dispatched ahead of the resolution: only the answer is submitted; any genuine
  next prompt is a *new* inbound after the question clears. (If a prompt was already
  queued before the question appeared, the per-agent queue is FIFO and single-flight
  (`DispatchQueue.drain`), so the in-flight ask_user turn settles before the next item.)
- **Offline / session-end (FR-009)**: reuse existing teardown hooks — `goOffline`
  (already posts an offline notice and `queue.clear`) and `onSessionExit` — to clear
  the pending record and, if one was outstanding, post the "no longer answerable"
  notice. `messageFilter` already drops replies to unbound/offline threads, so
  post-offline replies never reach the resolver.

---

## Decision 5 — Self-loop, chunking, filtering reuse

**Decision — no new infrastructure.** Every posted message in this flow (question,
nudge, "answered in app", "no longer answerable") goes through the existing
`safeReply` → `graphClient.replyToThread`, which embeds the zero-width self-marker
(`marker.ts`) and records the posted message id in `postedMessageIds` (deterministic
self-loop guard, `teamsService.ts:399,1052`). Long questions/option lists are chunked
with the existing `chunkReply(text, 3500)` (`chunk.ts`). Inbound replies remain
subject to `messageFilter.evaluate` (dedup/marker/binding/orphaned/foreign) exactly as
today (FR-010, FR-011). No @mention is required within a bound thread (FR-011).

**Rationale**: satisfies FR-010/FR-011 with zero new surface; consistent with spec
Assumptions ("reused rather than reinvented").

---

## Summary of resolved unknowns

| Unknown | Decision |
|---|---|
| ask_user answer submission mechanism | **RESOLVED via spike.** SDK/ui-server backend: `ask_user` = SDK `user_input.requested` `{requestId,question,choices,allowFreeform}`; answer via registered `onUserInputRequest` handler (late-resolvable promise) or `rpc.ui.handlePendingUserInput({requestId,...})` → agent continues, emits `user_input.completed`. **Prerequisite:** a user-input handler MUST be registered on managed sessions or the tool is unusable (model refuses). node-pty fallback: keystroke injection. Unified behind `gateway.submitAnswer({requestId?,answer,wasFreeform})`. |
| Payload preservation | SDK/ui-server backend: **native** — question/choices/freeform arrive in the `user_input.requested` event (no scraping needed). Relay additively as a new `ask-user` AgentEvent kind; keep `copilot-tool-start` unchanged (FR-016). node-pty backend: no structured event (TUI-rendered) — structured surfacing is best-effort/degraded there. |
| Presentation | Formatted HTML text with generated selector labels (Option A); no Adaptive Cards. |
| Single-resolution & ordering | In-service `PendingQuestion` keyed by `requestId` with a `resolved` flag; answers bypass the dispatch enqueue; reuse FIFO queue for genuine follow-ups. Local answer detected via `user_input.completed`. |
| Offline/abandonment, self-loop, chunking, filtering | Reuse `goOffline`/`onSessionExit`, `safeReply`+marker+`postedMessageIds`, `chunkReply`, `messageFilter`. |

**No remaining NEEDS CLARIFICATION** — and the previously-open runtime risk (how an
`ask_user` interaction is resolved programmatically) is now **empirically resolved by a
spike** against the real CLI + SDK: the dedicated `user_input.requested` /
`onUserInputRequest` / `handlePendingUserInput` channel works, accepts a late answer, and
unblocks the agent. The one new obligation this surfaced — sessions must register a
user-input handler for `ask_user` to be usable on the SDK/ui-server backend — is an
implementation task, not an open question.

## Decision 6 — Post-implementation hardening (reliability)

A runtime-reliability review after the MVP landed surfaced three defects that were fixed
without changing the user-facing contract:

- **h1 — precise local-resolution signal.** The MVP fired the "answered in the app"
  local-resolution on *any* subsequent non-`ask-user` event for a pending agent, which
  false-positives if the agent emits events while still blocked on the question (deleting
  the record early → a real Teams reply is then dropped). Fix: forward the SDK's
  `user_input.completed` as a dedicated `copilot-ask-user-complete` main event → new
  `ask-user-complete` AgentEvent kind carrying the `requestId`; TeamsService clears the
  pending record **only** on the matching requestId. The old heuristic is retained **only**
  for the node-pty degraded path (empty requestId), which has no completion event.
- **h2 — transport-failure re-open.** A failed `submitAnswer` used to leave the record
  `resolved` and deleted, silently dropping the reply and hanging the agent. Fix: the
  server's `submit-answer` returns the **real** resolve outcome (`success: resolved`);
  `submitAnswerSafe` returns a boolean; on failure the single-resolution latch is
  **released**, the record is **kept**, and a "couldn't deliver — please reply again"
  notice is posted. The synchronous check-and-set latch (first resolver wins) is preserved.
- **h3 — session-scoped pending map + GC.** The `pendingUserInput` map was process-global
  and keyed only by `requestId` (cross-agent collision risk; orphaned resolver leak if a
  session is killed mid-question). Fix: key by `sessionId`,
  `handlePendingUserInput(sessionId, …)` resolves the session's single pending interaction,
  and `clearPendingUserInputForSession(sessionId)` (called from the PTY `onExit`) GCs a
  torn-down session's pending interaction.

### Spike 2026-07-13 — the `onUserInputRequest` callback carries no requestId (BLOCKER, fixed)

A live SDK spike (`forStdio`, real bundled CLI) proved the SDK/ask_user answer path had a
latent, always-failing bug on the primary backend. Two parallel surfaces expose the
interaction with **different fields**:

| Surface | Shape | Has `requestId`? |
|---|---|---|
| `user_input.requested` **event** (`session.on`) | `{ requestId, question, choices, allowFreeform, toolCallId }` | ✅ yes |
| `onUserInputRequest` **callback** `request` arg | `{ question, choices, allowFreeform }` | ❌ **no** (only `ctx.sessionId`) |

Teams relays and echoes back the **event's** `requestId`, but our resolver map was keyed by
the **callback's** `requestId` — which is `undefined`. The lookup could therefore NEVER
match, every SDK/ui-server answer returned `resolved=false`, and (post-h2) the user saw
"⚠️ I couldn't deliver that answer." Because `ask_user` **blocks the turn**, there is at
most one pending user-input per session, so the correct and sufficient key is **`sessionId`
alone** (the only correlation the callback provides via `ctx.sessionId`). The event-stream
`requestId` remains the single-resolution key at the *TeamsService* layer (question framing,
`user_input.completed` matching for h1) — it is simply not usable to correlate the *resolver
callback*. node-pty is unaffected (keystroke path, no resolver map).
