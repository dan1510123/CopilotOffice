# Feature Specification: Restore a Previous Session from History

**Feature Branch**: `020-session-history-restore`  
**Created**: 2026-07-29  
**Status**: Draft  
**Input**: User description: "I want to be able to select a previous session from the session history, get a confirmation pop-up, and on confirm switch to that session — restoring it as the current session."

## Context

Feature 019 made session-history entries human-readable (each row shows `#N` +
title + copyable session ID). Today that list is **display-only** — the operator
can read and copy an ID but cannot act on it. This feature makes a history entry
**actionable**: selecting one, confirming, and switching the agent's active
session to that previously archived session. It builds directly on the shared
history renderer and the existing session-lifecycle plumbing (archive / current
map / per-agent history).

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Switch back to a previous session (Priority: P1)

An operator opens an agent's session history, recognizes a past session by its
title, clicks it, and is shown a confirmation prompt describing what will happen.
On confirming, the agent's active session switches to the selected past session,
and the operator is returned to the terminal now working in that session's
context.

**Why this priority**: This is the entire point of the feature — turning the
read-only history list into a navigational tool that lets an operator resume
earlier work. Without it, history is a museum exhibit; with it, history becomes a
"jump back" control.

**Independent Test**: Start an agent session (session A), start a new session
(session B) so A is archived into history, open the history list, click A's
entry, confirm the dialog, and verify the agent's current session becomes A.

**Acceptance Scenarios**:

1. **Given** an agent has at least one archived session in history, **When** the
   operator clicks that history entry, **Then** a confirmation dialog appears
   describing the switch and the terminal session is NOT changed yet.
2. **Given** the confirmation dialog is shown, **When** the operator confirms,
   **Then** the agent's current/active session becomes the selected past session
   and the terminal reflects that session.
3. **Given** the confirmation dialog is shown, **When** the operator cancels or
   dismisses it, **Then** nothing changes — the current session, the history
   list, and the terminal are exactly as before (a true no-op).
4. **Given** an operator wants to copy an ID rather than switch, **When** they
   select/drag the copyable session ID text inside an entry, **Then** the ID is
   selectable as an exact value and the click does NOT trigger the confirmation
   dialog or a switch.

---

### User Story 2 - Neither session is lost when switching (Priority: P1)

When the operator switches to a past session, the session that was current at the
moment of the switch is preserved in history rather than discarded, so the
operator can always switch back again. The history list stays coherent — the
now-current session is no longer listed as "past," and the previously-current
session appears as a "past" entry.

**Why this priority**: A switch that silently destroys the session the operator
was just in is a one-way door and a data-loss trap. Co-critical with Story 1:
shipping the switch without safe swapping would make the feature dangerous.

**Independent Test**: With current session B and archived session A, restore A,
then open history and confirm B now appears in history and A no longer does; then
restore B again and confirm the round-trip works.

**Acceptance Scenarios**:

1. **Given** current session B and a selected past session A, **When** the switch
   is confirmed, **Then** B is archived into history (carrying its title snapshot
   as in feature 019) and A becomes current.
2. **Given** A has become current after a switch, **When** the operator reopens
   history, **Then** A is no longer shown as a past entry and B is now shown as a
   past entry.
3. **Given** an agent whose current session and target session have titles,
   **When** a switch occurs, **Then** every stored title/ID pairing remains
   correct and no entry is duplicated or orphaned.

---

### User Story 3 - Consistent behavior across all history surfaces (Priority: P2)

The clickable "restore" behavior and its confirmation prompt behave identically
wherever session history is shown, so an operator gets the same experience
whether they open history from one terminal surface or another.

**Why this priority**: The two terminal surfaces have repeatedly diverged in this
codebase; a switch that works in one place but silently does nothing (or behaves
differently) in the other is a recurring class of regression. Important, but the
core value is already delivered by Story 1 on the primary surface.

**Independent Test**: Trigger a restore from each history surface that exposes the
list and confirm the same confirmation prompt appears and the same switch/swap
outcome results.

