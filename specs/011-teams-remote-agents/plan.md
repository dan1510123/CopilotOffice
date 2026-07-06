# Implementation Plan: Teams Remote Agents

**Branch**: `011-teams-remote-agents` | **Date**: 2026-07-06 | **Spec**: [spec.md](./spec.md)
**Input**: Feature specification from `/specs/011-teams-remote-agents/spec.md`

## Summary

Bring CopilotOffice agents "online" in a Microsoft Teams **channel**: clicking a per-agent
"Teams remote" control starts a dedicated, subject-titled channel **thread** (`<agent name>:
<session title>`) with an intro post, then binds that thread to the agent's existing terminal
session. Anyone in the channel can drive the agent by replying in its thread (no @mention);
replies route into the agent's persistent session and answers post back into the thread.

The Electron **main process** runs a single background Teams service: it subscribes to Teams'
real-time **Trouter** WebSocket (account-wide push), filters to the configured channel, routes
each thread message to the bound agent's session via the existing terminal server, and posts
responses back via **Microsoft Graph**. Auth uses non-interactive `az`-acquired tokens (Graph
for send, `ic3.teams.office.com` for receive) — all validated by live spike. Online bindings
persist in a JSON store keyed by session id; reconnection is event-driven when a matching
session reappears, with 30-day stale GC. `/stop` (or the in-app toggle) closes the Teams
connection only, never the session.

## Technical Context

**Language/Version**: TypeScript 5.9 (strict), Electron 40 main process (Node ~20/22) + browser renderer
**Primary Dependencies**: Electron 40, node-pty 1.1, `@github/copilot-sdk` (terminal backend), Phaser 3.90 (renderer, unaffected), `ws` (NEW — Trouter WebSocket client for main process)
**Storage**: JSON file via a new persistence port mirroring `OfficePersistencePort`; default `.data/teams-online-agents.json` (bindings + known-thread ids). Global Teams settings (feature flag + default channel + check-in prefs) persisted alongside existing app config; per-office override channel deep-link stored on `OfficeConfig` (carried through `serializeOffices`/`deserializeOffices`).
**Testing**: Vitest (`npm run test`) for unit/integration; Playwright (`npm run test:e2e`) for the button→online→status UI flow. Network/auth mocked via injected token-provider + transport ports (no live secrets in tests).
**Target Platform**: Windows/macOS desktop (Electron). Auth path assumes `az` CLI present and signed in.
**Project Type**: Desktop app (Electron main + Phaser/DOM renderer), single repository.
**Performance Goals**: Follow-up round-trip dominated by agent think time (persistent-session reuse ≥5× vs cold start, SC-002); Teams push→dispatch latency < 2s; reply chunking up to ≥10k chars.
**Constraints**: Phaser remains sole renderer; new UI is DOM overlays only. Input-focus transitions via `InputManager`. No hardcoded agent IDs. Secrets never logged/committed. Dispatch must not gate on active terminal viewers and must respect the `activeAgentViewers` dual-key invariant.
**Scale/Scope**: **One or more channels** (global default + per-office overrides that have online agents); a handful of agents online concurrently; single account-wide Trouter subscription; single-tenant, single signed-in posting identity.

### Validated feasibility (spikes, 2026-07-06)

- **Send**: Graph `POST /teams/{team}/channels/{channel}/messages` (root, with `subject`) and `.../messages/{id}/replies` — works with the CLI Graph token (`Directory.AccessAsUser.All`; no `ChannelMessage.Send` needed).
- **Receive (real-time)**: one Trouter WebSocket subscription pushes channel-thread messages live; channel `conversationid` carries `;messageid=<rootId>` = the thread routing key. ic3 token (`Teams.AccessAsUser.All`).
- **Receive (fallback)**: chatsvc `GET …/conversations/{channelId}/messages` with `sequenceId` cursor (proven, unused).
- **Auth**: both tokens from `az account get-access-token` non-interactively; JWT `exp` drives proactive refresh.

### Simplification vs the Python reference

CopilotOffice's terminal backend submits prompts with a plain `proc.write(prompt + '\r')`
(see `electron/terminal/server.ts` pre-seeded-prompt path). The reference's bracketed-paste +
staggered-triple-Enter ready-gate dance is **not required** — dispatch reuses the existing write
path. The whole `pty-bridge/` + `prompt_queue` + `pty_bridge.py` layer is replaced by the
existing terminal server, `EventsWatcher`, and session-meta plumbing.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

