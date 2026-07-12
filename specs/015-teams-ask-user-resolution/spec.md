# Feature Specification: Resolve ask_user Prompts via Teams Remote

**Feature Branch**: `015-teams-ask-user-resolution`  
**Created**: 2026-07-11  
**Status**: Draft  
**Input**: User description: "I want you to be able to manage an ask_user resolution through the teams remote."

## Context

CopilotOffice agents can be brought "online" in a Microsoft Teams channel thread (spec 011).
Once online, anyone in the channel can drive the agent by replying in its bound thread, and the
agent's answers are posted back. Separately, an agent frequently pauses on an `ask_user`
interaction — a structured question that presents a set of choices (and optionally allows a
freeform answer) and blocks the agent's turn until a selection is made.

Today, when a Teams-online agent raises an `ask_user` question, the thread does not surface the
question or its choices, and a reply is treated as an ordinary follow-up prompt rather than a
resolution of the pending selection. A remote operator therefore cannot reliably see that a
decision is required, cannot see the available options, and cannot answer in a way that cleanly
unblocks the agent. This feature closes that gap: it makes an `ask_user` prompt visible in the
bound thread and lets a Teams reply resolve the pending selection so the agent continues.

## Event Surface & Coverage

The Teams remote feature relays an agent's activity into its bound thread. An event reaches Teams
only if it passes three gates: (1) forwarded from the terminal server to the main process, (2) mapped
into a Teams-consumable agent event, and (3) acted on by the Teams service. The table below records
the full event surface at the time of this spec and each event's current coverage, to bound this
feature's scope and to flag adjacent gaps for future work. **This feature's scope is the `ask_user`
row only** (moving it from "partial" to "full"); the other "not covered" rows are documented as known
gaps, not commitments of this feature.

### Turn & session lifecycle

| Event | Current coverage | In scope for this feature |
|---|---|---|
| Turn start | ✅ Full — keeps the thread turn open | No (reused as-is) |
| Turn end | ✅ Full — flushes the turn as a thread reply | No (reused as-is) |
| Assistant message | ✅ Full — accumulated and posted | No (reused as-is) |
| Assistant message delta (streaming) | ❌ Dropped — superseded by the final assistant message | No |
| User message | ✅ Full — local prompts mirrored; Teams prompts not echoed | No (reused as-is) |
| Session idle | ⚠️ Approximated by an idle-debounce timer (no explicit signal) | No |
| Session exit | ✅ Full — triggers teardown / binding cleanup | No |

### Tool activity

| Event | Current coverage | In scope for this feature |
|---|---|---|
| Tool start (generic) | ⚠️ Partial — only a throttled long-running "check-in" label; tool arguments are discarded at the server | No (except `ask_user`, below) |
| **Tool start — `ask_user`** | ⚠️ Partial — surfaced only as a static "waiting for your answer" label; **question text, options, and freeform flag are discarded** and no answer path exists | **YES — this feature** |
| Tool partial result | ❌ Dropped | No |
| Tool complete (success/failure) | ❌ Dropped — Teams never learns a tool finished or failed | No (known gap) |

### Subagent & system

| Event | Current coverage | In scope for this feature |
|---|---|---|
| Subagent started / completed / failed | ❌ Dropped by the Teams service | No (known gap) |
| System notification | ❌ Dropped by the Teams service | No (known gap) |
| Tool / runtime errors | ❌ Dropped | No (known gap) |
| `report_intent` (agent's stated intent) | ❌ Dropped | No (known gap) |

**Critical implication for this feature**: the `ask_user` tool's payload (question, ordered options,
freeform-allowed flag) is currently **discarded at the terminal server** — the relayed tool-start
carries only a static status label, not the arguments. Surfacing the question and its options in Teams
therefore requires preserving the `ask_user` payload end-to-end (server → main → Teams service). The
existing generic tool-start relay is insufficient and MUST be extended or supplemented (see FR-015).

## Clarifications

### Session 2026-07-11

- Q: Which `ask_user` questions should be forwarded into the bound Teams thread? → A: Every question
  raised by an online agent, regardless of whether the current turn was started from Teams or locally.
- Q: How should a Teams reply be matched to an `ask_user` option? → A: Solely by the option's selector
  label (number/letter); no option-text or fuzzy matching. A non-label reply is a no-match, handled as
  a nudge (choices-only) or as the freeform answer (freeform-allowed).