**Acceptance Scenarios**:

1. **Given** a history list rendered on any supported surface, **When** the
   operator clicks an entry, **Then** the same confirmation prompt and switch
   behavior occur.
2. **Given** a read-only history view (if such a view is presented), **When** the
   operator clicks an entry, **Then** the surface behaves according to the
   read-only policy defined in the requirements (no destructive switch).

---

### Edge Cases

- **Cancel is truly inert**: Dismissing the confirmation must leave current
  session, history, terminal contents, and scroll position untouched.
- **ID selection vs. switch**: Selecting/copying the session ID text must not be
  interpreted as a request to switch (the copyable ID region must not act as the
  switch trigger).
- **Target session cannot be resumed**: The switch attempts resume on a
  best-effort basis. If the underlying Copilot CLI cannot rehydrate the selected
  past session's prior context, the switch MUST NOT silently present a blank
  session as if it succeeded — it MUST surface an explicit "context may not be
  restored" warning/state to the operator while still completing the swap.
- **Target equals current**: If a history entry somehow references the session
  that is already current, restoring it is a no-op that must not corrupt history
  or duplicate entries.
- **Target already in use by another agent**: The existing lifecycle rejects a
  session ID already active for a different agent in the same office; a restore
  that would collide must fail gracefully with a visible message rather than
  overwrite or duplicate.
- **In-progress current session**: If the current session is mid-turn / actively
  running when the operator opens the confirmation, the dialog MUST explicitly
  note the current session is mid-turn (a stronger warning), but the switch is NOT
  blocked — confirming proceeds with the swap.
- **Empty history**: With no archived sessions, no entries are clickable and the
  existing "No previous sessions" state is unchanged.
- **Rapid double-confirm**: Confirming twice quickly (or clicking multiple
  entries) must not perform multiple overlapping switches or race the archive
  path; only one switch resolves.
- **Restart durability**: After a switch, the new current/history mapping must
  survive an application restart (it is persisted like any other session state).

## Clarifications

### Session 2026-07-29

- Q: How should restore handle the risk that a stale Copilot CLI session may not rehydrate its prior context? → A: Attempt resume (best-effort); if prior context cannot be confirmed as restored, proceed but show an explicit "context may not be restored" warning/state. Never present a silent blank session.
- Q: What should restore do to the history list? → A: Reversible SWAP — archive the current session into history, promote the selected entry to current, and remove ONLY the promoted entry from history. Both sessions stay discoverable.
- Q: When the current session is mid-turn/running, how should restore behave? → A: Warn harder — the confirmation dialog explicitly notes the current session is mid-turn, but allow the switch on confirm. Do not block.
- Q: Which surfaces get clickable restore, and what is the read-only policy? → A: Both surfaces (TerminalOverlay popover AND SeriousTerminalController) are clickable/actionable; restore is DISABLED in read-only views.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each session-history entry MUST be selectable/actionable so the
  operator can request switching the agent's active session to that archived
  session.
- **FR-002**: Requesting a switch MUST first present a confirmation prompt that
  clearly describes the consequence of switching before any change is made.
- **FR-003**: Confirming the prompt MUST set the agent's current/active session to
  the selected past session and surface that session in the terminal.
- **FR-004**: Cancelling or dismissing the prompt MUST be a complete no-op — the
  current session, the history list, and the terminal state MUST be unchanged.
- **FR-005**: The switch MUST preserve the session that was current at the moment
  of confirmation by archiving it into history (reusing the existing archive path,
  including the feature-019 title snapshot), so the operator can switch back.
- **FR-006**: After a successful switch, the newly-current session MUST NOT remain
  listed as a "past" history entry (only the promoted entry is removed from the
  list), and the previously-current session MUST appear as a "past" entry — a
  reversible swap.
- **FR-007**: The exact, unmodified session ID MUST remain independently
  selectable/copyable within each entry, and interacting with the ID text MUST NOT
  trigger a switch (the copyable ID must not double as the switch control).
