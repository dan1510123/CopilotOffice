# Phase 0 Research: Teams Remote Agents

All items below were resolved before design; several were **validated by live spike** on
2026-07-06 against a real Teams tenant/test team. No `NEEDS CLARIFICATION` remain.

## D1. Teams surface: channel threads vs chats

- **Decision**: Target true Teams **channel threads** (channel inside a Team). A "thread" is a
  reply chain under a root message (root message carries a `subject` → renders as a titled thread).
- **Rationale**: User requirement; gives each agent a dedicated, human-visible home surface.
- **Alternatives**: Chat conversations (as in the Python reference) — simpler but not what the
  user wants; rejected. Kept only as the behavioral reference for filtering/chunking.

## D2. Sending messages (create thread + reply)

- **Decision**: Microsoft **Graph** `POST /teams/{teamId}/channels/{channelId}/messages`
  (root, with `subject` = `<agent name>: <session title>`) and
  `POST /teams/{teamId}/channels/{channelId}/messages/{rootId}/replies`.
- **Rationale**: **Spike-validated** — succeeds with the `az` Graph token whose scopes include
  `Directory.AccessAsUser.All` (no `ChannelMessage.Send` consent needed). HTML body supported.
- **Alternatives**: chatsvc/CSA POST with the ic3 token (as the reference does for chats) —
  works too but Graph send is cleaner and already proven; keep as fallback only.

## D3. Receiving messages (real-time)

- **Decision**: Subscribe to Teams **Trouter** via one WebSocket in the main process (port of
  `agency-cowork` `trouter_client.py` handshake) using the `ic3.teams.office.com` token.
  Account-wide push; filter to the configured channel; route by the thread root id.
- **Rationale**: **Spike-validated** — channel-thread messages pushed in real time within ~1s;
  the channel `conversationid` includes `;messageid=<rootId>` giving the exact thread routing key.
  Graph channel *reads* are NOT available with the CLI token (403, needs `ChannelMessage.Read.All`),
  so Trouter/chatsvc is the receive path.
- **Alternatives**: Graph change-notification subscriptions (webhooks) — require a public HTTPS
  endpoint; not viable for a local desktop app; rejected. chatsvc **polling** (`GET
  …/conversations/{channelId}/messages` with `sequenceId` cursor) — proven, kept as fallback if
  Trouter drops or is unavailable.

## D4. Authentication

- **Decision**: Two non-interactive tokens from `az account get-access-token`:
  Graph (`https://graph.microsoft.com`) for send + enumeration; `https://ic3.teams.office.com`
  for Trouter/chatsvc receive. Cache in memory; decode JWT `exp`; proactively refresh with a
  buffer. No interactive browser sign-in in the normal path.
- **Rationale**: **Spike-validated**; matches the reference's CLI-first approach. Confirmed the
  primary user's tenant issues an `ic3` token (no AADSTS530084 block).