- Q: How should the question be presented — rich formatted text (reply with a number/letter) or an
  Adaptive Card with clickable option buttons? → A: Formatted text with selector labels (Option A).
  Rationale: the receive path monitors posted thread messages only; an Adaptive Card `Action.Submit`
  produces a client-side invoke deliverable **only to a registered bot endpoint**, creates **no thread
  message**, and is therefore **undetectable by the local monitor**. Card interactivity would require a
  new Azure Bot registration + hosted messaging endpoint, breaking the delegated-token model; even a
  display-only card send is permission-risky (the `az` CLI token lacks `ChannelMessage.Send`). True
  Adaptive Cards are deferred behind a future bot registration.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - See and answer an ask_user question from Teams (Priority: P1)

As an operator away from my machine with an agent online in Teams, when the agent needs a
decision, I want the question and its options posted into the agent's bound thread so I can reply
with my choice and the agent continues — without returning to the desktop app.

**Why this priority**: This is the core value. Without visibility of the question and a working
answer path, a remote agent silently stalls on any decision, defeating the purpose of remote
operation.

**Independent Test**: Bring Gene online in Teams, drive it to a point where it asks a question
with options (e.g., "Which database? A) PostgreSQL B) MySQL C) SQLite"), confirm the question and
labeled options are posted into Gene's thread, reply `B` in the thread, and confirm the agent
proceeds as if MySQL was selected and the terminal reflects the same choice.

**Acceptance Scenarios**:

1. **Given** Gene is online with a bound thread, **When** Gene raises an `ask_user` question,
   **Then** a single message is posted into the bound thread that clearly presents the question
   text and each available option with a stable selector label (e.g., a number or letter), and
   indicates whether a freeform answer is also allowed.
2. **Given** an `ask_user` question is pending in Gene's thread, **When** a channel member replies
   with a valid option selector label (e.g., `B` or `2`), **Then** the corresponding choice is
   submitted to Gene's session, the question is resolved, and Gene continues its turn.
3. **Given** a question was answered from Teams, **When** the agent continues, **Then** the answer
   is reflected in the agent's own CopilotOffice terminal exactly as if it had been chosen locally
   (no divergent or duplicate submission).
4. **Given** an `ask_user` question is pending, **When** the operator instead answers locally in the
   CopilotOffice terminal, **Then** the question resolves normally, a short "answered in app" notice
   is posted to the thread, and a subsequent Teams reply for that same (now-resolved) question does
   not re-submit or corrupt the session.

---

### User Story 2 - Handle unrecognized or freeform answers gracefully (Priority: P2)

As a remote operator, when I reply with something that does not match a listed option, I want clear
feedback so I can correct it, and — when the question permits freeform input — I want my text used
directly.

**Why this priority**: Teams threads are informal and multi-user; replies will not always be clean
selectors. Graceful handling prevents wasted stalls and accidental wrong selections.

**Independent Test**: With a choices-only question pending, reply with text that is not an option
label and confirm a "didn't match an option" nudge is posted and the question stays open; then, with
a freeform-allowed question pending, reply with arbitrary non-label text and confirm the text is
submitted as the answer.

**Acceptance Scenarios**:

1. **Given** a choices-only `ask_user` question is pending, **When** a reply is not a valid option
   selector label, **Then** the question remains unresolved, a brief message re-states the options
   with their labels and asks the responder to pick one, and the agent stays paused.
2. **Given** an `ask_user` question that allows freeform answers is pending, **When** a reply is not
   a valid option selector label, **Then** the reply text is submitted as the freeform answer and the
   agent continues.
3. **Given** a question is pending, **When** multiple replies arrive in rapid succession, **Then**
   only the first reply that resolves the question is applied and later replies for the same question
   are ignored (or treated as the next prompt only after the question is resolved).

---

### User Story 3 - Stay informed that a decision is required (Priority: P3)

As a remote operator not actively watching the thread, I want the pending-decision message to be
attention-getting (consistent with how the agent already signals it needs input) so I notice and
respond promptly.

**Why this priority**: Improves responsiveness but is not required for the core answer flow to work.

