# Teams Dump-Channel Metadata Relay — Contract

**Status:** Implemented & verified end-to-end (2026-07-08).

## Purpose

CopilotOffice needs Teams notifications to arrive under a **distinct identity** (Teams
never notifies you about your own messages) while dodging the tenant DLP that blocks
Power Automate HTTP/webhook triggers. Solution: the app posts every notification to ONE
operator-configured **Dump channel** carrying machine-readable metadata; a single Power
Automate flow (Teams connector only — DLP-allowed) parses that metadata and fans each
message out to the real destination channel, @mentioning a user or a team tag as the
**Flow bot**, so the operator actually gets pinged.

```
CopilotOffice app ──Graph POST──▶ Dump channel (Agent Hub)
                                        │  (Teams "new channel message" trigger)
                                        ▼
                              Power Automate flow
                          (decode metadata → @mention → post)
                                        │  as Flow bot
                                        ▼
                              Destination channel  ──▶ operator notified
```

## App → Dump channel message contract

The app posts an HTML channel message whose body is:

```
<human-readable html>
<p>[[CO-META]]<base64(JSON)>[[/CO-META]]</p>
```

The JSON payload (base64-encoded so Teams HTML-encoding can't corrupt it):

```json
{
  "v": 1,
  "destTeamId":    "<groupId GUID of destination team>",
  "destChannelId": "19:...@thread.tacv2",
  "mentionType":   "user" | "tag" | "none",
  "mentionId":     "<UPN/oid for user | tagId for tag | empty>",
  "title":         "<notification title>",
  "html":          "<clean human html — markers stripped>"
}
```

### Producer rules (app side)
- Human html is passed through `stripMetaMarkers` before embedding — an agent cannot
  smuggle a forged `[[CO-META]]` block into the human-visible portion.
- `mentionId` is **resolved in the app** at send time (it holds the Graph token):
  - `user`: UPN/oid passed through, or display name resolved via
    `findUserId` (`$filter=displayName eq …`).
  - `tag`: display name or id resolved to a `tagId` within `destTeamId` via
    `listTags(destTeamId)`.
- The destination (`destChannelId`) is enforced against the outbound allowlist
  (`isDestinationAllowed`). The Dump-channel POST itself bypasses the allowlist by
  design (fixed, operator-configured channel).

### Consumer rules (flow side)
- Extract the **LAST** marker block (defense-in-depth vs. injection):
  `base64ToString(first(split(last(split(content,'[[CO-META]]')),'[[/CO-META]]')))`.

## Power Automate flow

- **Environment:** `11111111-1111-1111-1111-111111111111`
- **Flow:** `22222222-2222-2222-2222-222222222222` — "CopilotOffice Dump Relay (metadata-driven)"
- **API:** `GET/PATCH https://api.flow.microsoft.com/providers/Microsoft.ProcessSimple/environments/{env}/flows/{flow}?api-version=2016-11-01`
  (token resource `https://service.flow.microsoft.com/`). Note: PATCH body is
  `{ properties: { definition, connectionReferences } }`.

### Flow structure

1. **Trigger** `OnNewChannelMessage` on the Dump channel (Agent Hub:
   team `aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee`, channel
   `19:0123456789abcdef0123456789abcdef@thread.tacv2`), `splitOn` per message.
2. `Initialize_mentionToken` (string, `""`) — must be top-level (Logic Apps constraint).
3. `Check_has_meta` — `If contains(triggerOutputs()?['body/body/content'], '[[CO-META]]')`.
   True branch:
   - `Compose_metaJson` — decode as above.
   - `Parse_metaJson` — parse to the JSON schema.
   - `Switch_mention` on `mentionType`:
     - `user` → `AtMentionUser(userId = mentionId)` → set `mentionToken = body?['atMention']`.
     - `tag`  → `AtMentionTag(groupId = destTeamId, tagId = mentionId)` → set token.
     - default → leave `""`.
   - `Post_to_channel` — `PostMessageToConversation`, `poster=Flow bot`,
     `location=Channel`, `body/recipient/groupId=destTeamId`,
     `body/recipient/channelId=destChannelId`,
     `body/messageBody = mentionToken + " " + html`.
   Else branch: empty (no-op).

### Loop safety
The forwarded Flow-bot message contains **no** `[[CO-META]]` marker, so when the trigger
fires on it, `Check_has_meta` is false and the flow no-ops. Destination may safely equal
the Dump channel.

## Verified connector facts
- `AtMentionUser` (GET `/v1.0/users/{userId}`) and `AtMentionTag`
  (GET `/beta/teams/{groupId}/tags/{tagId}`) both return `{ atMention: string }`.
- `PostMessageToConversation` body is dynamic (`GetUnifiedActionSchema` on
  poster+location). For **Flow bot / Channel** the flattened params are:
  `body/recipient/groupId`, `body/recipient/channelId`, `body/messageBody`.

## Verification (2026-07-08)
Run `REDACTED-RUN-ID`: all actions Succeeded; `AtMentionUser` OK,
`AtMentionTag` Skipped, `Post_to_channel` code=Created; resolved body
`<at>user@example.com</at> <p>…</p>`. Operator confirmed receipt of the Flow-bot
@mention notification.

## Backups
- Original flow definition: session `files/flow-definition.json`.
- New flow definition: session `files/flow-definition-new.json`.
