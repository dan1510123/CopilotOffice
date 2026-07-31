# Feature Specification: Titled Session History Entries

**Feature Branch**: `019-session-history-titles`  
**Created**: 2026-07-27  
**Status**: Draft  
**Input**: User description: "I want the session history to state the title next to the ID, meaning you should store title with session id when recording history."

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Recognize a past session at a glance (Priority: P1)

An operator opens an agent's session history list and sees, for every archived
session, the human-readable session title displayed next to the session ID
instead of a wall of opaque identifiers. They can immediately tell which past
session was "fix the terminal copy bug" versus "draft the demo fleet plan"
without copying IDs anywhere or guessing from position in the list.

**Why this priority**: This is the entire point of the feature. Without titles in
the list, the history view provides essentially no navigational value — the IDs
are meaningless strings. Delivering only this story already makes history usable.

**Independent Test**: Start an agent session, send a message that produces a
session title, start a new session for the same agent (archiving the previous
one), then open the session history list and confirm the archived entry shows
the title alongside its ID.

**Acceptance Scenarios**:

1. **Given** an agent has one archived session that had a title when it was
   archived, **When** the operator opens the session history list, **Then** the
   entry shows both the stored title and the session ID.
2. **Given** an agent has several archived sessions with different titles,
   **When** the operator opens the session history list, **Then** each entry
   shows its own title paired with its own ID, in the existing most-recent-first
   order.
3. **Given** an operator is viewing the session history list, **When** they
   select/copy a session ID from an entry, **Then** the ID remains copyable as
   an exact, unmodified value (the title must not corrupt the copied ID).

---

### User Story 2 - History remains usable for untitled and legacy sessions (Priority: P1)

An operator opens session history for an agent that has entries recorded before
this feature existed, or entries for sessions that ended before any title was
established. Those entries still render cleanly with a clear neutral fallback
rather than a blank space, "undefined", or a broken row.

**Why this priority**: Every existing user already has untitled history on disk.
Shipping story 1 without this produces visibly broken rows on first launch, so
this is co-critical, not a follow-up.

**Independent Test**: Point the app at existing session history data that has no
stored titles, open the history list, and confirm every legacy entry renders with
its ID plus a neutral fallback label and no error.

**Acceptance Scenarios**:

1. **Given** an archived history entry that has no stored title, **When** the
   operator opens the session history list, **Then** the entry renders the
   session ID with a neutral fallback indicator (e.g. "Untitled session") and no
   empty or error text.
2. **Given** history data recorded before this feature shipped, **When** the app
   loads that data, **Then** the history list loads successfully and no history
   entries are lost or discarded.
3. **Given** a session that is archived while it still has no title, **When** it
   appears in history, **Then** it is treated exactly like a legacy untitled
   entry.

---

### User Story 3 - Titles survive restart and follow the session (Priority: P2)

The title shown next to an archived session ID is the title that session had
when it was archived, and it is still there after the app is closed and
reopened, or after the session is moved between offices.

**Why this priority**: Persistence is what turns the list from a within-run
convenience into durable recall, but story 1 already demonstrates value within a
single run.

**Independent Test**: Archive a titled session, fully restart the application,
reopen the history list, and confirm the same title/ID pairing is present.

**Acceptance Scenarios**:

1. **Given** a titled session was archived, **When** the application is restarted
   and the history list is reopened, **Then** the same title is still shown next
   to that session ID.
2. **Given** a titled session was archived and the agent's *current* session is
   later given a different title, **When** the operator views history, **Then**
   the archived entry still shows the title it had at archive time, not the newer
   current-session title.
3. **Given** an agent's sessions are transferred between offices, **When** the
   operator views history in the destination office, **Then** archived entries
   carry their titles with them.
4. **Given** the operator clears session history for an agent, **When** history
   is cleared, **Then** the stored titles for those archived sessions are removed
   along with the IDs and nothing is orphaned.

---

### Edge Cases

- **Untitled at archive time**: A session archived before any title was
  established shows the neutral fallback (User Story 2).
- **Legacy data shape**: Existing history records that contain only IDs must keep
  working and be upgradable in place without data loss.
- **Very long titles**: Titles can be long enough to overflow the narrow history
  popover. Such titles are truncated with a trailing ellipsis on a single line,
  and the full untruncated title is available on hover as a tooltip. The popover
  never widens, wraps, or scrolls horizontally to accommodate a long title.
- **Duplicate titles**: Two archived sessions may end up with identical titles;
  the ID remains the disambiguator and both entries must still be individually
  identifiable.
- **Empty/whitespace-only title**: Treated as no title (fallback applies).
- **Unusual characters in a title**: Titles derived from free-form user text may
  contain markup-like or control characters; they must be displayed as literal
  text and never alter the layout or be interpreted as markup.
- **Same session archived twice**: A session ID already present in history is not
  duplicated; its stored title should not be silently replaced by an empty one.

## Clarifications

### Session 2026-07-27

- Q: Where should the archived session title come from? → A: Snapshot the existing per-agent session title (auto-derived from the first user message, truncated at 80 characters) at the moment of archiving; no new derivation logic.
- Q: Should users be able to rename archived session history entries? → A: No — archived titles are read-only.
- Q: How should a long title be displayed in the session history list? → A: Truncate with an ellipsis, with the full title available on hover (tooltip).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST record a human-readable title together with the
  session ID at the moment a session is archived into session history.