**Independent Test**: With notifications observable, trigger an `ask_user` on an online agent and
confirm the thread message is clearly marked as needing an answer (distinct from ordinary agent
chatter).

**Acceptance Scenarios**:

1. **Given** Gene is online, **When** an `ask_user` question is posted to the thread, **Then** the
   message is visibly distinguished as requiring an answer (e.g., a clear "needs your answer" framing)
   rather than appearing as a normal reply.

---

### Edge Cases

- **Agent taken offline while a question is pending**: The pending question is abandoned in Teams;
  a subsequent thread reply is not applied to the (now-unbound) session, consistent with existing
  offline behavior.
- **Session ends / turn aborted while a question is pending**: The thread receives a short notice
  that the question is no longer answerable, and later replies are ignored for that question.
- **Question is superseded by a new question** before the first is answered: only the currently
  pending question is answerable from Teams; stale selectors do not resolve a different question.
- **Very long question or option list**: The posted message is chunked to respect Teams message size
  limits while keeping option selectors stable and unambiguous.
- **Duplicate/self posts**: The question and any nudge messages carry the app's self-marker so they
  are never processed as inbound answers (no self-loops).
- **Answer arrives from Teams and locally at nearly the same time**: Exactly one answer resolves the
  question; the losing path is a no-op with a clear indication that the question was already answered.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: When an online agent raises an `ask_user` interaction, the system MUST post a message
  into that agent's bound Teams thread presenting the question text and every available option with a
  stable, human-selectable label. The message MUST be **formatted text** (rich HTML rendering is
  permitted for readability); it MUST NOT rely on interactive Adaptive Card actions, which are not
  detectable by the message-monitoring receive path without a registered bot.
- **FR-002**: The posted question message MUST indicate whether a freeform (non-listed) answer is
  accepted, and MUST be visibly framed as requiring an answer, distinct from ordinary agent replies.
- **FR-003**: The system MUST interpret a thread reply while a question is pending as an attempt to
  resolve that question, mapping the reply to a specific listed option **only** by matching the
  option's selector label (number/letter); option display text is not used for matching.
- **FR-004**: When a reply resolves the pending question, the system MUST submit the selected answer
  to the agent's existing running session such that the agent continues its turn, with the resolution
  reflected identically in the agent's CopilotOffice terminal (single submission, no divergence).
- **FR-005**: For a choices-only question, when a reply is not a valid option selector label, the
  system MUST leave the question unresolved and post a brief message re-stating the options with their
  labels and requesting a valid selector.
- **FR-006**: For a question that allows freeform answers, when a reply is not a valid option selector
  label, the system MUST submit the reply text as the freeform answer.
- **FR-007**: The system MUST ensure a given pending question is resolved at most once: the first
  resolving input (from Teams or from the local terminal) wins, and any later Teams reply targeting
  that same already-resolved question MUST NOT re-submit or otherwise affect the session.
- **FR-008**: When a pending question is resolved locally in the app, the system MUST post a short
  notice to the bound thread indicating the question was already answered.
- **FR-009**: When an agent goes offline, its session ends, or the pending question is otherwise no
  longer answerable, the system MUST stop treating thread replies as answers to that question and MUST
  post a short "no longer answerable" notice for a question that was outstanding.
- **FR-010**: All system-posted messages related to this flow (question, nudges, notices) MUST carry
  the existing self-marker so they are excluded from inbound processing (no self-loops), and MUST be
  chunked to respect Teams message size limits.
- **FR-011**: The behavior MUST be consistent with the existing Teams remote model: no @mention is
  required to answer within a bound thread, any channel member may answer, and all inbound replies
  remain subject to the existing message-filtering/screening pipeline.
- **FR-012**: While a question is pending, the system MUST NOT dispatch later thread replies as new
  prompts into the session ahead of resolution; ordering with the existing per-agent dispatch queue
  MUST be preserved so a resolution is applied before any queued follow-up prompt.
- **FR-013**: Scope of forwarding — the system MUST post to the bound thread every `ask_user`
  question raised by an online agent, regardless of whether the current turn was initiated from Teams
  or locally at the desktop.
- **FR-014**: Answer-matching rule — a Teams reply MUST be matched to a listed option **solely** by
  its selector label (number/letter). Option display text and fuzzy/substring matching MUST NOT be
  used to select an option. A reply that is not a valid selector label is a "no match" for the listed
  options and is handled per FR-005 (choices-only) or FR-006 (freeform-allowed).
