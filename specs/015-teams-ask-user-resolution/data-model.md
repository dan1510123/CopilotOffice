# Data Model: Resolve ask_user Prompts via Teams Remote

**Feature**: `015-teams-ask-user-resolution` | **Date**: 2026-07-11
**Input**: [spec.md](./spec.md) · [research.md](./research.md)

All new state is **transient, in-memory, main-process-only** (in the Teams service).
Nothing here is persisted: a pending question is meaningful only while an agent is
online and mid-turn, and it is abandoned on offline/session-exit/restart (spec Edge
Cases, FR-009). No changes to the persisted `TeamsStoreState`
(`electron/teams/types.ts`).

---

## Entities

### PendingQuestion

The record that an online agent currently awaits an `ask_user` answer. **At most one
per online agent** (spec: "Only one `ask_user` question is outstanding per online agent
at a time"). Held in `TeamsService` as `Map<agentId, PendingQuestion>`.

| Field | Type | Notes |
|---|---|---|
| `agentId` | `string` | Owning agent (maps to its single online binding). |
| `officeId` | `string` | Office of the binding (for `submitPrompt` addressing). |
| `binding` | `OnlineAgentBinding` | Resolved bound thread (routing target). |
| `toolId` | `string` | The `ask_user` tool-call id from the payload (`toolCallId`); informational / diagnostics. |
| `requestId` | `string` | The SDK `user_input.requested` request id — **the single-resolution key** (research Decision 1). Passed to `submitAnswer`/`handlePendingUserInput`; distinguishes a superseding question from a stale one. Undefined only on the degraded node-pty path. |
| `question` | `string` | The question text (preserved from payload, FR-015). |
| `options` | `Option[]` | Ordered list; order = presentation order and label assignment order. |
| `freeform` | `boolean` | Whether a non-listed answer is accepted (FR-002/FR-006). |
| `resolved` | `boolean` | Single-resolution latch (FR-007). Set `true` by the first resolver (Teams or local); guards all later Teams replies. |
| `postedMessageId` | `string \| undefined` | Message id of the posted question (self-loop bookkeeping; also lets a nudge reference it). |
| `createdAt` | `number` | Unix ms; diagnostics / stale-guard. |

**Validation / invariants**
- `options.length >= 1` for a choices-only question; a `freeform`-only question MAY
  have `options.length === 0` (then any reply is the answer).
- Labels within `options` are unique and stable for the life of the record.
- Exactly one `PendingQuestion` per `agentId` in the map; creating a new one for an
  agent that already has one **supersedes** the old (the old is dropped and no longer
  answerable — spec Edge Case "superseded by a new question").
- `resolved` transitions `false → true` exactly once; never back.

### Option

A single selectable answer within a `PendingQuestion`.

| Field | Type | Notes |
|---|---|---|
| `label` | `string` | System-generated selector shown in Teams (e.g. `A`, `B`, `C` or `1`, `2`, `3`). **Matching key** (FR-014). Case-insensitive on match. |
| `text` | `string` | Original option display text from the `ask_user` payload. **This is the value submitted to the agent** when the option is chosen (research Decision 1). |

**Validation**
- `label` matches the generated convention (letters `A…` per spec examples;
  implementation MAY choose letters or numbers but MUST be consistent within a
  question and unique).
- `text` is non-empty and preserved verbatim from the payload (never re-derived).

---

## Relationships

```
OnlineAgentBinding (1) ──owns──> (0..1) PendingQuestion ──has──> (1..*) Option
        │                                   │
   agentId key                         resolved: bool  (first resolver wins)
```

- A `PendingQuestion` references its `binding` (thread routing) and never outlives the
  binding's online state.
- `Option` has no identity beyond its position + `label` within its `PendingQuestion`.

---

## State machine — PendingQuestion lifecycle

```
             ask-user AgentEvent (payload preserved)
   (none) ───────────────────────────────────────────────▶ PENDING
                                                            (post question to thread)

PENDING ──valid selector-label reply (Teams)──▶ RESOLVING ──submit option.text──▶ RESOLVED → (cleared)
PENDING ──freeform reply, freeform=true─────────▶ RESOLVING ──submit reply text──▶ RESOLVED → (cleared)
PENDING ──non-label reply, freeform=false──────▶ PENDING   (post nudge; stay open)   [FR-005]
PENDING ──local answer (wait-end signal)───────▶ RESOLVED  (post "answered in app")  [FR-008]
PENDING ──new ask-user (different requestId)────▶ superseded → new PENDING           [Edge: superseded]
PENDING ──turn-end w/o ask_user still active────▶ (cleared, no notice)               [defensive]
PENDING ──agent goes offline / session exit─────▶ ABANDONED (post "no longer answerable") [FR-009]
RESOLVED / ABANDONED ──any later Teams reply for same question──▶ no-op              [FR-007]
```

**Transition rules**
1. **Enter PENDING**: on `ask-user` AgentEvent for an online agent (FR-013 — any turn,
   Teams- or locally-initiated). Assign labels to `options` in order; post the question
   (chunked, marked). Supersede any existing record for that agent.
2. **Teams resolve (RESOLVING→RESOLVED)**: only if `resolved === false`. Atomically set
   `resolved = true`, then `gateway.submitAnswer(officeId, agentId, { requestId, answer: valueToSubmit, wasFreeform })`
   where `valueToSubmit` = matched `option.text` (label match, `wasFreeform:false`) or the
   raw reply text (freeform, `wasFreeform:true`). The gateway routes this to the terminal
   server's `submit-answer` IPC → `handlePendingUserInput(requestId)` for the SDK/ui-server
   backend, or keystroke injection for node-pty (research Decision 1). Clear the record.
   The resumed turn then streams back through the existing dispatch/ambient path.
3. **No-match, choices-only (stay PENDING)**: post a nudge re-listing options + labels
   (FR-005). Do **not** set `resolved`.
4. **Local resolve (→RESOLVED)**: primary signal is the SDK `user_input.completed
   { answer, wasFreeform, requestId }` event (the answer was given in-app). As a
   node-pty/degraded fallback, a `turn-start` / `message` / `user-message` /
   `tool-complete` that clears the ask_user wait (per `nextSubStateAfterToolComplete`)
   while a record is still pending also implies a local answer. If `resolved` is still
   `false`, set it, clear the record, and post the short "answered in app" notice
   (FR-008).
5. **Supersede**: a new `ask-user` with a different `requestId` replaces the record; stale
   selectors can no longer resolve the replaced question (spec Edge Case).
6. **Abandon (→cleared + notice)**: `goOffline` / `onSessionExit` clears the record; if
   one was outstanding, post "no longer answerable" (FR-009). Post-offline replies are
   already dropped by `messageFilter`.
7. **Idempotence**: any Teams reply arriving when `resolved === true` or no record
   exists is a no-op (FR-007, SC-004).

---

## New/changed types (implementation shape)

New Teams-domain types (add to `electron/teams/types.ts` or a co-located module):

```ts
export interface AskUserOption {
  label: string;   // generated selector shown in Teams (matching key)
  text: string;    // original option text; submitted to the agent when chosen
}

export interface PendingQuestion {
  agentId: string;
  officeId: string;
  binding: OnlineAgentBinding;
  toolId: string;
  requestId: string;              // SDK user_input.requested id — single-resolution key
  question: string;
  options: AskUserOption[];
  freeform: boolean;
  resolved: boolean;
  postedMessageId?: string;
  createdAt: number;
}
```

Extended AgentEvent surface (`electron/teams/sessionGateway.ts`) — **additive**:

```ts
export type AgentEventKind =
  | 'message' | 'turn-start' | 'turn-end' | 'tool-start' | 'user-message'
  | 'ask-user';                                   // NEW

export interface AgentEvent {
  agentId: string;
  kind: AgentEventKind;
  content?: string;
  toolName?: string;
  // NEW — populated only when kind === 'ask-user':
  askUser?: {
    toolId: string;
    requestId?: string;            // SDK single-resolution key (undefined on node-pty)
    question: string;
    options: { text: string }[];   // ordered; labels assigned by the consumer (TeamsService)
    freeform: boolean;
  };
}
```

No changes to `TeamsStoreState`, `OnlineAgentBinding`, `KnownThread`, or
`OnlineAgentStatus`. Persistence, GC, and reconnect are untouched.