- **FR-002**: The recorded title MUST be a point-in-time snapshot — the title the
  session held when it was archived — and MUST NOT change afterwards as a result
  of activity in newer sessions.
- **FR-003**: The system MUST persist the title/ID pairing for archived sessions
  so that it survives application restarts.
- **FR-004**: The session history list MUST display the stored title next to the
  session ID for each archived entry.
- **FR-005**: The session history list MUST display a neutral fallback indicator
  in place of the title for entries that have no stored title, including all
  history recorded before this feature existed.
- **FR-006**: The system MUST continue to load and display pre-existing history
  records that contain no title, without losing entries and without requiring the
  user to reset or clear their history.
- **FR-007**: The full, unmodified session ID MUST remain visible and selectable/
  copyable for each history entry, regardless of whether a title is shown.
- **FR-008**: Clearing session history MUST remove stored titles along with the
  archived session IDs, leaving no residual title data.
- **FR-009**: Transferring an agent's sessions between offices MUST carry archived
  session titles along with the archived session IDs.
- **FR-010**: Titles MUST be rendered as literal text, never interpreted as markup
  or executable content.
- **FR-011**: The title recorded for an archived session MUST be a snapshot of the
  existing per-agent session title — the label already auto-derived from the
  session's first user message and truncated at 80 characters — taken at the
  moment of archiving. The system MUST NOT introduce any new title-derivation
  logic (no last-message or agent-generated summary titles).
- **FR-012**: Archived session titles MUST be read-only: the system MUST NOT offer
  any way to rename or edit a title from the session history list, and archived
  titles are immutable once recorded. Manual renaming is out of scope.
- **FR-012a**: The session history list MUST truncate an over-long title with a
  trailing ellipsis and MUST expose the full untruncated title on hover, without
  widening, wrapping, or horizontally scrolling the history popover.
- **FR-013**: The existing session history ordering (most recent first) and the
  existing entry numbering MUST be preserved.
- **FR-014**: All surfaces that show session history MUST show titles
  consistently, so an operator sees the same title/ID pairing regardless of which
  history view they open.

### Key Entities

- **Session History Entry**: One archived session for a given agent within a given
  office. Attributes: the session identifier (opaque, stable, copyable) and the
  human-readable title captured when the session was archived (optional — may be
  absent for legacy or never-titled sessions). Ordered relative to other entries
  for the same agent.
- **Session Title**: Short human-readable label describing what a session was
  about. Currently associated with an agent's *current* session; this feature
  extends it to also be retained per archived session.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: In the session history list, 100% of sessions that had a title when
  archived display that title next to their ID.
- **SC-002**: 100% of history entries without a stored title (including all
  pre-existing history) render with a neutral fallback label and zero blank,
  "undefined", or error rows.
- **SC-003**: An operator can identify which past session they want from a list of
  five archived sessions in under 10 seconds, without copying any session ID or
  opening any other view.
- **SC-004**: Zero history entries are lost or corrupted when history recorded
  before this feature is loaded for the first time after the change.
- **SC-005**: Title/ID pairings shown before an application restart are identical
  to those shown after the restart, for 100% of archived entries.

## Assumptions

- The existing notion of a "session title" (a short human-readable label already
  associated with an agent's active session, auto-derived from the first user
  message and truncated at 80 characters) is the source of the archived title
  (FR-011).
- Session history remains scoped per office and per agent, as today; this feature
  does not change what gets archived or when.
- The session history view remains a compact popover/list; presentation stays in
  the existing surfaces rather than introducing a new screen.
- Titles are display-only metadata: they are never used as identifiers, keys, or
  for matching/resuming a session — the session ID remains the sole identifier.
- No migration or backfill of titles for already-archived sessions is expected;
  legacy entries simply show the fallback.
- Existing history retention limits and clear-history behaviour are unchanged
  apart from also removing titles.

## Constitution Alignment *(mandatory)*

- **Rendering Boundary**: The feature only changes text content within the
  existing DOM-based terminal/session-history overlay surfaces. No Phaser scene,
  sprite, or game-object rendering path is added or altered, so Phaser-first
  rendering is untouched.
- **Event & Input Boundary**: History data continues to reach the renderer through
  the existing request/response bridge for session history; no new direct coupling
  between renderer and backend is introduced and no new global input handling is
  added. The only change is the shape of the data already carried over that
  boundary.
- **Session Integrity Impact**: Session lifecycle, session creation, archiving
  triggers, and resume semantics are unchanged. Titles are additive display
  metadata captured at archive time; the session ID remains the authoritative
  identifier, so real-agent session integrity is preserved. Backward-compatible
  loading of existing session data on disk is a hard requirement (FR-006).
- **Configuration Impact**: Persisted session records gain an optional title field
  per archived entry; the stored format must remain readable when the field is
  absent. No hardcoded per-agent or per-office special cases.
- **Regression Plan**: Cover (a) loading legacy history with no titles, (b)
  archiving a titled session and reading it back, (c) archiving an untitled
  session, (d) clearing history removes titles, (e) transferring sessions between
  offices carries titles, (f) session ID copy/selection still yields the exact ID.
  Renderer-side history views must be exercised against the shared test bridge
  mock so both history surfaces stay in sync (FR-014).
