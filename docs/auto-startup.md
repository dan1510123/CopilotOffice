# Auto-Startup of Known Agents (Spec 009)

This feature warms previously-used agent sessions automatically on three triggers:

1. **Cold launch** — first time the app loads an office this session.
2. **Office switch** — first time an office is selected this session.
3. **New Session** — closes + restarts an agent and (when ON) re-spawns it.

An agent **qualifies** for auto-startup only if:

- Its `meta[agentId].title.trim()` is non-empty AND
- It has a persisted `current[agentId]` uuid in `.data/{officeId}.sessions.json`.

Fleet sub-agents are excluded (FR-020) because they're not in any office's roster.

## Code map

| File | Role |
| --- | --- |
| `src/config/agentAutoStart.ts` | Typed `AgentAutoStartSettings` (`autoStartKnownAgents: boolean`, default `true`) persisted to `localStorage` under `copilot-office-agent-auto-start`. Mirrors `src/config/notifications.ts`. |
| `src/agents/AutoStartCoordinator.ts` | Single decision point. `tryWarmCurrentOffice()` (rules #1/#2) + `replaceSession()` (rule #3). Embeds `WarmedOfficeRegistry` (sessionStorage-backed; per-app-session set under key `copilot-office-auto-start:warmed`) and `AgentReplaceTracker` (in-memory coalescer for rapid double-clicks). Exposes a singleton via `setAutoStartCoordinator()` / `getAutoStartCoordinator()`. |
| `src/main.ts` | Constructs the coordinator, defines the headless `warmAgentSession()` helper (which does NOT mutate `selectedAgentId` or pop the overlay), and wires the two triggers in `officeManager.onOfficesUpdated` (cold-launch) and `switchToOffice()` (office-switch). |
| `src/ui/TerminalOverlay.ts` `handleNewSession()` | Game-mode "New Session" delegates close+restart to `coordinator.replaceSession(...)`. |
| `src/ui/SeriousTerminalController.ts` `startNewSession()` | Serious-mode "New Session" delegates close+restart to `coordinator.replaceSession(...)`. |
| `src/ui/SettingsPanel.ts` | Renders the "Agents" section with a single checkbox "Auto-start known agents". |
| `electron/terminal/preload.ts` | `__copilotOfficeDebug` is extended with `getWarmedOfficeIds`, `getAutoStartTerminalStartCount`, `triggerAutoStartForCurrentOffice`, `replaceAgentSession`, `setAutoStartEnabled`, `clearWarmedOfficeRegistry`, `getCurrentSessionIdForAgent`. |

## Storage keys

- `localStorage["copilot-office-agent-auto-start"]` — `{ "autoStartKnownAgents": boolean }`. Default ON. Read at trigger time so toggles take effect on the next applicable trigger (FR-018).
- `sessionStorage["copilot-office-auto-start:warmed"]` — JSON array of officeIds warmed during this app session. Cleared on Electron quit. Renderer reloads do NOT re-warm.

## Tests

- Unit: `tests/unit/config/agentAutoStart.test.ts`, `tests/unit/agents/autoStartCoordinator.test.ts`, `tests/unit/ui/settingsPanel.agents.test.ts`.
- E2E: `tests/e2e/auto-startup.e2e.ts` covers scenarios A1 (cold-launch warm), A2+A3 (office-switch warm + second-visit no respawn), A4 (Settings OFF gate on replace), A5+A6 (replaceSession fresh uuid; Close stays slacking), and A7 (double-click coalescing).

## Constraints respected

- **No new IPC, no new disk schema.** All bridge calls reuse existing surfaces.
- **No-double-spawn (FR-006 / FR-014).** Server-side dedup in `terminal/server.ts` handles concurrent `terminalStart` for the same `(officeId, agentId)`. `AgentReplaceTracker` coalesces rapid `replaceSession` clicks.
- **InputManager untouched.** The headless `warmAgentSession` does not emit `open:agent:terminal` and does not call `seriousTerminalController.openAgentTerminal`. Phaser focus is preserved.
- **No hardcoded agent IDs.** Roster comes from layout + customAgents via `buildCanonicalAgentIdsForOffice()`.
