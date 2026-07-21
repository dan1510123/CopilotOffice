# Phase 0 Research: Orchestrator Improvements

All spec `## Clarifications` were resolved before planning (multi-office scope, view-only
TUI mirroring the agent TUI bound to the orchestrator session id with Page Up/Down,
green "hacker" theme, and the bounded-scrollback retention model). This document records
the technical decisions that resolve the remaining unknowns for grounding US1–US8 in the
existing architecture. No `NEEDS CLARIFICATION` markers remain.

## R1. Transcript capture source & feed

- **Decision**: Capture transcript turns in the **main process** off the existing
  `OrchestratorSessionManager` tap surfaces — `onSessionEvent` (assistant/tool/turn
  events, already mapped via `mapSdkEventToCopilotEvent`), the permission gate
  (`permissionHandler` / `respondToPermission` → approve/deny outcomes), and user input
  submitted via `submitInput`. Teams-driven turns are tagged at the
  `orchestratorSessionGateway` boundary. The manager pushes each turn into the new
  `OrchestratorTranscriptStore`.
- **Rationale**: The manager already emits the same stream to both the renderer IPC
  emitter and the Teams gateway tap, so it is the one place that sees every turn from
  every origin in processing order. This satisfies FR-001/FR-002 (all origins, ordered)
  and FR-023 (record act-on outcomes incl. denials) without a second SDK subscription.
- **Alternatives considered**: (a) Capture in the renderer panel — rejected: the panel is
  torn down while minimized and never sees Teams-only turns. (b) Capture in the Teams
  gateway only — rejected: misses desktop-origin turns.

## R2. Transcript persistence location & schema

