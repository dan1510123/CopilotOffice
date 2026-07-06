# Contract: Renderer ↔ Main IPC (`teams:*`)

New IPC channels wired through `electron/terminal/ipc-relay.ts` and exposed on
`window.copilotBridge` via `electron/terminal/preload.ts`, following the existing
`terminal*` bridge conventions. All calls are async and return `{ success, ... }`.

## Renderer → Main (invoke)

| Channel | Args | Returns | Purpose |
|---------|------|---------|---------|
| `teams:status` | `{ agentId?, officeId? }` | `{ success, connected, bindings: OnlineAgentStatus[] }` | Current service + per-agent online state (for button state / indicator) |
| `teams:register` | `{ officeId, agentId }` | `{ success, handle?, threadWebUrl?, error? }` | Bring agent online: derive handle, create thread, bind, start listening. Fails if no channel configured or session missing. |
| `teams:stop` | `{ officeId, agentId }` | `{ success }` | Take agent offline (connection only; session untouched) |
| `teams:getSettings` | — | `{ success, settings: TeamsSettings }` | Load global Teams settings (`enabled` flag, `defaultChannelUrl`, check-in prefs) |
| `teams:saveSettings` | `{ settings }` | `{ success, parsed?: { teamId, channelId, tenantId }, error? }` | Persist + validate global settings (parse default deep-link) |
| `teams:register` resolution | — | — | Effective channel = `office.teamsChannelUrl ?? settings.defaultChannelUrl`, then parse. Block with prompt if empty/unparseable (FR-004). |

`TeamsSettings = { enabled, defaultChannelUrl, checkInEnabled, checkInThresholdMs, checkInThrottleMs }`.
Per-office override `teamsChannelUrl` is edited in the office settings (next to working directory)
and persisted on `OfficeConfig`, not through `teams:saveSettings`.

`OnlineAgentStatus = { agentId, online, handle, threadWebUrl, health: 'connected'|'disconnected'|'error' }`

## Main → Renderer (events, via existing IPC event relay)

| Event | Payload | Purpose |
|-------|---------|---------|
| `teams:status:changed` | `{ agentId, online, health }` | Update button + status dot live |
| `teams:toast` | `{ level, message }` | Surface GC cleanup / auth errors / online confirmations as toasts |

## UI wiring rules

- The "Teams remote" control renders **only when `settings.enabled` is true** (feature flag,
  FR-004a). It is added in **both** `TerminalOverlay` and `SeriousTerminalController` (Principle VI
  mirror). It reflects three visual states: offline (default), pending (spinner while creating
  thread), online (highlighted).
- `TeamsSettingsOverlay` uses `ZIndex.TEAMS_SETTINGS`, exposes `onOpen`/`onClose` wired to
  `InputManager.suspendGameInput()`/`resumeGameInput()` via the `settings:open`/`settings:close`
  bus (constitution Principle II).
- Clicking "Teams remote" with no channel configured routes the user to `TeamsSettingsOverlay`
  with a clear prompt (FR-004) instead of failing silently.
