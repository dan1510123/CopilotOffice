# Phase 1 Data Model: Teams Remote Agents

Entities are main-process TypeScript types plus the on-disk JSON schema. No relational DB.

## Entities

### OnlineAgentBinding
The core record: one online agent bound to one channel thread.

| Field | Type | Notes |
|-------|------|-------|
| `agentId` | string | CopilotOffice agent id (from `src/config/agents.ts`; never a hardcoded literal in logic) |
| `officeId` | string | Owning office id (session keys are `officeId:agentId`) |
| `sessionId` | string | Terminal session id — the **reconnect key** (FR-024) |
| `handle` | string | Normalized handle incl. collision suffix, e.g. `gene`, `gene-1` |
| `displayName` | string | Agent display name (for intro post) |
| `workingDir` | string | Agent working folder (for intro post) |
| `sessionTitle` | string | Latest known session title (for thread subject + intro) |
| `teamId` | string | Parsed from channel deep-link (`groupId`) |
| `channelId` | string | Parsed channel id `19:...@thread.tacv2` |
| `tenantId` | string | Parsed from deep-link |
| `threadRootId` | string | Root message id of the agent's thread (routing target) |
| `online` | boolean | Currently connected/listening |
| `lastConnected` | number | Unix ms; drives 30-day GC (FR-024a) |

**Validation**
- `handle` MUST be non-empty after normalization (else reject going online).
- `handle` MUST be unique across currently-online bindings (collision → suffix).
- `threadRootId` MUST be set once the intro post succeeds; until then the binding is "pending".
- `sessionId` MUST match a live terminal session to be actively listening; otherwise the binding
  waits for that session id to reappear (event-driven reconnect).

**State transitions**
```
(none) --click Teams remote--> pending --thread created + intro posted--> online
online --/stop or in-app offline--> (removed from store; session untouched)
online --new session for agent (session id changes)--> (removed; offline notice posted) [FR-022]
online --app close--> persisted (online=true retained)
persisted --matching sessionId session appears--> online (re-bound, no new thread) [FR-024]
persisted --lastConnected > 30d at startup--> (GC removed; toast) [FR-024a]
persisted --thread unresolvable on reconnect--> new thread + rebind OR flagged failed [FR-025]
```

### KnownCreatedThreads
Set of thread root ids the app has ever created, retained beyond binding removal.

| Field | Type | Notes |
|-------|------|-------|
| `threadRootId` | string | Distinguishes orphaned agent threads (notify once) from foreign threads (ignore) |
| `noticePosted` | boolean | Whether the one-time "no longer active" notice was already posted (FR-027 dedupe) |

### TeamsSettings
Global user configuration (persisted with app config).

| Field | Type | Default | Notes |
|-------|------|---------|-------|
| `enabled` | boolean | false | **Feature flag** — show/hide the "Teams remote" control (FR-004a) |
| `defaultChannelUrl` | string | "" | Default channel deep-link (parsed → team/channel/tenant) |
| `checkInEnabled` | boolean | false | Long-running check-ins on/off (FR-016) |
| `checkInThresholdMs` | number | 120000 | Turn duration before first check-in |
| `checkInThrottleMs` | number | 60000 | Min interval between check-ins |

### Office Teams Override
Stored on `OfficeConfig` (alongside `workingDirectory`); carried verbatim through
`serializeOffices`/`deserializeOffices` like `customAgents`.

| Field | Type | Notes |
|-------|------|-------|
| `teamsChannelUrl` | string? | Optional per-office override channel deep-link. Unset → office uses `defaultChannelUrl`. |

**Channel resolution** (per office, at register time): `office.teamsChannelUrl ?? settings.defaultChannelUrl`,
then `parseChannelLink(...)`. If the result is empty/unparseable → block online with a prompt (FR-004).

**Active channel set**: the distinct `channelId`s across all currently-online bindings. The
message filter admits a push only if its channel is in this set; routing is keyed by
`(channelId, threadRootId)`. One account-wide Trouter subscription serves every channel (FR-005).

### InboundMessage (transient)
Normalized push/poll message under evaluation (not persisted).

| Field | Type | Notes |
|-------|------|-------|
| `messageId` | string | Dedup key |
| `channelId` | string | For channel match against the **active channel set** |
| `threadRootId` | string | Extracted from `conversationid` `;messageid=` suffix; with `channelId` forms the routing key |
| `senderName` | string | Informational only (no sender restriction) |
| `content` | string | Plain text (HTML stripped) |
| `composeTime` | string | ISO; stale detection |
| `hasMarker` | boolean | App self-post detection (drop if true) |
| `classification` | `bound` \| `orphaned` \| `foreign` | Routing decision |

### AuthToken (in-memory only)
| Field | Type | Notes |
|-------|------|-------|
| `resource` | string | `graph.microsoft.com` or `ic3.teams.office.com` |
| `token` | string | **Secret** — never logged/persisted/rendered |
| `expiresAt` | number | From JWT `exp`; proactive refresh with buffer |

### DispatchQueueItem (transient)
| Field | Type | Notes |
|-------|------|-------|
| `agentId` / `sessionId` | string | Target session |
| `threadRootId` | string | Where to post the reply |
| `prompt` | string | Text to submit |
| `status` | `queued` \| `processing` \| `done` \| `error` | Sequential per agent |

## On-disk JSON schema (`.data/teams-online-agents.json`)

```json
{
  "version": 1,
  "bindings": [
    {
      "agentId": "generalist",
      "officeId": "office-0",
      "sessionId": "1f3c...uuid",
      "handle": "gene",
      "displayName": "Gene",
      "workingDir": "C:/path/to/agent",
      "sessionTitle": "Fixing terminal scroll",
      "teamId": "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
      "channelId": "19:0123456789abcdef0123456789abcdef@thread.tacv2",
      "tenantId": "00000000-0000-0000-0000-000000000000",
      "threadRootId": "1783371733113",
      "online": true,
      "lastConnected": 1783371733113
    }
  ],
  "knownThreads": [
    { "threadRootId": "1783371733113", "noticePosted": false }
  ]
}
```

Notes:
- **No tokens** are ever written to this file.
- `version` enables forward migration.
- Store access is via `TeamsOnlineStore` port (`load()`/`save()`), with an in-memory
  implementation for Vitest.