- **Decision**: A new file-backed store `.data/orchestrator-transcript.json` behind an
  `OrchestratorTranscriptStore` port, mirroring `FileTeamsOnlineStore`
  (`.data/teams-online-agents.json`) and the `OfficePersistencePort` pattern (pure
  serialize/deserialize + a file-backed prod impl + an in-memory test impl). It stores a
  single active-conversation record: an ordered, **bounded** array of turns (cap mirrors
  the panel's 5000-line xterm scrollback window per session) plus a lifecycle marker.
- **Rationale**: FR-004 (persist across restart), FR-006 (bounded window, reset on new
  session, no unbounded log), and the spec assumption that persistence uses the existing
  `.data/` convention captured by the `.data` backup snapshotter. Reusing the port pattern
  keeps it unit-testable and never persists secrets.
- **Alternatives considered**: localStorage (renderer-only, lost to main-process Teams
  turns); an unbounded append log (violates FR-006 retention bound and open/replay perf);
  SQLite (over-engineered vs. the app's JSON-under-`.data` norm).

## R3. Retention bound = bounded xterm scrollback window

- **Decision**: The retention bound is the existing per-session xterm scrollback cap
  (currently `scrollback: 5000` in `OrchestratorPanel.createTerminal`). The store keeps at
  most that many rendered lines/turns for the active session and resets on a new session
  (red ✕ / restart into a fresh conversation).
- **Rationale**: Directly encodes the FR-006 clarification: "mirror how agent TUIs work
  today — a bounded xterm scrollback window per session … which resets on a new session".
  Guarantees bounded open/replay cost (FR-007, SC-001/002) and matches agent-TUI behavior.
- **Alternatives considered**: A separate larger transcript cap — rejected by the
  clarification (no separate unbounded log; mirror the agent-TUI model exactly).

## R4. TUI replay & view-only + green theme

- **Decision**: On `orchestrator:open`, the panel fetches the persisted transcript (new
  restore channel) and replays it into xterm in original order with role/origin
  attribution BEFORE writing the "ready" line — instead of today's blank
  "Orchestrator ready…" slate. The TUI stays **view-only** (input solely via the textbox;
  no `terminal.onData` typing path is added) and Page Up/Down scrolls the existing
  scrollback. The green "hacker" theme is already present
  (`background:#001200`, `foreground/cursor:#00ff41`) — confirm/keep it and document it as
  orchestrator-only (agent terminals unaffected).
- **Rationale**: FR-003/FR-003a/FR-007 and SC-001/SC-002. Reuses the panel's existing
  xterm instance, scrollback, and clipboard-cascade (Principle VI) untouched.
- **Alternatives considered**: Rebuilding the transcript as DOM chat bubbles — rejected:
  violates the "mirror the agent TUI structure" clarification and duplicates rendering.

## R5. All-offices situational awareness from the canonical status source

- **Decision**: `get_active_agents` / `list_agents_awaiting_input` enumerate every
  session-bearing agent across **all** offices via `officeManager.getAllOffices()` +
  `getSeatedAgents(officeId)` + `getAgentStatus(officeId, agentId)`, folding status through
  `resolveStatusKey`/`presentationFor`/`describeActivity`/`formatElapsedMmSs` from
  `agentStatusPresentation.ts`. Each returned agent includes its `officeId`. The roster
  MUST NOT omit `done`/idle-online agents (FR-008). `list_agents_awaiting_input` filters to
  the `waiting` key and orders longest-waiting first (FR-010).
- **Rationale**: FR-008/FR-009/FR-013 and SC-003/SC-004; guarantees no label divergence
  from in-world badges/dashboards because all surfaces read the same table.
- **Alternatives considered**: Current-office-only scope — rejected by the multi-office
  clarification. A new status computation — rejected: would re-introduce the drift spec 014
  eliminated.

## R6. Peek (`get_agent_transcript`) recent-output window

- **Decision**: Return a **bounded** recent-output window for one office-qualified agent,
  sourced read-only from the app's existing per-agent recent activity
  (`officeManager.getRecentActions(officeId, agentId)` / task summary), not unbounded PTY
  scrollback. Ungated, no session mutation (FR-011/FR-012).
- **Rationale**: Matches the spec's "bounded recent window, not unbounded scrollback"
  edge case and privacy note; reuses tracked state rather than scraping a live terminal
  buffer.
- **Alternatives considered**: Streaming the agent's full xterm buffer — rejected (privacy
  + unbounded response + would risk touching viewer state).

## R7. Act-on-agent execution paths (reuse, don't reinvent)

- **Decision**: Reuse sanctioned renderer-side per-agent operations, resolved late over new
  `orchestrator:*` request channels:
  - `answer_agent` / `send_prompt_to_agent` → deliver text into the target agent's live
    session via the same terminal input path the in-world terminals use (after
    `warmAgentSession`/`terminalStart` semantics ensure it is online).
  - `stop_agent` / `restart_agent` → the existing stop / (stop+restart) session operations.
  - `set_agent_teams_presence` → the existing `teamsRegister` / `teams:stop` machinery
    (spec 011) already used for the orchestrator's own presence and dashboard tiles.
- **Rationale**: Assumption in the spec: answers/prompts/stop/restart map onto existing
  per-agent session operations, and agent Teams presence reuses spec 011 machinery.
  Preserves Principle III session integrity and the `agent-viewers.ts` dual-key rules.
- **Alternatives considered**: New per-agent session plumbing in the orchestrator — rejected
  (duplicates terminal ops, high regression risk to session lifecycle).

## R8. Gating, target re-validation & identity guard

- **Decision**: Every act-on tool routes through the orchestrator's always-on
  `permissionHandler` (extend the current `bring_agent_online`-only branch to the new gated
  tool names), which NEVER consults `isYoloEnabled()`. Each tool re-validates its
  office-qualified target at execution time in the renderer resolver and returns a typed
  `ActOnResult` (`delivered`/`sent`/`stopped`/`restarted`/`taken-offline`/`online-in-teams`
  vs. `not-online`/`not-waiting`/`invalid-target`/`unavailable`/`denied`/`failed`). Targets
  matching the synthetic orchestrator identity are rejected via `orchestratorIdentity`.
- **Rationale**: FR-014–FR-020, FR-025, SC-005–SC-008. Mirrors the proven
  `bring_agent_online` gate and outcome-union shape (`BringOnlineResult`).
- **Alternatives considered**: Honoring global YOLO for act-on tools — rejected: violates
  FR-018 (structurally gated regardless of YOLO).

## R9. Minimized / Teams-only approval relay parity

- **Decision**: Gated act-on requests raised while the overlay is minimized/Teams-only
  follow the existing `close()` rule: pending gates are denied ONLY when the orchestrator
  is NOT Teams-relay-active; when `teamsRelayActive` is true the gate stays open for the
  in-thread approver. New gated tools inherit this unchanged.
- **Rationale**: FR-021 and the spec edge case; the manager already implements exactly this
  for `bring_agent_online`, so no new relay logic is needed — only broadened tool coverage.
- **Alternatives considered**: Auto-denying while minimized — rejected: the spec forbids
  silently auto-denying when a remote approver exists.

## R10. Teams-disabled reporting & closing notice

- **Decision**: `set_agent_teams_presence` returns `unavailable` with a clear message when
  the Teams feature is disabled/unconfigured (checked via the existing `teams:getSettings`
  flag), and taking an agent offline posts the established closing notice to its thread via
  the existing stop path.
- **Rationale**: FR-022 and US8 acceptance scenarios 2–3.
- **Alternatives considered**: Failing opaquely — rejected (silent-failure ban, FR-025).

## Cross-cutting: tool descriptions for natural-language selection

- **Decision**: Author each new tool's `description` (in `tools.ts`) so the orchestrator
  picks it from natural language without the user naming the tool or the exact agent
  (capability-based selection), consistent with the existing tool descriptions and the
  system prompt, which will be extended to cover status/act-on/peek/Teams-presence flows.
- **Rationale**: FR-024, SC-009.