- [x] **Phaser-first** — no new in-canvas renderer. Teams control, status indicator, settings are DOM overlays in the terminal panel; NPC-facing status (if any) uses existing `game.events` channels.
- [x] **Event-driven boundaries** — Teams service in Electron main; talks to renderer over documented `teams:*` IPC (via `ipc-relay.ts` + `preload.ts`), mirroring existing status/tool event forwarding. No hidden coupling.
- [x] **Input focus via InputManager** — Teams settings overlay exposes `onOpen`/`onClose` wired to `suspendGameInput()`/`resumeGameInput()` through the `settings:open`/`settings:close` bus.
- [x] **Session lifecycle integrity** — dispatch reuses the terminal server/`EventsWatcher` as an additional consumer, never a new lifecycle. Won't gate fleet-critical events on viewers, won't mutate `activeAgentViewers` directly (use `agent-viewers.ts`); `/stop`/offline never kill or detach the session.
- [x] **Configuration-first** — handles derive from `src/config/agents.ts` named-id constants (no literals); channel/config in a persisted Teams settings store; new overlay uses a new `ZIndex` entry.
- [x] **Regression scope defined** — unit tests (handle collision, filter pipeline, channel-link parse, marker round-trip, store GC, reconnect); integration test that remote dispatch leaves terminal viewer + office-switch detach intact; parity of the control across `TerminalOverlay` and `SeriousTerminalController` (Principle VI).

**Result: PASS** — no violations; Complexity Tracking not required.

## Project Structure

### Documentation (this feature)

```text
specs/011-teams-remote-agents/
├── plan.md              # This file
├── research.md          # Phase 0 output — decisions & rationale
├── data-model.md        # Phase 1 output — entities, JSON schema, state machine
├── quickstart.md        # Phase 1 output — setup + manual verification
├── contracts/           # Phase 1 output
│   ├── teams-api.md     # external Teams REST/WS contracts (Graph, chatsvc, Trouter)
│   ├── ipc-channels.md  # renderer↔main teams:* IPC contract
│   └── ports.md         # internal TS interfaces (token provider, transports, store)
└── checklists/
    └── requirements.md  # Spec quality checklist
```

### Source Code (repository root)

```text
electron/
├── main.ts                          # wire TeamsService lifecycle (start on ready, stop on quit)
├── teams/                           # NEW — main-process Teams service (Node)
│   ├── teamsService.ts              # orchestrator: Trouter sub, routing, reconnect, GC
│   ├── auth.ts                      # az token acquisition (Graph + ic3), cache, JWT exp refresh
│   ├── graphClient.ts               # channel enumeration + send (create thread / reply)
│   ├── chatsvcClient.ts             # receive fallback (polling); message-shape helpers
│   ├── trouterClient.ts             # WebSocket subscribe (port of reference handshake) via `ws`
│   ├── channelLink.ts               # parse Teams deep-link URL → {teamId, channelId, tenantId}
│   ├── channelResolver.ts           # office override ?? global default; active-channel-set tracking
│   ├── messageFilter.ts             # dedup / stale / marker / thread-binding / orphaned / foreign
│   ├── handleRegistry.ts            # name → normalized handle, collision suffixing
│   ├── marker.ts                    # embed/detect app-post marker (self-loop guard)
│   ├── onlineAgentsStore.ts         # JSON persistence port (bindings + known threads) + GC
│   ├── dispatchQueue.ts             # per-agent sequential queue → terminal write
│   └── types.ts                     # shared Teams-domain types
└── terminal/
    ├── ipc-relay.ts                 # + teams:* IPC handlers (register/stop/status/settings)
    ├── preload.ts                   # + teams bridge surface
    └── protocol.ts                  # (reuse write / get-session-id / get-session-meta / turn-end)

src/
├── ui/
│   ├── TerminalOverlay.ts           # + "Teams remote" button near New/Close Session (~L908)
│   ├── SeriousTerminalController.ts # + mirrored "Teams remote" control (Principle VI)
│   └── TeamsSettingsOverlay.ts      # NEW — channel deep-link input + check-in toggles
├── config/
│   ├── zIndex.ts                    # + TEAMS_SETTINGS layer
│   └── teamsConfig.ts               # NEW — global settings shape + defaults (flag, default channel, thresholds)
├── office/
│   ├── officeManager.ts             # + optional `teamsChannelUrl` on OfficeConfig
│   └── officePersistence.ts         # carry `teamsChannelUrl` verbatim (like customAgents)
└── main.ts                          # + renderer wiring: teams status events, settings open, office-override field (near working dir)

tests/
├── unit/teams/                      # handle, filter, channelLink, marker, store-GC, reconnect
└── integration/                     # dispatch-into-session non-regression; button→online (playwright)
```

**Structure Decision**: Single-repo desktop app. The Teams service is **main-process only** (it
needs Node networking, long-lived sockets, and direct terminal-server access) under a new
`electron/teams/` module. The renderer contributes only DOM controls and talks to the service
through new `teams:*` IPC channels, consistent with existing `electron/terminal` boundaries.
Persistence uses a dedicated port mirroring `OfficePersistencePort` so the store is
unit-testable in isolation.

## Complexity Tracking

> No constitution violations — section intentionally empty.
