# Fleet Event Pipeline — Bug Diagnosis Reference

Comprehensive reference for diagnosing fleet event pipeline bugs in the Agency Office
Electron + Phaser game. The fleet feature lets Arthur (architect agent) dispatch Copilot
CLI subagents via `/fleet`, visualized as NPCs in a fleet v-team room.

---

## 1. Event Pipeline Architecture (7 Hops)

Fleet subagent events traverse seven hops from PTY to UI. A failure at **any** hop
silently drops events — there is no retry or backpressure mechanism.

```
1. PTY process (node-pty)
   └─→ writes to stdout

2. events.jsonl (~/.copilot/session-state/{sessionId}/events.jsonl)
   └─→ Copilot CLI appends JSONL lines here

3. EventsWatcher (electron/terminal/events-watcher.ts)
   └─→ triple-watch: fs.watch + fs.watchFile (500ms) + manual poll
   └─→ reads new lines from last-known file offset

4. watcherCallback (electron/terminal/server.ts)
   └─→ processes parsed events
   └─→ GATE: skips ALL events if hasSignalledReady is false

5. activeAgentViewers GATE
   └─→ copilot-event only forwarded if activeAgentViewers.has(ck) is true
   └─→ ck = the ORIGINAL composite key from the closure, not the fleet key

6. IPC: server → main → renderer
   └─→ protocol.ts (ServerToMain type) → ipc-relay.ts (message forward)
       → preload.ts (copilotBridge.onCopilotEvent)

7. FleetTracker (src/meeting/fleetTracker.ts)
   └─→ processes subagent.started / completed / failed events
   └─→ FleetVisualizer (src/meeting/fleetVisualizer.ts)
       └─→ emits game events for NPC status updates
```

### Per-Hop Failure Modes

| Hop | What Can Go Wrong | How to Verify |
|-----|-------------------|---------------|
| 1 | PTY crashed or was killed (`terminal-exit` fired) | Server log: `[TermServer] PTY exited for {ck}` |
| 2 | CLI not emitting subagent events; wrong session ID; file permissions | `cat ~/.copilot/session-state/{sessionId}/events.jsonl \| grep subagent` |
| 3 | Watcher stopped (shared instance killed during transfer); watching wrong file; all three watch mechanisms failed | Server log: `[EventsWatcher] Read N event(s)` — if absent, watcher is dead |
| 4 | `hasSignalledReady` is false — agent never finished startup; all events silently dropped | Server log: `[TermServer] Agent {ck} signalled READY` — if absent, gate is closed |
| 5 | `activeAgentViewers` missing the ORIGINAL key; attach used fleet key only | Add temp log: `console.log('activeAgentViewers:', [...activeAgentViewers])` |
| 6 | IPC relay not forwarding; renderer window destroyed; preload listener not registered | Renderer DevTools Network/IPC tab or add log in `ipc-relay.ts` forwarding |
| 7 | FleetTracker not instantiated; `startTracking()` not called; `removeCopilotListeners()` nuked the listener | Renderer console: `[FleetTracker] onCopilotEvent: ...` |

---

## 2. The Composite Key Problem

### How Composite Keys Work

```typescript
function compositeKey(officeId: string, agentId: string): string {
  return `${officeId}:${agentId}`;
}
// Example: compositeKey("office-0", "architect") → "office-0:architect"
```

### What Gets Bound to the Original Key

When Arthur's terminal is started in `office-0`, the following are **permanently bound**
to the composite key `office-0:architect` via JavaScript closures:

| Resource | Storage Location | Closure Variable |
|----------|-----------------|------------------|
| EventsWatcher instance | `agentWatchers` map | key = `office-0:architect` |
| `watcherCallback` closure | inline in `startTerminalForAgent()` | captures `ck`, `agentId`, `hasSignalledReady` |
| PTY `onData` callback | inline in `startTerminalForAgent()` | captures `ck` |
| PTY `onExit` callback | inline in `startTerminalForAgent()` | captures `ck` |

### After Session Transfer

When the session is transferred to a fleet office (`office-1`):

```
agentToTerminal.set("office-1:architect", "office-0:architect")
```

The `agentToTerminal` map creates a lookup from the new key to the original PTY key.
But **all closures still reference `office-0:architect`**. This means:

- PTY data callbacks check `activeAgentViewers.has("office-0:architect")`
- The watcher callback checks `activeAgentViewers.has("office-0:architect")`
- The client attaches with `"office-1:architect"` (the fleet office key)

### The Belt-and-Suspenders Fix

The `attach` handler resolves this mismatch in two ways:

1. **Server-side (primary):** The `attach` handler looks up the original terminal key
   via `agentToTerminal` and adds **both** keys to `activeAgentViewers`:
   ```
   activeAgentViewers.add("office-1:architect")  // client's key
   activeAgentViewers.add("office-0:architect")  // original PTY key (from agentToTerminal lookup)
   ```
   The `detach` handler cleans up both keys.