- **Alternatives**: Playwright browser fallback (reference's last resort) — out of scope for v1;
  MSAL device-code — unnecessary given `az` works. Note both tokens are user-scoped secrets:
  never log, persist to the JSON store, or surface in UI.

## D5. Dispatching a prompt into an agent session

- **Decision**: Reuse the existing terminal server. Route a matched message through a per-agent
  sequential queue, then submit via the existing PTY write path (`proc.write(prompt + '\r')`,
  the same mechanism used for `preseededPrompt` in `electron/terminal/server.ts`). Capture the
  response from `SrvCopilotEvent` (`assistant.message` content) accumulated until
  `SrvCopilotTurnEnd`.
- **Rationale**: CopilotOffice's `copilot-sdk` backend accepts plain writes — the reference's
  bracketed-paste/ready-gate/triple-Enter complexity is unnecessary here. `EventsWatcher` already
  tails `events.jsonl` and emits structured turn/tool/message events.
- **Alternatives**: A separate PTY bridge (the reference's `pty-bridge/`) — redundant; rejected.
  Reading raw terminal stdout for content — noisy (ANSI); rejected in favor of structured events.

## D6. Thread ↔ agent binding & identity key

- **Decision**: Bind by **terminal session id** (`get-session-id`). The JSON store maps
  `{ agentId, sessionId } → { handle, teamId, channelId, threadRootId, online, lastConnected }`.
  Routing: incoming thread root id → binding → agentId → session write.
- **Rationale**: Session id is the stable identity the user chose for reconnect ("connect when
  the agent session comes online, track by session id"). Thread root id is the Teams-side key
  extracted from the push.
- **Alternatives**: Bind by agentId alone — breaks when a new session replaces the old (must
  disconnect); handled by keying on sessionId + FR-022.

## D7. Persistence: JSON vs database

- **Decision**: JSON file behind a new `TeamsOnlineStore` port mirroring `OfficePersistencePort`
  (`loadDurable`/`saveDurable`), default `.data/teams-online-agents.json`. Holds bindings +
  the set of known-created thread ids.
- **Rationale**: Consistency with existing office persistence; tiny dataset; no relational needs;
  in-memory port for tests.
- **Alternatives**: SQLite/DB — overkill; rejected.

## D8. Handle derivation & collisions

- **Decision**: `handle = normalize(agent.name)` → lowercase, strip non-alphanumerics. On
  collision with an online handle, append `-1`, `-2`, … (first free). Empty/invalid normalization
  is rejected with a clear error. Handle is used for the thread subject prefix + identity, not for
  routing.
- **Rationale**: Deterministic, matches spec (`@gene` → `@gene-1`). Case-insensitive per FR-002.
- **Alternatives**: GUID suffixes — unfriendly; rejected.

## D9. Self-loop & marker

- **Decision**: Use TWO independent self-loop guards, both applied before any other filtering:
  1. **Message-id tracking (primary, deterministic)** — record the id of every message the app
     posts (thread root from `createThread`, reply id from `replyToThread`); drop any inbound
     message whose id matches. Independent of content sanitization.
  2. **Zero-width content marker (secondary)** — embed a distinctive zero-width character
     sequence (`\u200B\u200C\u200D…`) inside the message body text; detect and drop on receive.
- **Rationale**: The app posts under the user's own identity, so sender identity can't
  distinguish app posts. Two guards cover each other: id-tracking is deterministic but assumes the
  Graph-returned id equals the Trouter `resource.id`; the content marker covers any id mismatch.
- **PITFALL (fixed 2026-07-06)**: The first implementation used an **HTML comment**
  (`<!--marker-->`) as the marker. **Teams strips HTML comments** from channel message content, so
  the marker vanished on the Trouter echo and the app's own intro post was mis-dispatched into the
  agent session. HTML comments are NOT a viable content marker for Teams; the zero-width sequence
  survives sanitization, and message-id tracking (the "secondary guard" this doc originally named)
  is now implemented as the primary guard.
- **Alternatives**: Match a visible reply prefix (reference approach) — brittle and user-visible.

## D10. Message filter pipeline (order)

- **Decision**: dedup(messageId) → marker(drop app self-posts) → stale(compose-time > ~5m or
  skewed) → channel-in-active-set(message channel has ≥1 online agent) → thread-classify(bound
  agent | orphaned known-thread | foreign) → injection-scan(block+log on hit) → dispatch.
  Orphaned known-thread → one-time inactive notice. Foreign/root → ignore silently. Routing key
  is `(channelId, threadRootId)`.
- **Rationale**: Directly encodes FR-007/007a/012/026-028; the active-channel-set check supports
  multiple channels (global default + per-office overrides) over one subscription.
- **Alternatives**: Mention-based routing — replaced by thread-scoped routing per clarifications.

## D14. Channel configuration (default + per-office override + feature flag)

- **Decision**: Global `TeamsSettings` holds a feature flag (`enabled`) and a `defaultChannelUrl`.
  `OfficeConfig` gains an optional `teamsChannelUrl` override. Effective channel at register time =
  `office.teamsChannelUrl ?? settings.defaultChannelUrl`. The feature flag gates whether the
  "Teams remote" control renders at all. The listener watches the **union** of channels that have
  online agents (active channel set), still via a single Trouter subscription.
- **Rationale**: User requirement — offices can bind to different channels; a global flag toggles
  the whole feature. Account-wide Trouter push already delivers all channels, so multi-channel is
  a filter/routing concern, not extra connections.
- **Alternatives**: One channel only (previous v1 scope) — superseded. One subscription per channel
  — unnecessary given account-wide push; rejected.

## D11. WebSocket dependency in Electron main

- **Decision**: Add `ws` as a dependency for the Trouter client.
- **Rationale**: Battle-tested, works in Electron main (Node); the reference relied on Python
  `websockets` — `ws` is the Node equivalent. Node's global `WebSocket` (undici) exists in newer
  runtimes but header/subprotocol control and reconnect ergonomics are cleaner with `ws`.
- **Alternatives**: Node global `WebSocket` — viable but less controllable; revisit if we want
  zero new deps. HTTP polling only — loses real-time; rejected as primary.

## D12. Reconnect, GC, and lifecycle

- **Decision**: Reconnect is event-driven: when a terminal session with a stored id becomes
  available, reconnect Teams and re-bind. Never force-start sessions. On startup, GC store entries
  with `lastConnected` older than 30 days and toast a summary. New session for an agent tears down
  its Teams connection (FR-022). `/stop`/offline closes the connection only — session untouched.
- **Rationale**: Encodes the user's chosen lifecycle exactly (FR-022/023/024/024a/025).
- **Alternatives**: Auto-restart sessions on boot — rejected (user said no force-start).

## D13. Check-ins for long-running turns

- **Decision (SHOULD)**: When a turn exceeds a configured threshold, post a throttled interim
  update to the thread derived from tool/turn events (`SrvCopilotToolStart`, etc.). Throttle to a
  min interval; gated by a settings toggle.
- **Rationale**: `EventsWatcher`/server already surface tool/turn events; low incremental cost.
- **Alternatives**: Stream raw terminal text — noisy; rejected. Off by default acceptable.
