# Phase 0 Research: Restore a Previous Session from History

All spec clarifications were resolved in `spec.md` (`## Clarifications / Session
2026-07-29`); there are **no open `NEEDS CLARIFICATION` markers**. This document
records the technical decisions that ground the plan in the actual codebase.

---

## R-001 — Resume mechanism: how does a session actually get "restored"?

**Decision**: Restore = archive current id → set the target id as current →
remove the target from history → **kill the PTY and restart it** so the new PTY
relaunches `copilot --session-id=<target>`.

**Rationale**: The app already launches archived sessions by id. On the direct
node-pty backend, `server.ts` (~line 968–969) types
`copilot --session-id=${sessionId}\r` into a fresh PTY. That single line **is**
the resume mechanism — it is how sessions are relaunched by id on app restart.
Therefore restoring a past session requires no new spawning primitive: reuse the
existing kill path (`killPtyProcess` + `ptyProcesses.delete` + viewer/watcher
cleanup) and let the normal `start` path relaunch with the promoted id.

**Alternatives considered**:
- *Mutate `proc.sessionId` in place (as `set-session-id` does at ~line 1244)
  without restarting* — rejected: `set-session-id` updates the stored id but does
  NOT relaunch the CLI, so the live PTY keeps running the OLD session. Restore must
  actually switch the running conversation, which requires a PTY restart.
- *SDK `resumeSession(id)` path* — the SDK/ui-server backend has its own resume;
  the handler stays backend-agnostic by going through the existing kill+start
  lifecycle rather than calling a backend-specific primitive directly.

---

## R-002 — Best-effort resume & the "context may not be restored" advisory (FR-013)

**Decision**: The server always completes the swap and returns `success: true`
plus a **resume advisory flag** (e.g. `resumeContextUncertain: boolean`). The
renderer surfaces an explicit operator-visible "context may not be restored"
state whenever the flag is set (or whenever it cannot positively confirm
rehydration). Never present a silent blank session as success.

**Rationale**: FR-013 / SC-006 require that a failure to rehydrate prior context
is never silently hidden. The CLI relaunch-by-id is *suggestive* of rehydration
but not *proof* for a stale archived id. Modeling the uncertainty as an explicit
advisory flag (rather than a hard failure) satisfies "complete the swap but warn"
without blocking the operator.

**Alternatives considered**:
- *Block the swap when rehydration can't be proven* — rejected: contradicts the
  clarification ("proceed but surface an explicit warning").
- *Silently assume success* — rejected: violates FR-013 / SC-006.

---

## R-003 — Reversible SWAP vs. destructive move (FR-005 / FR-006 / FR-014)

**Decision**: Archive the current id via the existing `archiveSessionId()`
(snapshots the title BEFORE any meta clear, dedupes by id — the 019 fix), then
promote the selected entry: set it as current, remove ONLY that entry from
history, and restore its title into `sessionMeta` so it displays as current.

**Rationale**: `archiveSessionId()` already implements exactly the "snapshot
title, dedupe by id" contract needed to preserve the outgoing session (FR-005).
Removing only the promoted entry (not clearing history) keeps every untouched
entry intact (FR-014) and makes the swap reversible (round-trip, SC-003).

**Alternatives considered**:
- *Delete the target from history without archiving current* — rejected: loses
  the outgoing session (one-way door, the explicit data-loss trap in Story 2).

---

## R-004 — Pure helper extraction: `promoteHistoryEntry()` (testability)

**Decision**: Add a pure function to `electron/terminal/session-history.ts`:

```ts
export function promoteHistoryEntry(
  history: SessionHistoryEntry[],
  sessionId: string
): SessionHistoryEntry | undefined
```

It finds the entry whose `id === sessionId`, removes it from `history` (mutating,
returning `history` implicitly via reference like `pushArchivedEntry`), and
returns the removed entry (or `undefined` if not present). The returned entry's
`title` drives the restored `sessionMeta.title`.

**Rationale**: `server.ts` calls `main()` at import time and owns PTY state, so it
cannot be imported in a unit test. Extracting the swap/promote core mirrors the
existing `pushArchivedEntry` / `coerceHistory` / `session-repair` pattern and
makes the no-loss/no-dup/round-trip invariants (SC-004) unit-testable in isolation.

**Alternatives considered**:
- *Inline array manipulation in the handler* — rejected: not unit-testable without
  booting the server; repeats a pattern the repo already refactored away from.

---

## R-005 — New protocol message vs. reusing `set-session-id` (FR-015)

**Decision**: Introduce a **new** `restore-session` message
(`MsgRestoreSession`) wired across every layer in one change, rather than
overloading the existing `set-session-id`.