2. **Client-side (secondary):** FleetTracker attaches using the `sourceOfficeId`
   (e.g., `office-0`) instead of the fleet office ID, so the attach key matches
   the original PTY key directly.

If **either** fix is removed, terminal output and/or `copilot-event` data may
silently stop flowing in fleet offices.

---

## 3. Session Transfer Mechanics

During `transfer-session` (server.ts), the following are copied or remain bound:

### ✅ Copied to New Key

| Resource | Details |
|----------|---------|
| `agentToTerminal` mapping | `newKey → originalKey` — enables PTY lookup |
| Scrollback buffers | Full copy of ANSI output history |
| Ready state | `hasSignalledReady` flag carried over |
| `activeAgentViewers` | If source had a viewer, the new key is also added |
| Session history | Chat history array copied |
| Session meta | Title, creation time, metadata copied |

### ❌ NOT Transferred (Stays Bound to Original Key)

| Resource | Why It Matters |
|----------|---------------|
| EventsWatcher instance | Still in `agentWatchers` under original key; still watching the correct `events.jsonl` file |
| `watcherCallback` closure | Captures original `ck` — checks `activeAgentViewers.has(originalKey)` |
| PTY `onData` callback | Captures original `ck` — forwards data only if `activeAgentViewers.has(originalKey)` |
| PTY `onExit` callback | Captures original `ck` — sends `terminal-exit` with original key |

**Implication:** For events to flow after transfer, `activeAgentViewers` **must** contain
the ORIGINAL key (`office-0:architect`), not just the fleet key (`office-1:architect`).

---

## 4. Two Fleet Deploy Paths

### Path 1: `fleet:office:created` (OfficeScene wake handler → main.ts)

This path is used when MeetingScene exits with a plan and OfficeScene creates the fleet office.

```
1. MeetingScene exits with plan data
   └─→ scene.stop('MeetingScene') + scene.wake('OfficeScene', { plan })

2. OfficeScene wake handler fires
   └─→ creates fleet office via officeManager
   └─→ emits 'fleet:office:created' { officeId, sourceOfficeId }

3. main.ts handles 'fleet:office:created'
   └─→ transfers Arthur's session to fleet office
   └─→ calls switchToOffice(fleetOfficeId)

4. ⚠️ Does NOT emit 'fleet:source-office'
   └─→ fleetSourceOfficeId is null in OfficeScene

5. initFleetPipeline() called during fleet layout setup
   └─→ falls back to officeManager.currentOfficeId (= fleet office ID)
   └─→ FleetTracker attaches with fleet office ID

6. Belt-and-suspenders saves it:
   └─→ server attach handler adds original key via agentToTerminal lookup
```

### Path 2: `fleet:deploy-requested` (MeetingScene deploy dialog → main.ts)

This is the preferred path with correct source office propagation.

```
1. MeetingScene emits 'fleet:deploy-requested'
   └─→ includes resolve() callback for async coordination

2. main.ts handles 'fleet:deploy-requested'
   └─→ creates fleet office
   └─→ transfers Arthur's session
   └─→ resolve() — signals MeetingScene that transfer is done
   └─→ emits 'fleet:source-office' { sourceOfficeId }
   └─→ calls switchToOffice(fleetOfficeId)

3. OfficeScene receives 'fleet:source-office'
   └─→ stores fleetSourceOfficeId for later use

4. MeetingScene's .then() calls exitMeeting()
   └─→ exit animations run (~1300ms)
   └─→ OfficeScene is SLEEPING during this time

5. OfficeScene defers layout switch
   └─→ scene is sleeping, so it queues the fleet layout rebuild

6. MeetingScene finishes exit choreography
   └─→ scene.stop('MeetingScene')
   └─→ scene.wake('OfficeScene')

7. OfficeScene wake handler fires
   └─→ processes deferred layout switch
   └─→ rebuildLayout('fleet-vteam')

8. initFleetPipeline() creates FleetTracker
   └─→ uses correct fleetSourceOfficeId (from step 3)
   └─→ attaches with source office ID — matches original PTY key
```

---

## 5. Historical Bug Catalog

