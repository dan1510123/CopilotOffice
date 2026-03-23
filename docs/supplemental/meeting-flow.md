# Meeting-to-Fleet Flow — Two Paths

This document describes the two execution paths that transition from the Meeting Room into a Fleet V-Team office. Both originate in `MeetingScene` and end with OfficeScene awake in a new fleet-vteam office.

---

## Path 1: Plan Approval (Approve button in meeting room)

Arthur outputs a structured JSON plan in his terminal. The plan parser detects it and shows the approval overlay. The user clicks **Approve**.

### Sequence

```
                          MeetingScene                          OfficeScene                               main.ts                                 server.ts
                              │                                      │                                      │                                      │
 1. parsePlanFromOutput()     │                                      │                                      │                                      │
    detects plan in terminal  │                                      │                                      │                                      │
    output buffer             │                                      │                                      │                                      │
                              │                                      │                                      │                                      │
 2. showPlanApproval(plan)    │                                      │                                      │                                      │
    → PlanApprovalOverlay     │                                      │                                      │                                      │
    shows task cards          │                                      │                                      │                                      │
                              │                                      │                                      │                                      │
 3. User clicks "Approve"     │                                      │                                      │                                      │
    → onApprove(plan)         │                                      │                                      │                                      │
                              │                                      │                                      │                                      │
 4. exitMeeting(plan)  ───────┤                                      │                                      │                                      │
    ├─ hide() terminal        │                                      │                                      │                                      │
    │  └─ detach(source,      │                                      │                                      │                                      │
    │     architect)          │──── terminalDetach ──────────────────────────────────────────────────────────│──── detach ──────────────────────────▶│
    │     uses attachedOfficeId                                      │                                      │                                      │
    ├─ remove buttons         │                                      │                                      │                                      │
    ├─ walk animation (~1.5s) │                                      │                                      │                                      │
    └─ camera fadeOut (0.4s)  │                                      │                                      │                                      │
                              │                                      │                                      │                                      │
 5. scene.stop('MeetingScene')│                                      │                                      │                                      │
    scene.wake('OfficeScene', │─────── wake({ plan }) ──────────────▶│                                      │                                      │
                { plan })     │                                      │                                      │                                      │
                              │                                      │                                      │                                      │
                                                    6. OfficeScene wake handler:                            │                                      │
                                                       ├─ sourceOfficeId = currentOfficeId                  │                                      │
                                                       ├─ createOffice('Fleet V-Team',                     │                                      │
                                                       │             dir, 'fleet-vteam')                    │                                      │
                                                       ├─ emit('fleet:office:created',  ───────────────────▶│                                      │
                                                       │       fleetId, sourceOfficeId)                     │                                      │
                                                       ├─ hide player                                       │                                      │
                                                       └─ triggerAgentWalkIn()                              │                                      │
                                                                                                            │                                      │
                                                                                            7. fleet:office:created handler:                       │
                                                                                               ├─ transferSession(source ──────────────────────────▶│
                                                                                               │     → fleet, architect)  creates agentToTerminal  │
                                                                                               │                          alias + copies viewers   │
                                                                                               └─ switchToOffice(fleetId)                          │
```

### Key characteristics

- **No `/fleet` command** is sent — the plan data flows directly through `scene.wake('OfficeScene', { plan })`.
- The plan already exists when the fleet office is created.
- `exitMeeting(plan)` is called **synchronously** from the onApprove callback — no async gaps.
- Terminal detach uses `attachedOfficeId` (the source office), which is correct.

### Code locations

| Step | File | Lines |
|------|------|-------|
| Plan detection | `MeetingScene.ts` | `setupPlanDetection()` |
| Approval overlay | `MeetingScene.ts` | `showPlanApproval()` |
| Exit + animations | `MeetingScene.ts` | `exitMeeting(plan)` |
| Wake handler | `OfficeScene.ts` | `events.on('wake', ...)` |
| Transfer + switch | `main.ts` | `fleet:office:created` handler |

---

## Path 2: Fleet Deploy Dialog (🚀 button in meeting room)

The user clicks the 🚀 button, fills in a fleet name and prompt in a dialog, and clicks **Deploy**. This path sends a `/fleet` command to Arthur's terminal.

### Sequence