**Rationale**: `set-session-id` archives + sets a NEW id but does NOT (a) require
the target to already exist in history, (b) promote/remove a history entry, (c)
restore the entry's title into meta, or (d) restart the PTY. Restore's semantics
are distinct enough that overloading would make the handler branchy and
error-prone. A dedicated message keeps intent explicit and mirrors the existing
one-message-per-operation convention. **FR-015 is a documented recurring pitfall:**
a cross-layer op that misses a layer silently no-ops. The message MUST be added to
`protocol.ts`, `server.ts`, `ipc-relay.ts`, `preload.ts` (+ its `Window` type),
both renderer surfaces, AND `tests/setup/copilot-bridge-mock.ts` in the SAME change.

**Alternatives considered**:
- *Reuse `set-session-id`* — rejected: wrong semantics (no history-existence
  guard, no promote, no title restore, no forced restart).

---

## R-006 — Collision guard reuse (FR-009)

**Decision**: Reuse the exact guard from `set-session-id` (~line 1225–1234): if
the target id equals another agent's current id in the same office, reject with
`{ success: false, error: '…already in use by another agent…' }` and make NO state
change. The renderer surfaces the error message.

**Rationale**: FR-009 requires graceful failure on collision with no state change;
the guard already exists and is battle-tested (spec 007 defense-in-depth). Restore
must run the guard BEFORE archiving/mutating so a rejected restore is a true no-op.

---

## R-007 — Renderer confirmation dialog & mid-turn warning (FR-002 / FR-016)

**Decision**: On `onSelect(entry)`, show a confirmation before any IPC. The repo
already uses the native `confirm(...)` for destructive actions (office delete,
`src/main.ts:1236,1311`), so reuse a `confirm(...)`-style gate with a message that
describes the swap. **Mid-turn detection**: `TerminalOverlay` already imports
`officeManager`; query `officeManager.getAgentStatus(officeId, agentId)?.subState
=== 'thinking'`. When mid-turn, the confirmation copy warns harder ("This agent is
mid-turn; switching now may interrupt in-progress work") but STILL allows confirm
(FR-016 — do not block).

**Rationale**: Reusing the existing confirm affordance keeps blast radius minimal
and avoids a new modal overlay (spec assumption: "no new full-screen view"). The
`officeManager` status map is the established source of truth for agent activity.

**Alternatives considered**:
- *Build a bespoke modal* — rejected as unnecessary scope; spec says the prompt
  lives in the existing surfaces.

---

## R-008 — ID-copy isolation (FR-007 / FR-012)

**Decision**: In `sessionHistoryRender.ts`, attach the `onSelect` click handler to
the ROW (or a dedicated clickable area), and add `stopPropagation()` on the
`user-select: all` id span's `mousedown`/`click` so selecting/copying the id never
triggers the swap. The id remains rendered verbatim via `textContent` and the
title stays `textContent` (XSS-safe, never `innerHTML`).

**Rationale**: FR-007/FR-012 require the copyable id to not double as the switch
control and the exact id value to be preserved. The existing renderer already
isolates the id in its own `user-select: all` span — adding propagation-stopping
on that span is the minimal correct fix.

---

## R-009 — Read-only gating (FR-017) & dual-surface parity (FR-011)

**Decision**: The row builder accepts a `readOnly` flag; when true it renders NO
clickable affordance / passes no `onSelect`. `TerminalOverlay` already exposes
`isReadOnly` (meeting/read-only views) and `SeriousTerminalController` has an
open-option/read-only state — both pass their read-only flag into the shared
builder. Both surfaces call the same `renderSessionHistoryList(entries, {
onSelect, readOnly })` so behavior is identical (FR-011).

**Rationale**: Centralizing the affordance in the shared pure builder is the only
way to guarantee parity; divergence between the two surfaces is a documented
recurring regression class in this repo (Principle VI note; specs 002/004/005/006/008).

---

## R-010 — Rapid double-confirm / overlap guard (FR-010)

**Decision**: Guard with a renderer-side in-flight boolean (e.g.
`restoreInFlight`) set before the IPC call and cleared in `finally`; ignore
further selects/confirms while set. The server is also idempotent-safe: a
target-equals-current or already-promoted id resolves to a no-op (see data-model
edge cases) so a race cannot duplicate or orphan entries.

**Rationale**: FR-010 requires at most one switch per confirmation. A simple
in-flight latch plus server idempotency covers both the double-click and
double-confirm races without locks.

---

## R-011 — Backward compatibility & persistence (FR-008 / SC-005)

**Decision**: No change to the persisted file shape (`{ current, history,
metadata }`). After the swap, `saveOfficeSessionFile(officeId)` persists the new
mapping exactly as other lifecycle ops do, so it survives restart. A promoted
**legacy** entry (no `title`) clears the current title (sets `sessionMeta` title
to empty / deletes it) so the UI shows the neutral fallback rather than a stale
title.

**Rationale**: FR-008/SC-005 require restart durability with existing persistence
guarantees; reusing `saveOfficeSessionFile` is sufficient. Legacy entries are
already coerced by `coerceHistory` at load, so promoting one is well-defined.
