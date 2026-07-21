# Implementation Plan: Office Orchestrator Improvements — Top-10 Scenarios, Tooling & Persistent Transcript

**Branch**: `017-orchestrator-improvements` (continuation of spec 016 — no new runtime branch) | **Date**: 2026-07-17 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/017-orchestrator-improvements/spec.md`

## Summary

Spec 016 shipped the Office Orchestrator: one dedicated, always-gated Copilot SDK session
(main process) driven from a focused xterm panel, with discovery/navigation tools
(`list_office_agents`, `list_offices`, `switch_office`) and a single gated mutation
(`bring_agent_online`), plus a Teams remote presence for the orchestrator itself.

This feature closes the two remaining gaps by delivering scenarios 3–10 as US1–US8:

1. **Persistent, fully-rendered transcript (US1).** Add a durable, retention-bounded
   transcript for the orchestrator session that survives minimize/close/reopen, captures
   Teams-originated turns, and is restored + replayed into the (view-only, Page Up/Down
   scrollable, green "hacker"-themed) TUI on the next open — without the user asking the
   agent to recall it. Persistence stores the same bounded xterm scrollback window the
   agent TUIs already use (current 5000-line cap), reset on a new session.

2. **Situational-awareness tools (US2, US3, US7).** Three read-only, ungated tools —
   `get_active_agents`, `list_agents_awaiting_input`, `get_agent_transcript` — that span
   **all offices**, label each agent with its office, and derive status from the single
   `agentStatusPresentation` source of truth.

3. **Act-on-agent tools (US4, US5, US6, US8).** Gated tools — `answer_agent`,
   `send_prompt_to_agent`, `stop_agent`/`restart_agent`, `set_agent_teams_presence` — each
   routed through the orchestrator's always-on permission gate (independent of global
   YOLO), re-validating the office-qualified target at execution time, returning typed
   outcomes, honoring the minimized/Teams-relay approval semantics, and recording every
   outcome (including denials) in the transcript.

**Technical approach:** Extend the existing seams, do not invent parallel ones. New tools
are registered in `electron/orchestrator/tools.ts` and backed by `requestX`/`respondX`
round-trips on `OrchestratorSessionManager` + the `orchestrator:*` IPC surface, resolved
late in the renderer (`src/main.ts`) where `OfficeManager`, the Teams bridge, and the
per-agent session operations live. The transcript is a new main-process, file-backed store
under `.data/` (mirroring `FileTeamsOnlineStore` / `OfficePersistencePort`), fed by the
existing orchestrator event tap and origin-tagged Teams turns, and replayed by the panel on
open. Reused paths: `warmAgentSession`/`terminalStart` (send/answer/restart),
`terminalStop`-equivalent (stop), `teamsRegister`/`teams:stop` (agent Teams presence),
`officeManager.getSeatedAgents`/`getAgentStatus`/`getRecentActions` (status + peek).

## Technical Context

**Language/Version**: TypeScript 5.x (strict), targeting Node (Electron main) + browser (renderer bundle)
**Primary Dependencies**: Electron, `@github/copilot-sdk` (`CopilotClient` / `RuntimeConnection.forStdio`), `@xterm/xterm` + `@xterm/addon-fit`, Phaser 3 (unaffected here), existing Teams remote stack (spec 011)
**Storage**: File-backed JSON under `.data/` (new `.data/orchestrator-transcript.json`), mirroring `FileTeamsOnlineStore` (`.data/teams-online-agents.json`) and the `OfficePersistencePort` schema pattern; captured by the existing `.data` backup snapshotter
**Testing**: Vitest unit suites under `tests/unit/orchestrator/**` and `tests/unit/teams/**` (existing 204 orchestrator+Teams tests MUST stay green); Playwright e2e smoke under `tests/e2e/**`
**Target Platform**: Electron desktop app (Windows-first dev; cross-platform runtime)
**Project Type**: Desktop app — Electron main process + Phaser/DOM renderer, split by IPC
**Performance Goals**: Transcript open/replay stays readable and responsive within the bounded 5000-line scrollback window; a status roll-up across all offices returns in a single tool round-trip; displayed status reflects state within the existing `STATUS_DELAY_TARGET_MS` (1s) budget inherited from spec 014
**Constraints**: Orchestrator session is ALWAYS gated (never consults `isYoloEnabled()`); act-on tools MUST re-validate targets and never touch the synthetic orchestrator identity; MUST preserve real Copilot CLI session semantics and the `agent-viewers.ts` dual-key invariants; no new in-canvas renderer; input focus stays routed through the panel `onOpen`/`onClose` → `InputManager` contract; TypeScript strictness preserved (no `any`/unsafe casts across the IPC seam)
**Scale/Scope**: 8 new/extended tools (3 read-only + ~5 gated actions counting stop/restart), 1 new transcript store + persistence port, transcript replay + green-theme/view-only confirmation in `OrchestratorPanel`, new `orchestrator:*` request/respond channels, and matching unit + e2e coverage. Single orchestrator session; agents span all configured offices.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Phaser-first constraint respected (no alternate in-canvas renderer introduced)** — The transcript TUI and its rendering remain DOM/xterm.js overlays (as in spec 016). No gameplay visuals move into the DOM; Phaser stays the sole in-canvas renderer.
- [x] **Event-driven boundaries preserved (`game.events`/IPC contracts, no hidden cross-layer coupling)** — All new tool round-trips flow over the existing `orchestrator:*` IPC seam via new `requestX`/`respondX` pairs correlated by `requestId`; reserve/scene work still uses the `game.events` round-trip. No hidden cross-layer coupling; transcript persistence lives behind a port interface.
- [x] **Input focus transitions routed through `InputManager`** — The panel keeps the host `onOpen`/`onClose` → `settings:open`/`settings:close` → `InputManager.suspend/resumeGameInput` contract. The transcript TUI is **view-only** (FR-003a): no direct typing, so no new keyboard capture path; only Page Up/Down scrollback is added.
- [x] **Session lifecycle integrity maintained for terminal/agent/fleet flows** — Act-on tools reuse sanctioned per-agent session operations (`warmAgentSession`/`terminalStart`, stop/restart, `teamsRegister`) and MUST NOT mutate `activeAgentViewers` outside its helpers or kill the wrong session. Orchestrator minimize-vs-close/Teams-relay semantics are preserved; transcript persistence never alters live session lifecycle.
- [x] **Configuration-first approach used for agents/layouts/feature flags** — Status/labels derive from the single `agentStatusPresentation` source of truth (no per-surface hardcoded labels/colors). No hardcoded agent IDs — targets are office-qualified ids resolved via `OfficeManager` + `src/config/agents.ts`. New tools register through the existing typed orchestrator tool registry. Teams-presence tool respects the existing Teams feature flag.
- [x] **Regression validation scope defined for touched high-risk flows** — See Regression Plan in spec's Constitution Alignment: unit coverage for every new tool's success + typed failure paths, transcript capture/persist/replay (incl. Teams-origin + post-restart), approval-relay parity across desktop/minimized/Teams-online. Keep existing 204 orchestrator+Teams tests green; run `npx tsc --noEmit`, `npm run build`, targeted vitest, extend e2e reopen-shows-history smoke.

**Principle VI (xterm selection/clipboard):** No change to the copy path is required; `OrchestratorPanel` already implements the mandated selection cascade + tagged toasts (`[Orch]`). Any TUI change MUST preserve that path. Because the orchestrator TUI is view-only, the dual-surface `TerminalOverlay`/`SeriousTerminalController` mirroring rule does not extend new copy logic here.

**Principle VII (worktree-aware verification):** This work builds `dist/game.bundle.js` and `dist/electron/*.js`. Before claiming a fix works, confirm the launched bundle matches (timestamp + distinctive marker such as a new tool name in the built bundle).

**Result:** PASS — no violations; Complexity Tracking left empty.

## Project Structure

### Documentation (this feature)

```text
specs/017-orchestrator-improvements/
├── plan.md              # This file (/speckit.plan command output)
├── research.md          # Phase 0 output (/speckit.plan command)
├── data-model.md        # Phase 1 output (/speckit.plan command)
├── quickstart.md        # Phase 1 output (/speckit.plan command)
├── contracts/           # Phase 1 output (/speckit.plan command)
│   ├── orchestrator-tools-v2.md   # New/extended SDK tool contracts (US2–US8)
│   ├── orchestrator-ipc-v2.md     # New orchestrator:* request/respond + transcript channels
│   └── transcript-store.md        # Persisted transcript schema + port contract
├── checklists/
│   └── requirements.md  # Pre-existing spec quality checklist
└── tasks.md             # Phase 2 output (/speckit.tasks command - NOT created by /speckit.plan)
```

### Source Code (repository root)

This is an established brownfield Electron + Phaser app; the plan extends existing modules
rather than introducing a new tree. Touched/added paths:

```text
electron/
├── orchestrator/
│   ├── tools.ts                     # EXTEND: register get_active_agents, list_agents_awaiting_input,
│   │                                #         get_agent_transcript, answer_agent, send_prompt_to_agent,
│   │                                #         stop_agent, restart_agent, set_agent_teams_presence
│   ├── types.ts                     # EXTEND: ActiveAgentSnapshot, AwaitingAgent, AgentRecentOutput,
│   │                                #         ActOnResult, TranscriptTurn, TranscriptOrigin, etc.
│   ├── orchestratorSessionManager.ts# EXTEND: requestX/respondX round-trips for new tools; gate ALL
│   │                                #         act-on tools; feed transcript on turns/permissions/exit
│   ├── orchestratorIpc.ts           # EXTEND: new orchestrator:* request/respond + transcript channels
│   ├── orchestratorTranscriptStore.ts # NEW: File-backed transcript store + port (mirror onlineAgentsStore)
│   └── orchestratorIdentity.ts      # REUSE: guard so act-on tools never target the orchestrator identity
├── teams/
│   ├── orchestratorSessionGateway.ts# REUSE/EXTEND: origin tagging for Teams-driven turns → transcript
│   └── (teamsService/teamsIpc)      # REUSE: agent Teams presence (register/stop) for set_agent_teams_presence
└── terminal/
    └── preload.ts                   # EXTEND: expose new orchestrator:* invoke/on bridges + transcript restore

src/
├── ui/
│   └── OrchestratorPanel.ts         # EXTEND: transcript restore+replay on open; confirm view-only + green
│                                    #         theme (already present); Page Up/Down scrollback
├── main.ts                          # EXTEND: renderer resolvers for the new request channels (status,
│                                    #         awaiting, peek, answer, send, stop, restart, teams-presence)
├── office/
│   └── officeManager.ts             # REUSE: getSeatedAgents/getAgentStatus/getRecentActions across offices
└── config/
    └── agentStatusPresentation.ts   # REUSE (read-only source of truth for status/labels)

tests/
├── unit/orchestrator/               # NEW/EXTEND: tool outcomes, transcript store, replay, gating
├── unit/teams/                      # EXTEND: agent Teams-presence + relay parity
└── e2e/                             # EXTEND: reopen-shows-history smoke
```

**Structure Decision**: Single desktop-app codebase split by process (Electron `electron/*`
main, `src/*` renderer bundle) communicating over the `orchestrator:*` IPC contract. This
feature stays entirely within that established structure — the main process owns the SDK
session, tool registry, permission gate, and the new transcript store; the renderer owns
`OfficeManager`, per-agent session operations, the Teams bridge, and the panel/TUI. No new
top-level project or alternate layout is introduced (matches spec 016).

## Complexity Tracking

> No Constitution Check violations — this feature extends existing seams and reuses the
> established gating, IPC round-trip, persistence-port, and status-presentation patterns.
> Nothing to justify.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| _(none)_  | —          | —                                    |