- **FR-008**: The resulting current/history mapping after a switch MUST persist so
  that it survives an application restart, using the same persistence guarantees
  as existing session state.
- **FR-009**: The switch operation MUST reuse the existing session-lifecycle
  guards — specifically it MUST fail gracefully (with a visible message and no
  state change) if the target session ID would collide with another agent's active
  session in the same office.
- **FR-010**: The system MUST prevent overlapping/duplicate switches from a rapid
  double-confirm or multiple selections; at most one switch resolves per
  confirmation.
- **FR-011**: Both history surfaces — the terminal-overlay popover and the
  serious/fleet terminal controller — MUST expose the clickable restore affordance,
  present the same confirmation prompt, and produce the same switch/swap outcome
  (dual-surface parity).
- **FR-012**: The confirmation prompt and switch flow MUST NOT alter the exact
  displayed/copyable value of any session ID.
- **FR-013**: The switch MUST attempt to resume the selected session with its
  prior context on a best-effort basis. If that prior context cannot be confirmed
  as restored, the system MUST NOT silently present an empty session as if the
  restore succeeded; it MUST surface an explicit, operator-visible "context may not
  be restored" warning/state while still completing the swap.
- **FR-016**: If the current session is mid-turn / actively running when the
  operator opens the confirmation prompt, the prompt MUST explicitly warn that the
  current session is mid-turn; confirming still proceeds (the switch is NOT blocked
  on account of an in-progress turn).
- **FR-017**: The clickable restore affordance MUST be disabled in read-only
  history views — a read-only surface MUST NOT initiate a switch/swap.
- **FR-014**: A switch MUST NOT lose or corrupt any existing history entry; no
  entry may be duplicated, and the number/title/ID pairing of untouched entries
  MUST remain intact.
- **FR-015**: The new "switch/restore session" operation MUST be represented as a
  single coherent request that is wired consistently across every layer it crosses
  (backend session store, the preload bridge, the IPC relay, the renderer surfaces,
  and the shared test bridge mock) in one change, so no layer silently no-ops — a
  documented recurring pitfall in this codebase.

### Key Entities

- **Session History Entry**: One archived session for an agent within an office —
  an opaque copyable session ID plus an optional title snapshot (feature 019). This
  feature adds an *action* ("switch to this session") to the entry without changing
  its stored shape.
- **Current Session Pointer**: The single active session ID for an agent in an
  office. A switch moves this pointer to a previously-archived ID and archives the
  formerly-current ID.
- **Restore/Switch Request**: The new operation that atomically (a) archives the
  current session, (b) promotes the selected past session to current, and (c)
  removes the promoted entry from the "past" list — carried end-to-end across all
  session layers.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: From an agent's history list, an operator can switch the active
  session to a chosen past session in at most two deliberate interactions (select
  the entry, confirm) with no ID copying or manual entry.
- **SC-002**: In 100% of cancelled confirmations, no observable state changes —
  current session, history list contents/order, and terminal contents are
  identical before and after.
- **SC-003**: After a confirmed switch, 100% of the time the previously-current
  session is present in history and the restored session is current (a verifiable
  round-trip: switching back returns to the original session).
- **SC-004**: Zero history entries are lost, duplicated, or have corrupted
  title/ID pairings as a result of any switch, across repeated switches.
- **SC-005**: The current/history mapping after a switch is identical before and
  after an application restart for 100% of switches.
- **SC-006**: When the underlying runtime cannot restore a session's prior
  context, 100% of such attempts produce an explicit, operator-visible outcome
  (never a silent blank session presented as success).
- **SC-007**: The restore affordance behaves identically on every surface that
  exposes it — zero cases where a click switches on one surface but no-ops on
  another.

## Assumptions

- The existing per-office, per-agent session model is unchanged: there is one
  current session ID per agent and an ordered list of archived sessions; a switch
  only rearranges which ID is current versus archived.