| Commit | Summary | Root Cause |
|--------|---------|------------|
| `101027b` | Terminal output stops in fleet office | `attach` handler didn't add original PTY key to `activeAgentViewers` for transferred sessions — closures check original key but only fleet key was in the set |
| `b5e4464` | FleetTracker events don't arrive | FleetTracker attached with fleet office ID (`office-1`) instead of source office ID (`office-0`) — server's `activeAgentViewers` didn't contain the fleet key for closure checks |
| `6675174` | EventsWatcher killed during transfer | `transfer-session` shared the EventsWatcher object reference; when the destination agent was killed/reset, it stopped the shared watcher instance, killing event flow for the original agent too |
| `851ad2c` | Fleet deploy dialog detaches wrong office | Detach targeted the wrong office ID during async transfer, causing a race condition where the source office's viewer was removed before the transfer completed |
| `880b77d` | Can't type in Arthur's terminal in fleet office | Terminal `write` handler looked up PTY using the fleet office composite key (`office-1:architect`) but the PTY was stored under the original key (`office-0:architect`) — needed `agentToTerminal` resolution |
| `8ee6b0c` | `/fleet` command sent before session transfer | The `/fleet` command was dispatched to Arthur's terminal while it was still attached to the old office; the transfer hadn't completed yet, so the command arrived at the wrong context |
| `a3821ca` | `/fleet` command lost during scene switch | Command was sent to Arthur's terminal before the terminal was re-attached in the new office — the write went to a detached session and was silently dropped |
| `f95a4be` | Fleet terminal input broken | The `write` path in server.ts didn't resolve through `agentToTerminal` for transferred sessions — it tried to find a PTY under the fleet key, which didn't exist |

### Pattern

Most bugs share a common theme: **key mismatch between the fleet office composite key
and the original PTY composite key**. The `agentToTerminal` indirection was added
incrementally as each bug was discovered. The belt-and-suspenders approach (server-side
+ client-side fixes) exists because the key mismatch is fundamental to the closure-based
architecture.

---

## 6. Diagnostic Checklist

When fleet events stop flowing, check **in order** (each step depends on the previous):

### Step 1: Is the PTY alive?

- **Where to look:** Server logs (Electron main process console — the terminal where `npm start` was run)
- **Look for:** `[TermServer] Starting copilot --resume for {ck}`
- **Bad sign:** `terminal-exit` event fired → PTY is dead, nothing will work
- **Fix:** Restart the agent session

### Step 2: Is events.jsonl being updated?

- **Where to look:** File system: `~/.copilot/session-state/{sessionId}/events.jsonl`
- **Look for:** `subagent.started` lines (grep for `"subagent"`)
- **Bad sign:** No subagent lines → Copilot CLI isn't emitting them (not a pipeline bug)
- **Fix:** Verify the `/fleet` command was received and the CLI supports subagent events

### Step 3: Is EventsWatcher alive?

- **Where to look:** Server logs
- **Look for:** `[EventsWatcher] Read N event(s)` or periodic heartbeat logs
- **Bad sign:** No watcher logs at all → watcher may have been stopped (see bug `6675174`)
- **Fix:** Check if `agentWatchers.has(originalKey)` is true; verify watcher wasn't killed during transfer

### Step 4: Has the agent signalled ready?

- **Where to look:** Server logs
- **Look for:** `[TermServer] Agent {ck} signalled READY`
- **Bad sign:** No ready signal → `hasSignalledReady` is false → **ALL events are gated/dropped**
- **Fix:** Wait for agent startup to complete, or check if startup failed silently

### Step 5: Is the viewer attached?

- **Where to look:** Server logs
- **Look for:** `[TermServer] Attaching viewer for {ck}`
- **Critical check:** `activeAgentViewers` must contain the **ORIGINAL** key (e.g., `office-0:architect`), not just the fleet key
- **Debug:** Add temporary log: `console.log('[DEBUG] activeAgentViewers:', [...activeAgentViewers])`
- **Fix:** Ensure `attach` handler's belt-and-suspenders code adds original key via `agentToTerminal` lookup

### Step 6: Is copilot-event being sent?

- **Where to look:** Server code (server.ts, watcherCallback)
- **Debug:** Add temporary log before the `activeAgentViewers` gate check:
  ```typescript
  console.log(`[DEBUG] copilot-event gate: ck=${ck}, has=${activeAgentViewers.has(ck)}`);
  ```
- **Bad sign:** Gate check returns false → go back to Step 5

### Step 7: Is FleetTracker receiving events?

- **Where to look:** Renderer DevTools console (Ctrl+Shift+I in the app window)
- **Look for:** `[FleetTracker] onCopilotEvent: agent=architect, type=subagent.started`
- **Bad sign:** No FleetTracker logs → IPC relay issue, preload listener not registered, or FleetTracker not instantiated
- **Fix:** Verify `startTracking()` was called; check that `copilotBridge.onCopilotEvent` listener exists

### Step 8: Were copilot listeners removed?

- **Where to look:** Renderer code and console
- **Critical:** `removeCopilotListeners()` nukes **ALL** `copilot-event` listeners, including FleetTracker's
- **When it's called:** Only on page reload (`Ctrl+R` / `Ctrl+Shift+R`) and FleetOrchestrator cleanup
- **Bad sign:** FleetTracker was tracking, then suddenly stopped → listeners were removed
- **Fix:** Ensure `removeCopilotListeners()` is not called during active fleet flow

