# Contract: Orchestrator Transcript Store

New module `electron/orchestrator/orchestratorTranscriptStore.ts`. Owns the persisted
orchestrator transcript. Mirrors the established persistence-port pattern
(`electron/teams/onlineAgentsStore.ts` `FileTeamsOnlineStore` /
`src/office/officePersistence.ts` `OfficePersistencePort`): pure serialize/deserialize +
a file-backed prod impl + an in-memory test impl. Node-only (no Electron/DOM imports beyond
`fs`/`path`) so it is unit-testable in isolation.

## On-disk location & format

- **Path**: `.data/orchestrator-transcript.json` (under the app's existing `.data/`
  convention; captured by the `.data` backup snapshotter, `electron/dataBackup.ts`).
- **Format**: pretty JSON of a single `OrchestratorTranscript` record (see
  [data-model.md](../data-model.md) §1).
- **Secrets**: none. The store MUST NOT persist tokens or any secret (consistent with
  `FileTeamsOnlineStore`).

## Port interface

```ts
export interface OrchestratorTranscriptStore {
  /** Load the persisted transcript, or null if none / unreadable. */
  load(): OrchestratorTranscript | null;
  /** Persist the given transcript record (full-record write). */
  save(transcript: OrchestratorTranscript): void;
  /** Clear the active record (used on user-close so the next open starts clean). */
  clearActive(): void;
}
```

- `FileOrchestratorTranscriptStore implements OrchestratorTranscriptStore` — prod, file-backed.
- `InMemoryOrchestratorTranscriptStore implements OrchestratorTranscriptStore` — tests.

## Pure functions (side-effect free, unit-tested)

```ts
export function serializeTranscript(t: OrchestratorTranscript): string;
export function deserializeTranscript(json: string | null): OrchestratorTranscript | null;
/** Append a turn and trim oldest-first to the bounded window. */
export function appendTurn(
  t: OrchestratorTranscript,
  turn: Omit<TranscriptTurn, 'seq'>,
  bound: number,           // = xterm scrollback window (≈5000)
): OrchestratorTranscript;
```

## Behavior contract

1. **Bounded window (FR-006)**: `appendTurn` trims oldest turns first once `turns.length`
   would exceed `bound`; the store never grows unbounded. `bound` equals the panel's xterm
   scrollback cap (currently 5000) so persistence mirrors the agent-TUI model.
2. **Origin fidelity (FR-002)**: the caller (session manager) sets `origin` (`desktop` vs.
   `teams`) at capture time; the store preserves it verbatim.
3. **Ordering (FR-001)**: `seq` is monotonic and assigned on append; deserialize preserves
   order.
4. **Restart restore (FR-004)**: `load()` returns the last-saved `active` record so the
   panel can replay it; a `closed` record returns as-is but the session manager treats a
   `closed` record as "no active conversation" and starts fresh on the next open (FR-005).
5. **User-close (FR-005)**: `endSession()` marks the record `closed` (or calls
   `clearActive()`); the next `open()` MUST NOT resurrect it as the active conversation.
6. **Malformed input tolerance**: `deserializeTranscript(null | garbage)` returns `null`
   (never throws), matching `deserializeOffices`; a corrupt file starts a fresh transcript.
7. **Failure surfacing (FR-025)**: IO errors are logged through the established channel and
   never crash the session; a failed save MUST NOT block turn processing.

## Wiring (session manager)

`OrchestratorSessionManager` holds an `OrchestratorTranscriptStore` and appends a turn on:
- user input (`submitInput`) → `role:'user'`, origin from caller (desktop/teams);
- mapped assistant/tool/turn events from the session tap → `role:'orchestrator'|'tool'`;
- permission approve/deny + act-on tool outcome → `role:'tool'` with `{ name, outcome, target }`;
- session start assigns/loads the bound `sessionId`; `endSession()` marks `closed`.

The panel restores via `orchestrator:transcript:get` (see
[orchestrator-ipc-v2.md](./orchestrator-ipc-v2.md)) and replays before the "ready" line.
