# Contract: Teams Question / Answer Flow (internal TeamsService)

**Feature**: `015-teams-ask-user-resolution` | **Date**: 2026-07-11

Defines the internal behavior contract added to `electron/teams/teamsService.ts`: how a
pending `ask_user` question is posted, how a thread reply resolves it, and how nudges /
notices / abandonment behave. No new external (Graph/Trouter) contracts — all posts use
the existing `safeReply` → `graphClient.replyToThread` (marker + chunking) and all
inbound goes through the existing `messageFilter`.

---

## A. Posting a pending question (FR-001/002/010/013)

**Trigger**: `onAgentEvent(e)` receives `e.kind === 'ask-user'` for an online agent
(routes to a new `onAskUserEvent(e)` from **both** the dispatch and ambient branches —
FR-013: forward regardless of Teams- vs locally-initiated turn).

**Behavior**:
1. Resolve the online `binding` for `e.agentId`; if none, ignore.
2. Assign selector labels to `e.askUser.options` in order (`A, B, C, …`), build
   `PendingQuestion` (see data-model), supersede any existing record for the agent.
3. Compose one HTML message:
   - A "needs your answer" framing distinct from ordinary replies (FR-002).
   - The question text (escaped).
   - Each option as `<b>Label</b> — text` (escaped).
   - A freeform hint line **iff** `freeform === true` (FR-002/006).
4. Post via `safeReply(binding, html)` (embeds marker, records posted id — FR-010).
   Store `postedMessageId` on the record. Chunk with `chunkReply(…, 3500)` if long
   (FR-010, Edge "very long option list").

**Guarantee (SC-001)**: every in-scope `ask_user` yields a thread message showing the
question and **all** options.

---

## B. Resolving a reply (FR-003/004/005/006/007/012/014)

**Trigger**: `handleInbound(msg)` for a message classified `dispatch` on a bound
thread, **while `pending.has(binding.agentId)` and `!record.resolved`**. This branch is
checked **before** `queue.enqueue(...)`, so a reply during a pending question is treated
as an answer, never dispatched as a new prompt (FR-012).

**Matching (selector-label ONLY — FR-014)**:
- Normalize the reply: trim; take the first token; strip a single trailing `)`/`.`/`:`
  (so `B`, `b`, `B)`, `2.` match). **No** option-text or fuzzy/substring matching.
- If the normalized token equals an `option.label` (case-insensitive) → **label match**.

**Actions**:
| Condition | Action |
|---|---|
| Label match | `resolved = true`; `submitPrompt(officeId, agentId, matchedOption.text, 'Teams · <sender>')`; clear record. (FR-003/004) |
| No label match **and** `freeform === true` | `resolved = true`; `submitPrompt(officeId, agentId, rawReplyText, 'Teams · <sender>')`; clear record. (FR-006) |
| No label match **and** `freeform === false` | Post nudge re-listing options + labels via `safeReply`; **leave record PENDING** (`resolved` stays false). (FR-005, SC-005) |

**Single-resolution (FR-007, SC-004)**: the `resolved` check-and-set is synchronous in
the main process (single-threaded) — the first resolver flips `resolved` and clears the
record before `await`ing `submitPrompt`, so a near-simultaneous second reply finds
`resolved === true` (or no record) and is a **no-op**.

**Submitted value**: the matched `option.text` (never the label) or the raw freeform
text — identical to what a local answer for that choice produces (research Decision 1).

---

## C. Local resolution (FR-008)

**Trigger**: the agent leaves the ask_user wait **without** a Teams answer — observed as
the next `turn-start` / `message` / `user-message` / `tool-complete` that clears the
ask_user waiting state, while a `PendingQuestion` exists with `resolved === false`.

**Behavior**: set `resolved = true`, clear the record, and `safeReply` a short
"✅ Answered in the app." notice (marker + recorded). A subsequent Teams reply for that
(now-cleared) question is a no-op (FR-007). Only fire the notice once per record.

> Implementation note: the simplest robust signal is "a non-`ask-user` agent event
> arrived for this agent while a pending record exists" — because a Teams resolution
> clears the record *before* the resulting turn streams, any later event that finds a
> still-pending record implies a local answer (or supersession, handled separately by
> `toolId`).

---

## D. Abandonment (FR-009)

**Triggers & behavior**:
- `goOffline(officeId, agentId, …)`: if a `PendingQuestion` exists, `safeReply` a
  "⚠️ This question is no longer answerable (agent offline)." notice, then delete the
  record. (Reuses the existing offline path which already posts an offline notice and
  `queue.clear`.)
- `onSessionExit(agentId)`: same — post "no longer answerable" if outstanding, delete.
- After abandonment, `messageFilter` already drops replies to the unbound/offline
  thread, so no answer path can fire.

---

## E. Invariants (map to FRs / SCs)

- **One pending per agent** (`Map<agentId, PendingQuestion>`); a new `ask-user`
  supersedes (matched/cleared by `toolId`). (Edge: superseded)
- **Answers bypass the dispatch queue**; genuine follow-up prompts (arriving after the
  record clears) use the existing FIFO `DispatchQueue`. (FR-012)
- **Every posted message carries the self-marker** and is recorded in
  `postedMessageIds`; none re-enters processing. (FR-010, Edge: self posts)
- **All inbound remains filtered** by `messageFilter`; no @mention required; any channel
  member may answer. (FR-011)
- **At-most-once resolution** across Teams/local. (FR-007, SC-004)
- **Unmatched choices-only reply never advances the agent.** (FR-005, SC-005)

---

## Test expectations (integration, `tests/…/teams/`)

1. `ask-user` event → one marked, framed thread post listing all labeled options
   (+ freeform hint iff freeform). (SC-001)
2. Reply `B` → `submitPrompt` called once with option B's **text**; record cleared.
   (SC-003)
3. Choices-only, reply `xyz` → nudge posted, record still pending, `submitPrompt` **not**
   called. (SC-005)
4. Freeform, reply `xyz` → `submitPrompt` called once with `xyz`.
5. Teams reply then near-simultaneous second reply → exactly one `submitPrompt`. (SC-004)
6. Local answer (non-ask event while pending) → "answered in app" notice; later Teams
   reply is a no-op. (FR-007/008)
7. `goOffline` / `onSessionExit` while pending → "no longer answerable" notice; later
   reply dropped. (FR-009)
8. Non-`ask_user` tool events and ordinary Teams prompt routing are unchanged. (FR-016)