### Where to Look (Summary)

| Log Source | How to Access | What You'll Find |
|------------|---------------|-----------------|
| Server logs | Terminal where `npm start` was run | EventsWatcher, watcherCallback, activeAgentViewers, PTY lifecycle |
| Renderer logs | Ctrl+Shift+I in app window → Console tab | FleetTracker, FleetVisualizer, game events |
| events.jsonl | `~/.copilot/session-state/{sessionId}/events.jsonl` | Raw Copilot CLI events (JSONL format) |

---

## 7. Invariants

For fleet subagent events to flow end-to-end, **ALL** of these must be true simultaneously:

1. **Arthur's PTY process is alive**
   - `ptyProcesses.has(originalKey)` returns true
   - No `terminal-exit` event has fired for this key

2. **Arthur's EventsWatcher is alive and watching the correct file**
   - `agentWatchers.has(originalKey)` returns true
   - Watcher is monitoring `~/.copilot/session-state/{sessionId}/events.jsonl`
   - Watcher was not killed by a shared-instance bug during transfer

3. **The watcher's `hasSignalledReady` flag is true**
   - Agent finished Copilot CLI startup sequence
   - Until this is true, ALL events from this watcher are silently dropped

4. **`activeAgentViewers` contains the ORIGINAL composite key**
   - e.g., `activeAgentViewers.has("office-0:architect")` returns true
   - The fleet key (`office-1:architect`) alone is insufficient
   - The `attach` handler must have added the original key via `agentToTerminal` lookup

5. **Copilot CLI is writing subagent events to events.jsonl**
   - The CLI must support and be emitting `subagent.started`, `subagent.completed`, etc.
   - Events must be written to Arthur's session's events file (not a subagent's file)

6. **The `copilot-event` IPC listener is registered on the renderer**
   - `copilotBridge.onCopilotEvent` callback is active
   - `removeCopilotListeners()` has not been called since FleetTracker started

7. **FleetTracker is instantiated and `startTracking()` was called**
   - FleetTracker exists and is listening for `copilot-event` callbacks
   - `startTracking()` registered the event handler

**If any single invariant is violated, fleet events silently stop flowing.**
There are no error messages, no warnings, no retries. The pipeline just goes silent.

---

## 8. Subagent Events (Quick Reference)

Events emitted by Copilot CLI into `events.jsonl` during fleet execution:

| Event Type | When | Key Fields |
|------------|------|------------|
| `tool.execution_start` | Subagent dispatched (toolName=`task`) | `description`, `prompt`, `agent_type` |
| `subagent.started` | Subagent process began executing | `toolCallId`, `agentName` |
| `subagent.completed` | Subagent finished successfully | `toolCallId` |
| `subagent.failed` | Subagent errored | `toolCallId`, error message |
| `system.notification` | Human-readable status update | e.g., `"Agent agent-N completed successfully"` |

### Correlation

All events for a single subagent are linked by `toolCallId`. Use this to track
a subagent from dispatch through completion/failure:

```
tool.execution_start  (toolCallId: "abc-123", toolName: "task")
  → subagent.started  (toolCallId: "abc-123", agentName: "agent-1")
  → subagent.completed (toolCallId: "abc-123")
```

### Important Note

`subagent.*` events are **NOT** explicitly handled in server.ts `watcherCallback`.
They are not matched by any `case` in the event type switch. Instead, they flow
through as raw `copilot-event` messages, gated only by `activeAgentViewers`.
This means the `activeAgentViewers` gate is the **sole** server-side filter for
these events.

---

## 9. Known Limitation

From the project's `copilot-instructions.md`:

> When Arthur's terminal is transferred from the source office to a fleet office
> (via `transferSession`), the server's PTY data callback and `EventsWatcher`
> callback closures capture the **original** composite key (`office-0:architect`).
> The `copilot-event` channel, `terminal-data` forwarding, and PTY output are only
> sent when `activeAgentViewers.has(ck)` — but the client attaches with the **new**
> fleet office key.
>
> **Fix in server:** The `attach` handler now also adds the original terminal key
> (via `agentToTerminal` lookup) to `activeAgentViewers`, so both keys are marked
> active. The `detach` handler cleans up both.
>
> **Additional workaround:** FleetTracker also attaches using the `sourceOfficeId`
> as a belt-and-suspenders approach. If either fix is removed, terminal output
> and/or copilot-event data may silently stop flowing in fleet offices.

This is a **fundamental architectural limitation** of the closure-based PTY callback
model. The closures capture the composite key at PTY creation time and cannot be
updated after transfer. The belt-and-suspenders approach works but is fragile —
any change to the attach/detach flow or listener cleanup must preserve both fixes.
