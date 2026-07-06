# Contract: External Teams APIs

Endpoints and payloads the Teams service depends on. All spike-validated 2026-07-06.
Auth tokens acquired via `az account get-access-token --resource <resource>`.

## Enumerate teams / channels (Graph)

```
GET https://graph.microsoft.com/v1.0/me/joinedTeams
GET https://graph.microsoft.com/v1.0/teams/{teamId}/channels
Authorization: Bearer <graph-token>
```
Used only to validate a pasted deep-link (optional). Channel id format: `19:...@thread.tacv2`.

## Create a thread (root message with subject) — SEND

```
POST https://graph.microsoft.com/v1.0/teams/{teamId}/channels/{channelId}/messages
Authorization: Bearer <graph-token>
Content-Type: application/json

{
  "subject": "Gene: Fixing terminal scroll",
  "body": { "contentType": "html", "content": "<MARKER><p>…intro…</p>" }
}
```
- Success: `201`-style JSON with `id` = **threadRootId**, `webUrl`, `subject`.
- Scope: works with `Directory.AccessAsUser.All` (no `ChannelMessage.Send`).

## Reply in a thread — SEND

```
POST https://graph.microsoft.com/v1.0/teams/{teamId}/channels/{channelId}/messages/{rootId}/replies
Authorization: Bearer <graph-token>
Content-Type: application/json

{ "body": { "contentType": "html", "content": "<MARKER>…reply chunk…" } }
```
- Long replies split into ordered chunks (`(1/N)…(N/N)`), each posted sequentially (FR-011).
- Every body embeds the self-loop `<MARKER>` (FR-007a).

## Receive via Trouter (subscribe) — RECEIVE (primary)

Handshake (port of `agency-cowork/.../monitor/trouter_client.py`):
1. `wss://{gateway}/v4/c?tc=…&epid=…&timeout=40&dom=teams.cloud.microsoft…` (Origin header set).
2. Recv `1::` connect frame.
3. Send `5:::{ "name":"user.authenticate", "args":[{ "headers":{ "Authorization":"Bearer <ic3-token>", "X-MS-Migration":"True", "X-Ms-Test-User":"False" }, "connectparams":{…} }] }`.
4. Recv `5:N::` event `trouter.connected` → capture `surl`, `registrarUrl`, `connectparams`.
5. Register: `POST {registrarUrl}` and V2 `https://teams.cloud.microsoft/registrar/prod/V2/registrations` with `TeamsCDLWebWorker` template + TROUTER transport path = `surl`.
6. Listen: server pushes `3:::{…EventMessage…}` frames. ACK each with `3:::{ "id":…, "status":200, … }`.
7. Heartbeat: send `5:N+::{"name":"ping"}` every ~30s; reply `6:::N["pong"]` to server pings. Re-register every ~45 min (TTL 3600s).

EventMessage of interest: `type=="EventMessage"`, `resourceType=="NewMessage"`; extract
`resource.id`, `resource.content`, `resource.imdisplayname`, `resource.composetime`, and the
conversation id from `resource.conversationLink` — **channel** conversation ids carry
`;messageid=<rootId>` → the thread routing key.

## Receive via chatsvc (poll) — RECEIVE (fallback)

```
GET https://teams.cloud.microsoft/api/chatsvc/{region}/v1/users/ME/conversations/{URLENC channelId}/messages?pageSize=N
Authorization: Bearer <ic3-token>
```
- Returns `messages[]` with `id`, `messagetype`, `sequenceId`, `imdisplayname`, `content`,
  `properties.parentMessageId`, `rootMessageId`.
- Incremental polling: track last-seen `sequenceId`; region default `amer` (auto-correct on 404
  `Location` per reference).

## Notes

- `region` may need discovery from a 404 `Location` header (reference behavior); default `amer`.
- 401 on the `csa` host variant is expected — use the `chatsvc` host.
- Token refresh: decode JWT `exp`; refresh with buffer; on refresh failure reuse a still-valid
  token (graceful degradation).
- Secrets: tokens live in memory only; never written to the JSON store or logs.
