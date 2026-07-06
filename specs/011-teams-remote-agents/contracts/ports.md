# Contract: Internal TypeScript Ports

Injectable interfaces so the Teams service is unit-testable without live network/auth.

## TokenProvider
```ts
interface TokenProvider {
  /** Valid bearer token for a resource; refreshes if near expiry. */
  getToken(resource: 'graph' | 'ic3'): Promise<string>;
}
```
- Prod impl: `az account get-access-token --resource <...>`; JWT `exp` cache/refresh.
- Test impl: returns a fixed fake JWT with a controllable `exp`.

## GraphSender
```ts
interface GraphSender {
  createThread(p: { teamId; channelId; subject; html }): Promise<{ threadRootId: string; webUrl: string }>;
  replyToThread(p: { teamId; channelId; threadRootId; html }): Promise<{ messageId: string }>;
  listChannels?(teamId: string): Promise<Array<{ id: string; displayName: string }>>;
}
```

## MessageSource (receive)
```ts
interface MessageSource {
  /** Emits normalized InboundMessage objects. Trouter (primary) or chatsvc poll (fallback). */
  start(onMessage: (m: InboundMessage) => void): Promise<void>;
  stop(): Promise<void>;
  readonly health: 'connected' | 'disconnected' | 'error';
}
```

## TeamsOnlineStore (persistence port; mirrors OfficePersistencePort)
```ts
interface TeamsOnlineStore {
  load(): Promise<{ bindings: OnlineAgentBinding[]; knownThreads: KnownThread[] }>;
  save(state: { bindings: OnlineAgentBinding[]; knownThreads: KnownThread[] }): Promise<void>;
}
```
- Prod: file at `.data/teams-online-agents.json` via the host bridge.
- Test: in-memory.

## SessionGateway (bridge to existing terminal server)
```ts
interface SessionGateway {
  getSessionId(officeId: string, agentId: string): Promise<string | null>;
  getSessionMeta(officeId: string, agentId: string): Promise<{ title?: string } | null>;
  submitPrompt(officeId: string, agentId: string, prompt: string): Promise<void>; // proc.write(prompt+'\r')
  /** Subscribe to turn/message/tool events for response capture + check-ins. */
  onAgentEvent(cb: (e: { officeId; agentId; kind: 'message'|'turn-end'|'tool-start'; content?: string }) => void): () => void;
  /** Notify when a session id becomes available/changes (drives reconnect + FR-022 teardown). */
  onSessionChanged(cb: (e: { officeId; agentId; sessionId: string | null }) => void): () => void;
}
```
- Prod: thin adapter over existing `MainToServer`/`ServerToMain` protocol messages
  (`get-session-id`, `get-session-meta`, `write`, `copilot-event`, `copilot-turn-end`).
- Test: fake emitting scripted events.

## Marker
```ts
function embedMarker(html: string): string;   // adds hidden self-loop marker to every app post
function hasMarker(content: string): boolean; // true → drop before all other filtering
```

## Pure helpers (fully unit-tested)
```ts
function parseChannelLink(url: string): { teamId; channelId; tenantId } | null;
function normalizeHandle(name: string): string;                 // lowercase, alnum only
function assignHandle(base: string, takenOnline: Set<string>): string; // base, base-1, …
function classifyThread(rootId: string, bindings, knownThreads): 'bound'|'orphaned'|'foreign';
function chunkReply(text: string, max: number): string[];       // ordered (i/N) chunks
```