```
                          MeetingScene                               main.ts                                 server.ts
                              │                                         │                                      │
 1. User clicks 🚀 button    │                                         │                                      │
    → showFleetDeployDialog() │                                         │                                      │
                              │                                         │                                      │
 2. User fills in prompt,     │                                         │                                      │
    clicks "Deploy"           │                                         │                                      │
                              │                                         │                                      │
 3. closeDialog()             │                                         │                                      │
    isDeploying = true        │                                         │                                      │
    remove Leave/Fleet btns   │                                         │                                      │
                              │                                         │                                      │
 4. new Promise((resolve) =>  │                                         │                                      │
      emit('fleet:deploy-     │────── fleet:deploy-requested ─────────▶│                                      │
        requested',           │       { officeName, prompt,             │                                      │
        { resolve })          │         sourceOfficeId, resolve }       │                                      │
    )                         │                                         │                                      │
                              │                              5. async handler starts:                          │
    [MeetingScene awaits      │                                 a. createOffice(name,                          │
     resolve() via Promise]   │                                    '.', 'fleet-vteam')    [sync]               │
                              │                                                                                │
                              │                                 b. await transferSession ──────────────────────▶│
                              │                                    (source → fleet,        creates alias:      │
                              │                                     'architect')           fleet:architect →    │
                              │                                                            office-0:architect  │
                              │                                                            copies viewers +    │
                              │                                                            scrollback          │
                              │                                                                                │
                              │                                 c. await 200ms settle                           │
                              │                                    (alias propagation)                          │
                              │                                                                                │
                              │                                 d. await terminalWrite   ──────────────────────▶│
                              │                                    (fleet, architect,      getTerminalKey()     │
                              │                                     '/fleet <prompt>\r')   resolves via alias   │
                              │                                                            → write to PTY      │
                              │                                                                                │
                              │                                 e. resolve()  ─────────────────────┐            │
                              │                                                                    │            │
                              │                                 f. emit('fleet:source-office')      │  [sync]    │
                              │                                                                    │            │
                              │                                 g. switchToOffice(fleetId)          │            │
                              │                                    → currentOfficeId = fleet        │            │
                              │                                                                    │            │
                              │◀───────────────── Promise resolves ────────────────────────────────┘            │
                              │                                                                                │
 6. [microtask]               │                                                                                │
    isDeploying = false       │                                                                                │
    exitMeeting() (no plan)   │                                                                                │
    ├─ hide() terminal        │                                                                                │
    │  └─ detach(source,      │──── terminalDetach(attachedOfficeId = source) ─────────────────────────────────▶│
    │     architect)           │     (NOT fleet — attachedOfficeId captured at show() time)                     │
    ├─ walk animation (~1.5s) │                                                                                │
    └─ camera fadeOut (0.4s)  │                                                                                │
                              │                                                                                │
 7. scene.stop('MeetingScene')│                                                                                │
    scene.wake('OfficeScene', │────── wake() with NO plan                                                      │
              {})             │       (plan was sent as /fleet command, not via wake data)                      │
```

### Key characteristics

- The **`/fleet` command** is sent to Arthur's terminal via `terminalWrite` — plan data does NOT flow through the scene wake call.
- The Promise-based handshake ensures `exitMeeting()` cannot fire until transfer + write completes.
- `isDeploying` flag + button removal prevent the user from triggering `exitMeeting()` via Ctrl+Enter or Leave button during the async window.
- Terminal detach uses `attachedOfficeId` (captured at `show()` time = source office), so the fleet office viewer remains intact.
- `switchToOffice()` runs synchronously after `resolve()` but before the microtask that calls `exitMeeting()`.

### Code locations

| Step | File | Lines |
|------|------|-------|
| Fleet dialog + Deploy handler | `MeetingScene.ts` | `showFleetDeployDialog()` |
| Deploy orchestration | `main.ts` | `fleet:deploy-requested` handler |
| Session transfer | `server.ts` | `transfer-session` handler |
| PTY write resolution | `server.ts` | `write` handler + `getTerminalKey()` |
| Exit meeting (after resolve) | `MeetingScene.ts` | `exitMeeting()` |

---

## Comparison

| Aspect | Path 1 (Plan Approval) | Path 2 (Fleet Deploy Dialog) |
|--------|------------------------|------------------------------|
| Trigger | Arthur outputs JSON plan → Approve | User clicks 🚀 → fills dialog → Deploy |
| Plan delivery | `scene.wake('OfficeScene', { plan })` | `/fleet` command written to Arthur's PTY |
| Fleet office created by | OfficeScene wake handler | main.ts `fleet:deploy-requested` handler |
| Session transfer timing | After wake, via `fleet:office:created` | During deploy handler, before `/fleet` write |
| Async complexity | Low — synchronous callback chain | High — async handler with Promise handshake |
| Race condition risk | Low | Mitigated by `isDeploying` flag + button removal |
| Exit meeting receives plan? | Yes — `exitMeeting(approvedPlan)` | No — `exitMeeting()` with no args |

## PTY Alias & Viewer Model

Both paths use `transferSession` to make Arthur's PTY accessible under the fleet office key. The server creates an alias in `agentToTerminal`:

```
agentToTerminal.set('fleet-1:architect', 'office-0:architect')
```

This allows `getTerminalKey('fleet-1', 'architect')` to resolve to the original PTY. The transfer also copies:
- `activeAgentViewers` state (if source had a viewer, fleet key also marked active)
- Scrollback buffers and byte counts (so `attach` from fleet office replays full history)
- Ready state and turn state
- Session history
- Does **NOT** share `EventsWatcher` — the destination creates its own watcher when a new session starts. Sharing would cause the destination's kill/reset to stop the source's watcher.

The `detach` handler follows the alias chain — detaching `fleet-1:architect` also removes `office-0:architect` from `activeAgentViewers`, and vice versa. This is why it's critical that `hide()` detaches from the **source** office (via `attachedOfficeId`), not the **fleet** office.