- The existing archive path (which snapshots the current title at archive time,
  dedupes by ID, and persists) is the mechanism reused to preserve the
  previously-current session during a switch.
- Restoring is treated as a **reversible swap**: the current session is archived
  into history and the selected entry becomes current, with only the promoted entry
  removed from the list (not a destructive delete).
- Session titles are display metadata only; the session ID remains the sole
  identifier used for switching, matching, and resuming.
- **DEPENDENCY / BEST-EFFORT**: The Copilot CLI is expected to resume a
  previously-archived session ID *with its prior context*. The application already
  launches sessions by ID (`copilot --session-id=<id>` on the direct backend,
  `resumeSession(id)` on the SDK backend), which is suggestive but does not prove
  that a *stale, archived* session rehydrates its earlier conversation. Resume is
  therefore treated as best-effort: when prior context cannot be confirmed
  restored, the feature surfaces an explicit "context may not be restored" state
  (FR-013) rather than silently presenting a blank session.
- The confirmation prompt lives in the existing history/overlay surfaces; no new
  full-screen view is introduced.
- History retention limits, clear-history behavior, and cross-office transfer
  behavior are otherwise unchanged apart from the swap movement of one entry.

## Risks

- **Blank-session risk (highest)**: If CLI resume-with-context is unsupported, a
  "successful" switch could drop the operator into an empty session, which feels
  like data loss. Mitigated only by resolving the CLI-resume clarification and
  implementing FR-013.
- **Layer-skew risk**: Adding a new cross-layer operation (store → preload → IPC
  relay → renderer → test mock) has historically caused silent no-ops when one
  layer is missed; FR-015 makes end-to-end wiring a hard requirement.
- **Dual-surface divergence**: The two terminal surfaces have repeatedly diverged;
  restore must be mirrored or explicitly scoped (surface-scope clarification).
- **Accidental switch**: Making rows clickable near a copyable ID risks
  accidental switches; the confirmation gate (FR-002) and ID-isolation (FR-007)
  are the primary mitigations.

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: The clickable affordance and confirmation prompt live
  entirely within the existing DOM-based terminal/history overlay surfaces. No
  Phaser scene, sprite, or in-canvas rendering path is added or altered, preserving
  Phaser-first rendering.
- **Event & Input Boundary**: The restore/switch request MUST flow over an explicit
  request/response channel end-to-end (renderer → preload bridge → main → terminal
  server session store), mirroring the existing session-history/session-id
  messages; no hidden renderer↔backend coupling and no ad hoc global key handling
  is introduced. The confirmation prompt is a scoped UI interaction, not a new
  global input path.
- **Session Integrity Impact**: This directly touches session lifecycle. It MUST
  reuse the existing archive-then-set-current semantics (preserving the
  title-before-clear ordering fixed in feature 019), preserve the collision guard
  that rejects an ID already in use by another agent, and keep the session ID as
  the sole authoritative identifier. The switch MUST maintain session continuity
  guarantees across office switches and restarts. The CLI-resume dependency is
  called out explicitly because authentic session rehydration is the core promise
  at stake.
- **Configuration Impact**: No new hardcoded per-agent or per-office special cases.
  The persisted session record shape is unchanged (current pointer + archived
  list); only which ID occupies which slot changes. Any new operation is added to
  the typed message protocol rather than as a side channel.
- **Regression Plan**: Cover (a) confirm-switch swaps current↔archived correctly;
  (b) cancel is a verified no-op; (c) round-trip switch-back returns to the
  original session; (d) no entry lost/duplicated across repeated switches; (e)
  collision with another agent's active ID fails gracefully; (f) ID text remains
  copyable and does not trigger a switch; (g) mapping persists across restart; (h)
  graceful behavior when resume-with-context is unavailable; (i) parity across
  every history surface exercised against the shared test bridge mock; and (j) the
  new operation is present and consistent in the backend, preload, IPC relay,
  renderer, and test mock (FR-015).
