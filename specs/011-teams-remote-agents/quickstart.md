# Quickstart: Teams Remote Agents

How to set up, run, and manually verify the feature.

## Prerequisites

- `az` CLI installed and signed in (`az login`) in the tenant that hosts the target channel.
- Membership in a Teams **team** with a channel you can post to (e.g. a personal test team).
- CopilotOffice built: `npm run build`.

## One-time verification the tokens work (optional sanity)

```powershell
az account get-access-token --resource https://graph.microsoft.com --query accessToken -o tsv    # send
az account get-access-token --resource https://ic3.teams.office.com --query accessToken -o tsv   # receive
```
Both should return a token. If the ic3 call errors with `AADSTS530084`, this tenant blocks CLI
tokens (Conditional Access Token Protection) — the feature needs the browser fallback (out of v1 scope).

## Configure the channel

1. In CopilotOffice open **Teams settings** (from the agent terminal panel).
2. Paste the channel deep-link URL, e.g.
   `https://teams.microsoft.com/l/channel/19%3A...%40thread.tacv2/Agent%20Hub?groupId=<teamId>&tenantId=<tenantId>`.
3. Save. The URL is parsed into `{ teamId, channelId, tenantId }`; a parse error is reported inline.

## Bring an agent online

1. Start an agent's session (e.g. Gene) so it has a terminal session id.
2. Click **Teams remote** in Gene's terminal panel (near New/Close Session).
3. Expect: a new thread titled `Gene: <session title>` appears in the channel with an intro post
   (name, working folder, handle, session title, best-effort summary). The button shows "online".

## Drive the agent from Teams

1. Reply in Gene's thread (no @mention): `what is 2+2`.
2. Expect: the prompt runs in Gene's existing CopilotOffice session and the answer posts back in
   the same thread within a couple seconds of the turn completing.
3. Follow-up in the same thread continues the same session (context retained).

## Stop

- Post `/stop` in the thread **or** click the in-app Teams remote toggle. Expect an offline notice
  in the thread; the terminal session keeps running.

## Manual test matrix (maps to Success Criteria)

| Check | Expectation | SC |
|-------|-------------|----|
| First reply after online | ≤ ~2 min from first click | SC-001 |
| Follow-up latency | ≥5× faster than a fresh session | SC-002 |
| 20 msgs incl. bursts | exactly one reply each, in order | SC-003 |
| Duplicates / stale / app self-posts | ignored | SC-004 |
| Two colliding agents | `gene` + `gene-1`, correct routing | SC-005 |
| >1 message reply (10k chars) | delivered in ordered chunks | SC-006 |
| Status indicator | matches service within seconds, incl. drop/recover | SC-007 |
| Check-ins on long task | ≥1 interim update, throttled | SC-008 |
| New session while online | agent goes offline in Teams | SC-009 |
| Close/reopen app | previously-online agents reconnect when their session id reappears, no dup threads | SC-010 |
| Orphaned thread reply | one-time "no longer active" notice | FR-027 |
| Foreign thread message | ignored silently | FR-028 |

## Automated tests

```powershell
npm run test          # unit/integration (handle, filter, channelLink, marker, store GC, reconnect)
npm run test:e2e      # Playwright: button → online → status (Teams transport mocked)
```
No live secrets in tests — `TokenProvider`, `GraphSender`, `MessageSource`, and `SessionGateway`
are injected fakes.