- **FR-015**: The system MUST preserve the `ask_user` interaction payload — question text, the ordered
  list of options, and the freeform-allowed flag — from where it originates through to the Teams
  service, so the thread message can present the actual question and options. The current generic
  tool-start relay (which carries only a static status label and discards the tool arguments) is
  insufficient and MUST be extended or supplemented without regressing existing tool-start signaling.
- **FR-016**: Preserving and relaying the `ask_user` payload MUST NOT change behavior for any other
  event in the Event Surface table (turn start/end, assistant/user messages, generic tool activity,
  subagent/system events); this feature MUST NOT silently alter their current coverage.

### Key Entities *(include if feature involves data)*

- **Pending Question**: A record that an online agent currently awaits an `ask_user` answer. Key
  attributes: owning agent/thread binding, the question text, the ordered set of options with their
  selector labels, whether freeform is allowed, and a resolved/answerable state. At most one is
  outstanding per online agent at a time.
- **Option**: A single selectable answer within a Pending Question, comprising a stable selector
  label (e.g., number or letter) and its display text.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: For an online agent, 100% of `ask_user` questions that are in-scope for forwarding
  result in a thread message that shows the question and all options.
- **SC-002**: A remote operator can resolve a pending question and see the agent resume within one
  round trip — a single reply, no @mention, no app interaction required.
- **SC-003**: A valid selector-label reply (e.g., `B`) is correctly mapped to the intended option in
  100% of cases.
- **SC-004**: In 100% of cases, a question is resolved at most once even when answered from Teams and
  locally near-simultaneously (no duplicate submissions, no session corruption).
- **SC-005**: An unmatched reply to a choices-only question never advances the agent with a wrong
  selection; the agent remains paused until a valid choice or local answer is provided.

## Assumptions

- Builds directly on the existing Teams Remote Agents feature (spec 011): channel configuration,
  thread binding, self-marker, message filtering, per-agent dispatch queue, and chunked sending are
  all reused rather than reinvented.
- The `ask_user` interaction exposes a question, an ordered list of options, and a freeform-allowed
  flag that can be surfaced to the operator; the underlying selection is submitted through the same
  session channel used for ordinary prompts.
- Selector labels are generated by the system for display in Teams (operators reply with a label or
  option text); the operator is not expected to know internal option identifiers.
- The question is presented as formatted text (Option A). Interactive Adaptive Cards are explicitly out
  of scope: their button actions require a registered Teams bot endpoint to receive the selection and
  produce no observable thread message, so they are incompatible with the current delegated-token,
  message-monitoring model. Revisiting cards is future work contingent on a bot registration.
- Only one `ask_user` question is outstanding per online agent at a time.
- The desktop user retains the ability to answer the same question locally in the terminal at any
  time; local and Teams answer paths are mutually exclusive per question.
- Concurrent online bindings for the same agent across multiple offices remain out of scope (matching
  spec 011's v1 constraint).

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: No in-canvas rendering changes; this is a main-process Teams service plus
  session-answer concern. Phaser remains the sole renderer and is unaffected.
- **Event & Input Boundary**: Question/answer flow rides existing documented events and IPC between
  the terminal server, main process, and the Teams service; no new hidden cross-layer coupling and no
  direct keyboard manipulation. Any status signaling reuses the established agent-status presentation.
- **Session Integrity Impact**: Answers MUST be delivered through the existing session/submit path so
  a Teams resolution is identical to a local answer, preserving session continuity; the flow must not
  detach, duplicate, or fork the agent's session, and must respect the `ask_user` waiting-state
  race-guard already in place.
- **Configuration Impact**: Behavior is gated by the existing Teams feature flag and channel
  configuration; any new tunables (e.g., forwarding scope) are added as typed configuration rather
  than hardcoded scene/service logic.
- **Regression Plan**: Cover question-posting, selector/text/freeform matching, no-match nudges,
  single-resolution (Teams-vs-local race), offline/session-end abandonment, self-loop exclusion, and
  dispatch-queue ordering with targeted tests; verify no regression to ordinary Teams prompt routing
  and to the local `ask_user` waiting-state handling.
